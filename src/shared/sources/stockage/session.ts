import * as oauth from 'oauth4webapi';
import { SCOPE, SESAME_CLIENT_ID, SESAME_ISSUER, STOCKAGE_URL } from './config';

/**
 * Signing in to Sésame from the page. Atelier has no server (GitHub Pages),
 * so it is a PUBLIC client: authorization code + PKCE, the code exchanged by
 * the page itself — Sésame allows its token endpoint from the origin of a
 * public app's redirect address. The protocol is `oauth4webapi`'s (panva,
 * OpenID-certified), never written here. Sketchbook does the same
 * (CostardRouge/p5-templates, `src/lib/stockage/session.ts`); a fix to one
 * belongs in the other.
 *
 * Three things the flow needs, or Sésame silently answers with its opaque
 * `/me` token instead of one the store reads: `resource` on the authorization
 * request AND on every token request (the code and each refresh), the scope
 * `stockage`, and `offline_access` with `prompt=consent` for a refresh token.
 *
 * The redirect address is the site's ROOT (the base path), with the code in
 * the query: a hash route cannot be a redirect address (an OAuth redirect
 * carries no fragment). `main.tsx` finishes the sign-in before the app draws,
 * then puts the hash route back.
 *
 * Kept in `localStorage` (`atelier.sesame.v1`). The refresh token ROTATES and
 * a reused one makes Sésame revoke the grant, so a refresh runs under a Web
 * Lock and re-reads storage inside it — two tabs never refresh at once.
 */

const KEY = 'atelier.sesame.v1';
const PENDING_KEY = 'atelier.sesame.pending';
const LOCK = 'atelier-sesame-refresh';
const MARGIN_MS = 60_000;

export interface SesameSession {
  sub: string;
  name: string | null;
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
  refreshToken: string | null;
  signedInAt: number;
}

interface Pending {
  verifier: string;
  state: string;
  /** The hash route to land on afterwards. */
  returnTo: string;
}

const client: oauth.Client = { client_id: SESAME_CLIENT_ID };
const clientAuth = oauth.None();
const listeners = new Set<() => void>();
let server: Promise<oauth.AuthorizationServer> | null = null;
let cache: SesameSession | null | undefined;
let lastProblem: string | null = null;

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

/** A stored session read back, or null when it is not one. (pure) */
export function readSession(raw: unknown): SesameSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.sub !== 'string' || !r.sub || typeof r.accessToken !== 'string' || typeof r.expiresAt !== 'number') {
    return null;
  }
  return {
    sub: r.sub,
    name: typeof r.name === 'string' ? r.name : null,
    accessToken: r.accessToken,
    expiresAt: r.expiresAt,
    refreshToken: typeof r.refreshToken === 'string' ? r.refreshToken : null,
    signedInAt: typeof r.signedInAt === 'number' ? r.signedInAt : 0,
  };
}

/** Where to land after a sign-in: a hash route of ours, never another origin. (pure) */
export function safeReturn(raw: string | null | undefined): string {
  return typeof raw === 'string' && /^#\/[^/]/.test(raw) ? raw : '#/sources';
}

function load(): SesameSession | null {
  try {
    return readSession(JSON.parse(storage('local')?.getItem(KEY) ?? 'null'));
  } catch {
    return null;
  }
}

function save(next: SesameSession | null): void {
  cache = next;
  try {
    if (next) storage('local')?.setItem(KEY, JSON.stringify(next));
    else storage('local')?.removeItem(KEY);
  } catch {
    // A private window keeps the session for this visit only.
  }
  for (const listener of listeners) listener();
}

export function getSesameSession(): SesameSession | null {
  if (cache === undefined) cache = load();
  return cache;
}

export function subscribeSesameSession(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      cache = load();
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function authorizationServer(): Promise<oauth.AuthorizationServer> {
  if (!server) {
    const issuer = new URL(SESAME_ISSUER);
    server = oauth
      .discoveryRequest(issuer, { algorithm: 'oidc' })
      .then((response) => oauth.processDiscoveryResponse(issuer, response));
    // A failed discovery (Sésame down) must not stick for the page's life.
    server.catch(() => {
      server = null;
    });
  }
  return server;
}

/** The site's root, where Sésame sends the person back: registered in Sésame as is. */
export function redirectUri(): string {
  return new URL(import.meta.env.BASE_URL, location.origin).toString();
}

const resource = (): Record<string, string> => ({ resource: STOCKAGE_URL });

function sessionFrom(tokens: oauth.TokenEndpointResponse, previous: SesameSession | null): SesameSession {
  const claims = oauth.getValidatedIdTokenClaims(tokens);
  const sub = claims?.sub ?? previous?.sub;
  if (!sub) throw new Error('Sésame answered without saying who signed in');
  return {
    sub,
    name: typeof claims?.name === 'string' ? claims.name : (previous?.name ?? null),
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? null,
    signedInAt: previous?.signedInAt ?? Date.now(),
  };
}

/** Leave for Sésame; it sends the person back to the site's root, then `returnTo`. */
export async function signInWithSesame(returnTo: string = location.hash): Promise<void> {
  const as = await authorizationServer();
  if (!as.authorization_endpoint) throw new Error('Sésame does not say where to sign in');
  const verifier = oauth.generateRandomCodeVerifier();
  const state = oauth.generateRandomState();
  const pending: Pending = { verifier, state, returnTo: safeReturn(returnTo) };
  storage('session')?.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = new URL(as.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: SESAME_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    ...resource(),
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    prompt: 'consent',
  }).toString();
  location.assign(url.toString());
}

/**
 * Whether this page load is Sésame sending the person back: a `code` and a
 * `state` in the query, and a sign-in this tab started. (pure on its input)
 */
export function isSesameReturn(search: string, pending: string | null): boolean {
  const params = new URLSearchParams(search);
  return pending !== null && params.has('state') && (params.has('code') || params.has('error'));
}

/**
 * At boot (`main.tsx`): finish a sign-in this tab started, then drop the
 * query and land on the hash route it started from. Does nothing on an
 * ordinary load; never throws — a failure lands on `#/sources` with the
 * reason kept for the row to show.
 */
export async function completeSesameReturn(): Promise<void> {
  const pendingRaw = storage('session')?.getItem(PENDING_KEY) ?? null;
  if (!isSesameReturn(location.search, pendingRaw)) return;
  storage('session')?.removeItem(PENDING_KEY);
  let landing = '#/sources';
  try {
    const pending = JSON.parse(pendingRaw ?? 'null') as Pending | null;
    if (!pending?.verifier) throw new Error('This sign-in was not started from this tab');
    landing = safeReturn(pending.returnTo);
    const as = await authorizationServer();
    const params = oauth.validateAuthResponse(as, client, new URL(location.href), pending.state);
    const response = await oauth.authorizationCodeGrantRequest(as, client, clientAuth, params, redirectUri(), pending.verifier, {
      additionalParameters: resource(),
    });
    save(sessionFrom(await oauth.processAuthorizationCodeResponse(as, client, response), null));
    lastProblem = null;
  } catch (err) {
    lastProblem = err instanceof Error ? err.message : String(err);
    landing = '#/sources';
  }
  history.replaceState(null, '', `${location.pathname}${landing}`);
}

/** Why the last sign-in did not finish, for the sources row; null when it did. */
export function sesameProblem(): string | null {
  return lastProblem;
}

async function refresh(): Promise<SesameSession | null> {
  const stored = load();
  if (!stored) {
    save(null);
    return null;
  }
  if (stored.expiresAt - MARGIN_MS > Date.now()) {
    cache = stored;
    return stored;
  }
  if (!stored.refreshToken) {
    save(null);
    return null;
  }
  const as = await authorizationServer();
  const response = await oauth.refreshTokenGrantRequest(as, client, clientAuth, stored.refreshToken, {
    additionalParameters: resource(),
  });
  try {
    const next = sessionFrom(await oauth.processRefreshTokenResponse(as, client, response), stored);
    save(next);
    return next;
  } catch (err) {
    // Sésame refused (signed out there, membership removed, grant revoked): signed out here too.
    if (err instanceof oauth.ResponseBodyError) {
      save(null);
      return null;
    }
    throw err;
  }
}

let refreshing: Promise<SesameSession | null> | null = null;

/** A valid access token for the store, refreshed when needed; null when signed out. */
export async function sesameAccessToken(): Promise<string | null> {
  const current = getSesameSession();
  if (!current) return null;
  if (current.expiresAt - MARGIN_MS > Date.now()) return current.accessToken;
  if (!refreshing) {
    const run = () => refresh();
    refreshing = (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(LOCK, run) : run()).finally(
      () => {
        refreshing = null;
      },
    );
  }
  return (await refreshing)?.accessToken ?? null;
}

/** Forget the session here and revoke its refresh token. Sésame's own sign-in stays. */
export async function signOutOfSesame(): Promise<void> {
  const current = getSesameSession();
  save(null);
  if (!current?.refreshToken) return;
  try {
    const as = await authorizationServer();
    await oauth.processRevocationResponse(await oauth.revocationRequest(as, client, clientAuth, current.refreshToken));
  } catch {
    // Signed out here all the same.
  }
}
