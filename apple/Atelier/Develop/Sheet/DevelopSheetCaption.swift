// The line under the develop sheet's picture — the web's `DevelopCaption`
// (`src/shared/develop/DevelopViewport.tsx`): what the numbers say
// (`describeDevelop`), what this picture can give back (the fidelity's note —
// "an 8-bit picture: highlights above white are already gone"), and the
// gesture that applies RIGHT NOW: a wipe at the fit, a pan once zoomed, or
// that nothing changes the picture yet.

import SwiftUI
import AtelierKit

struct DevelopSheetCaption: View {
    @Bindable var picture: DevelopSheetPicture
    let draft: DevelopSettings
    /// `pictureFidelity(...).note`; nil when there is nothing to warn about.
    let note: String?
    @Environment(\.palette) private var palette

    var body: some View {
        Text(line)
            .font(Brand.mono(10))
            .foregroundStyle(palette.faint)
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var line: String {
        var words = describeDevelop(draft)
        if let note { words += " — \(note)" }
        guard picture.shown != nil else { return words }
        guard picture.changed else { return words + " · nothing changes the picture yet" }
        let comparing = picture.comparing
        if picture.zoom.zoomed {
            return words + (comparing ? " · drag to look around, the handle on the divider compares" : " · drag to look around")
        }
        let closer = DevelopSheetCaption.closer
        return words + (comparing ? " · drag across the picture to compare, \(closer)" : " · \(closer)")
    }

    #if os(macOS)
    static let closer = "wheel or pinch to look closer"
    #else
    static let closer = "pinch or double-tap to look closer"
    #endif
}

#Preview("Caption") {
    DevelopSheetCaption(picture: DevelopSheetPicture(), draft: .default,
                        note: "an 8-bit picture: highlights above white are already gone")
        .padding()
        .frame(width: 360)
        .background(Palette.darkroom.surface)
        .darkroom()
}
