// The picker card's little drawing — what a variant DOES, not a render of
// this piece: the stage beside the picker already shows the real thing, and a
// live render per card would cost a decode each to repeat it worse
// (`hook-variant.ts`, `Sketch`). The web draws each sketch in CSS or SVG by
// hand; here the three moving ones are drawn by the openers' OWN painters
// (`Trips/Paint/HookPaint.swift` → `ScrubPainter`, `MapPainter`,
// `DrivePainter`) from the kernel's own plans, prepared once on a small
// fixture trip, and looped in a `TimelineView` — so a card can never promise
// a drawing the opener does not make.
//
// - Badge: a word, a numeral that dominates, a place under it — the block the
//   badge actually is. It does not move.
// - Défilé: the tape, its head sweeping the told days and coming to rest.
// - Itinerary: the pen travelling four stops, waiting at each.
// - Virée: the car driving three legs of a paper map.
//
// Each plays its own length and holds a beat on the rest before it loops;
// with Reduce Motion it shows the rest alone. The fixture's options are the
// variant's own at their boldest (the thickest line, the biggest car): the
// export's proportions at 74 points wide would be a hairline. Nothing in a
// sketch reads the document, the Library or an instance.

import SwiftUI
import AtelierKit

struct OpenerSketchView: View {
    let variantId: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if variantId == defaultHookId {
                BadgeSketch()
            } else if let sketch = OpenerSketches.sketch(variantId) {
                TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
                    let t = reduceMotion ? sketch.rest : sketch.time(at: timeline.date)
                    Canvas(rendersAsynchronously: false) { context, size in
                        context.withCGContext { cg in
                            let canvas = PaintCanvas(cg, width: Double(size.width), height: Double(size.height))
                            HookPaint.paint(sketch.hook, canvas, t)
                            canvas.finish()
                        }
                    }
                }
            } else {
                Color.clear
            }
        }
        .aspectRatio(74.0 / 35.0, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

/// The badge's card: a word, the numeral, a place — drawn, not rendered.
private struct BadgeSketch: View {
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Capsule().fill(palette.onMedia.opacity(0.55)).frame(width: 12, height: 2)
            Text(verbatim: "27")
                .font(Brand.sans(16, weight: .bold))
                .foregroundStyle(palette.onMedia)
            Capsule().fill(palette.onMedia.opacity(0.4)).frame(width: 20, height: 2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// One prepared sketch: the opener's drawing and how its loop runs.
struct OpenerSketch {
    let hook: ResolvedHook
    /// Seconds the opener plays before it rests.
    let seconds: Double
    /// Where the loop starts again: its length and a beat at rest.
    let loop: Double

    /// The instant a sketch shows at rest.
    var rest: Double { seconds }

    /// The loop's time at `date` — every card on one clock, so they breathe
    /// together rather than each from its own appearance.
    func time(at date: Date) -> Double {
        guard loop > 0 else { return seconds }
        let t = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: loop)
        return min(t, seconds)
    }
}

/// The fixture trip every sketch is prepared on, and the prepared sketches —
/// made once each, never per frame.
@MainActor
enum OpenerSketches {
    private static var made: [String: OpenerSketch] = [:]

    static func sketch(_ id: String) -> OpenerSketch? {
        if let hit = made[id] { return hit }
        guard let variant = hookVariantById(id), let options = options(id) else { return nil }
        let hook = foldHook([variant.prepare(options, context)], variant.owns == .frame)
        guard hook.seconds > 0 else { return nil }
        let sketch = OpenerSketch(hook: hook, seconds: hook.seconds, loop: hook.seconds + 1.2)
        made[id] = sketch
        return sketch
    }

    // MARK: - the fixture trip

    private static func day(_ n: Int) -> IsoDate {
        String(format: "2025-03-%02d", n)
    }

    /// Twelve days, six of them told, three legs; the sketched piece is day 12.
    private static var calendar: [HookDay] {
        let told: Set<Int> = [2, 4, 5, 7, 9, 10]
        let legs: Set<Int> = [1, 5, 9]
        return (1...12).map { HookDay(date: day($0), dayNumber: $0, told: told.contains($0), legStart: legs.contains($0)) }
    }

    /// The west coast of Australia, up to the Pilbara.
    private static var stages: [HookStage] {
        [
            HookStage(startDate: day(1), endDate: day(4), label: "West coast",
                      places: [HookStagePlace(name: "Perth", lat: -31.95, lon: 115.86),
                               HookStagePlace(name: "Kalbarri", lat: -27.71, lon: 114.16)]),
            HookStage(startDate: day(5), endDate: day(8), label: "Coral coast",
                      places: [HookStagePlace(name: "Coral Bay", lat: -23.14, lon: 113.77),
                               HookStagePlace(name: "Exmouth", lat: -21.93, lon: 114.13)]),
            HookStage(startDate: day(9), endDate: day(12), label: "Pilbara",
                      places: [HookStagePlace(name: "Karijini", lat: -22.6, lon: 118.3)]),
        ]
    }

    private static var context: HookContext {
        HookContext(aspect: 74.0 / 35.0, durationSeconds: 5, date: day(12), counterMode: .day,
                    calendar: calendar, stages: stages, car: CarSpec.default)
    }

    /// The variant's own options at their boldest, no sound, no picture.
    private static func options(_ id: String) -> HookOptions? {
        switch id {
        case scrubVariant.id:
            var o = ScrubOptions.defaults
            o.flash = false
            o.sound = false
            o.tickHeight = scrubLimits.tickHeight.max
            o.tickOpacity = 0.8
            o.tapeWidth = 0.9
            o.edgeOffset = 0.2
            o.tickGap = scrubLimits.tickGap.min
            return o.json
        case mapVariant.id:
            var o = MapOptions.defaults
            o.stops = stopsFromPlaces(tripPlaces(stages).prefix(4).map { $0 }) { "sketch-\($0)" }
            o.media = .off
            o.labels = .none
            o.lineWidth = mapLimits.lineWidth.max
            o.dotSize = mapLimits.dotSize.max
            o.dwellSeconds = 0.3
            o.drawSeconds = 2.4
            o.sound = false
            return o.json.objectValue
        case driveVariant.id:
            var o = DriveOptions.defaults
            o.pictures = .none
            o.labels = .none
            o.compass = false
            o.scaleBar = false
            o.distance = .off
            o.vignette = false
            o.end = .stay
            o.carSize = driveLimits.carSize.max
            o.lineWidth = driveLimits.lineWidth.max
            o.delaySeconds = 0.2
            o.arriveSeconds = 0
            o.sound = false
            return o.json
        default:
            return nil
        }
    }
}

#Preview("Sketches") {
    VStack(alignment: .leading, spacing: 10) {
        ForEach(hookVariants, id: \.id) { variant in
            HStack(spacing: 12) {
                OpenerSketchView(variantId: variant.id)
                    .frame(width: 74, height: 35)
                    .background(Palette.darkroom.frame)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                Text(verbatim: variant.name).font(Brand.sans(13, weight: .semibold))
            }
        }
    }
    .padding(16)
    .darkroom()
}
