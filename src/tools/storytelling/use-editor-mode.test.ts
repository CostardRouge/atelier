import { describe, expect, it } from 'vitest';
import { editorModeFor } from './use-editor-mode';

describe('editorModeFor', () => {
  it('gives the list a column from 1100 px of editor, the inspector from 760', () => {
    expect(editorModeFor(1440)).toBe('wide');
    expect(editorModeFor(1100)).toBe('wide');
    expect(editorModeFor(1099)).toBe('medium');
    expect(editorModeFor(760)).toBe('medium');
    expect(editorModeFor(759)).toBe('narrow');
    expect(editorModeFor(358)).toBe('narrow');
  });
});
