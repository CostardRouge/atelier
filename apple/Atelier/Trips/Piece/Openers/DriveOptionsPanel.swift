// «Virée»'s own options — the panel of `src/shared/roadtrip/hooks/drive.tsx`:
// the road (what the car drives between, its shape, what is ahead, the
// trail), the pictures and the chooser behind them, the car (the sentence
// that describes the TRIP's car, the garage verb, its size and the camera),
// the map, the motion and the ticks.
//
// Rules kept (`roadtrip.md`, «Virée — the car on the map»):
// - The panel says what the drive WILL do — "5 stops, arriving where leg 2
//   ends — Exmouth · 3 pictures on the way · 6.2s · 1 204 km" — or the reason
//   there is no road; what the route leaves out is COUNTED in one sentence,
//   never a guessed spot (`LeftOut`).
// - The car is the TRIP's: a panel may not write the trip, so it opens the
//   garage (`configureCar()`, a draft written on Done) and says the car in
//   `describeCar`'s words; the piece only chooses how big it is drawn and how
//   the camera looks at it.
// - It says when the hook's screen time would cut the drive short.

import SwiftUI
import AtelierKit

/// What the drive will do for this piece, read once per render.
private struct DriveReading {
    let route: DriveRoute
    let plan: DrivePlan?
    let line: (text: String, danger: Bool)?
    let summary: String
    let leftOut: String?
    let cut: String?
    let pickedLocated: Int

    init(_ o: DriveOptions, _ ctx: HookContext, _ status: HookPictureStatus) {
        let stages = ctx.stages ?? []
        let route = driveRoute(stages, ctx.calendar ?? [], ctx.date, o)
        self.route = route
        let plan = drivePlan(route, o)
        self.plan = plan
        line = OpenerPictureLine.line(driveWants(route, o).map(\.key), status, .drive)
        let located = stages.reduce(0) { $0 + $1.places.count }
        pickedLocated = o.picked.filter { $0.coords != nil }.count
        summary = DriveReading.sentence(route, plan, o, located: located)
        leftOut = DriveReading.leftOutLine(route.leftOut, o)
        if let plan, let screen = ctx.screenSeconds, plan.seconds > screen {
            cut = "The hook is on screen for \(OpenerWords.fixed(screen, 1))s, shorter than the drive — the export would cut it before the car arrives. Lengthen the hook in Export, or shorten the drive."
        } else {
            cut = nil
        }
    }

    /// The panel's first line: the real reading, or why there is no road.
    private static func sentence(_ route: DriveRoute, _ plan: DrivePlan?, _ o: DriveOptions, located: Int) -> String {
        guard let last = route.stops.last else {
            if o.stopsOn == .pictures {
                return o.picked.isEmpty
                    ? "No picture picked yet — choose them below; each one shot with a position becomes a stop."
                    : "None of the picked pictures carries a position, so there is nothing to drive between."
            }
            return located == 0
                ? "No leg of this trip has a place with coordinates, so there is no road to drive. Look the places up in the trip’s legs, or drive between picked pictures instead."
                : "No leg with a located place lies on or before this day."
        }
        let n = route.stops.count
        let place: String
        if o.stopsOn == .places {
            if let leg = route.currentLeg {
                place = ", arriving where leg \(leg) ends\(last.name.isEmpty ? "" : " — \(last.name)")"
            } else {
                place = " across every leg"
            }
        } else {
            place = ", in the order the pictures were shot"
        }
        let shown = route.stops.reduce(0) { $0 + $1.pictures.count }
        let pictures = o.pictures == .none
            ? "no picture shown"
            : shown == 0 ? "no picture to show" : "\(shown) \(shown == 1 ? "picture" : "pictures") on the way"
        var out = "\(n) \(n == 1 ? "stop" : "stops")\(place) · \(pictures)"
        if let plan {
            out += " · \(OpenerWords.fixed(plan.seconds, 1))s"
            if o.distance != .off, let km = plan.kmAtStop.last {
                out += " · \(formatDistance(km, o.distance))"
            }
        }
        return out
    }

    /// What the route leaves out, in one sentence, or nil.
    private static func leftOutLine(_ l: LeftOut, _ o: DriveOptions) -> String? {
        var parts: [String] = []
        if l.after > 0 { parts.append("\(l.after) shot after this piece’s day") }
        if l.outside > 0 { parts.append("\(l.outside) shot outside the trip") }
        if l.unlocated > 0 { parts.append("\(l.unlocated) with no position and no stop to ride with") }
        if l.homeless > 0 { parts.append("\(l.homeless) with no position on a day no driven leg covers") }
        if l.crowded > 0 { parts.append("\(l.crowded) past the \(driveMaxPicturesPerStop) a stop can show") }
        guard !parts.isEmpty else { return nil }
        let tail = o.stopsOn == .pictures && l.unlocated > 0
            ? " — a picture needs a position in its EXIF to be a stop."
            : "."
        return "Left out: \(parts.joined(separator: ", "))\(tail)"
    }
}

struct DriveOptionsPanel: View {
    let model: PieceEditorModel
    let ctx: HookContext
    /// Open the host's picture chooser; nil where there is no host.
    let choose: ((OpenerPicturesRequest) -> Void)?

    @Environment(\.palette) private var palette

    private static let stopsOptions: [OverlayPanelOption<DriveStopsOn>] = [
        OverlayPanelOption(.places, "Legs’ places"), OverlayPanelOption(.pictures, "Picked pictures"),
    ]
    private static let pathOptions: [OverlayPanelOption<DrivePath>] = [
        OverlayPanelOption(.curved, "Curved"), OverlayPanelOption(.straight, "Straight"),
    ]
    private static let aheadOptions: [OverlayPanelOption<DriveAhead>] = [
        OverlayPanelOption(.dashed, "Dashed"), OverlayPanelOption(.faint, "Faint"), OverlayPanelOption(.hidden, "Hidden"),
    ]
    private static let pictureOptions: [OverlayPanelOption<DrivePictures>] = [
        OverlayPanelOption(.cards, "Prints"), OverlayPanelOption(.fill, "Fill"),
        OverlayPanelOption(.backdrop, "Behind"), OverlayPanelOption(.none, "None"),
    ]
    private static let groundOptions: [OverlayPanelOption<DriveGround>] = [
        OverlayPanelOption(.paper, "Paper map"), OverlayPanelOption(.picture, "The picture"),
    ]
    private static let positionOptions: [OverlayPanelOption<DrivePosition>] = [
        OverlayPanelOption(.top, "Top"), OverlayPanelOption(.middle, "Middle"), OverlayPanelOption(.bottom, "Bottom"),
    ]
    private static let labelOptions: [OverlayPanelOption<DriveLabels>] = [
        OverlayPanelOption(.none, "None"), OverlayPanelOption(.ends, "The two ends"), OverlayPanelOption(.all, "Every stop"),
    ]
    private static let endOptions: [OverlayPanelOption<DriveEnd>] = [
        OverlayPanelOption(.reveal, "Reveal the picture"), OverlayPanelOption(.stay, "Stay on the map"),
    ]
    private static let cameraOptions: [OverlayPanelOption<DriveCamera>] = [
        OverlayPanelOption(.whole, "Whole route"), OverlayPanelOption(.follow, "Follow the car"),
    ]

    private var o: DriveOptions { driveOptions(model.hookOptions) }

    /// One change, laid over the options as the document holds them now.
    private func set(_ change: (inout DriveOptions) -> Void) {
        var next = driveOptions(model.hookOptions)
        change(&next)
        model.writeOpenerOptions(next.json)
    }

    var body: some View {
        let options = o
        let reading = DriveReading(options, ctx, model.openerPictureStatus)
        OpenerPanelFrame {
            OpenerNote(reading.summary)
            if let leftOut = reading.leftOut { OpenerNote(leftOut, tone: .accent) }
            if let cut = reading.cut { OpenerNote(cut, tone: .accent) }
            OpenerPictureLineView(line: reading.line)
            roadGroup(options, reading)
            picturesGroup(options)
            carGroup(options)
            mapGroup(options)
            mapExtrasGroup(options)
            motionGroup(options)
            soundGroup(options)
        }
    }

    // MARK: - the road

    private func roadGroup(_ o: DriveOptions, _ reading: DriveReading) -> some View {
        let d = DriveOptions.defaults
        let located = reading.pickedLocated > 0 ? " \(reading.pickedLocated) of \(o.picked.count) picked carry one." : ""
        return OpenerGroup(title: "Road") {
            OpenerSegmented(label: "Stops", name: "What the car drives between", selection: o.stopsOn, options: Self.stopsOptions,
                            hint: o.stopsOn == .places
                                ? "The legs’ places with coordinates, the trip so far, arriving where this day’s leg ends. A place gets coordinates when you look it up in the trip’s legs."
                                : "Each picked picture shot with a position is a stop, in the order they were shot; one without rides with the stop before it.\(located)",
                            alignTop: true) { next in set { $0.stopsOn = next } }
            OpenerSegmented(label: "Path", name: "The shape of the road", selection: o.path, options: Self.pathOptions) { next in
                set { $0.path = next }
            }
            OpenerSegmented(label: "Ahead", name: "How the road ahead is drawn", selection: o.ahead, options: Self.aheadOptions,
                            hint: o.ahead == .hidden ? "The road ahead is not drawn: only the trail the car leaves." : nil) { next in
                set { $0.ahead = next }
            }
            OpenerToggleRow(label: "Trail", name: "The trail behind the car", words: "A solid line behind the car", isOn: o.trail) { on in
                set { $0.trail = on }
            }
            OpenerColourPair(label: "Colours", hint: "The trail, then the road ahead.",
                             first: ("Trail colour", o.trailColor), second: ("Road ahead colour", o.aheadColor),
                             changed: o.trailColor != d.trailColor || o.aheadColor != d.aheadColor,
                             onFirst: { c in set { $0.trailColor = c } },
                             onSecond: { c in set { $0.aheadColor = c } },
                             onReset: {
                                 set {
                                     $0.trailColor = d.trailColor
                                     $0.aheadColor = d.aheadColor
                                 }
                             })
            OpenerRange(label: "Width", value: o.lineWidth, range: driveLimits.lineWidth.min...driveLimits.lineWidth.max,
                        step: 0.05, reset: d.lineWidth, format: OpenerWords.percent) { v in set { $0.lineWidth = v } }
        }
    }

    // MARK: - the pictures

    private func picturesGroup(_ o: DriveOptions) -> some View {
        OpenerGroup(title: "Pictures") {
            OpenerSegmented(label: "Shown as", name: "How the pictures are shown", selection: o.pictures,
                            options: Self.pictureOptions, hint: pictureHint(o.pictures)) { next in
                set { $0.pictures = next }
            }
            if o.pictures != .none { pictureRows(o) }
            OpenerToggleRow(label: "Pauses", name: "Pause at every stop", words: "At every stop, pictures or not",
                            isOn: o.pauseEverywhere,
                            hint: o.pauseEverywhere ? "The car pauses a beat at every stop, pictures or not." : nil) { on in
                set { $0.pauseEverywhere = on }
            }
        }
    }

    private func pictureHint(_ pictures: DrivePictures) -> String {
        switch pictures {
        case .cards: return "Prints popping beside the car at each stop, piled like a stack on the map."
        case .fill: return "Each picture fills the frame while the car halts, then the map comes back."
        case .backdrop: return "Each picture takes the paper’s place behind the road and the car while it halts."
        case .none: return "The car drives without stopping for pictures."
        }
    }

    @ViewBuilder
    private func pictureRows(_ o: DriveOptions) -> some View {
        let d = DriveOptions.defaults
        if choose != nil {
            HStack(spacing: 8) {
                Button(o.picked.isEmpty ? "Choose pictures…" : "Change pictures…") { ask(o) }
                    .buttonStyle(StagesButtonStyle(kind: o.picked.isEmpty ? .primary : .plain, small: true))
                if !o.picked.isEmpty {
                    Text(verbatim: "\(o.picked.count) picked")
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.muted)
                }
            }
        } else {
            OpenerNoChooser()
        }
        if o.stopsOn == .places {
            OverlayPanelSwitch("Also the pictures of the days already told", isOn: o.includePieces,
                               hint: "The photo each piece is made from, shown where the leg of its day ends — the leg is dated, the place is not.") { on in
                set { $0.includePieces = on }
            }
        }
        OpenerRange(label: "Per picture", value: o.secondsPerPicture,
                    range: driveLimits.secondsPerPicture.min...driveLimits.secondsPerPicture.max, step: 0.1,
                    reset: d.secondsPerPicture, hint: "How long the car halts for each picture at a stop.",
                    format: OpenerWords.seconds) { v in set { $0.secondsPerPicture = v } }
        if o.pictures == .cards {
            OpenerRange(label: "Print size", value: o.cardSize, range: driveLimits.cardSize.min...driveLimits.cardSize.max,
                        step: 0.05, reset: d.cardSize, format: OpenerWords.percent) { v in set { $0.cardSize = v } }
            OpenerToggleRow(label: "Afterwards", name: "Leave the prints on the map", words: "Leave them on the map",
                            isOn: o.cardsStay,
                            hint: o.cardsStay ? "The prints stay on the map once the car has gone: a collage by the end." : "The prints fade as the car leaves.") { on in
                set { $0.cardsStay = on }
            }
        }
    }

    /// The chooser, opened on what the drive holds; what comes back is picked.
    private func ask(_ o: DriveOptions) {
        choose?(OpenerPicturesRequest(selected: o.picked, choice: HookPictureChoice()) { next in
            set { $0.picked = next }
        })
    }

    // MARK: - the car

    private func carGroup(_ o: DriveOptions) -> some View {
        let car = ctx.car ?? CarSpec.default
        let d = DriveOptions.defaults
        return OpenerGroup(title: "Car") {
            OpenerNote(describeCar(car, carModel(car.model).name))
            Button("Configure the car…") { model.configureCar() }
                .buttonStyle(StagesButtonStyle(small: true))
            OpenerRange(label: "Size", value: o.carSize, range: driveLimits.carSize.min...driveLimits.carSize.max,
                        step: 0.05, reset: d.carSize, format: OpenerWords.percent) { v in set { $0.carSize = v } }
            OpenerRange(label: "Camera", value: o.tilt, range: driveLimits.tilt.min...driveLimits.tilt.max, step: 1,
                        reset: d.tilt,
                        hint: "How steeply the camera looks down at the car: 90° is the map’s own view, lower shows its sides.",
                        format: { "\(OpenerWords.round($0))°" }) { v in set { $0.tilt = v } }
        }
    }

    // MARK: - the map

    @ViewBuilder
    private func mapGroup(_ o: DriveOptions) -> some View {
        let d = DriveOptions.defaults
        OpenerGroup(title: "Map") {
            OpenerSegmented(label: "Ground", name: "What the car drives on", selection: o.ground, options: Self.groundOptions,
                            hint: o.ground == .paper ? "A paper map covers the picture while the car drives." : "The road and the car are drawn over the piece’s own picture.") { next in
                set { $0.ground = next }
            }
            if o.ground == .paper {
                OpenerColourPair(label: "Paper · ink", first: ("Paper colour", o.paperColor), second: ("Ink colour", o.inkColor),
                                 changed: o.paperColor != d.paperColor || o.inkColor != d.inkColor,
                                 onFirst: { c in set { $0.paperColor = c } },
                                 onSecond: { c in set { $0.inkColor = c } },
                                 onReset: {
                                     set {
                                         $0.paperColor = d.paperColor
                                         $0.inkColor = d.inkColor
                                     }
                                 })
                OpenerToggleRow(label: "Paper", name: "Lines of latitude and longitude", words: "Latitude and longitude lines",
                                isOn: o.graticule) { on in set { $0.graticule = on } }
                OpenerToggleRow(label: "", name: "A vignette at the edges", words: "Darkened edges", isOn: o.vignette) { on in
                    set { $0.vignette = on }
                }
            }
            OpenerSegmented(label: "Where", name: "Where the route sits in the frame", selection: o.position,
                            options: Self.positionOptions) { next in set { $0.position = next } }
            OpenerRange(label: "Size", value: o.size, range: driveLimits.size.min...driveLimits.size.max, step: 0.05,
                        reset: d.size, format: OpenerWords.percent) { v in set { $0.size = v } }
        }
    }

    /// The dots, the names and the map's furniture.
    @ViewBuilder
    private func mapExtrasGroup(_ o: DriveOptions) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            OpenerToggleRow(label: "Dots", name: "A dot at every stop", words: "A dot at every stop", isOn: o.dots) { on in
                set { $0.dots = on }
            }
            OverlayPanelPicker("Names", selection: o.labels, options: Self.labelOptions, hint: nameHint(o)) { next in
                set { $0.labels = next }
            }
            if o.labels != .none {
                OpenerRange(label: "Name size", value: o.labelSize,
                            range: driveLimits.labelSize.min...driveLimits.labelSize.max, step: 0.1,
                            reset: DriveOptions.defaults.labelSize, format: OpenerWords.percent) { v in set { $0.labelSize = v } }
            }
            OpenerToggleRow(label: "Furniture", name: "A compass rose", words: "Compass rose", isOn: o.compass) { on in
                set { $0.compass = on }
            }
            OpenerToggleRow(label: "", name: "A scale bar", words: "Scale bar", isOn: o.scaleBar) { on in
                set { $0.scaleBar = on }
            }
            OpenerSegmented(label: "Distance", name: "The distance so far", selection: o.distance, options: OpenerChoices.distances,
                            hint: o.distance == .off ? nil : "The straight-line sum between the stops the car has passed, counting up as it drives — never a road distance.") { next in
                set { $0.distance = next }
            }
        }
    }

    private func nameHint(_ o: DriveOptions) -> String? {
        if o.labels == .none { return nil }
        return o.stopsOn == .places
            ? "The places’ own names, as written in the legs. A name that would sit on another, or on a print, is left out."
            : "The day each stop was shot on. A name that would sit on another, or on a print, is left out."
    }

    // MARK: - the motion

    @ViewBuilder
    private func motionGroup(_ o: DriveOptions) -> some View {
        let d = DriveOptions.defaults
        OpenerGroup(title: "Motion") {
            OpenerRange(label: "Driving", value: o.driveSeconds,
                        range: driveLimits.driveSeconds.min...driveLimits.driveSeconds.max, step: 0.5, reset: d.driveSeconds,
                        hint: "The time on the road, shared between the stops by distance; halts come on top.",
                        format: OpenerWords.seconds) { v in set { $0.driveSeconds = v } }
            OverlayPanelPicker("Motion", selection: o.easing, options: OpenerChoices.easings,
                               hint: OpenerChoices.easingHint(o.easing)) { next in set { $0.easing = next } }
            OpenerRange(label: "Hold first", value: o.delaySeconds,
                        range: driveLimits.delaySeconds.min...driveLimits.delaySeconds.max, step: 0.1, reset: d.delaySeconds,
                        hint: o.delaySeconds > 0 ? "The car sits at the first stop this long before it moves." : nil,
                        format: { OpenerWords.noneOrSeconds($0, 1) }) { v in set { $0.delaySeconds = v } }
            OpenerRange(label: "At the end", value: o.arriveSeconds,
                        range: driveLimits.arriveSeconds.min...driveLimits.arriveSeconds.max, step: 0.1, reset: d.arriveSeconds,
                        hint: "A beat at rest once the car has arrived, after its last pictures.",
                        format: { OpenerWords.noneOrSeconds($0, 1) }) { v in set { $0.arriveSeconds = v } }
            OpenerSegmented(label: "Then", name: "What happens once the car has arrived", selection: o.end, options: Self.endOptions,
                            hint: o.end == .reveal ? "The map fades away and the piece’s own picture is left under the badge." : "The map stays; the piece’s picture is never shown on this slide.") { next in
                set { $0.end = next }
            }
            cameraRows(o)
        }
    }

    @ViewBuilder
    private func cameraRows(_ o: DriveOptions) -> some View {
        OpenerSegmented(label: "Camera", name: "How the camera moves", selection: o.camera, options: Self.cameraOptions,
                        hint: o.camera == .whole ? "The whole route fits the frame from the first frame; only the car moves." : "The map scrolls under a car held at the centre.") { next in
            set { $0.camera = next }
        }
        if o.camera == .follow {
            OpenerRange(label: "Zoom", value: o.followZoom,
                        range: driveLimits.followZoom.min...driveLimits.followZoom.max, step: 0.05,
                        reset: DriveOptions.defaults.followZoom, hint: "The share of the route the view spans while following.",
                        format: OpenerWords.percent) { v in set { $0.followZoom = v } }
        }
        if o.stopsOn == .places {
            OverlayPanelSwitch("The badge’s place follows the car", isOn: o.captionFollows,
                               hint: "While the car drives, the badge’s place reads the last stop it passed; once it arrives the badge says its own.") { on in
                set { $0.captionFollows = on }
            }
        }
    }

    // MARK: - the ticks

    private func soundGroup(_ o: DriveOptions) -> some View {
        OpenerGroup(title: "Sound") {
            OverlayPanelSwitch("Tick at every stop the car reaches", isOn: o.sound,
                               hint: "A deeper tick where a leg begins (or a new day), a low seat when the car arrives. A photo, or a clip recorded without sound, takes the ticks as its sound.") { on in
                set { $0.sound = on }
            }
            if o.sound { soundRows(o) }
        }
    }

    @ViewBuilder
    private func soundRows(_ o: DriveOptions) -> some View {
        OverlayPanelPicker("Voice", selection: o.kit, options: OpenerChoices.kits, hint: o.kit.spec.hint) { next in
            set { $0.kit = next }
        }
        if o.pictures != .none {
            OpenerToggleRow(label: "Shutter", name: "A shutter click as each picture pops", words: "A click as each picture lands",
                            isOn: o.shutter) { on in set { $0.shutter = on } }
        }
        OpenerRange(label: "Pitch", value: o.tickPitch, range: driveLimits.tickPitch.min...driveLimits.tickPitch.max,
                    step: 0.05, reset: 1, format: OpenerWords.pitch) { v in set { $0.tickPitch = v } }
        OpenerRange(label: "Volume", value: o.tickVolume, range: driveLimits.tickVolume.min...driveLimits.tickVolume.max,
                    step: 0.05, reset: 1, hint: o.tickVolume == 0 ? "At 0% no sound track is written for the ticks at all." : nil,
                    format: OpenerWords.percent) { v in set { $0.tickVolume = v } }
        OpenerToggleRow(label: "Mix in", name: "Mix the ticks into a clip’s own sound", words: "Into a clip’s own sound",
                        isOn: o.mixWithClip,
                        hint: "Off, a clip that has sound keeps it bit-for-bit and goes out without the ticks. On, its sound is decoded, the ticks are added, and it is re-encoded.") { on in
            set { $0.mixWithClip = on }
        }
    }
}

#Preview("Virée") {
    ScrollView {
        let model = OpenerFixtures.model(driveVariant.id)
        DriveOptionsPanel(model: model, ctx: model.hookState!.ctx, choose: { _ in })
            .padding(16)
    }
    .frame(width: 360, height: 1400)
    .darkroom()
}
