/**
 * What a HOST hands the develop workbench — the Trips modal, the Studio modal,
 * and the Develop tool to come (`docs/develop-tool.md`). Each host decides
 * where a develop, a preset or a batch is written; the workbench only draws
 * them and hands back numbers.
 */

import type { SavedGrade } from '../lut/saved-grade';
import type { DevelopPreset, DevelopSettings } from './develop';

/**
 * The host's presets. A chip applies a COPY into the draft (applied, never
 * followed); `Save current as…` hands the draft back under a name.
 */
export interface DevelopPresets {
  list: readonly DevelopPreset[];
  /** `look` only from a host whose pictures own their look (the Develop tool). */
  onSave: (name: string, settings: DevelopSettings, look?: SavedGrade | null) => void;
  onRemove: (id: string) => void;
  /** Where they are kept, said in the section's ⓘ: "on the trip". */
  keptOn?: string;
  /** Where the list lives and how to move it, for a host whose presets are a document of their own. */
  place?: DevelopPresetsPlace;
}

export interface DevelopPresetsPlace {
  /** "this browser", or the instance's host. */
  label: string;
  sourceId: string;
  /** The sync sentence while it is kept on an instance, null otherwise. */
  status: string | null;
  /** Every source that can keep the list; a picker only when there is more than one. */
  options: readonly { id: string; label: string }[];
  /** Move it — resolves with the reason it could not, or null. */
  onKeepOn: (sourceId: string) => Promise<string | null>;
}

/**
 * A batch verb, naming its count in its label ("Apply to 3 other slides").
 * The workbench hands it the DRAFT; the host writes a copy into each target's
 * own field, now — never waiting for Done, which writes the open picture.
 */
export interface DevelopApplyVerb {
  id: string;
  label: string;
  /** What the batch will write, told beside the verb. */
  hint?: string;
  run: (settings: DevelopSettings) => void;
}
