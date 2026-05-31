import { useState } from 'react';
import FolderDrop from './components/FolderDrop';
import Gallery from './components/Gallery';
import DetailView from './components/DetailView';
import { pairFiles, type MediaPair } from './lib/pair-files';

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
      <h1>DJI SRT Telemetry Viewer</h1>

      {selected ? (
        <DetailView pair={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <FolderDrop onFiles={handleFiles} />
          {loaded && (
            <>
              <p className="count">
                {pairs.length} video{pairs.length === 1 ? '' : 's'} found.
              </p>
              <Gallery pairs={pairs} onOpen={setSelected} />
            </>
          )}
        </>
      )}

      <footer>
        Everything runs locally in your browser. Files are never uploaded.
      </footer>
    </div>
  );
}
