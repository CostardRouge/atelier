import { describe, expect, it } from 'vitest';
import { ARROW_PAN_PX, ARROW_PAN_STRIDE_PX, zoomKeyAction, type ZoomKeyPress } from './zoom-keys';

const press = (key: string, extra: Partial<ZoomKeyPress> = {}): ZoomKeyPress => ({
  key,
  defaultPrevented: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  target: null,
  ...extra,
});
const field = { tagName: 'INPUT', isContentEditable: false, role: null, inputType: 'text' };

describe('zoomKeyAction', () => {
  it('toggles on Z, fitted or zoomed, either case', () => {
    expect(zoomKeyAction(press('z'), false)).toEqual({ kind: 'toggle' });
    expect(zoomKeyAction(press('Z'), true)).toEqual({ kind: 'toggle' });
  });

  it('pans a zoomed view with the arrows, the picture following the key, Shift a stride', () => {
    expect(zoomKeyAction(press('ArrowLeft'), true)).toEqual({ kind: 'pan', dx: ARROW_PAN_PX, dy: 0 });
    expect(zoomKeyAction(press('ArrowDown', { shiftKey: true }), true)).toEqual({
      kind: 'pan',
      dx: 0,
      dy: -ARROW_PAN_STRIDE_PX,
    });
  });

  it('leaves the arrows alone at the fit — a surface with another use for them keeps it', () => {
    expect(zoomKeyAction(press('ArrowRight'), false)).toBeNull();
  });

  it('stands down in a text field and under a modifier', () => {
    expect(zoomKeyAction(press('z', { target: field }), true)).toBeNull();
    expect(zoomKeyAction(press('z', { metaKey: true }), true)).toBeNull();
    expect(zoomKeyAction(press('ArrowLeft', { altKey: true }), true)).toBeNull();
    expect(zoomKeyAction(press('ArrowLeft', { defaultPrevented: true }), true)).toBeNull();
  });
});
