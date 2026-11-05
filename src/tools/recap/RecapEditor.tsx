import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { navigate } from '../../app/use-hash-route';
import DevelopSheet from '../../shared/develop/DevelopSheet';
import { useLutStack } from '../../shared/lut/use-lut-stack';
import { gradeKey, type SavedGrade } from '../../shared/lut/saved-grade';
import { cleanRecapTitle, withPick, withPicture, withPictures, withRecap, withSwap, type RecapDoc, type RecapPicture } from '../../shared/recap/recap-doc';
import { clipSlideNumbers, layoutRecap, pageOfSlot } from '../../shared/recap/recap-layout';
import { filledOf, naturalLength, pageAt, planFilm } from '../../shared/recap/recap-motion';
import { PAINT_FONTS, paintRecap, type Drawable, type PaintSources } from '../../shared/recap/recap-paint';
import { isDefaultFrame, type Frame } from '../../shared/recap/recap-frame';
import { backgroundChoices, type ClipChoice } from '../../shared/recap/recap-clips';
import ClipDrawer from './ClipDrawer';
import { resolveRecap, templateDays, type DeviceAliases } from '../../shared/recap/recap-slots';
import { todayIso } from '../../shared/roadtrip/trip-days';
import type { WinnowAssetRow } from '../../shared/sources/winnow/client';
import WinnowPicker from '../../shared/sources/winnow/picker/WinnowPicker';
import type { PickerHost } from '../../shared/sources/winnow/picker/picker-host';
import { useWinnowConnection } from '../../shared/sources/winnow/use-connection';
import Button from '../../shared/ui/Button';
import PageBar from '../../shared/ui/PageBar';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { useSurface } from '../../shared/ui/use-surface';
import { AboutSection, BackgroundSection, LayoutSection, MotionSection, SlotSection, SourcesSection, type Change } from './RecapPanels';
import RecapTextPanel from './RecapTextPanel';
import { textStyleOf, type TextRole, type TextStyle } from '../../shared/recap/recap-text';
import { STORY_FONTS, type StoryFontId } from '../../shared/story/fonts';
import RecapStage, { sameSelection, type Selection } from './RecapStage';
import { fillFromWinnow } from './recap-fill';
import { pictureOfFile, pictureOfRow, printOf } from './recap-media';
import { getValue, putThumb, setValue } from './recap-store';
import { useRecapPictures } from './use-recap-pictures';
import { useRecapCommands } from './use-recap-commands';
import { useRecapClips } from './use-recap-clips';
import { useRecapSound } from './use-recap-sound';
import SoundSection from './SoundSection';
import RecapExportPanel from './RecapExportPanel';

export type SaveState = 'saved' | 'saving' | 'failed';
const SAVE_WORDS: Record<SaveState, string> = { saved: 'Saved', saving: 'Saving…', failed: 'Not saved' };

type Tab = 'pictures' | 'text' | 'layout' | 'background' | 'motion' | 'export';
const TABS: { id: Tab; label: string }[] = [
  { id: 'pictures', label: 'Pictures' },
  { id: 'text', label: 'Text' },
  { id: 'layout', label: 'Layout' },
  { id: 'background', label: 'Background' },
  { id: 'motion', label: 'Motion' },
  { id: 'export', label: 'Export' },
];

/** Which tab a selection opens: the inspector follows what was clicked on the stage. */
function tabOf(s: Selection): Tab | null {
  if (!s) return null;
  if (s.kind === 'cell') return 'pictures';
  if (s.kind === 'text') return 'text';
  return 'background';
}

const ALIASES_KEY = 'device-aliases';

/** A file input asked at the click — photos and clips, several at once. */
function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

interface Props {
  doc: RecapDoc;
  change: Change;
  saveState: SaveState;
  onBack: () => void;
  headerExtra?: ReactNode;
  syncPill?: ReactNode;
  /** The recap as the shell holds it NOW — an agent's command reads it right after a write. */
  latest?: () => RecapDoc | null;
}

/**
 * The Recap editor — Develop's layout (`docs/recap.md`): the recap on its
 * stage, the inspector's tabs beside it, and the stage driving the
 * inspector: a click on a cell opens that day's pictures, on the heading its
 * words, on the background the background. Pictures come from the connected
 * Winnow (a fill by the rule, or picked by hand) and from local files; each
 * one is developed with Develop's own sheet, under one look for the recap.
 */
export default function RecapEditor({ doc, change, saveState, onBack, headerExtra, syncPill, latest }: Props) {
  useSurface('darkroom');
  const compact = useIsCompact();
  const { connection, client } = useWinnowConnection();
  const instance = connection?.id ?? null;
  const [files, setFiles] = useState<Map<string, File>>(() => new Map());
  const [selection, setSelection] = useState<Selection>(null);
  /** What a double-click on the stage is framing — the background or a cell's picture. */
  const [framing, setFraming] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('pictures');
  const [notice, setNotice] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const [picking, setPicking] = useState(false);
  const [developing, setDeveloping] = useState<string | null>(null);
  const [guides, setGuides] = useState(true);
  const [aliases, setAliases] = useState<DeviceAliases>({});
  const stack = useLutStack();

  useEffect(() => {
    void getValue<Record<string, string>>(ALIASES_KEY).then((a) => a && setAliases(a));
    // Canvas text needs its faces loaded before the first paint (`frontend.md`).
    void Promise.all(PAINT_FONTS.map((f) => document.fonts?.load(f).catch(() => undefined))).then(() => setFontsReady(true));
  }, []);
  const [fontsReady, setFontsReady] = useState(false);


  // The recap's look lives in the document; the stack wears it (and the Develop sheet edits it there).
  const lookKey = gradeKey(doc.look ?? null);
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (developing || restored.current === lookKey) return;
    restored.current = lookKey;
    void stack.restore(doc.look?.layers ?? [], doc.look?.output ?? 'none', doc.look?.film ?? null);
    // `stack` is a fresh object per render; its restore is what matters, keyed on the look.
  }, [lookKey, developing]);

  const resolved = useMemo(() => resolveRecap(doc), [doc]);
  const today = todayIso();
  // A face being tried in the Text tab dresses the STAGE only, never the recap: nothing is saved until it is kept.
  const [textRole, setTextRole] = useState<TextRole>('heading');
  const [tried, setTried] = useState<{ role: TextRole; font: string } | null>(null);
  const view = useMemo<RecapDoc>(() => {
    if (!tried) return doc;
    const st = textStyleOf(doc.texts, tried.role);
    return { ...doc, texts: { ...doc.texts, [tried.role]: { ...st, font: (tried.font || 'auto') as TextStyle['font'] } } };
  }, [doc, tried]);
  const [facesLoaded, setFacesLoaded] = useState(0);
  const facesWanted = useMemo(() => {
    const out = new Set<string>();
    const add = (font: string, weight: number) => {
      if (font && font !== 'auto' && font in STORY_FONTS) out.add(`${weight} 40px ${STORY_FONTS[font as StoryFontId].family}`);
    };
    for (const st of Object.values(doc.texts)) if (st) add(st.font, st.weight);
    if (tried) add(tried.font, textStyleOf(doc.texts, tried.role).weight);
    return [...out].sort().join('|');
  }, [doc.texts, tried]);
  useEffect(() => {
    if (!facesWanted) return;
    let alive = true;
    void Promise.all(facesWanted.split('|').map((f) => document.fonts?.load(f).catch(() => undefined))).then(() => alive && setFacesLoaded((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [facesWanted]);
  const layout = useMemo(() => layoutRecap(view, resolved, today), [view, resolved, today]);
  const clipSlides = useMemo(() => clipSlideNumbers(doc, resolved, layout), [doc, resolved, layout]);

  const ctx = useMemo(() => ({ client, instance, files }), [client, instance, files]);
  const shownKeys = useMemo(() => {
    const keys = resolved.slots.flatMap((s) => (s.picture ? [s.picture.key] : []));
    return [...new Set(keys)];
  }, [resolved]);
  const pictures = useRecapPictures(doc, shownKeys, ctx, stack);

  // ---- the clock -------------------------------------------------------------------
  const [playing, setPlaying] = useState(false);
  const clipKeys = useMemo(() => {
    const keys = resolved.slots.flatMap((s) => (s.picture?.kind === 'video' ? [s.picture.key] : []));
    if (doc.background.kind === 'video' && doc.background.video) keys.push(doc.background.video);
    return keys;
  }, [resolved, doc.background.kind, doc.background.video]);
  const clips = useRecapClips(doc, clipKeys, ctx);
  const sound = useRecapSound(doc);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const slotKeys = useMemo(() => new Map(resolved.slots.flatMap((s) => (s.picture ? [[s.id, s.picture.key] as [string, string]] : []))), [resolved]);
  const clipLength = useCallback(
    (slot: string) => {
      const pic = resolved.slots.find((s) => s.id === slot)?.picture;
      if (!pic || pic.kind !== 'video') return null;
      return clips.lengths.get(pic.key) ?? pic.duration ?? null;
    },
    [resolved, clips.lengths],
  );
  const film = useMemo(() => planFilm(view, layout, clipLength, filledOf(resolved)), [view, layout, resolved, clipLength]);
  const natural = useMemo(() => naturalLength(doc, layout, clipLength, filledOf(resolved)), [doc, layout, resolved, clipLength]);
  const [page, setPage] = useState(0);
  const pageCount = layout.pages.length;
  const restT = (p: number) => (film.pages[p]?.allOn ?? 0) + 0.05;
  const [t, setT] = useState(() => restT(0));
  const tRef = useRef(t);
  tRef.current = t;
  const scrubbed = useRef(false);
  useEffect(() => {
    if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);
  // Paused, the stage shows the page with everything on: an edit is seen at once.
  useEffect(() => {
    if (!playing && !scrubbed.current) setT(restT(Math.min(page, pageCount - 1)));
  }, [film, page, playing, pageCount]);
  const filmRef = useRef(film);
  filmRef.current = film;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  useEffect(() => {
    if (!playing) {
      clipsRef.current.halt();
      soundRef.current.halt();
      return;
    }
    let raf = 0;
    let last = performance.now();
    // Play starts the film from its beginning, unless the author scrubbed to a moment: then from there.
    let now = scrubbed.current && tRef.current < filmRef.current.total - 0.05 ? tRef.current : 0;
    scrubbed.current = false;
    const tick = () => {
      const at = performance.now();
      now += (at - last) / 1000;
      last = at;
      if (now >= filmRef.current.total) now = 0;
      setT(now);
      setPage(pageAt(filmRef.current, now));
      clipsRef.current.drive(now, filmRef.current, slotKeys);
      soundRef.current.drive(now, filmRef.current.total);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, slotKeys]);
  const togglePlay = useCallback(() => setPlaying((p) => !p), []);
  const framingRef = useRef(framing);
  framingRef.current = framing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Escape' || e.key === 'Enter') {
        // A framing ends first; a second Escape lets go of the selection.
        if (framingRef.current) setFraming(null);
        else if (e.key === 'Escape') setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  const sources = useMemo<PaintSources>(
    () => ({ still: pictures.still, ...clips.sources }),
    // The stills' identity is the hook's; it repaints through `version`.
    [pictures.still, clips.sources, pictures.version, clips.version],
  );

  // ---- framing: what a frame moves over, and where it is written -----------------------
  const frameSource = useCallback(
    (s: Selection): Drawable | null => {
      if (s?.kind === 'background') {
        const bg = doc.background;
        // Through the PEEK: framing never seeks the stage's own element.
        if (bg.kind === 'video') return clips.peek.background?.(bg.loopIn) ?? null;
        const first = bg.kind === 'blur' ? resolved.slots.find((x) => x.picture)?.picture : undefined;
        return first ? pictures.still(first.key) : null;
      }
      if (s?.kind === 'cell') {
        const pic = resolved.slots.find((x) => x.id === s.id)?.picture;
        return pic ? pictures.still(pic.key) : null;
      }
      return null;
    },
    // The stills' identity is the hook's; a landed picture moves `version`.
    [doc.background, resolved, clips.peek, pictures.still, pictures.version, clips.version],
  );
  const setFrame = useCallback(
    (s: Selection, frame: Frame) => {
      const kept = isDefaultFrame(frame) ? undefined : frame;
      if (s?.kind === 'background') change((d) => withRecap(d, { background: { ...d.background, frame: kept } }));
      else if (s?.kind === 'cell') {
        // The frame belongs to the PICTURE: it follows it to another cell, another page, another format.
        const key = resolved.slots.find((x) => x.id === s.id)?.picture?.key;
        if (key) change((d) => withPicture(d, key, { frame: kept }));
      }
    },
    [change, resolved],
  );
  const startFraming = useCallback(
    (s: Selection) => {
      setFraming(s);
      if (s) {
        setPlaying(false);
        setSelection(s);
        setTab(s.kind === 'background' ? 'background' : 'pictures');
      }
    },
    [],
  );

  // ---- the poster: the gallery's card, drawn from the stage's own painter -------------
  const posterTimer = useRef<number | null>(null);
  useEffect(() => {
    if (posterTimer.current) window.clearTimeout(posterTimer.current);
    posterTimer.current = window.setTimeout(() => {
      const w = 432;
      const h = Math.round((layout.pages[0].height / layout.pages[0].width) * w);
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d');
      if (!g) return;
      // Through the clips' PEEK: the poster never seeks the stage's own elements (that made a paused background jump).
      paintRecap(g, w, doc, resolved, layout, film, { still: pictures.still, ...clips.peek }, { t: (film.pages[0]?.allOn ?? 0) + 1, page: 0, aliases, clipSlides });
      void c.convertToBlob({ type: 'image/jpeg', quality: 0.82 }).then((b) => putThumb(doc.id, b));
    }, 1500);
    return () => {
      if (posterTimer.current) window.clearTimeout(posterTimer.current);
    };
  }, [doc, resolved, layout, film, sources, aliases, clipSlides, pictures.version, fontsReady, facesLoaded]);

  // ---- selection and the inspector ---------------------------------------------------
  const select = useCallback((s: Selection) => {
    setSelection((cur) => (sameSelection(cur, s) && s?.kind === 'background' ? null : s));
    const to = tabOf(s);
    if (to) setTab(to);
    // A text clicked on the stage is the one the Text tab sets.
    if (s?.kind === 'text') setTextRole(s.id.startsWith('header:') ? 'weekdays' : (s.id as TextRole));
  }, []);
  const slot = selection?.kind === 'cell' ? (resolved.slots.find((s) => s.id === selection.id) ?? null) : null;
  // A slot picked from the inspector shows on its page.
  useEffect(() => {
    if (selection?.kind === 'cell' && !playing) setPage(pageOfSlot(layout, selection.id));
  }, [selection, layout, playing]);

  // ---- bringing pictures in ------------------------------------------------------------
  const fill = useCallback(async (): Promise<string> => {
    if (!client || !instance) return 'no Winnow is connected';
    setFilling(true);
    setNotice(null);
    let said: string;
    try {
      const pics = await fillFromWinnow(doc, client, instance);
      const before = doc.pictures.length;
      change((d) => withPictures(d, pics));
      const added = new Set(pics.map((p) => p.key)).size;
      said = added ? `${added.toLocaleString()} picture${added === 1 ? '' : 's'} read from ${instance}${before ? ' (the ones already here kept)' : ''} — each cell shows the best of its day.` : `${instance} holds no picture on these days.`;
    } catch (err) {
      said = err instanceof Error ? `${instance} did not answer: ${err.message}` : `${instance} did not answer.`;
    } finally {
      setFilling(false);
    }
    setNotice(said);
    return said;
  }, [client, instance, doc, change]);

  // A new recap with a Winnow at hand fills itself once: the rule knows which days to read.
  const autoFilled = useRef(false);
  useEffect(() => {
    if (autoFilled.current || !client || !instance || doc.pictures.length) return;
    autoFilled.current = true;
    void fill();
  }, [client, instance, doc.pictures.length, fill]);

  // His ask (2026-11-05): moving the recap to other days (a month, a week, a period, a step back) fills them from the
  // Winnow by itself, as a new recap does — the pictures already in the pool are kept.
  const daysKey = useMemo(() => templateDays(doc).join(','), [doc]);
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (filledFor.current === null) {
      filledFor.current = daysKey;
      return;
    }
    if (filledFor.current === daysKey) return;
    filledFor.current = daysKey;
    if (client && instance) void fill();
  }, [daysKey, client, instance, fill]);

  const addFiles = useCallback(async () => {
    const picked = await pickFiles('image/*,video/*,.heic,.heif,.dng,.jxl');
    if (!picked.length) return;
    setNotice(`Reading ${picked.length} file${picked.length === 1 ? '' : 's'}…`);
    const pics: RecapPicture[] = [];
    const next = new Map(files);
    for (const f of picked) {
      const p = await pictureOfFile(f);
      pics.push(p);
      next.set(p.key, f);
    }
    setFiles(next);
    change((d) => withPictures(d, pics));
    const undated = pics.filter((p) => !p.day).length;
    setNotice(`${pics.length} file${pics.length === 1 ? '' : 's'} added${undated ? ` · ${undated} without a date stay out of the days` : ''} — read here, never uploaded.`);
  }, [files, change]);

  useRecapCommands({
    latest: () => latest?.() ?? doc,
    change,
    resolved,
    layout,
    film,
    sources,
    aliases,
    clipSlides,
    fill,
    canFill: () => (client && instance ? true : 'no Winnow is connected — connect one on #/sources'),
  });

  const pickerHost = useMemo<PickerHost | null>(() => {
    if (!instance) return null;
    const held = new Set(doc.pictures.filter((p) => p.instance === instance).map((p) => p.asset));
    const span = doc.range ?? (resolved.slots.length ? { from: resolved.slots.find((s) => s.day)?.day ?? doc.anchor, to: [...resolved.slots].reverse().find((s) => s.day)?.day ?? doc.anchor } : null);
    return {
      title: `Add from ${instance}`,
      destination: `Recap · ${doc.title}`,
      start: { day: doc.anchor, scope: span ? 'span' : 'day', span },
      held: (row: WinnowAssetRow) => held.has(row.id),
      heldLabel: 'in this recap',
      openTicks: 'none',
      accepts: (row: WinnowAssetRow) => row.media_type === 'photo' || row.media_type === 'video',
      actions: [
        {
          key: 'add',
          label: (n: number) => (n ? `Add ${n.toLocaleString()} to the recap` : 'Add to the recap'),
          run: async (rows: WinnowAssetRow[]) => {
            const pics = rows.map((r) => pictureOfRow(r, instance));
            change((d) => {
              let next = withPictures(d, pics);
              // Picked by hand for the slot on screen: the first one lands there.
              if (selection?.kind === 'cell' && pics[0]) next = withPick(next, selection.id, pics[0].key);
              return next;
            });
            return true;
          },
        },
      ],
    };
  }, [instance, doc.pictures, doc.range, doc.anchor, doc.title, resolved.slots, change, selection]);

  const setAlias = useCallback((model: string, name: string) => {
    setAliases((a) => {
      const next = { ...a };
      if (name.trim()) next[model] = name.trim().slice(0, 40);
      else delete next[model];
      void setValue(ALIASES_KEY, next);
      return next;
    });
  }, []);

  // ---- develop ------------------------------------------------------------------------
  const developPic = developing ? doc.pictures.find((p) => p.key === developing) : null;
  const [developFile, setDevelopFile] = useState<File | null>(null);
  useEffect(() => {
    let alive = true;
    setDevelopFile(null);
    if (!developPic) return;
    const local = files.get(developPic.key);
    if (local) {
      setDevelopFile(local);
      return;
    }
    void printOf(developPic, ctx).then((b) => alive && b && setDevelopFile(new File([b], `${developPic.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })));
    return () => {
      alive = false;
    };
  }, [developing]);
  useEffect(() => {
    if (developPic) stack.setDevelop(developPic.develop ?? null);
  }, [developing]);

  const lookOf = (): SavedGrade | null => {
    const layers = stack.toSaved();
    return layers.length || stack.film ? { layers, output: stack.output, film: stack.film } : null;
  };

  // ---- the header ---------------------------------------------------------------------
  const [title, setTitle] = useState(doc.title);
  useEffect(() => setTitle(doc.title), [doc.title]);
  const commitTitle = () => {
    const clean = cleanRecapTitle(title);
    if (clean && clean !== doc.title) change((d) => withRecap(d, { title: clean }));
    else setTitle(doc.title);
  };
  const titleField = (
    <input
      aria-label="Recap title"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commitTitle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setTitle(doc.title);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`min-w-0 flex-1 px-2 rounded-control border border-transparent bg-transparent font-serif text-ink hover:border-line focus:border-line-strong focus:bg-paper focus:outline-none ${compact ? 'w-full h-7 text-lg' : 'h-9 text-2xl'}`}
    />
  );

  // ---- a Winnow clip's original, for an export that asks for it --------------------------
  const fetchOriginal = useCallback(
    async (key: string, signal: AbortSignal): Promise<Blob | null> => {
      const pic = doc.pictures.find((p) => p.key === key);
      if (!pic || pic.origin !== 'winnow' || pic.asset === undefined || !client || pic.instance !== instance) return null;
      return client.fetchFile(client.originalUrl(pic.asset), pic.name, '', 0, { signal });
    },
    [doc.pictures, client, instance],
  );
  const winnowClips = useMemo(
    () => clipKeys.some((k) => doc.pictures.find((p) => p.key === k)?.origin === 'winnow'),
    [clipKeys, doc.pictures],
  );
  const [choosingClip, setChoosingClip] = useState(false);
  const clipCount = useMemo(() => {
    const g = backgroundChoices(doc);
    return g.days.length + g.kept.length + g.elsewhere.length;
  }, [doc]);
  const bgClip = doc.background.video ? (doc.pictures.find((p) => p.key === doc.background.video) ?? null) : null;
  const chooseClip = useCallback(
    (c: ClipChoice) => {
      setChoosingClip(false);
      // A Live Photo's motion joins the pool as a loose clip, the background's only.
      change((d) => withRecap(c.added ? withPictures(d, [c.clip]) : d, { background: { ...d.background, kind: 'video', video: c.key, loopIn: 0, loopOut: null } }));
    },
    [change],
  );
  const addBackgroundClip = useCallback(async () => {
    setChoosingClip(false);
    const [f] = await pickFiles('video/*', false);
    if (!f) return;
    // Kept for the recap as its background only: never a cell's, whatever day it was shot.
    const p = { ...(await pictureOfFile(f)), loose: true };
    setFiles((m) => new Map(m).set(p.key, f));
    change((d) => withRecap(withPictures(d, [p]), { background: { ...d.background, kind: 'video', video: p.key } }));
  }, [change]);

  const panel = (which: Tab) => {
    switch (which) {
      case 'pictures':
        return (
          <>
            <AboutSection doc={doc} change={change} client={instance ? client : null} />
            <SourcesSection
              doc={doc}
              connected={instance}
              filling={filling}
              onFill={() => void fill()}
              onPick={() => setPicking(true)}
              onAddFiles={() => void addFiles()}
              missing={pictures.missing.length}
              aliases={aliases}
              change={change}
              onAlias={setAlias}
            />
            {slot ? (
              <SlotSection doc={doc} slot={slot} client={client} instance={instance} files={files} change={change} onDevelop={setDeveloping} onFrameStage={() => startFraming({ kind: 'cell', id: slot.id })} />
            ) : (
              <p className="m-0 px-1 text-xs text-muted">Click a cell on the stage to choose its picture, develop it or empty it. Drag a picture onto another cell to swap them.</p>
            )}
          </>
        );
      case 'text':
        return (
          <RecapTextPanel
            doc={doc}
            change={change}
            vars={resolved.vars}
            role={textRole}
            onRole={setTextRole}
            onPreview={(role, font) => setTried(font === null ? null : { role, font })}
          />
        );
      case 'layout':
        return <LayoutSection doc={doc} change={change} />;
      case 'background':
        return (
          <>
            <BackgroundSection
              doc={doc}
              change={change}
              clip={bgClip}
              clipLength={bgClip ? (clips.lengths.get(bgClip.key) ?? bgClip.duration ?? 0) : 0}
              clipCount={clipCount}
              onOpenClips={() => setChoosingClip(true)}
              thumbClient={instance ? client : null}
              thumbInstance={instance}
              frameSource={() => frameSource({ kind: 'background' })}
              frameVersion={pictures.version + clips.version}
              onLayout={() => setTab('layout')}
            />
            <SoundSection doc={doc} change={change} onChanged={sound.reload} />
          </>
        );
      case 'motion':
        return <MotionSection doc={doc} change={change} />;
      case 'export':
        return <RecapExportPanel ctx={{ doc, film, layout, resolved, sources, aliases, clipSlides, files, original: fetchOriginal, winnowClips }} natural={natural} change={change} />;
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;
  const transport = (
    <div className="flex-none flex flex-wrap items-center gap-2 px-2 py-1.5 border border-line rounded-control bg-surface shadow-paper-soft">
      <Button size="sm" variant={playing ? 'default' : 'primary'} icon={playing ? Icons.pause : Icons.play} onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play the recap as it will be exported (Space)'}>
        {playing ? 'Pause' : 'Play'}
      </Button>
      <input
        type="range"
        min={0}
        max={Math.max(0.1, film.total)}
        step={0.01}
        value={Math.min(t, film.total)}
        aria-label="The film's time"
        data-playhead
        onChange={(e) => {
          setPlaying(false);
          scrubbed.current = true;
          const v = Number(e.target.value);
          setPage(pageAt(film, v));
          setT(v);
        }}
        className="flex-1 min-w-[6rem] accent-[var(--color-accent)]"
      />
      <span className="font-mono text-2xs tabular-nums text-muted" role="status">
        {fmt(Math.min(t, film.total))} / {fmt(film.total)}
      </span>
      {pageCount > 1 && (
        <span className="inline-flex items-center gap-1" role="group" aria-label="Page">
          <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => ((scrubbed.current = false), setPlaying(false), setPage((p) => Math.max(0, p - 1)))} className="w-8 h-8 inline-flex items-center justify-center rounded-control border border-line disabled:opacity-40">
            {Icons.back}
          </button>
          <span className="font-mono text-2xs tabular-nums">
            {page + 1}/{pageCount}
          </span>
          <button type="button" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => ((scrubbed.current = false), setPlaying(false), setPage((p) => Math.min(pageCount - 1, p + 1)))} className="w-8 h-8 inline-flex items-center justify-center rounded-control border border-line disabled:opacity-40">
            {Icons.forward}
          </button>
        </span>
      )}
      {doc.format === 'story' && (
        <button type="button" aria-pressed={guides} onClick={() => setGuides((g) => !g)} title="Shade where a Reel's buttons and caption cover the frame" className={`h-8 px-2 rounded-control border text-2xs ${guides ? 'border-accent text-accent-ink' : 'border-line text-muted'}`}>
          Safe zones
        </button>
      )}
    </div>
  );

  const stage = (
    <RecapStage
      doc={view}
      resolved={resolved}
      layout={layout}
      film={film}
      sources={sources}
      page={Math.min(page, pageCount - 1)}
      t={t}
      version={pictures.version + clips.version + (fontsReady ? 1 : 0) + facesLoaded}
      selection={selection}
      onSelect={select}
      onSwap={(a, b) => {
        const ka = resolved.slots.find((s) => s.id === a)?.picture?.key ?? null;
        const kb = resolved.slots.find((s) => s.id === b)?.picture?.key ?? null;
        change((d) => withSwap(d, a, ka, b, kb));
      }}
      onMoveHeading={(dx, dy) => change((d) => withRecap(d, { headingOffset: { x: Math.max(-0.5, Math.min(0.5, d.headingOffset.x + dx)), y: Math.max(-0.5, Math.min(0.5, d.headingOffset.y + dy)) } }))}
      aliases={aliases}
      clipSlides={clipSlides}
      guides={guides}
      framing={framing}
      onFraming={startFraming}
      frameSource={frameSource}
      onFrame={setFrame}
    />
  );

  const status = [
    pictures.loading > 0 ? `${pictures.loading} picture${pictures.loading === 1 ? '' : 's'} on the way` : null,
    `${resolved.slots.filter((s) => s.picture).length}/${resolved.slots.length} places filled`,
    `${doc.pictures.filter((p) => !p.loose).length.toLocaleString()} in the pool`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="@container flex-1 min-h-0 flex flex-col gap-3" aria-label="Recap">
      <PageBar
        back={{ label: 'Recaps', onClick: onBack, iconOnly: compact }}
        trailing={
          <span className="inline-flex items-center gap-2">
            {syncPill}
            {headerExtra}
            <span className={`font-mono text-2xs ${saveState === 'failed' ? 'text-danger' : 'text-muted'}`} role="status" title={saveState === 'failed' ? 'The browser refused to store this recap — your edits are still on screen.' : 'Every change is kept on this device as you go.'}>
              {SAVE_WORDS[saveState]}
            </span>
          </span>
        }
      >
        {titleField}
      </PageBar>
      {notice && (
        <p className="m-0 px-1 text-xs text-ink-soft" role="status">
          {notice}
        </p>
      )}
      {!connection && !doc.pictures.length && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border border-line rounded-control bg-surface text-xs text-ink-soft">
          Add pictures from this device, or connect your Winnow and the recap fills itself from its days.
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => navigate('/sources')}>
            Connect a Winnow
          </Button>
          <Button size="sm" variant="primary" icon={Icons.import} onClick={() => void addFiles()}>
            Add files…
          </Button>
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto overflow-x-hidden @min-[860px]:overflow-visible @min-[860px]:grid @min-[860px]:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex-none min-w-0 flex flex-col gap-2 @min-[860px]:min-h-0">
          <div className="flex-none h-[calc(var(--app-h,100dvh)*0.58)] min-h-[260px] min-w-0 rounded-control bg-paper-2 p-2 @min-[860px]:h-auto @min-[860px]:flex-1">{stage}</div>
          {transport}
          <p className="m-0 px-1 font-mono text-3xs tabular-nums text-muted" role="status">
            {status}
          </p>
        </div>
        <aside className="flex-none min-w-0 flex flex-col gap-2 overflow-x-hidden @min-[860px]:min-h-0 @min-[860px]:overflow-y-auto" aria-label="Recap settings">
          <Segmented<Tab> size="sm" columns={3} label="Settings" value={tab} onChange={setTab} options={TABS.map((x) => ({ id: x.id, label: x.label }))} />
          <div className="flex flex-col gap-1 pb-4">{panel(tab)}</div>
        </aside>
      </div>

      {choosingClip && (
        <ClipDrawer doc={doc} client={instance ? client : null} instance={instance} files={files} lengths={clips.lengths} onChoose={chooseClip} onFile={() => void addBackgroundClip()} onClose={() => setChoosingClip(false)} />
      )}
      {picking && connection && client && pickerHost && <WinnowPicker connection={connection} client={client} host={pickerHost} onClose={() => setPicking(false)} />}
      {developPic && (
        <DevelopSheet
          file={developFile}
          title={developPic.name}
          emptyText="The picture is on its way…"
          stack={stack}
          value={developPic.develop ?? null}
          footerHint="writes to this picture; the look to the whole recap"
          onDone={(develop) => {
            const look = lookOf();
            const key = developPic.key;
            setDeveloping(null);
            restored.current = gradeKey(look);
            change((d) => withRecap(withPicture(d, key, { develop }), { look }));
          }}
          onCancel={() => {
            setDeveloping(null);
            restored.current = null;
          }}
        />
      )}
    </section>
  );
}
