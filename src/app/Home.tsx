import { useEffect, useState, type ComponentType } from 'react';
import { useObjectUrl } from '../shared/media/use-object-url';
import { Icons } from '../shared/ui/icons';
import type { DevelopDoorFacts, StudioDoorFacts, TripsDoorFacts } from './documents-read';
import { TOOLS, type Tool } from './tools';

/**
 * The stores are read through `documents-read.ts`, imported HERE and only
 * when a door mounts: a static import put the three document models on the
 * shell's first-paint chunk (audit PERF-04). The types alone cross statically.
 */
const readDocuments = () => import('./documents-read');

/**
 * Home page for the Atelier suite: a door per editor, and the instruments
 * behind them.
 *
 * Nine equal cards told a story of nine equal tools, while the suite is
 * converging on its editors (`studio.md`) — the Studio, Trips and Develop.
 * Each editor is a door: it SHOWS the document this browser worked on last —
 * its preview, its name, how far it got — and OPENS that editor's gallery,
 * where the choice is made. It used to open the document itself, and the
 * maintainer had it back (`frontend.md`): a resume destination is right only
 * when you came back for the same thing. The pages kept until the Studio
 * absorbs them are a compact list under the name the tool menu gives them,
 * "Instruments". A door is looked up by tool id (`DOORS`), so a new editor is
 * an entry there, never another branch.
 */
export default function Home() {
  const editors = TOOLS.filter((t) => t.group === 'editor');
  const instruments = TOOLS.filter((t) => t.group === 'instrument');

  return (
    <>
      <section className="grid grid-cols-1 gap-6 pt-[clamp(2.5rem,7vw,5rem)] pb-[clamp(1.5rem,4vw,2.5rem)] min-[820px]:grid-cols-[1.35fr_1fr] min-[820px]:items-end">
        <div>
          <p className="flex items-center gap-[0.6rem] m-0 mb-4 font-mono text-xs uppercase tracking-[0.2em] text-accent-ink before:content-[''] before:w-[26px] before:h-px before:bg-accent">
            A studio for your captures
          </p>
          <h1 className="m-0 font-serif font-normal text-[clamp(2.8rem,8vw,5.2rem)] leading-[0.95] tracking-[-0.02em]">
            One bench,
            <br />
            every <em className="text-accent italic">tool.</em>
          </h1>
        </div>
        <p className="m-0 max-w-[44ch] text-ink-soft text-base leading-[1.6]">
          Atelier is a small suite of local-first tools for editing the footage
          you shoot — read flight telemetry in sync with the frame, grade clips
          with LUTs, and more to come.{' '}
          <strong className="font-semibold text-ink">Nothing uploads — everything stays on your machine.</strong>
        </p>
      </section>

      {/* One column, then a row of three: two columns would leave the third
          door alone on a line of its own. */}
      <section className="grid grid-cols-1 gap-4 mb-10 min-[900px]:grid-cols-3" aria-label="Editors">
        {editors.map((t) => {
          const Door = DOORS[t.id] ?? PlainDoor;
          return <Door key={t.id} tool={t} />;
        })}
      </section>

      <section className="mb-12" aria-label="Instruments">
        <p className="m-0 mb-2 font-mono text-2xs uppercase tracking-[0.16em] text-muted">
          Instruments
        </p>
        <ul className="m-0 p-0 list-none grid grid-cols-1 border-t border-line min-[560px]:grid-cols-2 min-[900px]:grid-cols-3">
          {instruments.map((t) => (
            <li key={t.id} className="border-b border-line">
              <a
                href={`#${t.path}`}
                className="group flex items-baseline gap-3 py-3 pr-3 no-underline text-inherit hover:text-accent-ink"
              >
                <span className="text-base font-medium">{t.label}</span>
                {t.subtitle && (
                  <span className="min-w-0 truncate text-xs text-muted group-hover:text-ink-soft">
                    {t.subtitle}
                  </span>
                )}
                <span className="ml-auto inline-flex text-faint group-hover:text-accent-ink transition-transform duration-[250ms] ease-paper group-hover:translate-x-[3px]">
                  {Icons.forward}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const door =
  'group relative flex flex-col gap-3 p-5 border border-line rounded-paper-lg bg-surface no-underline text-inherit shadow-paper-soft transition-[border-color,box-shadow] duration-[250ms] ease-paper hover:border-line-strong hover:shadow-paper';

/**
 * `last` is what is waiting behind the door, never where the click goes: the
 * verb is Open at every state, or the card would promise a document it does
 * not open.
 */
function DoorHead({ tool, last }: { tool: Tool; last: string | null }) {
  return (
    <>
      <div className="flex items-baseline gap-3">
        <h2 className="m-0 font-serif font-normal text-3xl leading-none tracking-[-0.01em]">
          {tool.label}
        </h2>
        {last && <span className="min-w-0 truncate text-xs text-muted">{last}</span>}
      </div>
      {tool.blurb && <p className="m-0 text-ink-soft text-sm leading-[1.55]">{tool.blurb}</p>}
      <span
        className="inline-flex items-center gap-[0.35rem] text-xs font-semibold text-accent-ink"
        aria-hidden="true"
      >
        Open
        <span className="inline-flex transition-transform duration-[250ms] ease-paper group-hover:translate-x-[3px]">
          {Icons.forward}
        </span>
      </span>
    </>
  );
}

/** The Studio's door: the project this browser touched last, with its preview. */
function StudioDoor({ tool }: { tool: Tool }) {
  const [last, setLast] = useState<StudioDoorFacts | null>(null);
  useEffect(() => {
    let alive = true;
    void readDocuments()
      .then((m) => m.studioDoor())
      .then((facts) => {
        if (alive && facts) setLast(facts);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const thumb = useObjectUrl(last?.thumbnail ?? null);
  return (
    <a href={`#${tool.path}`} className={door}>
      <div className="h-24 rounded-[10px] overflow-hidden bg-paper-2">
        {thumb ? (
          <img src={thumb} alt="" className="block w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-faint text-2xl">{Icons.video}</div>
        )}
      </div>
      <DoorHead tool={tool} last={last ? `${last.name} · ${when(last.updatedAt)}` : null} />
    </a>
  );
}

/** The Trips' door: the trip touched last, its days as a strip. */
function TripsDoor({ tool }: { tool: Tool }) {
  const [last, setLast] = useState<TripsDoorFacts | null>(null);
  useEffect(() => {
    let alive = true;
    void readDocuments()
      .then((m) => m.tripsDoor())
      .then((facts) => {
        if (alive && facts) setLast(facts);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <a href={`#${tool.path}`} className={door}>
      <div className="h-24 rounded-[10px] bg-paper-2 p-3 flex items-end gap-px">
        {last ? (
          last.cells.map((on, i) => (
            <span
              key={i}
              className={`flex-1 min-w-0 rounded-[1px] ${on ? 'bg-accent h-full' : 'bg-line-strong h-1/4'}`}
            />
          ))
        ) : (
          <div className="w-full h-full grid place-items-center text-faint text-2xl">{Icons.calendar}</div>
        )}
      </div>
      <DoorHead
        tool={tool}
        last={last ? `${last.name} · ${last.told}/${last.total} days told · from ${last.start}` : null}
      />
    </a>
  );
}

/** The Develop door: the roll touched last, its first pictures as a strip. */
function DevelopDoor({ tool }: { tool: Tool }) {
  const [last, setLast] = useState<DevelopDoorFacts | null>(null);
  useEffect(() => {
    let alive = true;
    void readDocuments()
      .then((m) => m.developDoor())
      .then((facts) => {
        if (alive && facts) setLast(facts);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <a href={`#${tool.path}`} className={door}>
      <div className="h-24 rounded-[10px] overflow-hidden bg-paper-2 flex gap-px">
        {last && last.thumbs.length > 0 ? (
          last.thumbs.map((blob, i) => <DoorThumb key={i} blob={blob} />)
        ) : (
          <div className="w-full h-full grid place-items-center text-faint text-2xl">{Icons.image}</div>
        )}
      </div>
      <DoorHead
        tool={tool}
        last={
          last
            ? `${last.name} · ${last.total === 0 ? 'no pictures yet' : `${last.developed} of ${last.total} developed`}`
            : null
        }
      />
    </a>
  );
}

function DoorThumb({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob);
  return (
    <div className="flex-1 min-w-0 h-full bg-frame">
      {url && <img src={url} alt="" className="block w-full h-full object-cover" />}
    </div>
  );
}

/** An editor with no door of its own yet: its name and pitch. */
function PlainDoor({ tool }: { tool: Tool }) {
  return (
    <a href={`#${tool.path}`} className={door}>
      <DoorHead tool={tool} last={null} />
    </a>
  );
}

const DOORS: Record<string, ComponentType<{ tool: Tool }>> = {
  studio: StudioDoor,
  roadtrip: TripsDoor,
  develop: DevelopDoor,
};

function when(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
