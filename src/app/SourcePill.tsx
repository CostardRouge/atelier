/**
 * Where this browser's documents live, as one pill in the masthead: "Local"
 * with a quiet dot, or the connected instance with a green one. It is also
 * the way to `#/sources` from every tool screen — the tagline that used to
 * sit here said nothing a second visit needed.
 */

import Button from '../shared/ui/Button';
import IconButton from '../shared/ui/IconButton';
import { Icons } from '../shared/ui/icons';
import { useWinnowConnection } from '../shared/sources/winnow/use-connection';

export default function SourcePill({ iconOnly = false }: { iconOnly?: boolean }) {
  const { connection } = useWinnowConnection();
  const label = connection ? connection.id : 'Local';
  const title = connection ? `Connected to ${label} — manage sources` : 'Only this browser — connect a source';
  // The home page's masthead (2026-10-21, his ask): the same way to
  // `#/sources` as a GLYPH beside the theme and GitHub, at every width — a
  // link with the pill's dot in its corner, green once an instance is connected.
  if (iconOnly) {
    return (
      <IconButton
        size="sm"
        variant="ghost"
        label={title}
        onClick={() => {
          window.location.hash = '#/sources';
        }}
        className="relative text-muted hover:text-ink"
      >
        {Icons.link}
        <span
          className={`absolute top-1 right-1 w-[6px] h-[6px] rounded-full ${connection ? 'bg-ok' : 'bg-faint'}`}
          aria-hidden="true"
        />
      </IconButton>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        window.location.hash = '#/sources';
      }}
      title={title}
      icon={
        <span
          className={`inline-block w-[7px] h-[7px] rounded-full ${connection ? 'bg-ok' : 'bg-faint'}`}
          aria-hidden="true"
        />
      }
      className="font-sans not-italic tracking-normal text-xs text-ink-soft"
    >
      {label}
    </Button>
  );
}
