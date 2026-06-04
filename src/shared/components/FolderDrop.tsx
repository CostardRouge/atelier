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
      className={`border-[1.5px] border-dashed rounded-paper-lg bg-surface p-[clamp(1.75rem,5vw,2.75rem)] text-center mb-8 cursor-pointer transition-[border-color,background-color,transform] duration-[250ms] ease-paper hover:border-accent focus-visible:border-accent focus-visible:outline-none ${
        dragging
          ? 'border-accent bg-accent-wash -translate-y-0.5'
          : 'border-line-strong'
      }`}
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
        className="w-[38px] h-[38px] mx-auto mb-[0.9rem] text-accent"
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
      <p className="m-0 text-[1.02rem]">
        Drop your <strong className="font-semibold text-ink">.mp4 + .srt</strong> here — or a whole folder.
      </p>
      <p className="flex items-center justify-center gap-[0.6rem] mt-[0.7rem] mb-0">
        <button
          className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:cursor-default disabled:no-underline"
          onClick={(e) => {
            e.stopPropagation();
            run(pickFiles);
          }}
          disabled={busy}
        >
          {busy ? 'opening…' : 'Choose files'}
        </button>
        <span className="text-faint text-[0.85rem]">or</span>
        <button
          className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent disabled:text-faint disabled:cursor-default disabled:no-underline"
          onClick={(e) => {
            e.stopPropagation();
            run(pickDirectory);
          }}
          disabled={busy}
        >
          choose a folder
        </button>
      </p>
      <p className="mt-[0.55rem] mx-auto mb-0 text-[0.8rem] text-muted max-w-[48ch]">
        {supportsDirectoryPicker()
          ? 'Folders open through your browser’s native picker.'
          : 'Folder selection opens your browser’s dialog.'}{' '}
        Everything stays on your machine — nothing is uploaded.
      </p>
    </div>
  );
}
