import { useState, type ReactNode } from 'react';
import { DEVICE_CLASS_KEY, deviceClass, deviceClassFor, readDeviceFacts } from '../../shared/lib/device-class';
import { setLensfunAllowed, useLensfunAllowed } from '../../shared/lens/lensfun-store';
import { useLutInterpolation } from '../../shared/lut/use-lut-interpolation';
import { autoBandsMean } from '../../shared/render/band-policy';
import { useBandPreference } from '../../shared/render/use-band-preference';
import { useDitherPreference } from '../../shared/render/use-dither-preference';
import Button from '../../shared/ui/Button';
import { Icons } from '../../shared/ui/icons';
import { useBrowserChroma, useFullColourFrom } from '../../shared/media/browser-jpeg';
import { chromaWords } from '../../shared/media/jpeg-chroma';
import { localPref, useLocalPref } from '../../shared/ui/local-pref';
import Segmented from '../../shared/ui/Segmented';
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
 */

const SECTIONS: readonly { id: SettingsSection; name: string; sub: string }[] = [
  { id: 'encoder', name: 'Encoder', sub: 'How a JPEG is written' },
  { id: 'rendering', name: 'Rendering', sub: 'Tones, looks, big pictures' },
  { id: 'device', name: 'Device', sub: 'Phone or computer' },
  { id: 'privacy', name: 'Network', sub: 'What may be fetched' },
];

type DeviceChoice = 'auto' | 'constrained' | 'roomy';
const devicePref = localPref<DeviceChoice>(
  DEVICE_CLASS_KEY,
  (raw) => (raw === 'constrained' || raw === 'roomy' ? raw : 'auto'),
  (v) => (v === 'auto' ? null : v),
);

/** `segmenter.ts` reads `'page'` to keep the subject model off its worker — a diagnosis switch. */
const segmentPref = localPref<'worker' | 'page'>('atelier.segment', (raw) => (raw === 'page' ? 'page' : 'worker'), (v) => (v === 'page' ? 'page' : null));

/** One setting: what it is, its control, and one line of why. */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] gap-x-5 gap-y-1.5 py-3 border-t border-line first:border-t-0 max-[820px]:grid-cols-1">
      <span className="text-sm font-medium text-ink pt-1">{label}</span>
      <div className="flex flex-col gap-1.5 min-w-0">
        {children}
        {hint && <span className="font-mono text-3xs leading-relaxed text-muted">{hint}</span>}
      </div>
    </div>
  );
}

/** One quality, and what this browser writes at it. */
function ChromaAt({ quality }: { quality: number }) {
  const chroma = useBrowserChroma(quality);
  return (
    <span className="grid grid-cols-[3.5rem_3.5rem_minmax(0,1fr)] gap-x-2 font-mono text-xs tabular-nums">
      <span className="text-ink">{Math.round(quality * 100)} %</span>
      <span className={chroma === '4:4:4' ? 'text-ok' : 'text-ink-soft'}>{chroma ?? '…'}</span>
      <span className="text-muted min-w-0 truncate">{chroma ? chromaWords(chroma) : 'measuring'}</span>
    </span>
  );
}

function Encoder() {
  const from = useFullColourFrom();
  const qualities = [0.85, 0.92, 0.99, 1];
  return (
    <>
      <Row
        label="Engine"
        hint="The JPEG writer built into this browser. Its one setting is the quality, set per target in the Export tab: a target at Max (100 %) keeps the colour of every pixel."
      >
        <span className="text-sm text-ink pt-1">This browser’s own</span>
      </Row>
      <Row
        label="Colour it keeps"
        hint={
          from === undefined
            ? 'Measuring, by writing a small picture at each quality and reading its header.'
            : from === null
              ? 'Measured here: this browser never writes full colour. A quarter of the colour is what draws blocks along a saturated edge and in a smooth sky.'
              : `Measured here: full colour from ${Math.round(from * 100)} %. Below, a quarter of the colour, which is what draws blocks along a saturated edge and in a smooth sky.`
        }
      >
        <div className="flex flex-col gap-1 pt-1">
          {qualities.map((q) => (
            <ChromaAt key={q} quality={q} />
          ))}
        </div>
      </Row>
    </>
  );
}

function Rendering() {
  const dither = useDitherPreference();
  const { interpolation, setInterpolation } = useLutInterpolation();
  const bands = useBandPreference();
  const [pixelView, setPixelView] = usePixelView();
  return (
    <>
      <Row
        label="Dither the last rounding"
        hint={
          dither.preference === 'auto'
            ? 'Where more than 8 bits reach the screen or the file (a RAW, or several passes), a noise under half a code breaks the steps of a smooth sky. It never moves an exact value.'
            : 'Off: the last rounding is plain, as before 5 October. Smooth skies from a RAW can show steps.'
        }
      >
        <Segmented
          className="self-start max-w-full"
          size="sm"
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
        hint={
          interpolation === 'tetrahedral'
            ? 'Reads the 4 lattice corners that matter, so greys stay grey: what Resolve uses.'
            : 'Averages all 8 corners: it can tint greys. Look at skies and gradients.'
        }
      >
        <Segmented
          className="self-start max-w-full"
          size="sm"
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
        hint="Past 12 megapixels a picture can be drawn in bands, to spare a phone's GPU memory. The result is the same; a computer has no need of it."
      >
        <Segmented
          className="self-start max-w-full"
          size="sm"
          label="Big pictures"
          value={bands.preference}
          onChange={bands.setPreference}
          options={[
            { id: 'auto', label: `Auto · ${autoBandsMean(deviceClass()) === 'bands' ? 'bands' : 'whole'}` },
            { id: 'whole', label: 'Whole' },
            { id: 'bands', label: 'In bands' },
          ]}
        />
      </Row>
      <Row label="Past 1:1" hint="How a magnified picture is drawn: smooth, or its pixels as pixels to judge noise and edges.">
        <Segmented
          className="self-start max-w-full"
          size="sm"
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
  const [choice, setChoice] = useLocalPref(devicePref, 'auto');
  const [segment, setSegment] = useLocalPref(segmentPref, 'worker');
  // The class is read once per page (`device-class.ts`): a change is said, and applied by a reload.
  const [loaded] = useState(choice);
  const detected = deviceClassFor(readDeviceFacts());
  const word = (c: 'constrained' | 'roomy') => (c === 'constrained' ? 'phone' : 'computer');
  return (
    <>
      <Row
        label="Device class"
        hint={
          <>
            Decides the memory budgets: a phone-class device decodes a RAW to 2560 px on the stage and 4096 px in an
            export, and lets the decoder go after 8 s. This one is detected as a {word(detected)}.
            {choice !== loaded && (
              <>
                {' '}
                <span className="text-accent-ink">Applies when the page reloads.</span>
              </>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            label="Device class"
            value={choice}
            onChange={setChoice}
            options={[
              { id: 'auto', label: `Auto · ${word(detected)}` },
              { id: 'constrained', label: 'Phone' },
              { id: 'roomy', label: 'Computer' },
            ]}
          />
          {choice !== loaded && (
            <Button size="sm" icon={Icons.reset} onClick={() => window.location.reload()}>
              Reload
            </Button>
          )}
        </div>
      </Row>
      <Row label="Subject model" hint="Off only to diagnose: the model then runs on the page and the picture stalls while it thinks. Applies the next time the model loads.">
        <Segmented
          className="self-start max-w-full"
          size="sm"
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
  const lensfun = useLensfunAllowed();
  return (
    <Row label="Lens profiles" hint="Fetches Lensfun's file for a lens's maker the first time a lens is met; only the answer is kept on this device. Off: no request, the manual lens sliders stay.">
      <Segmented
        size="sm"
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

const PANES: Record<SettingsSection, () => ReactNode> = { encoder: Encoder, rendering: Rendering, device: Device, privacy: Network };

export default function DevelopSettingsSheet({ onClose }: { onClose: () => void }) {
  const compact = useIsCompact();
  const [section, setSection] = useLocalPref(settingsSectionPref, 'encoder');
  // On a phone: one pane at a time, the list first (the suite's drill-down
  // rule) — unless the sheet was opened ON a section, which it then shows.
  const [drilled, setDrilled] = useState(openedOnSection);
  useDialogKeys({ onCancel: onClose });
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
          {!compact && <span className="font-mono text-3xs text-muted">On this device only</span>}
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
            <nav aria-label="Sections" className={`flex-none flex flex-col gap-0.5 p-2 overflow-y-auto bg-paper-2 ${compact ? 'flex-1' : 'w-56 border-r border-line'}`}>
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
                      <span className="font-mono text-3xs text-muted">{s.sub}</span>
                    </span>
                    {compact && <span className="inline-flex text-muted">{Icons.forward}</span>}
                  </button>
                );
              })}
              {compact && <p className="m-0 mt-3 px-3 font-mono text-3xs leading-relaxed text-muted">Kept on this device. Never on a roll, a preset or a paste.</p>}
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
