// «Itinerary» — the places you picked, joined on a map, with their pictures.
// Port of the variant in `src/shared/roadtrip/hooks/map.tsx`: its id and
// words, its defaults, what it needs, the key that holds one piece's content,
// which pictures it asks for, where its drawing sits on the stage and how a
// drag moves it, and what `prepare` returns. The arithmetic is `MapPlan.swift`
// and a frame's layout `MapPaint.swift`; the strokes and the face — the
// picker `Sketch`, the options `Panel` with its picking map
// (`map-field.tsx`), its place search and its stop list — are the app's.
//
// The engine's first variant the AUTHOR composes rather than reads: a stop is
// on the map because someone put it there, in the order they chose, holding
// the picture they gave it. The pen travels stop to stop, waiting at each; the
// pictures come with it pinned by their dot, on a card under the map, filling
// the frame behind it, or as a strip along the edge — and a stop with no
// picture draws NOTHING.
//
// Rules kept:
// - Never unmet: an itinerary with no stops is not a refusal, it is an empty
//   one, and the panel is where it gets filled; it plays nothing and cannot be
//   grabbed on the stage until it has a stop.
// - It MAY replace the picture (the backdrop does), so it declares `owns:
//   .frame` — what a variant is allowed to do, not what it does on every piece.
// - The caption names the stop the pen is at — the author's own assertion, so
//   saying it claims nothing the document cannot support; a stop with no name
//   leaves the badge's caption alone rather than emptying it.
// - It ticks only while it draws: a still map has no arrivals to hear.

import Foundation

/// The Itinerary's drawing: the options and the clock `prepare` built — the
/// ones its caption and its ticks read — with the trip's other places (for the
/// faint context layer) and the pictures it was prepared against. The app's
/// painter reads it through `frame(at:_:)` (`MapPaint.swift`).
public struct MapDrawing: HookDrawing {
    public let options: MapOptions
    public let timing: MapTiming
    /// The trip's own located places that are not stops; empty unless the
    /// author asked for the context layer. Handed in rather than read: the
    /// paint never sees the document, only what `prepare` captured for it.
    public let context: [MapPlace]
    public let pictures: [String: HookPicture]?

    public init(options: MapOptions, timing: MapTiming, context: [MapPlace], pictures: [String: HookPicture]?) {
        self.options = options; self.timing = timing; self.context = context; self.pictures = pictures
    }
}

/// The last stop the pen has reached at `t` — the one the caption names.
private func mapStopAt(_ timing: MapTiming, _ t: Double) -> Int {
    var at = 0
    for i in timing.arrivals.indices.dropFirst() where t + 1e-9 >= timing.arrivals[i] {
        at = i
    }
    return at
}

private func prepareMap(_ options: HookOptions, _ ctx: HookContext) -> HookRender {
    let o = mapOptions(options)
    if o.stops.isEmpty { return HookRender(seconds: 0) }
    let timing = mapTiming(planarHops(o.stops), o)
    let context = o.context ? otherPlaces(ctx.stages, o.stops) : []
    let stops = o.stops

    var content: (@Sendable (Double) -> HookContentPatch)? = nil
    if o.nameInBadge {
        content = { t in
            let at = mapStopAt(timing, t)
            guard at < stops.count else { return [:] }
            let name = stops[at].name.trimmingCharacters(in: .whitespacesAndNewlines)
            return name.isEmpty ? [:] : [.caption: .text(name)]
        }
    }
    var score: (@Sendable () -> [SoundEvent])? = nil
    if o.sound && o.draw {
        let tuning = (kit: o.kit, pitch: o.tickPitch)
        let volume = o.tickVolume
        score = { mapScore(timing, tuning, volume) }
    }
    return HookRender(
        seconds: timing.total,
        content: content,
        drawing: MapDrawing(options: o, timing: timing, context: context, pictures: ctx.pictures),
        score: score,
        mixWithSource: o.sound && o.mixWithClip
    )
}

/// Pointed at and dragged on the stage like any other content. The box is the
/// MAP's — everything else the opener draws is measured from it, so moving it
/// moves the line, the dots, the names and the card together.
private func mapFrameBox(_ options: HookOptions, _ frame: FrameBox) -> FrameRect? {
    let o = mapOptions(options)
    if o.stops.isEmpty { return nil }
    return mapBox(frame.width, frame.height, o)
}

/// The web's `mapVariant`.
public let mapVariant = HookVariant(
    id: "map",
    name: "Itinerary",
    tagline: "Places you pick, joined on a map",
    defaults: MapOptions.defaults.json.objectValue ?? [:],
    contentKeys: ["stops"],
    // `stages` for the trip's own places — as landmarks to adopt and as the
    // faint context layer. `media: .day` is what makes the shell resolve and
    // decode the pictures the stops name.
    needs: HookNeeds(stages: true, places: true, media: .day),
    owns: .frame,
    prepare: { prepareMap($0, $1) },
    wantsPictures: { options, _ in mapWants(mapOptions(options)) },
    frameBox: { options, _, frame in mapFrameBox(options, frame) },
    moveBy: { options, dx, dy in moveMap(mapOptions(options), dx, dy).json.objectValue ?? [:] }
)
