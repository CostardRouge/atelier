/**
 * Develop's LOOK commands (`shared/commands/`): the open picture's look — the
 * built-in LUTs, the film stocks, the output transform — through the very
 * stack the Look tab drives (`useRollGrade` over `useLutStack`), so a look an
 * agent adds is baked, saved and undone like a click on a tile.
 *
 * The stack follows the OPEN picture, so these act on it alone; to dress a
 * roll, set the look on one picture and `develop.applyTo` it with the `look`
 * section. A purchased pack's look and an uploaded `.cube` stay with the
 * person: they live in a vault an agent should not reach into.
 *
 * DOM-free: the stack is handed in through a getter, read fresh at every step
 * since it is a new object every render.
 */

import { CommandError, type CommandSpec } from '../commands/registry';
import { BUILTIN_LUTS } from '../lut/builtin-luts';
import { MAX_LAYER_INTENSITY } from '../lut/lut-stack';
import { OUTPUT_TRANSFORM_OPTIONS, type OutputTransform } from '../lut/transfer';
import type { LutStack } from '../lut/use-lut-stack';
import { FILM_STOCKS, type FilmStockId } from '../film/stocks';

export interface LookHost {
  stack: () => LutStack;
  /** True, or why the look cannot be written now (no picture open). */
  available: () => true | string;
  /** Run a write so the roll journals it as an agent's. */
  asAgent: <T>(write: () => T | Promise<T>) => Promise<T>;
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
  description: `How strongly it lands: 1 is the look as made, 0 nothing, up to ${MAX_LAYER_INTENSITY}.`,
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
        'The looks an agent can add — the built-in LUTs (id, name, group) and the film stocks (id, name, what it does) — and the output transforms. Answers the open picture’s look too.',
      run: () => ({
        builtin: BUILTIN_LUTS.map((l) => ({ id: l.id, name: l.name, group: l.group })),
        film: FILM_STOCKS.map((s) => ({ id: s.id, name: s.name, note: s.note })),
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
        'Add a layer to the open picture’s look: a built-in LUT (builtin: an id from develop.looks — a conversion LUT for log footage first, then a creative one) or a film stock (film: an id). Layers apply in order, after the develop. Answers the look after.',
      params: {
        builtin: { type: 'string', description: 'A built-in LUT id.', optional: true },
        film: { type: 'string', description: 'A film stock id.', enum: FILM_STOCKS.map((s) => s.id), optional: true },
        intensity: INTENSITY,
      },
      available: host.available,
      run: (p) =>
        host.asAgent(async () => {
          if ((p.builtin === undefined) === (p.film === undefined)) throw new CommandError('invalid', 'give exactly one of "builtin" or "film"');
          const intensity = typeof p.intensity === 'number' ? p.intensity : 1;
          if (typeof p.builtin === 'string') {
            if (!BUILTIN_LUTS.some((l) => l.id === p.builtin)) {
              throw new CommandError('invalid', `no built-in LUT "${p.builtin}" — develop.looks lists them`);
            }
            await host.stack().addBuiltin(p.builtin, intensity);
          } else {
            host.stack().addFilm(p.film as FilmStockId, intensity);
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
