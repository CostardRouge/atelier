import { useEffect, useRef, useState } from 'react';
import DevelopFold from '../../shared/develop/DevelopFold';
import { developLinkClass } from '../../shared/develop/develop-classes';
import { listDcps, useVaultVersion, type VaultProfile } from '../../shared/raw/profile-vault';
import type { RawProfile } from '../../shared/raw/dng-color';

const HINT =
  'How the camera’s colour becomes the picture’s. This file’s own is the DNG specification’s reading of the matrices it carries (and its hue/sat map, look table and curve where it has them). A .dcp you load — a profile from your own Adobe or camera-maker install — is kept on this device only and replaces them for this picture; Atelier ships none and fetches none. A picture whose profile this device does not hold keeps its colour matrix and loses the profile’s tables.';

/** What the select says for the picture's profile now. */
function currentId(profile: RawProfile | null): string {
  if (!profile) return 'libraw';
  return profile.dcp ? profile.dcp.hash : 'file';
}

/**
 * The camera profile a RAW on its sensor is developed with (C8 of
 * `docs/camera-profiles.md`): the file's own, or a `.dcp` from the vault, or
 * a new one loaded here. Calibration, never an edit: no preset or paste
 * carries it.
 */
export default function CameraProfilePanel({
  profile,
  missing,
  onChoose,
  onLoad,
  onForget,
}: {
  /** The profile the picture applies; null for LibRaw's own colour (a picture from before profiles). */
  profile: RawProfile | null;
  /** The picture names a loaded profile this device's vault does not hold. */
  missing: boolean;
  onChoose: (id: 'file' | string) => void;
  onLoad: (file: File) => void;
  onForget: (hash: string) => void;
}) {
  const version = useVaultVersion();
  const [vault, setVault] = useState<VaultProfile[]>([]);
  useEffect(() => {
    let alive = true;
    void listDcps().then((list) => {
      if (alive) setVault(list);
    });
    return () => {
      alive = false;
    };
  }, [version]);
  const input = useRef<HTMLInputElement>(null);
  const id = currentId(profile);
  const chosenDcp = profile?.dcp ?? null;
  return (
    <DevelopFold id="camera-profile" title="Camera profile" info={<p>{HINT}</p>} marked={Boolean(chosenDcp)}>
      <label className="flex items-center justify-between gap-2 text-xs text-ink">
        <span>Profile</span>
        <select
          className="flex-1 min-w-0 max-w-[12rem] rounded-control border border-line bg-paper px-2 py-1 text-xs text-ink"
          value={id}
          onChange={(e) => {
            const next = e.target.value;
            if (next === 'load') input.current?.click();
            else if (next !== id && next !== 'libraw') onChoose(next);
          }}
        >
          {id === 'libraw' && <option value="libraw">LibRaw’s matrix (before profiles)</option>}
          <option value="file">This file’s own</option>
          {vault.map((v) => (
            <option key={v.hash} value={v.hash}>
              {v.name}
            </option>
          ))}
          {chosenDcp && !vault.some((v) => v.hash === chosenDcp.hash) && <option value={chosenDcp.hash}>{chosenDcp.name}</option>}
          <option value="load">Load a .dcp…</option>
        </select>
      </label>
      <input
        ref={input}
        type="file"
        accept=".dcp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onLoad(file);
        }}
      />
      {profile?.label && <span className="font-mono text-3xs leading-relaxed text-muted">{profile.label}</span>}
      {missing && chosenDcp && (
        <span className="font-mono text-3xs leading-relaxed text-warn">
          «{chosenDcp.name}» is not on this device — its colour matrix applies, its tables do not. Load the same .dcp to restore them.
        </span>
      )}
      {chosenDcp && !missing && (
        <button type="button" className={developLinkClass} onClick={() => onForget(chosenDcp.hash)}>
          Forget «{chosenDcp.name}» on this device
        </button>
      )}
    </DevelopFold>
  );
}
