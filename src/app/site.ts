/**
 * Site-wide constants in one place. The deploy base path is derived from the
 * repo name automatically in `vite.config.ts`; the source link below is not,
 * so a repo rename means updating it by hand — it drifted once already.
 */

import { DEPLOYED_ORIGINS } from '../shared/commands/mcp-protocol';

/** GitHub repository, used for the source links in the masthead and footer. */
export const REPO_URL = 'https://github.com/CostardRouge/atelier';

/**
 * The canonical address of the deployed site: the custom domain, at the
 * root. `index.html`'s head (the canonical link, OpenGraph), `public/robots.txt`,
 * `public/sitemap.xml` and `public/llms.txt` write the same host by hand, since
 * nothing builds them — `site.test.ts` and `llms.test.ts` hold them together.
 */
export const SITE_URL = `${DEPLOYED_ORIGINS[0]}/`;
