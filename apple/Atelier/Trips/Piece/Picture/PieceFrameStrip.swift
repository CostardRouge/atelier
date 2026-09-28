// Choosing a moment of a clip by dragging along the clip itself — the web's
// `src/tools/roadtrip/FrameStrip.tsx` (`roadtrip.md`, «The hook's frame is
// chosen on a filmstrip, not a number»).
//
// A number slider makes you scrub blind; the strip shows the clip, so the
// frame is chosen by pointing at it — the gesture every phone gallery uses to
// pick a cover. Rules kept:
// - the number of cells suits the strip's measured width (`stripCount`);
// - a cell samples the MIDDLE of its slice, and the cells stream in as they
//   decode (`filmstrip(source:count:maxSize:)`, `AVAssetImageGenerator` in
//   the place of the web's one seeked `<video>`), so the strip fills from the
//   left instead of appearing at the end; ending the view ends the decode;
// - the drag is THROTTLED to one change per display frame — the rate the stage
//   can repaint; a change per touch event queues seeks it never catches up with;
// - the time is held a hair short of the end (`timeFromPointer`): a seek past
//   the last frame never lands;
// - the handle is clamped whole at both ends — half a handle reads as a fault;
// - arrows nudge, Shift jumps, Home and End go to the ends (`keyStep`), and
//   VoiceOver adjusts it as the slider it is.

import CoreGraphics
import SwiftUI
import AtelierKit

struct PieceFrameStrip: View {
    let url: URL
    /// The clip's length; the strip waits for it.
    let duration: Double
    /// The chosen moment, in seconds.
    let value: Double
    var label = "Frame"
    let onChange: (Double) -> Void

    @State private var width: CGFloat = 0
    @State private var frames: [CGImage?] = []
    @State private var dragging = false
    @State private var pending: Double?
    @State private var waiting = false
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let stripHeight: CGFloat = 52
    private static let handleWidth: CGFloat = 26

    private var count: Int { stripCount(Double(width)) }
    private var decodeKey: String { "\(url.absoluteString)|\(duration)|\(count)|\(width > 0)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(label.uppercased())
                    .font(Brand.mono(10))
                    .kerning(1.4)
                    .foregroundStyle(palette.muted)
                Spacer(minLength: 0)
                Text(String(format: "%.2fs", value))
                    .font(Brand.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(palette.inkSoft)
            }
            track
            Text("Drag along the clip to choose the frame — arrows nudge, shift jumps.")
                .font(Brand.sans(10))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
        .task(id: decodeKey) { await decode() }
    }

    // MARK: - the track

    private var track: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                cells
                handle(in: geo.size.width)
            }
            .frame(width: geo.size.width, height: PieceFrameStrip.stripHeight)
            .onAppear { width = geo.size.width }
            .onChange(of: geo.size.width) { _, next in width = next }
        }
        .frame(height: PieceFrameStrip.stripHeight)
        .background(palette.frame)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(dragging ? palette.accent : palette.lineStrong, lineWidth: 1))
        .contentShape(Rectangle())
        .gesture(drag)
        .focusable()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .home, .end]) { press in
            key(press) ? .handled : .ignored
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Frame of the clip")
        .accessibilityValue(String(format: "%.2f seconds", value))
        .accessibilityAdjustableAction { direction in
            let step = keyStep(duration)
            switch direction {
            case .increment: emit(min(max(duration - 0.05, 0), value + step))
            case .decrement: emit(max(0, value - step))
            @unknown default: break
            }
        }
    }

    private var cells: some View {
        HStack(spacing: 0) {
            ForEach(Array(frames.enumerated()), id: \.offset) { _, image in
                cell(image)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
    }

    private func cell(_ image: CGImage?) -> some View {
        Color.clear
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay {
                if let image {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                }
            }
            .clipped()
    }

    /// The bright window on the chosen frame, clamped so it stays whole.
    private func handle(in total: CGFloat) -> some View {
        let fraction = CGFloat(fractionOfTime(value, duration))
        let w = PieceFrameStrip.handleWidth
        let x = min(max(0, fraction * total - w / 2), max(0, total - w))
        return RoundedRectangle(cornerRadius: 5)
            .stroke(palette.onMedia, lineWidth: 2)
            .background(RoundedRectangle(cornerRadius: 5).stroke(palette.frame.opacity(0.55), lineWidth: 4))
            .frame(width: w, height: PieceFrameStrip.stripHeight)
            .offset(x: x)
            .animation(dragging || reduceMotion ? nil : .easeOut(duration: 0.12), value: x)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    // MARK: - the gesture and the keys

    private var drag: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { g in
                dragging = true
                seek(Double(g.location.x))
            }
            .onEnded { g in
                seek(Double(g.location.x))
                dragging = false
            }
    }

    private func seek(_ x: Double) {
        let box = AtelierKit.Rect(0, 0, Double(width), Double(PieceFrameStrip.stripHeight))
        emit(timeFromPointer(x, box, duration))
    }

    private func key(_ press: KeyPress) -> Bool {
        let step = keyStep(duration, coarse: press.modifiers.contains(.shift))
        let last = max(duration - 0.05, 0)
        switch press.key {
        case .leftArrow: emit(max(0, value - step))
        case .rightArrow: emit(min(last, value + step))
        case .home: emit(0)
        case .end: emit(last)
        default: return false
        }
        return true
    }

    /// One change per display frame: the latest asked-for moment wins.
    private func emit(_ seconds: Double) {
        pending = seconds
        guard !waiting else { return }
        waiting = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 16_000_000)
            waiting = false
            if let next = pending {
                pending = nil
                onChange(next)
            }
        }
    }

    // MARK: - the decode

    /// The strip's cells, streamed in as they decode; a new file, a new
    /// length or a new width starts again, and leaving ends it.
    private func decode() async {
        guard width > 0, duration > 0 else { return }
        let n = count
        frames = Array(repeating: nil, count: n)
        guard let source = try? await VideoSource.open(url), !Task.isCancelled else { return }
        let size = CGSize(width: PieceFrameStrip.stripHeight * 8, height: PieceFrameStrip.stripHeight * 2)
        do {
            for try await thumb in filmstrip(source: source, count: n, maxSize: size) {
                if Task.isCancelled { break }
                if frames.indices.contains(thumb.index) { frames[thumb.index] = thumb.image }
            }
        } catch {
            // A cell the platform cannot produce is skipped; the strip keeps
            // what it has — never a failure of the tab.
        }
    }
}

#Preview("In point") {
    DevelopPreviewState(2.4) { value in
        PieceFrameStrip(url: URL(fileURLWithPath: "/dev/null"), duration: 12, value: value.wrappedValue,
                        label: "In point") { value.wrappedValue = $0 }
    }
    .frame(width: 340)
    .padding(16)
    .darkroom()
}
