import DevelopFold from '../../shared/develop/DevelopFold';
import { RangeSlider } from '../../shared/develop/DevelopSliders';
import { developLinkClass } from '../../shared/develop/develop-classes';
import { DEFAULT_LENS, isDefaultLens, type LensCorrection } from '../../shared/render/lens';
import Button from '../../shared/ui/Button';
import { describeProfileParts, type LensProfileApplied } from '../../shared/lens/lens-profile';
import type { LookUp } from '../../shared/lens/lensfun-store';
import { LENSFUN_LICENCE } from '../../shared/lens/lensfun-source';

/** What the Profile block knows and can do. */
export interface LensProfileView {
  /** On the picture: `undefined` never decided, `null` taken off. */
  applied: LensProfileApplied | null | undefined;
  /** Whether the stored profile draws on this picture as it is now developed. */
  inEffect: boolean;
  lookup: LookUp | null;
  looking: boolean;
  allowed: boolean;
  onSensor: boolean;
  /** What applying would put on the picture now. */
  candidate: LensProfileApplied | null;
  onApply: () => void;
  onRemove: () => void;
  onAllow: () => void;
}

const fNumber = (n: number | null) => (n ? ` · f/${+n.toFixed(1)}` : '');

/** The measured profile: what is on the picture, or what can be. */
function ProfileBlock({ p }: { p: LensProfileView }) {
  const line = (text: string) => <span className="font-mono text-3xs text-faint leading-relaxed">{text}</span>;
  if (p.applied) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="flex-1 min-w-0 font-mono text-2xs text-ink truncate" title={p.applied.lens}>
            {p.applied.lens} · {+p.applied.focal.toFixed(1)} mm{fNumber(p.applied.aperture)}
          </span>
          <button type="button" className={developLinkClass} onClick={p.onRemove}>
            Remove
          </button>
        </div>
        {line(
          p.inEffect
            ? `corrects ${describeProfileParts(p.applied.has)} · ${LENSFUN_LICENCE}`
            : 'kept for the sensor — this camera render is not corrected by it, the body may have done so already',
        )}
      </div>
    );
  }
  const offer = p.candidate && (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 font-mono text-2xs text-ink truncate">{p.candidate.lens}</span>
        <Button size="sm" variant="ghost" onClick={p.onApply}>
          {p.onSensor ? 'Apply' : 'Apply to this render'}
        </Button>
      </div>
      {line(
        p.onSensor
          ? p.applied === null
            ? 'taken off this picture — apply it again if you want it back'
            : `found in Lensfun · ${describeProfileParts(p.candidate.has)}`
          : 'this is the camera’s render, which the body may have corrected already — look at a straight edge before applying',
      )}
    </div>
  );
  if (offer) return offer;
  if (!p.lookup) return p.looking ? line('looking the lens up…') : line('the picture says nothing about its camera');
  switch (p.lookup.kind) {
    case 'not-allowed':
      return (
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="ghost" onClick={p.onAllow}>
            Look lenses up in Lensfun
          </Button>
          {line('asks raw.githubusercontent.com for Lensfun’s file of your camera maker — once per lens, kept on this device')}
        </div>
      );
    case 'offline':
      return line('Lensfun could not be reached — the sliders below still correct by eye');
    case 'missing':
      return line(
        p.lookup.why === 'no-exif'
          ? 'the picture does not say its camera and focal length'
          : p.lookup.why === 'camera'
            ? 'this camera is not in Lensfun yet — the sliders below correct by eye'
            : 'this lens is not in Lensfun yet — the sliders below correct by eye',
      );
    default:
      return null;
  }
}

const HINT =
  'A wide lens bows straight lines outwards (barrel) and a long one pinches them in (pincushion); Distortion takes that back out, and Secondary is the one a “moustache” curve needs, where the middle of the frame bends the other way from the corners. Fringing scales red and blue against green, which is what removes the coloured edges on high-contrast subjects near the corners. Vignetting lifts the corners a lens darkened, and Falls off says how much of the middle stays untouched. All of it is radial — measured from the centre of the frame — so it runs BEFORE the perspective correction, which needs straight lines to make parallel.';

const PROFILES =
  'A PROFILE is measured calibration data for one lens, from Lensfun — an open database people build by photographing targets. When you allow it, the lens a picture names is looked up there the first time it is met: your camera maker’s file, and the independent lens makers’ only if the lens is not in the first. Only the answer is kept on this device, never the database, and nothing about your pictures is sent. A profile applies by itself to a picture developed from its SENSOR; a camera’s own JPEG — and the render inside a RAW — is often corrected in the body already, so there it is only offered. The sliders below correct what the profile leaves, by eye, and work on any lens.';

const KEYS = [
  { key: 'distortion', label: 'Distortion', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'distortion2', label: 'Secondary', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'chromaRed', label: 'Fringing, red', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'chromaBlue', label: 'Fringing, blue', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'vignette', label: 'Vignetting', min: -100, max: 100, step: 1, reset: 0 },
  { key: 'vignetteMidpoint', label: 'Falls off', min: 0, max: 100, step: 1, reset: 50 },
] as const;

/**
 * The lens correction — distortion, fringing and vignetting.
 *
 * It sits beside the perspective on the Crop tab: both are about the SHAPE of
 * the picture rather than its light, and the order between them matters and is
 * easier to hold when they are together. The maths is `shared/render/lens.ts`.
 */
export default function LensPanel({
  value,
  onChange,
  profile,
}: {
  value: LensCorrection | null;
  onChange: (lens: LensCorrection | null) => void;
  /** The measured profile (Lensfun) — absent where a host offers none. */
  profile?: LensProfileView;
}) {
  const lens: LensCorrection = value ?? { ...DEFAULT_LENS };
  const write = (key: keyof LensCorrection, v: number) => {
    const next: LensCorrection = { ...lens, [key]: v };
    // Stored as null the moment it does nothing — a midpoint on its own only
    // says WHERE a lift would bite, so it is not a correction.
    onChange(isDefaultLens(next) ? null : next);
  };

  const touched = !isDefaultLens(value);
  return (
    <DevelopFold
      id="lens"
      title="Lens"
      marked={touched || Boolean(profile?.inEffect)}
      info={
        <>
          <p>{HINT}</p>
          <p>{PROFILES}</p>
          <p>Corrected before the perspective, and before the crop.</p>
        </>
      }
      actions={
        touched ? (
          <button type="button" className={developLinkClass} onClick={() => onChange(null)}>
            Reset
          </button>
        ) : undefined
      }
    >
      {profile && <ProfileBlock p={profile} />}
      {KEYS.map((k) => (
        <RangeSlider
          key={k.key}
          label={k.label}
          value={lens[k.key]}
          range={{ min: k.min, max: k.max, step: k.step, unit: '' }}
          reset={k.reset}
          onChange={(v) => write(k.key, v)}
        />
      ))}
    </DevelopFold>
  );
}
