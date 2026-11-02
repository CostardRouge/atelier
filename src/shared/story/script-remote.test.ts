import { describe, expect, it } from 'vitest';
import { mintScriptId, readScriptSummary, scriptSummary, withScriptId } from './script-remote';
import { newScript, parseScript } from './story-script';

describe('script ids', () => {
  it('mints a URL-safe id once, and keeps it through a parse', () => {
    const s = withScriptId(newScript('Le tri'), () => 'story-abc');
    expect(s.id).toBe('story-abc');
    expect(withScriptId(s, () => 'other').id).toBe('story-abc');
    expect(mintScriptId(() => 'a/b c')).toBe('story-abc');
    const parsed = parseScript(JSON.parse(JSON.stringify(s)));
    expect(parsed.ok && parsed.script.id).toBe('story-abc');
    const bad = parseScript({ ...s, id: '../../x' });
    expect(bad.ok && bad.script.id).toBeUndefined();
  });
});

describe('scriptSummary', () => {
  it('says the series, its language, its posts and trip, and reads back', () => {
    const s = { ...newScript('Le tri', 'en'), posts: { ep00: {}, ep01: {} }, sources: { trip: { id: 't', name: 'Australia' } } };
    const sum = scriptSummary(s);
    expect(sum).toEqual({ series: 'Le tri', lang: 'en', posts: 2, trip: 'Australia' });
    expect(readScriptSummary(sum)).toEqual(sum);
    expect(readScriptSummary({ series: 3 })).toBeNull();
  });
});
