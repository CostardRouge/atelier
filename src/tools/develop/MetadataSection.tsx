import { useEffect, useId, useState } from 'react';
import {
  DEFAULT_COPYRIGHT_TEMPLATE,
  captureYear,
  resolveRights,
  sameIdentity,
  type DeliveryIdentity,
} from '../../shared/exif/delivery-meta';
import type { ExifData } from '../../shared/exif/exif-parser';
import type { RollPicture } from '../../shared/develop/roll-types';
import { ATELIER_SOFTWARE } from '../../shared/exif/software-mark';
import { FieldRow, InspectorSection, fieldClass } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';
import Segmented from '../../shared/ui/Segmented';
import {
  META_GROUPS,
  META_PRESETS,
  keepsWholeBlock,
  presetOf,
  type MetaChoice,
  type MetaGroup,
  type MetaPresetId,
} from '../../shared/exif/meta-groups';

/**
 * What a delivered file SAYS beyond its pixels (`docs/lightroom-gaps.md` §9):
 * the signature, always, and the author's rights, from an identity kept with
 * the preset book so every device signs the same way.
 *
 * The identity is typed into a DRAFT and written on blur (or Enter): the book
 * is a synced document, and a name is not worth one write per keystroke.
 */
export default function MetadataSection({
  identity,
  onIdentity,
  openExif,
  picture = null,
  onWords,
  choice,
  onChoice,
}: {
  /** Which groups leave — the roll's (`RollExport.metadata`). */
  choice: MetaChoice;
  onChoice: (choice: MetaChoice) => void;
  identity: DeliveryIdentity;
  onIdentity: (identity: DeliveryIdentity) => void;
  /** The open picture's effective EXIF — what the preview's year is read from. */
  openExif: ExifData | null;
  /** The open picture, whose own title and caption are edited here (M2). */
  picture?: RollPicture | null;
  onWords?: (words: { title?: string; caption?: string }) => void;
}) {
  const [draft, setDraft] = useState(identity);
  // The book loads after mount, and another device may write it: follow it
  // unless the author is in the middle of typing a different one.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(identity);
  }, [identity, editing]);

  const commit = () => {
    setEditing(false);
    const next = { creator: draft.creator.trim(), copyright: draft.copyright.trim() || DEFAULT_COPYRIGHT_TEMPLATE };
    setDraft(next);
    if (!sameIdentity(next, identity)) onIdentity(next);
  };

  const year = captureYear(openExif?.dateTimeOriginal, new Date().getFullYear());
  const rights = resolveRights(draft, year);
  const creatorId = useId();
  const copyrightId = useId();
  const keyCommit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };

  return (
    <InspectorSection
      id="develop.metadata"
      title="Metadata"
      info={
        <>
          <p>
            Every file leaves <strong>signed</strong>: its EXIF <code>Software</code> and its XMP{' '}
            <code>CreatorTool</code> say <strong>{ATELIER_SOFTWARE}</strong>. That mark is also how
            Atelier recognises its own exports beside the originals, so it is not a switch.
          </p>
          <p>
            <strong>What leaves</strong> is chosen for the whole roll, in groups: <em>All</em> keeps
            everything (the GPS included), <em>Share online</em> drops the position and the serial
            numbers, <em>Minimal</em> writes your rights and the signature alone. While every group
            of the capture is kept, the camera’s EXIF is copied whole; leaving one out rebuilds it
            from the fields Atelier reads, and the maker notes stay behind.
          </p>
          <p>
            The <strong>place name</strong> is read from the picture’s own GPS against the city
            index that ships with Atelier — nothing is sent anywhere — and written as XMP{' '}
            <code>photoshop:City</code> / <code>Country</code>, even when the position itself is left
            out. A town is named only within 30 km; farther out only the country is, and the run
            says which pictures got no town.
          </p>
          <p>
            A picture’s <strong>title</strong> and <strong>caption</strong> are its own — written as
            XMP <code>dc:title</code> and <code>dc:description</code>, the caption also as EXIF{' '}
            <code>ImageDescription</code>, which Lightroom and Capture One show as the caption.
            No preset, paste or “apply to” carries them.
          </p>
          <p>
            Your <strong>name</strong> and <strong>copyright</strong> are written into every file as
            EXIF <code>Artist</code> / <code>Copyright</code> and XMP <code>dc:creator</code> /{' '}
            <code>dc:rights</code>, over whatever the camera carried. They are kept with your presets,
            so another device signs the same way. In the line, <code>{'{year}'}</code> is the year the
            picture was TAKEN and <code>{'{creator}'}</code> your name. Nothing is written until you
            give a name.
          </p>
        </>
      }
    >
      <WhatLeaves choice={choice} onChoice={onChoice} />
      <FieldRow label="Creator" htmlFor={creatorId}>
        <input
          id={creatorId}
          type="text"
          value={draft.creator}
          placeholder="Your name"
          autoComplete="name"
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft({ ...draft, creator: e.target.value })}
          onBlur={commit}
          onKeyDown={keyCommit}
          className={fieldClass}
        />
      </FieldRow>
      <FieldRow
        label="Copyright"
        htmlFor={copyrightId}
        align="start"
        hint={
          rights.copyright ? (
            <p>
              Reads <span className="font-mono text-ink-soft">{rights.copyright}</span>
              {openExif?.dateTimeOriginal ? ' on this picture' : ''}
            </p>
          ) : (
            <p>Written once a creator is set.</p>
          )
        }
      >
        <input
          id={copyrightId}
          type="text"
          value={draft.copyright}
          placeholder={DEFAULT_COPYRIGHT_TEMPLATE}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft({ ...draft, copyright: e.target.value })}
          onBlur={commit}
          onKeyDown={keyCommit}
          className={fieldClass}
        />
      </FieldRow>
      {picture && onWords && (
        <PictureWords key={picture.id} picture={picture} onWords={onWords} written={choice.words} />
      )}
    </InspectorSection>
  );
}

/**
 * The roll's choice of what leaves: three presets, and the groups one row
 * each — the whole row the target, as in the Pictures table. The signature is
 * drawn among them, ticked and locked, so its absence from the switches does
 * not read as an oversight.
 */
function WhatLeaves({ choice, onChoice }: { choice: MetaChoice; onChoice: (choice: MetaChoice) => void }) {
  const preset = presetOf(choice);
  const options: { id: MetaPresetId | 'custom'; label: string; disabled?: string }[] = META_PRESETS.map((p) => ({ id: p.id, label: p.label }));
  if (!preset) options.push({ id: 'custom', label: 'Custom', disabled: 'Pick a preset, or keep ticking groups below' });
  const toggle = (id: MetaGroup) => onChoice({ ...choice, [id]: !choice[id] });
  const whole = keepsWholeBlock(choice);
  return (
    <div className="flex flex-col gap-2">
      <FieldRow label="Leaves">
        <Segmented
          size="sm"
          label="What leaves"
          options={options}
          value={preset ?? 'custom'}
          onChange={(id) => {
            const next = META_PRESETS.find((p) => p.id === id);
            if (next) onChoice({ ...next.choice });
          }}
        />
      </FieldRow>
      <div className="flex flex-col border-t border-line">
        {META_GROUPS.map((g) => (
          <GroupRow key={g.id} label={g.label} hint={g.hint} on={choice[g.id]} onToggle={() => toggle(g.id)} />
        ))}
        <GroupRow label="Signature" hint={`${ATELIER_SOFTWARE} — always written`} on locked />
      </div>
      <p className="m-0 text-xs leading-relaxed text-muted" role="status">
        {whole
          ? 'The camera’s own EXIF travels whole, maker notes included.'
          : 'The camera’s EXIF is rebuilt from its fields: the maker notes, the serial numbers and every tag Atelier does not name stay behind.'}
      </p>
    </div>
  );
}

function GroupRow({
  label,
  hint,
  on,
  locked = false,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  locked?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-disabled={locked || undefined}
      onClick={locked ? undefined : onToggle}
      title={locked ? 'Always written — it is how Atelier knows its own exports' : undefined}
      className={`flex items-center gap-2.5 min-h-11 px-1 border-0 border-b border-line bg-transparent text-left select-none ${
        locked ? 'cursor-default' : 'cursor-pointer hover:bg-paper'
      } focus-visible:outline-2 focus-visible:outline-accent`}
    >
      <span
        aria-hidden="true"
        className={`flex-none grid place-items-center w-5 h-5 rounded-[5px] border-2 ${
          on ? (locked ? 'bg-line-strong border-line-strong text-white' : 'bg-accent border-accent text-white') : 'border-line-strong'
        }`}
      >
        {on && <span className="inline-flex text-xs">{Icons.check}</span>}
      </span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className={`text-sm leading-tight ${on ? 'text-ink' : 'text-muted'}`}>{label}</span>
        <span className="text-xs leading-snug text-faint">{hint}</span>
      </span>
    </button>
  );
}

/** The two words that are the PICTURE's, drafted and written on blur — one undo step per field left. */
function PictureWords({
  picture,
  onWords,
  written,
}: {
  picture: RollPicture;
  onWords: (words: { title?: string; caption?: string }) => void;
  /** Whether the roll writes them — *Title and caption* ticked. */
  written: boolean;
}) {
  const [title, setTitle] = useState(picture.title ?? '');
  const [caption, setCaption] = useState(picture.caption ?? '');
  const [editing, setEditing] = useState(false);
  // An undo, or another device, moves the stored words: follow them when idle.
  useEffect(() => {
    if (editing) return;
    setTitle(picture.title ?? '');
    setCaption(picture.caption ?? '');
  }, [picture.title, picture.caption, editing]);
  const titleId = useId();
  const captionId = useId();
  const commit = () => {
    setEditing(false);
    onWords({ title, caption });
  };
  return (
    <>
      <FieldRow label="Title" htmlFor={titleId}>
        <input
          id={titleId}
          type="text"
          value={title}
          maxLength={200}
          placeholder="This picture’s title"
          onFocus={() => setEditing(true)}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className={fieldClass}
        />
      </FieldRow>
      <FieldRow
        label="Caption"
        htmlFor={captionId}
        align="start"
        hint={written ? undefined : <p>Kept on the picture, not written: <em>Title and caption</em> is off for this roll.</p>}
      >
        <textarea
          id={captionId}
          value={caption}
          maxLength={2000}
          rows={3}
          placeholder="What it shows, where, who"
          onFocus={() => setEditing(true)}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={commit}
          className={`${fieldClass} h-auto py-1.5 leading-snug resize-y`}
        />
      </FieldRow>
    </>
  );
}
