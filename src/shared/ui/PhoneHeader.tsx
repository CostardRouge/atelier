import type { ReactNode } from 'react';
import IconButton from './IconButton';
import { Icons } from './icons';
import OverflowMenu, { type OverflowItem } from './OverflowMenu';
import { GLASS, useShellExtras } from './shell-chrome';

export interface PhoneHeaderProps {
  /** The way back, as a chevron; none on the suite's home, which is where every way back leads. */
  back?: { label: string; onClick: () => void };
  /** The document's name — a field or a title — on the first line. */
  title: ReactNode;
  /** What is open inside it, on the second line, smaller. */
  subtitle?: ReactNode;
  /** The screen's own few controls, before the ⋯ (history, a status pill, the one primary verb). */
  trailing?: ReactNode;
  /** The screen's verbs for its ⋯; the shell's own (`ShellExtras`) follow them after a rule. */
  menu: readonly OverflowItem[];
  menuLabel?: string;
  /** Over the picture in glass (a browsed picture), or in its row (a panel up). */
  floating: boolean;
}

/**
 * An immersive editor's ONE header line on a phone (`shell-chrome.tsx`,
 * 2026-10-20, pick C of https://claude.ai/artifact/GunaDcNsUtVM3nW1xiyQ2V):
 * back · the document over what is open in it · the screen's few controls ·
 * ⋯. It replaces the shell's masthead AND the screen's page bar, so it also
 * carries what the masthead held — the task and agent pills, and the rest of
 * the suite at the end of the ⋯.
 */
export default function PhoneHeader({ back, title, subtitle, trailing, menu, menuLabel, floating }: PhoneHeaderProps) {
  const extras = useShellExtras();
  const shell = extras?.menu ?? [];
  const items: OverflowItem[] = [
    ...menu,
    // A rule between the screen's items and the shell's, never above the first item.
    ...shell.map((it, i) => (i === 0 ? { ...it, rule: menu.length > 0 } : it)),
  ];
  return (
    <div
      className={`z-20 flex items-center gap-1 h-[46px] px-1 border border-line rounded-paper-lg ${
        floating ? `absolute inset-x-0 top-1 ${GLASS}` : 'flex-none mt-1 bg-surface'
      }`}
    >
      {back && (
        <IconButton variant="ghost" onClick={back.onClick} label={back.label}>
          {Icons.back}
        </IconButton>
      )}
      <span className={`flex-1 min-w-0 flex flex-col justify-center gap-0.5 ${back ? '' : 'pl-2'}`}>
        {title}
        {subtitle}
      </span>
      {extras?.pills}
      {trailing}
      {items.length > 0 && (
        <OverflowMenu label={menuLabel ?? 'More — this screen, then the rest of Atelier'} size="md" items={items} />
      )}
    </div>
  );
}
