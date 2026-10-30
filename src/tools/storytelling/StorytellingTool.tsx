import '@fontsource/geist/300.css';
import '@fontsource/geist/400.css';
import '@fontsource/geist/600.css';
import { useCallback, useEffect, useState } from 'react';
import { isWithinRoute, navigate, useHashRoute } from '../../app/use-hash-route';
import type { StoryScript } from '../../shared/story/story-script';
import PostEditor, { type PostSound } from './PostEditor';
import { POSTS } from './posts';
import { loadStoredScript, storeScript } from './script-store';
import StoryGallery from './StoryGallery';

/** The faces the posts draw with, loaded before the first frame is painted. */
const FACES = ['300 40px Geist', '400 40px Geist', '600 40px Geist', '400 40px "JetBrains Mono"'];

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

  const onScript = useCallback((next: StoryScript | null) => {
    setScriptState(next);
    storeScript(next);
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all(FACES.map((f) => document.fonts.load(f)))
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

  return skeleton ? (
    <PostEditor
      key={skeleton.id}
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
}
