// A new roll in one sheet — the web's `NewRollModal.tsx`: a NAME to replace,
// never a blank to fill in (`Roll · 15 Sep`, selected on entry so typing
// replaces it), and where it is kept — asked only when a second source can
// keep rolls, which needs the app's Winnow client. "Start with the photos
// ticked in the Library" waits for the Library; pictures are added from the
// editor's Add menu.

import SwiftUI
import AtelierKit

/// `Roll · 15 Sep` — also what a roll started from one picture is called.
func defaultRollName(_ now: Date = Date()) -> String {
    "Roll · \(now.formatted(.dateTime.day().month(.abbreviated)))"
}

struct NewRollSheet: View {
    let onCreate: (String) -> Void
    let onCancel: () -> Void

    @Environment(\.palette) private var palette
    @State private var name = defaultRollName()
    @FocusState private var focused: Bool

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                Text("New roll")
                    .font(Brand.display(28))
                    .foregroundStyle(palette.ink)
                Text("The photographs you mean to develop, each keeping its own light and colour.")
                    .font(Brand.sans(15))
                    .foregroundStyle(palette.muted)
            }
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow("Name")
                TextField("Name", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .font(Brand.sans(16))
                    .focused($focused)
                    .onSubmit { if !trimmed.isEmpty { onCreate(trimmed) } }
            }
            Text("Add pictures once it is open — from Photos, Files or a folder.")
                .font(Brand.sans(13))
                .foregroundStyle(palette.faint)
            Hairline()
            HStack(spacing: 16) {
                Spacer()
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                    .buttonStyle(.borderless)
                Button("Create roll") { onCreate(trimmed) }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(trimmed.isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 320, idealWidth: 416)
        .background(palette.surface)
        .presentationDetents([.medium])
        .onAppear { focused = true }
    }
}

#Preview("New roll") {
    NewRollSheet(onCreate: { _ in }, onCancel: {})
}
