import { LONG_EDGE_CHOICES, longEdgeChoiceId, type DeliverySummary } from '../../shared/develop/roll-export';
import { ROLL_EXPORT_LIMITS, type RollExport, type RollOriginals } from '../../shared/develop/roll-types';
import Button from '../../shared/ui/Button';
import { FieldRow, InspectorSection, RangeField, SelectField, SwitchRow } from '../../shared/ui/Inspector';
import Segmented from '../../shared/ui/Segmented';
import { Icons } from '../../shared/ui/icons';

/** One export verb: what it renders, and how many. */
export interface ExportVerb {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const ORIGINALS: readonly { id: RollOriginals; label: string; title: string }[] = [
  { id: 'auto', label: 'Auto', title: 'An original is fetched only where the proxy could not fill the frame' },
  { id: 'proxies', label: 'Proxies', title: 'Deliver from the pictures in the Library, never fetching an original' },
  { id: 'originals', label: 'Originals', title: 'Fetch the full-size original of every picture that has one this browser decodes' },
];

/**
 * The Develop tool's Export tab: the roll's delivery settings (a long edge,
 * the JPEG quality, which pixels), the *Delivers* line for the picture in
 * hand — the calculator of `docs/develop-originals.md` in one sentence — and
 * the verbs.
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
  verbs,
  exporting,
  note,
}: {
  settings: RollExport;
  onSettings: (patch: Partial<RollExport>) => void;
  /** What the open picture will deliver, or null until it is measured. */
  delivery: DeliverySummary | null;
  verbs: readonly ExportVerb[];
  exporting: string | null;
  note: string | null;
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
              <strong>Pixels</strong> decides where a picture from your Winnow takes its pixels:
              <strong> Auto</strong> fetches the full-size original only where the proxy could not fill
              the frame asked for; <strong>Proxies</strong> never fetches; <strong>Originals</strong>{' '}
              always does, for every original this browser decodes. A RAW original is never fetched
              — the render you developed is what leaves. Fetched originals are kept for this session
              only.
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
        <FieldRow label="Pixels">
          <Segmented
            fill
            size="sm"
            label="Pixels"
            value={settings.originals}
            onChange={(originals) => onSettings({ originals })}
            options={ORIGINALS}
            className="flex-1 min-w-0"
          />
        </FieldRow>
        <FieldRow
          label="Delivers"
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
