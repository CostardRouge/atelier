import { useState, type ChangeEvent } from 'react';
import { downloadBlob } from '../../shared/media/save';
import { parseScript, type StoryScript } from '../../shared/story/story-script';
import Button, { buttonClass } from '../../shared/ui/Button';
import { POSTS } from './posts';

/** A file name for the script, from its series. */
export function scriptFileName(script: StoryScript): string {
  const base = (script.series || 'story')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'story'}.story.json`;
}

/**
 * Load, save and forget the author's script — the private half of every post
 * (`story-script.ts`). Saving writes the file back with what changed here
 * (the map's states), for him to keep with his notes.
 */
export default function ScriptControls({
  script,
  onScript,
  compact = false,
}: {
  script: StoryScript | null;
  onScript: (next: StoryScript | null) => void;
  compact?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = parseScript(JSON.parse(await file.text()));
      if (!parsed.ok) {
        setError(parsed.reason);
        return;
      }
      setError(null);
      onScript(parsed.script);
    } catch {
      setError('This file is not readable JSON.');
    }
  };
  const save = () => {
    if (!script) return;
    downloadBlob(new Blob([JSON.stringify(script, null, 2) + '\n'], { type: 'application/json' }), scriptFileName(script));
  };
  const named = script ? Object.keys(script.posts).filter((id) => POSTS.some((p) => p.id === id)).length : 0;
  return (
    <div className="flex flex-col gap-2">
      {!compact && (
        <p className={`m-0 font-mono text-2xs ${script ? 'text-ink-soft' : 'text-muted'}`}>
          {script ? `${script.series || 'Your script'} · ${named} of ${POSTS.length} posts` : 'No script: captions show as placeholders.'}
        </p>
      )}
      {error ? <p className="m-0 text-xs text-danger">{error}</p> : null}
      <div className="flex gap-2 flex-wrap">
        <label className={buttonClass('default', 'sm')}>
          {script ? 'Load another…' : 'Load script…'}
          <input type="file" accept=".json,application/json" className="sr-only" onChange={onFile} />
        </label>
        {script ? (
          <>
            <Button size="sm" onClick={save} title="Download the script with what changed here, to keep with your notes">
              Save script
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onScript(null)}>
              Forget
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
