/**
 * What a trip's road settings are CALLED, once for every surface that tunes
 * them — Trips' Road pane and Storytelling's map (his ask, 2026-11-01: « si je
 * change l'un ou l'autre, tout se met à jour » — the settings are the trip's,
 * so their words are one list too). Pure.
 */
import type { RoadDriveStyle, RoadMode } from './road-track';

export const ROAD_MODE_LABEL: Record<RoadMode, string> = {
  crow: 'Crow flies',
  stages: 'Between stays',
  moves: 'Every move',
  raw: 'Raw',
};

export const ROAD_DRIVE_LABEL: Record<RoadDriveStyle, { name: string; says: string }> = {
  fixes: { name: 'Point to point', says: 'every fix' },
  driver: { name: 'Driver', says: 'aims ahead' },
  ribbon: { name: 'Ribbon', says: 'smooth, on the road' },
};

/** A distance of the settings, as the panes write it. */
export const roadMetres = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);
