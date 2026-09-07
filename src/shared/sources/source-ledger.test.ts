import { describe, expect, it } from 'vitest';
import { WinnowError } from './winnow/client';
import {
  countBySource,
  describeDocs,
  forgetWarning,
  healthFromAnswer,
  healthFromError,
  shortHost,
  shortHosts,
} from './source-ledger';

describe('healthFromError', () => {
  it('reads a 401 as "sign in there", not as a failure', () => {
    const h = healthFromError(new WinnowError('unauthenticated', 'nope', 401), 'w.example', 5);
    expect(h.state).toBe('signin');
    expect(h.reason).toContain('Sign in there');
    expect(h.checkedAt).toBe(5);
  });

  it('says a 403 is the account, not the browser', () => {
    const h = healthFromError(new WinnowError('forbidden', 'nope', 403), 'w.example');
    expect(h.state).toBe('signin');
    expect(h.reason).toContain('this account');
  });

  it('names the two plausible causes when nothing answered', () => {
    const h = healthFromError(new WinnowError('unreachable', 'offline'), 'w.example');
    expect(h.state).toBe('unreachable');
    expect(h.reason).toContain('offline');
    expect(h.reason).toContain('allowed list');
  });

  it('carries the message through for anything else', () => {
    const h = healthFromError(new WinnowError('protocol', 'bad json', 500), 'w.example');
    expect(h.state).toBe('unreachable');
    expect(h.reason).toContain('bad json');
  });

  it('handles a thrown non-Error', () => {
    const h = healthFromError('boom', 'w.example');
    expect(h.state).toBe('unreachable');
    expect(h.reason).toContain('w.example');
  });
});

describe('healthFromAnswer', () => {
  it('keeps the round trip so the row can show it', () => {
    expect(healthFromAnswer(240, 9)).toEqual({
      state: 'reachable',
      reason: null,
      latencyMs: 240,
      checkedAt: 9,
    });
  });
});

describe('countBySource', () => {
  it('counts projects and trips per source', () => {
    const counts = countBySource(
      [{ sourceId: 'local' }, { sourceId: 'w.example' }, { sourceId: 'w.example' }],
      [{ sourceId: 'w.example' }],
    );
    expect(counts.get('local')).toEqual({ projects: 1, trips: 0 });
    expect(counts.get('w.example')).toEqual({ projects: 2, trips: 1 });
  });

  it('files a document written before the field existed under this browser', () => {
    const counts = countBySource([{}], [{}]);
    expect(counts.get('local')).toEqual({ projects: 1, trips: 1 });
  });

  it('leaves a source nobody uses out of the map', () => {
    expect(countBySource([], []).size).toBe(0);
  });
});

describe('describeDocs', () => {
  it('never says zero', () => {
    expect(describeDocs({ projects: 0, trips: 0 })).toBe('nothing yet');
    expect(describeDocs({ projects: 2, trips: 0 })).toBe('2 projects');
    expect(describeDocs({ projects: 0, trips: 1 })).toBe('one trip');
    expect(describeDocs({ projects: 8, trips: 3 })).toBe('8 projects and 3 trips');
  });
});

describe('forgetWarning', () => {
  it('says what stays where', () => {
    const w = forgetWarning('w.example', { projects: 8, trips: 3 });
    expect(w).toContain('8 projects and 3 trips');
    expect(w).toContain('stay on the instance');
  });

  it('stays short when the instance holds nothing of ours', () => {
    expect(forgetWarning('w.example', { projects: 0, trips: 0 })).toContain('Nothing is deleted');
  });
});

describe('shortHost', () => {
  it('takes the first label', () => {
    expect(shortHost('winnow.steeve.website')).toBe('winnow');
    expect(shortHost('mika.dm-consulting.tech')).toBe('mika');
    expect(shortHost('winnow.example')).toBe('winnow');
  });

  it('keeps a port, which is what tells two local instances apart', () => {
    expect(shortHost('localhost:5174')).toBe('localhost:5174');
    expect(shortHost('winnow.localhost:3000')).toBe('winnow:3000');
  });

  it('leaves an IP address whole', () => {
    expect(shortHost('192.168.1.4')).toBe('192.168.1.4');
    expect(shortHost('192.168.1.4:3000')).toBe('192.168.1.4:3000');
  });

  it('skips a www', () => {
    expect(shortHost('www.winnow.example')).toBe('winnow');
  });
});

describe('shortHosts', () => {
  it('shortens what stays unambiguous', () => {
    const names = shortHosts(['winnow.steeve.website', 'mika.dm-consulting.tech']);
    expect(names.get('winnow.steeve.website')).toBe('winnow');
    expect(names.get('mika.dm-consulting.tech')).toBe('mika');
  });

  it('keeps both hosts long when their first labels collide', () => {
    const names = shortHosts(['winnow.a.tech', 'winnow.b.tech', 'mika.c.tech']);
    expect(names.get('winnow.a.tech')).toBe('winnow.a.tech');
    expect(names.get('winnow.b.tech')).toBe('winnow.b.tech');
    expect(names.get('mika.c.tech')).toBe('mika');
  });
});
