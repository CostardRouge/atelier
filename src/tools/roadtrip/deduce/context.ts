import type { DeduceDraft, DeduceVerb, HaltPick, Proposal, ProposalEdit } from '../../../shared/roadtrip/deduce-draft';
import type { TripDoc } from '../../../shared/roadtrip/trip-types';
import type { DeduceSettings, DeduceTab } from './settings';
import type { Deduction } from './use-deduction';

/**
 * What a window is handed: the deduction, the draft, the settings, and the
 * verbs that change them. Three windows, one state — switching never loses
 * anything, and a hand-off carries the chapter under the hand.
 */

export type DeduceIntent = 'fill' | 'enrich' | 'all';

export interface DeduceActions {
  answer: (key: string, verb: DeduceVerb) => void;
  edit: (p: Pick<Proposal, 'key' | 'chapter'>, patch: ProposalEdit) => void;
  resetEdit: (key: string) => void;
  rename: (haltKey: string, name: string) => void;
  /** A place chosen for a halt instead of the index's (Fix), or null to give it back. */
  choose: (haltKey: string, pick: HaltPick | null) => void;
  setDraft: (draft: DeduceDraft) => void;
  setSettings: (patch: Partial<DeduceSettings>) => void;
  resetSettings: () => void;
  /** Open another window, on this chapter when a key is given. */
  goTo: (tab: DeduceTab, key?: string | null) => void;
  setHot: (key: string | null) => void;
  setEditing: (key: string | null) => void;
  setIntent: (intent: DeduceIntent) => void;
  /** The paquet's position. */
  setIndex: (k: number) => void;
}

export interface DeduceContext {
  trip: TripDoc;
  deduction: Deduction;
  draft: DeduceDraft;
  settings: DeduceSettings;
  hot: string | null;
  /** The chapter a hand-off just landed on — outlined for a moment. */
  flash: string | null;
  editing: string | null;
  intent: DeduceIntent;
  index: number;
  actions: DeduceActions;
}
