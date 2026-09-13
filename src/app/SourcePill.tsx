/**
 * Where this browser's documents live, as one pill in the masthead: "Local"
 * with a quiet dot, or the connected instance with a green one. It is also
 * the way to `#/sources` from every tool screen — the tagline that used to
 * sit here said nothing a second visit needed.
 */

import Button from '../shared/ui/Button';
import { useWinnowConnection } from '../shared/sources/winnow/use-connection';

export default function SourcePill() {
  const { connection } = useWinnowConnection();
  const label = connection ? connection.id : 'Local';
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        window.location.hash = '#/sources';
      }}
      title={connection ? `Connected to ${label} — manage sources` : 'Only this browser — connect a source'}
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
