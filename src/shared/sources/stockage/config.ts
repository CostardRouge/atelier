/**
 * The person's own shared storage (CostardRouge/stockage), reached with a
 * Sésame access token made for it (CostardRouge/sesame#26) — where Atelier's
 * documents and files move from a Winnow's bucket (the maintainer's plan of
 * 2026-11-26: «no more store in Winnow»). Nothing is contacted until the
 * person signs in from `#/sources`: connecting stays their act.
 *
 * Vite inlines `import.meta.env` at build: the addresses default to
 * production and a build may override them (`VITE_SESAME_ISSUER`,
 * `VITE_STOCKAGE_URL`, `VITE_SESAME_CLIENT_ID`).
 */

const env = import.meta.env as Record<string, string | undefined>;

export const SESAME_ISSUER = env.VITE_SESAME_ISSUER || 'https://auth.steeve.website';
export const STOCKAGE_URL = (env.VITE_STOCKAGE_URL || 'https://stockage.steeve.website').replace(/\/+$/, '');
/** Atelier's app id in Sésame — also its namespace in the store (`/api/apps/atelier/…`). */
export const SESAME_CLIENT_ID = env.VITE_SESAME_CLIENT_ID || 'atelier';

/** The source id documents kept there carry: the store's host, as a Winnow's is its host. */
export const STOCKAGE_SOURCE_ID = new URL(STOCKAGE_URL).host;

/** Who signs in, a refresh token, and the store. */
export const SCOPE = 'openid offline_access stockage';
