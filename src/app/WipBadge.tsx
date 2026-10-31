import type { Tool } from './tools';

/**
 * The one mark of a tool still being built — on its home door and in the
 * switcher — so it is offered honestly without a paragraph. "Work in
 * progress", not "Experimental": an experiment may be dropped, while a tool
 * that wears this is kept and finished. What is missing is its `wip.note`,
 * on hover, never standing prose.
 */
export default function WipBadge({ tool, compact = false }: { tool: Tool; compact?: boolean }) {
  if (!tool.wip) return null;
  return (
    <span
      className={`inline-flex flex-none items-center gap-1 font-mono uppercase tracking-[0.12em] rounded border border-warn-line bg-warn-wash text-warn whitespace-nowrap ${
        compact ? 'text-3xs px-1 py-px' : 'text-3xs px-1.5 py-0.5'
      }`}
      title={tool.wip.note}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
      Work in progress
    </span>
  );
}
