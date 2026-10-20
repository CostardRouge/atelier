import { useMemo } from 'react';
import type { OverflowItem } from '../shared/ui/OverflowMenu';
import type { ShellExtras } from '../shared/ui/shell-chrome';
import { nextThemePref, type ThemePref } from '../shared/ui/theme';
import { useTheme } from '../shared/ui/use-theme';
import TaskPill from '../shared/ui/TaskPill';
import { useWinnowConnection } from '../shared/sources/winnow/use-connection';
import AgentPill from './AgentPill';
import { REPO_URL } from './site';
import { HOME_PATH, TOOLS, type Tool } from './tools';

const THEME_WORD: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/**
 * What the masthead holds, for a screen that draws none (`shell-chrome.tsx`):
 * the other editors, every tool, the sources, the theme and the repository as
 * items of the tool's own ⋯, and the task and agent pills for its header.
 */
export function useShellExtrasValue(tool: Tool | undefined, atHome = false): ShellExtras {
  const { pref, setPref } = useTheme();
  const { connection } = useWinnowConnection();
  return useMemo(() => {
    const go = (path: string) => () => {
      window.location.hash = `#${path}`;
    };
    const editors = TOOLS.filter((t) => t.group === 'editor' && t.id !== tool?.id);
    // On the home page every tool is the page itself: no item leads back to it.
    const home: OverflowItem[] = atHome
      ? []
      : [{ id: 'tools', label: 'All tools', title: 'Atelier’s home: every tool', onSelect: go(HOME_PATH), rule: editors.length === 0 }];
    const next = nextThemePref(pref);
    const menu: OverflowItem[] = [
      ...editors.map((t, i) => ({ id: `tool-${t.id}`, label: t.label, title: `Open ${t.label}`, onSelect: go(t.path), rule: i === 0 })),
      ...home,
      {
        id: 'sources',
        label: connection ? `Sources · ${connection.id}` : 'Sources · this browser only',
        title: connection ? `Connected to ${connection.id} — manage sources` : 'Only this browser — connect a source',
        onSelect: go('/sources'),
        rule: true,
      },
      {
        id: 'theme',
        label: `Theme · ${THEME_WORD[pref]}`,
        title: `Switch to ${THEME_WORD[next].toLowerCase()}`,
        onSelect: () => setPref(next),
      },
      {
        id: 'github',
        label: 'Source on GitHub',
        onSelect: () => window.open(REPO_URL, '_blank', 'noreferrer'),
      },
    ];
    return {
      menu,
      pills: (
        <>
          <TaskPill compact />
          <AgentPill />
        </>
      ),
    };
  }, [tool?.id, atHome, pref, setPref, connection]);
}
