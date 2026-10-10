#!/usr/bin/env node
// The Atelier MCP bridge: an MCP server on stdio for Claude Code (or any MCP
// client), relaying to the Atelier tab the person connected — over
// 127.0.0.1 only, Server-Sent Events down to the tab and POSTs back.
//
//   claude mcp add atelier -- node /path/to/atelier/scripts/atelier-mcp.mjs
//
// or, with no clone, the single file the site serves beside itself (built
// from this one by vite.config.ts, plain JavaScript, Node ≥ 18):
//
//   curl -fsSo ~/atelier-mcp.mjs https://atelier.steeve.website/atelier-mcp.mjs
//   claude mcp add atelier -- node ~/atelier-mcp.mjs
//
// Options: --port N (or ATELIER_BRIDGE_PORT; default 7981), --out DIR (or
// ATELIER_OUT; default ~/Pictures/Atelier) — where an agent's exports are
// written —, and ATELIER_ORIGINS=https://a,https://b to allow pages other
// than loopback and the deployed site. From the repo it needs Node ≥ 22.18
// (it imports the protocol module, a TypeScript file, through Node's own type
// stripping). No dependency.
//
// The decisions live in `src/shared/commands/mcp-protocol.ts` (pure, tested)
// and `docs/memory/agent-commands.md`. This file only moves bytes: stdout
// carries the protocol and nothing else — every log goes to stderr.

import http from 'node:http';
import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import {
  BRIDGE_DEFAULT_PORT,
  MAX_FILE_BYTES,
  handleMcpMessage,
  numberedName,
  originAllowed,
  parseTabMessage,
  safeOutputPath,
} from '../src/shared/commands/mcp-protocol.ts';

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const argPort = Number(arg('--port'));
/** Where an agent's exports land: chosen by whoever started the bridge. */
const OUT_DIR = path.resolve(arg('--out') ?? process.env.ATELIER_OUT ?? path.join(os.homedir(), 'Pictures', 'Atelier'));
const PORT = Number.isInteger(argPort) && argPort > 0 ? argPort : Number(process.env.ATELIER_BRIDGE_PORT) || BRIDGE_DEFAULT_PORT;
const EXTRA_ORIGINS = (process.env.ATELIER_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** Long enough for app.waitFor's own ceiling (120 s) and a RAW decode behind it. */
const RUN_TIMEOUT_MS = 150_000;
const LIST_TIMEOUT_MS = 15_000;
/** A snapshot at 2048 px is a few hundred kB of base64; this is far above it. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

// The published single file (built by vite.config.ts's `agentBridgePlugin`
// and served beside the site) has its version written in at build time; run
// from the repo, it reads package.json.
/* global ATELIER_BRIDGE_VERSION */
const version = (() => {
  if (typeof ATELIER_BRIDGE_VERSION === 'string') return ATELIER_BRIDGE_VERSION;
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const log = (...args) => console.error('[atelier-mcp]', ...args);

// --- the tab ---------------------------------------------------------------

/** The one connected tab: its event stream and what it said of itself. */
let tab = null;
let problem = null;
let nextId = 1;
/** id → { resolve, reject, timer } */
const pending = new Map();

function dropPending(reason) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pending.delete(id);
  }
}

function relay(request) {
  if (!tab) return Promise.reject(new Error('no Atelier tab is connected'));
  const id = String(nextId++);
  const message = request.kind === 'list' ? { id, kind: 'list' } : { id, kind: 'run', command: request.command, params: request.params };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error(`the tab did not answer within ${(request.kind === 'list' ? LIST_TIMEOUT_MS : RUN_TIMEOUT_MS) / 1000} s — is it still open?`));
      },
      request.kind === 'list' ? LIST_TIMEOUT_MS : RUN_TIMEOUT_MS,
    );
    pending.set(id, { resolve, reject, timer });
    tab.res.write(`data: ${JSON.stringify(message)}\n\n`);
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-atelier-name, x-atelier-folder',
    // Chrome's Private / Local Network Access: a public page reaching
    // loopback asks this in its preflight.
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  };
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin, EXTRA_ORIGINS)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('origin not allowed\n');
    if (origin) log(`refused a connection from ${origin} (ATELIER_ORIGINS allows more)`);
    return;
  }
  const cors = corsHeaders(origin);
  const path_ = (req.url ?? '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method === 'GET' && path_ === '/events') {
    // A newer tab REPLACES the older one: the person connected it last.
    if (tab) {
      tab.res.write('event: replaced\ndata: {}\n\n');
      tab.res.end();
      dropPending('the tab was replaced by another one');
    }
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': atelier bridge\n\n');
    const me = { res, since: Date.now(), route: '', title: '', origin };
    tab = me;
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    log(`tab connected from ${origin}`);
    req.on('close', () => {
      clearInterval(keepAlive);
      if (tab === me) {
        tab = null;
        dropPending('the tab disconnected');
        log('tab disconnected');
      }
    });
    return;
  }

  if (req.method === 'POST' && path_ === '/message') {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, cors);
        res.end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      const msg = parseTabMessage(Buffer.concat(chunks).toString('utf8'));
      if (!msg) {
        res.writeHead(400, cors);
        res.end();
        return;
      }
      if ('hello' in msg) {
        if (tab) Object.assign(tab, { route: msg.hello.route, title: msg.hello.title });
      } else {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        }
      }
      res.writeHead(204, cors);
      res.end();
    });
    return;
  }

  if (req.method === 'POST' && path_ === '/file') {
    // A file the tab rendered for an agent's export, streamed to disk under
    // OUT_DIR — never outside it, never over an existing file.
    const fail = (code, message) => {
      if (!res.headersSent) res.writeHead(code, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    let name;
    let folder;
    try {
      name = decodeURIComponent(String(req.headers['x-atelier-name'] ?? ''));
      folder = decodeURIComponent(String(req.headers['x-atelier-folder'] ?? ''));
    } catch {
      fail(400, 'the file name is not readable');
      return;
    }
    const segments = safeOutputPath(folder, name);
    if (!segments) {
      fail(400, `refused to write "${folder ? `${folder}/` : ''}${name}" — not a plain name under the output folder`);
      return;
    }
    const dir = path.join(OUT_DIR, ...segments.slice(0, -1));
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      fail(500, `could not make ${dir}: ${err.message}`);
      return;
    }
    let n = 0;
    let target = path.join(dir, segments[segments.length - 1]);
    while (existsSync(target)) target = path.join(dir, numberedName(segments[segments.length - 1], ++n));
    const partial = `${target}.part`;
    const out = createWriteStream(partial);
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) {
        req.destroy();
        out.destroy();
        rmSync(partial, { force: true });
        fail(413, 'the file is larger than the bridge writes');
      }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (res.writableEnded) return;
      try {
        renameSync(partial, target);
      } catch (err) {
        fail(500, err.message);
        return;
      }
      log(`wrote ${target} (${(size / 1048576).toFixed(1)} MB)`);
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: target, bytes: size, renamed: n > 0 }));
    });
    out.on('error', (err) => {
      rmSync(partial, { force: true });
      fail(500, err.message);
    });
    return;
  }

  res.writeHead(404, cors);
  res.end();
});

server.on('error', (err) => {
  problem =
    err.code === 'EADDRINUSE'
      ? `The Atelier bridge could not listen on 127.0.0.1:${PORT} — another program (perhaps a second bridge) holds it. Stop it, or start this one with --port N and connect the tab on that port.`
      : `The Atelier bridge could not listen: ${err.message}`;
  log(problem);
});
server.listen(PORT, '127.0.0.1', () => log(`listening on http://127.0.0.1:${PORT} — connect a tab from Atelier's #/sources`));

// --- MCP over stdio ----------------------------------------------------------

const deps = {
  serverVersion: version,
  port: PORT,
  outDir: OUT_DIR,
  problem: () => problem,
  tab: () => (tab ? { route: tab.route, title: tab.title, since: tab.since } : null),
  relay,
};

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  handleMcpMessage(msg, deps)
    .then((answer) => answer && send(answer))
    .catch((err) => send({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: String(err?.message ?? err) } }));
});
// The client closing stdin is how an MCP session ends.
lines.on('close', () => {
  server.close();
  process.exit(0);
});
