import { useEffect, useRef, useState } from 'react';
import TelemetryPlayer from './components/TelemetryPlayer';
import { parseSrt, type Cue } from './lib/srt-parser';

export default function App() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [srtName, setSrtName] = useState<string | null>(null);

  // Track the active object URL so we can revoke the previous one whenever it
  // changes, and on unmount — avoids leaking memory across file selections.
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  function onVideoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoUrl(url);
  }

  function onSrtChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSrtName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setCues(parseSrt(text));
    };
    reader.readAsText(file);
  }

  return (
    <div className="app">
      <h1>DJI SRT Telemetry Viewer</h1>

      <div className="inputs">
        <label>
          Video (.mp4)
          <input type="file" accept="video/*,.mp4" onChange={onVideoChange} />
        </label>
        <label>
          Telemetry (.srt)
          <input type="file" accept=".srt,text/plain" onChange={onSrtChange} />
        </label>
      </div>

      <TelemetryPlayer videoUrl={videoUrl} cues={cues} />

      <footer>
        {srtName
          ? `${srtName} — ${cues.length} cue${cues.length === 1 ? '' : 's'} parsed.`
          : 'Everything runs locally in your browser. Files are never uploaded.'}
      </footer>
    </div>
  );
}
