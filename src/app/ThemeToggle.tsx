import IconButton from '../shared/ui/IconButton';
import { Icons } from '../shared/ui/icons';
import { nextThemePref, type ThemePref } from '../shared/ui/theme';
import { useTheme } from '../shared/ui/use-theme';

const LABEL: Record<ThemePref, string> = {
  system: 'Theme follows the system',
  light: 'Light theme',
  dark: 'Dark theme',
};

/**
 * One button in the masthead, three states in a cycle: the system's choice,
 * light, dark. The glyph says what is set — a monitor, a sun, a moon — and
 * the tooltip says what the next press does. Three states rather than
 * Winnow's two because a chosen theme must be able to hand control back to
 * the OS, which a sun/moon pair cannot express.
 */
export default function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const next = nextThemePref(pref);
  return (
    <IconButton
      size="sm"
      variant="ghost"
      label={`${LABEL[pref]} — switch to ${LABEL[next].toLowerCase()}`}
      onClick={() => setPref(next)}
      className="text-muted hover:text-ink"
    >
      {pref === 'system' ? Icons.monitor : pref === 'light' ? Icons.sun : Icons.moon}
    </IconButton>
  );
}
