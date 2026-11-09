/**
 * A client for the person's OWN Postiz (lab 12, his yes of 2026-11-08) — the
 * self-hosted scheduler that publishes to Instagram through Meta's official
 * API. Atelier reaches it like a connected Winnow: only the address the person
 * typed on `#/sources`, only on their gesture, with the API key they pasted
 * (kept on this device, `store.ts`). Never a third party, never at boot.
 *
 * The public API (`<postiz>/api/public/v1`, header `Authorization: <key>`,
 * measured on his instance 2026-11-08 — CORS open to this site and to
 * `localhost:5173`):
 * - `GET  /is-connected`, `GET /integrations` — the channels it publishes to;
 * - `POST /upload` (multipart `file`) → `{ id, path }`;
 * - `POST /posts` — `{ type: schedule|now|draft, date, shortLink, tags, posts: [{ integration: { id }, value: [{ content, image }], settings: { __type, … } }] }`;
 * - `GET  /posts?startDate&endDate` → `{ posts }` (state QUEUE · PUBLISHED · ERROR · DRAFT);
 * - `DELETE /posts/:id`.
 *
 * Limits his instance showed: 90 post requests an hour; an upload over
 * 100 MB is refused by Cloudflare with a 413 that carries no CORS header —
 * the browser sees a bare network error — so the size is checked HERE,
 * before anything leaves (`uploadProblem`). Postiz itself caps an image at
 * 10 MB.
 *
 * The request builders and readers are pure; `PostizClient` only wires them
 * to a `fetch`, so the specs drive it with a stub.
 */

export type PostKind = 'reel' | 'carousel' | 'story';
export type PostState = 'queue' | 'published' | 'error' | 'draft';

/** A channel Postiz publishes to (an Instagram account, here). */
export interface PostizChannel {
  id: string;
  name: string;
  /** The provider: `instagram` (Facebook Business), `instagram-standalone`… — the post's `settings.__type`. */
  identifier: string;
  picture: string | null;
  disabled: boolean;
}

/** A file Postiz holds, ready to go on a post. */
export interface PostizMedia {
  id: string;
  path: string;
}

/** A post as Postiz lists it. */
export interface PostizPost {
  id: string;
  group: string | null;
  content: string;
  publishDate: string;
  state: PostState;
  releaseURL: string | null;
  error: string | null;
  channel: { id: string; name: string; identifier: string; picture: string | null } | null;
}

export class PostizError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PostizError';
  }
}

/** Where the public API is answered, from what the person typed: the Postiz address, or the API's own. */
export function apiCandidates(raw: string): string[] {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new PostizError('A Postiz must be reached over https.');
  const base = `${url.origin}${url.pathname.replace(/\/+$/, '')}`.replace(/\/$/, '');
  if (/\/public\/v1$/.test(base)) return [base];
  // A Postiz behind one domain serves its backend under /api; one whose backend has a domain of its own, at the root.
  return [`${base}/api/public/v1`, `${base}/public/v1`];
}

/** The largest file sent: Cloudflare refuses 100 MB with a 413 the browser cannot read, so stay under it. */
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
/** Postiz's own cap on an image. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Instagram's carousel through the API. */
export const MAX_CAROUSEL_ITEMS = 10;

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** Why `file` cannot be sent, or null — said before a byte leaves. */
export function uploadProblem(file: { size: number; type: string; name: string }): string | null {
  const image = file.type.startsWith('image/');
  if (image && file.size > MAX_IMAGE_BYTES) return `${file.name} is ${mb(file.size)} — Postiz takes an image up to 10 MB.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is ${mb(file.size)} — your Postiz takes a file up to ${mb(MAX_UPLOAD_BYTES)}. A shorter film, or the Standard quality, makes it smaller.`;
  return null;
}

/** Why a post of `kind` cannot carry these files, or null. */
export function postProblem(kind: PostKind, media: readonly { type: string }[]): string | null {
  if (!media.length) return 'Instagram needs a picture or a video.';
  if (kind === 'reel' && (media.length !== 1 || !media[0].type.startsWith('video/'))) return 'A Reel is one video.';
  if (kind === 'story' && media.length !== 1) return 'A story is one picture or one video.';
  if (kind === 'carousel' && media.length > MAX_CAROUSEL_ITEMS) return `A carousel sent by Instagram's API holds ${MAX_CAROUSEL_ITEMS} slides at most — this one has ${media.length}.`;
  return null;
}

export interface PostRequest {
  channel: Pick<PostizChannel, 'id' | 'identifier'>;
  kind: PostKind;
  caption: string;
  media: readonly PostizMedia[];
  /** When it goes out; `'now'`, or `'draft'` to leave it in Postiz unsent. */
  at: Date | 'now' | 'draft';
  /** A Reel shown to non-followers first. */
  trial?: boolean;
  /** A trial Reel shared to followers when it performs (`SS_PERFORMANCE`), or by hand. */
  graduate?: 'auto' | 'manual';
  /** Instagram handles invited as collaborators, without the @. */
  collaborators?: readonly string[];
}

/** The body of `POST /posts` for one post on one channel. */
export function postBody(req: PostRequest, now: Date = new Date()): Record<string, unknown> {
  const settings: Record<string, unknown> = { __type: req.channel.identifier || 'instagram', post_type: req.kind === 'story' ? 'story' : 'post' };
  if (req.kind === 'reel' && req.trial) {
    settings.is_trial_reel = true;
    settings.graduation_strategy = req.graduate === 'manual' ? 'MANUAL' : 'SS_PERFORMANCE';
  }
  const collaborators = (req.collaborators ?? []).map((c) => c.trim().replace(/^@/, '')).filter(Boolean);
  if (collaborators.length && req.kind !== 'story') settings.collaborators = collaborators.map((label) => ({ label }));
  return {
    type: req.at === 'now' ? 'now' : req.at === 'draft' ? 'draft' : 'schedule',
    date: (req.at instanceof Date ? req.at : now).toISOString(),
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: req.channel.id },
        value: [{ content: req.caption, image: req.media.map((m) => ({ id: m.id, path: m.path })) }],
        settings,
      },
    ],
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The channels `GET /integrations` lists, whatever extra fields a version adds. */
export function readChannels(raw: unknown): PostizChannel[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { integrations?: unknown }).integrations) ? (raw as { integrations: unknown[] }).integrations : [];
  return list.flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const r = x as Record<string, unknown>;
    const id = str(r.id);
    if (!id) return [];
    return [{ id, name: str(r.name) ?? id, identifier: str(r.identifier) ?? str(r.providerIdentifier) ?? 'instagram', picture: str(r.picture), disabled: r.disabled === true }];
  });
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/**
 * A caption as Postiz keeps it — HTML from its editor (`<p>…</p>`, `<br>`,
 * entities) — turned into the plain text it says: each paragraph and break a
 * line, every tag dropped, entities decoded. Never parsed into a document,
 * never injected: it is drawn as text (lab 13, his report of `<p></p>` on
 * the gallery). Pure.
 */
export function postizText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (all, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** What to do about a post Instagram refused, from what Postiz says — null when the error is not one we know. */
export function failureHint(error: string | null): string | null {
  if (!error) return null;
  if (/could not process (this|the) video|video format|codec|aspect ratio/i.test(error)) return 'Send it again at Standard quality, 30 fps.';
  if (/(fetch|download|retrieve|access).{0,40}(media|image|video|url)|media.{0,20}(not|un)reachable|invalid (image|media) url/i.test(error)) return 'Your Postiz’s uploads must be reachable from the internet. Send it again once they are.';
  if (/token|expired|re-?authori[sz]e|reconnect|session has been invalidated|permission/i.test(error)) return 'Reconnect the account in your Postiz, then send it again.';
  if (/too (long|many)|caption|hashtag/i.test(error)) return 'Shorten the caption or its hashtags, then send it again.';
  return null;
}

/** The person's Postiz itself, for a link: its API's base without `/api/public/v1`. */
export function postizHome(apiBase: string): string {
  return apiBase.replace(/\/(api\/)?public\/v1\/?$/, '') || apiBase;
}

const STATES: Record<string, PostState> = { QUEUE: 'queue', PUBLISHED: 'published', ERROR: 'error', DRAFT: 'draft' };

/** The posts `GET /posts` lists. */
export function readPosts(raw: unknown): PostizPost[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { posts?: unknown }).posts) ? (raw as { posts: unknown[] }).posts : Array.isArray(raw) ? raw : [];
  return list.flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const r = x as Record<string, unknown>;
    const id = str(r.id);
    const publishDate = str(r.publishDate);
    if (!id || !publishDate) return [];
    const ch = r.integration && typeof r.integration === 'object' ? (r.integration as Record<string, unknown>) : null;
    return [
      {
        id,
        group: str(r.group),
        content: typeof r.content === 'string' ? postizText(r.content) : '',
        publishDate,
        state: STATES[String(r.state ?? '').toUpperCase()] ?? 'queue',
        releaseURL: str(r.releaseURL),
        error: str(r.error),
        channel: ch && str(ch.id) ? { id: str(ch.id)!, name: str(ch.name) ?? '', identifier: str(ch.providerIdentifier) ?? str(ch.identifier) ?? '', picture: str(ch.picture) } : null,
      },
    ];
  });
}

/** The ids of the posts `POST /posts` made: `[{ postId }]` in the versions seen, or `{ posts: [{ id }] }`. */
export function readCreated(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { posts?: unknown }).posts) ? (raw as { posts: unknown[] }).posts : [];
  return list.flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const r = x as Record<string, unknown>;
    const id = str(r.postId) ?? str(r.id);
    return id ? [id] : [];
  });
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class PostizClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    /** The public API's base: `https://postiz.example/api/public/v1`. */
    public readonly apiBase: string,
    private readonly apiKey: string,
    fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}${path}`, { ...init, headers: { Authorization: this.apiKey, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new PostizError('Your Postiz did not answer — is it up, and does it allow this site (CORS)?');
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const said = body && typeof body === 'object' ? str((body as { message?: unknown }).message) ?? str((body as { msg?: unknown }).msg) : typeof body === 'string' ? body.slice(0, 200) : null;
      if (res.status === 401 || res.status === 403) throw new PostizError('Postiz refused the API key — paste it again from its Settings › Public API.', res.status);
      if (res.status === 413) throw new PostizError('The file is too large for your Postiz.', res.status);
      if (res.status === 429) throw new PostizError('Postiz says too many requests this hour — try again in a few minutes.', res.status);
      throw new PostizError(said ? `Postiz: ${said}` : `Postiz answered ${res.status}.`, res.status);
    }
    return body;
  }

  /** True when the key opens this Postiz. */
  async isConnected(): Promise<boolean> {
    const body = await this.call('/is-connected');
    return Boolean(body && typeof body === 'object' && (body as { connected?: unknown }).connected !== false);
  }

  async channels(): Promise<PostizChannel[]> {
    return readChannels(await this.call('/integrations'));
  }

  async upload(file: File, signal?: AbortSignal): Promise<PostizMedia> {
    const problem = uploadProblem(file);
    if (problem) throw new PostizError(problem);
    const form = new FormData();
    form.append('file', file, file.name);
    const body = await this.call('/upload', { method: 'POST', body: form, signal });
    const r = (body ?? {}) as Record<string, unknown>;
    const id = str(r.id);
    const path = str(r.path);
    if (!id || !path) throw new PostizError('Postiz took the file but did not say where it keeps it.');
    return { id, path };
  }

  /** The post made, its ids. */
  async createPost(req: PostRequest, signal?: AbortSignal): Promise<string[]> {
    return readCreated(await this.call('/posts', { method: 'POST', body: JSON.stringify(postBody(req)), signal }));
  }

  async posts(from: Date, to: Date): Promise<PostizPost[]> {
    const q = new URLSearchParams({ startDate: from.toISOString(), endDate: to.toISOString() });
    return readPosts(await this.call(`/posts?${q}`));
  }

  async deletePost(id: string): Promise<void> {
    await this.call(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

/** The first of `candidates` whose `/is-connected` answers with this key — the API's base, or the reason none did. */
export async function findApi(raw: string, apiKey: string, fetchImpl?: FetchLike): Promise<PostizClient> {
  let last: unknown = null;
  for (const base of apiCandidates(raw)) {
    const client = new PostizClient(base, apiKey, fetchImpl);
    try {
      if (await client.isConnected()) return client;
    } catch (err) {
      last = err;
      // A refused key is the answer, not a wrong address.
      if (err instanceof PostizError && (err.status === 401 || err.status === 403)) throw err;
    }
  }
  throw last instanceof Error ? last : new PostizError('No Postiz public API answered at that address.');
}
