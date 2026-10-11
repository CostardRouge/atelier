import { useState, useSyncExternalStore } from 'react';
import { bridgeState, startBridge, stopBridge, subscribeBridge, type BridgeState } from '../shared/commands/bridge-client';
import { BRIDGE_DEFAULT_PORT } from '../shared/commands/mcp-protocol';
import Button from '../shared/ui/Button';
import { BRIDGE_VERSION, bridgeLabel } from '../shared/commands/bridge-version';

/**
 * The agent bridge's live state and its Connect / Disconnect — drawn by the
 * Sources screen's Agents row and by the setup guide (`#/agents`), so the two
 * can never say different things about the same tab.
 */

export function useBridge(): BridgeState {
  return useSyncExternalStore(subscribeBridge, bridgeState);
}

const pillBase =
  'inline-flex items-center gap-1.5 font-mono text-2xs tracking-[0.04em] px-2 py-[0.15rem] rounded-full border whitespace-nowrap';
const dot = 'w-[7px] h-[7px] rounded-full block';

/** The dot and the words for the bridge's state. */
export function BridgeStatePill({ bridge }: { bridge: BridgeState }) {
  switch (bridge.status) {
    case 'connected':
      return (
        <span className={`${pillBase} border-ok-line bg-ok-wash text-ok`}>
          <i className={`${dot} bg-ok`} />
          connected
        </span>
      );
    case 'connecting':
    case 'waiting':
      return (
        <span className={`${pillBase} border-warn-line bg-warn-wash text-warn`}>
          <i className={`${dot} bg-warn animate-pulse-dot`} />
          waiting for the bridge
        </span>
      );
    case 'replaced':
      return (
        <span className={`${pillBase} border-line-strong bg-surface text-ink-soft`}>
          <i className={`${dot} bg-faint`} />
          taken by another tab
        </span>
      );
    default:
      return (
        <span className={`${pillBase} border-line-strong bg-surface text-ink-soft`}>
          <i className={`${dot} bg-faint`} />
          off
        </span>
      );
  }
}

/** The port field and Connect, or Disconnect while on. */
export function BridgeConnect({ bridge, size = 'sm' }: { bridge: BridgeState; size?: 'sm' | 'md' }) {
  const [port, setPort] = useState(String(BRIDGE_DEFAULT_PORT));
  const asked = Number(port);
  const portOk = Number.isInteger(asked) && asked > 0 && asked < 65536;
  const on = bridge.status !== 'off' && bridge.status !== 'replaced';
  if (on) {
    return (
      <Button size={size} variant="danger" onClick={stopBridge}>
        Disconnect
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        value={port}
        onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
        inputMode="numeric"
        aria-label="Bridge port"
        title="The bridge's port — 7981 unless you started it with --port"
        className="w-[5.5rem] font-mono text-base sm:text-xs px-2 py-[0.2rem] border border-line-strong rounded-full bg-paper text-ink focus:outline-none focus:border-accent"
      />
      <Button
        size={size}
        variant="primary"
        aria-disabled={!portOk || undefined}
        title={portOk ? undefined : 'A port is a whole number from 1 to 65535'}
        onClick={() => portOk && startBridge(asked)}
      >
        Connect
      </Button>
    </span>
  );
}

/** A sentence for the state, or null when the pill already says it all. */
export function bridgeSentence(bridge: BridgeState): string | null {
  if (bridge.status === 'waiting') return /[.?!]$/.test(bridge.reason) ? bridge.reason : `${bridge.reason}.`;
  if (bridge.status === 'replaced') return 'Another Atelier tab connected to the bridge, so this one stood down.';
  return null;
}

/**
 * Which bridge this tab talks to and whether the site ships a newer one —
 * "Bridge v3 · Atelier ships v4 — update it" — or, while nothing is
 * connected, the number of the one the site serves (`bridge-version.ts`).
 */
export function BridgeVersionLine({ bridge, onUpdate }: { bridge: BridgeState; onUpdate?: () => void }) {
  const latest = bridgeLabel(BRIDGE_VERSION);
  if (bridge.status !== 'connected') {
    return <span className="font-mono text-2xs text-muted">Latest bridge {latest}</span>;
  }
  const running = bridge.bridge;
  if (running !== null && running >= BRIDGE_VERSION) {
    return <span className="font-mono text-2xs text-ok">Bridge {bridgeLabel(running)} · up to date</span>;
  }
  return (
    <span className="font-mono text-2xs text-warn">
      Bridge {bridgeLabel(running)} · Atelier ships {latest}
      {onUpdate && (
        <>
          {' — '}
          <button type="button" onClick={onUpdate} className="underline underline-offset-2 text-warn hover:text-ink">
            update it
          </button>
        </>
      )}
    </span>
  );
}
