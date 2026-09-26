// The suite's named ASPECTS — the shapes the Studio and Trips compose for, and
// the preset half of what a roll stores in `RollPicture.aspect`. Port of the
// pure part of `src/shared/projects/project-types.ts` (`AspectPreset`,
// `ASPECT_PRESETS`); the rest of that module is the Studio project's, and its
// port reuses this table rather than defining a second one.
//
// The rules it keeps: an id is the shape spelled `w:h`, a label names the
// DESTINATION the way a creator thinks ("Reels", not "1080×1920"), and the
// order is the web's — the four destinations, then the shapes a photograph is
// SHOT in, in portrait/landscape pairs so a two-column picker reads as pairs.
// A picker wanting them by shape sorts by `w / h` rather than reordering this.
//
// Moved here from `Roll.swift`, whose copy had the photo shapes under other
// labels and in another order; `isStoredAspect` (which also knows a FREE
// aspect) is `CropAspect.swift`'s.

import Foundation

public struct AspectPreset: Equatable, Sendable {
    public var id: String
    /// Destination-named, the way a creator thinks ("Reels", not "1080×1920").
    public var label: String
    public var w: Double
    public var h: Double

    public init(id: String, label: String, w: Double, h: Double) {
        self.id = id; self.label = label; self.w = w; self.h = h
    }

    /// The shape as a ratio, width over height.
    public var ratio: Double { w / h }
}

/// The web's `ASPECT_PRESETS`, in its order.
public let aspectPresets: [AspectPreset] = [
    AspectPreset(id: "9:16", label: "Reels · TikTok · Shorts", w: 9, h: 16),
    AspectPreset(id: "16:9", label: "YouTube · landscape", w: 16, h: 9),
    AspectPreset(id: "1:1", label: "Square post", w: 1, h: 1),
    AspectPreset(id: "4:5", label: "Portrait post", w: 4, h: 5),
    // The shapes a photograph is SHOT in, so a still can go out whole.
    AspectPreset(id: "3:4", label: "Phone photo · portrait", w: 3, h: 4),
    AspectPreset(id: "4:3", label: "Phone & drone photo", w: 4, h: 3),
    AspectPreset(id: "2:3", label: "Pinterest · camera portrait", w: 2, h: 3),
    AspectPreset(id: "3:2", label: "Camera photo · landscape", w: 3, h: 2),
]

/// The preset with this id, or nil when the id names none.
public func aspectPreset(_ id: String) -> AspectPreset? {
    aspectPresets.first { $0.id == id }
}
