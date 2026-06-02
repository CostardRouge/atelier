import { useState } from 'react';
import FolderDrop from './FolderDrop';
import Gallery from './Gallery';
import DetailView from './DetailView';
import {
  attachToPair,
  detachFromPair,
  pairFiles,
  type MediaPair,
} from '../lib/pair-files';

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

/**
 * Telemetry tool — the original DJI experience: drop a card folder, pairs build
 * themselves, and each clip plays with its flight log synced to the frame.
 *
 * Self-contained: owns its own `pairs`/`selectedId` state. The selected pair is
 * kept in state (not a route) on purpose — pairs are built from in-memory
 * `File`s, so an id wouldn't survive a reload to deep-link to.
 */
export default function TelemetryTool() {
  const [pairs, setPairs] = useState<MediaPair[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

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

  if (selected) {
    return (
      <DetailView
        pair={selected}
        onBack={() => setSelectedId(null)}
        onAttach={handleAttach}
        onDetach={handleDetach}
      />
    );
  }

  return (
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
          shutter — recorded beside it as an <strong>.srt</strong> file. Atelier
          plays the two together, so the numbers move with the picture.{' '}
          <strong>No upload, no account, no server</strong> — your footage never
          leaves this machine.
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
  );
}
