/**
 * The COMMAND REGISTRY: everything an agent, a script or the console may do
 * in the suite, named once — an id, its parameters, whether it can run now and
 * what it does — and run through ONE door, `execute`.
 *
 * The idea is LightCraft's (`storytold/lightcraft`, `crates/engine`): every
 * gesture is a command with a stable id and JSON parameters, and the UI, a
 * script and an MCP client dispatch through the same entry point. Here the
 * UI keeps its own handlers; a command is registered BY THE SCREEN THAT CAN
 * DO IT, while it is mounted (`use-commands.ts`), and calls the very funnel a
 * gesture calls — so an agent's edit is journaled, undoable and saved exactly
 * like the author's, and a command whose screen is not open is simply absent.
 *
 * Parameters are a small typed subset (number with bounds, string with an
 * optional enum, boolean, free object, list of strings), checked here before
 * `run` sees them: an agent gets `invalid` with the field's name rather than a
 * NaN reaching a bake. Unknown fields are refused too — a misspelt key that
 * silently did nothing is the hardest failure for an agent to notice.
 *
 * Pure and DOM-free.
 */

/** One parameter's shape. */
export type ParamSpec =
  | { type: 'number'; description: string; min?: number; max?: number; integer?: boolean; optional?: boolean }
  | { type: 'string'; description: string; enum?: readonly string[]; optional?: boolean }
  | { type: 'boolean'; description: string; optional?: boolean }
  | { type: 'strings'; description: string; optional?: boolean }
  /**
   * A non-empty list of numbers, each checked like a `number` — the dialect
   * Winnow's registry shares (`ids` of a batch), `maxItems` capping a call.
   */
  | { type: 'numbers'; description: string; min?: number; max?: number; integer?: boolean; maxItems?: number; optional?: boolean }
  | { type: 'array'; description: string; optional?: boolean }
  | { type: 'object'; description: string; optional?: boolean };

export type ParamSpecs = Readonly<Record<string, ParamSpec>>;

/** What a command may answer with besides plain JSON: a picture to LOOK at. */
export interface ImageResult {
  kind: 'image';
  mimeType: 'image/jpeg' | 'image/png';
  /** Base64, no `data:` prefix. */
  data: string;
  width: number;
  height: number;
  /** What the picture is — said beside it to the agent. */
  note?: string;
}

export interface CommandSpec {
  /** Dotted and stable: `develop.set`, `app.navigate`. A script outlives a label. */
  id: string;
  /** A few words for a person. */
  title: string;
  /** What it does and what it answers, for the agent choosing it. */
  description: string;
  params?: ParamSpecs;
  /** `true` when it can run now, else the reason it cannot. Absent = always. */
  available?: () => true | string;
  run: (params: Record<string, unknown>) => unknown;
}

/** A command as listed: no function, everything an agent needs to call it. */
export interface CommandInfo {
  id: string;
  title: string;
  description: string;
  params: ParamSpecs;
  available: boolean;
  /** Why not, when not. */
  reason?: string;
}

export type CommandErrorCode = 'unknown' | 'unavailable' | 'invalid' | 'failed';

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}

export interface CommandRegistry {
  /**
   * Register `specs` under `owner` — a screen's name, for the logs — and
   * answer the function that takes them back. Two owners may register the
   * same id: the LATEST wins while it lives, and the earlier one comes back
   * when it leaves (a modal over a tool, a remount).
   */
  register: (owner: string, specs: readonly CommandSpec[]) => () => void;
  list: () => CommandInfo[];
  /** Check the parameters, then run. Rejects with a `CommandError`. */
  execute: (id: string, params?: unknown) => Promise<unknown>;
  /** Told whenever the set of commands changes. */
  subscribe: (listener: () => void) => () => void;
}

interface Entry {
  owner: string;
  spec: CommandSpec;
  token: object;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The parameters as `run` receives them: every declared field checked, a
 * number out of its bounds REFUSED rather than clamped (an agent asking for
 * exposure 9 should hear that the range ends at 3), unknown fields refused.
 * Throws `CommandError('invalid')` naming the field.
 */
export function checkParams(specs: ParamSpecs | undefined, raw: unknown): Record<string, unknown> {
  const given = raw === undefined || raw === null ? {} : raw;
  if (!isRecord(given)) throw new CommandError('invalid', 'params must be an object');
  const declared = specs ?? {};
  for (const key of Object.keys(given)) {
    if (!(key in declared)) {
      const known = Object.keys(declared);
      throw new CommandError(
        'invalid',
        `unknown parameter "${key}"${known.length ? ` — this command takes ${known.join(', ')}` : ' — this command takes none'}`,
      );
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(declared)) {
    const v = given[key];
    if (v === undefined || v === null) {
      if (!spec.optional) throw new CommandError('invalid', `missing parameter "${key}"`);
      continue;
    }
    switch (spec.type) {
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new CommandError('invalid', `"${key}" must be a finite number`);
        if (spec.integer && !Number.isInteger(v)) throw new CommandError('invalid', `"${key}" must be a whole number`);
        if (spec.min !== undefined && v < spec.min) throw new CommandError('invalid', `"${key}" is ${v}, below its minimum ${spec.min}`);
        if (spec.max !== undefined && v > spec.max) throw new CommandError('invalid', `"${key}" is ${v}, above its maximum ${spec.max}`);
        break;
      case 'string':
        if (typeof v !== 'string') throw new CommandError('invalid', `"${key}" must be a string`);
        if (spec.enum && !spec.enum.includes(v)) {
          throw new CommandError('invalid', `"${key}" is "${v}" — one of ${spec.enum.map((e) => `"${e}"`).join(', ')}`);
        }
        break;
      case 'boolean':
        if (typeof v !== 'boolean') throw new CommandError('invalid', `"${key}" must be true or false`);
        break;
      case 'strings':
        if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
          throw new CommandError('invalid', `"${key}" must be a list of strings`);
        }
        break;
      case 'numbers': {
        if (!Array.isArray(v) || v.length === 0) throw new CommandError('invalid', `"${key}" must be a non-empty list of numbers`);
        if (spec.maxItems !== undefined && v.length > spec.maxItems) {
          throw new CommandError('invalid', `"${key}" holds ${v.length} items — ${spec.maxItems} at most a call`);
        }
        v.forEach((n: unknown, i) => {
          const at = `${key}[${i}]`;
          if (typeof n !== 'number' || !Number.isFinite(n)) throw new CommandError('invalid', `"${at}" must be a finite number`);
          if (spec.integer && !Number.isInteger(n)) throw new CommandError('invalid', `"${at}" must be a whole number`);
          if (spec.min !== undefined && n < spec.min) throw new CommandError('invalid', `"${at}" is ${n}, below its minimum ${spec.min}`);
          if (spec.max !== undefined && n > spec.max) throw new CommandError('invalid', `"${at}" is ${n}, above its maximum ${spec.max}`);
        });
        break;
      }
      case 'array':
        if (!Array.isArray(v)) throw new CommandError('invalid', `"${key}" must be a list`);
        break;
      case 'object':
        if (!isRecord(v)) throw new CommandError('invalid', `"${key}" must be an object`);
        break;
    }
    out[key] = v;
  }
  return out;
}

/**
 * The parameters as a JSON Schema object — what an MCP client is handed as a
 * tool's input schema, and what `develop.controls`-style answers point at.
 */
export function paramsJsonSchema(specs: ParamSpecs | undefined): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(specs ?? {})) {
    let prop: Record<string, unknown>;
    switch (spec.type) {
      case 'number':
        prop = {
          type: spec.integer ? 'integer' : 'number',
          ...(spec.min !== undefined ? { minimum: spec.min } : {}),
          ...(spec.max !== undefined ? { maximum: spec.max } : {}),
        };
        break;
      case 'string':
        prop = { type: 'string', ...(spec.enum ? { enum: [...spec.enum] } : {}) };
        break;
      case 'boolean':
        prop = { type: 'boolean' };
        break;
      case 'strings':
        prop = { type: 'array', items: { type: 'string' } };
        break;
      case 'numbers':
        prop = {
          type: 'array',
          minItems: 1,
          ...(spec.maxItems !== undefined ? { maxItems: spec.maxItems } : {}),
          items: {
            type: spec.integer ? 'integer' : 'number',
            ...(spec.min !== undefined ? { minimum: spec.min } : {}),
            ...(spec.max !== undefined ? { maximum: spec.max } : {}),
          },
        };
        break;
      case 'array':
        prop = { type: 'array' };
        break;
      case 'object':
        prop = { type: 'object' };
        break;
    }
    properties[key] = { ...prop, description: spec.description };
    if (!spec.optional) required.push(key);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function availability(spec: CommandSpec): true | string {
  try {
    return spec.available ? spec.available() : true;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function createCommandRegistry(): CommandRegistry {
  // Per id, the registrations in the order they came: the last one is live.
  const byId = new Map<string, Entry[]>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of [...listeners]) l();
  };

  function live(id: string): Entry | null {
    const stack = byId.get(id);
    return stack && stack.length ? stack[stack.length - 1] : null;
  }

  return {
    register(owner, specs) {
      const token = {};
      for (const spec of specs) {
        const stack = byId.get(spec.id) ?? [];
        stack.push({ owner, spec, token });
        byId.set(spec.id, stack);
      }
      changed();
      return () => {
        for (const spec of specs) {
          const stack = byId.get(spec.id);
          if (!stack) continue;
          const i = stack.findIndex((e) => e.token === token);
          if (i >= 0) stack.splice(i, 1);
          if (stack.length === 0) byId.delete(spec.id);
        }
        changed();
      };
    },

    list() {
      return [...byId.keys()]
        .sort()
        .flatMap((id) => {
          const e = live(id);
          if (!e) return [];
          const a = availability(e.spec);
          const info: CommandInfo = {
            id,
            title: e.spec.title,
            description: e.spec.description,
            params: e.spec.params ?? {},
            available: a === true,
          };
          if (a !== true) info.reason = a;
          return [info];
        });
    },

    async execute(id, raw) {
      const e = live(id);
      if (!e) {
        const near = [...byId.keys()].filter((k) => k.split('.')[0] === id.split('.')[0]);
        throw new CommandError(
          'unknown',
          `no command "${id}" is open right now${near.length ? ` — open ones in that group: ${near.sort().join(', ')}` : ''}`,
        );
      }
      const a = availability(e.spec);
      if (a !== true) throw new CommandError('unavailable', a);
      const params = checkParams(e.spec.params, raw);
      try {
        return await e.spec.run(params);
      } catch (err) {
        if (err instanceof CommandError) throw err;
        throw new CommandError('failed', err instanceof Error ? err.message : String(err));
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Resolve once `id` is registered AND available, or reject after `timeoutMs`
 * with what stood in the way. What an agent needs after a navigation: a tool
 * is a chunk, a roll is read from IndexedDB, a picture decodes — the command
 * it wants next appears some time later, and polling it from outside costs a
 * round trip per try. Availability can change without the list changing (a
 * picture finishing its decode), so it is re-read on a short tick as well as
 * on every change.
 */
export function waitForCommand(registry: CommandRegistry, id: string, timeoutMs: number, tickMs = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const check = () => {
      if (done) return;
      const info = registry.list().find((c) => c.id === id);
      if (info?.available) finish(null);
    };
    const finish = (err: CommandError | null) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearInterval(tick);
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const unsubscribe = registry.subscribe(check);
    const tick = setInterval(check, tickMs);
    const timer = setTimeout(() => {
      const info = registry.list().find((c) => c.id === id);
      finish(
        new CommandError(
          info ? 'unavailable' : 'unknown',
          info
            ? `"${id}" is open but still unavailable after ${timeoutMs} ms: ${info.reason ?? 'no reason given'}`
            : `"${id}" did not appear within ${timeoutMs} ms`,
        ),
      );
    }, timeoutMs);
    check();
  });
}

/** The suite's one registry. Tests make their own with `createCommandRegistry`. */
export const commands: CommandRegistry = createCommandRegistry();
