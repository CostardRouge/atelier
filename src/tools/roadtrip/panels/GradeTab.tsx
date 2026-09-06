import GradePanel from '../../../shared/lut/GradePanel';
import type { TripGradeBinding } from '../use-trip-grade';
import { chipClass, legend, section } from './ui';

interface GradeTabProps {
  grade: TripGradeBinding;
  /** The piece is linked to a Studio project, whose own grade the video export would use. */
  linkedToProject: boolean;
}

/**
 * The grade, as a facade over the Studio's engine: the panel, the stack and
 * the shader are the Studio's own — Road Trip only decides whose grade the
 * stack edits, the trip's or this piece's. It shows on every slide: the same
 * look dresses the whole deck, and the closing card carries no picture.
 */
export default function GradeTab({ grade, linkedToProject }: GradeTabProps) {
  const { stack, scope, setScope } = grade;
  return (
    <div className="flex flex-col gap-4">
      <div className={section}>
        <span className={legend}>Whose grade</span>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Grade scope">
          <button
            type="button"
            onClick={() => setScope('trip')}
            aria-pressed={scope === 'trip'}
            className={chipClass(scope === 'trip')}
          >
            The trip’s
          </button>
          <button
            type="button"
            onClick={() => setScope('post')}
            aria-pressed={scope === 'post'}
            className={chipClass(scope === 'post')}
          >
            This piece’s own
          </button>
        </div>
        <p className="m-0 text-[0.72rem] text-faint">
          {scope === 'trip'
            ? 'Every piece of the trip that has no grade of its own wears this one — the look that makes the feed read as one journey.'
            : 'A picture that needs its own correction. It started from the trip’s grade; “The trip’s” sends it back and drops this one.'}
        </p>
      </div>

      <GradePanel stack={stack} />
      {stack.error && (
        <p className="m-0 text-[0.76rem] text-[#9a3a23]" role="alert">
          {stack.error}
        </p>
      )}

      <p className="m-0 text-[0.7rem] text-faint leading-snug">
        The preview, the PNG deck and the hook clip all grade through the Studio’s own
        shader — one grade per piece, on every picture of the deck. A different grade per
        slide is not offered yet.
        {linkedToProject &&
          ' A reel exported from the linked Studio project uses that project’s grade, not this one — the Export tab says which.'}
      </p>
    </div>
  );
}
