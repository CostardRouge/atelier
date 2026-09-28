// The frame every Stages modal wears — the web's dialog shell for
// `TimelineImportPanel`, `DeduceStagesPanel` and `LocatePicturePanel`: a serif
// title, the sentence that says what the sheet does and what it never does,
// the body scrolling, and a footer that stays put with Cancel beside the one
// verb. Return runs the verb only when it is enabled; Escape cancels
// (`useDialogKeys`). Full-screen on a phone (`stagesModal`), a sheet elsewhere.

import SwiftUI

struct StagesSheetFrame<Content: View, Verb: View>: View {
    let title: String
    let lede: String
    var cancelTitle = "Cancel"
    let onCancel: () -> Void
    @ViewBuilder let content: () -> Content
    @ViewBuilder let verb: () -> Verb

    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(Brand.display(28))
                            .foregroundStyle(palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(lede)
                            .font(Brand.sans(14))
                            .foregroundStyle(palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    content()
                }
                .padding(.horizontal, 24)
                .padding(.top, 24)
                .padding(.bottom, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Hairline()
            HStack(spacing: 16) {
                Spacer(minLength: 0)
                Button(cancelTitle, action: onCancel)
                    .buttonStyle(.plain)
                    .font(Brand.sans(14))
                    .foregroundStyle(palette.muted)
                    .keyboardShortcut(.cancelAction)
                verb()
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 14)
            .background(palette.surface)
        }
        .background(palette.surface)
        #if os(macOS)
        .frame(minWidth: 520, idealWidth: 640, minHeight: 420, idealHeight: 620)
        #endif
        .presentationDetents([.large])
    }
}
