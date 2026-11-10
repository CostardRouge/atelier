import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { navigate } from '../../app/use-hash-route';
import DevelopSheet from '../../shared/develop/DevelopSheet';
import { useLutStack } from '../../shared/lut/use-lut-stack';
import { gradeKey, type SavedGrade } from '../../shared/lut/saved-grade';
import { cleanRecapTitle, withPick, withPicture, withPictures, withRecap, withSwap, type RecapDoc, type RecapPicture } from '../../shared/recap/recap-doc';
import { carouselSlides, clipSlideNumbers, layoutRecap, pageOfSlot, styleRoleOfText, type CarouselSlide } from '../../shared/recap/recap-layout';
import SlideStrip from './SlideStrip';
import PlacesTray from './PlacesTray';
import { CarouselSection, SheetSection, SlideSection } from './CarouselPanel';
import { filledOf, naturalLength, pageAt, planFilm } from '../../shared/recap/recap-motion';
import { defileTicks, hasOpenerSlide, openerRest, planOpener } from '../../shared/recap/recap-opener-plan';
import { inOpener } from '../../shared/recap/recap-opener-paint';
import { PAINT_FONTS, paintRecap, type Drawable, type PaintSources } from '../../shared/recap/recap-paint';
import { isDefaultFrame, type Frame } from '../../shared/recap/recap-frame';
import { backgroundChoices, type ClipChoice } from '../../shared/recap/recap-clips';
import ClipDrawer from './ClipDrawer';
import { withJoined, withSwappedFlow } from '../../shared/recap/recap-selection';
import StyleSection from './StyleSection';
import { backgroundPicture, resolveRecap, templateDays, type DeviceAliases } from '../../shared/recap/recap-slots';
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
import { isTripOpener } from '../../shared/recap/recap-opener';
import { openerTripFrom } from '../../shared/recap/recap-opener-trip';
import OpenerSection from './OpenerSection';
import RecapTextPanel from './RecapTextPanel';
import { textStyleOf, type TextRole, type TextStyle } from '../../shared/recap/recap-text';
import { STORY_FONTS, type StoryFontId } from '../../shared/story/fonts';
import RecapStage, { sameSelection, type Selection } from './RecapStage';
import { fillFromWinnow } from './recap-fill';
import { pictureOfFile, pictureOfRow, printOf } from './recap-media';
import { getClip, getValue, putThumb, setValue } from './recap-store';
import { gradedCopy, useRecapPictures } from './use-recap-pictures';
import { decodePhoto } from '../../shared/media/photo-frame';
import { useRecapCommands } from './use-recap-commands';
import { useRecapClips } from './use-recap-clips';
import { useRecapSound } from './use-recap-sound';
import { useTripOpener } from './use-trip-opener';
import SoundSection from './SoundSection';
import RecapExportPanel from './RecapExportPanel';
import { OPEN_TAB_KEY } from './PlannedSection';

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

/** Every section's title band sticks under the tabs while its section scrolls (lab 13). */
const STICKY_BANDS =
  '[&_section[data-section]>div:first-child]:sticky [&_section[data-section]>div:first-child]:top-[var(--bands-top)] [&_section[data-section]>div:first-child]:z-[2] [&_section[data-section]>div:first-child]:bg-surface';

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
  // *Send again* in the gallery's Planned opens this recap on Export › Publish (`OPEN_TAB_KEY`).
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const asked = sessionStorage.getItem(OPEN_TAB_KEY);
      if (asked === `${doc.id}:export`) {
        sessionStorage.removeItem(OPEN_TAB_KEY);
        return 'export';
      }
    } catch {
      // Storage refused: the usual first tab.
    }
    return 'pictures';
  });
  // The Export panel is mounted the first time its tab opens, then kept: a run it started stays in the foot.
  const exportSeen = useRef(false);
  if (tab === 'export') exportSeen.current = true;
  const [footEl, setFootEl] = useState<HTMLDivElement | null>(null);
  // The pinned tabs' height: on a phone the sections' titles stick just under them.
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsH, setTabsH] = useState(0);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTabsH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  // The opener leads the film (`recap-opener.ts`): planned once, read by the film plan, the stage, the strip and the exports.
  // Trips' own variants drive the copy of a trip the recap keeps, or its located pictures alone (`recap-trip-opener.ts`).
  const tripOpener = useTripOpener(view, resolved);
  // The inspector's block: what the trip drawer rises in (lab 16).
  const [asideEl, setAsideEl] = useState<HTMLElement | null>(null);
  // A recap that plays a trip opener with no copy of a trip — one made before lab 16, which read the trip of this
  // device covering its days — takes that trip's copy once, when it opens, unless he chose to use none.
  const tookTrip = useRef(false);
  useEffect(() => {
    if (tookTrip.current || !tripOpener.trips) return;
    tookTrip.current = true;
    const o = doc.opener;
    const from = tripOpener.covering;
    if (isTripOpener(o.kind) && !o.tripCopy && o.tripAuto && from) change((d) => withRecap(d, { opener: { ...d.opener, tripCopy: openerTripFrom(from), tripAuto: false } }));
  }, [tripOpener.trips, tripOpener.covering, doc.opener, change]);
  const opener = useMemo(() => planOpener(view, resolved, aliases, tripOpener.plan), [view, resolved, aliases, tripOpener.plan]);
  const openerSlide = hasOpenerSlide(doc, opener);
  const clipSlides = useMemo(() => clipSlideNumbers(doc, resolved, layout, openerSlide), [doc, resolved, layout, openerSlide]);
  const slides = useMemo(() => carouselSlides(doc, resolved, layout, openerSlide), [doc, resolved, layout, openerSlide]);

  const ctx = useMemo(() => ({ client, instance, files }), [client, instance, files]);
  const shownKeys = useMemo(() => {
    const keys = resolved.slots.flatMap((s) => (s.picture ? [s.picture.key] : []));
    // A Badge may show a picture of the pool no place shows; so may a blurred ground.
    if (opener?.kind === 'badge' && opener.key) keys.push(opener.key);
    if (doc.background.kind === 'blur') {
      const ground = backgroundPicture(doc, resolved);
      if (ground) keys.push(ground.key);
    }
    return [...new Set(keys)];
  }, [resolved, opener, doc]);
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
  const film = useMemo(() => planFilm(view, layout, clipLength, filledOf(resolved), opener), [view, layout, resolved, clipLength, opener]);
  const natural = useMemo(() => naturalLength(doc, layout, clipLength, filledOf(resolved), opener), [doc, layout, resolved, clipLength, opener]);
  // A Défilé's ticks, played live with the stage and mixed into the Reel.
  const ticks = useMemo(() => (opener?.kind === 'defile' && doc.opener.ticks ? defileTicks(opener) : []), [opener, doc.opener.ticks]);
  const ticksRef = useRef(ticks);
  ticksRef.current = ticks;
  const [page, setPage] = useState(0);
  const pageCount = layout.pages.length;
  const restT = (p: number) => (film.pages[p]?.allOn ?? 0) + 0.05;
  const [t, setT] = useState(() => restT(0));
  const tRef = useRef(t);
  tRef.current = t;
  const scrubbed = useRef(false);
  /** The stage holds the opener's last frame while it is being set (the Opener section, its slide in the strip). */
  const peekOpener = useRef(false);
  useEffect(() => {
    if (page >= pageCount) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);
  // Paused, the stage shows the page with everything on: an edit is seen at once.
  useEffect(() => {
    if (playing) return;
    // Its still (`openerRest`: the last frame, a Virée's just before its map fades), on the film's clock — a set length scales the opener.
    if (peekOpener.current && film.lead && film.opener) setT(Math.max(0, Math.min(film.lead - 0.02, (openerRest(film.opener) / film.opener.seconds) * film.lead)));
    else if (!scrubbed.current) setT(restT(Math.min(page, pageCount - 1)));
  }, [film, page, playing, pageCount]);
  useEffect(() => {
    if (playing) peekOpener.current = false;
  }, [playing]);
  // Another tab, or a click on the stage, lets go of the opener: the stage rests on its page again.
  const leaveOpener = useCallback(() => {
    if (!peekOpener.current) return;
    peekOpener.current = false;
    scrubbed.current = false;
    setT(restT(Math.min(page, pageCount - 1)));
    // `restT` reads the film of this render.
  }, [page, pageCount, film]);
  useEffect(() => {
    if (tab !== 'motion') leaveOpener();
  }, [tab, leaveOpener]);
  const peekAtOpener = useCallback(() => {
    peekOpener.current = true;
    scrubbed.current = true;
    setPlaying(false);
    setPage(0);
  }, []);
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
    soundRef.current.cue(ticksRef.current, now);
    const tick = () => {
      const at = performance.now();
      now += (at - last) / 1000;
      last = at;
      if (now >= filmRef.current.total) {
        now = 0;
        soundRef.current.cue(ticksRef.current, 0);
      }
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
  /** The film from its first second: the opener, then the recap. */
  const playOpener = useCallback(() => {
    setPlaying(false);
    window.setTimeout(() => {
      // Play starts at 0 when nothing was scrubbed.
      scrubbed.current = false;
      setPlaying(true);
    }, 0);
  }, []);
  const framingRef = useRef(framing);
  framingRef.current = framing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // A framing ends on Escape wherever the focus is — its own bar's buttons hold it while it runs.
      if (e.key === 'Escape' && framingRef.current && !(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
        setFraming(null);
        return;
      }
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
        const first = bg.kind === 'blur' ? (backgroundPicture(doc, resolved) ?? undefined) : undefined;
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
    leaveOpener();
    setSelection((cur) => (sameSelection(cur, s) && s?.kind === 'background' ? null : s));
    const to = tabOf(s);
    if (to) setTab(to);
    // A text clicked on the stage is the one the Text tab sets.
    if (s?.kind === 'text') setTextRole(styleRoleOfText(s.id));
  }, [leaveOpener]);
  const slot = selection?.kind === 'cell' ? (resolved.slots.find((s) => s.id === selection.id) ?? null) : null;
  // A slot picked from the inspector shows on its page — when the SELECTION changes, never on an edit (his report: every
  // setting changed sent the stage back to the first slide), and not when the page shown already holds it (a week's
  // slide shows the same days as the calendar).
  const pageRef = useRef(page);
  pageRef.current = page;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const selectedCell = selection?.kind === 'cell' ? selection.id : null;
  useEffect(() => {
    if (!selectedCell || playing) return;
    const shown = layoutRef.current.pages[pageRef.current];
    if (shown?.parts.some((p) => p.kind === 'cell' && p.id === selectedCell)) return;
    setPage(pageOfSlot(layoutRef.current, selectedCell));
  }, [selectedCell, playing]);

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
    // Files he chose join the carousel, each at its moment (`withJoined`).
    change((d) => withJoined(withPictures(d, pics), pics.map((p) => p.key)));
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
    winnow: () => (client && instance ? { client, instance } : null),
  });

  const pickerHost = useMemo<PickerHost | null>(() => {
    if (!instance) return null;
    const held = new Set(doc.pictures.filter((p) => p.instance === instance).map((p) => p.asset));
    const span = doc.range ?? (resolved.slots.length ? { from: resolved.slots.find((s) => s.day)?.day ?? doc.anchor, to: [...resolved.slots].reverse().find((s) => s.day)?.day ?? doc.anchor } : null);
    // A cell in hand: the picker is FOR it — opened on the recap's days as usual (another day a click away), any picture
    // may be ticked (one already in the recap, one of another day: his ask, an empty day must be fillable), and the first
    // ticked lands on it.
    const target = selection?.kind === 'cell' ? (resolved.slots.find((s) => s.id === selection.id) ?? null) : null;
    return {
      title: target ? `Choose for ${target.label}` : `Add from ${instance}`,
      destination: target ? `Recap · ${target.label}` : `Recap · ${doc.title}`,
      start: { day: target?.day ?? doc.anchor, scope: span ? 'span' : 'day', span },
      held: (row: WinnowAssetRow) => !target && held.has(row.id),
      heldLabel: 'in this recap',
      openTicks: 'none',
      accepts: (row: WinnowAssetRow) => row.media_type === 'photo' || row.media_type === 'video',
      actions: [
        {
          key: 'add',
          label: (n: number) => (target ? (n > 1 ? `Put the first on ${target.label}, add ${n - 1}` : `Put it on ${target.label}`) : n ? `Add ${n.toLocaleString()} to the recap` : 'Add to the recap'),
          run: async (rows: WinnowAssetRow[]) => {
            const pics = rows.map((r) => pictureOfRow(r, instance));
            change((d) => {
              let next = withPictures(d, pics);
              // Picked by hand for the slot on screen: the first one lands there, whatever day it was taken.
              if (target && pics[0]) next = withPick(next, target.id, pics[0].key);
              // Added by hand: they join the carousel, each at its moment, the count growing with them.
              else next = withJoined(next, pics.map((p) => p.key));
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
      if (!pic) return null;
      // A local clip IS its original: the file in hand, else the whole file kept here when it was added.
      if (pic.origin === 'local') return files.get(key) ?? (await getClip(key));
      if (pic.asset === undefined || !client || pic.instance !== instance) return null;
      return client.fetchFile(client.originalUrl(pic.asset), pic.name, '', 0, { signal });
    },
    [doc.pictures, client, instance, files],
  );
  /** A picture's original, decoded and dressed like its print (its develop, the look) — for an export that asks. */
  const stillOriginal = useCallback(
    async (key: string, signal: AbortSignal): Promise<Drawable | null> => {
      const pic = doc.pictures.find((p) => p.key === key);
      if (!pic || pic.kind !== 'photo') return null;
      const file = pic.origin === 'winnow' ? (pic.asset !== undefined && client && pic.instance === instance ? await client.fetchFile(client.originalUrl(pic.asset), pic.name, '', 0, { signal }) : null) : (files.get(key) ?? null);
      if (!file) return null;
      // At most 4096 on its long side: four times a page's width is past any zoom a cell takes.
      const bmp = await decodePhoto(file, { maxEdge: 4096 });
      const graded = gradedCopy(stack, pic, bmp);
      if (graded) {
        bmp.close();
        return graded;
      }
      return { image: bmp, width: bmp.width, height: bmp.height };
    },
    [doc.pictures, client, instance, files, stack],
  );
  const originals = useMemo(
    () => resolved.slots.some((s) => s.picture && (s.picture.origin === 'winnow' || files.has(s.picture.key))) || doc.pictures.some((p) => clipKeys.includes(p.key) && (p.origin === 'winnow' || files.has(p.key))),
    [resolved, doc.pictures, clipKeys, files],
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
            {/* A Wrapped's slides are its stats: no carousel to draw beyond them. */}
            {doc.template !== 'wrapped' && doc.template !== 'second' && (
              <CarouselSection
                doc={doc}
                resolved={resolved}
                change={change}
                thumbs={{ client: instance ? client : null, instance, files }}
                favourites={connection?.capabilities?.curation?.favourites === true || doc.pictures.some((p) => p.fav)}
              />
            )}
            {/* The template's own places, dragged to swap (a dump's and a sheet's ARE the carousel's tray). */}
            {doc.template !== 'dump' && doc.template !== 'sheets' && (
              <PlacesTray
                doc={doc}
                resolved={resolved}
                change={change}
                thumbs={{ client: instance ? client : null, instance, files }}
                selected={selection?.kind === 'cell' ? selection.id : null}
                onSelect={(id) => select({ kind: 'cell', id })}
              />
            )}
            {slot ? (
              <SlotSection
                doc={doc}
                slot={slot}
                client={client}
                instance={instance}
                files={files}
                change={change}
                onDevelop={setDeveloping}
                onFrameStage={() => startFraming({ kind: 'cell', id: slot.id })}
                onPickFor={connection && client ? () => setPicking(true) : null}
                resolved={resolved}
              />
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
        return (
          <>
            <LayoutSection doc={doc} change={change} />
            {doc.template === 'sheets' ? (
              <SheetSection doc={doc} change={change} pictures={resolved.slots.filter((s) => s.picture).length} page={Math.min(page, pageCount - 1)} />
            ) : doc.template !== 'wrapped' && doc.template !== 'second' ? (
              <SlideSection doc={doc} page={layout.pages[Math.min(page, pageCount - 1)]} change={change} />
            ) : null}
            <StyleSection doc={doc} change={change} />
          </>
        );
      case 'background':
        return (
          <>
            <BackgroundSection
              doc={doc}
              change={change}
              clip={bgClip}
              clipLength={bgClip ? (clips.lengths.get(bgClip.key) ?? bgClip.duration ?? 0) : 0}
              clipUnplayable={Boolean(bgClip && clips.missing.includes(bgClip.key))}
              clipCount={clipCount}
              onOpenClips={() => setChoosingClip(true)}
              thumbClient={instance ? client : null}
              thumbInstance={instance}
              frameSource={() => frameSource({ kind: 'background' })}
              frameVersion={pictures.version + clips.version}
              onLayout={() => setTab('layout')}
              resolved={resolved}
              files={files}
            />
            <SoundSection doc={doc} change={change} onChanged={sound.reload} />
          </>
        );
      case 'motion':
        return (
          <>
            <OpenerSection
              doc={doc}
              resolved={resolved}
              change={(fn) => {
                change(fn);
                peekAtOpener();
              }}
              plan={opener}
              trip={tripOpener}
              host={asideEl}
              client={instance ? client : null}
              instance={instance}
              files={files}
              onPlay={playOpener}
            />
            <MotionSection doc={doc} change={change} />
          </>
        );
      case 'export':
        // Drawn below, kept mounted once opened (its run lives in the foot on every tab).
        return null;
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
          peekOpener.current = false;
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
          <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => ((scrubbed.current = false), (peekOpener.current = false), setPlaying(false), setPage((p) => Math.max(0, p - 1)))} className="w-8 h-8 inline-flex items-center justify-center rounded-control border border-line disabled:opacity-40">
            {Icons.back}
          </button>
          <span className="font-mono text-2xs tabular-nums">
            {page + 1}/{pageCount}
          </span>
          <button type="button" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => ((scrubbed.current = false), (peekOpener.current = false), setPlaying(false), setPage((p) => Math.min(pageCount - 1, p + 1)))} className="w-8 h-8 inline-flex items-center justify-center rounded-control border border-line disabled:opacity-40">
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

  /** A cell's picture dropped on a slide of the strip: it takes that slide's first place, the two swapped. */
  const dropOnSlide = (slot: string, x: number, y: number) => {
    const key = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-slide-key]')?.dataset.slideKey;
    const target = key ? slides.find((s) => s.key === key) : undefined;
    if (!target || target.kind !== 'page') return;
    const first = layout.pages[target.page].parts.find((p) => p.kind === 'cell' && p.id !== slot);
    if (!first) return;
    const sa = resolved.slots.find((s) => s.id === slot);
    const sb = resolved.slots.find((s) => s.id === first.id);
    const ka = sa?.picture?.key ?? null;
    const kb = sb?.picture?.key ?? null;
    // Two carousel places trade in the selection (pins are not read once it is frozen); any other two by pins.
    if (sa?.flow && sb?.flow && ka && kb) change((d) => withSwappedFlow(d, resolved, ka, kb));
    else change((d) => withSwap(d, slot, ka, first.id, kb));
    setPage(target.page);
    select({ kind: 'cell', id: first.id });
  };

  const stage = (
    <RecapStage
      doc={view}
      resolved={resolved}
      layout={layout}
      film={film}
      sources={sources}
      page={Math.min(page, pageCount - 1)}
      t={t}
      version={pictures.version + clips.version + (fontsReady ? 1 : 0) + facesLoaded + tripOpener.version}
      selection={selection}
      onSelect={select}
      onSwap={(a, b) => {
        const sa = resolved.slots.find((s) => s.id === a);
        const sb = resolved.slots.find((s) => s.id === b);
        const ka = sa?.picture?.key ?? null;
        const kb = sb?.picture?.key ?? null;
        // Two carousel places: the two pictures trade places in the selection (which freezes); else the pins swap.
        if (sa?.flow && sb?.flow && ka && kb) change((d) => withSwappedFlow(d, resolved, ka, kb));
        else change((d) => withSwap(d, a, ka, b, kb));
      }}
      onMoveHeading={(dx, dy) => change((d) => withRecap(d, { headingOffset: { x: Math.max(-0.5, Math.min(0.5, d.headingOffset.x + dx)), y: Math.max(-0.5, Math.min(0.5, d.headingOffset.y + dy)) } }))}
      aliases={aliases}
      clipSlides={clipSlides}
      guides={guides}
      framing={framing}
      onFraming={startFraming}
      frameSource={frameSource}
      onFrame={setFrame}
      onDropOut={dropOnSlide}
      pan={playing}
    />
  );

  // ---- the strip of slides under the stage (carousel lab, A) ---------------------------
  const peekSources = useMemo<PaintSources>(
    () => ({ still: pictures.still, ...clips.peek }),
    // The stills' identity is the hook's; it repaints through `version`.
    [pictures.still, clips.peek, pictures.version, clips.version],
  );
  const showSlide = (s: CarouselSlide) => {
    scrubbed.current = false;
    peekOpener.current = false;
    setPlaying(false);
    if (s.kind === 'page') setPage(s.page);
    else if (s.kind === 'opener') {
      // The opener's slide is its last frame: the stage stops there.
      peekAtOpener();
      setT(Math.max(0, (film.lead ?? 0) - 0.02));
    } else {
      // A clip's slide is its cell's clip, whole: shown where the cell is, the cell in hand.
      setPage(pageOfSlot(layout, s.slot));
      select({ kind: 'cell', id: s.slot });
    }
  };
  const strip = (
    <SlideStrip
      doc={view}
      resolved={resolved}
      layout={layout}
      film={film}
      slides={slides}
      sources={peekSources}
      aliases={aliases}
      clipSlides={clipSlides}
      version={pictures.version + clips.version + (fontsReady ? 1 : 0) + facesLoaded}
      current={openerSlide && inOpener(film, t) ? 'opener' : (layout.pages[Math.min(page, pageCount - 1)]?.key ?? null)}
      onShow={showSlide}
      onOrder={(order) => change((d) => withRecap(d, { carousel: { ...d.carousel, order } }))}
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
          {strip}
          {transport}
          <p className="m-0 px-1 font-mono text-3xs tabular-nums text-muted" role="status">
            {status}
          </p>
        </div>
        {/* The inspector is a block of its own (lab 13, `frontend.md` «An instrument's inspector»): the tabs
            pinned at its top on one row, the sections scrolling under them with their titles sticky. On a
            phone it is the drawer under the stage: the page scrolls, the tabs stick to its top. */}
        <aside
          ref={setAsideEl}
          className="flex-none min-w-0 flex flex-col border border-line rounded-paper bg-surface [--bands-top:var(--tabs-h,0px)] @min-[860px]:relative @min-[860px]:min-h-0 @min-[860px]:[--bands-top:0px]"
          style={{ '--tabs-h': `${tabsH}px` } as CSSProperties}
          aria-label="Recap settings"
        >
          <div ref={tabsRef} className="flex-none sticky top-0 z-[3] rounded-t-paper bg-surface px-3 pt-3 pb-2 @min-[860px]:static">
            <Segmented<Tab>
              size="sm"
              fill
              label="Settings"
              value={tab}
              onChange={setTab}
              options={TABS.map((x) => ({ id: x.id, label: x.label }))}
              // Each tab as wide as its word, so the six hold one row; a screen too narrow scrolls it sideways.
              className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:flex-auto [&>button]:min-w-max [&>button]:px-1.5 [&>button]:text-2xs"
            />
          </div>
          <div
            className={`flex flex-col gap-1 px-3 pb-4 overflow-x-clip @min-[860px]:overflow-x-hidden @min-[860px]:flex-1 @min-[860px]:min-h-0 @min-[860px]:overflow-y-auto @min-[860px]:overscroll-contain ${STICKY_BANDS}`}
          >
            {panel(tab)}
            {exportSeen.current && (
              <RecapExportPanel
                ctx={{ doc, film, layout, resolved, sources, aliases, clipSlides, files, original: fetchOriginal, stillOriginal, originals }}
                natural={natural}
                change={change}
                visible={tab === 'export'}
                foot={footEl}
              />
            )}
          </div>
          {/* The foot: what the Export tab TRIGGERS, pinned at the inspector's bottom (a run keeps it on every tab). */}
          <div ref={setFootEl} className="flex-none sticky bottom-0 z-[3] px-3 pb-3 empty:hidden @min-[860px]:static" />
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
