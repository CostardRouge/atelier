import { useState, type ChangeEvent } from 'react';
import { downloadBlob } from '../../shared/media/save';
import { parseScript, type StoryScript } from '../../shared/story/story-script';
import Button, { buttonClass } from '../../shared/ui/Button';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import type { Lang } from '../../shared/story/locale';
import { SelectField } from '../../shared/ui/Inspector';
import { POSTS } from './posts';
import { clearWall } from './wall-cache';

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

/** Read a script file: the script, or why it cannot be one. */
export async function readScriptFile(file: File): Promise<{ ok: true; script: StoryScript } | { ok: false; reason: string }> {
  try {
    const parsed = parseScript(JSON.parse(await file.text()));
    return parsed.ok ? { ok: true, script: parsed.script } : { ok: false, reason: parsed.reason };
  } catch {
    return { ok: false, reason: 'This file is not readable JSON.' };
  }
}

/** Download the script with what changed here, to keep with the author's notes. */
export function saveScriptFile(script: StoryScript): void {
  downloadBlob(new Blob([JSON.stringify(script, null, 2) + '\n'], { type: 'application/json' }), scriptFileName(script));
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
  verbs = true,
}: {
  script: StoryScript | null;
  onScript: (next: StoryScript | null) => void;
  compact?: boolean;
  /** False where Load and Save are the shell's bottom bar (a phone's gallery): Forget stays here. */
  verbs?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const read = await readScriptFile(file);
    setError(read.ok ? null : read.reason);
    if (read.ok) onScript(read.script);
  };
  const save = () => {
    if (script) saveScriptFile(script);
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
        {verbs ? (
          <label className={buttonClass('default', 'sm')}>
            {script ? 'Load another…' : 'Load script…'}
            <input type="file" accept=".json,application/json" className="sr-only" onChange={onFile} />
          </label>
        ) : null}
        {script ? (
          <>
            {verbs ? (
              <Button size="sm" onClick={save} title="Download the script with what changed here, to keep with your notes">
                Save script
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setForgetting(true)}>
              Forget
            </Button>
          </>
        ) : null}
      </div>
      {forgetting && script ? (
        // The suite asks before anything is lost for good (`ConfirmDialog`): this browser's copy of the
        // script holds what changed here (the Studio's settings, the map's states) and the wall's pictures.
        <ConfirmDialog
          title={`Forget “${script.series || 'your script'}” on this device?`}
          confirmLabel="Forget"
          danger
          onCancel={() => setForgetting(false)}
          onConfirm={() => {
            setForgetting(false);
            void clearWall();
            onScript(null);
          }}
        >
          <p className="m-0">
            What changed here since you loaded it — the Studio&apos;s settings, the map&apos;s states — and the wall&apos;s pictures
            go with it. Save script first to keep them; your own file is not touched.
          </p>
        </ConfirmDialog>
      ) : null}
      {script && !compact ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-soft w-16">Language</span>
          <SelectField<Lang>
            label="The language the series is told in"
            value={script.lang ?? 'fr'}
            options={[
              { id: 'en', label: 'English — 98,412 · Sep 3' },
              { id: 'fr', label: 'Français — 98 412 · 03 sept.' },
            ]}
            onChange={(lang) => onScript({ ...script, lang })}
          />
        </div>
      ) : null}
    </div>
  );
}
