// The shell: a tab bar on iPhone and iPad, a sidebar on the Mac — one
// selection, the same four screens.

import SwiftUI

struct RootView: View {
    @State private var tool: Tool = .develop
    @Environment(\.palette) private var palette

    var body: some View {
        #if os(iOS)
        TabView(selection: $tool) {
            ForEach(Tool.allCases) { tool in
                NavigationStack { tool.screen }
                    .tabItem { Label(tool.title, systemImage: tool.symbol) }
                    .tag(tool)
            }
        }
        .tint(palette.accent)
        #else
        NavigationSplitView {
            List(selection: $tool) {
                ForEach(Tool.allCases) { tool in
                    Label(tool.title, systemImage: tool.symbol).tag(tool)
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
        } detail: {
            NavigationStack { tool.screen }
        }
        .tint(palette.accent)
        #endif
    }
}

/// A tool the native app does not carry yet — said plainly, with what the web
/// app has and what lands next, never a spinner over nothing.
struct PlannedToolView: View {
    let tool: Tool
    @Environment(\.palette) private var palette

    var body: some View {
        ContentUnavailableView {
            Label(tool.title, systemImage: tool.symbol)
        } description: {
            VStack(spacing: 8) {
                Text(tool.tagline)
                Text("Not in the native app yet. The web app carries it today; the run-sheet in apple/README.md says which commit brings it here.")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
            }
        }
        .navigationTitle(tool.title)
    }
}
