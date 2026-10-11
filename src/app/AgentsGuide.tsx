import { useEffect, useState, type ReactNode } from 'react';
import { navigate } from './use-hash-route';
import { BridgeConnect, BridgeStatePill, BridgeVersionLine, bridgeSentence, useBridge } from './BridgeControl';
import { BRIDGE_CHANGES, BRIDGE_VERSION, bridgeLabel } from '../shared/commands/bridge-version';
import PageBar from '../shared/ui/PageBar';
import Segmented from '../shared/ui/Segmented';
import { buttonClass } from '../shared/ui/Button';
import { Icons } from '../shared/ui/icons';
import { localPref, useLocalPref } from '../shared/ui/local-pref';
import { revealInScroller } from '../shared/ui/reveal';

/**
 * `#/agents` — how to let an AI agent (Claude Desktop, Claude Code, any MCP
 * app) edit in this tab, in three steps with as little typing as can be:
 * a one-click Claude Desktop extension, a downloaded file and one line for
 * Claude Code, a JSON block for the rest — every command copyable, the
 * downloads served by this very site (`agentBridgePlugin`, `vite.config.ts`),
 * and the connection itself live on the page, so the guide checks its own
 * steps off. Decisions: `docs/memory/agent-commands.md`.
 */

type Client = 'desktop' | 'code' | 'other';

const CLIENT_PREF = localPref<Client>(
  'atelier.agents.client',
  (raw) => (raw === 'code' || raw === 'other' ? raw : 'desktop'),
  (v) => v,
);

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const asset = (name: string) => new URL(`${import.meta.env.BASE_URL}${name}`, window.location.origin).href;

/** A command or a snippet, selectable, with a Copy verb that says it copied. */
function CodeBlock({ code, label, prose = false }: { code: string; label: string; prose?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div className="relative group/code">
      <pre
        aria-label={label}
        className={`m-0 pr-24 pl-3.5 py-3 rounded-[10px] border border-line bg-paper-2 text-ink whitespace-pre-wrap select-all ${
          prose ? 'font-sans text-sm leading-snug break-words' : 'font-mono text-xs leading-relaxed break-all'
        }`}
      >
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        className={`${buttonClass('ghost', 'sm')} absolute top-2 right-2 bg-surface`}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
      >
        <span className="inline-flex [&>svg]:w-[1.1em] [&>svg]:h-[1.1em]">{copied ? Icons.check : Icons.copy}</span>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/**
 * A download served by this site, as the primary verb of its step. `saveAs`
 * names the saved file — the extension carries its version (`atelier-v4.mcpb`)
 * so two downloads are told apart; the bridge script keeps one name, since
 * Claude Code's settings point at its path and an update overwrites it.
 */
function Download({ file, saveAs, children, variant = 'primary' }: { file: string; saveAs?: string; children: ReactNode; variant?: 'primary' | 'default' }) {
  return (
    <a href={asset(file)} download={saveAs ?? file} className={`${buttonClass(variant, 'lg')} no-underline self-start`}>
      <span className="inline-flex [&>svg]:w-[1.1em] [&>svg]:h-[1.1em]">{Icons.download}</span>
      {children}
    </a>
  );
}

/** One numbered step; `done` ticks it off from what the page can see. */
function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2.25rem_1fr] gap-x-3 sm:gap-x-4">
      <span
        aria-hidden="true"
        className={`w-9 h-9 rounded-full grid place-items-center font-mono text-sm font-semibold border ${
          done ? 'bg-ok-wash border-ok-line text-ok' : 'bg-surface border-line-strong text-ink'
        }`}
      >
        {done ? <span className="inline-flex [&>svg]:w-4 [&>svg]:h-4">{Icons.check}</span> : n}
      </span>
      <div className="min-w-0 flex flex-col gap-3 pb-8 border-b border-line">
        <h2 className="m-0 mt-1.5 font-serif text-xl leading-snug">
          {title}
          {done && <span className="sr-only"> — done</span>}
        </h2>
        {children}
      </div>
    </li>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="m-0 text-sm text-muted leading-relaxed">{children}</p>;
}

/** One question in the "Good to know" list, folded until asked. */
function Faq({ q, id, children }: { q: string; id?: string; children: ReactNode }) {
  return (
    <details id={id} className="group border-b border-line py-3 scroll-mt-4">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-medium text-ink">
        {q}
        <span className="inline-flex text-muted transition-transform group-open:rotate-180 [&>svg]:w-4 [&>svg]:h-4">
          {Icons.down}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-2 text-sm text-ink-soft leading-relaxed">{children}</div>
    </details>
  );
}

const PROMPTS = [
  'Open Atelier’s Develop tool, make a roll called “Test”, and tell me what you can adjust.',
  'Take my Winnow picks from last Saturday into a new roll, give them a warm, slightly lifted look, and show me the first one.',
  'Straighten this photo, crop it to 4:5 around the subject, and export every picture that leaves the roll.',
  'In my trip, make a carousel of 14 September from my Winnow picks of that day, open it on the map, caption the badge “Cairns”, and export it.',
  'Which days of September hold photos on my Winnow? Show me the 4-star ones of the busiest day as a contact sheet, and make a roll of the five you would keep.',
];

/** The extension's saved name carries its version, so two downloads are told apart. */
const DESKTOP_FILE = `atelier-${bridgeLabel(BRIDGE_VERSION)}.mcpb`;

const code = (s: string) => <code className="font-mono text-xs bg-paper-2 px-1 py-[0.05rem] rounded">{s}</code>;

export default function AgentsGuide() {
  const bridge = useBridge();
  const [client, setClient] = useLocalPref(CLIENT_PREF, 'desktop');
  const [savedAt, setSavedAt] = useState('');
  const connected = bridge.status === 'connected';
  const sentence = bridgeSentence(bridge);
  const fileUrl = asset('atelier-mcp.mjs');
  const jsonPath = savedAt.trim() || '/Users/you/Downloads/atelier-mcp.mjs';
  const json = JSON.stringify({ mcpServers: { atelier: { command: 'node', args: [jsonPath] } } }, null, 2);

  return (
    <section className="w-full max-w-[46rem] mx-auto mt-2 sm:mt-6 mb-16 flex flex-col gap-8 px-1" aria-label="Connect an agent">
      <PageBar back={{ label: 'Sources', onClick: () => navigate('/sources') }} />

      <header>
        <p className={legend}>Agents</p>
        <h1 className="m-0 mt-1 font-serif text-3xl leading-tight">Edit with Claude</h1>
        <p className="m-0 mt-2 text-base text-ink-soft leading-relaxed">
          Ask in plain words — “warm these up, straighten that one, export the roll” — and Claude does it here, with
          Atelier’s own controls. You watch every change happen, and ⌘Z undoes any of them.
        </p>
      </header>

      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 rounded-paper border border-line bg-surface"
        aria-live="polite"
      >
        <span className="font-mono text-xs text-muted">This tab</span>
        <BridgeStatePill bridge={bridge} />
        <span className="ml-auto">
          <BridgeConnect bridge={bridge} />
        </span>
        {sentence && <p className="basis-full m-0 text-xs text-muted leading-snug">{sentence}</p>}
        <p className="basis-full m-0">
          <BridgeVersionLine
            bridge={bridge}
            onUpdate={() => {
              const faq = document.getElementById('bridge-update');
              faq?.setAttribute('open', '');
              revealInScroller(faq, { block: 'start', behavior: 'smooth', margin: 16 });
            }}
          />
        </p>
      </div>

      <ol className="m-0 p-0 list-none flex flex-col gap-8">
        <Step n={1} title="Add Atelier to your AI app" done={connected}>
          <Segmented<Client>
            label="Your AI app"
            size="sm"
            fill
            value={client}
            onChange={setClient}
            options={[
              { id: 'desktop', label: 'Claude Desktop' },
              { id: 'code', label: 'Claude Code' },
              { id: 'other', label: 'Other' },
            ]}
          />

          {client === 'desktop' && (
            <>
              <Download file="atelier.mcpb" saveAs={DESKTOP_FILE}>
                Download the Atelier extension · {bridgeLabel(BRIDGE_VERSION)}
              </Download>
              <Hint>
                Open the downloaded <b className="text-ink-soft font-medium">{DESKTOP_FILE}</b> — Claude Desktop shows an
                install window. Click <b className="text-ink-soft font-medium">Install</b> (or{' '}
                <b className="text-ink-soft font-medium">Update</b> over an older version). No terminal, nothing else to set
                up: Claude Desktop runs it itself.
              </Hint>
            </>
          )}

          {client === 'code' && (
            <>
              <Download file="atelier-mcp.mjs">Download the bridge · {bridgeLabel(BRIDGE_VERSION)}</Download>
              <Hint>Then paste this once in a terminal — it registers the file you just downloaded:</Hint>
              <CodeBlock label="the Claude Code command" code="claude mcp add atelier -- node ~/Downloads/atelier-mcp.mjs" />
              <Hint>Rather skip the browser download? This line does both:</Hint>
              <CodeBlock
                label="the one-line install"
                code={`curl -fsSo ~/atelier-mcp.mjs ${fileUrl} && claude mcp add atelier -- node ~/atelier-mcp.mjs`}
              />
              <Hint>Needs Node.js 18 or newer ({code('node -v')} tells you).</Hint>
            </>
          )}

          {client === 'other' && (
            <>
              <Download file="atelier-mcp.mjs">Download the bridge · {bridgeLabel(BRIDGE_VERSION)}</Download>
              <Hint>
                Any app that speaks MCP (Cursor, Windsurf, VS Code…) takes this block in its MCP settings — in Cursor,{' '}
                {code('~/.cursor/mcp.json')}. It needs the file’s full path:
              </Hint>
              <input
                value={savedAt}
                onChange={(e) => setSavedAt(e.target.value)}
                placeholder="/Users/you/Downloads/atelier-mcp.mjs"
                aria-label="Where you saved the file"
                spellCheck={false}
                className="w-full font-mono text-base sm:text-xs px-3 py-2 border border-line-strong rounded-[10px] bg-paper text-ink focus:outline-none focus:border-accent"
              />
              <CodeBlock label="the MCP settings block" code={json} />
              <Hint>Needs Node.js 18 or newer.</Hint>
            </>
          )}
        </Step>

        <Step n={2} title="Connect this tab" done={connected}>
          <Hint>
            With your AI app open, press <b className="text-ink-soft font-medium">Connect</b> in the bar above. The first
            time, Chrome asks to let this page reach your computer — choose <b className="text-ink-soft font-medium">Allow</b>.
            Only this tab is connected, and an <b className="text-ink-soft font-medium">Agent</b> pill stays in the top bar
            while it is.
          </Hint>
          {connected && (
            <p className="m-0 text-sm text-ok">
              Connected — Claude can see this tab now.
            </p>
          )}
        </Step>

        <Step n={3} title="Ask">
          <Hint>Start a new conversation and try one of these:</Hint>
          <div className="flex flex-col gap-2">
            {PROMPTS.map((p, i) => (
              <CodeBlock key={p} label={`example ${i + 1}`} code={p} prose />
            ))}
          </div>
        </Step>
      </ol>

      <div>
        <p className={legend}>Good to know</p>
        <div className="mt-2">
          <Faq q="Where do exported photos go?">
            <p className="m-0">
              Into {code('Pictures/Atelier')} in your home folder, under each photo’s own name — never over an existing
              file (a second export becomes {code('DJI_0101-1.jpg')}). From Claude Code you can choose another folder by
              adding {code('--out ~/somewhere')} after the file name.
            </p>
          </Faq>
          <Faq q="What can Claude do, and what can’t it?">
            <p className="m-0">
              In Develop: make and fill rolls (from your Library or your Winnow’s picks), every slider, curves, crop and
              straighten, perspective, lens, detail, the Auto verbs, looks and film stocks, your presets, copying one
              photo’s settings to others, and exports. It cannot touch your purchased looks, masks or layers.
            </p>
            <p className="m-0">
              Each change is recorded as made by an agent, so a making-of says so and Atelier never learns your taste from
              it.
            </p>
          </Faq>
          <Faq q="Is my work sent anywhere?">
            <p className="m-0">
              No. The bridge runs on your computer and talks to this tab over {code('127.0.0.1')} only; it refuses any
              other website. What Claude sees is what you would send it in a conversation — the answers and the previews
              it asks for. Your files stay where they are.
            </p>
          </Faq>
          <Faq q="It says “waiting for the bridge”.">
            <p className="m-0">
              The bridge runs only while your AI app is open — start it (in Claude Code, open a session), then press
              Connect again. If you changed the port with {code('--port')}, type the same number before Connect.
            </p>
          </Faq>
          <Faq q="Claude Desktop and Claude Code at the same time?">
            <p className="m-0">
              Yes. Each starts its own bridge; the first one holds the connection to this tab and the other goes through it
              — nothing to configure. Exports land in the first one’s folder. Quit that app and the other takes over; the
              tab reconnects by itself.
            </p>
          </Faq>
          <Faq q="How do I update the bridge? Which version do I have?" id="bridge-update">
            <p className="m-0">
              The bridge has its own number — this site ships <b className="text-ink-soft font-medium">{bridgeLabel(BRIDGE_VERSION)}</b> —
              and the bar above says which one is running once this tab is connected. It changes only when the bridge
              does, so a new number is worth installing; a new Atelier feature in the tab needs no new bridge.
            </p>
            <p className="m-0">
              <b className="text-ink-soft font-medium">Claude Desktop</b>: download the extension again and open it —
              Claude Desktop offers <b className="text-ink-soft font-medium">Update</b>. (An extension installed before
              numbering began shows Uninstall instead: uninstall it once, then install this one.){' '}
              <b className="text-ink-soft font-medium">Claude Code and the others</b>: download the bridge over the old
              file (same name, same place), or run the one-line install again, then start a new session.{' '}
              {code('node atelier-mcp.mjs --version')} prints the number of a file.
            </p>
            <div className="flex flex-col gap-2 mt-1">
              {BRIDGE_CHANGES.map((entry) => (
                <div key={entry.version}>
                  <p className="m-0 font-mono text-xs text-ink">
                    {bridgeLabel(entry.version)} · {entry.date}
                  </p>
                  <ul className="m-0 mt-1 pl-5 list-disc flex flex-col gap-0.5">
                    {entry.changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Faq>
          <Faq q="It says “taken by another tab”.">
            <p className="m-0">
              One tab at a time: the last one to connect wins. Press Connect here to take it back.
            </p>
          </Faq>
          <Faq q="Which browsers work?">
            <p className="m-0">
              Chrome, Edge and Arc. Safari may refuse to let a website reach your own computer; Firefox is untested.
            </p>
          </Faq>
          <Faq q="How do I remove it?">
            <p className="m-0">
              Press Disconnect. To uninstall: Claude Desktop → Settings → Extensions, or {code('claude mcp remove atelier')}{' '}
              in Claude Code, then delete the downloaded file.
            </p>
          </Faq>
        </div>
      </div>
    </section>
  );
}
