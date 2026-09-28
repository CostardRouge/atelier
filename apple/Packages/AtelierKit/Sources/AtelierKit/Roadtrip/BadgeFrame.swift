// The sizes a badge is drawn at, outside the deliverables — the pure numbers
// of `src/shared/roadtrip/badge-render.ts` (the preview's long edges) and of
// `thumbnail.ts` (the hook JPEG a piece keeps), plus the frame a piece is
// composed in. The deliverables' own size is `DeckExport.swift`'s
// `frameSize` / `deckLongEdge`; the paint is the app's
// (`Trips/Paint/BadgeRenderer.swift`), which draws the SAME composition at
// every one of these sizes.
//
// Rules kept:
// - A thumbnail is a picture of the finished BADGE, not of the raw media, and
//   it is never upscaled: a small preview blown up would store blur at four
//   times the weight.
// - Its long edge is sized for the LARGEST consumer (the gallery card's
//   cover), and the stage is never smaller than `previewLongEdge`, so the
//   stored size is always actually reached.
// - A piece whose aspect id names no preset is composed in the first preset
//   (Reels, 9:16) — the web's `ASPECT_PRESETS[0]` fallback.

import Foundation

/// Longest edge a preview canvas is worth drawing at. The web's `PREVIEW_LONG_EDGE`.
public let previewLongEdge = 720.0

/// The most a preview bitmap grows to when the stage is large or the screen
/// dense. The web's `MAX_PREVIEW_LONG_EDGE`.
public let maxPreviewLongEdge = 1600.0

/// Longest edge of a stored hook thumbnail. The web's `THUMB_LONG_EDGE`.
public let thumbLongEdge = 640.0

/// JPEG rather than PNG: photographic, and a tenth of the bytes. The web's `THUMB_QUALITY`.
public let thumbQuality = 0.72

/// The thumbnail's pixel size for a source of `w`×`h`, never upscaling; a
/// source with no area has none.
public func thumbSize(_ w: Double, _ h: Double, _ longEdge: Double = thumbLongEdge) -> (w: Int, h: Int) {
    if !(w > 0) || !(h > 0) { return (0, 0) }
    let scale = min(1, longEdge / max(w, h))
    return (max(1, Int(TripJS.round(w * scale))), max(1, Int(TripJS.round(h * scale))))
}

/// The aspect preset a piece is composed in: its own, else the first.
public func pieceAspectPreset(_ post: TripPost) -> AspectPreset {
    aspectPreset(post.badge.aspectId) ?? aspectPresets[0]
}

/// The frame's aspect (width / height) a piece is composed in.
public func pieceAspect(_ post: TripPost) -> Double {
    pieceAspectPreset(post).ratio
}
