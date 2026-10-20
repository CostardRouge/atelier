import { useRef, useState, type ReactNode } from 'react';
import DevelopFold from './DevelopFold';
import { autoBands, autoColour, autoTone, describeAutoBands, describeAutoTone, type SourceStats } from './auto-develop';
import { developLinkClass } from './develop-classes';
import { RangeSlider } from './DevelopSliders';
import {
  MAX_LEVEL_GAMMA,
  MIN_LEVEL_GAMMA,
  NEUTRAL_LEVEL,
  isNeutralLevel,
  type LevelChannel,
  type Levels,
} from './curves';
import type { AutoState, AutoVerb } from './auto-slots';
import AutoSwitch, { AUTO_SWITCH_TITLE } from './AutoSwitch';
import { Icons } from '../ui/icons';
import { AnchoredPopover } from '../ui/OverflowMenu';
import { PRESS_LOOK } from '../ui/press';
import { useVerb } from '../ui/use-verb';
import { VERB_INK, VERB_SHAPE, VerbHairline, verbAttrs } from '../ui/VerbMarks';
import type { AutoMemory } from './use-auto-memory';
import type { AutoAllVerb } from './use-auto-all';

const AUTO_HINT =
  'Tone reads where the picture’s light actually sits and writes a black point, a white point and a midtone gamma into Levels — it touches no colour. Colour neutralises the AVERAGE cast, which is the wrong answer on a sunset or a candle-lit room, so it is a second button and never rides along with the first. Pick grey asks you instead: click something in the picture that ought to be neutral and the white balance is solved for that, which beats the average whenever the picture is not an average scene. Bands is the third answer: where a tenth of the picture sits against black it lifts Shadows, where a tenth sits against white it pulls Highlights down — a compression of the ends where Tone is a stretch, so the two stay separate buttons. All of them are measured on the picture as shot, so pressing one twice gives the same answer rather than compounding.';

const ALL_HINT =
  'Auto runs the steps ticked in Settings › Automatic — tone, bands and detail until you say otherwise, colour, level and upright when you tick them — each through its own switch, so any one can be taken back alone afterwards. It can also run by itself the first time an untouched photograph opens, if that setting is on.';

const SWITCH_HINT =
  'Each one is a switch: a second click puts back what its own sliders held before it, and leaves the others alone. Lit, it still holds its answer; dashed, it found nothing to change; half-lit, you moved its sliders since. Colour and Pick grey share the white balance — the newer replaces the older, and turning it off gives back the balance from before either.';

const OWN_HINT =
  'My own asks the model learned from your rolls (Settings › Learning) for the eleven sliders at once — exposure to vibrance, as your hand would set them on this picture — and writes them as one switch, so a second click puts the eleven back. It reads the picture as shot, its light and the camera’s facts, the same three things the training file carries; the runtime is fetched from this site the first time it is pressed, and nothing leaves.';

/** The verb of his own model, as the host runs it (`own-model-run.ts`); absent, no model is loaded. */
export interface OwnModelVerb {
  state: AutoState;
  /** `20261013-091200-develop-mine` — the run that answers, for the title. */
  run: string;
  onClick: () => Promise<void>;
}

const LEVELS_HINT =
  'Where the range is read FROM: everything at or under black becomes black, everything at or over white becomes white, and gamma bends what is between them. Auto tone writes these three; the curve’s own end points do the same thing by hand.';

/** The Auto row's three verbs that write the develop, by name — `Auto` runs them through here too. */
export type DevelopAutoVerb = Extract<AutoVerb, 'tone' | 'colour' | 'bands'>;

/**
 * One of the row's verbs run over the stats, through the memory, with its
 * told line — the same closure the button and the `Auto` switch call, so the
 * two can never disagree about what a verb writes.
 */
export function runAutoVerb(verb: DevelopAutoVerb, stats: SourceStats, auto: AutoMemory): void {
  if (verb === 'tone') {
    const levels = autoTone(stats);
    auto.apply('tone', { levels }, levels ? `auto tone · ${describeAutoTone(levels)}` : 'nothing to stretch');
    return;
  }
  if (verb === 'colour') {
    const { temperature, tint, clamped } = autoColour(stats);
    auto.apply(
      'colour',
      { temperature, tint },
      !temperature && !tint ? 'already neutral' : `auto colour · temperature ${temperature}, tint ${tint}` + (clamped ? ' · as far as the sliders reach' : ''),
    );
    return;
  }
  // Nothing to recover still SETS the two bands to zero: a verb that leaves a
  // stale value where it found no reason for one is a nudge.
  const bands = autoBands(stats);
  auto.apply('bands', { highlights: bands?.highlights ?? 0, shadows: bands?.shadows ?? 0 }, bands ? `auto bands · ${describeAutoBands(bands)}` : 'nothing to recover');
}

/** What a verb's row says beside its switch, by state. */
const STATE_WORD: Readonly<Record<AutoState, string>> = {
  off: '',
  on: 'on',
  nothing: 'changed nothing',
  edited: 'moved since',
};

/** One verb as the menu draws it. */
interface MenuVerb {
  id: string;
  /** Its row's name. */
  label: string;
  /** Its word in the bar's summary. */
  short: string;
  glyph: ReactNode;
  hint: string;
  state: AutoState;
  /** A tool waiting for the picture (Pick grey's dropper). */
  armed?: boolean;
  /** Arms a tool rather than measuring the picture: answers at once. */
  instant?: boolean;
  disabled: boolean;
  onClick: () => void | Promise<unknown>;
}

/** The switch drawn at a row's end: a `ToggleField`'s, with the row's four states. */
function SwitchMark({ state }: { state: AutoState }) {
  const track =
    state === 'on'
      ? 'bg-accent'
      : state === 'edited'
        ? 'bg-accent/45'
        : state === 'nothing'
          ? 'bg-paper-2 outline-dashed outline-1 -outline-offset-1 outline-muted'
          : 'bg-line-strong';
  return (
    <span aria-hidden className={`relative flex-none w-9 h-5 rounded-full ${track}`}>
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface shadow-[0_1px_2px_rgba(27,24,19,0.25)] transition-transform duration-150 ease-paper ${
          state === 'off' ? '' : 'translate-x-4'
        }`}
      />
    </span>
  );
}

/**
 * One verb of the menu: the whole line is the switch, so a finger takes it
 * anywhere on its 44 px. A verb that measures and re-renders lives as a verb
 * (`useVerb`), down while it works, exactly as the old pill did.
 */
function AutoMenuRow({ verb, echo }: { verb: MenuVerb; echo: string | null }) {
  const run = useVerb();
  const held = verb.armed || verb.state !== 'off';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={held}
      disabled={verb.disabled}
      title={verb.armed ? undefined : verb.state === 'off' ? verb.hint : AUTO_SWITCH_TITLE[verb.state]}
      className={`relative flex items-center gap-2.5 min-h-10 pointer-coarse:min-h-11 px-2 border-0 rounded-[9px] bg-transparent text-left cursor-pointer hover:bg-paper-2 disabled:opacity-50 disabled:cursor-default transition-colors duration-150 ease-paper ${PRESS_LOOK} data-pressed:bg-paper-2 ${VERB_SHAPE} ${VERB_INK}`}
      {...verbAttrs(run.phase)}
      onClick={() => (verb.instant ? void verb.onClick() : run.run(async () => void (await verb.onClick()), { echo }))}
    >
      <span className="flex-none text-muted [&>svg]:w-4 [&>svg]:h-4">{verb.glyph}</span>
      <span className="min-w-0 text-sm text-ink truncate">{verb.label}</span>
      <span className={`ml-auto flex-none font-mono text-2xs whitespace-nowrap ${verb.armed ? 'text-accent-ink' : 'text-muted'}`}>
        {verb.armed ? 'click the picture' : STATE_WORD[verb.state]}
      </span>
      <SwitchMark state={verb.armed ? 'on' : verb.state} />
      <VerbHairline phase={run.phase} />
    </button>
  );
}

/**
 * Auto — ONE bar, its verbs in a menu (2026-10-20, his pick D of the Auto row
 * lab https://claude.ai/artifact/Wy9RR2chSzhYEXXYgAZhRN): the row of pills
 * wrapped onto a second line in a 22rem inspector and onto a third at 18rem.
 * The bar is as wide as the panel whatever the verbs: its left half runs the
 * plan (`all`), its summary names the verbs that still hold their answer, and
 * the ▾ opens every verb as a switch on its own line.
 *
 * Splitting tone from colour is still the whole design: a stretch is almost
 * always an improvement, and a white balance is often exactly wrong, so they
 * never share a click. Each is a SWITCH taken back alone (`auto-slots.ts`,
 * `use-auto-memory.ts`). The maths and the reasons are in `auto-develop.ts`.
 */
export function DevelopAutoSection({
  stats,
  auto,
  all,
  own,
  picking,
  onPicking,
  echo = null,
}: {
  stats: SourceStats | null;
  /** The row's memory of its clicks, held by the host per picture (`useAutoMemory`). */
  auto: AutoMemory;
  /** The one `Auto` running the plan's steps (`use-auto-all.ts`); omitted, the bar only opens the menu. */
  all?: AutoAllVerb;
  /** His own model's verb; omitted, this device holds no model and the switch is not drawn. */
  own?: OwnModelVerb;
  /** Whether the eyedropper is armed; omitted, no dropper is drawn. */
  picking?: boolean;
  onPicking?: (on: boolean) => void;
  /** The task scope of the picture on the stage: a verb's re-render echoes on its edge (C4). */
  echo?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const ready = Boolean(stats && stats.total > 0);
  const notRead = 'the picture has not been read yet';

  const toggle = (verb: DevelopAutoVerb) => {
    if (auto.turnOff(verb) || !stats) return;
    runAutoVerb(verb, stats, auto);
  };

  const measured = (
    verb: DevelopAutoVerb,
    label: string,
    glyph: ReactNode,
    hint: string,
  ): MenuVerb => {
    const state = auto.state(verb);
    return { id: verb, label, short: label, glyph, hint: ready ? hint : notRead, state, disabled: !ready && state === 'off', onClick: () => toggle(verb) };
  };

  const verbs: MenuVerb[] = [
    measured('tone', 'Tone', Icons.levels, 'A black point, a white point and a midtone gamma, written into Levels'),
    measured('colour', 'Colour', Icons.whiteBalance, 'Neutralise the average cast'),
    measured('bands', 'Bands', Icons.squeeze, 'Lift the shadows and pull the highlights down where the picture leans'),
  ];
  if (own) {
    verbs.push({
      id: 'own',
      label: 'My own',
      short: 'Mine',
      glyph: Icons.person,
      hint: ready ? `The eleven sliders as your model (${own.run}) would set them` : notRead,
      state: own.state,
      disabled: !ready && own.state === 'off',
      onClick: own.onClick,
    });
  }
  if (onPicking) {
    const state = auto.state('pick');
    verbs.push({
      id: 'pick',
      label: 'Pick grey',
      short: 'Grey',
      glyph: Icons.eyedropper,
      hint: ready ? 'Click something in the picture that should be grey' : notRead,
      state,
      armed: picking,
      instant: true,
      disabled: !ready && state === 'off' && !picking,
      onClick: () => {
        if (!picking && auto.turnOff('pick')) return;
        onPicking(!picking);
        // The dropper waits for the PICTURE, which the menu would cover.
        if (!picking) setOpen(false);
      },
    });
  }

  const summary = picking ? 'click something grey' : verbs.filter((v) => v.state !== 'off').map((v) => v.short).join(' · ');
  const summaryText = summary && (
    <span className={`ml-auto min-w-0 truncate font-mono text-2xs font-normal ${picking ? 'text-accent-ink' : 'text-muted'}`}>{summary}</span>
  );

  return (
    // One bar: not worth a fold, but drawn with the same header as the
    // foldable sections under it.
    <DevelopFold
      id="auto"
      title="Auto"
      info={
        <>
          {all && <p>{ALL_HINT}</p>}
          <p>{AUTO_HINT}</p>
          {own && <p>{OWN_HINT}</p>}
          <p>{SWITCH_HINT}</p>
        </>
      }
      foldable={false}
    >
      <div ref={barRef} className="flex min-w-0">
        {all ? (
          <AutoSwitch
            shape="bar"
            state={all.state}
            disabled={!ready && all.state === 'off'}
            hint={ready ? all.hint : notRead}
            echo={echo}
            onClick={all.onClick}
          >
            <span className="flex-none [&>svg]:w-4 [&>svg]:h-4">{Icons.wand}</span>
            Auto
            {summaryText}
          </AutoSwitch>
        ) : (
          <button
            type="button"
            className={`relative flex-1 min-w-0 inline-flex items-center gap-1.5 h-9 pointer-coarse:h-11 px-3 border border-line-strong rounded-l-control bg-paper text-sm font-semibold text-ink-soft whitespace-nowrap cursor-pointer hover:text-accent-ink ${PRESS_LOOK} data-pressed:bg-paper-2`}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((on) => !on)}
          >
            <span className="flex-none [&>svg]:w-4 [&>svg]:h-4">{Icons.wand}</span>
            Auto
            {summaryText}
          </button>
        )}
        <button
          type="button"
          aria-label="The Auto verbs"
          title="The Auto verbs, one by one"
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`touch-row relative flex-none grid place-items-center w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11 -ml-px border border-line-strong rounded-r-control cursor-pointer transition-colors duration-150 ease-paper ${PRESS_LOOK} data-pressed:bg-paper-2 [&>svg]:w-4 [&>svg]:h-4 ${
            open ? 'bg-paper-2 text-ink' : 'bg-paper text-ink-soft hover:text-accent-ink'
          }`}
          onClick={() => setOpen((on) => !on)}
        >
          {Icons.down}
        </button>
      </div>
      {open && (
        <AnchoredPopover
          anchorRect={() => barRef.current?.getBoundingClientRect() ?? null}
          onClose={() => setOpen(false)}
          within={barRef}
          role="dialog"
          label="The Auto verbs"
          className="w-[min(20rem,calc(100vw-2rem))] p-1.5"
        >
          {verbs.map((verb) => (
            <AutoMenuRow key={verb.id} verb={verb} echo={echo} />
          ))}
          {all && <p className="m-0 px-2 pt-2 pb-1 border-t border-line mt-1 text-xs leading-relaxed text-muted">{all.hint}</p>}
        </AnchoredPopover>
      )}
    </DevelopFold>
  );
}

const LEVEL_KEYS = ['inBlack', 'gamma', 'inWhite'] as const;
type LevelKey = (typeof LEVEL_KEYS)[number];

const LEVEL_LABELS: Readonly<Record<LevelKey, string>> = {
  inBlack: 'Black',
  gamma: 'Gamma',
  inWhite: 'White',
};

/**
 * The three numbers Auto tone writes, so they can be seen and moved.
 *
 * The master channel only: per-channel levels exist in the engine but setting
 * them by hand is a white balance done the hard way, and the curve's own R, G
 * and B tabs are the better tool for it.
 */
export function DevelopLevelsSection({
  value,
  onChange,
}: {
  value: Levels | null | undefined;
  onChange: (levels: Levels | null) => void;
}) {
  const level: LevelChannel = value?.rgb ?? { ...NEUTRAL_LEVEL };

  const write = (key: LevelKey, raw: number) => {
    const next: LevelChannel = { ...level, [key]: raw };
    // Black and white may not cross: a range read backwards is a threshold,
    // and `normaliseLevel` would throw the whole channel away.
    if (key === 'inBlack') next.inBlack = Math.min(raw, level.inWhite - 1 / 255);
    if (key === 'inWhite') next.inWhite = Math.max(raw, level.inBlack + 1 / 255);
    const rgb = isNeutralLevel(next) ? null : next;
    const empty = !rgb && !value?.red && !value?.green && !value?.blue;
    onChange(empty ? null : { rgb, red: value?.red ?? null, green: value?.green ?? null, blue: value?.blue ?? null });
  };

  const set = Boolean(value?.rgb || value?.red || value?.green || value?.blue);
  return (
    <DevelopFold id="levels" title="Levels" info={<p>{LEVELS_HINT}</p>} marked={set} defaultOpen={false}>
      {LEVEL_KEYS.map((key) =>
        key === 'gamma' ? (
          <RangeSlider
            key={key}
            label={LEVEL_LABELS[key]}
            value={level.gamma}
            range={{ min: MIN_LEVEL_GAMMA, max: MAX_LEVEL_GAMMA, step: 0.01, unit: '' }}
            reset={1}
            printed={level.gamma.toFixed(2)}
            onChange={(v) => write(key, v)}
          />
        ) : (
          <RangeSlider
            key={key}
            label={LEVEL_LABELS[key]}
            // Shown in the 0..255 codes a photographer reads, stored in [0,1].
            value={Math.round(level[key] * 255)}
            range={{ min: 0, max: 255, step: 1, unit: '' }}
            reset={key === 'inBlack' ? 0 : 255}
            printed={String(Math.round(level[key] * 255))}
            onChange={(v) => write(key, v / 255)}
          />
        ),
      )}
      {!isNeutralLevel(value?.rgb) && (
        <button
          type="button"
          className={`${developLinkClass} self-start`}
          onClick={() =>
            onChange(
              value?.red || value?.green || value?.blue
                ? { rgb: null, red: value.red, green: value.green, blue: value.blue }
                : null,
            )
          }
        >
          Reset levels
        </button>
      )}
    </DevelopFold>
  );
}
