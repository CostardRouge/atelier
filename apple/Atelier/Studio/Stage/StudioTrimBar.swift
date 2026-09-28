// The transport's scrub bar with in/out handles — the web's
// `src/shared/media/TrimBar.tsx`. A native `Slider` can neither grey out a
// region nor carry two extra thumbs, so the track is drawn: the rail, the
// excluded head and tail pale, the kept span mid, the played part vermilion,
// and three grabbable things — the in handle, the out handle and the playhead.
//
// Every rule about WHERE a handle may go is the kernel's (`Trim.swift`); this
// view only turns a finger's position into seconds. The maintainer's three:
// the handles stop on each other (one frame apart, never crossing);
// WHATEVER is dragged, the picture follows it, so you cut on the frame you
// watch; and the push works both ways — a handle past the playhead carries
// it, the playhead dragged into a handle carries the handle (only ever
// widening). The first press on the rail lands on the nearest kept frame and
// never re-cuts: only carrying on past a handle moves it.
//
// The bar is TWO BANDS, and that split is what makes every press
// unambiguous: the handles are grabbed on the rail (top), the playhead by its
// head (bottom). Stacked instead, whichever order, one of them is
// ungrabbable exactly when they coincide — and they coincide constantly.
//
// All three are adjustable for VoiceOver (a frame per step), the web's
// `role="slider"`s.

import SwiftUI
import AtelierKit

struct StudioTrimBar: View {
    let duration: Double
    let time: Double
    let range: TrimRange
    /// The shortest range the handles may leave (one frame).
    let minLength: Double
    /// The step of an adjustment (one frame).
    let step: Double
    let onSeek: (Double) -> Void
    let onScrub: (Bool) -> Void
    let onRangeChange: (TrimRange) -> Void

    @Environment(\.palette) private var palette
    @State private var mode: Mode?

    private enum Mode { case seek, start, end }

    /// The handles' band, on the rail.
    private let railBand: CGFloat = 22
    private let inset: CGFloat = 8

    var body: some View {
        GeometryReader { geo in
            let width = max(1, geo.size.width - inset * 2)
            let head = clampPlayhead(time, range)
            ZStack(alignment: .topLeading) {
                // The rail: the excluded head and tail read pale.
                Capsule()
                    .fill(palette.line)
                    .frame(width: width, height: 6)
                    .offset(x: inset, y: railBand / 2 - 3)
                // The kept span, and the part of it already played.
                Capsule()
                    .fill(palette.faint)
                    .frame(width: max(0, x(range.end, width) - x(range.start, width)), height: 6)
                    .offset(x: inset + x(range.start, width), y: railBand / 2 - 3)
                Capsule()
                    .fill(palette.accent)
                    .frame(width: max(0, x(head, width) - x(range.start, width)), height: 6)
                    .offset(x: inset + x(range.start, width), y: railBand / 2 - 3)
                // The playhead's line — decoration; the press reaches the rail behind it.
                Rectangle()
                    .fill(palette.accent)
                    .frame(width: 2, height: geo.size.height - 6)
                    .offset(x: inset + x(head, width) - 1, y: 3)
                    .allowsHitTesting(false)
                handle(.start, at: range.start, width: width)
                handle(.end, at: range.end, width: width)
                playheadHead(at: head, width: width)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .contentShape(Rectangle())
            .gesture(dragHandle(.seek, width: width))
            .coordinateSpace(name: StudioTrimBar.space)
        }
        .frame(height: 36)
    }

    private func x(_ t: Double, _ width: CGFloat) -> CGFloat {
        duration > 0 ? CGFloat(min(1, max(0, t / duration))) * width : 0
    }

    /// Source seconds under a finger, clamped to the rail.
    private func timeAt(_ location: CGFloat, _ width: CGFloat) -> Double {
        guard duration > 0 else { return 0 }
        let ratio = min(1, max(0, (location - inset) / width))
        return Double(ratio) * duration
    }

    /// One step of a drag; `pushing` is false for its first press and for an
    /// adjustment — only carrying on past a handle moves it.
    private func apply(_ mode: Mode, _ t: Double, pushing: Bool) {
        switch mode {
        case .seek:
            let next = pushing ? pushBounds(range, t, duration) : range
            if next != range { onRangeChange(next) }
            onSeek(clampPlayhead(t, next))
        case .start:
            let next = setStart(range, t, duration, minLength)
            onRangeChange(next)
            // The picture follows the handle: you watch the frame you cut on.
            onSeek(next.start)
        case .end:
            let next = setEnd(range, t, duration, minLength)
            onRangeChange(next)
            onSeek(next.end)
        }
    }

    private func handle(_ which: Mode, at t: Double, width: CGFloat) -> some View {
        let active = mode == which
        return RoundedRectangle(cornerRadius: 2)
            .fill(palette.accentInk)
            .frame(width: 3, height: active ? 20 : 16)
            .frame(width: 22, height: railBand)
            .contentShape(Rectangle())
            .offset(x: inset + x(t, width) - 11, y: 0)
            .highPriorityGesture(dragHandle(which, width: width))
            .accessibilityElement()
            .accessibilityLabel(which == .start ? "Trim start" : "Trim end")
            .accessibilityValue(formatTimecode(t))
            .accessibilityAdjustableAction { direction in
                let delta = direction == .increment ? step : -step
                apply(which, t + delta, pushing: false)
            }
    }

    private func playheadHead(at head: Double, width: CGFloat) -> some View {
        let active = mode == .seek
        return RoundedRectangle(cornerRadius: 3)
            .fill(palette.accent)
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(palette.accentInk.opacity(0.3), lineWidth: 1))
            .frame(width: active ? 15 : 13, height: 9)
            .frame(width: 24, height: 14, alignment: .bottom)
            .contentShape(Rectangle())
            .offset(x: inset + x(head, width) - 12, y: 36 - 14)
            .highPriorityGesture(dragHandle(.seek, width: width))
            .accessibilityElement()
            .accessibilityLabel("Seek")
            .accessibilityValue(formatTimecode(head))
            .accessibilityAdjustableAction { direction in
                let delta = direction == .increment ? step : -step
                apply(.seek, head + delta, pushing: false)
            }
    }

    /// A handle's own drag, measured on the bar — the handle moves under it.
    private func dragHandle(_ target: Mode, width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(StudioTrimBar.space))
            .onChanged { value in
                let t = timeAt(value.location.x, width)
                if mode == nil {
                    mode = target
                    onScrub(true)
                    apply(target, t, pushing: false)
                } else if let current = mode {
                    apply(current, t, pushing: true)
                }
            }
            .onEnded { _ in
                mode = nil
                onScrub(false)
            }
    }

    /// The bar's own coordinate space: a handle's drag reads the bar's x, not its own.
    static let space = "studio.trimbar"
}

#Preview("Trim bar") {
    DevelopPreviewState(TrimRange(start: 2, end: 7)) { range in
        StudioTrimBar(duration: 10, time: 4, range: range.wrappedValue, minLength: 0.1, step: 0.1,
                      onSeek: { _ in }, onScrub: { _ in }, onRangeChange: { range.wrappedValue = $0 })
    }
}
