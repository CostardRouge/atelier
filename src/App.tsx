import { useState } from 'react';
import FolderDrop from './components/FolderDrop';
import Gallery from './components/Gallery';
import DetailView from './components/DetailView';
import { pairFiles, type MediaPair } from './lib/pair-files';

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

export default function App() {
  const [pairs, setPairs] = useState<MediaPair[]>([]);
  const [selected, setSelected] = useState<MediaPair | null>(null);
  const [loaded, setLoaded] = useState(false);

  function handleFiles(files: File[]) {
    setPairs(pairFiles(files));
    setSelected(null);
    setLoaded(true);
  }

  return (
    <div className="app">
      <header className="masthead">
        <span className="wordmark">
          Flight <b>Studio</b>
        </span>
        <span className="edition">DJI · SRT telemetry</span>
      </header>

      {selected ? (
        <DetailView pair={selected} onBack={() => setSelected(null)} />
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
              <Gallery pairs={pairs} onOpen={setSelected} />
            </section>
          )}
        </>
      )}

      <footer>
        <span className="dot" />
        Runs entirely in your browser — files are never uploaded.
        <span className="dot" />
        Telemetry reads from <code>.srt</code>, plain text, always.
      </footer>
    </div>
  );
}
