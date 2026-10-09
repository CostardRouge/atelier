#!/usr/bin/env node
// The Atelier MCP bridge: an MCP server on stdio for Claude Code (or any MCP
// client), relaying to the Atelier tab the person connected — over
// 127.0.0.1 only, Server-Sent Events down to the tab and POSTs back.
//
//   claude mcp add atelier -- node /path/to/atelier/scripts/atelier-mcp.mjs
//
// Options: --port N (or ATELIER_BRIDGE_PORT; default 7981), and
// ATELIER_ORIGINS=https://a,https://b to allow pages other than loopback and
// the deployed site. Needs Node ≥ 22.18 (it imports the protocol module, a
// TypeScript file, through Node's own type stripping). No dependency.
//
// The decisions live in `src/shared/commands/mcp-protocol.ts` (pure, tested)
// and `docs/memory/agent-commands.md`. This file only moves bytes: stdout
// carries the protocol and nothing else — every log goes to stderr.

import http from 'node:http';
import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import {
  BRIDGE_DEFAULT_PORT,
  handleMcpMessage,
  originAllowed,
  parseTabMessage,
} from '../src/shared/commands/mcp-protocol.ts';

const argPort = (() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 ? Number(process.argv[i + 1]) : NaN;
})();
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

const version = (() => {
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
    'Access-Control-Allow-Headers': 'content-type',
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
  const path = (req.url ?? '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method === 'GET' && path === '/events') {
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

  if (req.method === 'POST' && path === '/message') {
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
