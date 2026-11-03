import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ValueCount, WinnowClient, WinnowFacets, WinnowPerson } from '../client';
import { namesOfKind } from '../winnow-names';
import Segmented from '../../../ui/Segmented';
import { ToggleField } from '../../../ui/Inspector';
import { Icons } from '../../../ui/icons';
import { PLACE_KINDS, RANKED, toggled, type PickFacets, type PlaceKind, type WordsIn } from './pick-filter';

/** What the rail knows of the instance's subjects: its people and its place names, or null while asked / unknown. */
export interface SubjectLists {
  people: WinnowPerson[] | null;
  names: WinnowFacets | null;
}

/**
 * Where a DESCRIPTION's ranking stands (`WinnowPicker`): nothing asked, asked, ranked, refused by an instance with no
 * index, or an index with nothing in it yet.
 */
export interface DescribeState {
  text: string;
  state: 'idle' | 'asking' | 'ready' | 'off' | 'empty';
  /** How many of the library's closest matches came back. */
  ranked: number;
  indexed: number | null;
  library: number | null;
  reason: string | null;
  /** The index's model reads English only (`readsEnglishOnly`): «dog», not «chien». */
  englishOnly: boolean;
  /** People are ticked, and cannot narrow a description. */
  peopleAside: boolean;
  /** What the description sets aside: the day, the span or the folder open. */
  scopeWord: string;
}

const WORDS_IN: { id: WordsIn; label: string; title: string }[] = [
  { id: 'describe', label: 'Describe', title: 'What is in the picture — a dog, a parrot, a sunset over the sea — the closest in the whole library by the image index Winnow keeps, whatever day is open' },
  { id: 'text', label: 'In text', title: 'Words in the file’s path or in the text Winnow read in the picture — every word, as a part of a word' },
];

const legend = 'm-0 mb-1 font-mono text-3xs tracking-[0.12em] uppercase text-muted';
/** Past this many entries a list gets a search field and shows the busiest. */
const LONG = 8;
const SHOWN = 10;

const PLACE_LABEL: Record<PlaceKind, string> = { country: 'Country', region: 'Region', city: 'City', place: 'Place' };

/** A name as it is searched: case and accents aside. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The SUBJECT (2026-11-02, his ask): who is in the frame, which words, where
 * — Winnow's own people, its OCR and path search, its place names — each a
 * narrowing the instance applies to every scope, so a mosaic of one person,
 * a roll of one town or a wall of one word is one tick away. The counts are
 * the LIBRARY's (Winnow's lists), never the scope's: they say how much the
 * instance holds of each, not what this day would keep.
 */
export default function PickerSubject({
  client,
  lists,
  facets,
  onFacets,
  describe,
}: {
  client: WinnowClient;
  lists: SubjectLists;
  facets: PickFacets;
  onFacets: (next: PickFacets) => void;
  describe: DescribeState;
}) {
  const set = (patch: Partial<PickFacets>) => onFacets({ ...facets, ...patch });
  const [kind, setKind] = useState<PlaceKind>(() => PLACE_KINDS.find((k) => facets.places[k]?.length) ?? 'city');
  const people = useMemo(() => (lists.people ?? []).filter((p) => !p.hidden), [lists.people]);
  const names = useMemo(() => (lists.names ? namesOfKind(lists.names, kind) : []), [lists.names, kind]);
  const placesTicked = facets.places[kind] ?? [];
  // A kind with a tick but no name of its own (the facets not read, or a name gone) still lists the tick, so it can go.
  const placeRows = useMemo<ValueCount[]>(() => {
    const have = new Set(names.map((n) => String(n.value)));
    return [...names, ...placesTicked.filter((v) => !have.has(v)).map((v) => ({ value: v, count: 0 }))];
  }, [names, placesTicked]);

  return (
    <section className="flex flex-col gap-3">
      <p className={`${legend} mb-0`}>Subject</p>

      {/* --- who --- */}
      {lists.people !== null && people.length > 0 && (
        <div>
          <p className={legend}>People</p>
          <Listed
            search="Find a person"
            entries={people.map((p) => ({ key: String(p.id), label: p.name ?? `Unnamed · ${p.face_count} faces`, count: p.asset_count, text: p.name ?? '' }))}
            ticked={facets.people.map(String)}
            onToggle={(key) => set({ people: toggled(facets.people, Number(key)) })}
            lead={(key) => <Face client={client} person={people.find((p) => String(p.id) === key)} />}
          />
          {facets.people.length > 1 && (
            <div className="mt-1 px-1.5">
              <ToggleField label="All of them in the frame" checked={facets.together} onChange={(together) => set({ together })}>
                <span className="text-xs text-ink-soft">All of them in the frame</span>
              </ToggleField>
            </div>
          )}
        </div>
      )}

      {/* --- which words: a description for the image index (the default), or the text Winnow holds --- */}
      <div>
        <p className={legend}>Words</p>
        <Segmented<WordsIn>
          label="Where the words look"
          size="sm"
          fill
          value={facets.wordsIn}
          onChange={(wordsIn) => set({ wordsIn })}
          options={WORDS_IN}
          className="mb-1"
        />
        <WordsField value={facets.words} onChange={(words) => set({ words })} way={facets.wordsIn} />
        {describe.state !== 'idle' && (
          <p className="m-0 mt-1 px-1.5 font-mono text-3xs text-muted" role="status">
            {describe.state === 'asking'
              ? 'Asking the image index…'
              : describe.state === 'off'
                ? `Winnow cannot rank by a description: ${describe.reason ?? 'no image index'}`
                : describe.state === 'empty'
                  ? 'Nothing indexed for search yet'
                  : `The library’s ${describe.ranked >= RANKED ? `${RANKED} ` : ''}closest, any day — the ${describe.scopeWord} is set aside${
                      describe.indexed !== null && describe.library !== null && describe.indexed < describe.library ? ` · ${describe.indexed} of ${describe.library} indexed` : ''
                    }`}
          </p>
        )}
        {describe.state !== 'idle' && describe.englishOnly && (
          <p className="m-0 mt-0.5 px-1.5 font-mono text-3xs text-warn" title="Your Winnow’s image index was built with an English-only CLIP model: «dog» finds dogs, «chien» barely. A multilingual model (Winnow’s ML_CLIP_MODEL) reads other languages, after a re-index.">
            The index reads English — «dog», not «chien»
          </p>
        )}
        {describe.peopleAside && (
          <p className="m-0 mt-0.5 px-1.5 font-mono text-3xs text-muted">People set aside: a description cannot be narrowed by who is in it</p>
        )}
      </div>

      {/* --- where --- */}
      {lists.names !== null && PLACE_KINDS.some((k) => namesOfKind(lists.names!, k).length > 0 || facets.places[k]?.length) && (
        <div>
          <p className={legend}>Place</p>
          <Segmented<PlaceKind>
            label="Which kind of place"
            size="sm"
            fill
            value={kind}
            onChange={setKind}
            options={PLACE_KINDS.map((k) => ({ id: k, label: PLACE_LABEL[k] + (facets.places[k]?.length ? ` · ${facets.places[k]!.length}` : '') }))}
            className="mb-1"
          />
          {placeRows.length === 0 ? (
            <p className="m-0 px-1.5 text-xs text-muted">No {PLACE_LABEL[kind].toLowerCase()} named yet.</p>
          ) : (
            <Listed
              search={`Find a ${PLACE_LABEL[kind].toLowerCase()}`}
              entries={placeRows.map((n) => ({ key: String(n.value), label: String(n.value), count: n.count, text: String(n.value) }))}
              ticked={placesTicked}
              onToggle={(key) => set({ places: { ...facets.places, [kind]: toggled(placesTicked, key) } })}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** A list of tickable names with a count each; long ones get a search field and show their busiest. */
function Listed({
  entries,
  ticked,
  onToggle,
  search,
  lead,
}: {
  entries: readonly { key: string; label: string; count: number; text: string }[];
  ticked: readonly string[];
  onToggle: (key: string) => void;
  search: string;
  lead?: (key: string) => ReactNode;
}) {
  const [q, setQ] = useState('');
  const long = entries.length > LONG;
  const shown = useMemo(() => {
    const want = fold(q.trim());
    const kept = want ? entries.filter((e) => fold(e.text).includes(want) || fold(e.label).includes(want)) : entries;
    // Ticked first so a tick never scrolls out of the shown few; then the busiest.
    const ordered = [...kept].sort((a, b) => Number(ticked.includes(b.key)) - Number(ticked.includes(a.key)) || b.count - a.count);
    return long && !want ? ordered.slice(0, Math.max(SHOWN, ticked.length)) : ordered;
  }, [entries, q, long, ticked]);
  return (
    <div className="flex flex-col gap-0.5">
      {long && (
        <label className="flex items-center gap-1.5 mb-1 h-8 px-2 rounded-control border border-line bg-paper text-xs text-ink-soft focus-within:border-accent">
          <span className="inline-flex w-3.5 h-3.5 text-muted" aria-hidden="true">
            {Icons.search}
          </span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={search} aria-label={search} className="min-w-0 flex-1 bg-transparent border-0 p-0 text-xs text-ink outline-none" />
        </label>
      )}
      {shown.map((e) => {
        const on = ticked.includes(e.key);
        return (
          <button
            key={e.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(e.key)}
            className={`w-full grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 px-1.5 py-1 rounded-md border-0 text-left text-sm cursor-pointer max-[820px]:py-2 ${
              on ? 'text-ink' : 'text-ink-soft'
            } bg-transparent hover:bg-paper-2`}
          >
            <span
              aria-hidden="true"
              className={`w-3.5 h-3.5 grid place-items-center rounded-[4px] border [&_svg]:w-2.5 [&_svg]:h-2.5 ${
                on ? 'bg-ink border-ink text-paper' : 'bg-surface border-line-strong text-transparent'
              }`}
            >
              {Icons.check}
            </span>
            <span className="min-w-0 truncate flex items-center gap-1.5">
              {lead?.(e.key)}
              <span className="truncate">{e.label}</span>
            </span>
            <span className="font-mono text-3xs text-muted tabular-nums">{e.count}</span>
          </button>
        );
      })}
      {long && !q && shown.length < entries.length && (
        <p className="m-0 px-1.5 text-3xs font-mono text-muted">{entries.length - shown.length} more — search above</p>
      )}
    </div>
  );
}

/** A person's face, the stack's cover; their initial when the instance keeps none or will not hand it over. */
function Face({ client, person }: { client: WinnowClient; person: WinnowPerson | undefined }) {
  const [broken, setBroken] = useState(false);
  const faceId = person?.cover_face_id ?? null;
  useEffect(() => setBroken(false), [faceId]);
  const initial = (person?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="w-5 h-5 shrink-0 rounded-full overflow-hidden bg-paper-2 border border-line grid place-items-center font-mono text-3xs text-muted" aria-hidden="true">
      {faceId !== null && !broken ? <img src={client.faceThumbUrl(faceId)} alt="" className="w-full h-full object-cover" loading="lazy" onError={() => setBroken(true)} /> : initial}
    </span>
  );
}

/** The words field: applied on Enter or when the field is left, cleared by its ×. */
function WordsField({ value, onChange, way }: { value: string; onChange: (words: string) => void; way: WordsIn }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value.trim()) onChange(draft.trim());
  };
  const hint = WORDS_IN.find((w) => w.id === way)?.title;
  return (
    <label className="flex items-center gap-1.5 h-8 px-2 rounded-control border border-line bg-paper focus-within:border-accent" title={hint}>
      <span className="inline-flex w-3.5 h-3.5 text-muted" aria-hidden="true">
        {Icons.search}
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape' && draft) {
            e.preventDefault();
            e.stopPropagation();
            setDraft('');
            if (value) onChange('');
          }
        }}
        placeholder={way === 'describe' ? 'A dog, a parrot, a sunset…' : 'In the name or the text read'}
        aria-label={way === 'describe' ? 'Describe what is in the picture' : 'Words in the file’s path or the text read in the picture'}
        className="min-w-0 flex-1 bg-transparent border-0 p-0 text-sm text-ink outline-none placeholder:text-muted"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            if (value) onChange('');
          }}
          aria-label="Clear the words"
          className="inline-flex w-4 h-4 text-muted hover:text-ink border-0 bg-transparent p-0 cursor-pointer [&_svg]:w-3.5 [&_svg]:h-3.5"
        >
          {Icons.close}
        </button>
      )}
    </label>
  );
}
