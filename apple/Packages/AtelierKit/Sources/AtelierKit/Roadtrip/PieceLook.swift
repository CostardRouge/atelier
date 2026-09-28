// The Look tab's WRITES — the pure half of `src/tools/roadtrip/panels/LookTab.tsx`
// (`positionFor`, the cascade's step), `PieceStylePanel.tsx` (`StepRows`'s
// preset menu, an entrance or an exit written beside the other) and
// `ShadesPanel.tsx` (a cell picked by hand, the follow mode, what a row shows
// a shade drawing, the falloff's own picture). The web writes these inline in
// its components; here they are one module with a spec, so the double-optional
// rules (absent against `null`) are pinned where the app cannot be compiled.
//
// Rules kept (`roadtrip.md`):
// - Picking an anchor MOVES the block to that anchor's default position — an
//   anchor that only changed the reference point would read as a dead grid.
// - A piece departs from the theme by writing ANY key, a `null` included
//   (`Object.keys(style).length > 0`): an ink switched off is a departure.
// - An animation holding neither an entrance nor an exit is written `null`,
//   never an empty record; each end keeps the other.
// - A cascade stays ON with a step that does nothing when its entrance is set
//   to None — turning it off is its own switch.
// - Picking a shade's cell by hand is placing it by hand: an anchored shade
//   drops to following the badge's EDGE, never to following nothing.
// - A falloff's picture is drawn from the very stops the renderer gets for it
//   (`shadeGradient`), never from a sketch of the curve that could drift.

import Foundation

// MARK: - the placement

/// Where an anchor's default position sits, so picking one actually moves the
/// block. The web's `positionFor`.
public func badgeAnchorPosition(_ anchor: OverlayAnchor) -> Point {
    let key = anchor.rawValue
    let x = key.hasSuffix("-left") ? 0.07 : key.hasSuffix("-right") ? 0.93 : 0.5
    let y = key.hasPrefix("top-") ? 0.08 : key.hasPrefix("bottom-") ? 0.92 : 0.5
    return Point(x, y)
}

/// The block moved onto `anchor`, at that anchor's default position; its
/// numeral keeps its size.
public func badgeLayoutAnchored(_ layout: BadgeLayout, _ anchor: OverlayAnchor) -> BadgeLayout {
    let at = badgeAnchorPosition(anchor)
    return BadgeLayout(anchor: anchor, x: at.x, y: at.y, sizeFrac: layout.sizeFrac)
}

// MARK: - one piece's departures

/// Whether a piece departs from the trip's theme at all — any key written, a
/// `null` included.
public func pieceStyleDeparts(_ style: BadgePieceStyle) -> Bool {
    style != BadgePieceStyle()
}

/// A step's preset picked on its menu: None clears the step; another keeps
/// every knob the step had, and starts from a plain half-second fade when
/// there was none. The web's `StepRows` preset `onChange`.
public func pieceStepWithPreset(_ step: AnimStep?, _ preset: AnimPreset) -> AnimStep? {
    if preset == .none { return nil }
    var next = step ?? defaultStep(preset)
    next.preset = preset
    return next
}

/// The piece's entrance written, its exit kept — and the whole animation
/// `null` once neither is left.
public func pieceStyleEntrance(_ style: BadgePieceStyle, _ step: AnimStep?) -> BadgePieceStyle {
    var next = style
    let out = (style.animation ?? nil)?.outStep
    if step != nil || out != nil {
        next.animation = .some(ElementAnimation(in: .some(step), out: .some(out)))
    } else {
        next.animation = .some(nil)
    }
    return next
}

/// The piece's exit written, its entrance kept — and the whole animation
/// `null` once neither is left.
public func pieceStyleExit(_ style: BadgePieceStyle, _ step: AnimStep?) -> BadgePieceStyle {
    var next = style
    let entrance = (style.animation ?? nil)?.inStep
    if step != nil || entrance != nil {
        next.animation = .some(ElementAnimation(in: .some(entrance), out: .some(step)))
    } else {
        next.animation = .some(nil)
    }
    return next
}

// MARK: - the cascade

/// The step a cascade holds when its entrance is set to None: the pieces
/// simply are there, and the cascade stays on.
public let cascadeStillStep = AnimStep(preset: .none, duration: 0, easing: .linear)

/// The cascade's shared entrance written; nil (None) keeps it on with a step
/// that does nothing.
public func cascadeWithStep(_ cascade: BadgeCascade, _ step: AnimStep?) -> BadgeCascade {
    var next = cascade
    next.step = step ?? cascadeStillStep
    return next
}

// MARK: - the shades

/// The shapes whose reach is a RADIUS — the radial and the four corners.
public func shadeIsRound(_ direction: ShadeDirection) -> Bool {
    switch direction {
    case .radial, .topLeft, .topRight, .bottomLeft, .bottomRight: return true
    default: return false
    }
}

/// What a row shows a shade drawing with the badge anchored at `anchor`:
/// under "Anchor", the badge's cell; otherwise the shade's own direction.
public func shadeShownDirection(_ shade: Shade, _ anchor: OverlayAnchor?) -> ShadeDirection {
    if shadeFollow(shade) == .anchor, let anchor {
        return directionInCell(anchor, shade.direction)
    }
    return shade.direction
}

/// A direction picked on the grid by hand. An anchored shade stops following
/// the anchor and keeps landing on the badge's edge.
public func shadeDirectionPicked(_ shade: Shade, _ direction: ShadeDirection) -> Shade {
    var next = shade
    next.direction = direction
    if shadeFollow(shade) == .anchor {
        next = shadeFollowing(next, .edge)
    }
    return next
}

/// The follow mode written — both stored flags, as the web writes them.
public func shadeFollowing(_ shade: Shade, _ follow: ShadeFollow) -> Shade {
    var next = shade
    let flags = followFlags(follow)
    next.followHook = flags.followHook
    next.followAnchor = flags.followAnchor
    return next
}

/// Whether a shade sits in the middle on every axis its centre may move on —
/// when "Back to the middle" has nothing left to do.
public func shadeCentred(_ shade: Shade, _ movable: ShadeCentreAxis) -> Bool {
    let centre = shadeCentre(shade)
    return (movable == .y || centre.x == 0.5) && (movable == .x || centre.y == 0.5)
}

/// The stops a falloff fades through, as the renderer gets them for a shade
/// from the left at full strength and full reach — what its button draws.
public func shadeFalloffStops(_ falloff: ShadeFalloff) -> [ShadeStop] {
    let shade = createShade(id: "falloff", direction: .left, reach: 1, strength: 1, falloff: falloff)
    return shadeGradient(shade)?.stops ?? []
}
