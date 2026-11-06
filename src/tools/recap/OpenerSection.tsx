import { useMemo } from "react";
import {
  withRecap,
  type RecapDoc,
  type RecapPicture,
} from "../../shared/recap/recap-doc";
import {
  OPENER_HINT,
  OPENER_LABEL,
  OPENER_SECONDS,
  openerSecondsFor,
  type OpenerKind,
  type RecapOpener,
} from "../../shared/recap/recap-opener";
import {
  shownPictures,
  type OpenerPlan,
} from "../../shared/recap/recap-opener-plan";
import type { ResolvedRecap } from "../../shared/recap/recap-slots";
import {
  EASINGS,
  EASING_IDS,
  type HookEasing,
} from "../../shared/roadtrip/hooks/easing";
import type { WinnowClient } from "../../shared/sources/winnow/client";
import Button from "../../shared/ui/Button";
import {
  InspectorSection,
  SliderRow,
  TextField,
  ToggleField,
} from "../../shared/ui/Inspector";
import Segmented from "../../shared/ui/Segmented";
import { Icons } from "../../shared/ui/icons";
import PictureThumb from "./PictureThumb";
import type { Change } from "./RecapPanels";

const legend = "font-mono text-2xs tracking-[0.14em] uppercase text-muted";
/** The kinds offered here; Virée and Itinerary join when a trip of Trips covers the recap's days. */
const OFFERED: readonly OpenerKind[] = ["none", "defile", "badge"];
/** How many of the recap's pictures the Badge offers to choose from. */
const BADGE_CHOICES = 24;

/**
 * The opener (lab 7): the first seconds of the Reel, before the recap's own
 * first page — Trips' Défilé and Badge. One choice, then only what that
 * choice reads; ▶ plays the film from its first second.
 */
export default function OpenerSection({
  doc,
  resolved,
  change,
  plan,
  client,
  instance,
  files,
  onPlay,
}: {
  doc: RecapDoc;
  resolved: ResolvedRecap;
  change: Change;
  plan: OpenerPlan | null;
  client: WinnowClient | null;
  instance: string | null;
  files: ReadonlyMap<string, File>;
  onPlay: () => void;
}) {
  const o = doc.opener;
  const set = (patch: Partial<RecapOpener>) =>
    change((d) => withRecap(d, { opener: { ...d.opener, ...patch } }));
  const choose = (kind: OpenerKind) =>
    set({
      kind,
      ...(kind !== "none" && kind !== o.kind
        ? { seconds: openerSecondsFor(kind) }
        : {}),
    });
  const photos = useMemo(
    () =>
      shownPictures(resolved)
        .filter((p) => p.kind === "photo")
        .slice(0, BADGE_CHOICES),
    [resolved],
  );
  const chosen = plan?.kind === "badge" ? plan.key : null;
  const thumb = (p: RecapPicture) => (
    <PictureThumb
      pic={p}
      client={client}
      instance={instance}
      file={files.get(p.key) ?? null}
      className="absolute inset-0 w-full h-full"
    />
  );

  return (
    <InspectorSection id="recap-opener" title="Opener">
      <div className="flex flex-col gap-2">
        <Segmented<OpenerKind>
          size="sm"
          fill
          label="Opener"
          value={OFFERED.includes(o.kind) ? o.kind : "none"}
          onChange={choose}
          options={OFFERED.map((k) => ({ id: k, label: OPENER_LABEL[k] }))}
        />
        <p className="m-0 text-xs text-muted">{OPENER_HINT[o.kind]}</p>
        {o.kind === "defile" && !plan && (
          <p className="m-0 text-xs text-muted">
            It needs two pictures on the recap at least.
          </p>
        )}
        {o.kind !== "none" && (
          <>
            <SliderRow
              label={o.kind === "badge" ? "Holds" : "Runs"}
              value={o.seconds}
              min={OPENER_SECONDS.min}
              max={OPENER_SECONDS.max}
              step={0.1}
              reset={openerSecondsFor(o.kind)}
              format={(v) => `${v.toFixed(1)} s`}
              onChange={(seconds) => set({ seconds })}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={Icons.play}
              onClick={onPlay}
              title="Play the film from its first second"
            >
              Play the opener
            </Button>
          </>
        )}
        {o.kind === "defile" && (
          <>
            <span className={legend}>How it slows</span>
            <Segmented<HookEasing>
              size="sm"
              columns={3}
              label="How the pictures slow"
              value={o.easing}
              onChange={(easing) => set({ easing })}
              options={EASING_IDS.map((k) => ({
                id: k,
                label: EASINGS[k].label,
                title: EASINGS[k].hint,
              }))}
            />
            <ToggleField
              checked={o.tape}
              onChange={(tape) => set({ tape })}
              label="The tape of the days"
            >
              The tape of the days
            </ToggleField>
            <ToggleField
              checked={o.ticks}
              onChange={(ticks) => set({ ticks })}
              label="A tick at every picture"
            >
              A tick at every picture
            </ToggleField>
          </>
        )}
        {o.kind === "badge" && (
          <>
            <span className={legend}>The picture</span>
            <div className="max-h-44 overflow-y-auto [scrollbar-width:thin]">
              <div
                className="grid grid-cols-6 gap-1 p-0.5"
                role="listbox"
                aria-label="The Badge's picture"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={o.picture === null}
                  onClick={() => set({ picture: null })}
                  title="The recap's best picture: picked, then starred"
                  className={`relative aspect-square rounded-[4px] border font-mono text-3xs uppercase ${o.picture === null ? "border-accent text-accent-ink bg-accent/10" : "border-line text-muted bg-transparent"}`}
                >
                  Best
                </button>
                {photos.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="option"
                    aria-selected={chosen === p.key}
                    onClick={() => set({ picture: p.key })}
                    title={p.name}
                    className={`relative aspect-square overflow-hidden rounded-[4px] p-0 border-0 ${chosen === p.key ? "outline outline-2 outline-accent" : "outline outline-1 outline-line"}`}
                  >
                    {thumb(p)}
                  </button>
                ))}
              </div>
            </div>
            <span className={legend}>It says</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <ToggleField
                checked={o.lines.date}
                onChange={(date) => set({ lines: { ...o.lines, date } })}
                label="Its day"
              >
                Its day
              </ToggleField>
              <ToggleField
                checked={o.lines.place}
                onChange={(place) => set({ lines: { ...o.lines, place } })}
                label="Its place"
              >
                Its place
              </ToggleField>
              <ToggleField
                checked={o.lines.camera}
                onChange={(camera) => set({ lines: { ...o.lines, camera } })}
                label="Its camera"
              >
                Its camera
              </ToggleField>
            </div>
            <TextField
              value={o.title ?? ""}
              onChange={(v) =>
                set({ title: v.trim() ? v.slice(0, 120) : null })
              }
              label="The Badge's big line"
              placeholder={
                plan?.kind === "badge" && plan.title
                  ? plan.title
                  : "Its place, else the title"
              }
            />
          </>
        )}
        {(o.kind === "badge" || o.kind === "drive" || o.kind === "map") && (
          <ToggleField
            checked={o.slide}
            onChange={(slide) => set({ slide })}
            label="Also the carousel's first slide"
          >
            Also the carousel's first slide
          </ToggleField>
        )}
      </div>
    </InspectorSection>
  );
}
