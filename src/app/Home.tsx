import { useEffect, useState, type ComponentType } from 'react';
import { developPath, rollRef } from '../shared/develop/develop-route';
import { getRollThumbs, listRolls } from '../shared/develop/roll-store';
import { rollProgress } from '../shared/develop/roll-types';
import { listProjects } from '../shared/projects/project-store';
import { listTrips } from '../shared/roadtrip/trip-store';
import { roadtripPath } from '../shared/roadtrip/trip-route';
import { tripCoverage } from '../shared/roadtrip/trip-coverage';
import { formatIsoDate } from '../shared/roadtrip/trip-days';
import { useObjectUrl } from '../shared/media/use-object-url';
import { Icons } from '../shared/ui/icons';
import { TOOLS, type Tool } from './tools';

/**
 * Home page for the Atelier suite: a door per editor, and the instruments
 * behind them.
 *
 * Nine equal cards told a story of nine equal tools, while the suite is
 * converging on its editors (`studio.md`) — the Studio, Trips and Develop.
 * Each editor is a door, carrying the document this browser worked on last so
 * the page is a point of resumption rather than a menu; the pages kept until
 * the Studio absorbs them are a compact list under the name the tool menu
 * gives them, "Instruments". A door is looked up by tool id (`DOORS`), so a
 * new editor is an entry there, never another branch.
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

function DoorHead({ tool, resume }: { tool: Tool; resume: string | null }) {
  return (
    <>
      <div className="flex items-baseline gap-3">
        <h2 className="m-0 font-serif font-normal text-3xl leading-none tracking-[-0.01em]">
          {tool.label}
        </h2>
        {resume && <span className="min-w-0 truncate text-xs text-muted">{resume}</span>}
      </div>
      {tool.blurb && <p className="m-0 text-ink-soft text-sm leading-[1.55]">{tool.blurb}</p>}
      <span
        className="inline-flex items-center gap-[0.35rem] text-xs font-semibold text-accent-ink"
        aria-hidden="true"
      >
        {resume ? 'Resume' : 'Open'}
        <span className="inline-flex transition-transform duration-[250ms] ease-paper group-hover:translate-x-[3px]">
          {Icons.forward}
        </span>
      </span>
    </>
  );
}

/** The Studio's door: the project this browser touched last, with its preview. */
function StudioDoor({ tool }: { tool: Tool }) {
  const [last, setLast] = useState<{ id: string; name: string; updatedAt: number; thumbnail: Blob | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void listProjects().then((all) => {
      const p = all[0];
      if (alive && p) setLast({ id: p.id, name: p.name, updatedAt: p.updatedAt, thumbnail: p.thumbnail });
    });
    return () => {
      alive = false;
    };
  }, []);
  const thumb = useObjectUrl(last?.thumbnail ?? null);
  const href = last ? `#/studio/open/${encodeURIComponent(last.id)}` : `#${tool.path}`;
  return (
    <a href={href} className={door}>
      <div className="h-24 rounded-[10px] overflow-hidden bg-paper-2">
        {thumb ? (
          <img src={thumb} alt="" className="block w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-faint text-2xl">{Icons.video}</div>
        )}
      </div>
      <DoorHead tool={tool} resume={last ? `${last.name} · ${when(last.updatedAt)}` : null} />
    </a>
  );
}

/** The Trips' door: the trip touched last, its days as a strip. */
function TripsDoor({ tool }: { tool: Tool }) {
  const [last, setLast] = useState<{
    id: string;
    name: string;
    told: number;
    total: number;
    cells: number[];
    start: string;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    void listTrips().then((all) => {
      const t = all[0];
      if (!alive || !t) return;
      const coverage = tripCoverage(t);
      // At most 60 cells: a year is bucketed, a fortnight is a day each.
      const size = Math.max(1, Math.ceil(coverage.days.length / 60));
      const cells: number[] = [];
      for (let i = 0; i < coverage.days.length; i += size) {
        const slice = coverage.days.slice(i, i + size);
        cells.push(slice.some((d) => d.posts.length > 0) ? 1 : 0);
      }
      setLast({ id: t.id, name: t.name, told: coverage.toldDays, total: coverage.totalDays, cells, start: t.startDate });
    });
    return () => {
      alive = false;
    };
  }, []);
  const href = last ? `#${roadtripPath(last.id)}` : `#${tool.path}`;
  return (
    <a href={href} className={door}>
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
        resume={last ? `${last.name} · ${last.told}/${last.total} days told · from ${formatIsoDate(last.start)}` : null}
      />
    </a>
  );
}

/** The Develop door: the roll touched last, its first pictures as a strip. */
function DevelopDoor({ tool }: { tool: Tool }) {
  const [last, setLast] = useState<{ ref: string; name: string; developed: number; total: number; thumbs: Blob[] } | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    void listRolls().then(async (all) => {
      const r = all[0];
      if (!r) return;
      const ids = r.pictures.slice(0, 5).map((p) => p.id);
      const map = await getRollThumbs(ids);
      const { developed, total } = rollProgress(r);
      if (alive) setLast({ ref: rollRef(r), name: r.name, developed, total, thumbs: ids.flatMap((id) => map.get(id) ?? []) });
    });
    return () => {
      alive = false;
    };
  }, []);
  const href = last ? `#${developPath(last.ref)}` : `#${tool.path}`;
  return (
    <a href={href} className={door}>
      <div className="h-24 rounded-[10px] overflow-hidden bg-paper-2 flex gap-px">
        {last && last.thumbs.length > 0 ? (
          last.thumbs.map((blob, i) => <DoorThumb key={i} blob={blob} />)
        ) : (
          <div className="w-full h-full grid place-items-center text-faint text-2xl">{Icons.image}</div>
        )}
      </div>
      <DoorHead
        tool={tool}
        resume={
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
      <DoorHead tool={tool} resume={null} />
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
