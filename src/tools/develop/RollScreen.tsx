import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import DevelopSheet from '../../shared/develop/DevelopSheet';
import type { DevelopApplyVerb } from '../../shared/develop/develop-host';
import { describeDevelop, isDefaultDevelop, type DevelopSettings } from '../../shared/develop/develop';
import { pictureFidelity } from '../../shared/develop/picture-fidelity';
import { deleteRollThumbs, getRollThumbs, putRollThumb } from '../../shared/develop/roll-store';
import { pictureThumbnail } from '../../shared/develop/roll-thumb';
import {
  addPictures,
  patchPicture,
  removePictures,
  rollProgress,
  type RollDoc,
  type RollPicture,
} from '../../shared/develop/roll-types';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { findMedia, hashedMediaRefs } from '../../shared/projects/media-identity';
import Button from '../../shared/ui/Button';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import EmptyState from '../../shared/ui/EmptyState';
import PageBar from '../../shared/ui/PageBar';
import { Icons } from '../../shared/ui/icons';
import { pageScroll } from '../../shared/ui/page-scroll';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useRollGrade } from './use-roll-grade';

interface RollScreenProps {
  roll: RollDoc;
  /** The picture the route names; its Develop sheet is open. */
  pictureId: string | null;
  onBack: () => void;
  onChange: (roll: RollDoc) => void;
  onOpenPicture: (pictureId: string | null) => void;
  /** The sync pill, for a roll kept on an instance. */
  headerExtra?: ReactNode;
}

/**
 * A roll as a CONTACT SHEET — the Develop tool's first screen over a roll
 * (D5 of `docs/develop-tool.md`): its pictures in the strip's order, added
 * from the Library's selection, each opening the shared Develop sheet, the
 * roll's look riding the one stack every picture is developed through. The
 * full-screen editor (stage, filmstrip, inspector — D6) replaces the sheet
 * with the same blocks; this screen is what it grows from.
 *
 * A picture is a REF (`roll-types.ts`): its bytes are the Library's, found by
 * name then hash, so the sheet on another device says where the picture is
 * missing instead of showing someone else's.
 */
export default function RollScreen({ roll, pictureId, onBack, onChange, onOpenPicture, headerExtra }: RollScreenProps) {
  const lib = useAssetLibrary();
  const compact = useIsCompact();
  const stack = useRollGrade(roll, onChange);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<RollPicture | null>(null);

  const libraryPhotos = useMemo(
    () => lib.assets.filter((a) => a.kind === 'photo' && a.parts.image).map((a) => a.parts.image!),
    [lib.assets],
  );
  const selectedPhotos = useMemo(
    () =>
      lib.assets
        .filter((a) => lib.selection.has(a.id) && a.kind === 'photo' && a.parts.image)
        .map((a) => a.parts.image!),
    [lib.assets, lib.selection],
  );

  // --- where each picture's bytes are ---------------------------------------
  const [files, setFiles] = useState<ReadonlyMap<string, File>>(new Map());
  const refKey = roll.pictures.map((p) => `${p.id}:${p.ref.name}:${p.ref.hash ?? ''}`).join('|');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const found = new Map<string, File>();
      for (const p of roll.pictures) {
        const file = await findMedia(p.ref, libraryPhotos);
        if (file) found.set(p.id, file);
      }
      if (alive) setFiles(found);
    })();
    return () => {
      alive = false;
    };
    // `refKey` is what the pictures' identities stringify to.
  }, [refKey, libraryPhotos]);

  // --- thumbnails: stored, else baked from the Library's file ---------------
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, Blob>>(new Map());
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  /** The pictures the stored thumbnails were read for — baking waits on it, or it re-bakes what is stored. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const idsKey = roll.pictures.map((p) => p.id).join('|');
  useEffect(() => {
    let alive = true;
    void getRollThumbs(roll.pictures.map((p) => p.id)).then((stored) => {
      if (!alive) return;
      setThumbs(stored);
      setLoadedFor(idsKey);
    });
    return () => {
      alive = false;
    };
  }, [idsKey]);

  /** Tried once per picture per visit: a file the browser cannot decode is not retried on every render. */
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (loadedFor !== idsKey) return;
    const due = roll.pictures.filter(
      (p) => files.has(p.id) && !thumbsRef.current.has(p.id) && !tried.current.has(p.id),
    );
    if (due.length === 0) return;
    let alive = true;
    void (async () => {
      // One at a time: a roll of big stills never holds two decodes at once.
      for (const p of due) {
        if (!alive) return;
        tried.current.add(p.id);
        const blob = await pictureThumbnail(files.get(p.id)!);
        if (!blob) continue;
        await putRollThumb(p.id, blob);
        // Set even when this run was superseded: the picture is marked tried,
        // so no later run would draw it.
        setThumbs((cur) => new Map(cur).set(p.id, blob));
      }
    })();
    return () => {
      alive = false;
    };
    // `idsKey` stands for the pictures; `roll.pictures` is read through it.
  }, [files, loadedFor, idsKey]);

  // --- verbs ----------------------------------------------------------------
  async function addSelected() {
    if (selectedPhotos.length === 0) return;
    setAdding(true);
    setNotice(null);
    try {
      const refs = await hashedMediaRefs(selectedPhotos);
      const next = addPictures(roll, refs);
      const added = next.pictures.length - roll.pictures.length;
      const already = refs.length - added;
      if (next !== roll) onChange(next);
      setNotice(
        added === 0
          ? `Already on the roll: ${already === 1 ? 'that picture' : `all ${already}`}.`
          : `Added ${added}${already > 0 ? ` · ${already} already on the roll` : ''}.`,
      );
    } finally {
      setAdding(false);
    }
  }

  function remove(picture: RollPicture) {
    onChange(removePictures(roll, [picture.id]));
    void deleteRollThumbs([picture.id]);
    if (pictureId === picture.id) onOpenPicture(null);
  }

  const open = pictureId ? (roll.pictures.find((p) => p.id === pictureId) ?? null) : null;
  const openFile = open ? (files.get(open.id) ?? null) : null;
  const others = open ? roll.pictures.length - 1 : 0;
  const applyTo = useMemo<DevelopApplyVerb[]>(() => {
    if (!open || others === 0) return [];
    return [
      {
        id: 'roll',
        label: `Apply to ${others} other picture${others === 1 ? '' : 's'}`,
        hint: 'the rest of this roll, each as its own copy',
        run: (settings: DevelopSettings) => {
          const develop = isDefaultDevelop(settings) ? null : settings;
          const pictures = roll.pictures.map((p) =>
            p.id === open.id ? p : { ...p, develop: develop ? { ...develop } : null },
          );
          onChange({ ...roll, pictures, updatedAt: Date.now() });
        },
      },
    ];
  }, [open, others, roll, onChange]);

  const progress = rollProgress(roll);
  const addLabel =
    selectedPhotos.length === 0 ? 'Add from Library' : `Add ${selectedPhotos.length} selected`;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageBar
        back={{ label: 'Rolls', onClick: onBack }}
        trailing={
          <>
            {headerExtra}
            <Button
              variant="primary"
              icon={Icons.plus}
              onClick={() => void addSelected()}
              disabled={selectedPhotos.length === 0 || adding}
              title={
                selectedPhotos.length === 0
                  ? 'Tick photos in the Library first — they are added here in that order'
                  : 'Add the photos ticked in the Library; a picture already on the roll is not added twice'
              }
            >
              {adding ? 'Adding…' : addLabel}
            </Button>
          </>
        }
      >
        <RollTitle name={roll.name} onRename={(name) => onChange({ ...roll, name, updatedAt: Date.now() })} />
      </PageBar>

      <section className={`${pageScroll} ${compact ? 'pt-2' : 'pt-3'}`} aria-label={`Pictures of ${roll.name}`}>
        <p className="m-0 font-mono text-2xs text-muted tabular-nums">
          {progress.total === 0
            ? 'no pictures yet'
            : `${progress.developed} of ${progress.total} developed`}
          {roll.grade && <span className="text-faint"> · the roll has a look</span>}
          {notice && <span className="text-ink-soft"> · {notice}</span>}
        </p>

        {roll.pictures.length === 0 ? (
          <EmptyState
            title="No pictures on this roll yet"
            actions={
              <Button variant="primary" onClick={() => void addSelected()} disabled={selectedPhotos.length === 0}>
                {addLabel}
              </Button>
            }
          >
            Tick the photos you mean to develop in the Library — a folder, or a day on your Winnow — then
            add them here. The roll keeps a reference to each and its own numbers, never a copy of the file.
          </EmptyState>
        ) : (
          <ul
            className={`m-0 p-0 list-none grid ${
              compact ? 'grid-cols-3 gap-2' : 'grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3'
            }`}
          >
            {roll.pictures.map((p) => (
              <PictureTile
                key={p.id}
                picture={p}
                thumb={thumbs.get(p.id) ?? null}
                inLibrary={files.has(p.id)}
                onOpen={() => onOpenPicture(p.id)}
                onRemove={() => (p.develop || p.framing ? setConfirmRemove(p) : remove(p))}
              />
            ))}
          </ul>
        )}
      </section>

      {open && (
        <DevelopSheet
          key={open.id}
          file={openFile}
          title={open.ref.name}
          fidelity={pictureFidelity(openFile).chip}
          note={pictureFidelity(openFile).note}
          emptyText="This picture is not in the Library — open its folder, or take it from its day on your Winnow."
          stack={stack}
          value={open.develop}
          onDone={(develop) => {
            onChange(patchPicture(roll, open.id, { develop }));
            onOpenPicture(null);
          }}
          onCancel={() => onOpenPicture(null)}
          footerHint={`writes to ${open.ref.name}`}
          applyTo={applyTo}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={`Take ${confirmRemove.ref.name} off the roll?`}
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            remove(confirmRemove);
            setConfirmRemove(null);
          }}
        >
          <p>Its develop goes with it. The file stays where it is.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function PictureTile({
  picture,
  thumb,
  inLibrary,
  onOpen,
  onRemove,
}: {
  picture: RollPicture;
  thumb: Blob | null;
  inLibrary: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const url = useObjectUrl(thumb);
  const developed = picture.develop !== null || picture.framing !== null;
  return (
    <li className="group relative flex flex-col gap-1 min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="relative block w-full aspect-square p-0 border border-line rounded-paper overflow-hidden bg-frame cursor-pointer hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        title={developed ? describeDevelop(picture.develop) || 'cropped' : 'as shot — open to develop'}
        aria-label={`Develop ${picture.ref.name}`}
      >
        {url ? (
          <img src={url} alt="" className="block w-full h-full object-contain" />
        ) : (
          <span className="absolute inset-0 grid place-items-center px-2 text-center font-mono text-3xs text-muted">
            {inLibrary ? 'drawing…' : 'not in the Library'}
          </span>
        )}
        {developed && (
          <span className="absolute left-1.5 top-1.5 px-1.5 py-[1px] rounded-[6px] bg-accent text-paper font-mono text-3xs tracking-[0.06em] uppercase">
            dev
          </span>
        )}
      </button>
      <div className="flex items-center gap-1 min-w-0">
        <span className="flex-1 min-w-0 truncate font-mono text-3xs text-muted" title={picture.ref.name}>
          {picture.ref.name}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="flex-none px-1 border-0 bg-transparent font-mono text-2xs text-faint cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger max-[820px]:opacity-100"
          aria-label={`Take ${picture.ref.name} off the roll`}
          title="Take it off the roll — the file stays where it is"
        >
          ×
        </button>
      </div>
    </li>
  );
}

/**
 * The roll's name on the bar, renamed in place — the trip title's rule: an
 * emptied field gives the old name back rather than saving a blank.
 */
function RollTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) inputRef.current?.select();
    // Select on entry only, so typing replaces a name rather than appending.
  }, [editing]);

  function commit() {
    const next = (draft ?? '').trim();
    if (next && next !== name) onRename(next);
    setDraft(null);
  }

  if (draft !== null) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label="Roll name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(null);
          }
        }}
        className="w-full min-w-0 max-w-[28rem] font-serif text-2xl leading-tight px-1.5 py-0.5 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent"
      />
    );
  }
  return (
    <h1 className="m-0 min-w-0 max-w-[28rem]">
      <button
        type="button"
        onClick={() => setDraft(name)}
        title="Rename the roll"
        className="w-full p-0 border-0 bg-transparent font-serif text-2xl leading-tight text-ink text-left truncate cursor-text hover:text-accent-ink"
      >
        {name || 'Untitled roll'}
      </button>
    </h1>
  );
}
