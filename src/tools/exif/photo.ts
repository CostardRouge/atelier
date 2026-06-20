/** A photo asset projected for the EXIF viewer — just its image handle. */
export interface Photo {
  /** Stable id (the asset id / lowercased base name). */
  id: string;
  /** Base name without extension, for display. */
  baseName: string;
  /** The image file handle — bytes are read lazily, never uploaded. */
  image: File;
}
