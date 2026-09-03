import { useCallback, useEffect, useRef, useState } from 'react';
import { OFFLINE_MESSAGE, searchPlaces, type PlaceResult } from './geocode';
import { PLACE_SEARCH_NOTICE, usePlaceSearchPref } from './use-place-search-pref';

/**
 * A place name, with an optional lookup behind it.
 *
 * The plain text input is the feature; the search is the convenience. Typing
 * "Kalbarri" and never searching gives a complete place — that is what keeps
 * this whole feature honest with the suite's local-first line, and it is why
 * the input is never disabled, whatever the preference says.
 *
 * The search fires on ENTER or on the button, never on a keystroke: Nominatim's
 * usage policy caps callers at one request a second and a browser cannot send
 * an identifying User-Agent, so a deliberate gesture is both the polite reading
 * and the one that keeps what leaves the machine to what the author chose.
 */
export interface PlaceSearchFieldProps {
  value: string;
  onChange: (name: string) => void;
  /** Called when a candidate is chosen — the caller decides what to keep. */
  onPick: (result: PlaceResult) => void;
  placeholder?: string;
  label: string;
  className?: string;
  inputClassName?: string;
}

const noticeClass = 'm-0 text-[0.7rem] text-faint leading-snug';

export default function PlaceSearchField({
  value,
  onChange,
  onPick,
  placeholder,
  label,
  className = '',
  inputClassName = '',
}: PlaceSearchFieldProps) {
  const { enabled, setEnabled } = usePlaceSearchPref();
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // A search in flight when the field goes away would resolve into a dead
  // component and, worse, keep a request alive nobody asked for any more.
  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(async () => {
    const query = value.trim();
    if (!query) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const found = await searchPlaces(query, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found);
      if (found.length === 0) setError(`Nothing found for “${query}”.`);
    } catch (err) {
      if (controller.signal.aborted) return;
      setResults(null);
      // `searchPlaces` owns the wording — it is the half that knows whether the
      // service refused, was rate-limited, or could not be reached at all.
      setError(err instanceof Error && err.message ? err.message : OFFLINE_MESSAGE);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [value]);

  function choose(result: PlaceResult) {
    onPick(result);
    setResults(null);
    setError(null);
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (enabled) void run();
            else setAsking(true);
          }}
          placeholder={placeholder}
          aria-label={label}
          className={`flex-1 min-w-0 ${inputClassName}`}
        />
        <button
          type="button"
          onClick={() => (enabled ? void run() : setAsking(true))}
          disabled={busy || !value.trim()}
          title={enabled ? `Look “${value.trim()}” up` : 'Look this place up online'}
          aria-label={enabled ? `Look ${value.trim() || 'this place'} up` : 'Look this place up online'}
          className="flex-none w-7 h-7 inline-flex items-center justify-center border border-line-strong rounded-full bg-paper text-[0.8rem] text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-line-strong disabled:hover:text-ink-soft"
        >
          {busy ? '·' : '⌕'}
        </button>
      </div>

      {asking && !enabled && (
        <div className="flex flex-col gap-1.5 p-2 border border-line rounded-paper bg-paper">
          <p className={noticeClass}>{PLACE_SEARCH_NOTICE}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setEnabled(true);
                setAsking(false);
                void run();
              }}
              className="px-2.5 py-1 border border-ink rounded-full bg-ink text-paper text-[0.72rem] font-semibold cursor-pointer hover:bg-accent hover:border-accent"
            >
              Turn on and search
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="p-0 border-0 bg-transparent text-[0.72rem] text-muted cursor-pointer hover:text-ink"
            >
              Keep typing by hand
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="m-0 font-mono text-[0.68rem] text-[#9a3a23]" role="alert">
          {error}
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col border border-line rounded-paper bg-paper overflow-hidden">
          {results.map((result) => (
            <li key={`${result.lat},${result.lon}`} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => choose(result)}
                className="w-full flex flex-col gap-0.5 px-2.5 py-1.5 border-0 bg-transparent text-left cursor-pointer hover:bg-surface"
              >
                <span className="text-[0.8rem] text-ink">{result.name}</span>
                <span className="font-mono text-[0.64rem] text-faint">
                  {[result.region, `${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
