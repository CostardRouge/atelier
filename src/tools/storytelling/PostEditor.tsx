import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { BED_SAMPLE_RATE, renderBed } from '../../shared/audio/render-bed';
import { decodeSoundFile, type SoundClip } from '../../shared/audio/sound-clip';
import type { SoundEvent } from '../../shared/audio/sound-event';
import { scheduleVoice, VOICE_NAMES, type VoiceName } from '../../shared/audio/voices';
import { aacPrimingSeconds } from '../../shared/media/audio-encode';
import { encodeFrames } from '../../shared/media/render-video';
import { downloadBlob } from '../../shared/media/save';
import { H, W } from '../../shared/story/charte';
import { drawEpisode } from '../../shared/story/compose';
import { totalSeconds, type Episode } from '../../shared/story/episode';
import { assemble, type PostSkeleton, type StoryScript } from '../../shared/story/story-script';
import SendFinalsPanel from '../../shared/sources/winnow/SendFinalsPanel';
import SourcesPanel from './SourcesPanel';
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
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [soundError, setSoundError] = useState<string | null>(null);
  const effectIds = useRef(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exported, setExported] = useState<File[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const [archiveTo, setArchiveTo] = useState<string>('');
  const target = connections.find((c) => c.id === archiveTo) ?? connections[0] ?? null;

  const episodeOf = useCallback((skeleton: PostSkeleton) => assemble(skeleton, script, POSTS), [script]);

  // The map follows the series' trip when it names one and this browser has
  // it (`trip-map.ts`): its road, and the towns where a stage starts or ends.
  // Otherwise the script's typed stops, as before.
  const sources = sourcesOf(script, postId);
  const tripMap = useTripMap(sources);
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

  // The list's thumbnails, painted once per script.
  const covers = useMemo(() => {
    if (!fontsReady) return new Map<string, string>();
    return new Map(POSTS.map((p) => [p.id, paintCover(episodeOf(p), 0.12).toDataURL('image/png')]));
  }, [fontsReady, episodeOf]);

  // --- the stage --------------------------------------------------------------
  const stageRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = stageRef.current?.getContext('2d');
    if (!ctx || !fontsReady) return;
    drawEpisode(ctx, shown, Math.min(t, total - 0.001), mapOpts);
  }, [shown, t, total, fontsReady, mapOpts]);

  // Playback: the clock, and the sound alongside it.
  const audioRef = useRef<{ ctx: AudioContext; nodes: AudioBufferSourceNode[] } | null>(null);
  const stopSound = useCallback(() => {
    audioRef.current?.nodes.forEach((n) => {
      try {
        n.stop();
      } catch {
        // already ended
      }
    });
    if (audioRef.current) audioRef.current.nodes = [];
  }, []);
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!playing) {
      stopSound();
      return;
    }
    const from = tRef.current >= total - 0.01 ? 0 : tRef.current;
    if (typeof AudioContext !== 'undefined' && (voice || music || effects.length)) {
      const ctx = audioRef.current?.ctx ?? new AudioContext();
      audioRef.current = { ctx, nodes: [] };
      void ctx.resume();
      const { score, clips } = splitEffects(effects);
      for (const e of score) {
        if (e.at >= from) scheduleVoice(ctx, ctx.destination, ctx.currentTime + (e.at - from), e.voice, { gain: e.gain });
      }
      const files = clips.map((c, i) => ({ name: `effect ${i}`, buffer: c.buffer, at: c.at, gain: c.gain ?? 1 }));
      for (const s of [voice, music, ...files]) {
        if (!s || s.at + s.buffer.duration <= from) continue;
        const node = ctx.createBufferSource();
        node.buffer = s.buffer;
        const gain = ctx.createGain();
        gain.gain.value = s.gain;
        node.connect(gain).connect(ctx.destination);
        node.start(ctx.currentTime + Math.max(0, s.at - from), Math.max(0, from - s.at));
        audioRef.current.nodes.push(node);
      }
    }
    let raf = 0;
    const start = performance.now() - from * 1000;
    const tick = (now: number) => {
      const next = (now - start) / 1000;
      if (next >= total) {
        setT(total);
        setPlaying(false);
        return;
      }
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stopSound();
    };
  }, [playing, total, voice, music, effects, stopSound]);

  const choose = (id: string) => {
    setPlaying(false);
    onOpen(id);
  };

  // --- the sound --------------------------------------------------------------
  const onSoundFile = (which: 'voice' | 'music') => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPlaying(false);
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
    setPlaying(false);
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
    setPlaying(false);
    effectIds.current += 1;
    setEffects((list) => [...list, { id: effectIds.current, at: Math.min(t, Math.max(0, total - 0.1)), gain: 0.8, source: 'file', file: null }]);
  };

  // --- the export -------------------------------------------------------------
  const exportVideo = async () => {
    setPlaying(false);
    const controller = new AbortController();
    abortRef.current = controller;
    setExporting('Preparing the sound…');
    setExportNote(null);
    try {
      const clips: SoundClip[] = [];
      if (voice) clips.push({ buffer: voice.buffer, at: voice.at, gain: voice.gain });
      if (music) clips.push({ buffer: music.buffer, at: music.at, gain: music.gain, fadeIn: 0.6, fadeOut: 1.2 });
      const fx = splitEffects(effects);
      clips.push(...fx.clips);
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

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  const archiveFolder = `Storytelling/${script?.series || `Season ${skeleton.season}`}/${episode.number}`;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-6">
      <PageBar back={{ label: 'Map', onClick: onBack, title: 'Back to the map of subjects' }}>
        <span className="font-mono text-2xs text-muted self-center">{episode.number}</span>
        <span className="text-sm text-ink self-center truncate">{episode.title}</span>
      </PageBar>
      <div className="flex flex-wrap gap-5 items-start mt-3">
        <nav aria-label="Posts" className="w-full min-[1100px]:w-56 shrink-0 flex flex-col gap-1.5">
          <p className="m-0 mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-muted">Season 1</p>
          <div className="flex min-[1100px]:flex-col gap-1.5 overflow-x-auto pb-1">
            {POSTS.map((p) => {
              const ep = episodeOf(p);
              const on = p.id === skeleton.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choose(p.id)}
                  aria-current={on ? 'true' : undefined}
                  className={`flex items-center gap-2.5 text-left rounded-control border px-2 py-1.5 shrink-0 cursor-pointer transition-colors ${
                    on ? 'border-ink bg-surface' : 'border-line bg-paper hover:border-line-strong'
                  }`}
                >
                  {covers.get(p.id) ? (
                    <img src={covers.get(p.id)} alt="" className="w-8 h-[3.55rem] rounded-[4px] border border-line object-cover" />
                  ) : (
                    <span className="w-8 h-[3.55rem] rounded-[4px] border border-line bg-paper-2" />
                  )}
                  <span className="flex flex-col min-w-0">
                    <span className="font-mono text-2xs text-muted">{p.number}</span>
                    <span className="text-sm text-ink truncate max-w-[9.5rem]">{ep.title}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <section aria-label="Stage" className="flex flex-col items-center gap-3 shrink-0 mx-auto">
          <canvas
            ref={stageRef}
            width={W}
            height={H}
            className="block h-[min(calc(var(--app-h)*0.72),44rem)] max-w-full aspect-[9/16] rounded-paper-lg border border-line-strong bg-paper shadow-sm"
            aria-label={`${episode.number} ${episode.title}, at ${fmt(t)}`}
          />
          <div className="flex items-center gap-3 w-full max-w-[24rem]">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                if (!playing && t >= total - 0.01) setT(0);
                setPlaying((p) => !p);
              }}
              disabled={!fontsReady || exporting !== null}
            >
              {playing ? 'Pause' : 'Play'}
            </Button>
            <input
              type="range"
              data-playhead
              min={0}
              max={total}
              step={0.01}
              value={Math.min(t, total)}
              onChange={(e) => {
                setPlaying(false);
                setT(Number(e.target.value));
              }}
              aria-label="Time in the post"
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className="font-mono text-2xs text-muted tabular-nums w-[6.5rem] text-right">
              {fmt(Math.min(t, total))} / {fmt(total)}
            </span>
          </div>
        </section>

        <aside aria-label="Post settings" className="w-full min-[1100px]:w-80 shrink-0 flex flex-col">
          <InspectorSection
            id="story-script"
            title="Script"
            info="The words of the posts — captions, numbers, places — are yours and stay out of Atelier’s code. Load your script file; it is kept in this browser until you forget it, and nothing sends it anywhere."
          >
            <ScriptControls script={script} onScript={onScript} />
          </InspectorSection>

          <InspectorSection
            id="story-sources"
            title="Sources"
            info="Where the series' data comes from: a trip of Trips in this browser for the route and its towns, and a connected Winnow for the counts. Named in your script; the trip and the pictures stay on this device."
          >
            <SourcesPanel postId={postId} script={script} onScript={onScript} wall={wall.progress} />
          </InspectorSection>

          <InspectorSection
            id="story-sound"
            title="Sound"
            info="Your voice and a music bed, read from files on this device. They play with the stage and go into the exported video; nothing is uploaded."
          >
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
                          setPlaying(false);
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

          <InspectorSection
            id="story-effects"
            title="Effects"
            info="Sound effects at moments of the post — a click, a whoosh, a pop. Each is a file of your own, or one of Atelier’s built-in synthesised sounds. Added at the playhead; they play with the stage and go into the export."
          >
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
                Add an effect at {fmt(Math.min(t, total))}
              </Button>
            </div>
          </InspectorSection>

          <InspectorSection
            id="story-continuity"
            title="Continuity"
            info="Each post knows the one before and the one after. The ending names the next post and shows its cover."
          >
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

          <InspectorSection id="story-export" title="Export" info="An H.264 video at 1080 × 1920, 30 frames a second, written in this browser; and the cover as a PNG.">
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

          <InspectorSection
            id="story-archive"
            title="Archive"
            info="Send the exported video and its cover to a Winnow you connected — the one on this computer or your server's — where they are imported into its Incoming, filed under Storytelling. A Winnow on another site is connected with an app token on Sources."
          >
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
        </aside>
      </div>
    </div>
  );
}
