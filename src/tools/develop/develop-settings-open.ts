import { useSyncExternalStore } from 'react';
import { localPref } from '../../shared/ui/local-pref';

/**
 * Whether Develop's settings sheet is open, and on which section — a module
 * store, so the Export tab's *Encoder* line can open the sheet the roll's ⚙
 * opens without a callback threaded through the workbench.
 */

export type SettingsSection = 'encoder' | 'rendering' | 'device' | 'network' | 'learning';

const SECTION_IDS: readonly SettingsSection[] = ['encoder', 'rendering', 'device', 'network', 'learning'];

/** The section last looked at, kept on this device like the settings themselves. */
export const settingsSectionPref = localPref<SettingsSection>(
  'atelier.develop.settings.section',
  // `privacy` was the Network section's first id; a device that stored it opens there still.
  (raw) => (raw === 'privacy' ? 'network' : (SECTION_IDS.find((id) => id === raw) ?? 'encoder')),
  (id) => id,
);

let open = false;
/** Opened ON a section (the Export tab's line): a phone shows that pane, not the list. */
let aimed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Opens the sheet — on `section` when given, else where it was last left. */
export function openDevelopSettings(section?: SettingsSection) {
  if (section) settingsSectionPref.set(section);
  aimed = Boolean(section);
  open = true;
  emit();
}

export function closeDevelopSettings() {
  open = false;
  aimed = false;
  emit();
}

/** Whether the sheet now open was opened on a section rather than from the ⚙. */
export function openedOnSection(): boolean {
  return aimed;
}

export function useDevelopSettingsOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => open,
    () => false,
  );
}
