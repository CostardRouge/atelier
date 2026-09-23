import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COPYRIGHT_TEMPLATE,
  captureYear,
  deliveryXmp,
  escapeXml,
  readIdentity,
  resolveRights,
  xmpDescriptions,
} from './delivery-meta';

describe('captureYear', () => {
  it('reads the year the picture was TAKEN', () => {
    expect(captureYear('2024:11:02 07:12:00', 2026)).toBe(2024);
    expect(captureYear('2024-11-02T07:12:00', 2026)).toBe(2024);
  });
  it('falls back to the export’s year when nobody knows', () => {
    expect(captureYear(undefined, 2026)).toBe(2026);
    expect(captureYear('0000:00:00 00:00:00', 2026)).toBe(2026);
    expect(captureYear('garbage', 2026)).toBe(2026);
  });
});

describe('resolveRights', () => {
  it('fills the template with the year and the name', () => {
    expect(resolveRights({ creator: 'Steeve Pommier', copyright: DEFAULT_COPYRIGHT_TEMPLATE }, 2024)).toEqual({
      creator: 'Steeve Pommier',
      copyright: '© 2024 Steeve Pommier. All rights reserved.',
    });
  });
  it('writes nothing without a name — no line reads “© 2026 .”', () => {
    expect(resolveRights({ creator: ' ', copyright: DEFAULT_COPYRIGHT_TEMPLATE }, 2024)).toEqual({ creator: null, copyright: null });
    expect(resolveRights(null, 2024)).toEqual({ creator: null, copyright: null });
  });
  it('keeps a line the author wrote whole, placeholders or not', () => {
    expect(resolveRights({ creator: 'S', copyright: 'CC BY 4.0' }, 2024).copyright).toBe('CC BY 4.0');
    expect(resolveRights({ creator: 'S', copyright: '{year}–{year} {creator}' }, 2024).copyright).toBe('2024–2024 S');
  });
});

describe('readIdentity', () => {
  it('reads a stored identity, and the default template for an empty one', () => {
    expect(readIdentity({ creator: ' Steeve ', copyright: '' })).toEqual({ creator: 'Steeve', copyright: DEFAULT_COPYRIGHT_TEMPLATE });
    expect(readIdentity(null)).toEqual({ creator: '', copyright: DEFAULT_COPYRIGHT_TEMPLATE });
  });
});

describe('deliveryXmp', () => {
  it('always signs, and says the rest only where there is something to say', () => {
    const bare = deliveryXmp({});
    expect(bare).toContain('xmp:CreatorTool="Atelier"');
    expect(bare).not.toContain('dc:creator');
    expect(bare).not.toContain('xmpRights:Marked');
    const signed = deliveryXmp({ creator: 'A & B', copyright: '© 2024 <A>' });
    expect(signed).toContain('<rdf:li>A &amp; B</rdf:li>');
    expect(signed).toContain('<rdf:li xml:lang="x-default">© 2024 &lt;A&gt;</rdf:li>');
    expect(signed).toContain('xmpRights:Marked="True"');
  });
  it('hands its descriptions to a second writer verbatim', () => {
    const packet = deliveryXmp({ creator: 'S' });
    const inner = xmpDescriptions(packet);
    expect(inner.startsWith('<rdf:Description')).toBe(true);
    expect(inner.endsWith('</rdf:Description>')).toBe(true);
    expect(xmpDescriptions('not xmp')).toBe('');
  });
  it('escapes every character XML reserves', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
});
