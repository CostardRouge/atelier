import { useEffect, useId, useState, type ReactNode } from 'react';
import { DEVICE_CLASS_KEY, deviceClass, deviceClassFor, readDeviceFacts } from '../../shared/lib/device-class';
import { clearRollShots, listRollShots, listRolls, rollShotsFootprint } from '../../shared/develop/roll-store';
import { SHOT_LONG_EDGE, shotsPref } from '../../shared/develop/shot-record';
import { buildTrainingDump, serializeTrainingFile, trainingFileName } from '../../shared/develop/training-dump';
import { downloadBlob } from '../../shared/media/save';
import { blobToDataUrl } from '../../shared/media/data-url';
import { setLensfunAllowed, useLensfunAllowed } from '../../shared/lens/lensfun-store';
import { formatBytes } from '../../shared/lib/format';
import { useLutInterpolation } from '../../shared/lut/use-lut-interpolation';
import { useBrowserChroma, useFullColourFrom } from '../../shared/media/browser-jpeg';
import { chromaWords } from '../../shared/media/jpeg-chroma';
import { autoBandsMean } from '../../shared/render/band-policy';
import { useBandPreference } from '../../shared/render/use-band-preference';
import { useDitherPreference } from '../../shared/render/use-dither-preference';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { InfoDotButton } from '../../shared/ui/InfoDot';
import { localPref, useLocalPref } from '../../shared/ui/local-pref';
import Segmented from '../../shared/ui/Segmented';
import { useFingerSize } from '../../shared/ui/use-coarse-pointer';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { usePixelView } from '../../shared/ui/use-pixel-view';
import { openedOnSection, settingsSectionPref, type SettingsSection } from './develop-settings-open';

/**
 * DEVELOP'S SETTINGS — the choices that belong to this DEVICE, never to a roll
 * (2026-10-06, the maintainer's «master interface de réglage pour le develop»,
 * lab https://claude.ai/artifact/Ts6hWzvxxybV67QAR9Z6D8, opened from inside
 * the roll, his pick of the three places).
 *
 * Each row is a browser preference kept in `localStorage` and shared with
 * every reader (`local-pref.ts`, the graph's own band and dither preferences),
 * so a switch here reaches the picture open behind the sheet at once. None
 * travels with a roll, a preset or a paste. It gathers what already existed —
 * some of it reachable only by hand in the console — the dither's switch, and
 * the ENCODER: what this browser's JPEG writer keeps of the colour, measured.
 *
 * A row reads like the inspector's: the name, its control, and under the
 * control ONE line saying what the choice in hand does. The standing why
 * folds behind an ⓘ beside the name, so the pane is a list of choices and
 * never a manual.
 */

const SECTIONS: readonly { id: SettingsSection; name: string; sub: string }[] = [
  { id: 'encoder', name: 'Encoder', sub: 'How a JPEG is written' },
  { id: 'rendering', name: 'Rendering', sub: 'Tones, looks, big pictures' },
  { id: 'device', name: 'Device', sub: 'Phone or computer' },
  { id: 'network', name: 'Network', sub: 'What may be fetched' },
  { id: 'learning', name: 'Learning', sub: 'What a model learns from' },
];

type DeviceChoice = 'auto' | 'constrained' | 'roomy';
const devicePref = localPref<DeviceChoice>(
  DEVICE_CLASS_KEY,
  (raw) => (raw === 'constrained' || raw === 'roomy' ? raw : 'auto'),
  (v) => (v === 'auto' ? null : v),
);

/** `segmenter.ts` reads `'page'` to keep the subject model off its worker — a diagnosis switch. */
const segmentPref = localPref<'worker' | 'page'>('atelier.segment', (raw) => (raw === 'page' ? 'page' : 'worker'), (v) => (v === 'page' ? 'page' : null));

/** The qualities a photographer reaches for, and the one at which Chrome switches. */
const CHROMA_QUALITIES = [0.85, 0.92, 0.99, 1];

/**
 * One setting: its name, its control, and what the choice in hand DOES.
 * `state` is one line under the control that changes with the value and
 * stays in the open; `info` is the standing why, behind the ⓘ beside the
 * name — the split `FieldRow` makes under `FoldHints`, at a label width a
 * setting's name needs.
 */
function Row({ label, state, info, children }: { label: string; state?: ReactNode; info?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] items-start gap-x-5 gap-y-1.5 py-3 border-t border-line first:border-t-0 max-[820px]:grid-cols-1">
      <span className="flex items-center gap-1.5 min-w-0 pt-1 max-[820px]:pt-0">
        <span className="text-sm font-medium text-ink leading-tight">{label}</span>
        {info && <InfoDotButton about={label.toLowerCase()} open={open} controls={id} onToggle={() => setOpen((o) => !o)} />}
      </span>
      <div className="flex flex-col gap-1.5 min-w-0">
        {children}
        {state && <span className="text-xs leading-relaxed text-muted">{state}</span>}
        {info && open && (
          <div id={id} className="text-xs leading-relaxed text-ink-soft [&>p]:m-0 [&>p+p]:mt-1.5">
            {info}
          </div>
        )}
      </div>
    </div>
  );
}

/** A value to read, not to set — the engine's name, aligned with a control's text. */
function Fact({ children }: { children: ReactNode }) {
  return <span className="text-sm text-ink pt-1">{children}</span>;
}

/** One quality, and what this browser writes at it: three cells of the table. */
function ChromaAt({ quality }: { quality: number }) {
  const chroma = useBrowserChroma(quality);
  return (
    <>
      <span className="text-ink text-right">{Math.round(quality * 100)} %</span>
      <span className={chroma === '4:4:4' ? 'text-ok' : 'text-ink-soft'}>{chroma ?? '…'}</span>
      <span className="text-muted min-w-0 truncate">{chroma ? chromaWords(chroma) : 'measuring'}</span>
    </>
  );
}

function Encoder() {
  const from = useFullColourFrom();
  return (
    <>
      <Row label="Engine" info={<p>The JPEG writer built into this browser. Its one setting is a target’s quality, chosen in the Export tab.</p>}>
        <Fact>This browser’s own</Fact>
      </Row>
      <Row
        label="Colour it keeps"
        state={from === undefined ? 'Measuring…' : from === null ? 'Never full colour on this browser' : `Full colour from ${Math.round(from * 100)} %`}
        info={
          <p>
            Measured here, by writing a small picture at each quality and reading its header. A JPEG may keep the colour of
            one pixel in four (4:2:0): that is what draws blocks along a saturated edge and in a smooth sky. Full colour
            (4:4:4) costs several times the weight.
          </p>
        }
      >
        <div className="grid grid-cols-[3rem_3.25rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 pt-1 font-mono text-xs tabular-nums">
          {CHROMA_QUALITIES.map((q) => (
            <ChromaAt key={q} quality={q} />
          ))}
        </div>
      </Row>
    </>
  );
}

function Rendering() {
  const size = useFingerSize();
  const dither = useDitherPreference();
  const { interpolation, setInterpolation } = useLutInterpolation();
  const bands = useBandPreference();
  const [pixelView, setPixelView] = usePixelView();
  const autoBands = autoBandsMean(deviceClass()) === 'bands';
  const banded = bands.preference === 'bands' || (bands.preference === 'auto' && autoBands);
  return (
    <>
      <Row
        label="Dither the last rounding"
        state={
          dither.preference === 'auto'
            ? 'On where more than 8 bits reach the file — a RAW, a layer, a warp, detail'
            : 'Off: a plain rounding, and a pushed sky from a RAW can show its steps'
        }
        info={
          <p>
            A noise under half a code, the same on the three channels and drawn per 2 × 2 pixels so a JPEG keeps it,
            turns each step of a smooth gradient back into the gradient it was. It never moves an exact value, and an
            8-bit picture with no more than its develop and look is left exactly as it was.
          </p>
        }
      >
        <Segmented
          className="self-start max-w-full"
          size={size}
          label="Dither the last rounding"
          value={dither.preference}
          onChange={dither.setPreference}
          options={[
            { id: 'auto', label: 'Auto' },
            { id: 'off', label: 'Off' },
          ]}
        />
      </Row>
      <Row
        label="Look interpolation"
        state={interpolation === 'tetrahedral' ? 'Greys stay grey' : 'Can tint greys — look at skies and gradients'}
        info={
          <p>
            How a look’s lattice is read between its points: the four corners that matter (tetrahedral, what Resolve
            uses) or all eight averaged (trilinear).
          </p>
        }
      >
        <Segmented
          className="self-start max-w-full"
          size={size}
          label="Look interpolation"
          value={interpolation}
          onChange={setInterpolation}
          options={[
            { id: 'tetrahedral', label: 'Tetrahedral' },
            { id: 'trilinear', label: 'Trilinear' },
          ]}
        />
      </Row>
      <Row
        label="Big pictures"
        state={
          banded
            ? 'Past 12 megapixels, drawn a band at a time: a few hundred MB of GPU memory, the same pixels'
            : 'Drawn whole: two copies on the GPU, three quarters of a gigabyte at 48 megapixels'
        }
        info={
          <p>
            Past 12 megapixels a picture can be drawn in bands to spare a phone’s GPU memory; the result is the same. A
            computer has the memory, and one Mac drew the loupe striped in bands, so it draws whole unless asked.
          </p>
        }
      >
        <Segmented
          className="self-start max-w-full"
          size={size}
          label="Big pictures"
          value={bands.preference}
          onChange={bands.setPreference}
          options={[
            { id: 'auto', label: `Auto · ${autoBands ? 'bands' : 'whole'}` },
            { id: 'whole', label: 'Whole' },
            { id: 'bands', label: 'In bands' },
          ]}
        />
      </Row>
      <Row
        label="Past 1:1"
        state={
          pixelView === 'smooth'
            ? 'Smoothed: the gradients between pixels are the browser’s, not the picture’s'
            : 'Each pixel a square: to judge noise, an edge, a dust speck'
        }
      >
        <Segmented
          className="self-start max-w-full"
          size={size}
          label="Past 1:1"
          value={pixelView}
          onChange={setPixelView}
          options={[
            { id: 'smooth', label: 'Smooth' },
            { id: 'pixels', label: 'Pixels' },
          ]}
        />
      </Row>
    </>
  );
}

function Device() {
  const size = useFingerSize();
  const [choice, setChoice] = useLocalPref(devicePref, 'auto');
  const [segment, setSegment] = useLocalPref(segmentPref, 'worker');
  // The class is read once per page (`device-class.ts`): a change is said, and applied by a reload.
  const [loaded] = useState(choice);
  const pending = choice !== loaded;
  const detected = deviceClassFor(readDeviceFacts());
  const word = (c: 'constrained' | 'roomy') => (c === 'constrained' ? 'phone' : 'computer');
  return (
    <>
      <Row
        label="Device class"
        state={pending ? <span className="text-accent-ink">Applies when the page reloads.</span> : `Detected as a ${word(detected)}`}
        info={
          <p>
            Decides the memory budgets. A phone-class device decodes a RAW to 2560 px on the stage and 4096 px in an
            export, holds fewer fetched files, and lets the decoder go after 8 s; a computer-class one works at the
            file’s own size.
          </p>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size={size}
            label="Device class"
            value={choice}
            onChange={setChoice}
            options={[
              { id: 'auto', label: `Auto · ${word(detected)}` },
              { id: 'constrained', label: 'Phone' },
              { id: 'roomy', label: 'Computer' },
            ]}
          />
          {pending && (
            <Button size={size} icon={Icons.reset} onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
        </div>
      </Row>
      <Row
        label="Subject model"
        state={
          segment === 'page'
            ? 'On the page: the picture stalls while it thinks — for a diagnosis only'
            : 'In a worker: the picture stays live while it thinks'
        }
        info={<p>Where the segmentation model runs when a Subject mask asks it. A change applies the next time the model loads.</p>}
      >
        <Segmented
          className="self-start max-w-full"
          size={size}
          label="Subject model"
          value={segment}
          onChange={setSegment}
          options={[
            { id: 'worker', label: 'In a worker' },
            { id: 'page', label: 'On the page' },
          ]}
        />
      </Row>
    </>
  );
}

function Network() {
  const size = useFingerSize();
  const lensfun = useLensfunAllowed();
  return (
    <Row
      label="Lens profiles"
      state={
        lensfun
          ? 'Lensfun’s file for a maker is fetched the first time a lens is met; only the answer is kept on this device'
          : 'No request leaves this device; the manual lens sliders stay'
      }
      info={
        <p>
          A measured profile corrects a lens’s distortion, colour fringing and vignetting — by itself on a RAW, on
          request over a camera render. The database never ships: a profile is kept here, keyed by the body and the
          lens.
        </p>
      }
    >
      <Segmented
        className="self-start max-w-full"
        size={size}
        label="Lens profiles"
        value={lensfun ? 'on' : 'off'}
        onChange={(v) => setLensfunAllowed(v === 'on')}
        options={[
          { id: 'on', label: 'Fetch from Lensfun' },
          { id: 'off', label: 'Off' },
        ]}
      />
    </Row>
  );
}

/**
 * What this device keeps so a model can one day learn the maintainer's hand
 * (B1 of `docs/auto-develop.md` §6): each photograph as shot, beside its
 * develop. The pairs are read into one file by the rolls gallery's ⋯.
 */
function Learning() {
  const size = useFingerSize();
  const [keep, setKeep] = useLocalPref(shotsPref, true);
  const [footprint, setFootprint] = useState<{ count: number; bytes: number } | null>(null);
  // Counted when the pane opens and after a switch: a bake in another roll is not watched.
  useEffect(() => {
    let alive = true;
    setFootprint(null);
    void rollShotsFootprint().then((f) => {
      if (alive) setFootprint(f);
    });
    return () => {
      alive = false;
    };
  }, [keep]);
  const kept = footprint
    ? footprint.count
      ? `${footprint.count} kept · ${formatBytes(footprint.bytes)}`
      : 'none kept yet'
    : 'counting…';
  return (
    <>
    <Row
      label="Pictures as shot"
      state={
        keep
          ? `A ${SHOT_LONG_EDGE} px picture of each photograph before its develop, with its light and its camera’s facts — ${kept}`
          : 'Nothing kept, and what was is gone: a model cannot learn from this device'
      }
      info={
        <>
          <p>
            A develop is a record, and a model can only learn what the record answers to: the picture before it. The
            roll’s thumbnails show the picture as delivered, so a small one as shot is kept beside each record — a few
            kilobytes, on this device, pruned with the picture. No place and no words go with it.
          </p>
          <p>The row under this one writes every pair into one training file; nothing leaves by itself.</p>
        </>
      }
    >
      <Segmented
        className="self-start max-w-full"
        size={size}
        label="Pictures as shot"
        value={keep ? 'keep' : 'off'}
        onChange={(v) => {
          const on = v === 'keep';
          setKeep(on);
          // Off means gone: a pair nobody asked for is media kept for nothing.
          if (!on) void clearRollShots().then(() => setFootprint({ count: 0, bytes: 0 }));
        }}
        options={[
          { id: 'keep', label: 'Keep' },
          { id: 'off', label: 'Off' },
        ]}
      />
    </Row>
    <TrainingFile kept={footprint ? footprint.count : null} />
    </>
  );
}

/** How the training file's write ended, for the one line under its verb. */
type Written = { pairs: number; unpaired: number; name: string } | { none: true };

/**
 * The training file (B2 of `docs/auto-develop.md` §6): every pair of every
 * roll, in one JSON file, on the author's click — the dataset a trainer
 * outside the browser learns his hand from. Written where a download goes;
 * nothing leaves by itself.
 */
function TrainingFile({ kept }: { kept: number | null }) {
  const size = useFingerSize();
  const [written, setWritten] = useState<Written | null>(null);
  const [busy, setBusy] = useState(false);
  const write = async () => {
    setBusy(true);
    try {
      const [rolls, shots] = await Promise.all([listRolls(), listRollShots()]);
      const now = Date.now();
      const dump = await buildTrainingDump(rolls, new Map(shots.map((s) => [s.id, s])), blobToDataUrl, now);
      if (dump.file.pairs.length === 0) {
        setWritten({ none: true });
        return;
      }
      const name = trainingFileName(now);
      downloadBlob(new Blob([serializeTrainingFile(dump.file)], { type: 'application/json' }), name);
      setWritten({ pairs: dump.file.pairs.length, unpaired: dump.unpaired, name });
    } finally {
      setBusy(false);
    }
  };
  const state = written
    ? 'none' in written
      ? 'Nothing to write: no picture has its pair yet'
      : `${written.name} · ${written.pairs} pair${written.pairs === 1 ? '' : 's'}` +
        (written.unpaired ? ` · ${written.unpaired} picture${written.unpaired === 1 ? '' : 's'} without one left out` : '')
    : kept === null
      ? 'Every pair of every roll, as one JSON file'
      : kept
        ? `Every pair of every roll, as one JSON file — ${kept} today`
        : 'Every pair of every roll, as one JSON file — none to write yet';
  return (
    <Row
      label="Training file"
      state={state}
      info={
        <>
          <p>
            One line per picture: the vignette as shot, its light, its camera’s facts and the whole record over it — the
            develop with every default filled, the crop, the warps, detail, the layers, the repair, the look by name.
            An untouched picture is a line too: “change nothing” is an answer to learn.
          </p>
          <p>
            Left out: a look’s own lattice, where the file came from, the journal, the words. A trainer outside the
            browser reads it; a model it makes comes back as a verb here.
          </p>
        </>
      }
    >
      <Button size={size} icon={Icons.export} disabled={busy} onClick={() => void write()}>
        {busy ? 'Writing…' : 'Write the file'}
      </Button>
    </Row>
  );
}

const PANES: Record<SettingsSection, () => ReactNode> = { encoder: Encoder, rendering: Rendering, device: Device, network: Network, learning: Learning };

export default function DevelopSettingsSheet({ onClose }: { onClose: () => void }) {
  const compact = useIsCompact();
  const [section, setSection] = useLocalPref(settingsSectionPref, 'encoder');
  // On a phone: one pane at a time, the list first (the suite's drill-down
  // rule) — unless the sheet was opened ON a section, which it then shows.
  const [drilled, setDrilled] = useState(openedOnSection);
  // Every row writes at once, so the sheet's primary action IS closing it:
  // Enter says "done" like Escape does, the Trip settings' rule.
  useDialogKeys({ onCancel: onClose, onConfirm: onClose });
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const Pane = PANES[current.id];
  const showList = !compact || !drilled;
  const showPane = !compact || drilled;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.55)] backdrop-blur-[2px] max-[820px]:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="Develop settings"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[52rem] h-[min(calc(var(--app-h)*0.86),40rem)] flex flex-col bg-surface border border-line rounded-paper-lg shadow-paper overflow-hidden max-[820px]:max-w-none max-[820px]:h-[var(--app-h)] max-[820px]:rounded-none max-[820px]:border-0">
        <div className="flex-none flex items-center gap-2.5 min-w-0 px-4 py-3 border-b border-line">
          {compact && drilled && (
            <Button size="sm" icon={Icons.back} onClick={() => setDrilled(false)}>
              Settings
            </Button>
          )}
          <h2 className="m-0 font-serif text-lg min-w-0 truncate">{compact && drilled ? current.name : 'Develop settings'}</h2>
          <span className="flex-1" />
          {!compact && <span className="font-mono text-3xs tracking-[0.12em] uppercase text-muted">On this device only</span>}
          <button
            type="button"
            onClick={onClose}
            className="flex-none inline-flex items-center h-[2.125rem] font-mono text-3xs tracking-[0.12em] uppercase text-muted border border-line rounded-full px-3.5 hover:text-accent hover:border-line-strong transition-colors cursor-pointer"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>
        <div className="flex-1 min-h-0 flex">
          {showList && (
            <nav aria-label="Sections" className={`flex flex-col gap-0.5 p-2 overflow-y-auto bg-paper-2 ${compact ? 'flex-1' : 'flex-none w-56 border-r border-line'}`}>
              {SECTIONS.map((s) => {
                const on = !compact && s.id === current.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-current={on || undefined}
                    onClick={() => {
                      setSection(s.id);
                      setDrilled(true);
                    }}
                    className={`flex items-center gap-2 text-left px-3 py-2.5 rounded-control border-0 cursor-pointer ${on ? 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'bg-transparent hover:bg-surface'}`}
                  >
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="text-sm font-medium text-ink">{s.name}</span>
                      <span className="text-xs text-muted">{s.sub}</span>
                    </span>
                    {compact && <span className="inline-flex text-muted">{Icons.forward}</span>}
                  </button>
                );
              })}
              {compact && <p className="m-0 mt-3 px-3 text-xs leading-relaxed text-muted">Kept on this device. Never on a roll, a preset or a paste.</p>}
            </nav>
          )}
          {showPane && (
            <div className="flex-1 min-w-0 overflow-y-auto overscroll-contain px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Pane />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
