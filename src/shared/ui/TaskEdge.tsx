import { overallProgress, type Task } from '../tasks/tasks';
import { useTasks } from '../tasks/use-tasks';

interface TaskEdgeProps {
  /** The media whose tasks this edge draws — `fileIdentity(file)`, a picture id. */
  scope: string;
  /** Which edge of the stage: the bottom by default. */
  edge?: 'top' | 'bottom';
  className?: string;
}

/**
 * The maintainer's passive surface (`docs/progress-feedback.md` §1): a 2px
 * hairline along a media's edge, a fill in the accent where the length is
 * known and a sweeping sliver where it is not. It costs the picture nothing
 * and says only that something is happening TO THIS MEDIA — the words and
 * the Cancel are the pill's (`TaskPill`).
 *
 * Sits in a `relative` stage box; draws nothing when nothing is running.
 */
export default function TaskEdge({ scope, edge = 'bottom', className = '' }: TaskEdgeProps) {
  const tasks = useTasks(scope);
  if (tasks.length === 0) return null;
  return <TaskBar tasks={tasks} className={`absolute inset-x-0 ${edge === 'top' ? 'top-0' : 'bottom-0'} ${className}`} />;
}

/** The bar itself, for the edge and for the pill's list alike. */
export function TaskBar({ tasks, className = '' }: { tasks: readonly Task[]; className?: string }) {
  const ratio = overallProgress(tasks);
  const label = tasks.length === 1 ? tasks[0].label : `${tasks.length} things running`;
  return (
    <div
      className={`h-[2px] overflow-hidden pointer-events-none bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
    >
      {ratio === null ? (
        <div className="h-full w-1/4 bg-accent animate-deck-load" />
      ) : (
        <div className="h-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${ratio * 100}%` }} />
      )}
    </div>
  );
}
