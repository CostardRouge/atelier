import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Button from '../shared/ui/Button';
import { Icons } from '../shared/ui/icons';
import useDialogKeys from '../shared/ui/use-dialog-keys';
import { clearSent, sentImages, subscribeSent, type SentImage } from '../shared/commands/sent-images';
import { screenOfCommand } from '../shared/commands/screens/registry';
import { bridgeState, subscribeBridge } from '../shared/commands/bridge-client';

/**
 * WHAT CLAUDE SAW, this session — the sheet the masthead's *Agent* pill
 * opens: every picture a command sent the agent through the bridge, newest
 * first, each with the command and its params, when, its size and weight,
 * and which of Atelier's screens drew it (or a capture: the photograph as
 * exported). The real renders on the person's own pictures, beside the
 * bench's made-up ones in `#/agents` — the feedback loop he asked for on the
 * screens' design. Kept in memory only (`sent-images.ts`).
 *
 * A sheet over the screen, so the tool under it — the roll the agent is
 * working on — stays mounted; full screen on a phone.
 */

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function SentCard({ item, onOpen }: { item: SentImage; onOpen: (url: string) => void }) {
  // Made and revoked by the same effect: a URL made once and revoked by a
  // cleanup is dead after a remount (React's double mount, a sheet reopened).
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const made = URL.createObjectURL(item.blob);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [item.blob]);
  const screen = screenOfCommand(item.command);
  const params = JSON.stringify(item.params ?? {});
  const save = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.command.replace(/\W+/g, '-')}-${item.seq}.${item.blob.type === 'image/png' ? 'png' : 'jpg'}`;
    a.click();
  };
  return (
    <li className="flex flex-col gap-2 p-3 rounded-paper border border-line bg-surface min-w-0">
      <button
        type="button"
        onClick={() => url && onOpen(url)}
        className="block p-0 border-0 bg-paper-2 rounded-[8px] overflow-hidden cursor-zoom-in"
        aria-label={`Look at ${item.command}’s picture large`}
      >
        {url && <img src={url} alt="" className="block w-full h-44 object-contain" />}
      </button>
      <div className="flex items-baseline gap-2 min-w-0">
        <code className="font-mono text-xs text-ink truncate">{item.command}</code>
        <span className="ml-auto font-mono text-2xs text-muted shrink-0">{clock(item.at)}</span>
      </div>
      {params !== '{}' && <code className="font-mono text-2xs text-ink-soft break-all line-clamp-2">{params}</code>}
      <p className="m-0 font-mono text-2xs text-muted">
        {screen ? screen.title : 'Capture'} · {item.width} × {item.height} · {Math.round(item.blob.size / 1024)} kB
      </p>
      {item.note && <p className="m-0 text-xs text-ink-soft leading-snug line-clamp-2">{item.note}</p>}
      <Button variant="ghost" size="sm" onClick={save} className="self-start" icon={Icons.download}>
        Save
      </Button>
    </li>
  );
}

export default function SentImagesSheet({ onClose }: { onClose: () => void }) {
  const items = useSyncExternalStore(subscribeSent, sentImages);
  const bridge = useSyncExternalStore(subscribeBridge, bridgeState);
  const [large, setLarge] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), []);
  useDialogKeys({ onCancel: () => (large ? setLarge(null) : onClose()), onConfirm: null });

  const status =
    bridge.status === 'connected'
      ? `Connected on 127.0.0.1:${bridge.port} · ${bridge.runs} command${bridge.runs === 1 ? '' : 's'} run${bridge.last ? ` · last: ${bridge.last.command}` : ''}`
      : bridge.status === 'off' || bridge.status === 'replaced'
        ? 'Not connected'
        : `Waiting for the bridge on 127.0.0.1:${bridge.port}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="What Claude saw"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-[60rem] h-[var(--app-h)] sm:h-auto sm:max-h-[calc(var(--app-h)*0.9)] flex flex-col bg-paper sm:border sm:border-line sm:rounded-paper-lg shadow-paper overflow-hidden">
        <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-line">
          <div className="min-w-0">
            <h2 className="m-0 font-serif text-2xl leading-tight">What Claude saw</h2>
            <p className="m-0 mt-1 font-mono text-2xs text-muted">{status}</p>
          </div>
          <Button ref={closeRef} variant="ghost" size="sm" onClick={onClose} className="ml-auto" aria-label="Close">
            Close
          </Button>
        </header>

        <div className="flex-1 min-h-0 overflow-auto px-5 py-4">
          {items.length === 0 ? (
            <p className="m-0 text-sm text-ink-soft leading-relaxed max-w-[36rem]">
              Nothing yet. Each picture a command sends Claude — a contact sheet, a sum-up card, a snapshot — lands here
              for this session, so you see what it saw.
            </p>
          ) : (
            <ul className="m-0 p-0 list-none grid gap-3 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
              {items.map((item) => (
                <SentCard key={item.seq} item={item} onOpen={setLarge} />
              ))}
            </ul>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-line">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose();
              window.location.hash = '#/sources';
            }}
          >
            Manage the bridge
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose();
              window.location.hash = '#/agents';
            }}
          >
            The screens’ bench
          </Button>
          {items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearSent} className="ml-auto">
              Forget these
            </Button>
          )}
        </footer>
      </div>

      {large && (
        <div
          className="fixed inset-0 z-[60] bg-frame/95 flex items-center justify-center p-4 cursor-zoom-out"
          onPointerDown={(e) => {
            e.stopPropagation();
            setLarge(null);
          }}
          role="presentation"
        >
          <img src={large} alt="" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>,
    document.body,
  );
}
