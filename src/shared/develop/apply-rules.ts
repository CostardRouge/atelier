/**
 * A develop BY RULE — "preset X on the golden-hour frames, Y on the ones at
 * noon, Z on the drone's": each rule a WHEN (the facets every listing reads,
 * `row-facets.ts`) and a DO (a preset by name, or slider values), judged per
 * picture against the Winnow row its ref points at, the first matching rule
 * winning. A picture with no row (a local file) matches nothing and is said
 * so; a picture no rule matches is left alone.
 *
 * Pure and DOM-free: the rules are checked here, the rows fetched outside.
 */

import { CommandError } from '../commands/registry';
import type { WinnowAssetRow } from '../sources/winnow/client';
import { passesFacets, readFacets, type RowFacets } from '../sources/winnow/row-facets';
import { withDevelopValues } from './develop-commands';
import type { DevelopSettings } from './develop';

export interface Rule {
  when: RowFacets;
  preset?: string;
  values?: Record<string, number>;
}

/** The `rules` param read and refused where it is not a rule. */
export function readRules(raw: unknown): Rule[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new CommandError('invalid', 'rules must be a non-empty list of {when, preset | values}');
  return raw.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new CommandError('invalid', `rules[${i}] must be an object`);
    const rule = r as Record<string, unknown>;
    for (const key of Object.keys(rule)) {
      if (!['when', 'preset', 'values'].includes(key)) throw new CommandError('invalid', `rules[${i}] has an unknown key "${key}" — a rule is {when, preset | values}`);
    }
    if (!rule.when || typeof rule.when !== 'object' || Array.isArray(rule.when)) throw new CommandError('invalid', `rules[${i}].when must be an object of facets (time, light, gear, camera, orientation…)`);
    const when = readFacets(rule.when as Record<string, unknown>);
    if (typeof rule.when === 'object' && 'near' in (rule.when as object)) throw new CommandError('invalid', `rules[${i}].when: a town cannot be a rule — give nearLat and nearLon`);
    const hasPreset = typeof rule.preset === 'string' && rule.preset.trim() !== '';
    const hasValues = rule.values !== undefined;
    if (hasPreset === hasValues) throw new CommandError('invalid', `rules[${i}] needs a preset or values, one of the two`);
    if (hasValues) {
      // Checked for its keys and ranges now, so a bad rule is refused before any picture is written.
      withDevelopValues(null, rule.values as Record<string, unknown>);
      return { when, values: rule.values as Record<string, number> };
    }
    return { when, preset: (rule.preset as string).trim() };
  });
}

export interface RulePlan {
  /** Picture id → the index of the first rule it matches. */
  matched: { id: string; rule: number }[];
  /** Pictures no rule matched. */
  unmatched: string[];
  /** Pictures with no Winnow row to judge. */
  noRow: string[];
}

export function planRules(pictures: readonly { id: string; row: WinnowAssetRow | null }[], rules: readonly Rule[]): RulePlan {
  const plan: RulePlan = { matched: [], unmatched: [], noRow: [] };
  for (const p of pictures) {
    if (!p.row) {
      plan.noRow.push(p.id);
      continue;
    }
    const row = p.row;
    const i = rules.findIndex((r) => passesFacets(row, r.when));
    if (i < 0) plan.unmatched.push(p.id);
    else plan.matched.push({ id: p.id, rule: i });
  }
  return plan;
}

/** A rule's values laid over a develop; a preset is applied by the caller, who holds the book. */
export function applyRuleValues(current: DevelopSettings | null, rule: Rule): DevelopSettings | null {
  return rule.values ? withDevelopValues(current, rule.values) : current;
}
