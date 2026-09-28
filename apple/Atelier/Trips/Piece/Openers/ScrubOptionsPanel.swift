// «Défilé»'s own options — the panel of `src/shared/roadtrip/hooks/scrub.tsx`:
// what the sweep stops on and how many, the strip of what each stop will
// flash, the picked pictures and the chooser behind them, the sweep's length
// and motion, the tape, and the ticks.
//
// Rules kept (`roadtrip.md`, «Défilé flashes SOURCE pictures»):
// - The panel says what the sweep WILL do for this piece — the counter
//   modes' rule: the real line ("12 stops from day 1 · 6 told days flash ·
//   1.9s"), or the reason there is none; a told day whose piece has no
//   picture yet is said as such, never counted as a flash.
// - It says when the hook's screen time would cut the sweep short, and when a
//   stop is under three frames — a flicker, not pictures.
// - The strip is READ-ONLY: what flashes is decided by the controls above
//   it, never by poking a tile. A tile shows the picture that will flash
//   there once the host has decoded it, else the day on a dark tile — which
//   is exactly what the sweep draws for a stop with nothing to show.
// - Pictures shot after the piece's day, or outside the trip, are COUNTED
//   and said to be left out: they have no place on the tape before this day.
// - The numeral steps with the head only under the trip-day counter; any
//   other counter keeps its own reading, and the panel says so.

import SwiftUI
import AtelierKit

/// What the sweep will do for this piece, read once per render.
private struct ScrubReading {
    let plan: ScrubPlan?
    let flashing: [ScrubStop]
    let line: (text: String, danger: Bool)?
    let split: PickedPartition?
    let summary: String?
    let cut: String?
    let flicker: String?

    init(_ o: ScrubOptions, _ ctx: HookContext, _ status: HookPictureStatus) {
        let calendar = ctx.calendar
        let plan = calendar.flatMap { scrubPlan($0, ctx.date, o) }
        self.plan = plan
        let flashing = plan?.stops.filter { !$0.hero } ?? []
        self.flashing = flashing
        var keys: [String] = []
        for stop in flashing {
            if let key = stop.pictureKey, !keys.contains(key) { keys.append(key) }
        }
        line = o.flash ? OpenerPictureLine.line(keys, status, .scrub) : nil
        split = calendar.map { partitionPicked($0, ctx.date, o.picked) }
        summary = plan.map { ScrubReading.sentence($0, flashing, o) }
        if let plan, let screen = ctx.screenSeconds, plan.endSeconds > screen {
            cut = "The hook is on screen for \(OpenerWords.fixed(screen, 1))s, shorter than the sweep — the export would cut it before it lands. Lengthen the hook in Export, or shorten the sweep."
        } else {
            cut = nil
        }
        // Past ~3 frames a flash, the pictures stop registering as pictures.
        let perStop = plan.map { $0.stops.count > 1 ? $0.sweepSeconds / Double($0.stops.count - 1) : 1 } ?? 1
        if let plan, plan.stops.count > 2, perStop < 0.1 {
            flicker = "\(OpenerWords.round(perStop * 1000))ms a stop — under three frames, so the pictures read as a flicker rather than as pictures. Fewer stops or a longer sweep."
        } else {
            flicker = nil
        }
    }

    /// The panel's first line: the real reading, or the reason there is none.
    private static func sentence(_ plan: ScrubPlan, _ flashing: [ScrubStop], _ o: ScrubOptions) -> String {
        let picked = o.stopsOn == .picked
        if plan.stops.count < 2 {
            return picked
                ? "No picture picked yet — choose them below, and the sweep runs through them in the order they were shot."
                : "This is the first day of the trip — there is nothing to sweep from."
        }
        let flashes = flashing.filter(\.told).count
        // A told day whose piece has no picture yet is crossed dark: say so
        // rather than count it as a flash.
        let pictured = flashing.filter { $0.told && $0.pictureKey != nil }.count
        let what: String
        if !o.flash {
            what = "no pictures flash"
        } else if picked {
            what = "\(flashes) \(flashes == 1 ? "picture flashes" : "pictures flash")"
        } else if flashes == 0 {
            what = "no other day told yet, so nothing flashes"
        } else if pictured < flashes {
            let none = flashes - pictured
            what = "\(pictured) of \(flashes) told days flash a picture — \(none) \(none == 1 ? "piece has" : "pieces have") none yet"
        } else {
            what = "\(flashes) told \(flashes == 1 ? "day flashes" : "days flash")"
        }
        let delay = plan.delaySeconds > 0 ? " after \(OpenerWords.fixed(plan.delaySeconds, 1))s" : ""
        return "\(plan.stops.count) stops from day \(plan.stops[0].dayNumber) · \(what) · \(OpenerWords.fixed(plan.sweepSeconds, 1))s\(delay)"
    }
}

struct ScrubOptionsPanel: View {
    let model: PieceEditorModel
    let ctx: HookContext
    /// Open the host's picture chooser; nil where there is no host.
    let choose: ((OpenerPicturesRequest) -> Void)?

    @Environment(\.palette) private var palette

    private static let stopsOnOptions: [OverlayPanelOption<ScrubStopsOn>] = [
        OverlayPanelOption(.pieces, "Pieces’ days"), OverlayPanelOption(.picked, "Picked pictures"),
    ]
    private static let modeOptions: [OverlayPanelOption<ScrubMode>] = [
        OverlayPanelOption(.fromStart, "At day 1"), OverlayPanelOption(.runUp, "A few days back"),
    ]
    private static let tapeOptions: [OverlayPanelOption<TapePosition>] = [
        OverlayPanelOption(.bottom, "Bottom"), OverlayPanelOption(.top, "Top"),
    ]
    private static let headOptions: [OverlayPanelOption<ScrubHead>] = [
        OverlayPanelOption(.bar, "Bar"), OverlayPanelOption(.dot, "Dot"), OverlayPanelOption(.needle, "Needle"),
    ]
    private static let driftOptions: [OverlayPanelOption<TickDrift>] = [
        OverlayPanelOption(.flat, "Steady"), OverlayPanelOption(.rising, "Climbing"), OverlayPanelOption(.falling, "Falling"),
    ]

    private var o: ScrubOptions { scrubOptions(model.hookOptions) }

    /// One change, laid over the options as the document holds them now.
    private func set(_ change: (inout ScrubOptions) -> Void) {
        var next = scrubOptions(model.hookOptions)
        change(&next)
        model.writeOpenerOptions(next.json)
    }

    var body: some View {
        let options = o
        let reading = ScrubReading(options, ctx, model.openerPictureStatus)
        OpenerPanelFrame {
            if let summary = reading.summary { OpenerNote(summary) }
            if let cut = reading.cut { OpenerNote(cut, tone: .accent) }
            if let flicker = reading.flicker { OpenerNote(flicker, tone: .accent) }
            stopsGroup(options, reading)
            sweepGroup(options)
            tapeGroup(options)
            tapeLookGroup(options)
            soundGroup(options)
            if let mode = ctx.counterMode, mode != .day {
                OpenerNote("The numeral steps with the head only when the badge counts the day of the trip; under this counter it keeps its own reading.",
                           tone: .faint)
            }
        }
    }

    // MARK: - stops

    @ViewBuilder
    private func stopsGroup(_ o: ScrubOptions, _ reading: ScrubReading) -> some View {
        let picked = o.stopsOn == .picked
        OpenerGroup(title: "Stops") {
            OpenerSegmented(label: "Stops on", name: "What the sweep stops on", selection: o.stopsOn,
                            options: Self.stopsOnOptions, hint: picked
                                ? "One stop a picture you picked, in the order they were shot. Several on one day: the head holds on that day while they change."
                                : "One stop a day another piece tells. Each flashes the picture that piece is made from — the photo itself, not its finished hook. A day nobody told goes dark.",
                            alignTop: true) { next in set { $0.stopsOn = next } }
            if !picked { runUpRows(o) }
            if !reading.flashing.isEmpty { strip(reading.flashing) }
            if picked { pickedRows(o, reading.split) }
            OpenerPictureLineView(line: reading.line)
            OverlayPanelSwitch("Flash each stop’s picture as the head lands", isOn: o.flash) { on in
                set { $0.flash = on }
            }
        }
    }

    @ViewBuilder
    private func runUpRows(_ o: ScrubOptions) -> some View {
        OpenerSegmented(label: "Starts", name: "Where the sweep starts", selection: o.mode, options: Self.modeOptions,
                        hint: o.mode == .fromStart ? "The head leaves day 1 of the trip." : "The head starts a few told days before this one.") { next in
            set { $0.mode = next }
        }
        if o.mode == .runUp {
            OpenerRange(label: "Days back", value: Double(o.runUpDays),
                        range: scrubLimits.runUpDays.min...scrubLimits.runUpDays.max, step: 1,
                        reset: Double(ScrubOptions.defaults.runUpDays),
                        format: { "\(OpenerWords.round($0)) days" }) { v in
                set { $0.runUpDays = OpenerWords.round(v) }
            }
        }
        OpenerRange(label: "Most stops", value: Double(o.maxStops),
                    range: scrubLimits.maxStops.min...scrubLimits.maxStops.max, step: 1,
                    reset: Double(ScrubOptions.defaults.maxStops),
                    format: { "≤ \(OpenerWords.round($0))" }) { v in
            set { $0.maxStops = OpenerWords.round(v) }
        }
    }

    /// The stops before this day, with the picture each flashes.
    private func strip(_ flashing: [ScrubStop]) -> some View {
        let problems = model.hookPictureProblems
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(flashing.enumerated()), id: \.offset) { _, stop in
                    ScrubStopTile(dayNumber: stop.dayNumber, picture: tileImage(stop), legStart: stop.legStart,
                                  problem: stop.pictureKey.flatMap { problems[$0] })
                }
            }
            .padding(.vertical, 2)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("The stops before this day, with the picture each flashes")
    }

    /// The picture a stop will flash, once the host has decoded it.
    private func tileImage(_ stop: ScrubStop) -> CGImage? {
        guard let key = stop.pictureKey, let picture = model.hookPictures[key] else { return nil }
        return ScrubStopTile.image(picture)
    }

    @ViewBuilder
    private func pickedRows(_ o: ScrubOptions, _ split: PickedPartition?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
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
            if let split, split.after > 0 || split.outside > 0 {
                OpenerNote(leftOut(split), tone: .accent)
            }
            if let split, split.inReach.count > pickedMaxStops {
                OpenerNote("\(split.inReach.count) pictures in reach; the sweep shows \(pickedMaxStops) of them, spread evenly from the first to the last.",
                           tone: .muted)
            }
        }
    }

    private func leftOut(_ split: PickedPartition) -> String {
        var parts: [String] = []
        if split.after > 0 { parts.append("\(split.after) shot after this piece’s day") }
        if split.outside > 0 { parts.append("\(split.outside) shot outside the trip") }
        return "\(parts.joined(separator: " and ")) — left out: they have no place on the tape before this day."
    }

    /// The chooser, opened on what the sweep holds; what comes back is picked.
    private func ask(_ o: ScrubOptions) {
        choose?(OpenerPicturesRequest(selected: o.picked, choice: HookPictureChoice()) { next in
            set {
                $0.stopsOn = .picked
                $0.picked = next
            }
        })
    }

    // MARK: - the sweep

    private func sweepGroup(_ o: ScrubOptions) -> some View {
        OpenerGroup(title: "Sweep") {
            OpenerRange(label: "Length", value: o.sweepSeconds,
                        range: scrubLimits.sweepSeconds.min...scrubLimits.sweepSeconds.max, step: 0.1,
                        reset: ScrubOptions.defaults.sweepSeconds, format: OpenerWords.seconds) { v in
                set { $0.sweepSeconds = v }
            }
            OverlayPanelPicker("Motion", selection: o.easing, options: OpenerChoices.easings,
                               hint: OpenerChoices.easingHint(o.easing)) { next in
                set { $0.easing = next }
            }
            OpenerRange(label: "Hold first", value: o.delaySeconds,
                        range: scrubLimits.delaySeconds.min...scrubLimits.delaySeconds.max, step: 0.1,
                        reset: ScrubOptions.defaults.delaySeconds,
                        hint: o.delaySeconds > 0 ? "The frame sits on the first stop this long before the head moves." : nil,
                        format: { OpenerWords.noneOrSeconds($0, 1) }) { v in
                set { $0.delaySeconds = v }
            }
        }
    }

    // MARK: - the tape

    @ViewBuilder
    private func tapeGroup(_ o: ScrubOptions) -> some View {
        let d = ScrubOptions.defaults
        OpenerGroup(title: "Tape") {
            OpenerSegmented(label: "Runs", name: "Where the tape runs", selection: o.tape, options: Self.tapeOptions) { next in
                set { $0.tape = next }
            }
            OpenerRange(label: "Width", value: o.tapeWidth,
                        range: scrubLimits.tapeWidth.min...scrubLimits.tapeWidth.max, step: 0.02,
                        reset: d.tapeWidth, format: OpenerWords.percent) { v in set { $0.tapeWidth = v } }
            OpenerRange(label: "From edge", value: o.edgeOffset,
                        range: scrubLimits.edgeOffset.min...scrubLimits.edgeOffset.max, step: 0.005,
                        reset: d.edgeOffset, format: { "\(OpenerWords.fixed($0 * 100, 1))%" }) { v in
                set { $0.edgeOffset = v }
            }
            if tapeMoved(o) {
                OpenerMovedRow(offsetX: o.offsetX, offsetY: o.offsetY) {
                    set {
                        $0.offsetX = 0
                        $0.offsetY = 0
                    }
                }
            }
            OpenerColourPair(label: "Colours", hint: "The ticks ahead, then the head and the days it has passed.",
                             first: ("Ticks colour", o.tickColor), second: ("Head and passed days colour", o.passedColor),
                             changed: o.tickColor != d.tickColor || o.passedColor != d.passedColor,
                             onFirst: { c in set { $0.tickColor = c } },
                             onSecond: { c in set { $0.passedColor = c } },
                             onReset: {
                                 set {
                                     $0.tickColor = d.tickColor
                                     $0.passedColor = d.passedColor
                                 }
                             })
            OpenerRange(label: "Opacity", value: o.tickOpacity,
                        range: scrubLimits.tickOpacity.min...scrubLimits.tickOpacity.max, step: 0.05,
                        reset: d.tickOpacity, format: OpenerWords.percent) { v in set { $0.tickOpacity = v } }
            OpenerRange(label: "Height", value: o.tickHeight,
                        range: scrubLimits.tickHeight.min...scrubLimits.tickHeight.max, step: 0.1,
                        reset: d.tickHeight, format: OpenerWords.percent) { v in set { $0.tickHeight = v } }
            OpenerRange(label: "Spacing", value: o.tickGap,
                        range: scrubLimits.tickGap.min...scrubLimits.tickGap.max, step: 1, reset: d.tickGap,
                        hint: "The least room between two ticks. A long trip thins its ticks to keep it; a leg's start and the trip's ends always draw.",
                        format: { $0 <= 5 ? "fine" : $0 <= 12 ? "normal" : "coarse" }) { v in
                set { $0.tickGap = v }
            }
        }
    }

    /// The head, the track and the band — the rest of the tape's rows.
    @ViewBuilder
    private func tapeLookGroup(_ o: ScrubOptions) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            OpenerSegmented(label: "Head", name: "The shape of the reading head", selection: o.headStyle,
                            options: Self.headOptions) { next in set { $0.headStyle = next } }
            OpenerToggleRow(label: "Glow", name: "Glow behind the head", words: "Behind the head", isOn: o.headGlow) { on in
                set { $0.headGlow = on }
            }
            OpenerToggleRow(label: "Track", name: "Draw the track line", words: "The line the ticks stand on",
                            isOn: o.showTrack) { on in set { $0.showTrack = on } }
            OpenerToggleRow(label: "Band", name: "Dark band behind the tape", words: "Behind the tape", isOn: o.tapeBackground,
                            hint: o.tapeBackground ? nil : "A dark band behind the tape, for a tape over a bright picture.") { on in
                set { $0.tapeBackground = on }
            }
            if o.tapeBackground {
                OpenerRange(label: "Band depth", value: o.backgroundOpacity,
                            range: scrubLimits.backgroundOpacity.min...scrubLimits.backgroundOpacity.max, step: 0.05,
                            reset: ScrubOptions.defaults.backgroundOpacity, format: OpenerWords.percent) { v in
                    set { $0.backgroundOpacity = v }
                }
            }
            OpenerToggleRow(label: "Ends", name: "Fade the tape's ends", words: "Fade out at both ends", isOn: o.edgeFade,
                            hint: o.edgeFade ? "Ticks, track and band fade out over the tape’s two ends." : nil) { on in
                set { $0.edgeFade = on }
            }
        }
    }

    // MARK: - the ticks

    private func soundGroup(_ o: ScrubOptions) -> some View {
        OpenerGroup(title: "Sound") {
            OverlayPanelSwitch("Tick at every day it lands on", isOn: o.sound,
                               hint: "A photo, or a clip recorded without sound (most drone footage), takes the ticks as its sound. Most feeds play muted: the sweep says everything without them.") { on in
                set { $0.sound = on }
            }
            if o.sound { soundRows(o) }
        }
    }

    @ViewBuilder
    private func soundRows(_ o: ScrubOptions) -> some View {
        OverlayPanelPicker("Voice", selection: o.kit, options: OpenerChoices.kits, hint: o.kit.spec.hint) { next in
            set { $0.kit = next }
        }
        OpenerRange(label: "Pitch", value: o.tickPitch,
                    range: scrubLimits.tickPitch.min...scrubLimits.tickPitch.max, step: 0.05, reset: 1,
                    format: OpenerWords.pitch) { v in set { $0.tickPitch = v } }
        OpenerSegmented(label: "Drift", name: "How the pitch moves along the sweep", selection: o.pitchDrift,
                        options: Self.driftOptions,
                        hint: o.pitchDrift == .flat ? nil
                            : "The ticks \(o.pitchDrift == .rising ? "climb" : "fall") about three semitones from the first landing to the last; the seat keeps its own pitch.") { next in
            set { $0.pitchDrift = next }
        }
        OpenerRange(label: "Volume", value: o.tickVolume,
                    range: scrubLimits.tickVolume.min...scrubLimits.tickVolume.max, step: 0.05, reset: 1,
                    hint: o.tickVolume == 0 ? "At 0% no sound track is written for the ticks at all." : nil,
                    format: OpenerWords.percent) { v in set { $0.tickVolume = v } }
        OpenerToggleRow(label: "Mix in", name: "Mix the ticks into a clip’s own sound", words: "Into a clip’s own sound",
                        isOn: o.mixWithClip,
                        hint: "Off, a clip that has sound keeps it bit-for-bit and goes out without the ticks. On, its sound is decoded, the ticks are added, and it is re-encoded.") { on in
            set { $0.mixWithClip = on }
        }
    }
}

/// One stop's tile in the strip: the picture that will flash there, once
/// decoded, else the day number on a dark tile. Cover-cropped the way the
/// flash is.
private struct ScrubStopTile: View {
    let dayNumber: Int
    let picture: CGImage?
    let legStart: Bool
    /// Why this stop's picture will not be drawn, when that is known.
    let problem: String?
    @Environment(\.palette) private var palette

    /// A decoded opener picture's pixels.
    static func image(_ picture: HookPicture) -> CGImage? {
        (picture.image as? HookBitmap)?.image
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            palette.frame
            if let picture {
                Image(decorative: picture, scale: 1, orientation: .up)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 36, height: 64)
                    .clipped()
            }
            Text(verbatim: "\(dayNumber)")
                .font(Brand.mono(9))
                .foregroundStyle(palette.onMedia)
                .padding(.horizontal, 3)
                .background(RoundedRectangle(cornerRadius: 3).fill(palette.frame.opacity(0.7)))
                .padding(4)
            if legStart {
                Circle()
                    .fill(palette.accent)
                    .frame(width: 6, height: 6)
                    .padding(4)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .frame(width: 36, height: 64)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(problem == nil ? palette.lineStrong : palette.danger, lineWidth: 1))
        .help(problem ?? "")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Day \(dayNumber)\(problem.map { " — \($0)" } ?? "")")
    }
}

#Preview("Défilé") {
    ScrollView {
        let model = OpenerFixtures.model(scrubVariant.id)
        ScrubOptionsPanel(model: model, ctx: model.hookState!.ctx, choose: { _ in })
            .padding(16)
    }
    .frame(width: 360, height: 1100)
    .darkroom()
}
