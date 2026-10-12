/**
 * SORTING a listing (`shared/commands/`): what each thumbnail says, the
 * bursts and near-twins, the technical misses — proposals the agent looks at
 * and acts on in Winnow; nothing here writes. The measures are
 * `media/thumb-metrics.ts`, taken once per session (`thumb-analysis.ts`);
 * the grouping and the flags are `duplicates.ts` and `misses.ts`, pure.
 */

import type { CommandSpec } from '../../commands/registry';
import { instantOf } from './capture-moment';
import { cullingFromRow } from './culling';
import { DEFAULT_GAP_SECONDS, DEFAULT_MAX_DISTANCE, findDuplicates, type DupItem } from './duplicates';
import { MISS_DEFAULTS, findMisses } from './misses';
import { ANALYSE_MAX } from './thumb-analysis';
import { ASSET_QUERY_PARAMS, IDS_PARAM, rowSummary, winnowHost, type WinnowCommandDeps } from './winnow-commands';

export function winnowSortCommands(deps: Pick<WinnowCommandDeps, 'winnow'>): CommandSpec[] {
  const { connected, rowsFor, measured } = winnowHost(deps);
  return [
    {
      id: 'winnow.analyse',
      title: 'Measure thumbnails',
      description:
        `What each frame’s THUMBNAIL says (a sample, ~128 px, not the file): sharpness (the variance of a Laplacian — relative, it ranks a burst and tells a blur from its twin), exposure (mean, 1st / 50th / 99th percentile luminance 0–255, clipped and crushed shares), colour (the dominant hue family, each family’s share, a mean hex, a warmth −1 cool..1 warm, how much of the frame carries colour) and a 64-bit hash (near for two frames of one burst). By ids, or the same listing as winnow.assets; ${ANALYSE_MAX} rows at most, measured once per session.`,
      params: {
        ids: IDS_PARAM,
        ...ASSET_QUERY_PARAMS,
      },
      available: connected,
      run: async (p) => {
        const rows = await rowsFor(p);
        const { sample, metrics, cut } = await measured(rows);
        return {
          asked: rows.length,
          measured: metrics.size,
          ...(cut ? { warning: `only the first ${ANALYSE_MAX} were measured — narrow the ask` } : {}),
          rows: sample.map((r) => {
            const m = metrics.get(r.id);
            return { id: r.id, file: r.filename, ...(m ? { sharpness: m.sharpness, exposure: m.exposure, colour: m.colour, hash: m.hash } : { unreadable: true }) };
          }),
        };
      },
    },
    {
      id: 'winnow.duplicates',
      title: 'Bursts and near-twins',
      description:
        `Frames of a listing that repeat each other, grouped: a BURST (shot within gapSeconds on one body) or TWINS (thumbnails within maxDistance bits, shot within half an hour), with the one to KEEP — Winnow’s own pick or stars first, else the sharpest; null when nothing tells them apart. A proposal to look at (winnow.sheet {ids}) and act on in Winnow, never a write. By ids, or the same listing as winnow.assets; ${ANALYSE_MAX} rows at most.`,
      params: {
        ids: IDS_PARAM,
        ...ASSET_QUERY_PARAMS,
        gapSeconds: { type: 'number', description: `Frames this close on one body are a burst; ${DEFAULT_GAP_SECONDS} when absent.`, min: 0.1, max: 600, optional: true },
        maxDistance: { type: 'number', description: `Hashes this close (bits, 0–64) are twins; ${DEFAULT_MAX_DISTANCE} when absent.`, min: 0, max: 64, integer: true, optional: true },
      },
      available: connected,
      run: async (p) => {
        const rows = await rowsFor(p);
        const { sample, metrics, cut } = await measured(rows);
        const byId = new Map(sample.map((r) => [r.id, r]));
        const items: DupItem[] = sample.map((r) => {
          const c = cullingFromRow(r);
          const at = instantOf(r) ?? (r.captured_at ? Date.parse(r.captured_at) : NaN);
          return {
            id: r.id,
            at: Number.isFinite(at) ? at : null,
            camera: r.camera_model,
            hash: metrics.get(r.id)?.hash ?? null,
            sharpness: metrics.get(r.id)?.sharpness ?? null,
            verdict: c?.verdict ?? 'unrated',
            stars: c?.star ?? 0,
          };
        });
        const groups = findDuplicates(items, {
          ...(typeof p.gapSeconds === 'number' ? { gapSeconds: p.gapSeconds } : {}),
          ...(typeof p.maxDistance === 'number' ? { maxDistance: p.maxDistance } : {}),
        });
        return {
          looked: sample.length,
          ...(cut ? { warning: `only the first ${ANALYSE_MAX} were looked at — narrow the ask` } : {}),
          groups: groups.map((g) => ({
            ...g,
            members: g.ids.map((id) => {
              const r = byId.get(id)!;
              const s = rowSummary(r);
              return { id, file: s.file, at: s.at, verdict: s.verdict, stars: s.stars, sharpness: metrics.get(id)?.sharpness ?? null };
            }),
          })),
          dropIfKept: groups.flatMap((g) => (g.keep === null ? [] : g.ids.filter((id) => id !== g.keep))),
        };
      },
    },
    {
      id: 'winnow.misses',
      title: 'Technical misses',
      description:
        `Frames of a listing whose thumbnail says blur (sharpness far under the batch’s median, and under a floor), too dark, too bright, highlights clipped or shadows crushed — each with the number behind it. A proposal: a night frame is dark on purpose, and only the person knows; nothing is rejected here. By ids, or the same listing as winnow.assets; ${ANALYSE_MAX} rows at most.`,
      params: {
        ids: IDS_PARAM,
        ...ASSET_QUERY_PARAMS,
        blurShare: { type: 'number', description: `Blur is sharpness under this share of the batch’s median; ${MISS_DEFAULTS.blurShare} when absent.`, min: 0.05, max: 1, optional: true },
      },
      available: connected,
      run: async (p) => {
        const rows = await rowsFor(p);
        const { sample, metrics, cut } = await measured(rows);
        const { misses, medianSharpness } = findMisses(
          sample.map((r) => ({ id: r.id, metrics: metrics.get(r.id) ?? null })),
          typeof p.blurShare === 'number' ? { blurShare: p.blurShare } : {},
        );
        const byId = new Map(sample.map((r) => [r.id, r]));
        return {
          looked: sample.length,
          measured: metrics.size,
          medianSharpness,
          ...(cut ? { warning: `only the first ${ANALYSE_MAX} were looked at — narrow the ask` } : {}),
          misses: misses.map((m) => ({ id: m.id, file: byId.get(m.id)?.filename ?? null, flags: m.flags })),
        };
      },
    },
  ];
}
