// Atelier, native: the same suite as the web app (`src/`), the same documents,
// on Apple's own frameworks. The kernel is `AtelierKit`; this target is one of
// its consumers, and holds only what a browser cannot — files, Photos, Core
// Image, the window.

import SwiftUI

@main
struct AtelierApp: App {
    @State private var rolls = RollStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(rolls)
        }
        #if os(macOS)
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Roll") { rolls.create(name: "Untitled roll") }
                    .keyboardShortcut("n", modifiers: [.command])
            }
        }
        #endif
    }
}
