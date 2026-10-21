import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAssetLibrary, useAssetMeta } from '../../shared/library/AssetLibraryContext';
import { fileBaseName, type Asset } from '../../shared/library/assets';
import IntakeStrip from '../../shared/library/IntakeStrip';
import { instantOf, orderPicks } from '../../shared/library/pick-order';
import { useObjectUrls } from '../../shared/lib/use-object-urls';
import type { CubeLut } from '../../shared/lib/cube-parser';
import type { FrameGrader } from '../../shared/lut/frame-grader';
import { describeKeyTarget, targetOwnsTyping } from '../../shared/media/transport-keys';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import type { MediaIntake } from '../../shared/sources/media-scope';
import type { WinnowAssetRow } from '../../shared/sources/winnow/client';
import { materialize } from '../../shared/sources/winnow/materialize';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import { useScopeRows } from '../../shared/sources/winnow/use-scope-rows';
import WinnowThumb from '../../shared/sources/winnow/WinnowThumb';
import { Icons } from '../../shared/ui/icons';
import { PRESS_LOOK } from '../../shared/ui/press';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import { auditionStill } from './audition-look';

/** One picture of the day the Audition can offer — from the Library, or from the instance. */
interface Candidate {
  key: string;
  /** Its base name, what the intake knows a picture by. */
  base: string;
  /** Its file name, said in the header. */
  label: string;
  at: number | null;
  video: boolean;
  /** A Library file: it is already here. */
  asset: Asset | null;
  file: File | null;
  /** An instance's row: brought across only when it is kept. */
  row: WinnowAssetRow | null;
}

/** `YYYY-MM-DD` of a local instant. */
function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The day's pictures, auditioned for the piece ON its own frame: each one
 * drawn the way a new slide of this piece would show it — cropped to the
 * piece's shape, through its look — rather than as a square thumbnail, and
 * kept or passed with one gesture under the thumb. Add takes it as a new
 * slide (before the closing card) and moves on; Skip moves on; the piece
 * grows at the foot. Nothing else on screen: on a phone this is the whole
 * way through a day, with no sheet to open and close per picture.
 *
 * Its candidates are the piece's day on the connected instance (brought
 * across only when kept) and the Library's own files taken that day (all of
 * them when none is dated that day), in the order they were taken. The
 * pictures already in the piece are offered too, marked with their number,
 * so the day reads whole.
 */
export default function AuditionSheet({
  day,
  aspect,
  lut,
  intake,
  localAssets,
  addToPool,
  onClose,
}: {
  /** The piece's day or span, `YYYY-MM-DD`. */
  day: { from: string; to: string };
  /** The piece's frame, width ÷ height. */
  aspect: number;
  /** The piece's look, or null for none. */
  lut: CubeLut | null;
  intake: MediaIntake;
  /** The Library's own files — those an instance did not hand over. */
  localAssets: readonly Asset[];
  /** Put files an instance handed over into the Library. */
  addToPool: (files: File[]) => void;
  onClose: () => void;
}) {
  const { connection, client } = useWinnowConnection();
  const scope = useScopeRows(client, connection?.id ?? null, day.from, day.to, true);

  const candidates = useMemo<Candidate[]>(() => {
    const locals = localAssets.flatMap((asset): Candidate[] => {
      const file = asset.parts.image ?? asset.parts.video ?? null;
      if (!file) return [];
      return [
        {
          key: `local:${asset.id}`,
          base: asset.baseName,
          label: file.name,
          at: file.lastModified || null,
          video: !asset.parts.image,
          asset,
          file,
          row: null,
        },
      ];
    });
    const ofTheDay = locals.filter((c) => c.at !== null && localDay(c.at) >= day.from && localDay(c.at) <= day.to);
    const remotes = (scope.rows ?? [])
      .filter((r) => r.media_type === 'photo' || r.media_type === 'video')
      .map(
        (row): Candidate => ({
          key: `remote:${row.id}`,
          base: fileBaseName(row.filename),
          label: row.filename,
          at: instantOf(row.captured_at),
          video: row.media_type === 'video',
          asset: null,
          file: null,
          row,
        }),
      );
    const all = [...(ofTheDay.length ? ofTheDay : locals), ...remotes];
    // The same picture in the Library AND on the instance is offered once.
    const seen = new Set<string>();
    const unique = all.filter((c) => {
      const b = c.base.toLowerCase();
      if (seen.has(b)) return false;
      seen.add(b);
      return true;
    });
    const byKey = new Map(unique.map((c) => [c.key, c]));
    return orderPicks(unique, true).map((k) => byKey.get(k)!);
  }, [localAssets, scope.rows, day.from, day.to]);

  const [index, setIndex] = useState<number | null>(null);
  // Opens on the first picture not yet in the piece, once the day is known.
  useEffect(() => {
    if (index !== null || candidates.length === 0) return;
    if (connection && scope.rows === null && scope.problem === null) return;
    const first = candidates.findIndex((c) => intake.placeOf(c.base) === null);
    setIndex(first < 0 ? 0 : first);
  }, [index, candidates, connection, scope.rows, scope.problem, intake]);
  const at = index === null ? -1 : Math.min(index, candidates.length - 1);
  const cur = at >= 0 ? candidates[at] : null;
  const count = candidates.length;
  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);

  // --- what is drawn: the plain picture at once, the piece's version over it
  const near = useMemo(() => {
    const files = new Map<string, File>();
    for (const d of [0, 1, -1]) {
      const c = count ? candidates[(at + d + count) % count] : undefined;
      if (c?.file) files.set(c.key, c.file);
    }
    return files;
  }, [candidates, at, count]);
  const plainUrls = useObjectUrls(near);
  const [look, setLook] = useState(true);
  const graders = useRef(new Map<string, FrameGrader>());
  const graded = useRef(new Map<string, string>());
  const [, setGradedTick] = useState(0);
  useEffect(
    () => () => {
      for (const g of graders.current.values()) g.dispose();
      graders.current.clear();
      for (const url of graded.current.values()) URL.revokeObjectURL(url);
      graded.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (!cur || cur.video || graded.current.has(cur.key)) return;
    let alive = true;
    void (async () => {
      const blob =
        cur.file ??
        (cur.row && client ? await client.fetchFile(client.proxyUrl(cur.row.id), cur.label, '', 0).catch(() => null) : null);
      if (!blob || !alive) return;
      const out = await auditionStill(blob, cur.label, aspect, lut, graders.current);
      if (!out || !alive) return;
      graded.current.set(cur.key, URL.createObjectURL(out));
      setGradedTick((n) => n + 1);
    })();
    return () => {
      alive = false;
    };
  }, [cur, client, aspect, lut]);
  const plain = cur ? (cur.file ? (plainUrls.get(cur.key) ?? null) : cur.row && client ? client.proxyUrl(cur.row.id) : null) : null;
  const pieceVersion = cur && look ? (graded.current.get(cur.key) ?? null) : null;

  // --- keeping one ------------------------------------------------------------
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const busyRef = useRef(false);
  const keep = async () => {
    if (!cur || busyRef.current || intake.locked) return;
    if (intake.placeOf(cur.base) !== null) {
      go(at + 1);
      return;
    }
    busyRef.current = true;
    setBusy(cur.key);
    setProblem(null);
    const number = intake.next;
    try {
      let file = cur.file;
      if (!file && cur.row && client && connection) {
        const files = await materialize(client, connection.id, cur.row, { fidelity: 'proxy' });
        addToPool(files);
        file = files.find((f) => !/\.srt$/i.test(f.name)) ?? null;
      }
      if (!file) throw new Error(`${cur.label} could not be had`);
      await intake.add([file]);
      setNote(`Slide ${number} added`);
      go(at + 1);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  const held = cur ? intake.placeOf(cur.base) : null;
  const removable = cur && held !== null ? intake.removable(cur.base) : false;
  const takeBack = () => {
    if (cur && removable) intake.remove(cur.base);
  };
  const added = intake.items.filter((i) => i.fresh).length;

  useDialogKeys({ onCancel: onClose, onConfirm: null });
  const keys = useRef({ go, keep, takeBack, at });
  keys.current = { go, keep, takeBack, at };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || targetOwnsTyping(describeKeyTarget(e.target))) return;
      const k = keys.current;
      if (e.key === 'ArrowRight') k.go(k.at + 1);
      else if (e.key === 'ArrowLeft') k.go(k.at - 1);
      else if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowUp') void k.keep();
      else if (e.key === 'Backspace') k.takeBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A swipe: sideways moves on, upwards keeps.
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) go(at + (dx < 0 ? 1 : -1));
    else if (dy < -64 && Math.abs(dy) > Math.abs(dx)) void keep();
  };

  const asking = connection !== null && scope.rows === null && scope.problem === null;
  const dayName = day.from === day.to ? formatIsoDate(day.from) : `${formatIsoDate(day.from)} → ${formatIsoDate(day.to)}`;
  const where = connection ? `the Library or on ${connection.id}` : 'the Library';
  const arrow = 'w-11 h-11 grid place-items-center rounded-full border-0 bg-[rgba(16,15,13,0.55)] text-on-media cursor-pointer [&>svg]:w-5 [&>svg]:h-5';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-frame text-on-media pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      role="dialog"
      aria-modal="true"
      aria-label="Add pictures to this piece"
    >
      <div className="flex-none flex items-center gap-3 px-4 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">Add to this piece</div>
          <div className="font-mono text-2xs text-on-media/75 truncate">
            {cur ? `${at + 1} / ${count} · ${cur.label}` : dayName}
            {added > 0 && <span aria-live="polite"> · {added} added</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`h-10 px-4 rounded-full border-0 bg-paper text-ink text-sm font-semibold cursor-pointer ${PRESS_LOOK}`}
        >
          Done
        </button>
      </div>

      <div className="relative flex-1 min-h-0 [container-type:size] grid place-items-center px-3">
        {cur ? (
          <div
            className="relative overflow-hidden rounded-[3px] bg-black touch-pan-y select-none"
            style={{ aspectRatio: String(aspect), width: `min(100cqw, calc(100cqh * ${aspect}))` }}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (swipe.current = null)}
          >
            {cur.video ? (
              plain && <video key={cur.key} src={plain} muted playsInline autoPlay loop className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              plain && <img src={plain} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
            )}
            {pieceVersion && (
              <img src={pieceVersion} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
            )}
            {!cur.video && (
              <button
                type="button"
                onClick={() => setLook((l) => !l)}
                aria-pressed={look}
                title={look ? 'Show the picture as shot' : 'Show it as a slide of this piece: its frame and its look'}
                className="absolute top-2 left-2 h-7 px-2.5 rounded-full border-0 bg-[rgba(16,15,13,0.62)] text-on-media text-xs cursor-pointer"
              >
                {look ? (lut ? 'Piece look' : 'Piece frame') : 'As shot'}
              </button>
            )}
            {held !== null && (
              <span className="absolute top-2 right-2 h-7 px-2.5 inline-flex items-center gap-1 rounded-full bg-accent text-paper text-xs font-semibold [&>svg]:w-3 [&>svg]:h-3">
                {Icons.check}Slide {held}
              </span>
            )}
            {busy === cur.key && (
              <span className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden" role="progressbar" aria-label="Bringing it across">
                <span className="block h-full w-1/4 bg-accent animate-deck-load" />
              </span>
            )}
          </div>
        ) : (
          <p className="m-0 text-sm text-on-media/80 text-center px-6">
            {asking ? `Asking ${connection?.id}…` : `Nothing shot on ${dayName} in ${where}.`}
          </p>
        )}
        {count > 1 && (
          <>
            <button type="button" aria-label="Previous picture" onClick={() => go(at - 1)} className={`absolute left-2 top-1/2 -translate-y-1/2 ${arrow}`}>
              {Icons.back}
            </button>
            <button type="button" aria-label="Next picture" onClick={() => go(at + 1)} className={`absolute right-2 top-1/2 -translate-y-1/2 ${arrow}`}>
              {Icons.forward}
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex-none flex gap-0.5 px-3 pt-2 overflow-x-auto" aria-label="The day's pictures">
          {candidates.map((c, i) => (
            <button
              key={c.key}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show ${c.label}`}
              aria-current={i === at}
              className={`relative flex-none w-[26px] h-[34px] p-0 border-0 overflow-hidden cursor-pointer bg-black ${
                i === at ? 'outline outline-2 outline-offset-1 outline-on-media' : 'opacity-70'
              }`}
            >
              {c.row && client ? (
                <WinnowThumb client={client} id={c.row.id} label={c.video ? 'video' : 'photo'} box="w-full h-full" />
              ) : c.asset ? (
                <LocalThumb asset={c.asset} />
              ) : null}
              {intake.placeOf(c.base) !== null && <span className="absolute inset-x-0 bottom-0 h-1 bg-accent" />}
            </button>
          ))}
        </div>
      )}

      {problem && (
        <p role="alert" className="m-0 mx-4 mt-2 text-xs text-accent-wash">
          {problem}
        </p>
      )}

      <div className="flex-none flex gap-2 px-4 pt-2.5 pb-2">
        <button
          type="button"
          onClick={() => go(at + 1)}
          disabled={!cur}
          className={`flex-1 h-14 rounded-[14px] border border-white/25 bg-transparent text-on-media text-base cursor-pointer disabled:opacity-40 ${PRESS_LOOK}`}
        >
          Skip
        </button>
        {held === null ? (
          <button
            type="button"
            onClick={() => void keep()}
            aria-disabled={!cur || busy !== null || intake.locked !== null}
            title={intake.locked ?? 'Add it as a new slide and show the next (A, or swipe up)'}
            className={`flex-[2] h-14 rounded-[14px] border-0 bg-accent text-paper text-base font-semibold inline-flex items-center justify-center gap-2 cursor-pointer aria-disabled:opacity-50 [&>svg]:w-[18px] [&>svg]:h-[18px] ${PRESS_LOOK}`}
          >
            {Icons.plus}
            {busy ? 'Adding…' : `Add as slide ${intake.next}`}
          </button>
        ) : removable ? (
          <button
            type="button"
            onClick={takeBack}
            className={`flex-[2] h-14 rounded-[14px] border-[1.5px] border-accent bg-transparent text-on-media text-base font-semibold cursor-pointer ${PRESS_LOOK}`}
          >
            Slide {held} · take back
          </button>
        ) : (
          <span className="flex-[2] h-14 rounded-[14px] border border-white/15 grid place-items-center text-sm text-on-media/75">
            Already slide {held}
          </span>
        )}
      </div>

      <div className="flex-none px-3 pb-2 text-ink">
        <IntakeStrip intake={intake} note={note} className="m-0 bg-paper" />
      </div>
    </div>,
    document.body,
  );
}

/** A Library file's cover in the day strip. */
function LocalThumb({ asset }: { asset: Asset }) {
  const { ensureMeta } = useAssetLibrary();
  const meta = useAssetMeta(asset.id);
  useEffect(() => ensureMeta(asset.id), [ensureMeta, asset.id]);
  return meta?.thumbUrl ? (
    <img src={meta.thumbUrl} alt="" draggable={false} className="w-full h-full object-cover block" />
  ) : (
    <span className="grid place-items-center w-full h-full bg-black text-3xs" aria-hidden="true">
      {asset.parts.image ? '' : '▶'}
    </span>
  );
}
