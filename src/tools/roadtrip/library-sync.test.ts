import { describe, expect, it } from 'vitest';
import { restoreClaim, sameFileName, syncMove, type SyncState } from './library-sync';

const state = (patch: Partial<SyncState> = {}): SyncState => ({
  settled: true,
  tickMoved: false,
  slideName: 'alpha.jpg',
  activeName: 'alpha.jpg',
  ...patch,
});

describe('syncMove', () => {
  it('restores until the slide’s own picture has been looked for', () => {
    expect(syncMove(state({ settled: false }))).toBe('restore');
    expect(syncMove(state({ settled: false, tickMoved: true, activeName: 'bravo.jpg' }))).toBe(
      'restore',
    );
  });

  it('does nothing while the two agree', () => {
    expect(syncMove(state())).toBe('idle');
    expect(syncMove(state({ tickMoved: true }))).toBe('idle');
    expect(syncMove(state({ activeName: 'ALPHA.JPG' }))).toBe('idle');
  });

  it('records the picture the author ticked', () => {
    expect(syncMove(state({ tickMoved: true, activeName: 'bravo.jpg' }))).toBe('record');
    // An empty slide taking its first picture.
    expect(syncMove(state({ tickMoved: true, slideName: null, activeName: 'bravo.jpg' }))).toBe(
      'record',
    );
  });

  it('leaves the slide alone when the picture moved under a tick nobody touched', () => {
    // An undo, a redo: the slide names another picture and the sidebar is
    // still on the one it held. Writing it back is what made undo look dead.
    expect(syncMove(state({ slideName: 'alpha.jpg', activeName: 'bravo.jpg' }))).toBe('idle');
    // A cleared cell, with its picture still ticked.
    expect(syncMove(state({ slideName: null }))).toBe('idle');
  });

  it('never records when nothing is ticked', () => {
    expect(syncMove(state({ tickMoved: true, activeName: null }))).toBe('idle');
  });
});

describe('restoreClaim', () => {
  it('names the slide AND its picture, so a changed picture is restored again', () => {
    expect(restoreClaim('hook', { name: 'alpha.jpg' })).not.toBe(
      restoreClaim('hook', { name: 'bravo.jpg' }),
    );
    expect(restoreClaim('hook', null)).not.toBe(restoreClaim('hook', { name: 'alpha.jpg' }));
    expect(restoreClaim('hook', { name: 'Alpha.JPG' })).toBe(
      restoreClaim('hook', { name: 'alpha.jpg' }),
    );
  });

  it('keeps two cells of one slide apart', () => {
    expect(restoreClaim('s1#1', { name: 'alpha.jpg' })).not.toBe(
      restoreClaim('s1#2', { name: 'alpha.jpg' }),
    );
  });

  it('cannot be forged by a file name that looks like a key', () => {
    expect(restoreClaim('hook', { name: 'x' })).not.toBe(restoreClaim('hook\u0000x', null));
  });
});

describe('sameFileName', () => {
  it('ignores case and treats two absences as the same', () => {
    expect(sameFileName('a.JPG', 'a.jpg')).toBe(true);
    expect(sameFileName(null, null)).toBe(true);
    expect(sameFileName(null, 'a.jpg')).toBe(false);
  });
});
