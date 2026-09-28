// «Défilé» — the trip runs past and stops on this day. Port of the variant in
// `src/shared/roadtrip/hooks/scrub.tsx`: what it needs, when it cannot run,
// which pictures it asks for, what `prepare` returns, and the tape a drag
// moves. The arithmetic is `ScrubPlan.swift` and a frame's layout
// `ScrubPaint.swift`; the strokes and the face — the picker `Sketch`, the
// options `Panel` with its stop strip and its summary line — are the app's.
//
// The trip's measuring tape sweeps from where it starts to the day this piece
// tells, decelerating; every stop flashes a real picture as the head lands,
// a stop with none goes dark, and the badge's numeral steps with the head.
// When it comes to rest, the piece's own picture is the frame and the tape
// stays under it, reading today. It ticks at every landing (`scrubScore`),
// the seat on today; a clip with sound of its own keeps it untouched unless
// the author asks for the ticks to be mixed in (`mixWithClip`).

import Foundation

/// What `prepare` returns: the plan, built once, read by the numeral, the
/// drawing and the score alike.
private func prepareScrub(_ options: HookOptions, _ ctx: HookContext) -> HookRender {
    let o = scrubOptions(options)
    guard let calendar = ctx.calendar, let plan = scrubPlan(calendar, ctx.date, o) else {
        return HookRender(seconds: 0)
    }
    let end = plan.endSeconds
    // Only under the trip-day counter, and only while the head moves: once it
    // rests the badge says its own value — a range post's "27–29" too.
    var content: (@Sendable (Double) -> HookContentPatch)? = nil
    if ctx.counterMode == .day && end > 0 {
        content = { t in
            guard t < end else { return [:] }
            let day: Int = plan.stops[plan.stopAt(t)].dayNumber
            return [.headline: .text("\(day)")]
        }
    }
    var score: (@Sendable () -> [SoundEvent])? = nil
    if o.sound {
        let tuning = ScrubTuning(kit: o.kit, pitch: o.tickPitch, drift: o.pitchDrift)
        let volume = o.tickVolume
        score = { scrubScore(plan, volume, tuning) }
    }
    return HookRender(
        seconds: end,
        content: content,
        drawing: ScrubDrawing(plan: plan, options: o, pictures: ctx.pictures),
        score: score,
        mixWithSource: o.sound && o.mixWithClip
    )
}

/// Why a sweep cannot run on this piece. No calendar means the shell has not
/// resolved one yet — not a refusal.
private func scrubUnmet(_ ctx: HookContext) -> String? {
    guard let calendar = ctx.calendar else { return nil }
    if calendar.count < 2 { return "Needs a trip of two days or more" }
    if !calendar.contains(where: { $0.date == ctx.date }) { return "This piece is dated outside the trip" }
    return nil
}

/// The hero's own picture is already on the frame, and a stop with nothing to
/// show has nothing to fetch: only the pictures the stops name, once each.
private func scrubWantsPictures(_ options: HookOptions, _ ctx: HookContext) -> [HookPictureWant] {
    let o = scrubOptions(options)
    guard o.flash, let calendar = ctx.calendar else { return [] }
    return scrubWants(scrubSeeds(calendar, ctx.date, o) ?? [])
}

/// The TAPE is what a click grabs and a drag moves: the flashes fill the frame
/// and the numeral is a badge piece, so neither has a place to be dragged to.
/// Nothing to grab when there is no sweep to draw — `scrubPlan` refuses only a
/// piece dated outside its calendar, checked here without building a plan.
private func scrubFrameBox(_ options: HookOptions, _ ctx: HookContext, _ frame: FrameBox) -> FrameRect? {
    guard let calendar = ctx.calendar, calendar.contains(where: { $0.date == ctx.date }) else { return nil }
    return tapeBox(frame.width, frame.height, scrubOptions(options).tapeGeometryOptions)
}

private func scrubMoveBy(_ options: HookOptions, _ dx: Double, _ dy: Double) -> HookOptions {
    moveTape(scrubOptions(options), dx, dy).json
}

/// The web's `scrubVariant`.
public let scrubVariant = HookVariant(
    id: "scrub",
    name: "Défilé",
    tagline: "The trip runs past and stops on this day",
    defaults: ScrubOptions.defaults.json,
    contentKeys: ["picked"],
    needs: HookNeeds(coverage: true, stages: true, media: .day),
    owns: .frame,
    prepare: { prepareScrub($0, $1) },
    unmet: { scrubUnmet($0) },
    wantsPictures: { scrubWantsPictures($0, $1) },
    frameBox: { scrubFrameBox($0, $1, $2) },
    moveBy: { scrubMoveBy($0, $1, $2) }
)
