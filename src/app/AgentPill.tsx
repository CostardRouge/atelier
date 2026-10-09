/**
 * The masthead's word for an AGENT driving this tab (`shared/commands/
 * bridge-client.ts`): drawn only while the bridge is on, at every width, so a
 * tab an agent can write to never looks like one it cannot. A click goes to
 * `#/sources`, where it is turned off.
 */

import { useSyncExternalStore } from 'react';
import Button from '../shared/ui/Button';
import { bridgeState, subscribeBridge } from '../shared/commands/bridge-client';

export default function AgentPill() {
  const bridge = useSyncExternalStore(subscribeBridge, bridgeState);
  if (bridge.status === 'off' || bridge.status === 'replaced') return null;
  const connected = bridge.status === 'connected';
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        window.location.hash = '#/sources';
      }}
      title={
        connected
          ? `An agent can drive this tab through the bridge on 127.0.0.1:${bridge.port}${bridge.last ? ` — last: ${bridge.last.command}` : ''} — manage it`
          : `Waiting for the agent bridge on 127.0.0.1:${bridge.port} — manage it`
      }
      icon={
        <span
          className={`inline-block w-[7px] h-[7px] rounded-full ${connected ? 'bg-accent' : 'bg-warn animate-pulse-dot'}`}
          aria-hidden="true"
        />
      }
      className="font-sans not-italic tracking-normal text-xs text-ink-soft"
    >
      Agent
    </Button>
  );
}
