// Atelier, native: the same suite as the web app (`src/`), the same documents,
// on Apple's own frameworks. The kernel is `AtelierKit`; this target is one of
// its consumers, and holds only what a browser cannot — files, Photos, Core
// Image, the window.

import SwiftUI

@main
struct AtelierApp: App {
    /// The rolls this device keeps, and where each picture's bytes are.
    @State private var rolls: RollStore
    /// What the pictures ARE once looked at: decodes, EXIF, thumbnails.
    @State private var pictures: PicturePool
    /// The personal preset book — one list of named lights.
    @State private var presets = PresetBookStore()
    /// The looks: the built-ins, the vault of purchased and uploaded looks,
    /// the film stocks, the ★ shortlist — held ONCE, read by every picker.
    @State private var looks = LookLibrary.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Brand.registerFonts()
        let store = RollStore()
        _rolls = State(initialValue: store)
        _pictures = State(initialValue: PicturePool(store: store))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(rolls)
                .environment(pictures)
                .environment(presets)
                .environment(looks)
                .font(Brand.sans(15))
        }
        .onChange(of: scenePhase) { _, phase in
            // Local now: whatever the debounce still holds is written before
            // the app leaves the foreground.
            if phase != .active {
                rolls.flush()
                presets.flush()
            }
        }
        #if os(macOS)
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Roll") { rolls.create(name: defaultRollName()) }
                    .keyboardShortcut("n", modifiers: [.command])
            }
            DevelopCommands()
        }
        #endif
    }
}
