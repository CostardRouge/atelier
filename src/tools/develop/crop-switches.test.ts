import { describe, expect, it } from 'vitest';
import { cropSwitchState, recordCropSwitch, revertCropSwitch, type StoredCrop } from './crop-switches';
import type { Framing } from '../../shared/media/framing';

const WHOLE: Framing = { scale: 1, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, fit: 'cover' };
const crop = (rotation: number, scale = 1, aspect = 'original'): StoredCrop => ({
  aspect,
  framing: { ...WHOLE, rotation, scale },
});

describe('crop switches', () => {
  it('turns Auto level off back to the crop before it', () => {
    const before = crop(0, 1.2);
    const after = crop(2.4, 1.3);
    const memos = recordCropSwitch({}, 'level', before, after);
    expect(cropSwitchState(memos, 'level', after)).toBe('on');
    const off = revertCropSwitch(memos, 'level', after);
    expect(off.restore).toEqual(before);
    expect(cropSwitchState(off.memos, 'level', before)).toBe('off');
    // An undo of the turn-off lights it again.
    expect(cropSwitchState(off.memos, 'level', after)).toBe('on');
  });

  it('says a level picture that needed nothing', () => {
    const memos = recordCropSwitch({}, 'level', crop(0), crop(0));
    expect(cropSwitchState(memos, 'level', crop(0))).toBe('nothing');
    expect(revertCropSwitch(memos, 'level', crop(0))).toEqual({ memos: {}, restore: null, state: 'nothing' });
  });

  it('reads a hand on the crop as edited', () => {
    const memos = recordCropSwitch({}, 'subject', crop(0), crop(0, 1.6, '4:5'));
    expect(cropSwitchState(memos, 'subject', crop(0, 1.7, '4:5'))).toBe('edited');
    expect(revertCropSwitch(memos, 'subject', crop(0, 1.7, '4:5')).restore).toEqual(crop(0));
  });

  it('turning Crop to subject off after Auto level gives back the LEVELLED picture', () => {
    let memos = recordCropSwitch({}, 'level', crop(0), crop(3, 1.2));
    memos = recordCropSwitch(memos, 'subject', crop(3, 1.2), crop(3, 1.8, '4:5'));
    expect(cropSwitchState(memos, 'level', crop(3, 1.8, '4:5'))).toBe('edited');
    expect(cropSwitchState(memos, 'subject', crop(3, 1.8, '4:5'))).toBe('on');
    const off = revertCropSwitch(memos, 'subject', crop(3, 1.8, '4:5'));
    expect(off.restore).toEqual(crop(3, 1.2));
    expect(cropSwitchState(off.memos, 'level', crop(3, 1.2))).toBe('on');
  });
});
