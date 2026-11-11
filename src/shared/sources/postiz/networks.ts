/**
 * The NETWORKS a recap goes out on through the person's Postiz (lab 18, his
 * yes of 2026-11-11): Instagram, TikTok, YouTube, Bluesky, Threads and X —
 * what each one takes (the film, pictures, a story), how long its words may
 * be, the title it wants, the settings its post carries, and whether its own
 * music library can be searched through Postiz.
 *
 * Read from each channel's schema on his Postiz (`integrationSchema`,
 * 2026-11-11): the caption lengths, the required settings and the music tools
 * are Postiz's own; the durations are the networks' documented caps and are
 * WARNED, never trusted blindly — Postiz says what the network refused.
 *
 * Pure and DOM-free.
 */

import type { PostKind } from './client';

export type NetworkId = 'instagram' | 'tiktok' | 'youtube' | 'bluesky' | 'threads' | 'x';

export interface Network {
  id: NetworkId;
  label: string;
  /** Two letters for its mark. */
  mark: string;
  captionMax: number;
  /** A title beside the words (TikTok 90, YouTube 100), or null. */
  titleMax: number | null;
  titleRequired: boolean;
  /** Pictures one post holds; 0 = a video only. */
  pictures: number;
  /** Pictures and clips together in one post. */
  mixed: boolean;
  story: boolean;
  /** The longest film it takes, in seconds; null = no cap worth saying. */
  maxSeconds: number | null;
  /** What the film is called there. */
  film: string;
}

export const NETWORKS: Record<NetworkId, Network> = {
  instagram: { id: 'instagram', label: 'Instagram', mark: 'IG', captionMax: 2200, titleMax: null, titleRequired: false, pictures: 10, mixed: true, story: true, maxSeconds: 900, film: 'Reel' },
  tiktok: { id: 'tiktok', label: 'TikTok', mark: 'TT', captionMax: 2000, titleMax: 90, titleRequired: false, pictures: 35, mixed: false, story: false, maxSeconds: 600, film: 'Video' },
  youtube: { id: 'youtube', label: 'YouTube', mark: 'YT', captionMax: 5000, titleMax: 100, titleRequired: true, pictures: 0, mixed: false, story: false, maxSeconds: null, film: 'Short' },
  bluesky: { id: 'bluesky', label: 'Bluesky', mark: 'bs', captionMax: 300, titleMax: null, titleRequired: false, pictures: 4, mixed: false, story: false, maxSeconds: 180, film: 'Video' },
  threads: { id: 'threads', label: 'Threads', mark: '@', captionMax: 500, titleMax: null, titleRequired: false, pictures: 20, mixed: true, story: false, maxSeconds: 300, film: 'Video' },
  x: { id: 'x', label: 'X', mark: 'X', captionMax: 280, titleMax: null, titleRequired: false, pictures: 4, mixed: false, story: false, maxSeconds: 140, film: 'Video' },
};

export const NETWORK_ORDER: readonly NetworkId[] = ['instagram', 'tiktok', 'youtube', 'bluesky', 'threads', 'x'];

const BY_IDENTIFIER: Record<string, NetworkId> = {
  instagram: 'instagram',
  'instagram-standalone': 'instagram',
  tiktok: 'tiktok',
  'tiktok-business': 'tiktok',
  youtube: 'youtube',
  bluesky: 'bluesky',
  threads: 'threads',
  x: 'x',
};

/** The network a Postiz channel publishes to, from its provider identifier; null = one Recap does not post to yet. */
export function networkOf(identifier: string): Network | null {
  const id = BY_IDENTIFIER[identifier.toLowerCase()];
  return id ? NETWORKS[id] : null;
}

/** A network's own music library as Postiz reaches it: the tool to search it, and the setting a post carries the track in. */
export function musicLibrary(identifier: string): { tool: string; key: 'audio' | 'music' } | null {
  const id = identifier.toLowerCase();
  // Instagram's library needs the Facebook Business connector; TikTok's, a Business account.
  if (id === 'instagram') return { tool: 'audioSearch', key: 'audio' };
  if (id === 'tiktok-business') return { tool: 'musicSearch', key: 'music' };
  return null;
}

export type MediaType = 'picture' | 'video';
export const mediaTypeOf = (mime: string): MediaType => (mime.startsWith('video/') ? 'video' : 'picture');

export interface NetworkPlan {
  ok: true;
  /** What it goes out as there: `Reel`, `Short`, `4 pictures`… */
  as: string;
  /** Which of the post's files it takes, by index. */
  take: number[];
  /** What was left out, said; null when everything goes. */
  note: string | null;
}
export interface NetworkRefusal {
  ok: false;
  why: string;
}

/**
 * What ONE network receives of a post of `kind` made of `media` (in order):
 * the film whole, a story on Instagram only, a carousel cut to what the
 * network holds — its first pictures where pictures and clips cannot mix
 * (his pick, lab 18 Q6: the first four on Bluesky and X, said).
 */
export function networkPlan(net: Network, kind: PostKind, media: readonly MediaType[], seconds: number | null = null): NetworkPlan | NetworkRefusal {
  if (!media.length) return { ok: false, why: 'Nothing to send.' };
  if (kind === 'story') {
    return net.story ? { ok: true, as: 'Story', take: [0], note: null } : { ok: false, why: `A story is Instagram’s: ${net.label} has none through Postiz.` };
  }
  if (kind === 'reel') {
    if (net.maxSeconds !== null && seconds !== null && seconds > net.maxSeconds + 0.5) return { ok: false, why: `${net.label} takes a video up to ${net.maxSeconds} s — this film is ${Math.round(seconds)} s.` };
    return { ok: true, as: net.film, take: [0], note: null };
  }
  if (net.pictures === 0) return { ok: false, why: `${net.label} takes a video only — send the film there.` };
  const all = media.map((_, i) => i);
  const pool = net.mixed ? all : all.filter((i) => media[i] === 'picture');
  if (!pool.length) return { ok: false, why: `${net.label} takes pictures or one video, not a carousel of clips.` };
  const take = pool.slice(0, net.pictures);
  const left = media.length - take.length;
  const what = net.mixed ? `${take.length} slide${take.length === 1 ? '' : 's'}` : `${take.length} picture${take.length === 1 ? '' : 's'}`;
  return {
    ok: true,
    as: net.id === 'instagram' ? `Carousel · ${take.length}` : what,
    take,
    note: left > 0 ? `${net.label} gets the first ${what} of ${media.length}.` : null,
  };
}

/** A text's length as the network counts it: code points, an astral one (an emoji) as two on X. */
export function captionLength(text: string, net: Pick<Network, 'id'>): number {
  let n = 0;
  for (const ch of text) n += net.id === 'x' && ch.codePointAt(0)! > 0xffff ? 2 : 1;
  return n;
}

const TAG = /#[\p{L}\p{N}_]+/gu;

/** The hashtags a text carries, in order, each once. */
export function hashtagsIn(text: string): string[] {
  return [...new Set(text.match(TAG) ?? [])];
}

/**
 * `text` made to fit a network's length (lab 18, his pick: shortened by
 * Atelier, then read): untouched when it fits; else its words cut at the last
 * sentence or line that fits, and as many of its first hashtags as still fit
 * (two at most) on a line of their own.
 */
export function fitCaption(text: string, net: Pick<Network, 'id' | 'captionMax'>): string {
  const max = net.captionMax;
  const len = (s: string) => captionLength(s, net);
  if (len(text) <= max) return text;
  const tags = hashtagsIn(text).slice(0, 2);
  const body = text
    .replace(TAG, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  let tail = '';
  for (const t of tags) {
    const next = tail ? `${tail} ${t}` : t;
    if (len(next) + 2 <= max * 0.4) tail = next;
  }
  const room = max - (tail ? len(tail) + 2 : 0);
  if (len(body) <= room) return tail ? `${body}\n\n${tail}` : body;
  // Cut by code points, then back to the last sentence or line end worth keeping.
  let cut = '';
  for (const ch of body) {
    if (len(cut + ch) > room - 1) break;
    cut += ch;
  }
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
  const space = cut.lastIndexOf(' ');
  const kept = stop > cut.length * 0.4 ? cut.slice(0, stop + 1).trim() : `${(space > cut.length * 0.4 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/u, '')}…`;
  return tail ? `${kept}\n\n${tail}` : kept;
}

/** A title from a caption: its first line, without hashtags or a pin, cut at a word to `max`. */
export function titleFrom(text: string, max: number): string {
  const line = (text.split('\n').find((l) => l.replace(TAG, '').trim()) ?? '').replace(TAG, '').replace(/📍\s*/gu, '').replace(/\s+/g, ' ').trim();
  if ([...line].length <= max) return line;
  const cut = [...line].slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/u, '')}…`;
}

/** A track of a network's music library, as its search lists it. */
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  image: string | null;
  /** Seconds. */
  seconds: number;
  /** Where it can be listened to — a signed address that expires. */
  previewUrl: string | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The tracks a music search answered (`{ output: [...] }`, or the list itself). */
export function readTracks(raw: unknown): MusicTrack[] {
  const out = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { output?: unknown }).output : raw;
  if (!Array.isArray(out)) return [];
  return out.flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const r = x as Record<string, unknown>;
    const id = text(r.id) ?? (typeof r.id === 'number' ? String(r.id) : null);
    if (!id) return [];
    const ms = typeof r.duration === 'number' && Number.isFinite(r.duration) ? r.duration : 0;
    const url = text(r.previewUrl) ?? text(r.preview_url);
    return [{ id, title: text(r.title) ?? 'Untitled', artist: text(r.artist) ?? '', image: text(r.image), seconds: Math.round(ms > 1000 ? ms / 1000 : ms), previewUrl: url && /^https:\/\//.test(url) ? url : null }];
  });
}

/** The music a post carries from the network's library, and how loud beside the film's own sound (0–100). */
export interface PostMusic {
  track: Pick<MusicTrack, 'id' | 'title' | 'artist' | 'image'>;
  musicVolume: number;
  filmVolume: number;
}

export interface SettingsInput {
  /** The channel's provider identifier — the settings' `__type`. */
  identifier: string;
  kind: PostKind;
  /** What the network takes of this post: pictures only, or a video. */
  media: readonly MediaType[];
  caption: string;
  title?: string | null;
  trial?: boolean;
  graduate?: 'auto' | 'manual';
  collaborators?: readonly string[];
  music?: PostMusic | null;
}

const vol = (n: number) => Math.round(Math.min(100, Math.max(0, n)));

/** The provider settings one post carries, as that network's schema on Postiz asks them. */
export function settingsFor(input: SettingsInput): Record<string, unknown> {
  const net = networkOf(input.identifier);
  const settings: Record<string, unknown> = { __type: input.identifier || 'instagram' };
  const video = input.media.some((m) => m === 'video');
  const lib = musicLibrary(input.identifier);
  const music = input.music && lib && input.kind === 'reel' ? { id: input.music.track.id, title: input.music.track.title, artist: input.music.track.artist, ...(input.music.track.image ? { image: input.music.track.image } : {}), audio_volume: vol(input.music.musicVolume), video_volume: vol(input.music.filmVolume) } : null;
  const title = net?.titleMax ? titleFrom(input.title?.trim() || input.caption, net.titleMax) : '';
  switch (net?.id) {
    case 'tiktok':
      Object.assign(settings, {
        ...(title ? { title } : {}),
        privacy_level: 'PUBLIC_TO_EVERYONE',
        duet: video,
        stitch: video,
        comment: true,
        autoAddMusic: 'no',
        brand_content_toggle: false,
        brand_organic_toggle: false,
        content_posting_method: 'DIRECT_POST',
        ...(music ? { [lib!.key]: music } : {}),
      });
      break;
    case 'youtube':
      Object.assign(settings, {
        title: title.length >= 2 ? title : 'Recap',
        type: 'public',
        selfDeclaredMadeForKids: 'no',
        tags: hashtagsIn(input.caption)
          .slice(0, 10)
          .map((t) => ({ value: t.slice(1), label: t.slice(1) })),
      });
      break;
    case 'x':
      Object.assign(settings, { who_can_reply_post: 'everyone', community: '' });
      break;
    case 'bluesky':
    case 'threads':
      break;
    default: {
      // Instagram, and what an unknown provider is sent as.
      settings.post_type = input.kind === 'story' ? 'story' : 'post';
      if (input.kind === 'reel' && input.trial) {
        settings.is_trial_reel = true;
        settings.graduation_strategy = input.graduate === 'manual' ? 'MANUAL' : 'SS_PERFORMANCE';
      }
      const collaborators = (input.collaborators ?? []).map((c) => c.trim().replace(/^@/, '')).filter(Boolean);
      if (collaborators.length && input.kind !== 'story') settings.collaborators = collaborators.map((label) => ({ label }));
      if (music) settings[lib!.key] = music;
    }
  }
  return settings;
}

/**
 * Posts that are ONE moment of the rhythm: the same recap on several networks
 * goes out together, or a couple of hours apart, and counts once (his pick,
 * lab 18 Q3). Posts on DIFFERENT channels within `windowMs` of the moment's
 * first are folded into it; two posts on one channel never are.
 */
export function postMoments(posts: readonly { at: Date; channelId: string | null }[], windowMs = 3 * 3600_000): Date[] {
  const sorted = [...posts].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: { at: Date; channels: Set<string | null> }[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.at.getTime() - last.at.getTime() <= windowMs && p.channelId !== null && !last.channels.has(p.channelId)) last.channels.add(p.channelId);
    else out.push({ at: p.at, channels: new Set([p.channelId]) });
  }
  return out.map((m) => m.at);
}
