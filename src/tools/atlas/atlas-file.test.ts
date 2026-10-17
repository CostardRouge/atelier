import { describe, expect, it } from 'vitest';
import { createAtlasDoc, flightIdOf, withFlights } from './atlas-doc';
import { atlasFileName, base64ToBytes, bytesToBase64, parseAtlasFile, serializeAtlasFile, sha256Hex, toAtlasFile } from './atlas-file';

async function atlasWith(texts: string[]) {
  const logs = new Map<string, string>();
  const refs = [];
  for (const [i, text] of texts.entries()) {
    const h = await sha256Hex(text);
    logs.set(h, text);
    refs.push({ id: flightIdOf(h), name: `F${i}`, log: h, size: text.length });
  }
  return { doc: withFlights(createAtlasDoc('Perth', 'local'), refs), logs };
}

describe('the atlas file', () => {
  it('round-trips an atlas with its logs, under a new id', async () => {
    const { doc, logs } = await atlasWith(['1\n00:00:00,000 --> a', '2\n00:00:01,000 --> b']);
    const text = serializeAtlasFile(toAtlasFile([doc], logs));
    const parsed = await parseAtlasFile(text, 'local');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [back] = parsed.file.atlases;
    expect(back.id).not.toBe(doc.id);
    expect(back.flights).toEqual(doc.flights);
    expect(parsed.file.logs).toEqual(logs);
    expect(parsed.file.rejected).toBe(0);
  });

  it('drops a log whose text does not match the hash its flight names', async () => {
    const { doc, logs } = await atlasWith(['real']);
    const file = toAtlasFile([doc], logs);
    file.logs[doc.flights[0].log] = 'tampered';
    const parsed = await parseAtlasFile(JSON.stringify(file), 'local');
    expect(parsed.ok && parsed.file.logs.size).toBe(0);
    expect(parsed.ok && parsed.file.rejected).toBe(1);
  });

  it('refuses what is not an atlas file, or a newer one', async () => {
    expect((await parseAtlasFile('nope', 'local')).ok).toBe(false);
    expect((await parseAtlasFile('{"kind":"other"}', 'local')).ok).toBe(false);
    expect((await parseAtlasFile('{"kind":"atelier/flight-atlas","version":99}', 'local')).ok).toBe(false);
  });

  it('names files after the atlas, and carries bytes in base64', () => {
    expect(atlasFileName('Western Australia — été')).toBe('western-australia-ete.atlas.json');
    const bytes = new Uint8Array([0, 1, 254, 255]).buffer;
    expect(new Uint8Array(base64ToBytes(bytesToBase64(bytes)))).toEqual(new Uint8Array(bytes));
  });
});
