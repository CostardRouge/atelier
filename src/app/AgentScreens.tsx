import { useEffect, useState } from 'react';
import Segmented from '../shared/ui/Segmented';
import { buttonClass } from '../shared/ui/Button';
import { Icons } from '../shared/ui/icons';
import { blobOfImageResult } from '../shared/commands/image-result';
import { AGENT_SCREENS, type AgentScreen } from '../shared/commands/screens/registry';
import { SCREEN_DARK, SCREEN_LIGHT } from '../shared/commands/screens/paper';
import { renderScreenCase } from '../shared/commands/screens/render';

/**
 * The agent's SCREENS on the bench (`#/agents`, folded until opened, and
 * loaded only then): every image Atelier DRAWS for an agent, each of its
 * cases — the ordinary ones and the edges — drawn by the very painter the
 * commands call (`screens/render.ts`), at each width it can take, on paper or
 * at night, with the command an agent would send and a Save verb. What the
 * maintainer supervises the design on, with no agent and no Winnow.
 */

type Ground = 'paper' | 'night';

interface Drawn {
  url: string;
  width: number;
  height: number;
  kind: 'JPEG' | 'PNG';
  kb: number;
  ms: number;
  blob: Blob;
}

function ScreenBench({ screen }: { screen: AgentScreen }) {
  const [caseId, setCaseId] = useState(screen.cases[0].id);
  const [width, setWidth] = useState(screen.width);
  const [ground, setGround] = useState<Ground>('paper');
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const c = screen.cases.find((x) => x.id === caseId) ?? screen.cases[0];

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    const start = performance.now();
    setError(null);
    renderScreenCase(screen, c, { width, palette: ground === 'night' ? SCREEN_DARK : SCREEN_LIGHT }).then(
      (r) => {
        if (!alive) return;
        const blob = blobOfImageResult(r);
        url = URL.createObjectURL(blob);
        setDrawn({
          url,
          width: r.width,
          height: r.height,
          kind: r.mimeType === 'image/png' ? 'PNG' : 'JPEG',
          kb: Math.round(blob.size / 1024),
          ms: Math.round(performance.now() - start),
          blob,
        });
      },
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [screen, c, width, ground]);

  const example = `${c.example.command} ${JSON.stringify(c.example.params)}`;
  const save = () => {
    if (!drawn) return;
    const a = document.createElement('a');
    a.href = drawn.url;
    a.download = `${screen.id}-${c.id}-${drawn.width}.${drawn.kind === 'PNG' ? 'png' : 'jpg'}`;
    a.click();
  };

  return (
    <article className="flex flex-col gap-3 pb-6 border-b border-line" aria-label={screen.title}>
      <header>
        <h3 className="m-0 font-serif text-lg leading-snug">{screen.title}</h3>
        <p className="m-0 mt-1 text-sm text-ink-soft leading-relaxed">{screen.about}</p>
        <p className="m-0 mt-1.5 flex flex-wrap gap-1.5">
          {screen.commands.map((id) => (
            <code key={id} className="font-mono text-2xs bg-paper-2 border border-line px-1.5 py-[0.1rem] rounded">
              {id}
            </code>
          ))}
        </p>
      </header>

      <Segmented<string>
        label={`${screen.title}: case`}
        size="sm"
        value={c.id}
        onChange={setCaseId}
        className="flex-wrap"
        options={screen.cases.map((x) => ({
          id: x.id,
          label: x.edge ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-accent" />
              {x.label}
            </span>
          ) : (
            x.label
          ),
          title: x.edge ? 'An edge case' : undefined,
        }))}
      />

      <div className="flex flex-wrap items-center gap-2">
        {screen.widths && (
          <Segmented<string>
            label={`${screen.title}: width`}
            size="sm"
            value={String(width)}
            onChange={(v) => setWidth(Number(v))}
            options={screen.widths.map((w) => ({ id: String(w), label: `${w}` }))}
          />
        )}
        <Segmented<Ground>
          label={`${screen.title}: ground`}
          size="sm"
          value={ground}
          onChange={setGround}
          options={[
            { id: 'paper', label: 'Paper' },
            { id: 'night', label: 'Night', title: 'The dark theme’s tokens — a shared image is always drawn on paper' },
          ]}
        />
        <button
          type="button"
          onClick={save}
          aria-disabled={!drawn}
          title={drawn ? undefined : 'Still drawing'}
          className={`${buttonClass('ghost', 'sm')} ml-auto`}
        >
          <span className="inline-flex [&>svg]:w-[1.1em] [&>svg]:h-[1.1em]">{Icons.download}</span>
          Save
        </button>
      </div>

      <figure className="m-0 flex flex-col gap-1.5">
        <div className="rounded-[10px] border border-line bg-paper-2 overflow-auto max-h-[calc(var(--app-h)*0.7)]">
          {error ? (
            <p className="m-0 p-4 text-sm text-danger-ink">{error}</p>
          ) : drawn ? (
            <img src={drawn.url} alt={`${screen.title}, ${c.label}`} className="block w-full h-auto" />
          ) : (
            <p className="m-0 p-4 text-sm text-muted">Drawing…</p>
          )}
        </div>
        {drawn && (
          <figcaption className="font-mono text-2xs text-muted">
            {drawn.width} × {drawn.height} · {drawn.kind} · {drawn.kb} kB · drawn in {drawn.ms} ms
          </figcaption>
        )}
      </figure>

      <pre className="m-0 px-3 py-2 rounded-[10px] border border-line bg-paper-2 font-mono text-xs text-ink whitespace-pre-wrap break-all select-all">
        {example}
      </pre>
    </article>
  );
}

export default function AgentScreens() {
  return (
    <div className="flex flex-col gap-6">
      {AGENT_SCREENS.map((s) => (
        <ScreenBench key={s.id} screen={s} />
      ))}
    </div>
  );
}
