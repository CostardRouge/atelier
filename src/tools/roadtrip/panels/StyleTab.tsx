import StylePanel from '../../../shared/overlay/StylePanel';
import type { BadgePieceStyle } from '../../../shared/roadtrip/badge-layout';
import {
  DEFAULT_BADGE_WORDS,
  FRENCH_BADGE_WORDS,
  WORD_FIELDS,
  type BadgePiece,
  type BadgeWords,
} from '../../../shared/roadtrip/day-badge';
import { TIME_AGO_WORD_FIELDS, type TimeAgoWords } from '../../../shared/roadtrip/time-ago';
import type { PostBadge, TripDoc, TripPost } from '../../../shared/roadtrip/trip-types';
import PieceStylePanel from '../PieceStylePanel';
import PiecePicker from './PiecePicker';
import { inputClass, legend, section, smallButton } from './ui';

interface StyleTabProps {
  trip: TripDoc;
  post: TripPost;
  /** Per-piece styling is a property of the badge, so it only shows on the hook. */
  isHook: boolean;
  piece: BadgePiece;
  onPiece: (piece: BadgePiece) => void;
  onChangeTrip: (trip: TripDoc) => void;
  patchBadge: (patch: Partial<PostBadge>) => void;
}

/**
 * How the badge LOOKS. Two scopes, deliberately: the trip owns the title
 * style and the words — a badge that varies per post stops being the
 * signature that makes a post recognisable in a feed — while one piece of one
 * post may depart from that theme where a particular picture needs it.
 */
export default function StyleTab({
  trip,
  post,
  isHook,
  piece,
  onPiece,
  onChangeTrip,
  patchBadge,
}: StyleTabProps) {
  const pieceStyle: BadgePieceStyle = post.badge.pieceStyles[piece] ?? {};
  const setPieceStyle = (style: BadgePieceStyle) =>
    patchBadge({ pieceStyles: { ...post.badge.pieceStyles, [piece]: style } });

  const patchWords = (patch: Partial<BadgeWords>) =>
    onChangeTrip({ ...trip, badgeWords: { ...trip.badgeWords, ...patch } });

  const patchTimeWords = (patch: Partial<TimeAgoWords>) =>
    onChangeTrip({
      ...trip,
      badgeWords: { ...trip.badgeWords, time: { ...trip.badgeWords.time, ...patch } },
    });

  return (
    <div className="flex flex-col gap-4">
      <div className={section}>
        <span className={legend}>Style · shared by the whole trip</span>
        <StylePanel theme={trip.theme} onChange={(theme) => onChangeTrip({ ...trip, theme })} />
      </div>

      {isHook ? (
        <div className={section}>
          <span className={legend}>Piece · colour, panel, animation</span>
          <PiecePicker piece={piece} onPiece={onPiece} />
          <PieceStylePanel style={pieceStyle} onChange={setPieceStyle} />
        </div>
      ) : (
        <p className="m-0 text-[0.72rem] text-faint">
          A caption and the closing card keep a fixed look; per-piece styling belongs to
          the badge on the hook.
        </p>
      )}

      <div className={section}>
        <span className={legend}>Words · shared by the whole trip</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChangeTrip({ ...trip, badgeWords: { ...DEFAULT_BADGE_WORDS } })}
            className={`flex-1 ${smallButton} font-normal`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => onChangeTrip({ ...trip, badgeWords: { ...FRENCH_BADGE_WORDS } })}
            className={`flex-1 ${smallButton} font-normal`}
          >
            Français
          </button>
        </div>
        {WORD_FIELDS.map((f) => (
          <label key={f.key} className="flex items-center gap-2">
            <span className="w-24 flex-none text-[0.72rem] text-muted">{f.label}</span>
            <input
              value={trip.badgeWords[f.key]}
              onChange={(e) => patchWords({ [f.key]: e.target.value })}
              className={`${inputClass} flex-1 min-w-0`}
            />
          </label>
        ))}
        <span className={`${legend} pt-2`}>Time</span>
        {TIME_AGO_WORD_FIELDS.map((f) => (
          <label key={f.key} className="flex items-center gap-2">
            <span className="w-24 flex-none text-[0.72rem] text-muted">{f.label}</span>
            <input
              value={trip.badgeWords.time[f.key]}
              onChange={(e) => patchTimeWords({ [f.key]: e.target.value })}
              className={`${inputClass} flex-1 min-w-0`}
            />
          </label>
        ))}
        <p className="m-0 text-[0.68rem] text-faint">
          “{'{n}'}” is replaced by the quantity, “{'{date}'}” by the picture’s own day.
        </p>
      </div>
    </div>
  );
}
