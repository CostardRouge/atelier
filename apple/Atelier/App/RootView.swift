// The shell: a tab bar on a phone (and on an iPad pane as narrow as one), a
// sidebar on an iPad at full width and on the Mac — one set of places, the
// same screens. The Winnow connections are the shell's
// (`ConnectionStore.shared`), handed to every tool through the environment.
//
// The places are the web registry's two groups (`src/app/tools.tsx`): the
// EDITORS the suite converges on, plus Sources, as the tabs and the sidebar's
// first section; the INSTRUMENTS — the standalone pages kept until the Studio
// absorbs them — as the sidebar's second section and, on a phone, the fifth
// tab's list ("More"): honest and small, never dropped.

import SwiftUI

/// Where the sidebar can point: a tool of the tab bar, or one instrument.
enum ShellPlace: Hashable {
    case tool(Tool)
    case instrument(InstrumentTool)

    @MainActor @ViewBuilder
    var screen: some View {
        switch self {
        case .tool(let tool): tool.screen
        case .instrument(let instrument): instrument.screen
        }
    }
}

/// A tab of the phone's bar: a tool, or the instruments' list.
enum ShellTab: Hashable {
    case tool(Tool)
    case more
}

struct RootView: View {
    /// The sidebar's selection.
    @State private var place: ShellPlace = .tool(.develop)
    /// The phone's tab.
    @State private var tab: ShellTab = .tool(.develop)
    @Environment(\.palette) private var palette
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        shell
            .tint(palette.accent)
            .environment(ConnectionStore.shared)
            .environment(\.shellNavigate, ShellNavigate { tool in
                tab = .tool(tool)
                place = .tool(tool)
            })
    }

    @ViewBuilder
    private var shell: some View {
        #if os(iOS)
        if sizeClass == .compact {
            tabs
        } else {
            sidebar
        }
        #else
        sidebar
        #endif
    }

    #if os(iOS)
    private var tabs: some View {
        TabView(selection: $tab) {
            ForEach(Tool.allCases) { tool in
                NavigationStack { tool.screen.taskPill() }
                    .tabItem { Label(tool.title, systemImage: tool.symbol) }
                    .tag(ShellTab.tool(tool))
            }
            NavigationStack { InstrumentsHome().taskPill() }
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .tag(ShellTab.more)
        }
    }
    #endif

    private var sidebar: some View {
        let selection = Binding<ShellPlace?>(
            get: { place },
            set: { next in if let next { place = next } }
        )
        return NavigationSplitView {
            List(selection: selection) {
                Section {
                    ForEach(Tool.allCases) { tool in
                        Label(tool.title, systemImage: tool.symbol)
                            .tag(ShellPlace.tool(tool))
                    }
                }
                Section("Instruments") {
                    ForEach(InstrumentTool.allCases.filter { $0.group == .instrument }) { instrument in
                        Label(instrument.title, systemImage: instrument.symbol)
                            .tag(ShellPlace.instrument(instrument))
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
        } detail: {
            // A new place is a new stack: a page pushed inside one tool never
            // survives the move to another.
            NavigationStack { place.screen.taskPill() }
                .id(place)
        }
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
