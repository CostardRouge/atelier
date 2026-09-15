/**
 * What a HOST hands the develop workbench — the Trips modal, the Studio modal,
 * and the Develop tool to come (`docs/develop-tool.md`). Each host decides
 * where a develop, a preset or a batch is written; the workbench only draws
 * them and hands back numbers.
 */

import type { DevelopPreset, DevelopSettings } from './develop';

/**
 * The host's presets. A chip applies a COPY into the draft (applied, never
 * followed); `Save current as…` hands the draft back under a name.
 */
export interface DevelopPresets {
  list: readonly DevelopPreset[];
  onSave: (name: string, settings: DevelopSettings) => void;
  onRemove: (id: string) => void;
  /** Where they are kept, said in the section's ⓘ: "on the trip". */
  keptOn?: string;
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
