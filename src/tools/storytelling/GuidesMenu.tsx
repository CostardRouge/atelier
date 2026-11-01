import { DEFAULT_GUIDES, SAFE_ZONE_PRESETS, findSafeZone, type GuidesState } from '../../shared/overlay/guides';
import { localPref } from '../../shared/ui/local-pref';
import { Icons } from '../../shared/ui/icons';
import SettingsMenu from '../../shared/ui/SettingsMenu';

/** The stage's guides, per device (a way to look, not part of the post): the Studio's own shape, `shared/overlay/guides.ts`. */
export const storyGuides = localPref<GuidesState>(
  'atelier.storytelling.guides',
  (raw) => {
    try {
      const v = raw ? (JSON.parse(raw) as Partial<GuidesState>) : null;
      return v && typeof v.safeZone === 'string' ? { ...DEFAULT_GUIDES, ...v, grid: { ...DEFAULT_GUIDES.grid, ...(v.grid ?? {}) } } : DEFAULT_GUIDES;
    } catch {
      return DEFAULT_GUIDES;
    }
  },
  (v) => JSON.stringify(v),
);

/**
 * The social networks' dead zones over the stage — where TikTok, Reels or
 * Shorts draw their buttons and captions (`SAFE_ZONE_PRESETS`) — and a
 * composition grid, from one menu beside Play. Drawn over the preview only,
 * never into the export (`StoryStage`).
 */
export default function GuidesMenu({ guides, onGuides }: { guides: GuidesState; onGuides: (g: GuidesState) => void }) {
  const zone = findSafeZone(guides.safeZone);
  return (
    <SettingsMenu
      label="Guides over the stage"
      side="above"
      trigger={{ text: zone ? zone.label : 'Guides', icon: Icons.grid, size: 'sm', variant: zone || guides.grid.show ? 'default' : 'ghost', title: 'Social safe areas and a grid, over the preview only' }}
      sections={[
        {
          kind: 'list',
          id: 'zone',
          heading: 'Safe area',
          items: [
            { id: 'none', icon: Icons.close, label: 'Off', on: guides.safeZone === 'none', onSelect: () => onGuides({ ...guides, safeZone: 'none' }) },
            ...SAFE_ZONE_PRESETS.filter((p) => p.aspect < 1).map((p) => ({
              id: p.id,
              icon: Icons.monitor,
              label: p.label,
              on: guides.safeZone === p.id,
              onSelect: () => onGuides({ ...guides, safeZone: p.id, safeZoneOrientation: 'auto' as const }),
            })),
          ],
        },
        {
          kind: 'switch',
          id: 'grid',
          label: 'Grid',
          text: guides.grid.show ? `${guides.grid.cols} × ${guides.grid.rows}` : 'Off',
          on: guides.grid.show,
          onToggle: () => onGuides({ ...guides, grid: { ...guides.grid, show: !guides.grid.show } }),
        },
      ]}
    />
  );
}
