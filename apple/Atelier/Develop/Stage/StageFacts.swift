// What the picture SAYS, drawn down its bottom-left corner under `I` — the
// web's `DevelopViewport` `shot` + `facts` (`develop-roll.md`, «The corner
// says what the CAMERA did too»): what the camera did on TOP
// (`captureLine` — `ƒ/1.7 · 1/240 · ISO 100 · +0.3 EV`), marked down its edge
// with the accent because it is the file's own and can never be edited; a
// hairline only when both families are there; then this session's facts, one
// per line (`developLines` and the rest). Pointer-transparent: the picture
// under it still answers a drag, a wipe and a stroke.

import SwiftUI

struct StageFacts: View {
    let shot: String?
    let facts: [String]
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let shot {
                Text(shot)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.ink)
                    .padding(.leading, 6)
                    .padding(.trailing, 6)
                    .padding(.vertical, 2)
                    .background(palette.surface.opacity(0.84), in: RoundedRectangle(cornerRadius: 4))
                    .overlay(alignment: .leading) {
                        Rectangle().fill(palette.accent).frame(width: 2)
                    }
            }
            if shot != nil && !facts.isEmpty {
                Rectangle().fill(palette.surface.opacity(0.5)).frame(height: 1).padding(.vertical, 2)
            }
            ForEach(facts, id: \.self) { line in
                Text(line)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.inkSoft)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(palette.surface.opacity(0.84), in: RoundedRectangle(cornerRadius: 4))
            }
        }
        .fixedSize()
        .allowsHitTesting(false)
        .accessibilityElement(children: .combine)
    }
}

/// A small pill over the picture — `after`, `before · after`, `◐ hold for
/// before` — its ground a surface that flips with its ink.
struct StageChip: View {
    let text: String
    var tone: Color?
    @Environment(\.palette) private var palette

    var body: some View {
        Text(text.uppercased())
            .font(Brand.mono(9))
            .kerning(1.1)
            .lineLimit(1)
            .foregroundStyle(tone ?? palette.inkSoft)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(palette.surface.opacity(0.86), in: Capsule())
            .overlay(Capsule().stroke(palette.lineStrong, lineWidth: 1))
    }
}

#Preview("Facts") {
    StageFacts(shot: "ƒ/1.7 · 1/240 · ISO 100 · +0.3 EV", facts: ["+0.7 EV", "Contrast +12", "an 8-bit picture"])
        .padding()
        .background(Palette.darkroom.frame)
        .darkroom()
}
