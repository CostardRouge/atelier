import type { PreflightFix, PreflightIssue } from '../../shared/story/preflight';
import { Readout } from '../../shared/ui/Inspector';

/**
 * The pre-export check as the Export panel shows it (`preflight.ts`): one
 * line an issue — what would come out wrong, why in a few words, the click
 * that fixes it. Nothing is blocked: Export stays his call.
 */
export default function PreflightList({ issues, onFix }: { issues: PreflightIssue[] | null; onFix: (fix: PreflightFix) => void }) {
  if (issues === null) return <Readout muted>Checking the post…</Readout>;
  if (!issues.length) return <Readout muted>Nothing would come out wrong: the facts are counted, the faces loaded, the words clear of the buttons.</Readout>;
  const stops = issues.filter((i) => i.level === 'stop').length;
  return (
    <div className="flex flex-col gap-1.5" role="list" aria-label="Before you export">
      <p className="m-0 text-2xs text-muted">
        {stops ? `${stops} would show in the file` : 'Worth a look'}
        {issues.length > stops && stops ? `, ${issues.length - stops} worth a look` : ''}.
      </p>
      {issues.map((i) => (
        <div key={i.id} role="listitem" className="flex items-start gap-2 rounded-control border border-line bg-paper px-2 py-1.5">
          <span aria-hidden="true" className={`mt-1 shrink-0 w-2 h-2 rounded-full ${i.level === 'stop' ? 'bg-danger' : 'bg-line-strong'}`} />
          <div className="flex-1 min-w-0">
            <p className="m-0 text-xs text-ink font-semibold leading-snug">
              {i.title}
              <span className="sr-only">{i.level === 'stop' ? ' — would show in the file' : ' — worth a look'}</span>
            </p>
            <p className="m-0 text-2xs text-muted leading-snug">{i.detail}</p>
          </div>
          {i.fix ? (
            <button type="button" className="shrink-0 self-center text-2xs text-accent cursor-pointer hover:underline" onClick={() => onFix(i.fix!)}>
              {i.fix.label} →
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
