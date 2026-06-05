import type { Asset } from '../../shared/library/assets';
import type { MediaMeta, Verdict } from '../../shared/library/AssetLibraryContext';
import Cell from './Cell';

interface GridProps {
  assets: Asset[];
  focusedId: string | null;
  meta: ReadonlyMap<string, MediaMeta>;
  verdicts: ReadonlyMap<string, Verdict>;
  ensureMeta: (id: string) => void;
  onFocus: (id: string) => void;
  className?: string;
}

/** The triage grid — a scrollable strip of tiles for the filtered working set. */
export default function Grid({
  assets,
  focusedId,
  meta,
  verdicts,
  ensureMeta,
  onFocus,
  className,
}: GridProps) {
  return (
    <div
      className={`grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1.5 content-start overflow-y-auto ${className ?? ''}`}
    >
      {assets.map((a) => (
        <Cell
          key={a.id}
          asset={a}
          meta={meta.get(a.id)}
          verdict={verdicts.get(a.id)}
          focused={a.id === focusedId}
          onFocus={() => onFocus(a.id)}
          onEnsure={() => ensureMeta(a.id)}
        />
      ))}
    </div>
  );
}
