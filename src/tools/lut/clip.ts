/** A single video queued for grading / batch export in LUT Studio. */
export interface Clip {
  /** The asset id it came from (also the React key and active-preview id). */
  id: string;
  file: File;
  name: string;
  size: number;
  exportStatus: 'idle' | 'queued' | 'exporting' | 'done' | 'error';
  /** 0..1 while exporting, else null. */
  exportRatio: number | null;
  exportError?: string;
}
