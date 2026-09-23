import { LONG_EDGE_CHOICES, longEdgeChoiceId, type DeliverySummary } from '../../shared/develop/roll-export';
import { ROLL_EXPORT_LIMITS, type RollExport } from '../../shared/develop/roll-types';
import type { RunPlan } from '../../shared/develop/run-plan';
import Button from '../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField, SelectField, SwitchRow } from '../../shared/ui/Inspector';
import { Icons } from '../../shared/ui/icons';
import { hdrSupport } from '../../shared/hdr/hdr-display';
import { formatBytes } from '../../shared/lib/format';
import { heldCeilingBytes } from '../../shared/sources/original-cache';
import type { RollRun } from './use-roll-export';

const HDR_STOPS: readonly { id: string; label: string }[] = [
  { id: '1', label: '1 stop' },
  { id: '2', label: '2 stops' },
  { id: '3', label: '3 stops' },
  { id: '4', label: '4 stops' },
];

/** The last run's HDR outcome in one line, or null when none was asked. */
function describeHdrRun(hdr: RollRun['hdr']): string | null {
  if (!hdr) return null;
  if (hdr.asked === 0) return 'no picture in the run was developed on its RAW, so none carried a gain map';
  const head = `${hdr.ultra} of ${hdr.asked} left as Ultra HDR`;
  if (hdr.ultra === 0) return `${head} — the others had nothing above white`;
  const reach = ` · up to ${hdr.headroom.toFixed(1)} stops above white`;
  const check = hdr.checked !== null ? ` · read back within ${hdr.checked.toFixed(2)} stops` : '';
  return head + reach + check;
}

/** One export verb: what it renders, and how many. */
export interface ExportVerb {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * The Develop tool's Export tab: the roll's delivery settings (a long edge,
 * the JPEG quality), what the RUN will deliver picture by picture, the
 * *This picture* line for the one in hand — the calculator of
 * `docs/develop-originals.md` in one sentence — and the verbs.
 *
 * Which PIXELS a picture leaves from is no longer asked here (2026-09-21,
 * `docs/capture-renditions.md` §13.2): the picture's own rendition, chosen
 * above the photograph, answers, and the one thing the door still says is
 * *proxies only, for this run* — which never touches the roll.
 *
 * A roll delivers to the FILE SYSTEM only. Sending the finals home to the
 * instance is unplugged on purpose: Winnow's upload route files an upload
 * into the incoming as a new capture, so nothing would reach the Gallery and
 * nothing would be linked to the capture it was developed from.
 */
export default function ExportPanel({
  settings,
  onSettings,
  delivery,
  plan,
  proxiesOnly,
  onProxiesOnly,
  verbs,
  exporting,
  note,
  hdrRun = null,
}: {
  settings: RollExport;
  onSettings: (patch: Partial<RollExport>) => void;
  /** What the open picture will deliver, or null until it is measured. */
  delivery: DeliverySummary | null;
  /** What the whole run will deliver, and the bytes it costs. */
  plan: RunPlan;
  /** *Proxies only, for this run* — a run-time choice, never on the roll. */
  proxiesOnly: boolean;
  onProxiesOnly: (on: boolean) => void;
  verbs: readonly ExportVerb[];
  exporting: string | null;
  note: string | null;
  /** The last run's HDR outcome — the one part of the run the panel still shows. */
  hdrRun?: RollRun['hdr'];
}) {
  const { quality } = ROLL_EXPORT_LIMITS;
  return (
    <>
      <InspectorSection
        id="develop.export"
        title="Export"
        info={
          <>
            <p>
              Each picture is decoded at its own size, developed under the roll’s look, cropped as the
              Crop tab shows it and written as a JPEG. The size is a ceiling on the long edge — a
              picture is never upscaled to reach it.
            </p>
            <p>
              A picture leaves carrying the ORIGINAL’s EXIF — its position, its body, its lens, the
              hour it was taken — whatever its pixels were taken from, so a file developed on a proxy
              still reads like the capture. Only three tags are corrected: the way up, the size, and
              the thumbnail, which would otherwise show the picture before you developed it.
            </p>
            <p>
              Which pixels a picture leaves from is the picture’s own answer, chosen above the
              photograph: its RAW when it is developed on the sensor, the file it was set to, else
              where it opens — and a proxy’s full-size original is still fetched where the proxy
              could not fill the frame asked for. <strong>Delivers</strong> says what that means for
              the run before anything is fetched; <strong>Proxies only</strong> makes every picture
              leave from what is in hand, for this run alone — a RAW base is set aside and said.
              Fetched files are kept for this session only, up to {formatBytes(heldCeilingBytes())} on
              this device; past that the ones least recently used are let go and fetched again when
              a picture needs them.
            </p>
            <p>
              A picture developed on its <strong>RAW</strong> leaves from the sensor’s data, and the
              export climbs to the top rung of calibration its own file carries — the gain map and
              the rectilinear warp the body was measured for. It never crosses from the proxy to
              the sensor by itself: numbers nobody has seen on the sensor’s data are never applied
              to it at the door.
            </p>
            <p>
              A <strong>RAW</strong> original is a special case for PIXELS too: no browser decodes a sensor plane,
              so all that can be taken from one is the render its camera wrote inside it — which on
              a DJI is 960 × 540, smaller than the proxy. Its real size is read from the file’s head
              before anything is fetched, and the LARGER of that render and the proxy delivers. The
              whole RAW is pulled only when its render genuinely has more pixels than the proxy and
              the frame needs them. To deliver from the sensor itself, climb the picture’s own
              ladder — the chip above the photograph.
            </p>
          </>
        }
      >
        <FieldRow label="Size">
          <SelectField
            label="Long edge"
            value={longEdgeChoiceId(settings.longEdge)}
            options={LONG_EDGE_CHOICES.map((c) => ({ id: c.id, label: c.label }))}
            onChange={(id) => onSettings({ longEdge: LONG_EDGE_CHOICES.find((c) => c.id === id)?.longEdge ?? null })}
          />
        </FieldRow>
        <FieldRow label="Quality">
          <RangeField
            label="JPEG quality"
            min={quality.min}
            max={quality.max}
            step={0.01}
            value={settings.quality}
            onChange={(q) => onSettings({ quality: q })}
            format={(v) => `${Math.round(v * 100)} %`}
          />
        </FieldRow>
        <FieldRow label="Delivers" align="start">
          {/* The run's sentence, and every picture's line behind it — read-only:
              editable here it would be the choice above the photograph a second time. */}
          <div className="flex flex-col gap-1 min-w-0 pt-1">
            <span className="font-mono text-sm tabular-nums leading-snug text-ink">{plan.summary}</span>
            {plan.pictures.length > 0 && (
              <details className="min-w-0">
                <summary className="cursor-pointer font-mono text-3xs text-faint select-none">picture by picture</summary>
                <ul className="m-0 mt-1 p-0 list-none flex flex-col gap-0.5">
                  {plan.pictures.map((p) => (
                    <li key={p.id} className="font-mono text-3xs text-ink-soft leading-relaxed break-words">
                      {p.line}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </FieldRow>
        <SwitchRow
          label="Proxies only, for this run"
          name="Proxies only for this run"
          checked={proxiesOnly}
          onChange={onProxiesOnly}
          hint={
            proxiesOnly
              ? 'Every picture leaves from what is in hand; a RAW base is set aside and the run says so. The roll is untouched.'
              : 'Writes nothing on the roll — for a run on a slow connection, or from a phone.'
          }
        />
        <FieldRow
          label="This picture"
          align="start"
          hint={delivery?.reason ?? (delivery ? undefined : 'measured once the picture is in the Library')}
        >
          {/* The calculator's sentence wraps rather than truncates: its end is the verdict. */}
          <span className={`font-mono text-sm tabular-nums leading-snug pt-1 ${delivery ? 'text-ink' : 'text-muted'}`}>
            {delivery ? delivery.line : '—'}
          </span>
        </FieldRow>
      </InspectorSection>

      <InspectorSection
        id="develop.hdr"
        title="HDR"
        info={
          <>
            <p>
              An <strong>Ultra HDR JPEG</strong> is an ordinary JPEG — every viewer shows it — carrying a small
              second picture, the <strong>gain map</strong>: how much brighter each pixel may go on a display with
              headroom. A viewer that reads gain maps (a phone, a recent browser on an HDR screen) lifts the
              highlights; everything else shows the base.
            </p>
            <p>
              The map is measured, never invented: the picture is developed again, darker by the stops asked, and
              where the SDR ran out at white the sensor’s own highlights are what the map carries. Only a picture{' '}
              <strong>developed on its RAW</strong> has them — an 8-bit render holds nothing above white and leaves
              as a plain JPEG, said in the run. The file is read back and its map checked against the rendition
              before it is called Ultra HDR.
            </p>
          </>
        }
      >
        <SwitchRow
          label="Deliver Ultra HDR JPEG"
          name="Ultra HDR"
          checked={settings.hdr}
          onChange={(hdr) => onSettings({ hdr })}
          hint={<p>{hdrSupport().line}</p>}
        />
        {settings.hdr && (
          <FieldRow label="Reach" hint="how far above white the map may reach — the RAW is developed this much darker to find what is there">
            <SelectField
              label="HDR reach"
              value={String(settings.hdrStops)}
              options={HDR_STOPS}
              onChange={(id) => onSettings({ hdrStops: Number(id) })}
            />
          </FieldRow>
        )}
        {hdrRun && !exporting && (
          <p className="m-0 font-mono text-2xs text-ink-soft" role="status">
            {describeHdrRun(hdrRun)}
          </p>
        )}
      </InspectorSection>

      <InspectorSection
        id="develop.deliver"
        title="Deliver"
        info={
          <>
            <p>
              Into a folder you choose, or downloaded one by one where the browser has no folder
              picker. A picture that is not in the Library is skipped and said.
            </p>
            <p>
              A picture leaves under its own name, so the name it wants is often one the folder
              already holds. <strong>Replace</strong> off writes <code>-1</code>, <code>-2</code>
              beside what is there and says how many; on, the file of that name is overwritten —
              and a folder that ignores capitals, as macOS does, reads <code>DJI_0101.jpg</code> and{' '}
              <code>DJI_0101.JPG</code> as one file. A download never asks: the browser numbers a
              repeat by itself.
            </p>
            <p>
              Sending the pictures home to your Winnow is not offered: its upload files them into the
              incoming as new captures rather than into the Gallery, so they would be neither where
              you keep them nor linked to their original.
            </p>
          </>
        }
      >
        <SwitchRow
          label="Replace a file of the same name"
          name="Replace files of the same name"
          checked={settings.replace}
          onChange={(replace) => onSettings({ replace })}
          hint={
            settings.replace
              ? 'What the folder holds under that name is overwritten.'
              : 'A name already in the folder is numbered — DJI_0101-1.jpg.'
          }
        />
        <div className="flex flex-col items-start gap-2">
          {verbs.map((verb) => (
            <div key={verb.id} className="flex flex-col items-start gap-0.5">
              <Button size="sm" icon={Icons.export} onClick={verb.run} disabled={exporting !== null} title={verb.hint}>
                {verb.label}
              </Button>
              {verb.hint && <span className="font-mono text-3xs text-faint leading-relaxed">{verb.hint}</span>}
            </div>
          ))}
          {exporting && (
            <p className="m-0 font-mono text-2xs text-ink-soft" role="status" aria-live="polite">
              {exporting}
            </p>
          )}
          {note && !exporting && (
            <p className="m-0 text-xs text-ink-soft" role="status">
              {note}
            </p>
          )}
        </div>
      </InspectorSection>
    </>
  );
}
