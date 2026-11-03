import { describe, expect, it } from 'vitest';
import { fingerprint, recordingContext, RecordingPath2D } from './recording-context';

describe('recordingContext', () => {
  it('writes paints where they land, the transform applied, invisible ones left out', () => {
    const { ctx, ops, texts } = recordingContext();
    ctx.fillStyle = '#FF0000';
    ctx.save();
    ctx.translate(100, 50);
    ctx.scale(2, 2);
    ctx.fillRect(0, 0, 10, 20);
    ctx.font = '600 40px Geist';
    ctx.fillText('Hello', 5, 5);
    ctx.restore();
    ctx.globalAlpha = 0;
    ctx.fillText('ghost', 0, 0);
    expect(ops).toEqual(['fillRect 100,50 20x40 #ff0000 a1', 'text "Hello" 110,60 600 40px Geist start #ff0000 a1']);
    expect(texts).toEqual(['Hello']);
  });
  it('boxes a path and a Path2D under the transform', () => {
    const { ctx, ops } = recordingContext();
    ctx.beginPath();
    ctx.arc(100, 100, 10, 0, Math.PI * 2);
    ctx.fill();
    const p = new RecordingPath2D();
    p.moveTo(0, 0);
    p.lineTo(10, 10);
    ctx.translate(20, 0);
    ctx.stroke(p as unknown as Path2D);
    expect(ops).toEqual(['fill 90,90 20x20 #000000 a1', 'stroke 20,0 10x10 #000000 a1 w1']);
  });
  it('fingerprints a list, order and content alike', () => {
    expect(fingerprint(['a', 'b'])).toBe(fingerprint(['a', 'b']));
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['b', 'a']));
    expect(fingerprint(['ab'])).not.toBe(fingerprint(['a', 'b']));
  });
});
