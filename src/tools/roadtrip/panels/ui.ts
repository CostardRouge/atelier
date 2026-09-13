/**
 * The class strings the piece editor's panels still share. Most of what lived
 * here went into the inspector's grammar (`shared/ui/Inspector.tsx`): section
 * legends, option cards and pressed chips are `InspectorSection`, `SelectField`
 * and `Segmented` now. What remains is a text input, a link-styled verb, a
 * note and the small button, all on the shared recipes.
 */

import { buttonClass } from '../../../shared/ui/Button';

export const inputClass =
  'font-sans text-sm h-[2.125rem] px-3 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
export const smallButton = buttonClass('default', 'sm');
export const linkButton =
  'p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink';
export const dangerLink =
  'p-0 border-0 bg-transparent text-xs text-faint cursor-pointer underline underline-offset-[3px] hover:text-danger';
export const note =
  'm-0 px-3 py-2 rounded-control border border-line bg-paper text-xs text-ink-soft';
