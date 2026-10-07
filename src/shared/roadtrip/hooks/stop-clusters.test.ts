import { describe, expect, it } from 'vitest';
import { GROUP_SHORTCUTS, groupName, groupStops, groupsOn, type NamedTown } from './stop-clusters';

/** Melbourne and its suburbs, a side trip to Geelong, back to Melbourne, then Sydney. */
const STOPS = [
  { name: 'Melbourne', lat: -37.81, lon: 144.96 },
  { name: 'Fitzroy', lat: -37.8, lon: 144.98 },
  { name: 'St Kilda', lat: -37.87, lon: 144.98 },
  { name: 'Geelong', lat: -38.15, lon: 144.36 },
  { name: 'Brunswick', lat: -37.77, lon: 144.96 },
  { name: 'Sydney', lat: -33.87, lon: 151.21 },
];
const TOWNS: NamedTown[] = [
  { name: 'Melbourne', lat: -37.81, lon: 144.96, population: 4_000_000 },
  { name: 'Geelong', lat: -38.15, lon: 144.36, population: 250_000 },
  { name: 'Fitzroy', lat: -37.8, lon: 144.98, population: 10_000 },
];

describe('groupStops', () => {
  it('groups nothing when off, every stop its own group', () => {
    expect(groupStops(STOPS, 0, 'consecutive').map((g) => g.members)).toEqual([[0], [1], [2], [3], [4], [5]]);
    expect(groupsOn({ groupKm: 0 })).toBe(false);
    expect(groupsOn({ groupKm: 10 })).toBe(true);
  });

  it('merges only places that follow each other by default — a later return is a second halt', () => {
    const groups = groupStops(STOPS, 10, 'consecutive');
    expect(groups.map((g) => g.members)).toEqual([[0, 1, 2], [3], [4], [5]]);
    // The halt sits on a real place, the one nearest the group's centre.
    expect([0, 1, 2]).toContain(groups[0].anchor);
    expect(groups[0].extentKm).toBeGreaterThan(0);
    expect(groups[0].extentKm).toBeLessThan(10);
  });

  it('merges every visit into the first when asked, keeping the journey’s order of groups', () => {
    const groups = groupStops(STOPS, 10, 'all');
    expect(groups.map((g) => g.members)).toEqual([[0, 1, 2, 4], [3], [5]]);
  });

  it('reaches the metro shortcut: Geelong joins Melbourne at 80 km, not at 40', () => {
    expect(GROUP_SHORTCUTS.map((s) => s.km)).toEqual([2, 10, 40]);
    expect(groupStops(STOPS, 40, 'consecutive')[1].members).toEqual([3]);
    expect(groupStops(STOPS, 80, 'consecutive')[0].members).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('groupName', () => {
  const groups = groupStops(STOPS, 10, 'consecutive');

  it('keeps a single stop’s own name whatever the rule', () => {
    expect(groupName(STOPS, groups[1], 'town', TOWNS)).toBe('Geelong');
    expect(groupName(STOPS, groups[3], 'first', TOWNS)).toBe('Sydney');
  });

  it('names a group by its biggest town near, its first member, or its central one', () => {
    expect(groupName(STOPS, groups[0], 'town', TOWNS)).toBe('Melbourne');
    expect(groupName(STOPS, groups[0], 'first', TOWNS)).toBe('Melbourne');
    expect(groupName(STOPS, groups[0], 'central', TOWNS)).toBe(STOPS[groups[0].anchor].name);
    // With no index at hand the town rule says the first member, never a blank.
    expect(groupName(STOPS, groups[0], 'town', null)).toBe('Melbourne');
    expect(groupName(STOPS.map((s, i) => (i === 0 ? { ...s, name: 'Docklands' } : s)), groups[0], 'town', [])).toBe('Docklands');
  });
});
