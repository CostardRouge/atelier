/**
 * The Winnow client — the only place Atelier speaks HTTP to a media source.
 *
 * Winnow (`CostardRouge/winnow`) is the maintainer's triage app: a Next.js API
 * over Postgres that indexes every capture on his NAS, builds a proxy for each
 * one and knows a DJI clip's `.srt` as a first-class sidecar. This client reads
 * that API; it never writes (phase 2 will). What it relies on was verified
 * against Winnow's code and is recorded in `docs/winnow-bridge.md` §5.
 *
 * Two facts shape everything here:
 *
 * - **Auth is Winnow's own session cookie.** Atelier at `atelier.steeve.website`
 *   and Winnow at `winnow.steeve.website` are cross-origin but same-SITE, so a
 *   `SameSite=Lax` cookie travels with `credentials: 'include'` once Winnow's
 *   CORS allowlist names this origin. No token is stored anywhere. A foreign
 *   instance would need one; `auth: 'token'` is the seam for it and is not
 *   offered in the UI yet.
 * - **Atelier never calls a server the user did not name.** The base URL
 *   comes from the connect flow (`#/connect`, confirmed by the user) and is
 *   stored locally; nothing here runs at boot.
 *
 * `fetch` is injected so the request shapes and the error mapping are
 * unit-testable without a network.
 */

export type WinnowAuth =
  /** Same-site: the browser sends Winnow's session cookie. */
  | { mode: 'cookie' }
  /** Foreign origin: a bearer token the user pasted. Seam only — no UI yet. */
  | { mode: 'token'; token: string };

export interface WinnowConfig {
  /** Origin of the instance, no path, no trailing slash. */
  baseUrl: string;
  auth: WinnowAuth;
}

/** The subset of a `/api/assets` row this app reads. `a.*` carries far more. */
export interface WinnowAssetRow {
  id: number;
  filename: string;
  ext: string;
  media_type: 'photo' | 'video';
  captured_at: string | null;
  capture_date: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  file_size: number | null;
  /** Winnow's partial content hash — the identity Atelier recomputes locally. */
  content_hash: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  camera_model: string | null;
  // Exposure, as Winnow read it at ingest. `shutter` is the camera's own text
  // (`1/240`), not seconds — see `exif-from-row.ts`.
  iso: number | null;
  shutter: string | null;
  aperture: number | null;
  focal_length: number | null;
  // Drone stills only (migration 0028): DJI writes these as XMP, and they are
  // what lets a photograph from a Mini 4 Pro draw its altitude.
  relative_altitude: number | null;
  absolute_altitude: number | null;
  derivative_status: 'pending' | 'processing' | 'ready' | 'error' | 'skipped';
  /** True when a DJI `.srt` flight log rides with this clip. */
  has_telemetry: boolean;
  sidecars: WinnowSidecar[];
}

export interface WinnowSidecar {
  id: number;
  kind: 'xml' | 'thm' | 'srt';
  filename: string;
}

export interface WinnowCalendarDay {
  date: string;
  count: number;
  cover_id: number;
}

export interface WinnowCalendar {
  days: WinnowCalendarDay[];
  /**
   * The full filtered span, so a month picker can clamp to where media is —
   * or null when nothing dated matches. **Winnow never sends null here**: its
   * `min()`/`max()` over no rows yield a row of NULLs, so the wire carries
   * `{ min: null, max: null }`. `calendar()` normalises that away, which is
   * what lets every reader treat a non-null `bounds` as two real dates.
   */
  bounds: { min: string; max: string } | null;
}

/** `GET /api/capabilities` — facts about the instance, read on connect. */
export interface WinnowCapabilities {
  api: { version: number };
  auth: { methods: string[]; corsEnabled: boolean };
  media: {
    sidecars: boolean;
    rangeOnDerivatives: boolean;
    rangeOnOriginals: boolean;
    proxies: {
      video: { container: string; codec: string; height: number };
      photo: { format: string; size: number };
    };
    contentHash: string;
    /**
     * ⚠ ASSUMED (docs/winnow-timeline.md §7.9): true once the instance serves
     * its timeline. Absent on an older instance, which is what lets the
     * browser show a sentence instead of a broken tab.
     */
    timeline?: boolean;
  };
  documents: { bucket: boolean };
  scheduling: { reminders: boolean };
  limits: { maxUploadBytes: number | null };
  storage: { driver: string; signedRedirects: boolean };
  viewer: { id: number; username: string; role: 'admin' | 'editor' | 'viewer' } | null;
}

/**
 * The narrowing every listing honours — the calendar, a day, the sessions.
 * Winnow applies the same cumulative filters to all three, so a choice made
 * once narrows the whole browser rather than one pane of it.
 */
export interface FilterQuery {
  mediaType?: 'photo' | 'video';
  /** Lowercase, no dot — as Winnow stores it (`hif`, `mp4`, `arw`). */
  ext?: string;
  /** `make model`, as Winnow derives it from EXIF ("DJI Mini 4 Pro"). */
  device?: string;
}

export interface AssetQuery extends FilterQuery {
  dateFrom?: string;
  dateTo?: string;
  /** A Winnow shoot session — one folder, in practice. */
  sessionId?: number;
  /** ⚠ ASSUMED: a timeline chapter, cumulative with the other filters (§7.8). */
  chapterId?: string;
  cursor?: string | null;
  limit?: number;
}

/** A place as a chapter names it — `lat`/`lon` in decimal degrees, or null. */
export interface WinnowChapterPlace {
  name: string;
  region: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * One chapter of the instance's timeline: media grouped by place and date.
 *
 * This is Atelier's reading of the chapter, normalised at the boundary by
 * `chapterFromWire` — the spec is not written, so every wire key that
 * function reads is an ASSUMPTION (⚠) held in one place. The field names
 * deliberately match `TimelineChapter` (`shared/roadtrip/timeline-import.ts`)
 * so a chapter list can be handed to the import unchanged, without either
 * module importing the other. `startDate`/`endDate` are the CAPTURE DATES the
 * instance computed (`YYYY-MM-DD`, camera-local) — never recomputed here from
 * an instant. Counts and the cover are for drawing the list; they are never
 * stored in a trip.
 */
export interface WinnowChapter {
  id: string;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  places: WinnowChapterPlace[];
  /** Whatever the instance offers to detect a re-clustering, if anything. */
  revision: string | null;
  assetCount: number;
  photoCount: number | null;
  videoCount: number | null;
  coverId: number | null;
}

/** Whether a connected instance's capabilities say it serves a timeline. */
export function hasTimeline(caps: WinnowCapabilities | null | undefined): boolean {
  return caps?.media?.timeline === true;
}

function str(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A calendar day as the wire carries it; an instant is kept whole, so the import can refuse it. */
function dateStr(value: unknown): string | null {
  const s = str(value);
  return s && s.trim() ? s.trim() : null;
}

/**
 * ⚠ ASSUMED wire shape of one `/api/timeline` chapter (docs/winnow-timeline.md
 * §7): `id`, `title`, `start_date` / `end_date` as capture dates, `places` in
 * lived order with `name` / `region` / `lat` / `lon`, `revision`, and
 * `asset_count` / `photo_count` / `video_count` / `cover_id`. Change THIS
 * function when the spec lands; nothing downstream reads the wire.
 */
export function chapterFromWire(raw: unknown): WinnowChapter | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (id === null) return null;
  const places = Array.isArray(r.places)
    ? r.places
        .map((p): WinnowChapterPlace | null => {
          if (typeof p !== 'object' || p === null) return null;
          const q = p as Record<string, unknown>;
          const name = str(q.name);
          if (name === null) return null;
          return { name, region: str(q.region), lat: num(q.lat), lon: num(q.lon) };
        })
        .filter((p): p is WinnowChapterPlace => p !== null)
    : [];
  return {
    id,
    title: str(r.title),
    startDate: dateStr(r.start_date),
    endDate: dateStr(r.end_date),
    places,
    revision: str(r.revision),
    assetCount: num(r.asset_count) ?? 0,
    photoCount: num(r.photo_count),
    videoCount: num(r.video_count),
    coverId: num(r.cover_id),
  };
}

export interface ValueCount {
  value: string | number;
  count: number;
}

/** The slice of `/api/facets` the browser offers as filters. */
export interface WinnowFacets {
  media_types: ValueCount[];
  extensions: ValueCount[];
  devices: ValueCount[];
}

/**
 * A Winnow session: one shoot folder as it was ingested, with its span. The
 * closest thing the instance has to "a folder" — and what a photographer
 * means by one.
 */
export interface WinnowSession {
  id: number;
  name: string;
  source_path: string;
  device_hint: string | null;
  captured_at_min: string | null;
  captured_at_max: string | null;
  asset_count: number;
  status: 'empty' | 'to_sort' | 'done';
  root_kind: string;
}

function filterParams(f: FilterQuery): Record<string, string | undefined> {
  return { media_type: f.mediaType, ext: f.ext, device: f.device };
}

export interface AssetPage {
  assets: WinnowAssetRow[];
  next_cursor: string | null;
}

export type WinnowErrorKind =
  /** The instance answered 401 — the user must sign in there first. */
  | 'unauthenticated'
  /** 403 — signed in, but this account may not do that. */
  | 'forbidden'
  /** The request never got an answer: offline, wrong URL, or CORS refused. */
  | 'unreachable'
  /** Any other non-2xx, or a body that is not what we expect. */
  | 'protocol';

export class WinnowError extends Error {
  constructor(
    public readonly kind: WinnowErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'WinnowError';
  }
}

/** `https://Winnow.example/` → `https://winnow.example`; throws on a path. */
export function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('An instance must be reached over https.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Give the instance origin only — no path, no query.');
  }
  return url.origin.toLowerCase();
}

/** The id a source gets: its host, which is also what the gallery prints. */
export function sourceIdFor(baseUrl: string): string {
  return new URL(baseUrl).host;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class WinnowClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    readonly config: WinnowConfig,
    fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
  ) {
    this.fetchImpl = fetchImpl;
  }

  /** Absolute URL of an API path, with the query string appended. */
  url(path: string, params: Record<string, string | number | null | undefined> = {}): string {
    const url = new URL(path, `${this.config.baseUrl}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  // --- the file routes, as URLs an <img>/<video> or a fetch can take ------
  thumbUrl(id: number): string {
    return this.url(`/api/assets/${id}/thumb`);
  }
  proxyUrl(id: number): string {
    return this.url(`/api/assets/${id}/proxy`);
  }
  originalUrl(id: number): string {
    return this.url(`/api/assets/${id}/download`);
  }
  sidecarUrl(id: number): string {
    return this.url(`/api/sidecars/${id}/download`);
  }
  /**
   * The same thumbnail, asked for again after a failed load.
   *
   * A tile that fails once stays black forever: an `<img>` has no retry, and
   * the browser will happily reuse a failed entry. Attempt 0 is the plain URL
   * so the ordinary case is fully cacheable (Winnow serves these `immutable`
   * for a year); only a RETRY carries a discriminator, which both defeats a
   * poisoned cache entry and makes the request genuinely new.
   */
  thumbRetryUrl(id: number, attempt: number): string {
    return attempt <= 0
      ? this.thumbUrl(id)
      : this.url(`/api/assets/${id}/thumb`, { retry: attempt });
  }

  /** Where to send someone who is not signed in — Winnow's own login page. */
  loginUrl(): string {
    return this.url('/login');
  }

  private init(extra: RequestInit = {}): RequestInit {
    const headers = new Headers(extra.headers);
    if (this.config.auth.mode === 'token') {
      headers.set('Authorization', `Bearer ${this.config.auth.token}`);
    }
    return {
      ...extra,
      headers,
      // The cookie only travels when asked for, and only same-site.
      credentials: this.config.auth.mode === 'cookie' ? 'include' : 'omit',
    };
  }

  private async request(url: string, extra?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, this.init(extra));
    } catch {
      // A TypeError here is what a CORS refusal, a DNS miss or being offline
      // all look like from inside the page — the browser hides which.
      throw new WinnowError(
        'unreachable',
        `${this.config.baseUrl} did not answer (offline, wrong address, or this origin is not allowed there).`,
      );
    }
    if (res.status === 401) {
      throw new WinnowError('unauthenticated', 'Not signed in to this Winnow.', 401);
    }
    if (res.status === 403) {
      throw new WinnowError('forbidden', 'This account is not allowed to do that.', 403);
    }
    if (!res.ok) {
      throw new WinnowError('protocol', `${url} answered ${res.status}.`, res.status);
    }
    return res;
  }

  private async json<T>(url: string): Promise<T> {
    const res = await this.request(url, { headers: { Accept: 'application/json' } });
    try {
      return (await res.json()) as T;
    } catch {
      throw new WinnowError('protocol', `${url} did not return JSON.`, res.status);
    }
  }

  capabilities(): Promise<WinnowCapabilities> {
    return this.json(this.url('/api/capabilities'));
  }

  /**
   * Per-day counts + cover in `[from, to]`, one logical media per RAW+JPEG
   * pair — the same collapse the day list uses, so the numbers agree.
   */
  async calendar(
    from: string,
    to: string,
    filter: FilterQuery = {},
  ): Promise<WinnowCalendar> {
    const raw = await this.json<{
      days?: WinnowCalendarDay[];
      bounds?: { min: string | null; max: string | null } | null;
    }>(this.url('/api/assets/calendar', { from, to, collapse: 1, ...filterParams(filter) }));
    // A filter that matches nothing still answers with a bounds OBJECT whose
    // fields are null. Collapse it to null here, once, rather than making
    // every reader defend against a half-empty span.
    const b = raw.bounds;
    return {
      days: raw.days ?? [],
      bounds: b && b.min && b.max ? { min: b.min, max: b.max } : null,
    };
  }

  /** Values + counts for the filter pickers. Library-wide, one request. */
  async facets(): Promise<WinnowFacets> {
    const raw = await this.json<Partial<WinnowFacets>>(this.url('/api/facets'));
    return {
      media_types: raw.media_types ?? [],
      extensions: raw.extensions ?? [],
      devices: raw.devices ?? [],
    };
  }

  /**
   * The shoot sessions, newest capture first. Winnow keeps a session when at
   * least one of its assets matches the filters, so the list narrows with the
   * same choices as the calendar. Ignored folders stay hidden, as in Winnow.
   */
  async sessions(filter: FilterQuery = {}): Promise<WinnowSession[]> {
    const raw = await this.json<{ sessions?: WinnowSession[] }>(
      this.url('/api/sessions', { sort: 'captured', sort_dir: 'desc', ...filterParams(filter) }),
    );
    return raw.sessions ?? [];
  }

  /**
   * ⚠ ASSUMED `GET /api/timeline?<filters>` → `{ chapters: [...] }`, chapters
   * in lived order, narrowed by the same cumulative filters as everything
   * else (so a chapter's count agrees with the day list). Only call it when
   * `hasTimeline(capabilities)`; an older instance answers 404 and the caller
   * should have shown a sentence instead. Rows the normaliser cannot read are
   * dropped rather than half-shown.
   */
  async timeline(filter: FilterQuery = {}): Promise<WinnowChapter[]> {
    const raw = await this.json<{ chapters?: unknown[] }>(
      this.url('/api/timeline', filterParams(filter)),
    );
    return (raw.chapters ?? [])
      .map(chapterFromWire)
      .filter((c): c is WinnowChapter => c !== null);
  }

  /**
   * One page of assets, oldest first inside the window so a day reads in
   * shooting order. Collapsed: a RAW+JPEG pair is one row, the displayed
   * primary — and Winnow's proxy exists for it whichever half that is.
   */
  assets(query: AssetQuery): Promise<AssetPage> {
    return this.json(
      this.url('/api/assets', {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        session_id: query.sessionId,
        chapter_id: query.chapterId,
        ...filterParams(query),
        cursor: query.cursor,
        limit: query.limit ?? 200,
        collapse: 1,
        sort_dir: 'asc',
      }),
    );
  }

  /**
   * Every row of a query, following `next_cursor` until the page is short.
   * A busy day is 300 media and one page is 200: stopping at the first page
   * would silently show a day two-thirds full. `cap` bounds a runaway query —
   * nobody adds 2 000 pictures to a library by hand.
   */
  async allAssets(query: AssetQuery, cap = 2000): Promise<WinnowAssetRow[]> {
    const rows: WinnowAssetRow[] = [];
    let cursor: string | null = null;
    do {
      const page: AssetPage = await this.assets({ ...query, cursor });
      rows.push(...page.assets);
      cursor = page.next_cursor;
    } while (cursor && rows.length < cap);
    return rows;
  }

  /**
   * The bytes at `url`, as a `File` the rest of the suite can hold like any
   * other. The whole body is read: this is the export/materialise path, not a
   * streaming preview (see `materialize.ts` for why that is the honest phase-1
   * shape).
   */
  async fetchFile(url: string, name: string, type: string, lastModified: number): Promise<File> {
    const res = await this.request(url);
    const blob = await res.blob();
    return new File([blob], name, { type, lastModified });
  }
}
