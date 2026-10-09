import { describe, expect, it } from 'vitest';
import { UNIQUE_DOC_NAME_LIMIT, nameKey, stripCloneSuffix, uniqueDocName } from './doc-name';

describe('uniqueDocName', () => {
  it('keeps a name nothing carries — cloning onto another source needs no suffix', () => {
    expect(uniqueDocName('Australia', ['Écosse'])).toBe('Australia');
    expect(uniqueDocName('Australia', [])).toBe('Australia');
  });

  it('numbers a taken name from 2, in parentheses', () => {
    expect(uniqueDocName('Maroc', ['Maroc'])).toBe('Maroc (2)');
  });

  it('takes the first free number, reusing a gap a deletion left', () => {
    expect(uniqueDocName('Maroc', ['Maroc', 'Maroc (2)', 'Maroc (4)'])).toBe('Maroc (3)');
    expect(uniqueDocName('Maroc', ['Maroc', 'Maroc (3)'])).toBe('Maroc (2)');
  });

  it('strips a clone suffix the name already wears before counting', () => {
    expect(uniqueDocName('Maroc (2)', ['Maroc', 'Maroc (2)'])).toBe('Maroc (3)');
    expect(uniqueDocName('Maroc (7)', ['Maroc', 'Maroc (7)'])).toBe('Maroc (2)');
  });

  it('keeps a name whose own suffix is free — a typed name is not rewritten', () => {
    expect(uniqueDocName('Maroc (5)', ['Maroc', 'Maroc (2)'])).toBe('Maroc (5)');
  });

  it('never mistakes a trailing number for a clone marker', () => {
    expect(uniqueDocName('Route 66', ['Route 66'])).toBe('Route 66 (2)');
    expect(uniqueDocName('Route 66 (2)', ['Route 66', 'Route 66 (2)'])).toBe('Route 66 (3)');
    expect(uniqueDocName('Route', ['Route 66'])).toBe('Route');
  });

  it('compares without case or edge spaces, like the exported files', () => {
    expect(uniqueDocName('maroc', ['Maroc'])).toBe('maroc (2)');
    expect(uniqueDocName('  Maroc ', ['Maroc'])).toBe('Maroc (2)');
    expect(uniqueDocName('Maroc (2)', ['maroc', ' MAROC (2) '])).toBe('Maroc (3)');
  });

  it('trims what it keeps and leaves an empty name empty', () => {
    expect(uniqueDocName('  Cap Nord ', [])).toBe('Cap Nord');
    expect(uniqueDocName('   ', ['Maroc'])).toBe('');
  });

  it('accepts any iterable of taken names', () => {
    expect(uniqueDocName('Maroc', new Set(['Maroc']))).toBe('Maroc (2)');
  });

  it('refuses to loop past the limit', () => {
    const taken = ['Maroc', ...Array.from({ length: UNIQUE_DOC_NAME_LIMIT }, (_, i) => `Maroc (${i + 2})`)];
    expect(() => uniqueDocName('Maroc', taken)).toThrow(/already/);
  });
});

describe('stripCloneSuffix and nameKey', () => {
  it('strips only a trailing parenthesised number', () => {
    expect(stripCloneSuffix('Maroc (12)')).toBe('Maroc');
    expect(stripCloneSuffix('Maroc(3)')).toBe('Maroc');
    expect(stripCloneSuffix('Maroc (est)')).toBe('Maroc (est)');
    expect(stripCloneSuffix('Maroc (2) nord')).toBe('Maroc (2) nord');
  });

  it('leaves a name that is only a suffix whole', () => {
    expect(stripCloneSuffix('(2)')).toBe('(2)');
  });

  it('folds case and trims', () => {
    expect(nameKey('  Écosse ')).toBe('écosse');
  });
});
