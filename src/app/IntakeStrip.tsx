import type { MediaIntake } from '../shared/sources/media-scope';

/**
 * The work the active tool takes pictures into, drawn small at the head of
 * the Library's sheet — Trips' piece, slide by slide. On a phone the sheet
 * covers the band under the stage, and adding a picture is only worth it if
 * the piece is seen growing; on a computer the band is beside the Library
 * already, so this is a sheet's alone (a fact is said once).
 */
export default function IntakeStrip({ intake, note }: { intake: MediaIntake; note: string | null }) {
  const count = intake.items.filter((i) => i.number !== null).length;
  return (
    <div className="mx-3.5 mb-2.5 px-2.5 py-2 rounded-paper border border-line bg-paper/60 flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1.5 text-xs text-ink-soft min-w-0">
        <span className="font-semibold text-ink">{intake.title}</span>
        <span className="font-mono">{count}</span>
        <span>{count === 1 ? intake.noun : `${intake.noun}s`}</span>
        <span className="flex-1" />
        <span aria-live="polite" className="text-accent-ink font-medium truncate">
          {note ?? ''}
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto">
        {intake.items.map((item) =>
          item.number === null ? (
            <span
              key={item.key}
              className="flex-none w-[30px] h-[38px] rounded-[3px] border border-dashed border-line-strong grid place-items-center font-mono text-3xs text-muted"
              title="The closing card"
            >
              End
            </span>
          ) : (
            <span
              key={item.key}
              className={`relative flex-none w-[30px] h-[38px] rounded-[3px] overflow-hidden bg-frame ${
                item.open ? 'outline outline-2 outline-offset-1 outline-ink' : ''
              }`}
              title={`${intake.noun} ${item.number}`}
            >
              {item.thumb && <img src={item.thumb} alt="" className="w-full h-full object-cover block" draggable={false} />}
              <span className="absolute left-[2px] bottom-0 font-mono text-3xs text-on-media [text-shadow:0_0_3px_#100f0d]">
                {item.number}
              </span>
              {item.fresh && (
                <span className="absolute top-[2px] right-[2px] w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
              )}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
