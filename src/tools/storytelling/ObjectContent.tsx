import type { ContentLink, ObjectContent as Content } from '../../shared/story/object-content';
import type { StoryScript } from '../../shared/story/story-script';
import { Readout, TextAreaField, TextField } from '../../shared/ui/Inspector';

const KIND_LABEL: Record<Content['kind'], string> = {
  'this post': 'this post',
  computed: 'computed',
  counted: 'counted',
  licence: 'licence',
  'no text': 'no text',
};

/**
 * The inspector's Content section (`object-content.ts`): what the selected
 * object says, where its words come from, the field to type them — or this
 * post's own over what is computed — and the way to the rest of its settings.
 */
export default function ObjectContent({
  content,
  script,
  onScript,
  onLink,
}: {
  content: Content;
  script: StoryScript;
  onScript: (s: StoryScript) => void;
  onLink: (to: ContentLink) => void;
}) {
  const f = content.field;
  return (
    <div className="flex flex-col gap-1.5">
      {content.says ? <Readout>{content.says}</Readout> : null}
      {f ? (
        f.multiline ? (
          <TextAreaField label={f.label} value={f.value} placeholder={f.placeholder} onChange={(v) => onScript(f.write(script, v))} rows={3} />
        ) : (
          <TextField label={f.label} value={f.value} placeholder={f.placeholder} onChange={(v) => onScript(f.write(script, v))} />
        )
      ) : null}
      <p className="m-0 flex items-start gap-1.5 text-2xs text-muted leading-snug">
        <span className="shrink-0 font-mono text-3xs rounded-full border border-line px-1.5 text-ink-soft">{KIND_LABEL[content.kind]}</span>
        <span>
          {f && content.kind === 'computed' ? `${f.label}: empty, it says what is computed. ` : ''}
          {content.from}
        </span>
      </p>
      {content.link ? (
        <button type="button" className="self-start text-2xs text-accent cursor-pointer hover:underline" onClick={() => onLink(content.link!.to)}>
          {content.link.label} →
        </button>
      ) : null}
    </div>
  );
}
