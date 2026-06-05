import { useState } from 'react';
import { FIELD_KEYS, FIELD_SPECS, renderElementText } from './field-format';
import type { Cue } from '../telemetry/srt-parser';
import type { OverlayElement, TelemetryFieldKey } from './overlay-types';

interface ElementListProps {
  elements: OverlayElement[];
  selectedId: string | null;
  /** Active cue, so each row can preview its current value. */
  cue: Cue | null;
  onSelect: (id: string) => void;
  onAddField: (field: TelemetryFieldKey) => void;
  onAddText: () => void;
  onAddPreset: () => void;
  onRemove: (id: string) => void;
  onToggleVisible: (id: string) => void;
}

const linkBtn =
  'p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px] decoration-[1.5px] hover:text-accent';

/** The list of placed elements plus the controls to add more. */
export default function ElementList({
  elements,
  selectedId,
  cue,
  onSelect,
  onAddField,
  onAddText,
  onAddPreset,
  onRemove,
  onToggleVisible,
}: ElementListProps) {
  const [field, setField] = useState<TelemetryFieldKey>('rel_alt');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="font-sans text-[0.8rem] text-ink bg-surface border border-line-strong rounded-paper px-[0.55rem] py-[0.35rem] cursor-pointer"
          value={field}
          onChange={(e) => setField(e.target.value as TelemetryFieldKey)}
          aria-label="Telemetry field to add"
        >
          {FIELD_KEYS.map((k) => (
            <option key={k} value={k}>
              {FIELD_SPECS[k].label}
            </option>
          ))}
        </select>
        <button type="button" className={linkBtn} onClick={() => onAddField(field)}>
          + Field
        </button>
        <button type="button" className={linkBtn} onClick={onAddText}>
          + Text
        </button>
        <button type="button" className={`${linkBtn} ml-auto`} onClick={onAddPreset}>
          Add deck
        </button>
      </div>

      {elements.length === 0 ? (
        <p className="m-0 px-1 py-3 text-[0.8rem] text-muted">
          No elements yet. Add a telemetry field or text, then drag it onto the
          frame.
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-1">
          {elements.map((el) => {
            const active = el.id === selectedId;
            const preview = renderElementText(el, cue) || '(empty)';
            return (
              <li
                key={el.id}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded-[10px] cursor-pointer ${
                  active ? 'bg-accent-wash' : 'hover:bg-white'
                }`}
                onClick={() => onSelect(el.id)}
              >
                <button
                  type="button"
                  className="flex-none w-4 text-center text-[0.8rem] text-ink-soft hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisible(el.id);
                  }}
                  title={el.visible ? 'Hide' : 'Show'}
                  aria-label={el.visible ? 'Hide element' : 'Show element'}
                >
                  {el.visible ? '◉' : '○'}
                </button>
                <span
                  className={`flex-1 min-w-0 truncate text-[0.82rem] ${
                    el.visible ? 'text-ink' : 'text-faint line-through'
                  }`}
                  title={preview}
                >
                  {preview}
                </span>
                <span className="flex-none font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
                  {el.kind === 'text' ? 'TXT' : el.field}
                </span>
                <button
                  type="button"
                  className="flex-none w-4 text-center text-muted opacity-0 group-hover:opacity-100 hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(el.id);
                  }}
                  title="Remove"
                  aria-label="Remove element"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
