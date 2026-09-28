// «Itinerary»'s own options — the panel of `src/shared/roadtrip/hooks/map.tsx`:
// the stops (`MapStopsSection`, with its picking map), then how a stop's
// picture is presented, where the map sits, the path, the places' dots and
// names, the pen's journey, the extras and the ticks.
//
// Rules kept (`roadtrip.md`, «The Itinerary»):
// - The panel says what the itinerary will really do — "4 stops · 2 with a
//   picture · 1 204 km · 3.8s" — or why there is nothing yet.
// - A stop with no picture draws NOTHING: no picture stands in for a missing
//   one ("a card captioned “Exmouth” showing Coral Bay is the one thing this
//   tool must not do"), so when the pen comes to rest on a stop that has none
//   the panel says the opener ends empty.
// - The distance is the straight-line sum between the stops reached — never
//   a road distance — and says so.

import SwiftUI
import AtelierKit

struct MapOptionsPanel: View {
    let model: PieceEditorModel
    let ctx: HookContext
    /// Open the host's picture chooser; nil where there is no host.
    let choose: ((OpenerPicturesRequest) -> Void)?

    private static let mediaOptions: [OverlayPanelOption<MapMedia>] = [
        OverlayPanelOption(.off, "Not at all"), OverlayPanelOption(.pin, "Pinned at the stop"),
        OverlayPanelOption(.card, "On a card under the map"), OverlayPanelOption(.backdrop, "Filling the frame behind"),
        OverlayPanelOption(.strip, "A strip along the edge"),
    ]
    private static let mountOptions: [OverlayPanelOption<MapMediaFrame>] = [
        OverlayPanelOption(.paper, "On paper"), OverlayPanelOption(.bare, "Bare"),
    ]
    private static let positionOptions: [OverlayPanelOption<MapPosition>] = [
        OverlayPanelOption(.top, "Top"), OverlayPanelOption(.middle, "Middle"), OverlayPanelOption(.bottom, "Bottom"),
    ]
    private static let alignOptions: [OverlayPanelOption<MapAlign>] = [
        OverlayPanelOption(.left, "Left"), OverlayPanelOption(.center, "Centre"), OverlayPanelOption(.right, "Right"),
    ]
    private static let aheadOptions: [OverlayPanelOption<MapAhead>] = [
        OverlayPanelOption(.dashed, "Dashed"), OverlayPanelOption(.faint, "Faint"), OverlayPanelOption(.hidden, "Hidden"),
    ]
    private static let labelOptions: [OverlayPanelOption<MapLabels>] = [
        OverlayPanelOption(.none, "None"), OverlayPanelOption(.ends, "The first and the last"),
        OverlayPanelOption(.current, "Where the pen is"), OverlayPanelOption(.passed, "Everywhere it has been"),
        OverlayPanelOption(.all, "Every stop"),
    ]
    private static let penOptions: [OverlayPanelOption<MapPen>] = [
        OverlayPanelOption(.dot, "A dot"), OverlayPanelOption(.plane, "A plane"), OverlayPanelOption(.none, "Bare line"),
    ]

    private var o: MapOptions { mapOptions(model.hookOptions) }

    /// One change, laid over the options as the document holds them now.
    private func set(_ change: (inout MapOptions) -> Void) {
        var next = mapOptions(model.hookOptions)
        change(&next)
        model.writeOpenerOptions(next.json.objectValue ?? [:])
    }

    var body: some View {
        let options = o
        OpenerPanelFrame {
            OpenerNote(summary(options))
            if let cut = cut(options) { OpenerNote(cut, tone: .accent) }
            MapStopsSection(model: model, ctx: ctx, choose: choose)
            picturesGroup(options)
            frameGroup(options)
            pathGroup(options)
            placesGroup(options)
            motionGroup(options)
            extrasGroup(options)
            soundGroup(options)
        }
    }

    // MARK: - what it will do

    /// The real reading, or why there is none yet.
    private func summary(_ o: MapOptions) -> String {
        let places = tripPlaces(ctx.stages)
        switch o.stops.count {
        case 0:
            return places.isEmpty
                ? "No stops yet, and the trip has no place with coordinates to start from. \(OpenerWords.click) the map, or search for a place."
                : "No stops yet. \(OpenerWords.click) the map, take the trip’s own places, or search for one."
        case 1:
            return "One stop — a map with a single point and no path. Add another to draw a line."
        default:
            let timing = mapTiming(planarHops(o.stops), o)
            let withPictures = o.stops.filter { $0.picture != nil }.count
            let totalKm = hopKms(o.stops).reduce(0, +)
            let distance = formatDistance(totalKm, o.distance == .off ? .km : o.distance)
            let time = timing.total > 0 ? " · \(OpenerWords.fixed(timing.total, 1))s" : " · still"
            return "\(o.stops.count) stops · \(withPictures) with a picture · \(distance)\(time)"
        }
    }

    /// The hook's screen time cutting the journey short, said.
    private func cut(_ o: MapOptions) -> String? {
        guard let screen = ctx.screenSeconds, !o.stops.isEmpty else { return nil }
        let timing = mapTiming(planarHops(o.stops), o)
        guard timing.total > screen else { return nil }
        return "The hook is on screen for \(OpenerWords.fixed(screen, 1))s, shorter than the journey — the export would cut it before the pen arrives. Lengthen the hook in Export, or shorten the drawing."
    }

    // MARK: - the pictures

    private func mediaHint(_ media: MapMedia) -> String {
        switch media {
        case .off: return "The map alone. Nothing a stop holds is fetched or drawn."
        case .pin: return "A small picture beside each stop’s dot, arriving as the pen lands. Several are on screen at once."
        case .card: return "One picture under the map, cross-fading, with the stop’s name under it."
        case .backdrop: return "The picture fills the frame behind the map, dimmed so the line survives. A stop with no picture lets your own picture back through."
        case .strip: return "Every stop’s picture in a row along the edge; the ones still ahead are held back."
        }
    }

    @ViewBuilder
    private func picturesGroup(_ o: MapOptions) -> some View {
        let withPictures = o.stops.filter { $0.picture != nil }.count
        OpenerGroup(title: "Pictures") {
            OverlayPanelPicker("Shown as", selection: o.media, options: Self.mediaOptions, hint: mediaHint(o.media)) { next in
                set { $0.media = next }
            }
            if o.media != .off && withPictures == 0 {
                OpenerNote("No stop holds a picture yet — pick one on a stop above, and it appears here.", tone: .accent)
            }
            if let empty = emptyEnd(o, withPictures) { OpenerNote(empty, tone: .accent) }
            if o.media != .off { pictureRows(o) }
        }
    }

    /// One picture at a time, and the pen comes to rest on a stop that has
    /// none: the frame ends empty — said here, never stood in for.
    private func emptyEnd(_ o: MapOptions, _ withPictures: Int) -> String? {
        guard o.media == .card || o.media == .backdrop, withPictures > 0, let last = o.stops.last, last.picture == nil
        else { return nil }
        let name = last.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let showing = o.media == .backdrop ? "your own picture again" : "nothing"
        return "The pen comes to rest on \(name.isEmpty ? "the last stop" : name), which has no picture — so the opener ends showing \(showing). Nothing stands in for a stop that holds none."
    }

    @ViewBuilder
    private func pictureRows(_ o: MapOptions) -> some View {
        let d = MapOptions.defaults
        if o.media != .backdrop {
            OpenerRange(label: "Size", value: o.mediaSize, range: mapLimits.mediaSize.min...mapLimits.mediaSize.max,
                        step: 0.05, reset: d.mediaSize, format: OpenerWords.percent) { v in set { $0.mediaSize = v } }
        }
        OpenerRange(label: "Arrival", value: o.mediaFade, range: mapLimits.mediaFade.min...mapLimits.mediaFade.max,
                    step: 0.05, reset: d.mediaFade,
                    hint: o.mediaFade == 0 ? "A picture appears on the frame the pen lands." : nil,
                    format: { $0 == 0 ? "at once" : "\(OpenerWords.fixed($0, 2))s" }) { v in set { $0.mediaFade = v } }
        if o.media == .pin || o.media == .card || o.media == .strip {
            OpenerSegmented(label: "Mount", name: "How a picture is mounted", selection: o.mediaFrame, options: Self.mountOptions,
                            hint: o.mediaFrame == .paper ? "Paper around the picture — and where a card’s name goes." : nil) { next in
                set { $0.mediaFrame = next }
            }
        }
        if o.media == .pin {
            OpenerToggleRow(label: "Pins", name: "Pins stay once they have appeared", words: "They stay as the pen goes on",
                            isOn: o.pinKeep) { on in set { $0.pinKeep = on } }
            OpenerToggleRow(label: "Stem", name: "A stem to the dot", words: "A stem to the dot", isOn: o.pinStem,
                            hint: "A hairline from the picture to the dot it belongs to.") { on in set { $0.pinStem = on } }
        }
        if o.media == .backdrop {
            OpenerRange(label: "Dim", value: o.mediaDim, range: mapLimits.mediaDim.min...mapLimits.mediaDim.max, step: 0.05,
                        reset: d.mediaDim, hint: "How far the picture behind is darkened, so the line stays legible over it.",
                        format: OpenerWords.percent) { v in set { $0.mediaDim = v } }
        }
    }

    // MARK: - the frame

    @ViewBuilder
    private func frameGroup(_ o: MapOptions) -> some View {
        let d = MapOptions.defaults
        OpenerGroup(title: "Frame") {
            OpenerSegmented(label: "Where", name: "Where the map sits", selection: o.position, options: Self.positionOptions) { next in
                set { $0.position = next }
            }
            OpenerSegmented(label: "Align", name: "Which side the map keeps to", selection: o.align, options: Self.alignOptions) { next in
                set { $0.align = next }
            }
            OpenerRange(label: "Size", value: o.size, range: mapLimits.size.min...mapLimits.size.max, step: 0.05,
                        reset: d.size, format: OpenerWords.percent) { v in set { $0.size = v } }
            if mapMoved(o) {
                OpenerMovedRow(offsetX: o.offsetX, offsetY: o.offsetY) {
                    set {
                        $0.offsetX = 0
                        $0.offsetY = 0
                    }
                }
            }
            plateRows(o)
            OpenerToggleRow(label: "Grid", name: "A lat/lon grid", words: "A chart’s grid", isOn: o.graticule,
                            hint: o.graticule ? "Whole degrees of latitude and longitude, faint behind the line." : nil) { on in
                set { $0.graticule = on }
            }
        }
    }

    @ViewBuilder
    private func plateRows(_ o: MapOptions) -> some View {
        let d = MapOptions.defaults
        OpenerToggleRow(label: "Plate", name: "Plate behind the map", words: "Behind the map", isOn: o.plate,
                        hint: o.plate ? nil : "A translucent panel behind the map, for a map over a busy picture.") { on in
            set { $0.plate = on }
        }
        if o.plate {
            OpenerRange(label: "Plate depth", value: o.plateOpacity,
                        range: mapLimits.plateOpacity.min...mapLimits.plateOpacity.max, step: 0.05, reset: d.plateOpacity,
                        format: OpenerWords.percent) { v in set { $0.plateOpacity = v } }
            OverlayPanelRow("Plate colour") {
                OverlayPanelColourWell("Plate colour", css: o.plateColor) { c in set { $0.plateColor = c } }
                if o.plateColor != d.plateColor {
                    Button("Reset") { set { $0.plateColor = d.plateColor } }
                        .buttonStyle(DevelopLinkButtonStyle())
                }
            }
        }
    }

    // MARK: - the path

    @ViewBuilder
    private func pathGroup(_ o: MapOptions) -> some View {
        let d = MapOptions.defaults
        OpenerGroup(title: "Path") {
            OpenerRange(label: "Width", value: o.lineWidth, range: mapLimits.lineWidth.min...mapLimits.lineWidth.max,
                        step: 0.05, reset: d.lineWidth, format: OpenerWords.percent) { v in set { $0.lineWidth = v } }
            OpenerRange(label: "Bow", value: o.curve, range: mapLimits.curve.min...mapLimits.curve.max, step: 0.02,
                        reset: d.curve,
                        hint: o.curve == 0 ? "Straight lines between the stops." : "Each hop bows away from the straight line — a travel map’s idiom, and what keeps a there-and-back from drawing one line twice.",
                        format: { $0 == 0 ? "straight" : OpenerWords.percent($0) }) { v in set { $0.curve = v } }
            OpenerColourPair(label: "Colours", hint: "The path travelled, then the stops still ahead.",
                             first: ("Path colour", o.pathColor), second: ("Colour of what is still ahead", o.aheadColor),
                             changed: o.pathColor != d.pathColor || o.aheadColor != d.aheadColor,
                             onFirst: { c in set { $0.pathColor = c } },
                             onSecond: { c in set { $0.aheadColor = c } },
                             onReset: {
                                 set {
                                     $0.pathColor = d.pathColor
                                     $0.aheadColor = d.aheadColor
                                 }
                             })
            OpenerSegmented(label: "Ahead", name: "How what is still ahead is drawn", selection: o.aheadStyle,
                            options: Self.aheadOptions,
                            hint: o.aheadStyle == .hidden ? "Nothing ahead of the pen is drawn: the map grows as it travels." : "The stops still to come are already there, so the shape of the journey is readable from the first frame.") { next in
                set { $0.aheadStyle = next }
            }
            OpenerToggleRow(label: "Underlay", name: "Dark underlay under the line", words: "Dark edge under everything",
                            isOn: o.underlay,
                            hint: o.underlay ? nil : "Without the dark underlay a light line can vanish over a pale sky.") { on in
                set { $0.underlay = on }
            }
        }
    }

    // MARK: - the places

    @ViewBuilder
    private func placesGroup(_ o: MapOptions) -> some View {
        let free = otherPlaces(ctx.stages, o.stops)
        let d = MapOptions.defaults
        OpenerGroup(title: "Places") {
            OpenerToggleRow(label: "Dots", name: "A dot at every stop", words: "A dot at every stop", isOn: o.dots) { on in
                set { $0.dots = on }
            }
            if o.dots {
                OpenerRange(label: "Dot size", value: o.dotSize, range: mapLimits.dotSize.min...mapLimits.dotSize.max,
                            step: 0.1, reset: d.dotSize, format: OpenerWords.percent) { v in set { $0.dotSize = v } }
                OpenerToggleRow(label: "Numbers", name: "Number the stops", words: "1, 2, 3 on the dots", isOn: o.numbers,
                                hint: o.numbers ? "Each dot carries its place in the order." : nil) { on in set { $0.numbers = on } }
            }
            OverlayPanelPicker("Names", selection: o.labels, options: Self.labelOptions, hint: namesHint(o.labels)) { next in
                set { $0.labels = next }
            }
            if o.labels != .none {
                OpenerRange(label: "Name size", value: o.labelSize, range: mapLimits.labelSize.min...mapLimits.labelSize.max,
                            step: 0.1, reset: d.labelSize, format: OpenerWords.percent) { v in set { $0.labelSize = v } }
            }
            OpenerToggleRow(label: "Trip’s places", name: "Show the trip’s other places", words: "Faint, behind", isOn: o.context,
                            hint: free.isEmpty
                                ? "Every located place of the trip is already a stop."
                                : "The \(free.count) other located \(free.count == 1 ? "place" : "places") of the trip, as faint marks behind the itinerary.") { on in
                set { $0.context = on }
            }
        }
    }

    private func namesHint(_ labels: MapLabels) -> String? {
        switch labels {
        case .none: return nil
        case .passed:
            return "A name appears as the pen reaches its stop and stays — the itinerary reads as a list being written. One that would sit on another name, or on a picture, is left out."
        default:
            return "The names you gave the stops. One that would sit on another name, or on a picture, is left out."
        }
    }

    // MARK: - the journey

    private func motionGroup(_ o: MapOptions) -> some View {
        OpenerGroup(title: "Motion") {
            OverlayPanelSwitch("Travel the itinerary, stop by stop", isOn: o.draw,
                               hint: o.draw ? nil : "The whole itinerary is there from the first frame, and the hook takes no time of its own.") { on in
                set { $0.draw = on }
            }
            if o.draw { journeyRows(o) }
        }
    }

    @ViewBuilder
    private func journeyRows(_ o: MapOptions) -> some View {
        let d = MapOptions.defaults
        OpenerRange(label: "Travel", value: o.drawSeconds, range: mapLimits.drawSeconds.min...mapLimits.drawSeconds.max,
                    step: 0.1, reset: d.drawSeconds,
                    hint: "Shared out by distance, so the pen keeps one pace — a long hop takes longer than a short one.",
                    format: OpenerWords.seconds) { v in set { $0.drawSeconds = v } }
        OpenerRange(label: "Wait", value: o.dwellSeconds, range: mapLimits.dwellSeconds.min...mapLimits.dwellSeconds.max,
                    step: 0.05, reset: d.dwellSeconds,
                    hint: o.dwellSeconds == 0
                        ? "The pen does not stop — with pictures on, each one is on screen only while the next hop runs."
                        : "The pen waits at each stop it reaches, including the last, which is what gives a picture time to be looked at.",
                    format: { OpenerWords.noneOrSeconds($0, 2) }) { v in set { $0.dwellSeconds = v } }
        OverlayPanelPicker("Motion", selection: o.easing, options: OpenerChoices.easings,
                           hint: "\(OpenerChoices.easingHint(o.easing)) — on every hop.") { next in set { $0.easing = next } }
        OpenerRange(label: "Hold first", value: o.delaySeconds, range: mapLimits.delaySeconds.min...mapLimits.delaySeconds.max,
                    step: 0.1, reset: d.delaySeconds,
                    hint: o.delaySeconds > 0 ? "The map sits on its first stop this long before the pen leaves." : nil,
                    format: { OpenerWords.noneOrSeconds($0, 1) }) { v in set { $0.delaySeconds = v } }
        OpenerSegmented(label: "Pen", name: "What travels along the path", selection: o.pen, options: Self.penOptions) { next in
            set { $0.pen = next }
        }
    }

    // MARK: - the extras

    private func extrasGroup(_ o: MapOptions) -> some View {
        OpenerGroup(title: "Extras") {
            OpenerToggleRow(label: "Compass", name: "A north arrow", words: "A north arrow", isOn: o.compass,
                            hint: o.compass ? "North is up because the projection is; the arrow says so." : nil) { on in
                set { $0.compass = on }
            }
            OpenerSegmented(label: "Distance", name: "The distance travelled", selection: o.distance, options: OpenerChoices.distances,
                            hint: o.distance == .off ? nil : "The straight-line sum between the stops the pen has reached — never a road distance. It counts up with the pen.") { next in
                set { $0.distance = next }
            }
            OpenerToggleRow(label: "In the badge", name: "The badge names the stop the pen is at", words: "The caption follows the pen",
                            isOn: o.nameInBadge,
                            hint: o.nameInBadge
                                ? "The badge’s caption says the stop the pen is at, and the last one once it rests. A stop with no name leaves the caption as it was."
                                : "The badge keeps its own caption — the leg this day belongs to.") { on in
                set { $0.nameInBadge = on }
            }
        }
    }

    // MARK: - the ticks

    private func soundGroup(_ o: MapOptions) -> some View {
        OpenerGroup(title: "Sound") {
            OverlayPanelSwitch("Tick at every stop the pen reaches", isOn: o.sound,
                               hint: !o.draw
                                   ? "The ticks follow the pen: switch the travelling on for them to play."
                                   : "A deeper tick as it leaves, a low seat where it comes to rest. A photo, or a clip recorded without sound, takes the ticks as its sound.") { on in
                set { $0.sound = on }
            }
            if o.sound { soundRows(o) }
        }
    }

    @ViewBuilder
    private func soundRows(_ o: MapOptions) -> some View {
        OverlayPanelPicker("Voice", selection: o.kit, options: OpenerChoices.kits, hint: o.kit.spec.hint) { next in
            set { $0.kit = next }
        }
        OpenerRange(label: "Pitch", value: o.tickPitch, range: mapLimits.tickPitch.min...mapLimits.tickPitch.max,
                    step: 0.05, reset: 1, format: OpenerWords.pitch) { v in set { $0.tickPitch = v } }
        OpenerRange(label: "Volume", value: o.tickVolume, range: mapLimits.tickVolume.min...mapLimits.tickVolume.max,
                    step: 0.05, reset: 1, hint: o.tickVolume == 0 ? "At 0% no sound track is written for the ticks at all." : nil,
                    format: OpenerWords.percent) { v in set { $0.tickVolume = v } }
        OpenerToggleRow(label: "Mix in", name: "Mix the ticks into a clip’s own sound", words: "Into a clip’s own sound",
                        isOn: o.mixWithClip,
                        hint: "Off, a clip that has sound keeps it bit-for-bit and goes out without the ticks. On, its sound is decoded, the ticks are added, and it is re-encoded.") { on in
            set { $0.mixWithClip = on }
        }
    }
}

#Preview("Itinerary") {
    ScrollView {
        let model = OpenerFixtures.model(mapVariant.id)
        MapOptionsPanel(model: model, ctx: model.hookState!.ctx, choose: { _ in })
            .padding(16)
    }
    .frame(width: 360, height: 1600)
    .darkroom()
}
