/**
 * The MCP half of the agent bridge, as PURE functions — what
 * `scripts/atelier-mcp.mjs` answers an MCP client (Claude Code, Claude
 * Desktop, any client speaking the Model Context Protocol over stdio) and
 * what it relays to the Atelier tab.
 *
 * The shape (`docs/memory/agent-commands.md`):
 *
 *   MCP client ──stdio (JSON-RPC)──▶ atelier-mcp.mjs ──SSE / POST, 127.0.0.1──▶ the tab
 *
 * Atelier has no backend, so the commands live in the TAB (`registry.ts`);
 * the script is a relay that never decides anything. It offers three generic
 * tools rather than one per command — the tab's commands come and go with the
 * screen on it, and a client lists tools once:
 *
 * - `atelier_status`: whether a tab is connected, and where it is;
 * - `atelier_commands`: the commands open right now, with their parameters
 *   as JSON Schema and why an unavailable one is not;
 * - `atelier_run`: run one, its answer as text, or as an IMAGE the model sees.
 *
 * Self-contained on purpose: Node imports this file directly (type stripping,
 * Node ≥ 22.18), which resolves only explicit file names — so it imports
 * nothing, and the few types it shares with `registry.ts` are restated here.
 */

/** The MCP revision this server speaks when the client does not name one it knows. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';
const KNOWN_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const BRIDGE_DEFAULT_PORT = 7981;

/** A JSON-RPC 2.0 message as it arrives on stdin. */
export interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** What the script tells the tab to do. */
export type TabRequest = { id: string; kind: 'list' } | { id: string; kind: 'run'; command: string; params: Record<string, unknown> };

/** What the tab answers: one request's outcome, or who it is. */
export type TabMessage =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string } }
  | { hello: { app: string; route: string; title: string } };

/** An MCP content block. */
export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

export const MCP_TOOLS = [
  {
    name: 'atelier_status',
    description:
      'Whether an Atelier tab is connected to this bridge, and where it is (its route and screen). Call first. When no tab is connected, the answer says how to connect one.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'atelier_commands',
    description:
      'The commands the connected Atelier tab offers RIGHT NOW — they depend on the screen it shows (app.* always; develop.* while Develop is open). Each comes with its parameters as JSON Schema and, when it cannot run, the reason.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'atelier_run',
    description:
      'Run one Atelier command by id with its params, e.g. {"command":"develop.set","params":{"values":{"exposure":0.5}}}. Writes go through the same path as the author’s gestures: journaled, undoable (develop.undo), saved. A command answering a picture (develop.snapshot) returns it as an image. Typical flow: app.navigate → app.waitFor → the tool’s commands.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command id, from atelier_commands.' },
        params: { type: 'object', description: 'The command’s parameters; {} or absent for none.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A command result as MCP content: an image the model sees, or JSON text. */
export function toolContent(result: unknown): McpContent[] {
  if (isRecord(result) && result.kind === 'image' && typeof result.data === 'string' && typeof result.mimeType === 'string') {
    const note = typeof result.note === 'string' ? result.note : 'picture';
    const size = typeof result.width === 'number' && typeof result.height === 'number' ? ` · ${result.width} × ${result.height}` : '';
    return [
      { type: 'image', data: result.data, mimeType: result.mimeType },
      { type: 'text', text: `${note}${size}` },
    ];
  }
  return [{ type: 'text', text: result === undefined ? 'done' : JSON.stringify(result, null, 2) }];
}

/**
 * Read one line the tab POSTed. Null for anything that is not one of the two
 * shapes — the HTTP side answers 400 and the pending call keeps waiting.
 */
export function parseTabMessage(text: string): TabMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (isRecord(raw.hello)) {
    const h = raw.hello;
    return { hello: { app: String(h.app ?? ''), route: String(h.route ?? ''), title: String(h.title ?? '') } };
  }
  if (typeof raw.id !== 'string') return null;
  if (raw.ok === true) return { id: raw.id, ok: true, result: raw.result };
  if (raw.ok === false && isRecord(raw.error)) {
    return { id: raw.id, ok: false, error: { code: String(raw.error.code ?? 'failed'), message: String(raw.error.message ?? '') } };
  }
  return null;
}

/** Read one line the script sent the tab. Null for anything else. */
export function parseTabRequest(text: string): TabRequest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  if (raw.kind === 'list') return { id: raw.id, kind: 'list' };
  if (raw.kind === 'run' && typeof raw.command === 'string') {
    return { id: raw.id, kind: 'run', command: raw.command, params: isRecord(raw.params) ? raw.params : {} };
  }
  return null;
}

/**
 * Whether a page at `origin` may connect as the tab. A browser always sends
 * `Origin` on these cross-origin requests and a page cannot forge it, so this
 * is what keeps any other site the person has open from receiving the agent's
 * commands. Loopback pages (a dev server, `vite preview`) are always allowed;
 * the deployed site and anything in `extra` (ATELIER_ORIGINS) by exact match.
 */
export function originAllowed(origin: string | undefined, extra: readonly string[] = []): boolean {
  if (!origin) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
  return [...DEPLOYED_ORIGINS, ...extra].includes(origin);
}

/** Where Atelier is deployed: its own domain, and the Pages address under it. */
export const DEPLOYED_ORIGINS: readonly string[] = ['https://atelier.steeve.website', 'https://costardrouge.github.io'];

/** What `atelier_status` answers when no tab is connected: how to connect one. */
export function notConnectedText(port: number): string {
  return [
    'No Atelier tab is connected to this bridge.',
    `Open Atelier (the deployed site or \`npm run dev\`), go to #/sources and, under "Agent bridge", connect on port ${port}.`,
    'The tab then shows an "Agent" pill in its masthead; nothing reaches it before that click.',
  ].join('\n');
}

/** What the script needs from its environment to answer one MCP message. */
export interface McpDeps {
  serverVersion: string;
  /** The tab as last introduced, or null when none is connected. */
  tab: () => { route: string; title: string; since: number } | null;
  port: number;
  /** Where the bridge writes an agent's exports. */
  outDir?: string;
  /** What keeps the bridge from working at all (the port taken by another), or null. */
  problem?: () => string | null;
  /** Relay to the tab; rejects with an Error whose message is said to the model. */
  relay: (request: { kind: 'list' } | { kind: 'run'; command: string; params: Record<string, unknown> }) => Promise<unknown>;
}

function reply(id: RpcMessage['id'], result: unknown): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(id: RpcMessage['id'], code: number, message: string): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function callTool(name: string, args: Record<string, unknown>, deps: McpDeps): Promise<McpToolResult> {
  const err = (text: string): McpToolResult => ({ content: [{ type: 'text', text }], isError: true });
  const tab = deps.tab();
  const problem = deps.problem?.() ?? null;
  if (problem) return err(problem);
  if (name === 'atelier_status') {
    if (!tab) return { content: [{ type: 'text', text: notConnectedText(deps.port) }] };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ connected: true, route: tab.route, title: tab.title, connectedFor: `${Math.round((Date.now() - tab.since) / 1000)} s`, port: deps.port, ...(deps.outDir ? { exportsGoTo: deps.outDir } : {}) }, null, 2),
        },
      ],
    };
  }
  if (name !== 'atelier_commands' && name !== 'atelier_run') return err(`no tool "${name}"`);
  if (!tab) return err(notConnectedText(deps.port));
  try {
    if (name === 'atelier_commands') return { content: toolContent(await deps.relay({ kind: 'list' })) };
    const command = args.command;
    if (typeof command !== 'string' || !command) return err('"command" is required — a command id from atelier_commands');
    const params = args.params === undefined || args.params === null ? {} : args.params;
    if (!isRecord(params)) return err('"params" must be an object');
    return { content: toolContent(await deps.relay({ kind: 'run', command, params })) };
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Answer one JSON-RPC message from the MCP client — null for a notification,
 * which takes no answer. Only what a tools-only server needs: `initialize`,
 * `ping`, `tools/list`, `tools/call`; anything else is "method not found".
 */
export async function handleMcpMessage(msg: RpcMessage, deps: McpDeps): Promise<RpcResponse | null> {
  const isNotification = msg.id === undefined;
  if (typeof msg.method !== 'string') return isNotification ? null : fail(msg.id, -32600, 'invalid request');
  if (isNotification) return null;
  const params = isRecord(msg.params) ? msg.params : {};
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return reply(msg.id, {
        protocolVersion: KNOWN_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'atelier', version: deps.serverVersion },
        instructions:
          'Atelier is a local-first suite of browser tools for photo and video captures. This bridge drives the Atelier tab the person connected: start with atelier_status, list what the current screen offers with atelier_commands, then atelier_run. Develop a photograph: app.navigate {path:"/develop/home"}, app.waitFor {command:"develop.rolls"}, develop.rolls, develop.openRoll, develop.pictures, develop.controls, develop.set, develop.snapshot to look at the result. Every write is undoable with develop.undo.',
      });
    }
    case 'ping':
      return reply(msg.id, {});
    case 'tools/list':
      return reply(msg.id, { tools: MCP_TOOLS });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const args = isRecord(params.arguments) ? params.arguments : {};
      return reply(msg.id, await callTool(name, args, deps));
    }
    default:
      return fail(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

// --- files the tab hands the bridge to write ------------------------------------

/** Largest file the bridge will write: a 16-bit PNG of a 60-megapixel picture fits. */
export const MAX_FILE_BYTES = 768 * 1024 * 1024;

/**
 * The path, under the bridge's output folder, that a file named `name` in
 * sub-folder `folder` (`Web/Variant 2`, or empty) is written to — as
 * segments — or null for anything that could step outside that folder: an
 * empty or dot segment, a separator inside a name, a control character, a
 * name over 200 characters. The tab is trusted to name its files; the bridge
 * still never writes where it was not told it could.
 */
export function safeOutputPath(folder: string, name: string): string[] | null {
  const segments = [...folder.split('/').filter((s) => s !== ''), name];
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || seg.trim() === '') return null;
    if (seg.length > 200) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\\/\u0000-\u001f:*?"<>|]/.test(seg)) return null;
  }
  return segments;
}

/**
 * `DJI_0101.jpg` → `DJI_0101-1.jpg` for n = 1: the bridge numbers a taken
 * name, never overwrites — the suite's own `-1`, `-2` (`unique-name.ts`).
 */
export function numberedName(name: string, n: number): string {
  if (n <= 0) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

// --- the bridge as a Claude Desktop extension -----------------------------------

/** Where the bridge's entry sits inside the bundle. */
export const MCPB_ENTRY = 'server/atelier-mcp.mjs';

/**
 * The `manifest.json` of the bridge packaged as an MCP bundle (`.mcpb`, a
 * plain ZIP Claude Desktop installs from a dialog when the file is opened):
 * a `node` server whose entry is the same single file the site serves, its
 * three tools listed from {@link MCP_TOOLS} so the two can never disagree.
 * Claude Desktop runs it with its own Node.js — no terminal, no path to type.
 */
export function mcpbManifest(version: string, homepage: string): Record<string, unknown> {
  return {
    manifest_version: '0.3',
    name: 'atelier',
    display_name: 'Atelier',
    version,
    description: 'Drive the Atelier tab open in your browser — develop, crop, grade and export your photos — from Claude.',
    long_description:
      'Atelier runs entirely in your browser. This extension is the small bridge between Claude and the Atelier tab you connect on its Sources screen: it listens on 127.0.0.1 only, answers only Atelier’s own pages, and writes an agent’s exports into ~/Pictures/Atelier, never over an existing file. Every edit goes through Atelier’s own controls, journaled and undoable.',
    author: { name: 'Steeve Pommier', url: homepage },
    homepage,
    server: {
      type: 'node',
      entry_point: MCPB_ENTRY,
      mcp_config: { command: 'node', args: [`\${__dirname}/${MCPB_ENTRY}`] },
    },
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    keywords: ['photo', 'develop', 'raw', 'lut', 'atelier'],
  };
}
