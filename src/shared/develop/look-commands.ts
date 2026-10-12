/**
 * Develop's LOOK commands (`shared/commands/`): the open picture's look — the
 * built-in LUTs, the film stocks, the output transform — through the very
 * stack the Look tab drives (`useRollGrade` over `useLutStack`), so a look an
 * agent adds is baked, saved and undone like a click on a tile.
 *
 * The stack follows the OPEN picture, so these act on it alone; to dress a
 * roll, set the look on one picture and `develop.applyTo` it with the `look`
 * section. A purchased pack's looks and the uploaded `.cube`s are reached by
 * REFERENCE since 2026-10-12 (his call): the agent reads their names and
 * adds one as the picker does, and the lattice never leaves the vault — no
 * command answers it.
 *
 * DOM-free: the stack is handed in through a getter, read fresh at every step
 * since it is a new object every render.
 */

import { CommandError, type CommandSpec } from '../commands/registry';
import { BUILTIN_LUTS } from '../lut/builtin-luts';
import { MAX_LAYER_INTENSITY } from '../lut/lut-stack';
import { LOOK_STRENGTH, defaultLookStrength } from '../lut/look-strength';
import { familyForLookName, nodeLabelPath, visibleLooks, type LutPackIndex, type PackLook } from '../lut/lut-pack';
import { OUTPUT_TRANSFORM_OPTIONS, type OutputTransform } from '../lut/transfer';
import type { LutStack } from '../lut/use-lut-stack';
import { FILM_STOCKS, type FilmStockId } from '../film/stocks';
import type { HistogramReading } from './histogram';
import { DEFAULT_FIT, fitStrength, type FitLimits } from '../lut/fit-strength';

export interface LookHost {
  stack: () => LutStack;
  /** True, or why the look cannot be written now (no picture open). */
  available: () => true | string;
  /** Run a write so the roll journals it as an agent's. */
  asAgent: <T>(write: () => T | Promise<T>) => Promise<T>;
  /**
   * The open picture measured as the stage shows it NOW (`develop.measure`),
   * waiting for the stage to catch up — what `develop.fitLook` searches with.
   * Absent where nothing can measure.
   */
  measure?: () => Promise<HistogramReading>;
  /** The purchased packs and uploads this browser holds (`loadPacks`) — names and references only. */
  packs?: () => Promise<LutPackIndex[]>;
}

/** A pack as an agent reads it: names to choose by and the ids to add with, never a lattice. */
function packSummary(pack: LutPackIndex) {
  return {
    id: pack.id,
    name: pack.name,
    author: pack.author,
    looks: visibleLooks(pack).map((l) => ({
      id: l.id,
      name: [...nodeLabelPath(pack.tree, l.node), l.label].join(' · '),
      conversion: l.family === 'log',
    })),
  };
}

/** A name compared case and accents aside. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** The pack an agent named — its id, or its name — and the look in it: its id, or a part of its name no other look shares. */
export function findPackLook(packs: readonly LutPackIndex[], packAsked: string, lookAsked: string): { pack: LutPackIndex; look: PackLook } {
  const pack = packs.find((p) => p.id === packAsked) ?? packs.find((p) => fold(p.name) === fold(packAsked) || fold(p.author) === fold(packAsked));
  if (!pack) {
    throw new CommandError('invalid', packs.length ? `no pack "${packAsked}" — the packs are ${packs.map((p) => `"${p.name}" (${p.id})`).join(', ')}` : 'this browser holds no pack — import one from the look picker first');
  }
  const looks = visibleLooks(pack);
  const exact = looks.find((l) => l.id === lookAsked);
  if (exact) return { pack, look: exact };
  const want = fold(lookAsked);
  const named = (l: PackLook) => fold([...nodeLabelPath(pack.tree, l.node), l.label].join(' '));
  const same = looks.filter((l) => fold(l.label) === want);
  const hits = same.length ? same : looks.filter((l) => named(l).includes(want));
  if (hits.length === 1) return { pack, look: hits[0] };
  if (hits.length > 1) throw new CommandError('invalid', `"${lookAsked}" names ${hits.length} looks of ${pack.name} — ${hits.slice(0, 8).map((l) => `"${l.label}" (${l.id})`).join(', ')}; give its id`);
  throw new CommandError('invalid', `${pack.name} has no look "${lookAsked}" — develop.looks lists them`);
}

/** The stack as an agent reads it. */
export function lookSummary(stack: LutStack) {
  return {
    layers: stack.layers.map((l) => ({
      layer: l.id,
      name: l.name,
      source: l.source,
      intensity: l.intensity,
      enabled: l.enabled,
      ...(l.missing ? { missing: l.missing } : {}),
    })),
    output: stack.output,
    busy: stack.busy,
    ...(stack.error ? { error: stack.error } : {}),
  };
}

/** Resolve once the stack has finished fetching and baking, at most `capMs` later. */
async function settled(stack: () => LutStack, capMs = 15_000): Promise<void> {
  const start = Date.now();
  // A render first: an add sets `busy` on the NEXT render, not this one.
  await new Promise((r) => setTimeout(r, 30));
  while (stack().busy && Date.now() - start < capMs) await new Promise((r) => setTimeout(r, 50));
}

const INTENSITY = {
  type: 'number',
  description: `How strongly it lands: 1 is the look as made, 0 nothing, up to ${MAX_LAYER_INTENSITY}. A look is almost never right at 1 — it saturates and exaggerates; when absent, a creative look lands at ${LOOK_STRENGTH} and a log-to-Rec.709 conversion at 1. develop.fitLook finds the strength by measuring.`,
  min: 0,
  max: MAX_LAYER_INTENSITY,
  optional: true,
} as const;

export function lookCommands(host: LookHost): CommandSpec[] {
  const layerOf = (id: unknown) => {
    const layer = host.stack().layers.find((l) => l.id === id);
    if (!layer) throw new CommandError('invalid', `the look has no layer "${String(id)}" — develop.look lists them`);
    return layer;
  };
  return [
    {
      id: 'develop.looks',
      title: 'What looks there are',
      description:
        'The looks an agent can add — the built-in LUTs (id, name, group, whether it is a log-to-Rec.709 conversion), the film stocks (id, name, what it does), the person’s PURCHASED PACKS and uploads (each pack’s id, name, author and its looks: id, name with its folders, conversion) — and the output transforms. Answers the open picture’s look too.',
      run: async () => ({
        builtin: BUILTIN_LUTS.map((l) => ({ id: l.id, name: l.name, group: l.group, conversion: familyForLookName(l.name) === 'log' })),
        film: FILM_STOCKS.map((s) => ({ id: s.id, name: s.name, note: s.note })),
        packs: host.packs ? (await host.packs()).map(packSummary) : [],
        outputs: OUTPUT_TRANSFORM_OPTIONS.map((o) => ({ id: o.id, label: o.label, hint: o.hint })),
        current: host.available() === true ? lookSummary(host.stack()) : null,
      }),
    },
    {
      id: 'develop.look',
      title: 'Read the look',
      description: 'The open picture’s look: its layers in order (each with its layer id, intensity and whether it is on) and its output transform.',
      available: host.available,
      run: () => lookSummary(host.stack()),
    },
    {
      id: 'develop.addLook',
      title: 'Add a look',
      description:
        'Add a layer to the open picture’s look: a built-in LUT (builtin: an id from develop.looks — a conversion LUT for log footage first, then a creative one), a film stock (film: an id) or a look of the person’s purchased pack (pack + look). Layers apply in order, after the develop. A creative look lands DOSED (well under 100 %) unless intensity says otherwise; a conversion lands whole. Answers the look after.',
      params: {
        builtin: { type: 'string', description: 'A built-in LUT id.', optional: true },
        film: { type: 'string', description: 'A film stock id.', enum: FILM_STOCKS.map((s) => s.id), optional: true },
        pack: { type: 'string', description: 'A purchased pack (or "My looks", the uploads): its id, its name or its author, from develop.looks — with look.', optional: true },
        look: { type: 'string', description: 'With pack: the look’s id, or a part of its name no other look of the pack shares.', optional: true },
        intensity: INTENSITY,
      },
      available: host.available,
      run: (p) =>
        host.asAgent(async () => {
          const kinds = [p.builtin, p.film, p.pack].filter((x) => x !== undefined).length;
          if (kinds !== 1) throw new CommandError('invalid', 'give exactly one of "builtin", "film" or "pack" (with "look")');
          if ((p.pack === undefined) !== (p.look === undefined)) throw new CommandError('invalid', '"pack" and "look" go together');
          const given = typeof p.intensity === 'number' ? p.intensity : null;
          if (typeof p.pack === 'string') {
            if (!host.packs) throw new CommandError('unavailable', 'no pack can be read here');
            const { pack, look } = findPackLook(await host.packs(), p.pack, p.look as string);
            // The REFERENCE goes into the layer; the vault resolves the lattice.
            await host.stack().addPackLook({ pack: pack.id, look: look.id, hash: look.hash ?? '' }, undefined, given ?? defaultLookStrength(look.family));
          } else if (typeof p.builtin === 'string') {
            const lut = BUILTIN_LUTS.find((l) => l.id === p.builtin);
            if (!lut) throw new CommandError('invalid', `no built-in LUT "${p.builtin}" — develop.looks lists them`);
            await host.stack().addBuiltin(lut.id, given ?? defaultLookStrength(familyForLookName(lut.name)));
          } else {
            host.stack().addFilm(p.film as FilmStockId, given ?? defaultLookStrength('rec709'));
          }
          await settled(host.stack);
          return lookSummary(host.stack());
        }),
    },
    {
      id: 'develop.setLook',
      title: 'Change a look layer',
      description: 'Change one layer of the open picture’s look: its intensity, whether it is on, or its place in the order (move −1 earlier, 1 later).',
      params: {
        layer: { type: 'string', description: 'The layer id, from develop.look.' },
        intensity: INTENSITY,
        enabled: { type: 'boolean', description: 'On or off.', optional: true },
        move: { type: 'number', description: '−1 earlier, 1 later.', min: -1, max: 1, integer: true, optional: true },
      },
      available: host.available,
      run: (p) =>
        host.asAgent(async () => {
          const layer = layerOf(p.layer);
          if (typeof p.intensity === 'number') host.stack().setIntensity(layer.id, p.intensity);
          if (typeof p.enabled === 'boolean') host.stack().setEnabled(layer.id, p.enabled);
          if (p.move === 1 || p.move === -1) host.stack().move(layer.id, p.move);
          await settled(host.stack);
          return lookSummary(host.stack());
        }),
    },
    {
      id: 'develop.fitLook',
      title: 'Find how strongly a look may land',
      description: `MEASURE the strength a look layer can take before it oversaturates: the open picture is measured with the layer off, then at rising strengths (a ladder, then halving, about eight renders of the stage), and the answer is the strongest whose colour stays within limits of the look-off picture — mean chroma at most ${Math.round(DEFAULT_FIT.meanGain * 100)} % more, the vivid share at most ${DEFAULT_FIT.vividGain} more, colour against the gamut's wall at most ${DEFAULT_FIT.edgeGain} more, clipping at most ${DEFAULT_FIT.clipGain} more — and never past ceiling (${DEFAULT_FIT.ceiling} unless given: a look is almost never right at 1). Sets that strength (apply: false puts the layer back as it was), and answers every measure taken and why it stopped. A number is not taste: look at the result (develop.compare, develop.snapshot) and go lower by eye if it still reads loud.`,
      params: {
        layer: { type: 'string', description: 'The layer id, from develop.look; the only layer, or the last added, when absent.', optional: true },
        ceiling: { type: 'number', description: `The strongest it may answer; ${DEFAULT_FIT.ceiling} when absent.`, min: 0.05, max: MAX_LAYER_INTENSITY, optional: true },
        meanGain: { type: 'number', description: `How much more mean chroma than the look-off picture, as a share; ${DEFAULT_FIT.meanGain} when absent.`, min: 0, max: 3, optional: true },
        vividGain: { type: 'number', description: `How much more of the picture may be vivid, absolute; ${DEFAULT_FIT.vividGain} when absent.`, min: 0, max: 1, optional: true },
        edgeGain: { type: 'number', description: `How much more colour may sit against the gamut's wall, absolute; ${DEFAULT_FIT.edgeGain} when absent.`, min: 0, max: 1, optional: true },
        apply: { type: 'boolean', description: 'Set the strength found (the default), or put the layer back as it was.', optional: true },
      },
      available: () => {
        const open = host.available();
        if (open !== true) return open;
        if (!host.measure) return 'nothing here can measure the picture';
        return host.stack().layers.length ? true : 'the open picture wears no look — develop.addLook first';
      },
      run: (p) =>
        host.asAgent(async () => {
          const layers = host.stack().layers;
          const layer = p.layer === undefined ? layers[layers.length - 1] : layerOf(p.layer);
          const was = { intensity: layer.intensity, enabled: layer.enabled };
          if (!layer.enabled) host.stack().setEnabled(layer.id, true);
          const limits: FitLimits = {
            ceiling: typeof p.ceiling === 'number' ? p.ceiling : DEFAULT_FIT.ceiling,
            meanGain: typeof p.meanGain === 'number' ? p.meanGain : DEFAULT_FIT.meanGain,
            vividGain: typeof p.vividGain === 'number' ? p.vividGain : DEFAULT_FIT.vividGain,
            edgeGain: typeof p.edgeGain === 'number' ? p.edgeGain : DEFAULT_FIT.edgeGain,
            clipGain: DEFAULT_FIT.clipGain,
          };
          const measure = host.measure!;
          const fit = await fitStrength(async (strength) => {
            host.stack().setIntensity(layer.id, strength);
            await settled(host.stack);
            return measure();
          }, limits);
          const keep = p.apply !== false;
          host.stack().setIntensity(layer.id, keep ? fit.strength : was.intensity);
          if (!keep && !was.enabled) host.stack().setEnabled(layer.id, false);
          await settled(host.stack);
          return {
            layer: layer.id,
            name: layer.name,
            strength: fit.strength,
            applied: keep,
            ...(keep ? {} : { keptAt: was.intensity }),
            reason: fit.reason,
            lookOff: fit.base,
            measures: fit.steps,
          };
        }),
    },
    {
      id: 'develop.removeLook',
      title: 'Remove a look layer',
      description: 'Take one layer off the open picture’s look, or every layer with all: true.',
      params: {
        layer: { type: 'string', description: 'The layer id.', optional: true },
        all: { type: 'boolean', description: 'Every layer.', optional: true },
      },
      available: host.available,
      run: (p) =>
        host.asAgent(async () => {
          if (p.all === true) {
            for (const l of [...host.stack().layers]) host.stack().remove(l.id);
          } else {
            host.stack().remove(layerOf(p.layer).id);
          }
          await settled(host.stack);
          return lookSummary(host.stack());
        }),
    },
    {
      id: 'develop.lookOutput',
      title: 'Output transform',
      description: 'The transform after every look, for a Rec.709 conversion LUT shown on an sRGB screen: none, rec709-to-srgb, rec709-24-to-22, srgb-to-rec709.',
      params: { output: { type: 'string', description: 'The transform.', enum: OUTPUT_TRANSFORM_OPTIONS.map((o) => o.id) } },
      available: host.available,
      run: (p) =>
        host.asAgent(async () => {
          host.stack().setOutput(p.output as OutputTransform);
          await settled(host.stack);
          return lookSummary(host.stack());
        }),
    },
  ];
}
