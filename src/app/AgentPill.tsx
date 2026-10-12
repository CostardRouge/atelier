/**
 * The masthead's word for an AGENT driving this tab (`shared/commands/
 * bridge-client.ts`): drawn only while the bridge is on, at every width, so a
 * tab an agent can write to never looks like one it cannot. A click opens
 * WHAT CLAUDE SAW (`SentImagesSheet.tsx`, loaded then): the pictures sent to
 * the agent this session, with the way to `#/sources` to turn it off and to
 * the screens' bench in `#/agents`.
 */

import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import Button from '../shared/ui/Button';
import { bridgeState, subscribeBridge } from '../shared/commands/bridge-client';
import { sentImages, subscribeSent } from '../shared/commands/sent-images';

const SentImagesSheet = lazy(() => import('./SentImagesSheet'));

export default function AgentPill() {
  const bridge = useSyncExternalStore(subscribeBridge, bridgeState);
  const sent = useSyncExternalStore(subscribeSent, sentImages).length;
  const [open, setOpen] = useState(false);
  if (bridge.status === 'off' || bridge.status === 'replaced') return null;
  const connected = bridge.status === 'connected';
  const seen = sent ? ` — ${sent} picture${sent === 1 ? '' : 's'} sent, look at them` : ' — see what it saw';
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title={
          connected
            ? `An agent can drive this tab through the bridge on 127.0.0.1:${bridge.port}${bridge.last ? ` — last: ${bridge.last.command}` : ''}${seen}`
            : `Waiting for the agent bridge on 127.0.0.1:${bridge.port}${seen}`
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
      {open && (
        <Suspense fallback={null}>
          <SentImagesSheet onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
