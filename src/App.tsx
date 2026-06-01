import { useState } from 'react';
import FolderDrop from './components/FolderDrop';
import Gallery from './components/Gallery';
import DetailView from './components/DetailView';
import LutStudio from './components/LutStudio';
import {
  attachToPair,
  detachFromPair,
  pairFiles,
  type MediaPair,
} from './lib/pair-files';

const REPO_URL = 'https://github.com/CostardRouge/dji-flight-data';

const STEPS = [
  {
    no: '01',
    title: 'Drop files or a folder',
    body: 'Bring just one .mp4 and its .srt, or a whole DJI card folder. Nothing uploads; it stays on your machine.',
  },
  {
    no: '02',
    title: 'Pairs build themselves',
    body: 'Each video finds its matching .srt sibling automatically and starts reading its flight log.',
  },
  {
    no: '03',
    title: 'Telemetry plays inline',
    body: 'Altitude, GPS and exposure move with every clip right in the gallery. Open one full view for the complete readout.',
  },
];

type View = 'telemetry' | 'lut';

export default function App() {
  const [pairs, setPairs] = useState<MediaPair[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>('telemetry');

  function handleFiles(files: File[]) {
    setPairs(pairFiles(files));
    setSelectedId(null);
    setLoaded(true);
  }

  // Replace one pair in place (matched by id). Used by attach and detach so the
  // change shows in the gallery and, if it's the open one, the detail view.
  function updatePair(id: string, fn: (p: MediaPair) => MediaPair) {
    setPairs((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));
  }

  function handleAttach(pair: MediaPair, file: File) {
    updatePair(pair.id, (p) => attachToPair(p, file));
  }

  function handleDetach(pair: MediaPair, kind: 'video' | 'srt') {
    updatePair(pair.id, (p) => detachFromPair(p, kind));
  }

  const selected = pairs.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="app">
      <header className="masthead">
        <span className="wordmark">
          Flight <b>Studio</b>
        </span>
        <div className="masthead-right">
          <nav className="nav" aria-label="Sections">
            <button
              type="button"
              className={view === 'telemetry' ? 'active' : undefined}
              aria-current={view === 'telemetry' ? 'page' : undefined}
              onClick={() => setView('telemetry')}
            >
              Telemetry
            </button>
            <button
              type="button"
              className={view === 'lut' ? 'active' : undefined}
              aria-current={view === 'lut' ? 'page' : undefined}
              onClick={() => setView('lut')}
            >
              LUT Studio
            </button>
          </nav>
          <span className="edition">DJI · SRT telemetry</span>
          <a
            className="gh-link"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="View source on GitHub"
            title="View source on GitHub"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
              />
            </svg>
          </a>
        </div>
      </header>

      {view === 'lut' ? (
        <LutStudio />
      ) : selected ? (
        <DetailView
          pair={selected}
          onBack={() => setSelectedId(null)}
          onAttach={handleAttach}
          onDetach={handleDetach}
        />
      ) : (
        <>
          <section className="hero">
            <div>
              <p className="kicker">Footage, with its memory intact</p>
              <h1>
                Watch your
                <br />
                drone <em>think.</em>
              </h1>
            </div>
            <p className="lede">
              Every DJI clip carries a hidden flight log — altitude, GPS, ISO,
              shutter — recorded beside it as an <strong>.srt</strong> file.
              Flight Studio plays the two together, so the numbers move with the
              picture. <strong>No upload, no account, no server</strong> — your
              footage never leaves this machine.
            </p>
          </section>

          <section className="how" aria-label="How it works">
            {STEPS.map((s) => (
              <article className="step" key={s.no}>
                <span className="no">{s.no}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </section>

          <FolderDrop onFiles={handleFiles} />

          {loaded && (
            <section aria-label="Your clips">
              <div className="collection-head">
                <span className="title">The collection</span>
                <p className="count">
                  {pairs.length} clip{pairs.length === 1 ? '' : 's'}
                </p>
              </div>
              <Gallery
                pairs={pairs}
                onOpen={(p) => setSelectedId(p.id)}
                onAttach={handleAttach}
                onDetach={handleDetach}
              />
            </section>
          )}
        </>
      )}

      <footer>
        <span className="dot" />
        Runs entirely in your browser — files are never uploaded.
        <span className="dot" />
        Telemetry reads from <code>.srt</code>, plain text, always.
        <span className="dot" />
        <a className="foot-link" href={REPO_URL} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
