import { describe, expect, it } from 'vitest';
import { PALETTE_GROUPS } from './palette-groups';
import { FIELD_KEYS } from './field-format';
import type { OverlayKind } from './overlay-types';

const items = PALETTE_GROUPS.flatMap((g) => g.items);

describe('PALETTE_GROUPS', () => {
  it('offers every telemetry field exactly once', () => {
    const offered = items
      .filter((i) => i.kind === 'telemetry-field')
      .map((i) => (i as { field: string }).field);
    expect(new Set(offered).size).toBe(offered.length);
    expect([...offered].sort()).toEqual([...FIELD_KEYS].sort());
  });

  it('offers every non-telemetry kind exactly once', () => {
    const shapes: OverlayKind[] = [
      'text',
      'heading-arrow',
      'heading-tape',
      'frame-corners',
      'battery',
    ];
    for (const kind of shapes) {
      expect(items.filter((i) => i.kind === kind)).toHaveLength(1);
    }
  });

  it('keeps every group non-empty and labelled', () => {
    for (const group of PALETTE_GROUPS) {
      expect(group.label.trim()).not.toBe('');
      expect(group.items.length).toBeGreaterThan(0);
    }
  });
});
