import { useCallback, useRef, useState, type ReactNode } from 'react';
import Button, { type ButtonSize, type ButtonVariant } from './Button';
import IconButton from './IconButton';
import { Icons } from './icons';
import { AnchoredPopover } from './OverflowMenu';
import { PRESS_LOOK } from './press';

/**
 * A VIEW's settings as a panel of rows — the maintainer's pick B of the band
 * menu lab (https://claude.ai/artifact/SxLgUtAs6FsSU1GEdoqeAi), carried to the
 * contact sheet and the day picker (https://claude.ai/artifact/NeMysG6QryTMpbtf2oKk8N).
 *
 * One row per setting: its name at the left, its choices as GLYPHS at the
 * right, the one in force filled; a switch for an on/off; a list of glyphed
 * rows for a longer choice (a filter); a rule between groups; an ACTION alone
 * at the foot (fold the band, close the sheet). Every choice APPLIES AND
 * CLOSES the panel — his call ("le panneau se ferme lorsqu'on sélectionne"),
 * so it reads like a menu while showing the state like a toolbar. Escape and a
 * press outside close it with nothing changed (`AnchoredPopover`).
 *
 * A grey choice is `aria-disabled` with its reason as the tooltip, never
 * `disabled` (`frontend.md`).
 */

export interface SettingsChoice {
  id: string;
  icon: ReactNode;
  /** Its name — the tooltip and what a screen reader says. */
  label: string;
  /** Why it cannot be chosen now: a string greys it with that reason as its tooltip. */
  disabled?: string | boolean;
}

export type SettingsSection =
  | {
      kind: 'choice';
      id: string;
      label: string;
      options: readonly SettingsChoice[];
      /** The option in force; null when none is (an automatic height). */
      value: string | null;
      onPick: (id: string) => void;
    }
  | { kind: 'switch'; id: string; label: string; text: string; on: boolean; title?: string; onToggle: () => void }
  | {
      kind: 'list';
      id: string;
      heading?: string;
      items: readonly { id: string; icon: ReactNode; label: string; on?: boolean; note?: string; title?: string; onSelect: () => void }[];
    }
  | { kind: 'action'; id: string; icon: ReactNode; label: string; hint?: string; title?: string; onSelect: () => void }
  | { kind: 'rule'; id: string };

interface SettingsMenuProps {
  /** Names the trigger and the panel. */
  label: string;
  sections: readonly SettingsSection[];
  size?: ButtonSize;
  side?: 'below' | 'above';
  align?: 'end' | 'start';
  /** A worded trigger (the filter chip) instead of the ⋯. */
  trigger?: { text: ReactNode; icon?: ReactNode; variant?: ButtonVariant; size?: ButtonSize; title?: string };
  className?: string;
}

const segButton = `w-9 h-8 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-10 grid place-items-center border-0 rounded-[7px] bg-transparent text-ink-soft cursor-pointer text-base hover:bg-paper-2 hover:text-ink aria-pressed:bg-ink aria-pressed:text-paper aria-disabled:opacity-30 aria-disabled:cursor-default aria-disabled:hover:bg-transparent ${PRESS_LOOK}`;
const rowButton = `w-full grid grid-cols-[1.25rem_minmax(0,1fr)_auto_0.9rem] items-center gap-2.5 px-2 py-1.5 [@media(pointer:coarse)]:py-2.5 border-0 rounded-[8px] bg-transparent text-left font-sans text-sm text-ink cursor-pointer hover:bg-paper-2 ${PRESS_LOOK}`;

export function SettingsPanelBody({ sections, onDone }: { sections: readonly SettingsSection[]; onDone: () => void }) {
  const take = (fn: () => void) => {
    onDone();
    fn();
  };
  return (
    <>
      {sections.map((s) => {
        switch (s.kind) {
          case 'rule':
            return <span key={s.id} className="block flex-none h-px bg-line mx-1.5 my-1" />;
          case 'choice':
            return (
              <div key={s.id} className="grid grid-cols-[6.5rem_auto] items-center gap-3 px-2 py-1.5">
                <span className="text-xs text-ink-soft">{s.label}</span>
                <div role="group" aria-label={s.label} className="inline-flex w-fit gap-0.5 p-0.5 rounded-[10px] border border-line-strong bg-paper">
                  {s.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={segButton}
                      aria-pressed={s.value === o.id}
                      aria-label={o.label}
                      title={typeof o.disabled === 'string' ? o.disabled : o.label}
                      aria-disabled={o.disabled ? true : undefined}
                      onClick={() => {
                        if (o.disabled) return;
                        take(() => s.onPick(o.id));
                      }}
                    >
                      {o.icon}
                    </button>
                  ))}
                </div>
              </div>
            );
          case 'switch':
            return (
              <div key={s.id} className="grid grid-cols-[6.5rem_auto] items-center gap-3 px-2 py-1.5">
                <span className="text-xs text-ink-soft">{s.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.on}
                  title={s.title}
                  onClick={() => take(s.onToggle)}
                  className="inline-flex items-center gap-2 w-fit p-0 border-0 bg-transparent text-xs text-ink-soft cursor-pointer"
                >
                  <span
                    aria-hidden="true"
                    className={`relative flex-none w-[1.9rem] h-[1.1rem] rounded-full transition-colors ${s.on ? 'bg-accent' : 'bg-line-strong'}`}
                  >
                    <span
                      className={`absolute top-[2px] left-[2px] w-[0.85rem] h-[0.85rem] rounded-full bg-surface transition-transform ${s.on ? 'translate-x-[0.8rem]' : ''}`}
                    />
                  </span>
                  {s.text}
                </button>
              </div>
            );
          case 'list':
            return (
              <div key={s.id} className="flex flex-col">
                {s.heading && (
                  <span className="px-2 pt-2 pb-1 font-mono text-3xs tracking-[0.1em] uppercase text-muted">{s.heading}</span>
                )}
                {s.items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={!!it.on}
                    title={it.title}
                    onClick={() => take(it.onSelect)}
                    className={rowButton}
                  >
                    <span className={`grid place-items-center text-base ${it.on ? 'text-accent-ink' : 'text-ink-soft'}`}>{it.icon}</span>
                    <span className="truncate">{it.label}</span>
                    <span className="font-mono text-3xs text-faint tabular-nums">{it.note ?? ''}</span>
                    <span className="grid place-items-center text-xs text-accent-ink">{it.on ? Icons.check : null}</span>
                  </button>
                ))}
              </div>
            );
          case 'action':
            return (
              <button
                key={s.id}
                type="button"
                title={s.title}
                onClick={() => take(s.onSelect)}
                className={`w-full flex items-center gap-2.5 px-2 py-2 [@media(pointer:coarse)]:py-2.5 border-0 rounded-[8px] bg-transparent text-left font-sans text-sm text-ink cursor-pointer hover:bg-paper-2 ${PRESS_LOOK}`}
              >
                <span className="grid place-items-center text-base text-ink-soft">{s.icon}</span>
                <span>{s.label}</span>
                {s.hint && <span className="ml-auto font-mono text-3xs text-faint [@media(pointer:coarse)]:hidden">{s.hint}</span>}
              </button>
            );
        }
      })}
    </>
  );
}

export default function SettingsMenu({ label, sections, size = 'sm', side = 'below', align = 'end', trigger, className = '' }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRect = useCallback(() => rootRef.current?.getBoundingClientRect() ?? null, []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setOpen((o) => !o);
  };

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`}>
      {trigger ? (
        <Button
          variant={trigger.variant ?? 'default'}
          size={trigger.size ?? size}
          icon={trigger.icon}
          trailing={Icons.down}
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={trigger.title}
          onClick={toggle}
        >
          {trigger.text}
        </Button>
      ) : (
        <IconButton
          size={size}
          variant="ghost"
          label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={toggle}
          className={open ? 'bg-paper-2 text-ink' : ''}
        >
          {Icons.more}
        </IconButton>
      )}
      {open && (
        <AnchoredPopover
          anchorRect={anchorRect}
          onClose={close}
          side={side}
          align={align}
          within={rootRef}
          role="dialog"
          label={label}
          className="min-w-[16rem] max-w-[calc(100vw-1rem)] p-1.5"
        >
          <SettingsPanelBody sections={sections} onDone={close} />
        </AnchoredPopover>
      )}
    </div>
  );
}
