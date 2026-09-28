// The Compare A/B stage — `src/tools/compare/CompareTool.tsx`'s stage: A
// underneath, B on top clipped to the RIGHT of a divider, so A — before —
// reads on the left and B — after — on the right, the suite's rule. The
// divider follows a drag (and, on a Mac, the pointer, as the web's follows the
// mouse); each side wears its label.
//
// The native addition is a SYNCED zoom: both sides share one view
// (`UI/PanZoom.swift`'s `ViewState`), so a pinch, a double tap or ± looks
// closer at the same place of both — which is what a compare is for. A drag
// that starts on the divider moves it; once zoomed, a drag elsewhere pans.

import AVFoundation
import SwiftUI
import AtelierKit

/// One side of a compare: a photograph decoded, or a clip playing.
enum CompareMedia {
    case picture(CGImage?)
    case clip(AVPlayer)
    case failed(String)
    case empty
}

struct CompareStage: View {
    let a: CompareMedia
    let b: CompareMedia
    let aName: String?
    let bName: String?
    /// The pictures' own size, for how far a zoomed view may pan.
    let natural: AtelierKit.Size?
    @Binding var split: Double
    @Binding var view: ViewState

    @State private var dragMode: DragMode?
    @State private var gestureStart: ViewState?
    @Environment(\.palette) private var palette

    private enum DragMode { case wipe, pan }
    /// How close to the divider a drag must start to move it.
    private let grab: CGFloat = 36
    private let ceiling = maxViewZoom

    private var hasBoth: Bool {
        if case .empty = b { return false }
        if case .empty = a { return false }
        return true
    }

    var body: some View {
        GeometryReader { geo in
            let viewport = AtelierKit.Size(Double(geo.size.width), Double(geo.size.height))
            let content = containedSize(natural, viewport)
            ZStack {
                palette.frame
                layer(a)
                if hasBoth {
                    layer(b)
                        .mask(alignment: .leading) {
                            Rectangle()
                                .frame(width: max(0, geo.size.width * CGFloat(1 - split)))
                                .offset(x: geo.size.width * CGFloat(split))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    divider(height: geo.size.height)
                        .offset(x: geo.size.width * CGFloat(split) - geo.size.width / 2)
                }
            }
            .clipped()
            .contentShape(Rectangle())
            .gesture(drag(geo.size, viewport: viewport, content: content))
            .simultaneousGesture(pinch(viewport: viewport, content: content))
            .onTapGesture(count: 2) {
                withAnimation(.easeOut(duration: 0.2)) {
                    view = view.scale > 1 ? .fitted : zoomAbout(view, 2, anchor: .zero, viewport: viewport, content: content, ceiling)
                }
            }
            #if os(macOS)
            .onContinuousHover { phase in
                if case .active(let point) = phase, hasBoth, dragMode == nil, geo.size.width > 0 {
                    split = clampWipe(Double(point.x / geo.size.width))
                }
            }
            #endif
            .overlay(alignment: .topLeading) {
                if hasBoth, let aName { label("A · \(aName)").padding(10) }
            }
            .overlay(alignment: .topTrailing) {
                if hasBoth, let bName { label("B · \(bName)").padding(10) }
            }
            .overlay(alignment: .bottomTrailing) {
                if view.scale > 1.001 {
                    MediaChip(text: "\(Int((view.scale * 100).rounded())) %").padding(10)
                }
            }
        }
    }

    // MARK: - the layers

    @ViewBuilder
    private func layer(_ media: CompareMedia) -> some View {
        Group {
            switch media {
            case .picture(let image):
                if let image {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .interpolation(.high)
                        .aspectRatio(contentMode: .fit)
                } else {
                    ProgressView().tint(palette.onMedia)
                }
            case .clip(let player):
                PlayerSurface(player: player)
            case .failed(let why):
                Text(why)
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            case .empty:
                Color.clear
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .scaleEffect(CGFloat(view.scale))
        .offset(x: CGFloat(view.x), y: CGFloat(view.y))
    }

    private func divider(height: CGFloat) -> some View {
        ZStack {
            Rectangle()
                .fill(Color.white.opacity(0.9))
                .frame(width: 2, height: height)
                .shadow(color: .black.opacity(0.4), radius: 0.5)
            Circle()
                .fill(Color.black.opacity(0.32))
                .overlay(Circle().stroke(Color.white.opacity(0.95), lineWidth: 2))
                .overlay(Image(systemName: "chevron.left.chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(.white))
                .frame(width: 34, height: 34)
                .shadow(color: .black.opacity(0.45), radius: 3, y: 1)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased())
            .font(Brand.mono(10))
            .kerning(1)
            .foregroundStyle(palette.onMedia)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 5))
    }

    // MARK: - gestures

    /// One point of travel before it is a drag, so a tap still reaches the
    /// double tap that zooms.
    private func drag(_ size: CGSize, viewport: AtelierKit.Size, content: AtelierKit.Size) -> some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                if dragMode == nil {
                    let divider = size.width * CGFloat(split)
                    let nearDivider = abs(value.startLocation.x - divider) <= grab
                    dragMode = hasBoth && (nearDivider || view.scale <= 1.001) ? .wipe : .pan
                    gestureStart = view
                }
                switch dragMode {
                case .wipe:
                    if size.width > 0 { split = clampWipe(Double(value.location.x / size.width)) }
                case .pan:
                    let start = gestureStart ?? view
                    let moved = ViewState(scale: start.scale, x: start.x + Double(value.translation.width),
                                          y: start.y + Double(value.translation.height))
                    view = clampView(moved, viewport: viewport, content: content, ceiling)
                case nil:
                    break
                }
            }
            .onEnded { _ in
                dragMode = nil
                gestureStart = nil
            }
    }

    private func pinch(viewport: AtelierKit.Size, content: AtelierKit.Size) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = gestureStart ?? view
                if gestureStart == nil { gestureStart = view }
                let anchor = AtelierKit.Point(Double(value.startLocation.x) - viewport.width / 2,
                                   Double(value.startLocation.y) - viewport.height / 2)
                view = zoomAbout(start, start.scale * Double(value.magnification), anchor: anchor,
                                 viewport: viewport, content: content, ceiling)
            }
            .onEnded { _ in gestureStart = nil }
    }
}

#Preview("Wipe") {
    CompareStage(a: .picture(InstrumentFixtures.picture(warm: true)),
                 b: .picture(InstrumentFixtures.picture(warm: false)),
                 aName: "DSC00123", bName: "DSC00123-graded",
                 natural: AtelierKit.Size(1200, 800),
                 split: .constant(0.5), view: .constant(.fitted))
        .frame(height: 360)
}
