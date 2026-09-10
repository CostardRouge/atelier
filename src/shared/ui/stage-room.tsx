/**
 * Whether a docked panel is sharing this screen's height, told to the tools.
 *
 * The third thing the shell publishes downward, beside `use-layout-mode.tsx`
 * (how much room there is) and against `media-scope.tsx` (what a tool is on).
 * Same contract as both: `shared/` never learns about `tools/`, and a tool
 * reads a NAME rather than re-deriving a state the shell owns.
 *
 * **Why a tool needs to know.** The docked library takes 46dvh, which on a
 * 390×844 phone leaves the editor's stage column 351px. Measured with Road
 * Trip's piece editor open on a 9:16 reel: 105px of that went to the page bar,
 * the piece's name and its date line, and 91px to the transport and the slide
 * rail — so the canvas got 155px of height and, being portrait, **86px of the
 * 374px available across**. The maintainer asked for half the screen each and
 * the picture was getting a fifth of its half.
 *
 * The rule that comes out of it: **what the dock takes, the CHROME gives up
 * first, never the picture.** A tool reading `shared` sheds everything that is
 * not the thing being looked at — a name that is editable a second later, a
 * strip that can stand beside the frame instead of under it. Nothing is lost,
 * because the dock closes and it all comes back.
 *
 * It is one boolean-shaped fact, but it is a named value for the same reason
 * `LayoutMode` is: `room === 'shared'` says what a tool should DO about it,
 * where `libraryOpen` would only say what the shell happens to be showing.
 */

import { createContext, useContext, type ReactNode } from 'react';

/** `full` — the stage has the screen. `shared` — a docked panel has a share. */
export type StageRoom = 'full' | 'shared';

const StageRoomContext = createContext<StageRoom>('full');

export function StageRoomProvider({ room, children }: { room: StageRoom; children: ReactNode }) {
  return <StageRoomContext.Provider value={room}>{children}</StageRoomContext.Provider>;
}

/**
 * How much of the screen the stage has. Tolerant of a missing provider, like
 * every other publish in the suite: `full` is the honest default, since a tool
 * mounted without a shell has nothing docked under it.
 */
export function useStageRoom(): StageRoom {
  return useContext(StageRoomContext);
}
