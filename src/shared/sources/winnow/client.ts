/**
 * The Winnow client — the only place Atelier speaks HTTP to a media source.
 *
 * Winnow (`CostardRouge/winnow`) is the maintainer's triage app: a Next.js API
 * over Postgres that indexes every capture on his NAS, builds a proxy for each
 * one and knows a DJI clip's `.srt` as a first-class sidecar. This client reads
 * that API; it never writes (phase 2 will). What it relies on was verified
 * against Winnow's code and is recorded in `docs/winnow-bridge.md` §5.
 *
 * Since phase 3 of the bridge it also WRITES, in one place: the opaque
 * document bucket (`/api/apps/:app/docs`), JSON Atelier owns entirely, guarded
 * by an etag the server uses to refuse a stale write. See `docs/
 * roadtrip-persistence.md` §7 for the route contract.
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
     * Whether the instance serves a timeline. **Winnow does not send this
     * field today** (checked 2026-09-06 against its `api/capabilities`), and
     * its timeline nonetheless shipped — so absence means "ask and see", not
     * "no timeline". Only an explicit `false` hides the leg tab; see
     * `hasTimeline`.
     */
    timeline?: boolean;
  };
  documents: {
    bucket: boolean;
    /** The `kind`s the bucket lists by. Absent on an instance without the bucket. */
    kinds?: string[];
    /** The body cap per document, in bytes; the client checks it BEFORE a PUT. */
    maxBytes?: number | null;
  };
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
  /** An explicit set of assets — how a document's refs are re-resolved. */
  ids?: readonly number[];
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
  /**
   * A fingerprint of the chapter's extent (`started_at|ended_at|count`),
   * computed HERE — Winnow offers no revision of its own, and its chapters
   * are re-derived on every request. Stored in `StageOrigin.revision`, it is
   * what lets a later reconcile see that a leg was re-clustered.
   */
  revision: string | null;
  assetCount: number;
  photoCount: number | null;
  videoCount: number | null;
  coverId: number | null;
  /**
   * Hours to add to UTC to read this chapter's days as they were lived —
   * Winnow's own reading, from the median longitude of its geotagged media.
   * Null when nothing in it carries a position: the days below were then
   * read at UTC, and a UI must say so rather than show a different day
   * silently (Winnow's own timeline prints the offset it used).
   */
  tzOffsetHours: number | null;
  /**
   * The chapter holds no position at all and its place was inferred from its
   * neighbours in time. A place to show, never a place to write into a trip
   * without the user seeing where it came from.
   */
  placeInferred: boolean;
  /**
   * A human named, merged or located this chapter on the instance (Winnow's
   * `override_id`). A derived chapter is recomputed on every request and its
   * name is only its dominant place; an authored one is a decision, and the
   * reconcile diff can weigh the two differently.
   */
  authored: boolean;
}

/**
 * Whether browsing by leg is worth offering. The flag is absent on every
 * instance shipped so far, and requiring it hid a timeline that works — so
 * the rule is "offer unless the instance says no", and a `notfound` from
 * `timeline()` is what an instance without one answers. The connection is
 * still the gate: nothing is asked of a source the user has not allowed.
 */
export function hasTimeline(caps: WinnowCapabilities | null | undefined): boolean {
  return caps?.media?.timeline !== false;
}

/**
 * The day range a leg's media is asked for. **Winnow has no `chapter_id`
 * filter** (checked against its `lib/filter.ts`, whose schema strips unknown
 * keys — so sending one narrowed nothing and quietly listed the whole
 * library), and no instant filter either: `date_from` / `date_to` over
 * `capture_date` is what exists.
 *
 * So a leg is asked for by its calendar days, which is a slightly WIDER net
 * than the chapter: on a travel day shared with the next leg, both legs'
 * media carry the same date. That is why `assetCount` is shown beside the
 * rows rather than as their count — a number that disagrees with the list
 * reads as a bug, and the honest fix is to say which is which.
 */
export function chapterDays(
  chapter: WinnowChapter,
): { dateFrom: string; dateTo: string } | null {
  if (!chapter.startDate || !chapter.endDate) return null;
  const [dateFrom, dateTo] =
    chapter.startDate <= chapter.endDate
      ? [chapter.startDate, chapter.endDate]
      : [chapter.endDate, chapter.startDate];
  return { dateFrom, dateTo };
}

/**
 * Whether the signed-in account may send files back. Winnow's `viewer` role
 * is read-only; a button that would answer 403 is worse than a sentence.
 */
export function canWriteBack(caps: WinnowCapabilities | null | undefined): boolean {
  const role = caps?.viewer?.role;
  return role === 'admin' || role === 'editor';
}

/** One file to upload, and where it lands inside the finals root. */
export interface UploadItem {
  file: File;
  /** Relative path — `POST /api/upload`'s `paths[]`, parallel to `files[]`. */
  path: string;
}

export interface UploadOptions {
  /**
   * ⚠ ASSUMED addition (bridge §7, phase 2): the capture this final was cut
   * from, so the link is exact instead of reconcile's basename + capture-time
   * guess. Omitted when unknown.
   */
  originalAssetId?: number | null;
  /** ⚠ ASSUMED (timeline §6): the chapter the final belongs to, if any. */
  chapterId?: string | null;
}

function str(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const HOUR_MS = 3_600_000;

/**
 * A capture instant read as the calendar day it was lived: shift by the
 * chapter's own offset, then take the UTC parts. This is Winnow's `localDay`
 * (`app/timeline/ChapterCard.tsx`) reproduced exactly, and it is the ONE
 * place Atelier turns an instant into a day.
 *
 * The standing rule is "take Winnow's `capture_date`, never recompute it from
 * `captured_at`". The timeline route is the one place that offers no date: a
 * chapter carries instants and the offset to read them by. Converting HERE,
 * with the instance's own offset and its own arithmetic, is what honours the
 * rule; converting in a panel, or ignoring the offset, is what walks a third
 * of an Australian trip back a day.
 */
export function localDayOf(instant: unknown, offsetHours: number | null): string | null {
  const raw = str(instant);
  if (raw === null) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + (offsetHours ?? 0) * HOUR_MS);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * One chapter of `GET /api/assets/timeline`, normalised into Atelier's shape.
 *
 * **Verified against Winnow's own `src/lib/timeline.ts`** (2026-09-06), not
 * assumed: `key` (the ISO start, stable only within one request — chapters
 * are DERIVED per request), `name`, `started_at` / `ended_at` as instants
 * with `tz_offset_hours` to read them by, `places` as bare strings, the
 * authored `place_label` / `place_lat` / `place_lon` from a named span,
 * `count`, `override_id`, `place_inferred`, `cover_id`.
 *
 * Two mappings are judgement calls, and both refuse to fabricate:
 *
 * - **A derived name is not a title.** Winnow names a chapter after its
 *   dominant place (`span?.name ?? places[0] ?? "Lieu inconnu"`), so only an
 *   authored one (`override_id`) becomes a title. Importing a derived name
 *   would pin as a decision what the place already says, and a stage's empty
 *   name is what keeps its label deriving.
 * - **One place, not a route.** Winnow orders a chapter's places by how much
 *   media each holds, NOT by the order they were lived — while a Road Trip
 *   stage's first and last places are its start and end. Carrying the list
 *   would invent a route, and possibly a reversed one, so the chapter yields
 *   its dominant place alone (the authored location when a human chose one,
 *   which is also the only place that comes with coordinates).
 */
export function chapterFromWire(raw: unknown): WinnowChapter | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.key);
  if (id === null) return null;

  const tzOffsetHours = num(r.tz_offset_hours);
  const startDate = localDayOf(r.started_at, tzOffsetHours);
  const endDate = localDayOf(r.ended_at, tzOffsetHours);
  const authored = num(r.override_id) !== null;

  // The dominant place, or the one a human chose for the chapter — which is
  // the only one Winnow gives coordinates for.
  const named = Array.isArray(r.places)
    ? r.places.map(str).find((n): n is string => n !== null && n.trim() !== '')
    : undefined;
  const label = str(r.place_label)?.trim() || null;
  const name = label ?? named?.trim() ?? null;
  const places: WinnowChapterPlace[] = name
    ? [
        {
          name,
          // Winnow reverse-geocodes to one level (city / county / region) and
          // sends no second label, so a stage's region keeps deriving.
          region: null,
          lat: label ? num(r.place_lat) : null,
          lon: label ? num(r.place_lon) : null,
        },
      ]
    : [];

  const count = num(r.count) ?? 0;
  return {
    id,
    title: authored ? str(r.name) : null,
    startDate,
    endDate,
    places,
    // Winnow has no revision of its own: fingerprint what defines the
    // chapter's extent, so a re-clustering is visible to a later reconcile.
    revision: `${str(r.started_at) ?? ''}|${str(r.ended_at) ?? ''}|${count}`,
    assetCount: count,
    // Winnow counts a chapter's media as one number; a photo/video split
    // would have to be invented, and the panel draws nothing rather than that.
    photoCount: null,
    videoCount: null,
    coverId: num(r.cover_id),
    tzOffsetHours,
    placeInferred: r.place_inferred === true,
    authored,
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
  /** 404 — no such thing, or not this account's (the bucket never says which). */
  | 'notfound'
  /** 412 — the document changed there since the etag we hold; nothing was written. */
  | 'conflict'
  /** The request never got an answer: offline, wrong URL, or CORS refused. */
  | 'unreachable'
  /** Any other non-2xx, or a body that is not what we expect. */
  | 'protocol';

/** What the server holds when it refuses a write with 412. */
export interface ConflictInfo {
  etag: string;
  updatedAt: string | null;
}

export class WinnowError extends Error {
  /** Set on a `conflict`: the server's current revision, so "keep mine" can re-PUT over it. */
  readonly theirs: ConflictInfo | null;

  constructor(
    public readonly kind: WinnowErrorKind,
    message: string,
    public readonly status?: number,
    theirs: ConflictInfo | null = null,
  ) {
    super(message);
    this.name = 'WinnowError';
    this.theirs = theirs;
  }
}

/** The app namespace this client writes under — opaque to Winnow. */
export const DOCS_APP = 'atelier';

/** One row of the document bucket, as the list and the get return it. */
export interface WinnowDocRow<T = unknown> {
  id: string;
  kind: string;
  /** The client's own document version, stored beside the body. */
  version: number;
  updated_at: string;
  etag: string;
  doc: T;
}

export interface DocBody<T = unknown> {
  kind: string;
  version: number;
  doc: T;
}

/** What a GET hands back: the row, or word that ours is still current. */
export type GetDocResult<T = unknown> = { row: WinnowDocRow<T> } | 'not-modified';

export interface PutDocResult {
  etag: string;
  updatedAt: string;
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
    if (res.status === 404) {
      throw new WinnowError('notfound', 'Not there — or not this account’s.', 404);
    }
    if (res.status === 412) {
      throw new WinnowError(
        'conflict',
        'Changed there since this device last saw it; nothing was written.',
        412,
        await conflictInfo(res),
      );
    }
    // 304 is an answer, not a failure: "what you hold is still current".
    if (!res.ok && res.status !== 304) {
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
   * `GET /api/assets/timeline?<filters>` → `{ chapters, granularity, … }` —
   * the library read as a story, chapters in lived order and narrowed by the
   * same cumulative filters as everything else, so a leg's count agrees with
   * what its days would list. **Chapters are derived on every request**: an
   * id holds only for that answer, which is why `origin` matches by span and
   * place before it trusts one.
   *
   * An instance too old to serve a timeline answers 404 (`notfound`) and the
   * caller says so. Rows the normaliser cannot read are dropped rather than
   * half-shown.
   */
  async timeline(filter: FilterQuery = {}): Promise<WinnowChapter[]> {
    const raw = await this.json<{ chapters?: unknown[] }>(
      this.url('/api/assets/timeline', filterParams(filter)),
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
        // Winnow's `intList`: comma-separated, whitespace tolerated.
        ids: query.ids?.length ? query.ids.join(',') : undefined,
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

  /** One asset's row — the same shape the list serves, wrapped as `{ asset }`. */
  async asset(id: number): Promise<WinnowAssetRow | null> {
    try {
      const raw = await this.json<{ asset?: WinnowAssetRow }>(this.url(`/api/assets/${id}`));
      return raw.asset ?? null;
    } catch (err) {
      // A purged or soft-deleted asset is a 404 — "gone", not a failure of the
      // instance. Everything else stays what it is. The kind to read is
      // `notfound`: `request` maps every 404 to it, so matching on `protocol`
      // here would rethrow and a missing asset would read as a broken one.
      if (err instanceof WinnowError && err.kind === 'notfound') return null;
      throw err;
    }
  }

  /**
   * The rows for an explicit set of ids, in the order asked, absent ones
   * skipped — how a document's remote refs are re-resolved after a reload.
   * One list request answers the whole set; an id the collapsed list did not
   * return (the RAW half of a pair, say) is asked for on its own.
   */
  async assetsByIds(ids: readonly number[]): Promise<WinnowAssetRow[]> {
    if (!ids.length) return [];
    const found = new Map<number, WinnowAssetRow>();
    for (const row of await this.allAssets({ ids })) found.set(row.id, row);
    for (const id of ids) {
      if (found.has(id)) continue;
      const row = await this.asset(id);
      if (row) found.set(id, row);
    }
    return ids.flatMap((id) => {
      const row = found.get(id);
      return row ? [row] : [];
    });
  }

  /**
   * `POST /api/upload` — multipart `files[]` with a parallel `paths[]`, which
   * Winnow already serves as a staged import (bridge §5.1). One request per
   * call: the deployment's body limit is per request, so the caller sends the
   * finals one at a time and a limit bites one file, not the whole run. The
   * answer's shape is not relied on; it is handed back for a status line.
   */
  async upload(items: readonly UploadItem[], options: UploadOptions = {}): Promise<unknown> {
    const form = new FormData();
    for (const item of items) {
      form.append('files', item.file, item.file.name);
      form.append('paths', item.path);
    }
    if (options.originalAssetId != null) {
      form.append('original_asset_id', String(options.originalAssetId));
    }
    if (options.chapterId) form.append('chapter_id', options.chapterId);
    const res = await this.request(this.url('/api/upload'), { method: 'POST', body: form });
    return this.bodyOf(res);
  }

  /**
   * `POST /api/reconcile` — link what the finals root now holds to the
   * captures it came from. Idempotent and retroactive on Winnow's side, so
   * calling it after every send is cheap and never wrong.
   */
  async reconcile(): Promise<unknown> {
    const res = await this.request(this.url('/api/reconcile'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return this.bodyOf(res);
  }

  /** A JSON body when there is one; null for an empty or non-JSON answer. */
  private async bodyOf(res: Response): Promise<unknown> {
    if (!res.headers.get('content-type')?.includes('json')) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
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

  // --- the document bucket ------------------------------------------------
  //
  // `GET /api/apps/:app/docs?kind=` lists the caller's OWN rows; a row that
  // belongs to another account answers 404, never 403, so its existence is
  // not revealed. Every write is guarded by `If-Match`: a stale etag is a 412
  // carrying the server's revision, and the caller decides — the client never
  // retries a write on its own.

  private docsUrl(app: string, id?: string, params: Record<string, string | undefined> = {}) {
    const base = `/api/apps/${encodeURIComponent(app)}/docs`;
    return this.url(id === undefined ? base : `${base}/${encodeURIComponent(id)}`, params);
  }

  /** Every document of one kind this account holds there, body included. */
  async listDocs<T = unknown>(app: string, kind: string): Promise<WinnowDocRow<T>[]> {
    const raw = await this.json<{ docs?: WinnowDocRow<T>[] }>(this.docsUrl(app, undefined, { kind }));
    return raw.docs ?? [];
  }

  /**
   * One document. With `ifNoneMatch` — the etag we hold — a 304 means ours is
   * still the server's, and nothing is downloaded.
   */
  async getDoc<T = unknown>(
    app: string,
    id: string,
    ifNoneMatch: string | null = null,
  ): Promise<GetDocResult<T>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
    const url = this.docsUrl(app, id);
    const res = await this.request(url, { headers });
    if (res.status === 304) return 'not-modified';
    let row: WinnowDocRow<T>;
    try {
      row = (await res.json()) as WinnowDocRow<T>;
    } catch {
      throw new WinnowError('protocol', `${url} did not return JSON.`, res.status);
    }
    // The header is the authority on the revision; the body echoes it.
    const etag = res.headers.get('etag') ?? row.etag;
    return { row: { ...row, etag } };
  }

  /**
   * Create or replace. `ifMatch` is the etag we hold — null for a document
   * that has never been pushed, in which case the server refuses if a row
   * already exists (412), which is what stops two devices creating one trip.
   * `maxBytes` is the instance's cap (`capabilities.documents.maxBytes`),
   * checked here so an oversize trip is refused with a sentence before any
   * bytes travel.
   */
  async putDoc<T = unknown>(
    app: string,
    id: string,
    body: DocBody<T>,
    ifMatch: string | null,
    maxBytes: number | null = null,
  ): Promise<PutDocResult> {
    const text = JSON.stringify(body);
    const size = new TextEncoder().encode(text).byteLength;
    if (maxBytes !== null && size > maxBytes) {
      throw new WinnowError(
        'protocol',
        `This document is ${formatBytes(size)}, over the instance’s cap of ${formatBytes(maxBytes)}.`,
        413,
      );
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      // Required by the route: forces a CORS preflight only the allowlisted
      // origin passes, which is what keeps a cross-site form from writing.
      'Content-Type': 'application/json',
    };
    if (ifMatch) headers['If-Match'] = ifMatch;
    const url = this.docsUrl(app, id);
    const res = await this.request(url, { method: 'PUT', headers, body: text });
    let raw: { etag?: string; updated_at?: string };
    try {
      raw = (await res.json()) as { etag?: string; updated_at?: string };
    } catch {
      throw new WinnowError('protocol', `${url} did not return JSON.`, res.status);
    }
    const etag = res.headers.get('etag') ?? raw.etag;
    if (!etag) throw new WinnowError('protocol', `${url} acknowledged without an etag.`, res.status);
    return { etag, updatedAt: raw.updated_at ?? new Date().toISOString() };
  }

  /** Delete, guarded like a write. A row already gone is a 404 (`notfound`). */
  async deleteDoc(app: string, id: string, ifMatch: string | null): Promise<void> {
    const headers: Record<string, string> = {};
    if (ifMatch) headers['If-Match'] = ifMatch;
    await this.request(this.docsUrl(app, id), { method: 'DELETE', headers });
  }
}

/** What a 412 carries: `{ error, etag, updated_at }` — read leniently. */
async function conflictInfo(res: Response): Promise<ConflictInfo | null> {
  try {
    const raw = (await res.json()) as { etag?: unknown; updated_at?: unknown };
    const etag = typeof raw.etag === 'string' ? raw.etag : res.headers.get('etag');
    if (!etag) return null;
    return { etag, updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : null };
  } catch {
    const etag = res.headers.get('etag');
    return etag ? { etag, updatedAt: null } : null;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
