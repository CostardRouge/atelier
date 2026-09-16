import { describe, expect, it } from 'vitest';
import { isWorkingPreview, workingPreviewFile, workingPreviewsKey } from './working-preview';

describe('working previews', () => {
  it('are files named like their picture, and told apart from the real one', () => {
    const preview = workingPreviewFile(new Blob(['x'], { type: 'image/jpeg' }), 'IMG_1.jpg', 42);
    expect(preview.name).toBe('IMG_1.jpg');
    expect(preview.lastModified).toBe(42);
    expect(isWorkingPreview(preview)).toBe(true);
    expect(isWorkingPreview(new File(['x'], 'IMG_1.jpg'))).toBe(false);
    expect(isWorkingPreview(null)).toBe(false);
  });

  it('keep their opt-in per roll', () => {
    expect(workingPreviewsKey('r1')).not.toBe(workingPreviewsKey('r2'));
  });
});
