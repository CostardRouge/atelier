import { localPref } from '../../shared/ui/local-pref';

/**
 * Whether the Studio's stage plays the clip's own sound, and how loud — a
 * preference of this DEVICE (the speaker in the transport, `M`), never of a
 * project: the same project is opened in a quiet office and with headphones.
 * Off by default: a stage that starts talking the first time Play is pressed
 * is a surprise, and the stage was always silent before (2026-11-22).
 */
export interface StageSound {
  on: boolean;
  /** 0–1, the stage video's own volume. */
  volume: number;
}

export const DEFAULT_STAGE_SOUND: StageSound = { on: false, volume: 0.8 };

/** A stored value read back, whatever it holds. (pure) */
export function decodeStageSound(raw: string | null): StageSound {
  if (!raw) return DEFAULT_STAGE_SOUND;
  try {
    const v = JSON.parse(raw) as Partial<StageSound>;
    const volume = typeof v.volume === 'number' && Number.isFinite(v.volume) ? Math.min(1, Math.max(0, v.volume)) : DEFAULT_STAGE_SOUND.volume;
    return { on: v.on === true, volume };
  } catch {
    return DEFAULT_STAGE_SOUND;
  }
}

export function encodeStageSound(sound: StageSound): string {
  return JSON.stringify({ on: sound.on, volume: sound.volume });
}

export const stageSoundPref = localPref('atelier.studio.stageSound', decodeStageSound, encodeStageSound);
