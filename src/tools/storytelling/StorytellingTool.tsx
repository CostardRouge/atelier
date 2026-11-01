import '@fontsource/geist/300.css';
import '@fontsource/geist/400.css';
import '@fontsource/geist/600.css';
// The Studio's other faces (`shared/story/fonts.ts`): from our own origin, like every font of the suite.
// Space Grotesk, Instrument Serif, Montserrat, VT323 and JetBrains Mono are the shell's already (`main.tsx`).
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/fraunces/900.css';
import '@fontsource/caveat/600.css';
import '@fontsource/zilla-slab/600.css';
import '@fontsource/zilla-slab/700.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource/special-elite/400.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import { assemble, type StoryScript } from '../../shared/story/story-script';
import { useRegisterCommands } from '../../shared/commands/use-commands';
import { STORY_FONTS } from '../../shared/story/fonts';
import PostEditor, { type PostSound } from './PostEditor';
import { POSTS } from './posts';
import { useDocumentLock, useInertRef } from '../../shared/sources/use-document-lock';
import { discardPendingScript, flushScript, loadStoredScript, onScriptStored, storeScriptSoon } from './script-store';
import StoryGallery from './StoryGallery';

/**
 * The faces the posts may draw with (`STORY_FONTS`), every weight shipped,
 * loaded before the first frame is painted: a canvas draws a face still
 * loading in its fallback and never redraws, and an export must not.
 */
const FACES = Object.values(STORY_FONTS).flatMap((f) => f.weights.map((w) => `${'italic' in f && f.italic ? 'italic ' : ''}${w} 40px ${f.family}`));
// The hook's badge paints in Trips' title styles (`hook-badge.ts`): their faces are awaited with the series'.
const BADGE_FACES = ['400 40px "Instrument Serif"', '400 40px VT323', '600 40px "Space Grotesk"', '700 40px "Space Grotesk"', '400 40px "JetBrains Mono"'];

const BASE = '/storytelling';

/**
 * Storytelling — the narrated series. `/storytelling` is the map of subjects
 * (`StoryGallery`), `/storytelling/<post>` one post on its stage
 * (`PostEditor`). The shell holds what both read: the author's script, kept
 * on this device, and each post's sound for the visit.
 */
export default function StorytellingTool() {
  const path = useHashRoute();
  const [script, setScriptState] = useState<StoryScript | null>(() => loadStoredScript());
  const [fontsReady, setFontsReady] = useState(false);
  const [sounds, setSounds] = useState<Record<string, PostSound>>({});

  // One editor of the script across this browser's tabs (`use-document-lock.tsx`, as a trip, a project or a
  // roll): another tab shows it read only, refreshed when this one writes, with *Edit here*. A reload is not an
  // edit: the post's editor is mounted again (`generation`), so its history starts from the copy shown.
  const [generation, setGeneration] = useState(0);
  const lock = useDocumentLock<StoryScript>({
    kind: 'script',
    id: script ? 'script' : null,
    flush: async () => flushScript(),
    discard: discardPendingScript,
    load: async () => loadStoredScript(),
    onReload: (doc) => {
      setScriptState(doc);
      setGeneration((g) => g + 1);
    },
  });
  const lockRef = useRef(lock);
  lockRef.current = lock;
  const editorRef = useInertRef<HTMLDivElement>(lock.readOnly);

  const onScript = useCallback((next: StoryScript | null) => {
    // A read-only tab writes nothing (its editor is inert; this is the one write path, guarded anyway).
    if (!lockRef.current.canWrite()) return;
    setScriptState(next);
    // Loading or forgetting a script is written at once; an edit, once the edits pause (`script-store.ts`).
    storeScriptSoon(next);
  }, []);
  useEffect(() => () => flushScript(), []);

  // Whether the browser keeps the script: when it refuses (storage full or blocked), say so — the work lives in
  // this tab only, and Save script is how to keep it (Studio's « Storage unavailable »). A kept write tells the
  // read-only tabs to show it.
  const [unstored, setUnstored] = useState(false);
  useEffect(
    () =>
      onScriptStored((ok) => {
        setUnstored(!ok);
        if (ok) lockRef.current.saved({ id: 'script', updatedAt: Date.now() });
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    void Promise.all([...FACES, ...BADGE_FACES].map((f) => document.fonts.load(f)))
      .catch(() => undefined)
      .then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const mine = isWithinRoute(path, BASE);
  const postId = path.startsWith(`${BASE}/`) ? decodeURIComponent(path.slice(BASE.length + 1)) : null;
  const skeleton = postId ? POSTS.find((p) => p.id === postId) ?? null : null;
  useEffect(() => {
    // A post this build does not know sends the reader back to the map.
    if (mine && postId && !skeleton) navigate(BASE, { replace: true });
  }, [mine, postId, skeleton]);

  const open = useCallback((id: string) => navigate(`${BASE}/${encodeURIComponent(id)}`), []);

  // The series for an agent (`agent-commands.md`): its posts, and opening one — the post's own commands
  // (`story.post`, `story.setStyle`, `story.snapshot`…) are registered by its editor once it is open.
  const posts = useRef(script);
  posts.current = script;
  useRegisterCommands('storytelling', [
    {
      id: 'story.posts',
      title: 'List the series’ posts',
      description: 'Every post of the Storytelling series: its id, number, title (from the script when one is loaded), and which one is open.',
      run: () => ({
        scriptLoaded: !!posts.current,
        series: posts.current?.series ?? null,
        open: postId,
        posts: POSTS.map((p) => ({ id: p.id, number: p.number, title: assemble(p, posts.current, POSTS).title })),
      }),
    },
    {
      id: 'story.openPost',
      title: 'Open a post',
      description: 'Open a post of the series in its editor, by its id (story.posts); then app.waitFor story.post.',
      params: { id: { type: 'string', description: 'The post’s id, e.g. ep01.', enum: POSTS.map((p) => p.id) } },
      run: (p) => {
        open(p.id as string);
        return { opening: p.id };
      },
    },
  ]);

  const view = skeleton ? (
    <PostEditor
      key={`${skeleton.id}:${generation}`}
      postId={skeleton.id}
      script={script}
      onScript={onScript}
      fontsReady={fontsReady}
      sounds={sounds}
      setSounds={setSounds}
      onOpen={open}
      onBack={() => navigate(BASE)}
    />
  ) : (
    <StoryGallery script={script} onScript={onScript} fontsReady={fontsReady} onOpen={open} />
  );
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-3">
      {lock.band}
      {unstored ? (
        <p role="alert" className="m-0 rounded-paper border border-danger/40 bg-paper-2 px-3 py-2 text-xs text-danger leading-snug">
          This browser refused to keep the script (its storage is full or blocked): what you change lives in this tab
          only. Save script to keep it.
        </p>
      ) : null}
      {/* Inert while another tab edits the script: nothing here can write it. */}
      <div ref={editorRef} className="contents">
        {view}
      </div>
    </div>
  );
}
