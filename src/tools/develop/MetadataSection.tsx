import { useEffect, useId, useState } from 'react';
import {
  DEFAULT_COPYRIGHT_TEMPLATE,
  captureYear,
  resolveRights,
  sameIdentity,
  type DeliveryIdentity,
} from '../../shared/exif/delivery-meta';
import type { ExifData } from '../../shared/exif/exif-parser';
import { ATELIER_SOFTWARE } from '../../shared/exif/software-mark';
import { FieldRow, InspectorSection, fieldClass } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';

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
}: {
  identity: DeliveryIdentity;
  onIdentity: (identity: DeliveryIdentity) => void;
  /** The open picture's effective EXIF — what the preview's year is read from. */
  openExif: ExifData | null;
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
      <FieldRow label="Signature" hint="written into every file — it is how Atelier knows its own exports">
        <span className="inline-flex items-center gap-1.5 font-mono text-sm text-ink">
          <span className="inline-flex text-xs text-accent-ink" aria-hidden="true">
            {Icons.check}
          </span>
          {ATELIER_SOFTWARE}
        </span>
      </FieldRow>
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
    </InspectorSection>
  );
}
