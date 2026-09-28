// Where a menu is drawn once it no longer lives inside its card. Port of
// `src/shared/ui/menu-anchor.ts`.
//
// A menu positioned inside a card paints with that card, so a later sibling
// paints OVER it and the scroll container clips it at the bottom row; the cure
// is to draw it at fixed viewport coordinates, which is what this computes
// (`frontend.md`, «a menu is PORTALLED»). Given the trigger's rect and the
// menu's measured size: the corner it opens from, the height it may take,
// and the side it ended up on. `side` and `align` are a PREFERENCE, not a
// placement: a menu that would fall off the bottom flips above — only when the
// other side is BETTER, so a menu that fits nowhere stays where it was asked
// for and scrolls inside `minRoom`; one that would fall off an edge slides
// back in, and one wider than the screen gives up the margin rather than
// itself. Nothing here reads a view; the caller measures.

import Foundation

/// The trigger's edges in viewport coordinates (the web's
/// `getBoundingClientRect`), edges rather than an origin and a size.
public struct AnchorRect: Equatable, Sendable {
    public var left: Double
    public var right: Double
    public var top: Double
    public var bottom: Double

    public init(left: Double, right: Double, top: Double, bottom: Double) {
        self.left = left; self.right = right; self.top = top; self.bottom = bottom
    }
}

public enum MenuSide: String, Sendable {
    case below, above
}

/// Which of the menu's edges lines up with the trigger's.
public enum MenuAlign: String, Sendable {
    case end, start
}

public struct MenuAnchorInput: Equatable, Sendable {
    /// The trigger, in viewport coordinates.
    public var trigger: AnchorRect
    /// The menu's natural size, measured unconstrained.
    public var menu: Size
    public var viewport: Size
    /// Preferred side; flipped when it does not fit.
    public var side: MenuSide
    /// Which of the menu's edges lines up with the trigger's.
    public var align: MenuAlign
    /// Between the trigger and the menu.
    public var gap: Double
    /// The least the menu keeps from a viewport edge.
    public var margin: Double

    public init(trigger: AnchorRect, menu: Size, viewport: Size, side: MenuSide, align: MenuAlign,
                gap: Double = 6, margin: Double = 8) {
        self.trigger = trigger; self.menu = menu; self.viewport = viewport
        self.side = side; self.align = align; self.gap = gap; self.margin = margin
    }
}

public struct MenuAnchor: Equatable, Sendable {
    public var left: Double
    public var top: Double
    public var maxHeight: Double
    /// Where it actually landed — the caller may want to know it flipped.
    public var placed: MenuSide

    public init(left: Double, top: Double, maxHeight: Double, placed: MenuSide) {
        self.left = left; self.top = top; self.maxHeight = maxHeight; self.placed = placed
    }
}

/// Two items and a rule: below this a menu is not worth drawing, it scrolls.
public let menuMinRoom = 96.0

public func menuAnchor(_ input: MenuAnchorInput) -> MenuAnchor {
    let trigger = input.trigger
    let menu = input.menu
    let viewport = input.viewport
    let gap = input.gap
    let margin = input.margin

    let roomBelow = viewport.height - margin - (trigger.bottom + gap)
    let roomAbove = trigger.top - gap - margin

    // Flip only when the preferred side cannot hold the menu AND the other
    // side is better — a menu that fits nowhere stays where it was asked for.
    var placed = input.side
    if input.side == .below && menu.height > roomBelow && roomAbove > roomBelow { placed = .above }
    if input.side == .above && menu.height > roomAbove && roomBelow > roomAbove { placed = .below }

    let room = placed == .below ? roomBelow : roomAbove
    let tallest = max(viewport.height - 2 * margin, 0)
    let maxHeight = clamp(max(room, menuMinRoom), 0, tallest)
    let height = min(menu.height, maxHeight)

    let wantedTop = placed == .below ? trigger.bottom + gap : trigger.top - gap - height
    let lowestTop = max(margin, viewport.height - margin - height)
    let top = clamp(wantedTop, margin, lowestTop)

    let wantedLeft = input.align == .end ? trigger.right - menu.width : trigger.left
    let maxLeft = viewport.width - margin - menu.width
    let left = maxLeft < margin ? margin : clamp(wantedLeft, margin, maxLeft)

    return MenuAnchor(left: left, top: top, maxHeight: maxHeight, placed: placed)
}
