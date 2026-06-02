/** A single video in the LUT Studio collection. */
export interface Clip {
  /** Stable id: name + size + lastModified, used for dedupe and updates. */
  id: string;
  file: File;
  name: string;
  size: number;
  // Cheap metadata, filled in lazily from a throwaway <video>.
  width?: number;
  height?: number;
  duration?: number;
  /** Object URL of a small thumbnail (revoke on removal/unmount). */
  thumbUrl?: string;
  metaStatus: 'pending' | 'ready' | 'error';
  /** Whether this clip is included in the next batch export. */
  exportSelected: boolean;
  exportStatus: 'idle' | 'queued' | 'exporting' | 'done' | 'error';
  /** 0..1 while exporting, else null. */
  exportRatio: number | null;
  exportError?: string;
}

/** Build a clip's stable id from its file identity. */
export function clipId(file: File): string {
  return `${file.name}__${file.size}__${file.lastModified}`;
}
