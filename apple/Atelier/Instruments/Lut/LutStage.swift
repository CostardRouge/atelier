// LUT Studio's stage — the web's canvas with its offscreen `<video>`: the
// graded picture fitted on the frame colour, and, while Compare is on, the
// divider over it with `Original` hanging off its left and `Graded` off its
// right (the suite's before → after). The divider follows a drag, and on a
// Mac the pointer, as the web's follows the mouse; with Compare off a click
// on a clip plays or pauses it, as the web's does.

import SwiftUI
import AtelierKit

struct LutStage: View {
    let model: LutStudioModel
    @Environment(\.palette) private var palette
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        GeometryReader { geo in
            let image = model.stage.image
            let imageSize = image.map { CGSize(width: $0.width, height: $0.height) } ?? .zero
            let rect = stageFitRect(imageSize, in: geo.size)
            ZStack(alignment: .topLeading) {
                palette.frame
                if let image {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .interpolation(.high)
                        .aspectRatio(contentMode: .fit)
                        .frame(width: geo.size.width, height: geo.size.height)
                } else {
                    placeholder
                        .frame(width: geo.size.width, height: geo.size.height)
                }
                if model.compareOn, image != nil, rect.width > 0 {
                    divider(in: rect)
                }
            }
            .contentShape(Rectangle())
            .gesture(wipeDrag(rect), including: model.compareOn ? .all : .subviews)
            .onTapGesture {
                if !model.compareOn, case .clip = model.media { model.playback.togglePlay() }
            }
            #if os(macOS)
            .onContinuousHover { phase in
                guard model.compareOn, rect.width > 0, case .active(let point) = phase else { return }
                model.split = clampWipe(Double((point.x - rect.minX) / rect.width))
                model.rerender()
            }
            #endif
            .onChange(of: geo.size, initial: true) { _, size in
                model.renderSize = stagePixels(size, scale: displayScale)
                model.rerender()
            }
            .help(helpText)
        }
        .clipShape(RoundedRectangle(cornerRadius: Brand.controlRadius))
    }

    private var helpText: String {
        if model.compareOn { return "Drag the divider: original on the left, grade on the right" }
        if case .clip = model.media { return model.playback.playing ? "Pause" : "Play" }
        return ""
    }

    @ViewBuilder
    private var placeholder: some View {
        switch model.media {
        case .nothing:
            Text("Open a clip or a photo to preview a look on it.")
                .font(Brand.mono(13))
                .foregroundStyle(palette.muted)
                .multilineTextAlignment(.center)
                .padding()
        default:
            if let problem = model.problem {
                Text(problem)
                    .font(Brand.mono(12))
                    .foregroundStyle(palette.muted)
                    .multilineTextAlignment(.center)
                    .padding()
            } else {
                ProgressView().tint(palette.onMedia)
            }
        }
    }

    private func wipeDrag(_ rect: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard model.compareOn, rect.width > 0 else { return }
                model.split = clampWipe(Double((value.location.x - rect.minX) / rect.width))
                model.rerender()
            }
    }

    private func divider(in rect: CGRect) -> some View {
        let x = rect.minX + rect.width * CGFloat(model.split)
        return ZStack(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(0.9))
                .frame(width: 2, height: rect.height)
                .shadow(color: .black.opacity(0.4), radius: 0.5)
            Circle()
                .fill(Color.black.opacity(0.32))
                .overlay(Circle().stroke(Color.white.opacity(0.95), lineWidth: 2))
                .overlay(
                    Image(systemName: "chevron.left.chevron.right")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.white)
                )
                .frame(width: 34, height: 34)
                .shadow(color: .black.opacity(0.45), radius: 3, y: 1)
                .offset(y: rect.height / 2 - 17)
            HStack(spacing: 0) {
                sideLabel("Original")
                    .frame(width: 120, alignment: .trailing)
                    .padding(.trailing, 10)
                Color.clear.frame(width: 2)
                sideLabel("Graded")
                    .frame(width: 120, alignment: .leading)
                    .padding(.leading, 10)
            }
            .padding(.top, 10)
        }
        .frame(width: 262, height: rect.height, alignment: .top)
        .position(x: x, y: rect.midY)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func sideLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(Brand.mono(10))
            .kerning(0.8)
            .foregroundStyle(palette.onMedia)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 5))
    }
}

#Preview("Stage") {
    LutStage(model: LutStudioModel())
        .frame(height: 320)
        .padding()
}
