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

/** How many commands one `atelier_batch` may run: a whole edit, not a whole roll's export. */
export const MAX_BATCH_STEPS = 25;

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
      'The commands the connected Atelier tab offers RIGHT NOW — they depend on the screen it shows (app.*, library.* and winnow.* always; develop.* while Develop is open). Each comes with its parameters as JSON Schema and, when it cannot run, the reason. Pass family (e.g. "develop") to list one family only.',
    inputSchema: {
      type: 'object',
      properties: { family: { type: 'string', description: 'Only commands whose id starts with this family and a dot, e.g. "develop", "winnow".' } },
      additionalProperties: false,
    },
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
  {
    name: 'atelier_batch',
    description:
      'Run several Atelier commands in order in one call — e.g. a develop.set, a develop.curve and a develop.measure — instead of one round trip each. Stops at the first refusal unless stopOnError is false; answers each step’s result (pictures as images) under its number.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: `The commands, in order — at most ${MAX_BATCH_STEPS}.`,
          items: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'The command id.' },
              params: { type: 'object', description: 'Its parameters.' },
            },
            required: ['command'],
            additionalProperties: false,
          },
        },
        stopOnError: { type: 'boolean', description: 'Stop at the first step that fails (the default) or run them all.' },
      },
      required: ['steps'],
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

/**
 * What the client is told once, at `initialize`: the shape of a session, so
 * the model does not have to discover the order by trial.
 */
export const MCP_INSTRUCTIONS = [
  'Atelier is a local-first suite of browser tools for photo and video captures; this bridge drives the Atelier tab the person connected. Start with atelier_status, then atelier_run "app.status" (where the tab is, which command families are open). List a family with atelier_commands {family}. Chain several writes with atelier_batch.',
  'FIND media first (always open, need a connected Winnow): winnow.calendar {month} → which days hold media; winnow.folders; winnow.assets {date|folder, verdict, minStars, tag, label} → rows with EXIF, GPS and Winnow’s culling; winnow.sheet → one image of thumbnails labelled by id, to choose by eye. PEOPLE: winnow.people (and winnow.peopleSheet to see their faces) gives ids and names; winnow.assets, winnow.sheet and develop.addFromWinnow take people:[ids] or who:["name"], together:true for everyone in one frame, faces: none|any|solo|group; winnow.faces {id} says who is in one medium. Naming or merging people is Winnow’s own MCP’s job.',
  'DEVELOP: app.navigate {path:"/develop/home"}, app.waitFor {command:"develop.rolls"}, develop.newRoll or develop.openRoll, develop.addFromWinnow {ids} (or {date, verdict…}), develop.contactSheet to see the whole roll, develop.openPicture, app.waitFor {command:"develop.snapshot"}, then develop.set / curve / grading / crop / addLook / auto…, develop.measure (histogram numbers) and develop.snapshot (the picture) to check, develop.applyTo or develop.applyPreset to spread a look, develop.exportSettings and develop.export (files land in the bridge’s folder).',
  'TRIPS (a day told as a reel, a carousel or a photo, with the trip’s badge): app.navigate {path:"/roadtrip/home"}, app.waitFor {command:"trips.list"}, trips.create or trips.open, trips.newPiece {date, kind}, app.waitFor {command:"trips.piece"}, library.addFromWinnow {ids} to bring the pictures in, trips.setPictures {assets}, trips.setOpener / trips.badge / trips.develop / trips.pieceSettings, trips.snapshot to look at a slide as exported, trips.export (files land in the bridge’s folder).',
  'Every write goes through the person’s own undo (develop.undo) and journal, marked as an agent’s. Values are refused outside their range, never clamped — read the refusal and retry. A command missing from the list belongs to a screen that is not open: navigate, then app.waitFor it.',
].join('\n\n');

/** What `atelier_status` answers when no tab is connected: how to connect one. */
export function notConnectedText(port: number): string {
  return [
    'No Atelier tab is connected to this bridge.',
    `Open Atelier (the deployed site or \`npm run dev\`), go to #/agents and press Connect (port ${port}).`,
    'The tab then shows an "Agent" pill in its masthead; nothing reaches it before that click.',
  ].join('\n');
}

/** What a bridge knows of the tab connected to it. */
export interface TabInfo {
  route: string;
  title: string;
  since: number;
}

/** What the script needs from its environment to answer one MCP message. */
export interface McpDeps {
  serverVersion: string;
  /**
   * The tab as last introduced, or null when none is connected — asked of the
   * HUB bridge when this one only follows it, hence the promise.
   */
  tab: () => TabInfo | null | Promise<TabInfo | null>;
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
  const problem = deps.problem?.() ?? null;
  const tab = problem ? null : await deps.tab();
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
  if (name !== 'atelier_commands' && name !== 'atelier_run' && name !== 'atelier_batch') return err(`no tool "${name}"`);
  if (!tab) return err(notConnectedText(deps.port));
  if (name === 'atelier_batch') return runBatch(args, deps);
  try {
    if (name === 'atelier_commands') {
      const listed = await deps.relay({ kind: 'list' });
      const family = typeof args.family === 'string' ? args.family.trim().replace(/\.$/, '') : '';
      if (!family || !Array.isArray(listed)) return { content: toolContent(listed) };
      const kept = listed.filter((c) => isRecord(c) && typeof c.id === 'string' && c.id.startsWith(`${family}.`));
      if (kept.length === 0) {
        const families = [...new Set(listed.flatMap((c) => (isRecord(c) && typeof c.id === 'string' ? [c.id.split('.')[0]] : [])))];
        return err(`no "${family}" command is open right now — the open families are ${families.join(', ')}`);
      }
      return { content: toolContent(kept) };
    }
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
 * `atelier_batch`: each step relayed in turn, its answer numbered — text as
 * `#n command → …`, a picture as its image block after its line. A refused
 * step is said and, unless asked otherwise, ends the batch: the next step was
 * written assuming this one held.
 */
async function runBatch(args: Record<string, unknown>, deps: McpDeps): Promise<McpToolResult> {
  const steps = args.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return { content: [{ type: 'text', text: '"steps" must be a non-empty list of {command, params}' }], isError: true };
  }
  if (steps.length > MAX_BATCH_STEPS) {
    return { content: [{ type: 'text', text: `"steps" holds ${steps.length} — ${MAX_BATCH_STEPS} at most a batch` }], isError: true };
  }
  const stop = args.stopOnError !== false;
  const content: McpContent[] = [];
  let failed = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const command = isRecord(step) && typeof step.command === 'string' ? step.command : '';
    const params = isRecord(step) && isRecord(step.params) ? step.params : {};
    const head = `#${i + 1} ${command || '(no command)'}`;
    if (!command) {
      failed += 1;
      content.push({ type: 'text', text: `${head} → refused: a step needs a command` });
      if (stop) break;
      continue;
    }
    try {
      const answer = toolContent(await deps.relay({ kind: 'run', command, params }));
      for (const block of answer) content.push(block.type === 'text' ? { type: 'text', text: `${head} → ${block.text}` } : block);
    } catch (e) {
      failed += 1;
      content.push({ type: 'text', text: `${head} → refused: ${e instanceof Error ? e.message : String(e)}` });
      if (stop) {
        if (i + 1 < steps.length) content.push({ type: 'text', text: `stopped — steps ${i + 2}…${steps.length} not run` });
        break;
      }
    }
  }
  return failed ? { content, isError: true } : { content };
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
        instructions: MCP_INSTRUCTIONS,
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

// --- two MCP apps, one tab: the second bridge FOLLOWS the first ------------------

/**
 * Claude Desktop and Claude Code each start their own bridge, and only one can
 * hold the port. The one that does is the HUB (the tab connects to it); a
 * bridge that finds the port taken by another Atelier bridge FOLLOWS it,
 * relaying its tool calls through the hub's `/peer/*` routes. Those routes are
 * for programs on this computer only: they refuse any request carrying an
 * `Origin` (every browser request does), and they ask for the hub's TOKEN,
 * written to a file only this user can read. A follower whose hub goes away
 * takes the port itself, and the tab reconnects to it on its own.
 */
export const PEER_STATUS_PATH = '/peer/status';
export const PEER_RELAY_PATH = '/peer/relay';

/** The token file's name for a port, inside `~/.atelier/`. */
export function peerTokenFile(port: number): string {
  return `bridge-${port}.token`;
}

/**
 * Whether a request to a `/peer/*` route may pass: no `Origin` (so not a web
 * page) and the hub's token as a bearer, compared in constant time.
 */
export function peerAuthorized(headers: { origin?: string; authorization?: string }, token: string): boolean {
  if (headers.origin !== undefined) return false;
  if (!token || token.length < 32) return false;
  const given = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1] ?? '';
  if (given.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/** A follower's relay request, or null when the body is not one. */
export function parsePeerRequest(text: string): { kind: 'list' } | { kind: 'run'; command: string; params: Record<string, unknown> } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (raw.kind === 'list') return { kind: 'list' };
  if (raw.kind === 'run' && typeof raw.command === 'string' && raw.command) {
    const params = raw.params === undefined ? {} : raw.params;
    return isRecord(params) ? { kind: 'run', command: raw.command, params } : null;
  }
  return null;
}
