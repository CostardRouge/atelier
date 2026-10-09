import { describe, expect, it } from 'vitest';
import { CommandError, checkParams, createCommandRegistry, paramsJsonSchema, waitForCommand, type CommandSpec } from './registry';

const echo: CommandSpec = {
  id: 'test.echo',
  title: 'Echo',
  description: 'Answers its params.',
  params: {
    n: { type: 'number', description: 'a number', min: -3, max: 3 },
    word: { type: 'string', description: 'a word', enum: ['a', 'b'], optional: true },
  },
  run: (p) => p,
};

async function rejection(p: Promise<unknown>): Promise<CommandError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof CommandError) return err;
    throw err;
  }
  throw new Error('expected a rejection');
}

describe('checkParams', () => {
  it('passes declared fields and drops nothing', () => {
    expect(checkParams(echo.params, { n: 1.5, word: 'a' })).toEqual({ n: 1.5, word: 'a' });
  });

  it('treats null and undefined params as none', () => {
    expect(checkParams(undefined, null)).toEqual({});
    expect(checkParams(undefined, undefined)).toEqual({});
  });

  it('refuses an out-of-range number rather than clamping it', () => {
    expect(() => checkParams(echo.params, { n: 9 })).toThrow(/above its maximum 3/);
    expect(() => checkParams(echo.params, { n: -4 })).toThrow(/below its minimum -3/);
  });

  it('refuses a non-finite number, a wrong enum and a missing field', () => {
    expect(() => checkParams(echo.params, { n: Number.NaN })).toThrow(/finite/);
    expect(() => checkParams(echo.params, { n: 0, word: 'c' })).toThrow(/one of "a", "b"/);
    expect(() => checkParams(echo.params, {})).toThrow(/missing parameter "n"/);
  });

  it('refuses an unknown field and names the known ones', () => {
    expect(() => checkParams(echo.params, { n: 0, exposure: 1 })).toThrow(/unknown parameter "exposure" — this command takes n, word/);
    expect(() => checkParams(undefined, { x: 1 })).toThrow(/takes none/);
  });

  it('checks integers, booleans, string lists and objects', () => {
    const specs = {
      i: { type: 'number', description: '', integer: true },
      b: { type: 'boolean', description: '' },
      s: { type: 'strings', description: '' },
      o: { type: 'object', description: '' },
    } as const;
    expect(checkParams(specs, { i: 2, b: false, s: ['x'], o: { k: 1 } })).toEqual({ i: 2, b: false, s: ['x'], o: { k: 1 } });
    expect(() => checkParams(specs, { i: 2.5, b: false, s: [], o: {} })).toThrow(/whole number/);
    expect(() => checkParams(specs, { i: 2, b: 'no', s: [], o: {} })).toThrow(/true or false/);
    expect(() => checkParams(specs, { i: 2, b: true, s: [1], o: {} })).toThrow(/list of strings/);
    expect(() => checkParams(specs, { i: 2, b: true, s: [], o: [] })).toThrow(/must be an object/);
  });

  it('refuses params that are not an object', () => {
    expect(() => checkParams(echo.params, [1])).toThrow(/params must be an object/);
  });
});

describe('paramsJsonSchema', () => {
  it('writes the bounds, the enum and what is required', () => {
    expect(paramsJsonSchema(echo.params)).toEqual({
      type: 'object',
      properties: {
        n: { type: 'number', minimum: -3, maximum: 3, description: 'a number' },
        word: { type: 'string', enum: ['a', 'b'], description: 'a word' },
      },
      required: ['n'],
      additionalProperties: false,
    });
  });

  it('describes a command with no params as an empty object', () => {
    expect(paramsJsonSchema(undefined)).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });
});

describe('the registry', () => {
  it('runs a registered command with checked params', async () => {
    const reg = createCommandRegistry();
    reg.register('test', [echo]);
    await expect(reg.execute('test.echo', { n: 2 })).resolves.toEqual({ n: 2 });
  });

  it('answers unknown with the open commands of the same group', async () => {
    const reg = createCommandRegistry();
    reg.register('test', [echo]);
    const err = await rejection(reg.execute('test.nope'));
    expect(err.code).toBe('unknown');
    expect(err.message).toMatch(/open ones in that group: test.echo/);
  });

  it('refuses an unavailable command with its reason, and lists it as such', async () => {
    const reg = createCommandRegistry();
    reg.register('test', [{ ...echo, available: () => 'no picture is open' }]);
    const err = await rejection(reg.execute('test.echo', { n: 0 }));
    expect(err.code).toBe('unavailable');
    expect(err.message).toBe('no picture is open');
    expect(reg.list()[0]).toMatchObject({ id: 'test.echo', available: false, reason: 'no picture is open' });
  });

  it('wraps a throw from run as failed, and keeps a CommandError as it is', async () => {
    const reg = createCommandRegistry();
    reg.register('test', [
      { id: 'test.boom', title: '', description: '', run: () => Promise.reject(new Error('bang')) },
      {
        id: 'test.own',
        title: '',
        description: '',
        run: () => {
          throw new CommandError('invalid', 'no such picture');
        },
      },
    ]);
    const boom = await rejection(reg.execute('test.boom'));
    expect([boom.code, boom.message]).toEqual(['failed', 'bang']);
    const own = await rejection(reg.execute('test.own'));
    expect([own.code, own.message]).toEqual(['invalid', 'no such picture']);
  });

  it('lets the latest owner of an id win, and gives it back when that owner leaves', async () => {
    const reg = createCommandRegistry();
    reg.register('tool', [{ ...echo, run: () => 'tool' }]);
    const off = reg.register('modal', [{ ...echo, run: () => 'modal' }]);
    await expect(reg.execute('test.echo', { n: 0 })).resolves.toBe('modal');
    off();
    await expect(reg.execute('test.echo', { n: 0 })).resolves.toBe('tool');
  });

  it('removes a command when its only owner leaves, and tells subscribers', () => {
    const reg = createCommandRegistry();
    let told = 0;
    reg.subscribe(() => told++);
    const off = reg.register('test', [echo]);
    expect(reg.list().map((c) => c.id)).toEqual(['test.echo']);
    off();
    expect(reg.list()).toEqual([]);
    expect(told).toBe(2);
  });

  it('lists commands sorted by id', () => {
    const reg = createCommandRegistry();
    reg.register('test', [{ ...echo, id: 'b.x' }, { ...echo, id: 'a.y' }]);
    expect(reg.list().map((c) => c.id)).toEqual(['a.y', 'b.x']);
  });
});

describe('waitForCommand', () => {
  it('resolves at once for an open, available command', async () => {
    const reg = createCommandRegistry();
    reg.register('test', [echo]);
    await expect(waitForCommand(reg, 'test.echo', 50)).resolves.toBeUndefined();
  });

  it('resolves when the command is registered later', async () => {
    const reg = createCommandRegistry();
    setTimeout(() => reg.register('test', [echo]), 10);
    await expect(waitForCommand(reg, 'test.echo', 500)).resolves.toBeUndefined();
  });

  it('resolves when an open command becomes available, with no change to the list', async () => {
    const reg = createCommandRegistry();
    let ready = false;
    reg.register('test', [{ ...echo, available: () => (ready ? true : 'decoding') }]);
    setTimeout(() => (ready = true), 20);
    await expect(waitForCommand(reg, 'test.echo', 500, 5)).resolves.toBeUndefined();
  });

  it('rejects with the reason when it never becomes available', async () => {
    const reg = createCommandRegistry();
    reg.register('test', [{ ...echo, available: () => 'decoding' }]);
    const err = await rejection(waitForCommand(reg, 'test.echo', 30, 5));
    expect(err.code).toBe('unavailable');
    expect(err.message).toMatch(/still unavailable after 30 ms: decoding/);
  });

  it('rejects as unknown when it never appears', async () => {
    const err = await rejection(waitForCommand(createCommandRegistry(), 'test.echo', 20));
    expect(err.code).toBe('unknown');
  });
});
