import { viewLabel } from '../../shared/develop/capture-view';
import { classifyPart } from '../../shared/library/assets';
import { formatBytes } from '../../shared/lib/format';
import { renditionFacts, type Rendition } from '../../shared/media/renditions';
import { stageChipLabel } from '../../shared/projects/media-rendition';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';

/** What a row IS, in the words under its name. */
function describe(row: Rendition): string {
  if (row.blocked) return row.blocked;
  if (row.role === 'proxy') {
    return 'the source’s editing rendition — light and quick to scrub, where the media opens';
  }
  const where = row.here ? 'in hand' : 'fetched from its instance on request, held for this session';
  if (row.reach === 'embedded') return `the render the camera wrote inside the RAW — ${where}`;
  const what = classifyPart(row.name) === 'video' ? 'the rush itself, at its own resolution' : 'the file itself, at its own size';
  return `${what} — ${where}; the export delivers from it`;
}

/**
 * WHICH FILE of the open media the stage shows (2026-09-29): a chip beside
 * its name — `Proxy`, else the file's type (`stageChipLabel`: the name is
 * already beside it) — whose menu lists the capture's files by their whole
 * names, the fidelity chip's vocabulary (`capture-view.ts`), with their pixels
 * and weight: the Develop tool's list minus the sensor.
 *
 * Nothing is drawn where there is nothing to switch to: a file of one's own,
 * a source that sent the capture itself. A chevron over a menu that cannot
 * change anything is an invitation to a dead end.
 */
export default function StageRenditionMenu({
  baseName,
  rows,
  current,
  fetching,
  onChoose,
}: {
  /** The media's name, drawn beside the chip. */
  baseName: string;
  rows: readonly Rendition[];
  current: Rendition | null;
  /** The chosen file is on its way; the stage keeps the proxy meanwhile. */
  fetching: boolean;
  onChoose: (id: string) => void;
}) {
  if (rows.length < 2 || !current) return null;
  const items: OverflowItem[] = rows.map((row) => {
    const marked = row.id === current.id;
    const facts = renditionFacts(row, formatBytes);
    const hint = marked && fetching ? 'on its way — the proxy stays on the stage until it lands' : describe(row);
    return {
      id: row.id,
      title: hint,
      disabled: Boolean(row.blocked),
      onSelect: () => onChoose(row.id),
      label: (
        <span className="flex flex-col items-start gap-0.5 text-left">
          <span className="font-mono text-xs">
            {marked ? '· ' : '  '}
            {viewLabel(row)}
            {facts && <span className="text-faint"> · {facts}</span>}
          </span>
          <span className="font-mono text-3xs text-faint leading-relaxed max-w-[22rem] whitespace-normal">{hint}</span>
        </span>
      ),
    };
  });
  const onProxy = current.role === 'proxy';
  const label = stageChipLabel(current, baseName);
  const whole = viewLabel(current);
  return (
    <OverflowMenu
      label="Which file of this media the stage shows"
      className="min-w-0 flex-none"
      size="sm"
      align="start"
      trigger={{
        bare: true,
        title: fetching ? `Fetching ${whole}…` : `On the stage: ${whole} — switch to another file of this capture`,
        className: `group min-w-0 max-w-[14rem] inline-flex items-center gap-1 rounded-full border px-2 py-[2px] font-mono text-2xs tracking-[0.06em] cursor-pointer transition-colors ${
          onProxy
            ? 'border-line-strong bg-paper text-ink-soft hover:border-accent hover:text-accent-ink'
            : 'border-accent bg-accent-wash text-accent-ink hover:text-accent'
        }`,
        text: (
          <>
            {fetching && (
              <span className="flex-none" aria-hidden="true">
                ↓
              </span>
            )}
            <span className="min-w-0 truncate">{label}</span>
            <span className="flex-none text-3xs opacity-70" aria-hidden="true">
              ▾
            </span>
          </>
        ),
      }}
      items={items}
    />
  );
}
