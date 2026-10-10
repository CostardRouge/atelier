import { BRIDGE_DEFAULT_PORT, parseTabRequest, type TabRequest } from './mcp-protocol';
import { CommandError, commands, paramsJsonSchema } from './registry';
import type { DeliveryTarget } from '../sources/deliver-files';

/**
 * The TAB's half of the agent bridge (`mcp-protocol.ts`): it listens to the
 * local bridge (`scripts/atelier-mcp.mjs`) on 127.0.0.1, runs what it is sent
 * through the one registry, and posts the answers back.
 *
 * Nothing connects by itself: the person turns it on from `#/sources`, and
 * the choice is kept for this TAB only (`sessionStorage` — a reload keeps it,
 * a new tab does not), because a tab an agent drives should never be one the
 * person did not choose. While connected the masthead says so (`AgentPill`).
 */

export type BridgeState =
  | { status: 'off' }
  | { status: 'connecting'; port: number }
  | { status: 'connected'; port: number; since: number; runs: number; last: { command: string; ok: boolean; at: number } | null }
  | { status: 'waiting'; port: number; reason: string }
  | { status: 'replaced'; port: number };

const PREF_KEY = 'atelier.agentBridge';
const RETRY_MS = 5000;

let state: BridgeState = { status: 'off' };
const listeners = new Set<() => void>();
let source: EventSource | null = null;
let retry: number | null = null;
let routeListener: (() => void) | null = null;

function set(next: BridgeState) {
  state = next;
  for (const l of [...listeners]) l();
}

export function bridgeState(): BridgeState {
  return state;
}

export function subscribeBridge(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function rememberPort(port: number | null) {
  try {
    if (port === null) sessionStorage.removeItem(PREF_KEY);
    else sessionStorage.setItem(PREF_KEY, String(port));
  } catch {
    // Storage refused: the bridge still works, for this page load.
  }
}

/** The port this tab was connected on before a reload, or null. */
export function rememberedPort(): number | null {
  try {
    const v = Number(sessionStorage.getItem(PREF_KEY));
    return Number.isInteger(v) && v > 0 && v < 65536 ? v : null;
  } catch {
    return null;
  }
}

function base(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function post(port: number, body: unknown): Promise<void> {
  return fetch(`${base(port)}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(
    () => undefined,
    () => undefined,
  );
}

function hello(port: number) {
  void post(port, { hello: { app: 'atelier', route: window.location.hash.slice(1) || '/', title: document.title } });
}

async function answer(port: number, request: TabRequest) {
  if (request.kind === 'list') {
    const list = commands.list().map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      available: c.available,
      ...(c.reason ? { reason: c.reason } : {}),
      params: paramsJsonSchema(c.params),
    }));
    await post(port, { id: request.id, ok: true, result: list });
    return;
  }
  let ok = true;
  try {
    const result = await commands.execute(request.command, request.params);
    await post(port, { id: request.id, ok: true, result });
  } catch (err) {
    ok = false;
    const e = err instanceof CommandError ? err : new CommandError('failed', err instanceof Error ? err.message : String(err));
    await post(port, { id: request.id, ok: false, error: { code: e.code, message: e.message } });
  }
  if (state.status === 'connected' && state.port === port) {
    set({ ...state, runs: state.runs + 1, last: { command: request.command, ok, at: Date.now() } });
  }
}

function teardown() {
  source?.close();
  source = null;
  if (retry !== null) window.clearTimeout(retry);
  retry = null;
  if (routeListener) window.removeEventListener('hashchange', routeListener);
  routeListener = null;
}

function open(port: number) {
  teardown();
  set({ status: 'connecting', port });
  const es = new EventSource(`${base(port)}/events`);
  source = es;
  es.onopen = () => {
    set({ status: 'connected', port, since: Date.now(), runs: 0, last: null });
    hello(port);
    routeListener = () => window.setTimeout(() => hello(port), 0);
    window.addEventListener('hashchange', routeListener);
  };
  es.onmessage = (event) => {
    const request = parseTabRequest(String(event.data));
    if (request) void answer(port, request);
  };
  es.addEventListener('replaced', () => {
    // Another tab took the bridge: this one stands down and says so.
    teardown();
    rememberPort(null);
    set({ status: 'replaced', port });
  });
  es.onerror = () => {
    // The browser retries a dropped stream on its own; a refused or absent
    // bridge CLOSES it, and that is retried here on a slow tick, said.
    if (es.readyState !== EventSource.CLOSED) {
      if (state.status === 'connected') set({ status: 'waiting', port, reason: 'the bridge went away — reconnecting' });
      return;
    }
    if (source !== es) return;
    set({ status: 'waiting', port, reason: `no bridge answers on 127.0.0.1:${port} — is the app that runs it (Claude Desktop, Claude Code…) open?` });
    retry = window.setTimeout(() => open(port), RETRY_MS);
  };
}

/** Connect this tab to the bridge on `port`, and keep doing so across a reload. */
export function startBridge(port: number = BRIDGE_DEFAULT_PORT): void {
  rememberPort(port);
  open(port);
}

/** Disconnect, and forget it for this tab. */
export function stopBridge(): void {
  teardown();
  rememberPort(null);
  set({ status: 'off' });
}

/** At boot: reconnect a tab that was connected before its reload — never one that was not. */
export function resumeBridge(): void {
  const port = rememberedPort();
  if (port !== null) open(port);
}

/**
 * Where an agent's export goes: the bridge, which writes each file into the
 * output folder its person started it with (`--out`), never over an existing
 * file. Null while no bridge is connected — then an export needs a click on
 * a folder, which no agent can give. `onWritten` hears each file's path on
 * that computer.
 */
export function bridgeSink(onWritten: (path: string) => void): DeliveryTarget | null {
  if (state.status !== 'connected') return null;
  const port = state.port;
  return {
    kind: 'sink',
    write: async (file, folder) => {
      const res = await fetch(`${base(port)}/file`, {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-atelier-name': encodeURIComponent(file.name),
          'x-atelier-folder': encodeURIComponent(folder),
        },
        body: file,
      });
      const answer = (await res.json().catch(() => ({}))) as { path?: string; renamed?: boolean; error?: string };
      if (!res.ok || !answer.path) throw new Error(answer.error ?? `the bridge answered ${res.status}`);
      onWritten(answer.path);
      return { renamed: answer.renamed === true };
    },
  };
}
