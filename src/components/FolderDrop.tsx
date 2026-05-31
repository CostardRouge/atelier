import { useState } from 'react';
import {
  filesFromDataTransfer,
  pickDirectory,
  pickFiles,
  supportsDirectoryPicker,
} from '../sources/file-sources';

interface FolderDropProps {
  /** Called with the raw file list from any of the access paths. */
  onFiles: (files: File[]) => void;
}

/**
 * One drop zone, several ways in: pick individual files (a clip + its .srt),
 * pick a whole folder, or drag either onto the zone. Clicking the zone itself
 * opens the file picker — the common "just my two files" case. All paths
 * converge on `onFiles(File[])`.
 */
export default function FolderDrop({ onFiles }: FolderDropProps) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(pick: () => Promise<File[]>) {
    setBusy(true);
    try {
      const files = await pick();
      if (files.length > 0) onFiles(files);
    } finally {
      setBusy(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    setBusy(true);
    try {
      const files = await filesFromDataTransfer(e.dataTransfer);
      if (files.length > 0) onFiles(files);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`folder-drop${dragging ? ' dragging' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => run(pickFiles)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          run(pickFiles);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <svg
        className="drop-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        <path d="M12 15.5V10" />
        <path d="m9.5 12 2.5-2.5L14.5 12" />
      </svg>
      <p>
        Drop your <strong>.mp4 + .srt</strong> here — or a whole folder.
      </p>
      <p className="drop-actions">
        <button
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation();
            run(pickFiles);
          }}
          disabled={busy}
        >
          {busy ? 'opening…' : 'Choose files'}
        </button>
        <span className="sep">or</span>
        <button
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation();
            run(pickDirectory);
          }}
          disabled={busy}
        >
          choose a folder
        </button>
      </p>
      <p className="hint">
        {supportsDirectoryPicker()
          ? 'Folders open through your browser’s native picker.'
          : 'Folder selection opens your browser’s dialog.'}{' '}
        Everything stays on your machine — nothing is uploaded.
      </p>
    </div>
  );
}
