// Every key the web's piece editor binds, read while no field of it types —
// `PostEditor`'s window listeners and the band's own keys (`DeckStrip`):
//
// - Space plays and pauses — the piece, or the cut while it is open;
// - ← / → step to the previous / next slide (Shift: half a second), Home and
//   End go to the piece's first and last moment — the band's keys, which the
//   whole editor answers here since a native band is not a focus stop;
// - I / O cut the open clip at the playhead (Shift: back to the clip's own
//   ends) — only on a clip slide;
// - L switches what playback loops over — never while the cut is open;
// - M mutes the opener's ticks — only where it has a score;
// - ⌘Z / ⇧⌘Z are the window's `UndoManager` (`TripsStore` registers every
//   step), not read here.
//
// The web's piece editor binds nothing to Delete or Escape: a badge piece is
// computed from the document and cannot be removed, and a slide is removed
// from the band's ⋯ menu. Neither is bound here (`PARITY.md`).

import Foundation
import SwiftUI
import AtelierKit

extension PieceEditorModel {
    /// The shortest cut `I` / `O` may leave — the floor `clipSlice` keeps.
    static let minCut = minHookSeconds / 4

    /// A press, read and acted on — true when the editor took it. A sheet
    /// over the editor, or a field that types, keeps every key.
    func handleKey(_ press: EditorKeyPress) -> Bool {
        if textEditing || tripSheet != nil || garageOpen || developOpen { return false }
        if press.metaKey || press.ctrlKey || press.altKey { return false }
        switch press.key {
        case " ":
            guard !press.repeat, !press.shiftKey else { return false }
            togglePlay()
            return true
        case "ArrowLeft", "ArrowRight":
            let forward = press.key == "ArrowRight"
            let layout = stripLayout(lengths, 1, 0, 0)
            let now = deck.time
            let t = press.shiftKey ? now + (forward ? 0.5 : -0.5) : stepSlide(layout, now, forward ? 1 : -1)
            scrubPiece(min(layout.seconds, max(0, t)))
            return true
        default:
            break
        }
        let key = press.key.lowercased()
        switch key {
        case "i", "o":
            guard isClipSlide else { return false }
            let range = clipRange
            let next = key == "i"
                ? setStart(range, press.shiftKey ? 0 : playhead, duration, PieceEditorModel.minCut)
                : setEnd(range, press.shiftKey ? duration : playhead, duration, PieceEditorModel.minCut)
            setClipRange(next)
            return true
        case "l":
            guard !press.repeat, !trimOpen else { return false }
            toggleLoopScope()
            return true
        case "m":
            guard hasScore else { return false }
            soundOn.toggle()
            return true
        default:
            return false
        }
    }

    /// Home and End — SwiftUI names them apart from the characters.
    func handleKey(_ key: KeyEquivalent) -> Bool {
        if textEditing || tripSheet != nil || garageOpen || developOpen { return false }
        if key == .home {
            scrubPiece(0)
            return true
        }
        if key == .end {
            scrubPiece(deck.seconds)
            return true
        }
        return false
    }

    /// Go to a moment of the piece (a scrub, a key): the card the needle
    /// landed on on this slide, or the composition of another.
    func scrubPiece(_ t: Double) {
        deck.scrub(t)
        let at = locate(stripLayout(lengths, 1, 0, 0), t)
        if at.index == slideIndex { followNeedle(at.local) }
    }

    /// The opener plays a score the ticks can be heard from.
    var hasScore: Bool {
        guard isHook, let state = hookState else { return false }
        return !state.hook.score().isEmpty
    }
}
