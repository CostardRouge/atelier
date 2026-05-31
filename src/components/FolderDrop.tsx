import { useState } from 'react';
import {
  filesFromDataTransfer,
  pickDirectory,
  supportsDirectoryPicker,
} from '../sources/file-sources';

interface FolderDropProps {
  /** Called with the raw file list from any of the three access paths. */
  onFiles: (files: File[]) => void;
}

/**
 * The three file-access paths behind one UI: a directory picker (File System
 * Access API on Chromium, `<input webkitdirectory>` fallback elsewhere) plus a
 * drag-and-drop zone. All converge on `onFiles(File[])`.
 */
export default function FolderDrop({ onFiles }: FolderDropProps) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handlePick() {
    setBusy(true);
    try {
      const files = await pickDirectory();
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
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <p>
        Drag a folder (or files) here, or{' '}
        <button className="link-btn" onClick={handlePick} disabled={busy}>
          {busy ? 'opening…' : 'choose a folder'}
        </button>
        .
      </p>
      <p className="hint">
        {supportsDirectoryPicker()
          ? 'Uses your browser’s native folder picker.'
          : 'Your browser will open a folder selection dialog.'}{' '}
        Everything stays on your machine — nothing is uploaded.
      </p>
    </div>
  );
}
