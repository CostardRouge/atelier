/**
 * The roll's commands FOR AN AGENT beyond a single write (`shared/commands/`):
 * looking at two pictures at once, reading what was done, harmonising a
 * series, a develop by rule, the Auto verbs on many, export targets by name.
 * A factory over a small HOST so the editor hands it its funnels (`update`,
 * `openPicture`) and nothing else — the same shape as `presetCommands`.
 *
 * Several compose the registry's own commands (`develop.snapshot`,
 * `develop.auto`) through `commands.execute` rather than reaching into the
 * workbench: what the agent could do in two calls, done in one, by the same
 * doors.
 */

import { blobOfImageResult } from '../../shared/commands/image-result';
import { contactSheetImage } from '../../shared/commands/contact-sheet-image';
import { CommandError, commands, waitForCommand, type CommandSpec, type ImageResult } from '../../shared/commands/registry';
import { applyRuleValues, planRules, readRules } from '../../shared/develop/apply-rules';
import { DELIVERY_PRESETS, findDeliveryPreset } from '../../shared/develop/delivery-presets';
import { SECTION_IDS, targetPicture } from '../../shared/develop/develop-commands';
import type { DevelopPreset } from '../../shared/develop/develop';
import { exposureOffset, withExposureOffset } from '../../shared/develop/match-exposure';
import { applySections, type PictureSection } from '../../shared/develop/picture-sections';
import { findPreset, presetOnto } from '../../shared/develop/preset-commands';
import { patchRollExport } from '../../shared/develop/roll-settings-commands';
import { getRollShots } from '../../shared/develop/roll-store';
import { copyGradeTo, isIgnored, patchPicture, pictureEdits, pictureLabel, readRollExport, type JournalVia, type RollDoc, type RollGrade, type RollPicture } from '../../shared/develop/roll-types';
import { pictureChapters } from '../../shared/develop/timelapse-chapters';
import type { WinnowAssetRow, WinnowClient } from '../../shared/sources/winnow/client';
import { splitAssetId } from '../../shared/sources/winnow/finals';
import type { WinnowConnection } from '../../shared/sources/winnow/store';

export interface RollAgentHost {
  roll: () => RollDoc;
  openId: () => string | null;
  /** The editor's one write funnel — journaled, undoable. */
  update: (change: (roll: RollDoc) => RollDoc, via?: JournalVia) => void;
  openPicture: (id: string) => void;
  /** A picture's band thumbnail: its own when drawn, else Winnow's, else null. */
  thumb: (picture: RollPicture) => Promise<Blob | null>;
  winnow: () => { client: WinnowClient | null; connection: WinnowConnection | null };
  presets: () => Promise<readonly DevelopPreset[]>;
  /** `true`, or why the roll's export settings cannot be written now. */
  exportLocked: () => true | string;
}

/** The picture ids `to` names, or every other picture not ignored for ["all"]; the source never among them. */
function targetsOf(roll: RollDoc, to: readonly string[], except: string): string[] {
  return to.length === 1 && to[0] === 'all'
    ? roll.pictures.filter((x) => x.id !== except && !isIgnored(x)).map((x) => x.id)
    : to.map((id) => targetPicture(roll, id, null).id).filter((id) => id !== except);
}

/** The ids `pictures` names, or every picture not ignored when it is absent. */
function picturesOf(roll: RollDoc, pictures: unknown): string[] {
  return (pictures as string[] | undefined)?.map((id) => targetPicture(roll, id, null).id) ?? roll.pictures.filter((x) => !isIgnored(x)).map((x) => x.id);
}

export function rollAgentCommands(host: RollAgentHost): CommandSpec[] {
  const winnowConnected = () => (host.winnow().client && host.winnow().connection ? true : 'no Winnow is connected — connect one on #/sources');
  return [
    {
      id: 'develop.compare',
      title: 'Two pictures side by side',
      description:
        'One image of two pictures beside each other, labelled: the open picture AS SHOT and AS DELIVERED when no pictures are named (the Before / After a person would look at), or any two pictures of the roll by id (their band thumbnails — graded where opened). Halves the round trips of every "is it better?".',
      params: {
        pictures: { type: 'strings', description: 'Exactly two picture ids; absent for the open picture before ↔ after.', optional: true },
        longEdge: { type: 'number', description: 'Each half’s long edge in pixels; 768 when absent.', min: 64, max: 2048, integer: true, optional: true },
      },
      run: async (p) => {
        const longEdge = typeof p.longEdge === 'number' ? p.longEdge : 768;
        const asked = p.pictures as string[] | undefined;
        if (asked === undefined) {
          const target = targetPicture(host.roll(), undefined, host.openId());
          const [before, after] = await Promise.all([
            commands.execute('develop.snapshot', { before: true, longEdge }) as Promise<ImageResult>,
            commands.execute('develop.snapshot', { longEdge }) as Promise<ImageResult>,
          ]);
          return contactSheetImage(
            [
              { image: blobOfImageResult(before), label: 'as shot' },
              { image: blobOfImageResult(after), label: 'as delivered', mark: pictureEdits(target).join(' ') || undefined },
            ],
            `${pictureLabel(target)} — before (left) and after (right)`,
            longEdge * 2 + 64,
          );
        }
        if (asked.length !== 2) throw new CommandError('invalid', 'name exactly two pictures, or none for the open picture’s before ↔ after');
        const pair = asked.map((id) => targetPicture(host.roll(), id, null));
        const images = await Promise.all(pair.map(host.thumb));
        return contactSheetImage(
          pair.map((x, i) => ({ image: images[i], label: pictureLabel(x), mark: pictureEdits(x).length ? 'edited' : undefined })),
          `${pictureLabel(pair[0])} (left) and ${pictureLabel(pair[1])} (right) — band thumbnails`,
          longEdge * 2 + 64,
        );
      },
    },
    {
      id: 'develop.explain',
      title: 'What was done to a picture',
      description:
        'The edits of a picture (the open one unless named) in the order they were made, read from its journal — each step with its sections, who made it (the author, an agent, the Auto plan) and a caption saying the DIFFERENCE it made: "+0.7 EV, shadows +20". A picture edited before the journal existed answers its sections in a standard order and says so.',
      params: { picture: { type: 'string', description: 'A picture id; the open picture when absent.', optional: true } },
      run: (p) => {
        const target = targetPicture(host.roll(), p.picture, host.openId());
        const { chapters, recorded, reconstructed } = pictureChapters(target);
        return {
          picture: target.id,
          name: pictureLabel(target),
          recorded,
          ...(reconstructed.length ? { reconstructed } : {}),
          steps: chapters.map((c) => ({ at: new Date(c.at).toISOString(), sections: c.sections, by: c.via ?? 'author', caption: c.caption })),
          summary: chapters.map((c) => c.caption).join(' · ') || 'nothing done yet',
        };
      },
    },
    {
      id: 'develop.match',
      title: 'Harmonise a series on one picture',
      description:
        'Make other pictures of the roll wear a REFERENCE picture’s settings (the open one unless named) — its edited sections plus the develop by default, any sections otherwise — and offset each one’s EXPOSURE so its median brightness lands on the reference’s, measured on the pictures as shot (the as-shot records the roll keeps; a picture without one takes the numbers as they are and is said). A drone, a Sony and a phone metered differently then read as one light. ±2 EV at most, said when the gap was wider. One undo step.',
      params: {
        to: { type: 'strings', description: 'Picture ids, or ["all"] for every other picture not ignored.' },
        reference: { type: 'string', description: 'The reference picture; the open one when absent.', optional: true },
        sections: { type: 'strings', description: `Section ids (${SECTION_IDS.join(', ')}); the reference’s edited sections plus the develop when absent.`, optional: true },
        matchExposure: { type: 'boolean', description: 'false copies the exposure as it is instead of offsetting it.', optional: true },
      },
      run: async (p) => {
        const roll = host.roll();
        const source = targetPicture(roll, p.reference, host.openId());
        const ids = targetsOf(roll, p.to as string[], source.id);
        if (ids.length === 0) throw new CommandError('invalid', 'nothing to harmonise — name other pictures than the reference');
        const asked = (p.sections as string[] | undefined) ?? [...new Set([...pictureEdits(source), 'develop'])];
        const unknown = asked.filter((s) => !(SECTION_IDS as readonly string[]).includes(s));
        if (unknown.length) throw new CommandError('invalid', `no section ${unknown.join(', ')} — the sections are ${SECTION_IDS.join(', ')}`);
        host.update((r) => applySections(r, r.pictures.find((x) => x.id === source.id) ?? source, ids, asked as PictureSection[]), 'agent');
        const exposure: Record<string, { ev: number; clamped: boolean } | 'no as-shot record'> = {};
        if (p.matchExposure !== false && asked.includes('develop')) {
          const shots = await getRollShots(roll.id);
          const ref = shots.get(source.id);
          for (const id of ids) {
            const shot = shots.get(id);
            const offset = ref && shot ? exposureOffset(ref.stats, shot.stats) : null;
            if (!offset) {
              exposure[id] = 'no as-shot record';
              continue;
            }
            exposure[id] = offset;
            if (offset.ev !== 0) {
              host.update((r) => patchPicture(r, id, { develop: withExposureOffset(r.pictures.find((x) => x.id === id)?.develop ?? null, offset.ev) }), 'agent');
            }
          }
        }
        return { reference: source.id, to: ids, sections: asked, exposure };
      },
    },
    {
      id: 'develop.applyRules',
      title: 'A develop by rule',
      description:
        'Give pictures a preset or slider values BY RULE: each rule is {when: facets as winnow.assets takes them (time, hourFrom/hourTo, light, gear, camera, orientation, focalMin/Max, apertureMax, isoMin, shutterMin, altitudeMin, nearLat/nearLon/nearKm), preset: a preset’s name or id} or {when, values: {exposure…}}; the first rule a picture matches is applied, judged on the Winnow row its file came from. A picture from a local file has no row and is left alone, said as such; so is one no rule matches. Every rule is checked before any picture is written. One undo step.',
      params: {
        rules: { type: 'array', description: 'The rules in order, e.g. [{"when": {"light": "golden"}, "preset": "Warm"}, {"when": {"gear": "drone"}, "values": {"exposure": 0.3}}].' },
        pictures: { type: 'strings', description: 'Picture ids; every picture not ignored when absent.', optional: true },
      },
      available: winnowConnected,
      run: async (p) => {
        const { client, connection } = host.winnow();
        if (!client || !connection) throw new CommandError('unavailable', 'no Winnow is connected');
        const rules = readRules(p.rules);
        const book = await host.presets();
        const presets = rules.map((r) => (r.preset ? findPreset(book, r.preset) : null));
        const roll = host.roll();
        const targets = picturesOf(roll, p.pictures).map((id) => roll.pictures.find((x) => x.id === id)!);
        const wanted = new Map<string, number>();
        for (const t of targets) {
          const split = splitAssetId(t.ref.assetId);
          if (split && split.host === connection.id) wanted.set(t.id, split.id);
        }
        const rows = new Map<number, WinnowAssetRow>();
        const all = [...new Set(wanted.values())];
        for (let i = 0; i < all.length; i += 200) for (const row of await client.assetsByIds(all.slice(i, i + 200))) rows.set(row.id, row);
        const plan = planRules(
          targets.map((t) => ({ id: t.id, row: (wanted.has(t.id) && rows.get(wanted.get(t.id)!)) || null })),
          rules,
        );
        host.update((r) => {
          let next = r;
          for (const m of plan.matched) {
            const t = next.pictures.find((x) => x.id === m.id);
            if (!t) continue;
            const rule = rules[m.rule];
            const preset = presets[m.rule];
            if (preset) {
              next = patchPicture(next, m.id, { develop: presetOnto(t.develop, preset.settings) });
              if (preset.look) next = copyGradeTo(next, [m.id], preset.look as RollGrade);
            } else next = patchPicture(next, m.id, { develop: applyRuleValues(t.develop, rule) });
          }
          return next;
        }, 'agent');
        return {
          applied: plan.matched.map((m) => ({ picture: m.id, rule: m.rule, does: presets[m.rule]?.name ?? 'values' })),
          unmatched: plan.unmatched,
          noRow: plan.noRow,
        };
      },
    },
    {
      id: 'develop.autoAll',
      title: 'The Auto verbs on many pictures',
      description:
        'Run develop.auto on several pictures (every picture not ignored when none is named), one after the other — each is opened, measured as shot, and given the steps asked (tone, colour, bands, detail, level, upright; all when absent). Slow: a decode per picture. The picture that was open comes back at the end. Answers what each step said, per picture.',
      params: {
        steps: { type: 'strings', description: 'Any of tone, colour, bands, detail, level, upright; all when absent.', optional: true },
        pictures: { type: 'strings', description: 'Picture ids; every picture not ignored when absent.', optional: true },
      },
      run: async (p) => {
        const ids = picturesOf(host.roll(), p.pictures);
        const back = host.openId();
        const results: Record<string, unknown> = {};
        for (const id of ids) {
          host.openPicture(id);
          try {
            // The workbench is keyed on the picture: its commands leave and come back for the new one.
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            await waitForCommand(commands, 'develop.auto', 60_000);
            results[id] = await commands.execute('develop.auto', p.steps ? { steps: p.steps } : {});
          } catch (err) {
            results[id] = { error: err instanceof Error ? err.message : String(err) };
          }
        }
        if (back && back !== host.openId()) host.openPicture(back);
        return { pictures: ids.length, results };
      },
    },
    {
      id: 'develop.deliveryPreset',
      title: 'Export targets for a network',
      description: `Set the roll's export targets for a use by name — ${DELIVERY_PRESETS.map((x) => `${x.id} (${x.does})`).join('; ')} — instead of spelling the sizes out with develop.exportSettings; the list of presets when none is named. One undo step.`,
      params: { preset: { type: 'string', description: 'The preset id or name; absent to list them.', optional: true } },
      available: host.exportLocked,
      run: (p) => {
        if (p.preset === undefined) return { presets: DELIVERY_PRESETS.map(({ id, name, does, targets }) => ({ id, name, does, targets })) };
        const preset = findDeliveryPreset(p.preset as string);
        const next = patchRollExport(readRollExport(host.roll().export), { targets: preset.targets });
        host.update((r) => ({ ...r, export: next, updatedAt: Date.now() }), 'agent');
        return { preset: preset.id, targets: next.targets };
      },
    },
  ];
}
