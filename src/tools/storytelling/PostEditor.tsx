import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { BED_SAMPLE_RATE, renderBed } from '../../shared/audio/render-bed';
import { decodeSoundFile, type SoundClip } from '../../shared/audio/sound-clip';
import type { SoundEvent } from '../../shared/audio/sound-event';
import { VOICE_NAMES, type VoiceName } from '../../shared/audio/voices';
import { aacPrimingSeconds } from '../../shared/media/audio-encode';
import { encodeFrames } from '../../shared/media/render-video';
import { downloadBlob } from '../../shared/media/save';
import { H, W } from '../../shared/story/charte';
import { drawEpisode } from '../../shared/story/compose';
import { hookScore, hookSoundFor, hookSounds } from '../../shared/story/hook';
import HookPanel, { type HookFiles } from './HookPanel';
import { totalSeconds, type Episode } from '../../shared/story/episode';
import { assemble, type PostSkeleton, type StoryScript } from '../../shared/story/story-script';
import SendFinalsPanel from '../../shared/sources/winnow/SendFinalsPanel';
import SourcesPanel from './SourcesPanel';
import LookPanel from './LookPanel';
import ChartePanel from './ChartePanel';
import useHistory from '../../shared/history/use-history';
import { useTripMap } from './use-trip-map';
import { factsOf, sourcesOf } from '../../shared/story/sources';
import { useWall } from './use-wall';
import type { ComposeOptions } from '../../shared/story/compose';
import { gapsOf, withGaps } from '../../shared/story/trip-map';
import { listWinnowConnections, subscribeWinnowConnections } from '../../shared/sources/winnow/store';
import Button, { buttonClass } from '../../shared/ui/Button';
import { InspectorSection, Readout, SelectField, SliderRow, type SelectOption } from '../../shared/ui/Inspector';
import PageBar from '../../shared/ui/PageBar';
import { paintCover } from './covers';
import { POSTS } from './posts';
import ScriptControls from './ScriptControls';
import ObjectPanel from './ObjectPanel';
import StoryStage, { type StageDrag } from './StoryStage';
import StoryTransport from './StoryTransport';
import GuidesMenu, { storyGuides } from './GuidesMenu';
import { useStoryPlayback, type TimedBuffer } from './use-story-playback';
import { useEditorMode, type Pane } from './use-editor-mode';
import { useLocalPref } from '../../shared/ui/local-pref';
import { DEFAULT_GUIDES } from '../../shared/overlay/guides';
import Segmented from '../../shared/ui/Segmented';
import StudioTree, { type StudioPanel, type StudioSelection } from './StudioTree';
import StudioTimeline from './StudioTimeline';
import { styleIn, withSceneTiming, withStyle, type StyleScope } from '../../shared/story/studio-edit';
import { objectLabel, objectTracks, sceneSpans, type ObjectTrack } from '../../shared/story/studio';

export interface Sound {
  name: string;
  buffer: AudioBuffer;
  at: number;
  gain: number;
}

/**
 * A sound effect at a moment of the post: one of the suite's built-in voices
 * (`voices.ts`, synthesised), or a file of the author's own in its place.
 */
export interface Effect {
  id: number;
  at: number;
  gain: number;
  source: VoiceName | 'file';
  file: { name: string; buffer: AudioBuffer } | null;
}

export interface PostSound {
  voice: Sound | null;
  music: Sound | null;
  effects: Effect[];
  /** The hook's sounds that are files of the author's own (`HookPanel`). */
  hookFiles?: HookFiles;
}
const NO_SOUND: PostSound = { voice: null, music: null, effects: [] };

const EFFECT_SOURCES: readonly SelectOption<VoiceName | 'file'>[] = [
  { id: 'file', label: 'Your own file' },
  ...VOICE_NAMES.map((v) => ({ id: v, label: `Built-in · ${v}` })),
];

/** The effects as a score (built-in voices) and as clips (the author's files). */
function splitEffects(effects: readonly Effect[]): { score: SoundEvent[]; clips: SoundClip[] } {
  const score: SoundEvent[] = [];
  const clips: SoundClip[] = [];
  for (const e of effects) {
    if (e.source === 'file') {
      if (e.file) clips.push({ buffer: e.file.buffer, at: e.at, gain: e.gain });
    } else score.push({ at: e.at, voice: e.source, gain: e.gain });
  }
  return { score, clips };
}

/** The hook's built-in sounds — its keys, its impact, its whoosh — on the post's clock. */
const hookScoreOf = (ep: Episode): SoundEvent[] => (ep.hook ? hookScore(ep.hook) : []);

/** The hook's sounds that are the author's own files, each where its event falls. */
function hookClipsOf(ep: Episode, files: HookFiles | undefined): SoundClip[] {
  const hook = ep.hook;
  if (!hook || !files) return [];
  return hookSounds(hook).flatMap((s): SoundClip[] => {
    const file = files[s.kind];
    return hookSoundFor(hook, s.kind) === 'file' && file ? [{ buffer: file.buffer, at: s.at, gain: s.gain }] : [];
  });
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'post';

interface PostEditorProps {
  postId: string;
  script: StoryScript | null;
  onScript: (next: StoryScript | null) => void;
  fontsReady: boolean;
  /** Each post's voice, music and effects, held by the shell for the visit. */
  sounds: Record<string, PostSound>;
  setSounds: (f: (all: Record<string, PostSound>) => Record<string, PostSound>) => void;
  onOpen: (postId: string) => void;
  onBack: () => void;
}

/**
 * One post of the series, played and exported.
 *
 * Each post is code (`posts.ts`, the blocks of `shared/story/`); its words
 * are the author's private script. The stage plays the post as it will be
 * published; the voice, music and effects beside it play along and go into
 * the exported MP4, which can then be sent to a connected Winnow to archive.
 */
export default function PostEditor({ postId, script, onScript, fontsReady, sounds, setSounds, onOpen, onBack }: PostEditorProps) {
  const [soundError, setSoundError] = useState<string | null>(null);
  const effectIds = useRef(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exported, setExported] = useState<File[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const [archiveTo, setArchiveTo] = useState<string>('');
  const target = connections.find((c) => c.id === archiveTo) ?? connections[0] ?? null;

  // While an object is dragged on the stage, the post is drawn from a DRAFT of the script, written on release.
  const [draft, setDraft] = useState<StoryScript | null>(null);
  const live = draft ?? script;
  const episodeOf = useCallback((skeleton: PostSkeleton) => assemble(skeleton, live, POSTS), [live]);

  // The map follows the series' trip when it names one and this browser has
  // it (`trip-map.ts`): its road, and the towns where a stage starts or ends.
  // Otherwise the script's typed stops, as before.
  const sources = sourcesOf(script, postId);
  const tripMap = useTripMap(sources, script?.lang);
  // The wall's pictures: the ones the last counting chose, kept on this device (`wall-cache.ts`).
  const wallSource = sources.winnow?.source;
  const wall = useWall(
    wallSource,
    factsOf(script, postId)?.tiles,
    connections.find((c) => c.id === wallSource) ?? null,
  );
  const mapOpts = useMemo<ComposeOptions>(
    () => ({
      ...(tripMap.state === 'ready' && tripMap.map
        ? { stops: tripMap.map.stops, road: tripMap.map.road }
        : { stops: script?.stops }),
      wall: wall.images,
    }),
    [tripMap, script, wall.images],
  );

  const skeleton = POSTS.find((p) => p.id === postId) ?? POSTS[0];
  const mine = sounds[skeleton.id] ?? NO_SOUND;
  const { voice, music, effects } = mine;
  const patchSound = useCallback(
    (id: string, patch: (s: PostSound) => Partial<PostSound>) =>
      setSounds((all) => {
        const was = all[id] ?? NO_SOUND;
        return { ...all, [id]: { ...was, ...patch(was) } };
      }),
    [setSounds],
  );
  const setVoice = (v: Sound | null) => patchSound(skeleton.id, () => ({ voice: v }));
  const setMusic = (v: Sound | null) => patchSound(skeleton.id, () => ({ music: v }));
  const setEffects = (f: (list: Effect[]) => Effect[]) => patchSound(skeleton.id, (was) => ({ effects: f(was.effects) }));
  const at = POSTS.indexOf(skeleton);
  const prev = at > 0 ? POSTS[at - 1] : null;
  const nextSkeleton = at < POSTS.length - 1 && POSTS[at + 1].season === skeleton.season ? POSTS[at + 1] : null;

  // The next post's cover rides into this post's ending — the continuity the series lives on.
  const nextThumb = useMemo(
    () => (fontsReady && nextSkeleton ? paintCover(episodeOf(nextSkeleton), 0.5) : null),
    [fontsReady, nextSkeleton, episodeOf],
  );
  const episode = useMemo<Episode>(() => {
    const ep = episodeOf(skeleton);
    return ep.next ? { ...ep, next: { ...ep.next, thumb: nextThumb } } : ep;
  }, [episodeOf, skeleton, nextThumb]);
  const total = totalSeconds(episode);
  // The map's holes from the last counting, placed on the trip's road by date (`trip-map.ts`).
  const holes = factsOf(script, postId)?.holes;
  const shown = useMemo(
    () => withGaps(episode, tripMap.state === 'ready' && tripMap.map && holes ? gapsOf(holes, tripMap.map, tripMap.span) : null),
    [episode, tripMap, holes],
  );

  // --- the Studio: what is selected, and the objects the post draws over time ----
  const [selected, setSelected] = useState<StudioSelection | null>({ kind: 'panel', id: 'charte' });
  // Where an object's settings are written — the inspector's switch, and what a drag on the stage writes too.
  const [scope, setScope] = useState<StyleScope>('series');
  // What the inspector shows where the list (and on a phone the timeline) has no column of its own.
  const [pane, setPane] = useState<Pane>('settings');
  const select = useCallback((s: StudioSelection) => {
    setSelected(s);
    setPane('settings');
  }, []);
  // The editor's own width decides its columns (`frontend.md`: a tool splits on its container, never the viewport).
  const sectionRef = useRef<HTMLElement>(null);
  const mode = useEditorMode(sectionRef);
  const [guides, setGuides] = useLocalPref(storyGuides, DEFAULT_GUIDES);
  // Undo and redo over the script (`shared/history`): every setting of the Studio is a change to it,
  // so watching it covers them all; edits of one object within a moment are one step.
  const history = useHistory<StoryScript | null>({
    value: script,
    onRestore: (s) => onScript(s),
    label: selected?.kind === 'object' ? selected.key : (selected?.id ?? null),
    what: 'change',
  });
  const scenes = useMemo(() => sceneSpans(shown), [shown]);
  const [tracks, setTracks] = useState<ObjectTrack[]>([]);
  useEffect(() => {
    // Run the post on a context that draws nothing (`studio.ts`), once the edits settle.
    const id = window.setTimeout(() => setTracks(objectTracks(shown, { stops: mapOpts.stops, road: mapOpts.road })), 120);
    return () => window.clearTimeout(id);
  }, [shown, mapOpts.stops, mapOpts.road]);

  // --- the playhead and the sound (`use-story-playback.ts`) ---------------------
  const score = useMemo(() => [...splitEffects(effects).score, ...hookScoreOf(episode)], [effects, episode]);
  const files = useMemo<TimedBuffer[]>(
    () => [
      ...(voice ? [{ buffer: voice.buffer, at: voice.at, gain: voice.gain }] : []),
      ...(music ? [{ buffer: music.buffer, at: music.at, gain: music.gain }] : []),
      ...[...splitEffects(effects).clips, ...hookClipsOf(episode, mine.hookFiles)].map((c) => ({ buffer: c.buffer, at: c.at, gain: c.gain ?? 1 })),
    ],
    [voice, music, effects, episode, mine.hookFiles],
  );
  const clock = useStoryPlayback(total, score, files);
  const seek = useCallback(
    (at: number) => {
      clock.setPlaying(false);
      clock.seek(at);
    },
    [clock],
  );
  const pause = () => clock.setPlaying(false);

  const timing = useRef({ script, postId, onScript });
  timing.current = { script, postId, onScript };
  const onTiming = useCallback((index: number, t: { len?: number; cap?: { a: number; b: number } }) => {
    const { script: sc, postId: pid, onScript: write } = timing.current;
    if (sc) write(withSceneTiming(sc, pid, index, t));
  }, []);

  // --- the stage: a press picks, a drag moves the selected object (written on release) ---
  const dragState = useRef<{ key: string; dx: number; dy: number } | null>(null);
  const studio = useRef({ script, postId, scope, draft });
  studio.current = { script, postId, scope, draft };
  const drag = useMemo<StageDrag>(
    () => ({
      onPick: (hit) => {
        setSelected({ kind: 'object', id: hit.id, key: hit.key, slot: hit.slot });
        setPane('settings');
        const { script: sc, postId: pid, scope: sp } = studio.current;
        if (!sc) return false;
        const style = sp === 'series' ? styleIn(sc, pid, hit.key, 'series') : { ...styleIn(sc, pid, hit.key, 'series'), ...styleIn(sc, pid, hit.key, 'post') };
        dragState.current = { key: hit.key, dx: style.dx ?? 0, dy: style.dy ?? 0 };
        return true;
      },
      onMove: (mx, my) => {
        const d = dragState.current;
        const { script: sc, postId: pid, scope: sp } = studio.current;
        if (!d || !sc) return;
        setDraft(withStyle(sc, pid, d.key, { dx: Math.round(d.dx + mx) || undefined, dy: Math.round(d.dy + my) || undefined }, sp));
      },
      onEnd: (moved) => {
        const { draft: dr } = studio.current;
        if (moved && dr) onScript(dr);
        dragState.current = null;
        setDraft(null);
      },
    }),
    [onScript],
  );

  // The list's thumbnails, painted when the Continuity panel shows them.
  const showCovers = selected?.kind === 'panel' && selected.id === 'export';
  const covers = useMemo(() => {
    if (!fontsReady || !showCovers) return new Map<string, string>();
    return new Map(POSTS.map((p) => [p.id, paintCover(episodeOf(p), 0.12).toDataURL('image/png')]));
  }, [fontsReady, episodeOf, showCovers]);

  const choose = (id: string) => {
    pause();
    onOpen(id);
  };

  // --- the sound --------------------------------------------------------------
  const onSoundFile = (which: 'voice' | 'music') => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    pause();
    const buffer = await decodeSoundFile(file);
    if (!buffer) {
      setSoundError(`This browser cannot read “${file.name}”. A WAV, MP3 or M4A file usually works.`);
      return;
    }
    setSoundError(null);
    const sound: Sound = { name: file.name, buffer, at: which === 'voice' ? 0.5 : 0, gain: which === 'voice' ? 1 : 0.25 };
    if (which === 'voice') setVoice(sound);
    else setMusic(sound);
  };

  const patchEffect = (id: number, patch: Partial<Effect>) => {
    pause();
    setEffects((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const onEffectFile = (id: number) => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const buffer = await decodeSoundFile(file);
    if (!buffer) {
      setSoundError(`This browser cannot read “${file.name}”. A WAV, MP3 or M4A file usually works.`);
      return;
    }
    setSoundError(null);
    patchEffect(id, { source: 'file', file: { name: file.name, buffer } });
  };
  const addEffect = () => {
    pause();
    effectIds.current += 1;
    setEffects((list) => [...list, { id: effectIds.current, at: Math.min(clock.t, Math.max(0, total - 0.1)), gain: 0.8, source: 'file', file: null }]);
  };

  // --- the export -------------------------------------------------------------
  const exportVideo = async () => {
    pause();
    const controller = new AbortController();
    abortRef.current = controller;
    setExporting('Preparing the sound…');
    setExportNote(null);
    try {
      const clips: SoundClip[] = [];
      if (voice) clips.push({ buffer: voice.buffer, at: voice.at, gain: voice.gain });
      if (music) clips.push({ buffer: music.buffer, at: music.at, gain: music.gain, fadeIn: 0.6, fadeOut: 1.2 });
      const fx = splitEffects(effects);
      fx.score.push(...hookScoreOf(episode));
      clips.push(...fx.clips, ...hookClipsOf(episode, mine.hookFiles));
      const heard = clips.length + fx.score.length;
      const audio = heard
        ? await renderBed(fx.score, total, { leadSeconds: aacPrimingSeconds(BED_SAMPLE_RATE), clips })
        : null;
      let skipped: string | null = heard && !audio ? 'the browser did not render the sound in time' : null;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      const blob = await encodeFrames({
        width: W,
        height: H,
        seconds: total,
        fps: 30,
        audio,
        onAudioSkipped: (reason) => {
          skipped = reason;
        },
        draw: (sec) => {
          drawEpisode(ctx, shown, Math.min(sec, total - 0.001), mapOpts);
          return canvas;
        },
        onProgress: (p) => setExporting(p.ratio === null ? 'Finishing the file…' : `Encoding · ${Math.round(p.ratio * 100)} %`),
        signal: controller.signal,
      });
      const name = `${episode.number.toLowerCase().replace(/\W+/g, '')}-${slug(episode.title)}.mp4`;
      downloadBlob(blob, name);
      // Kept for the visit, so the same files can be sent to a Winnow to archive.
      const cover = await new Promise<Blob | null>((done) => paintCover(episode, 1).toBlob(done, 'image/png'));
      setExported([
        new File([blob], name, { type: 'video/mp4' }),
        ...(cover ? [new File([cover], name.replace(/\.mp4$/, '-cover.png'), { type: 'image/png' })] : []),
      ]);
      setExportNote(skipped ? `Exported without sound: ${skipped.replace(/\.$/, '')}.` : heard ? 'Exported, with its sound.' : 'Exported, silent: no voice or music was added.');
    } catch (err) {
      setExportNote(controller.signal.aborted ? 'Export cancelled.' : err instanceof Error ? err.message : 'The export failed.');
    } finally {
      abortRef.current = null;
      setExporting(null);
    }
  };
  const exportCover = () => {
    const c = paintCover(episode, 1);
    c.toBlob((blob) => blob && downloadBlob(blob, `${episode.number.toLowerCase().replace(/\W+/g, '')}-cover.png`), 'image/png');
  };


  const archiveFolder = `Storytelling/${script?.series || `Season ${skeleton.season}`}/${episode.number}`;

  // --- the Studio's inspector: one panel at a time ----------------------------
  const panelOf = (id: StudioPanel) => {
    switch (id) {
      case 'charte':
        return (
          <>
          <InspectorSection id="story-charte" title="Charte" foldable={false} info="The series' colours, faces and weights — every post is drawn in them, and an object's colour or font can name one. Kept in your script.">
            <ChartePanel script={script} onScript={onScript} />
          </InspectorSection>
          <InspectorSection id="story-look" title="Look" foldable={false} info="The series' look, the same in every post: the wall's columns, rows, gap, corners and bigger pictures, the order the days are laid in and how close the camera ends — then the grain and the vignette over everything.">
            <LookPanel postId={postId} script={script} onScript={onScript} />
          </InspectorSection>
          </>
        );
      case 'script':
        return (
          <InspectorSection id="story-script" title="Script" foldable={false} info="The words of the posts — captions, numbers, places — are yours and stay out of Atelier’s code. Load your script file; it is kept in this browser until you forget it, and nothing sends it anywhere.">
            <ScriptControls script={script} onScript={onScript} />
          </InspectorSection>
        );
      case 'sources':
        return (
          <InspectorSection id="story-sources" title="Sources" foldable={false} info="Where the series' data comes from: a trip of Trips in this browser for the route and its towns, and a connected Winnow for the counts. Named in your script; the trip and the pictures stay on this device.">
            <SourcesPanel postId={postId} script={script} onScript={onScript} wall={wall.progress} />
          </InspectorSection>
        );
      case 'hook':
        return (
          <InspectorSection id="story-hook" title="Hook" foldable={false} info="The first seconds: your words over the post's first picture, in place of its title — typed letter by letter, rising or word by word, a line landing as a sticker, each with its sound. Keep variants to test them; the one selected plays and exports.">
            <HookPanel
              postId={postId}
              script={script}
              onScript={onScript}
              title={episode.title}
              files={mine.hookFiles ?? {}}
              onFile={(kind, file) => patchSound(skeleton.id, (was) => ({ hookFiles: { ...was.hookFiles, [kind]: file ?? undefined } }))}
              onUnreadable={(name) => setSoundError(`This browser cannot read “${name}”. A WAV, MP3 or M4A file usually works.`)}
            />
          </InspectorSection>
        );
      case 'sound':
        return (
          <>
            <InspectorSection id="story-sound" title="Sound" foldable={false} info="Your voice and a music bed, read from files on this device. They play with the stage and go into the exported video; nothing is uploaded.">
            {(['voice', 'music'] as const).map((which) => {
                const s = which === 'voice' ? voice : music;
                const set = which === 'voice' ? setVoice : setMusic;
                return (
                  <div key={which} className="flex flex-col gap-2 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink-soft w-12">{which === 'voice' ? 'Voice' : 'Music'}</span>
                      <span className="flex-1 min-w-0 truncate font-mono text-2xs text-muted">{s ? s.name : 'none'}</span>
                      <label className={buttonClass('default', 'sm')}>
                        {s ? 'Change…' : 'Add…'}
                        <input type="file" accept="audio/*" className="sr-only" onChange={onSoundFile(which)} />
                      </label>
                      {s ? (
                        <Button size="sm" variant="ghost" onClick={() => set(null)}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                    {s ? (
                      <>
                        <SliderRow
                          label="Starts at"
                          value={s.at}
                          min={0}
                          max={Math.max(1, Math.floor(total))}
                          step={0.1}
                          format={(v) => `${v.toFixed(1)} s`}
                          onChange={(v) => {
                            pause();
                            set({ ...s, at: v });
                          }}
                        />
                        <SliderRow
                          label="Level"
                          value={Math.round(s.gain * 100)}
                          min={0}
                          max={150}
                          step={1}
                          format={(v) => `${v} %`}
                          onChange={(v) => set({ ...s, gain: v / 100 })}
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}
              {soundError ? <p className="m-0 text-xs text-danger">{soundError}</p> : null}
            </InspectorSection>
            <InspectorSection id="story-effects" title="Effects" info="Sound effects at moments of the post — a click, a whoosh, a pop. Each is a file of your own, or one of Atelier’s built-in synthesised sounds. Added at the playhead; they play with the stage and go into the export.">
            {effects.map((fx, i) => (
                <div key={fx.id} className="flex flex-col gap-2 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-2xs text-muted w-5">{i + 1}</span>
                    <SelectField
                      label={`Sound of effect ${i + 1}`}
                      value={fx.source}
                      options={EFFECT_SOURCES}
                      onChange={(v) => patchEffect(fx.id, { source: v })}
                    />
                    <Button size="sm" variant="ghost" onClick={() => setEffects((list) => list.filter((e) => e.id !== fx.id))}>
                      Remove
                    </Button>
                  </div>
                  {fx.source === 'file' ? (
                    <div className="flex items-center gap-2 pl-7">
                      <span className="flex-1 min-w-0 truncate font-mono text-2xs text-muted">{fx.file ? fx.file.name : 'no file yet'}</span>
                      <label className={buttonClass('default', 'sm')}>
                        {fx.file ? 'Change…' : 'Choose…'}
                        <input type="file" accept="audio/*" className="sr-only" onChange={onEffectFile(fx.id)} />
                      </label>
                    </div>
                  ) : null}
                  <SliderRow
                    label="At"
                    value={fx.at}
                    min={0}
                    max={Math.max(0.1, Math.floor(total * 10) / 10)}
                    step={0.05}
                    format={(v) => `${v.toFixed(2)} s`}
                    onChange={(v) => patchEffect(fx.id, { at: v })}
                  />
                  <SliderRow
                    label="Level"
                    value={Math.round(fx.gain * 100)}
                    min={0}
                    max={150}
                    step={1}
                    format={(v) => `${v} %`}
                    onChange={(v) => patchEffect(fx.id, { gain: v / 100 })}
                  />
                </div>
              ))}
              <div>
                <Button size="sm" onClick={addEffect}>
                  Add an effect at the playhead
                </Button>
              </div>
            </InspectorSection>
          </>
        );
      case 'export':
        return (
          <>
            <InspectorSection id="story-export" title="Export" foldable={false} info="An H.264 video at 1080 × 1920, 30 frames a second, written in this browser; and the cover as a PNG.">
            <div className="flex gap-2 flex-wrap">
                {exporting ? (
                  <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
                    Cancel
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => void exportVideo()} disabled={!fontsReady}>
                    Export video
                  </Button>
                )}
                <Button size="sm" onClick={exportCover} disabled={!fontsReady || exporting !== null}>
                  Export cover
                </Button>
              </div>
              {exporting ? <Readout>{exporting}</Readout> : exportNote ? <Readout muted>{exportNote}</Readout> : null}
            </InspectorSection>
            <InspectorSection id="story-archive" title="Archive" info="Send the exported video and its cover to a Winnow you connected — the one on this computer or your server's — where they are imported into its Incoming, filed under Storytelling. A Winnow on another site is connected with an app token on Sources.">
            {connections.length === 0 ? (
                <p className="m-0 text-xs text-muted leading-relaxed">
                  No Winnow is connected.{' '}
                  <a className="text-accent-ink font-semibold underline underline-offset-[3px]" href="#/sources">
                    Connect one
                  </a>{' '}
                  — the one on this computer, or your server&apos;s with an app token.
                </p>
              ) : exported.length === 0 ? (
                <Readout muted>Export the video first: the same files are sent from here.</Readout>
              ) : (
                <div className="flex flex-col gap-2">
                  {connections.length > 1 && target ? (
                    <SelectField
                      label="Winnow to archive on"
                      value={target.id}
                      options={connections.map((c) => ({ id: c.id, label: c.id }))}
                      onChange={setArchiveTo}
                    />
                  ) : null}
                  {target ? (
                    <SendFinalsPanel key={`${target.id}:${exported[0].name}`} files={exported} sourceId={target.id} assetId={null} archiveFolder={archiveFolder} />
                  ) : null}
                </div>
              )}
            </InspectorSection>
            <InspectorSection id="story-continuity" title="Continuity" info="Each post knows the one before and the one after. The ending names the next post and shows its cover.">
            <div className="grid grid-cols-2 gap-2">
                {[
                  ['Previous', prev],
                  ['Next', nextSkeleton],
                ].map(([label, p]) => {
                  const post = p as PostSkeleton | null;
                  return (
                    <button
                      key={label as string}
                      type="button"
                      disabled={!post}
                      onClick={() => post && choose(post.id)}
                      className="flex flex-col gap-1 items-start text-left rounded-control border border-line bg-paper p-2 cursor-pointer disabled:opacity-45 disabled:cursor-default"
                    >
                      <span className="font-mono text-3xs uppercase tracking-[0.12em] text-muted">{label as string}</span>
                      {post ? (
                        <>
                          {covers.get(post.id) ? (
                            <img src={covers.get(post.id)} alt="" className="w-full aspect-[9/16] rounded-[4px] border border-line object-cover" />
                          ) : null}
                          <span className="text-xs text-ink-soft">
                            {post.number} · {episodeOf(post).title}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted">{label === 'Next' ? 'the season ends' : 'the season opens'}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </InspectorSection>
          </>
        );
    }
  };
  const objectPanel = (sel: Extract<StudioSelection, { kind: 'object' }>) => {
    const track = tracks.find((t) => t.id === sel.id);
    const scene = scenes.find((s) => s.key === sel.slot && s.block === sel.key);
    const block = scene && scene.index !== null ? episode.blocks[scene.index] : null;
    const words = scene && scene.index !== null ? script?.posts[postId]?.blocks?.[scene.index] : undefined;
    return (
      <InspectorSection id="story-object" title="Object" foldable={false} info="Click an object on the stage, in the list or on the timeline. Its settings are kept in your script — for every post of the series, or this post alone.">
        <ObjectPanel
          script={script}
          onScript={onScript}
          postId={postId}
          objKey={sel.key}
          scope={scope}
          onScope={setScope}
          text={track?.text ?? false}
          scene={
            scene && scene.index !== null && block
              ? { index: scene.index, len: block.len, cap: block.cap ? { a: block.cap.a, b: block.cap.b } : null, set: { len: words?.len, cap: words?.cap } }
              : null
          }
        />
      </InspectorSection>
    );
  };

  const listPane = <StudioTree scenes={scenes} tracks={tracks} selected={selected} onSelect={select} onSeek={seek} />;
  const settingsPane = selected?.kind === 'object' ? objectPanel(selected) : panelOf(selected?.kind === 'panel' ? selected.id : 'charte');
  const timeline = (
    <StudioTimeline
      clock={clock}
      scenes={scenes}
      tracks={tracks}
      selected={selected}
      onSelect={select}
      onSeek={seek}
      onTiming={onTiming}
    />
  );
  // The inspector's tabs where the list (and on a phone the timeline) has no column of its own.
  const panes: { id: Pane; label: string }[] = [
    ...(mode !== 'wide' ? [{ id: 'list' as const, label: 'Objects' }] : []),
    { id: 'settings', label: selected?.kind === 'object' ? objectLabel(selected.key) : 'Settings' },
    ...(mode === 'narrow' ? [{ id: 'timeline' as const, label: 'Timeline' }] : []),
  ];
  const shownPane: Pane = panes.some((p) => p.id === pane) ? pane : 'settings';
  const panel = 'border border-line rounded-paper-lg bg-surface shadow-paper-soft';

  return (
    <section ref={sectionRef} className="@container flex-1 min-h-0 min-w-0 flex flex-col gap-3" aria-label="Storytelling post">
      <PageBar back={{ label: 'Map', onClick: onBack, title: 'Back to the map of subjects', iconOnly: mode === 'narrow' }} trailing={history.control}>
        <span className="min-w-0 flex-1 max-w-[24rem]">
          <SelectField
            label="Post"
            value={skeleton.id}
            options={POSTS.map((p) => ({ id: p.id, label: `${p.number} · ${episodeOf(p).title}` }))}
            onChange={choose}
          />
        </span>
      </PageBar>
      <div
        className={`flex-1 min-h-0 min-w-0 ${
          mode === 'wide'
            ? 'grid grid-cols-[13rem_minmax(0,1fr)_21rem] gap-3'
            : mode === 'medium'
              ? 'grid grid-cols-[minmax(0,1fr)_21rem] gap-3'
              : 'flex flex-col gap-2'
        }`}
      >
        {mode === 'wide' ? <div className={`${panel} min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain`}>{listPane}</div> : null}

        <div className={`flex flex-col gap-2 min-h-0 min-w-0 ${mode === 'narrow' ? 'flex-[1.25]' : ''}`}>
          <div className="relative flex-1 min-h-[12rem] flex rounded-paper-lg bg-frame border border-line p-2">
            <StoryStage
              clock={clock}
              episode={shown}
              opts={mapOpts}
              fontsReady={fontsReady}
              guides={guides}
              selectedId={selected?.kind === 'object' ? selected.id : null}
              drag={drag}
              label={`${episode.number} ${episode.title}`}
            />
          </div>
          <StoryTransport
            clock={clock}
            disabled={!fontsReady || exporting !== null}
            trailing={<GuidesMenu guides={guides} onGuides={setGuides} />}
          />
          {mode !== 'narrow' ? <div className={`${panel} flex-none max-h-[12.5rem] overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2`}>{timeline}</div> : null}
        </div>

        <aside aria-label="Inspector" className={`${panel} min-h-0 min-w-0 flex flex-col overflow-hidden ${mode === 'narrow' ? 'flex-1' : ''}`}>
          {panes.length > 1 ? (
            <div className="flex-none px-2 pt-2">
              <Segmented options={panes} value={shownPane} onChange={setPane} size="sm" fill label="What the inspector shows" />
            </div>
          ) : null}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-6">
            {shownPane === 'list' ? listPane : shownPane === 'timeline' ? <div className="pt-3">{timeline}</div> : settingsPane}
          </div>
        </aside>
      </div>
    </section>
  );
}
