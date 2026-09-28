// «Virée» — a little car drives the map from place to place, stopping to show
// pictures. Port of the variant in `src/shared/roadtrip/hooks/drive.tsx`: its
// id and words, its defaults, what it needs, the key that holds one piece's
// content, which pictures it asks for and what `prepare` returns. The
// arithmetic is `DrivePlan.swift`, a frame's layout `DrivePaint.swift`, the
// car `CarModel.swift`; the strokes and the face — the picker `Sketch`, the
// options `Panel` and the garage it opens (`configureCar`) — are the app's.
//
// A paper map of the trip so far (no tiles, nothing fetched), the road as a
// curve through the stops, and a cartoon Land Cruiser Prado driving it. The
// stops are the legs' located places or the picked pictures' own positions;
// at a stop with pictures the car halts and they pop as prints beside it, or
// fill the frame; when it arrives the map can fade and leave the piece's own
// picture under the badge. It ticks at every stop on the shared kits, with a
// shutter as each print lands.
//
// Rules kept:
// - Never unmet, and not grabbable on the stage: the drive owns the frame and
//   has no box of its own to drag (the web declares no `frameBox`).
// - The car is the TRIP's (`HookContext.car`, the default car when a
//   hand-built context has none); its parts are built on the FIRST frame the
//   app asks for, never in `prepare` — `deckSlides` prepares every slide just
//   to ask how long its hook is.
// - The badge's place reads the last stop the car passed, while it drives on
//   the legs' places and only when asked; once it arrives the badge says its
//   own — the leg's label.

import Foundation

/// What a drive keeps between frames: the trip's car and its model, and the
/// parts — built once, on the first frame that needs them. The web's
/// `DriveScratch` (its reveal buffer is the app's: a transparency layer).
final class DriveScratch: @unchecked Sendable {
    let spec: CarSpec
    let model: CarModel
    private let lock = NSLock()
    private var built: [Mesh3D.Part]?

    init(_ spec: CarSpec) {
        self.spec = spec
        self.model = carModel(spec.model)
    }

    /// The car's parts, built on the first call.
    var parts: [Mesh3D.Part] {
        lock.lock()
        defer { lock.unlock() }
        if let built { return built }
        let made = model.build(spec.gear)
        built = made
        return made
    }
}

/// Virée's drawing: the plan `prepare` built — the one its caption and its
/// score read — with the pictures it was prepared against and the trip's car.
/// The app's painter reads it through `frame(at:_:)` (`DrivePaint.swift`).
public struct DriveDrawing: HookDrawing {
    public let plan: DrivePlan
    public let pictures: [String: HookPicture]?
    /// The car the trip drives.
    public var car: CarSpec { scratch.spec }
    let scratch: DriveScratch

    /// The options the plan was made under.
    public var options: DriveOptions { plan.options }

    public init(plan: DrivePlan, pictures: [String: HookPicture]?, car: CarSpec) {
        self.plan = plan
        self.pictures = pictures
        self.scratch = DriveScratch(car)
    }
}

private func prepareDrive(_ options: HookOptions, _ ctx: HookContext) -> HookRender {
    let o = driveOptions(options)
    let route = driveRoute(ctx.stages ?? [], ctx.calendar ?? [], ctx.date, o)
    guard let plan = drivePlan(route, o) else { return HookRender(seconds: 0) }
    let follows = o.captionFollows && o.stopsOn == .places && route.stops.contains { !$0.name.isEmpty }

    var content: (@Sendable (Double) -> HookContentPatch)? = nil
    if follows {
        content = { t in
            let m = plan.at(t)
            if m.over || t >= plan.schedule.arrivedAt { return [:] }
            guard m.reached < plan.route.stops.count else { return [:] }
            let name = plan.route.stops[m.reached].name
            return name.isEmpty ? [:] : [.caption: .text(name)]
        }
    }
    var score: (@Sendable () -> [SoundEvent])? = nil
    if o.sound { score = { driveScore(plan, o) } }
    return HookRender(
        seconds: plan.seconds,
        content: content,
        drawing: DriveDrawing(plan: plan, pictures: ctx.pictures, car: ctx.car ?? .default),
        score: score,
        mixWithSource: o.sound && o.mixWithClip
    )
}

private func driveWantsPictures(_ options: HookOptions, _ ctx: HookContext) -> [HookPictureWant] {
    let o = driveOptions(options)
    return driveWants(driveRoute(ctx.stages ?? [], ctx.calendar ?? [], ctx.date, o), o)
}

/// The web's `driveVariant`.
public let driveVariant = HookVariant(
    id: "drive",
    name: "Virée",
    tagline: "A little car drives the map from stop to stop, showing pictures",
    defaults: DriveOptions.defaults.json,
    contentKeys: ["picked"],
    needs: HookNeeds(coverage: true, stages: true, places: true, media: .day),
    owns: .frame,
    prepare: { prepareDrive($0, $1) },
    wantsPictures: { driveWantsPictures($0, $1) }
)
