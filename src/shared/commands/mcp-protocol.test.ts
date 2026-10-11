import { describe, expect, it } from 'vitest';
import {
  MCPB_ENTRY,
  parsePeerRequest,
  peerAuthorized,
  peerTokenFile,
  mcpbManifest,
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  handleMcpMessage,
  numberedName,
  safeOutputPath,
  originAllowed,
  parseTabMessage,
  parseTabRequest,
  toolContent,
  type McpDeps,
} from './mcp-protocol';

function deps(over: Partial<McpDeps> = {}): McpDeps {
  return {
    serverVersion: '0.1.0',
    port: 7981,
    tab: () => ({ route: '/develop/home', title: 'Develop — Atelier', since: Date.now() - 5000 }),
    relay: async (r) => (r.kind === 'list' ? [{ id: 'app.status' }] : { ran: r.command, params: r.params }),
    ...over,
  };
}

describe('handleMcpMessage', () => {
  it('initializes with the version the client asked for when it is known, else ours', async () => {
    const known = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, deps());
    expect(known?.result).toMatchObject({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'atelier', version: '0.1.0' } });
    const unknown = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, deps());
    expect((unknown?.result as { protocolVersion: string }).protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it('answers no notification, and pings', async () => {
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps())).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'ping' }, deps())).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
  });

  it('lists the three tools', async () => {
    const r = await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, deps());
    expect((r?.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(['atelier_status', 'atelier_commands', 'atelier_run']);
    expect(MCP_TOOLS[2].inputSchema.required).toEqual(['command']);
  });

  it('refuses an unknown method and a request without one', async () => {
    expect((await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, deps()))?.error).toEqual({ code: -32601, message: 'method not found: resources/list' });
    expect((await handleMcpMessage({ jsonrpc: '2.0', id: 6 }, deps()))?.error?.code).toBe(-32600);
  });

  it('relays a run with its params and answers the result as text', async () => {
    const r = await handleMcpMessage(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'atelier_run', arguments: { command: 'develop.set', params: { values: { exposure: 1 } } } } },
      deps(),
    );
    expect(r?.result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ ran: 'develop.set', params: { values: { exposure: 1 } } }, null, 2) }] });
  });

  it('runs with empty params when none are given, and refuses params that are not an object', async () => {
    const ok = await handleMcpMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'atelier_run', arguments: { command: 'app.status' } } }, deps());
    expect(JSON.stringify(ok?.result)).toContain('\\"params\\": {}');
    const bad = await handleMcpMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'atelier_run', arguments: { command: 'x', params: [1] } } }, deps());
    expect(bad?.result).toEqual({ content: [{ type: 'text', text: '"params" must be an object' }], isError: true });
  });

  it('says a refused command as a tool error, never a protocol error', async () => {
    const r = await handleMcpMessage(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'atelier_run', arguments: { command: 'develop.set', params: {} } } },
      deps({ relay: () => Promise.reject(new Error('invalid: missing parameter "values"')) }),
    );
    expect(r?.error).toBeUndefined();
    expect(r?.result).toEqual({ content: [{ type: 'text', text: 'invalid: missing parameter "values"' }], isError: true });
  });

  it('tells how to connect a tab when none is, without relaying', async () => {
    let relayed = false;
    const d = deps({ tab: () => null, relay: async () => (relayed = true) });
    const status = await handleMcpMessage({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'atelier_status' } }, d);
    expect(JSON.stringify(status?.result)).toContain('#/agents');
    const run = await handleMcpMessage({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'atelier_run', arguments: { command: 'app.status' } } }, d);
    expect((run?.result as { isError: boolean }).isError).toBe(true);
    expect(relayed).toBe(false);
  });

  it('says what keeps the bridge from working before anything else', async () => {
    const r = await handleMcpMessage(
      { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'atelier_status' } },
      deps({ problem: () => 'port 7981 is taken by another program' }),
    );
    expect(r?.result).toEqual({ content: [{ type: 'text', text: 'port 7981 is taken by another program' }], isError: true });
  });

  it('answers the status of a connected tab', async () => {
    const r = await handleMcpMessage({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'atelier_status' } }, deps());
    const text = (r?.result as { content: { text: string }[] }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({ connected: true, route: '/develop/home', port: 7981 });
  });
});

describe('toolContent', () => {
  it('turns a picture into an image block and its note', () => {
    expect(toolContent({ kind: 'image', mimeType: 'image/jpeg', data: 'AAAA', width: 300, height: 200, note: 'the picture as delivered' })).toEqual([
      { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
      { type: 'text', text: 'the picture as delivered · 300 × 200' },
    ]);
  });

  it('turns anything else into JSON text, and nothing into "done"', () => {
    expect(toolContent({ a: 1 })).toEqual([{ type: 'text', text: '{\n  "a": 1\n}' }]);
    expect(toolContent(undefined)).toEqual([{ type: 'text', text: 'done' }]);
  });
});

describe('the tab messages', () => {
  it('reads a result, an error and a hello, and refuses anything else', () => {
    expect(parseTabMessage('{"id":"1","ok":true,"result":{"x":1}}')).toEqual({ id: '1', ok: true, result: { x: 1 } });
    expect(parseTabMessage('{"id":"2","ok":false,"error":{"code":"invalid","message":"no"}}')).toEqual({ id: '2', ok: false, error: { code: 'invalid', message: 'no' } });
    expect(parseTabMessage('{"hello":{"app":"atelier","route":"/","title":"Atelier"}}')).toEqual({ hello: { app: 'atelier', route: '/', title: 'Atelier' } });
    expect(parseTabMessage('not json')).toBeNull();
    expect(parseTabMessage('{"id":3,"ok":true}')).toBeNull();
    expect(parseTabMessage('{"id":"4","ok":false}')).toBeNull();
  });

  it('reads a list and a run request, with params defaulting to none', () => {
    expect(parseTabRequest('{"id":"a","kind":"list"}')).toEqual({ id: 'a', kind: 'list' });
    expect(parseTabRequest('{"id":"b","kind":"run","command":"app.status"}')).toEqual({ id: 'b', kind: 'run', command: 'app.status', params: {} });
    expect(parseTabRequest('{"id":"c","kind":"run"}')).toBeNull();
    expect(parseTabRequest('{"kind":"list"}')).toBeNull();
  });
});

describe('originAllowed', () => {
  it('allows loopback pages on any port and the deployed site', () => {
    expect(originAllowed('http://127.0.0.1:5173')).toBe(true);
    expect(originAllowed('http://localhost:4173')).toBe(true);
    expect(originAllowed('http://localhost')).toBe(true);
    expect(originAllowed('https://atelier.steeve.website')).toBe(true);
  });

  it('refuses any other site, a look-alike and a missing origin', () => {
    expect(originAllowed('https://evil.example')).toBe(false);
    expect(originAllowed('http://localhost.evil.example')).toBe(false);
    expect(originAllowed('https://atelier.steeve.website.evil.example')).toBe(false);
    expect(originAllowed(undefined)).toBe(false);
    expect(originAllowed('null')).toBe(false);
  });

  it('allows an origin named in the extra list, exactly', () => {
    expect(originAllowed('https://my.host', ['https://my.host'])).toBe(true);
    expect(originAllowed('https://my.host:8443', ['https://my.host'])).toBe(false);
  });
});

describe('the files the bridge writes', () => {
  it('keeps a plain name and its sub-folders', () => {
    expect(safeOutputPath('', 'DJI_0101.jpg')).toEqual(['DJI_0101.jpg']);
    expect(safeOutputPath('Web/Variant 2', 'DJI_0101.jpg')).toEqual(['Web', 'Variant 2', 'DJI_0101.jpg']);
  });

  it('refuses anything that could step outside the output folder', () => {
    expect(safeOutputPath('..', 'a.jpg')).toBeNull();
    expect(safeOutputPath('Web/../..', 'a.jpg')).toBeNull();
    expect(safeOutputPath('', '../a.jpg')).toBeNull();
    expect(safeOutputPath('', 'a\\b.jpg')).toBeNull();
    expect(safeOutputPath('', 'C:x.jpg')).toBeNull();
    expect(safeOutputPath('', ' ')).toBeNull();
    expect(safeOutputPath('', 'a\u0000.jpg')).toBeNull();
    expect(safeOutputPath('', 'x'.repeat(201))).toBeNull();
  });

  it('numbers a taken name before its extension', () => {
    expect(numberedName('DJI_0101.jpg', 0)).toBe('DJI_0101.jpg');
    expect(numberedName('DJI_0101.jpg', 1)).toBe('DJI_0101-1.jpg');
    expect(numberedName('.gitignore', 2)).toBe('.gitignore-2');
    expect(numberedName('README', 3)).toBe('README-3');
  });
});

describe('mcpbManifest', () => {
  it('points the node server at the bundled entry and lists the three tools', () => {
    const m = mcpbManifest('0.1.0', 'https://atelier.steeve.website/') as {
      server: { type: string; entry_point: string; mcp_config: { command: string; args: string[] } };
      tools: { name: string }[];
    };
    expect(m.server.type).toBe('node');
    expect(m.server.entry_point).toBe(MCPB_ENTRY);
    expect(m.server.mcp_config.args).toEqual([`\${__dirname}/${MCPB_ENTRY}`]);
    expect(m.tools.map((t) => t.name)).toEqual(['atelier_status', 'atelier_commands', 'atelier_run']);
  });
});

describe('a second bridge following the first', () => {
  const token = 'a'.repeat(64);

  it('lets only a program on this computer holding the token through', () => {
    expect(peerAuthorized({ authorization: `Bearer ${token}` }, token)).toBe(true);
    // A web page always sends an Origin, token or not.
    expect(peerAuthorized({ origin: 'http://127.0.0.1:5173', authorization: `Bearer ${token}` }, token)).toBe(false);
    expect(peerAuthorized({ authorization: `Bearer ${'b'.repeat(64)}` }, token)).toBe(false);
    expect(peerAuthorized({}, token)).toBe(false);
    // A hub with no token (it could not write one) lets nobody in.
    expect(peerAuthorized({ authorization: 'Bearer ' }, '')).toBe(false);
  });

  it('reads a relay request and refuses anything else', () => {
    expect(parsePeerRequest('{"kind":"list"}')).toEqual({ kind: 'list' });
    expect(parsePeerRequest('{"kind":"run","command":"develop.set","params":{"values":{"exposure":1}}}')).toEqual({
      kind: 'run',
      command: 'develop.set',
      params: { values: { exposure: 1 } },
    });
    expect(parsePeerRequest('{"kind":"run","command":"app.status"}')).toEqual({ kind: 'run', command: 'app.status', params: {} });
    expect(parsePeerRequest('{"kind":"run","command":""}')).toBeNull();
    expect(parsePeerRequest('{"kind":"run","command":"x","params":[]}')).toBeNull();
    expect(parsePeerRequest('nope')).toBeNull();
  });

  it('names one token file per port', () => {
    expect(peerTokenFile(7981)).toBe('bridge-7981.token');
  });
});
