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
//
// The LIBRARY is the shell's too (`Library/`): one pool every tool reads
// (`LibraryStore.shared`), and one bus a tool publishes its day and its verbs
// on (`MediaPublications`). On a wide screen it is docked at the left of the
// place (`LibraryDock`); on a phone it is the bottom bar's FIRST cell, which
// opens it as a sheet rather than switching tab (`frontend.md`).
//
// The LINKS are the shell's too (`AppLinks.swift`): a URL the system hands
// the app (`atelier://…`, the web's hash routes) moves the shell to its place
// — the tab on a phone, the sidebar's selection elsewhere — and the tool
// takes the rest of it (a roll, a trip's day and piece, a project handed
// over, a host proposed on Sources).

import SwiftUI
import AtelierKit

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

    /// The place inside its navigation stack (`Tool.stack`: Trips keeps its own).
    @MainActor @ViewBuilder
    var stack: some View {
        switch self {
        case .tool(let tool): tool.stack
        case .instrument(let instrument): NavigationStack { instrument.screen.taskPill() }
        }
    }
}

/// A tab of the phone's bar: a tool, or the instruments' list — and the
/// Library's cell, which opens a sheet and is never the selected tab.
enum ShellTab: Hashable {
    case tool(Tool)
    case more
    case library
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
    /// The one pool, and the bus the tools publish on.
    @State private var library = LibraryStore.shared
    @State private var publications = MediaPublications()
    /// The phone's Library sheet is up.
    @State private var libraryOpen = false
    /// The window's width — what decides whether the docked Library rests as its rail.
    @State private var windowWidth: CGFloat = 1280
    /// The links the app answers, and the moves they ask of the shell.
    @State private var links = AppLinks.shared
    /// The phone's More stack — an instrument a link named is pushed on it.
    @State private var morePath: [InstrumentTool] = []

    var body: some View {
        shell
            .tint(palette.accent)
            .environment(ConnectionStore.shared)
            .environment(library)
            .environment(publications)
            .environment(\.shellNavigate, ShellNavigate { tool in
                tab = .tool(tool)
                place = .tool(tool)
            })
            .background(GeometryReader { geo in
                Color.clear
                    .onAppear { windowWidth = geo.size.width }
                    .onChange(of: geo.size.width) { _, width in windowWidth = width }
            })
            // The instruments read the same pool: an asset put to work while
            // one is on screen goes onto their shelf.
            .onChange(of: library.activeId) { _, id in
                guard instrumentOnScreen, let id, let asset = library.asset(id) else { return }
                LibraryShelfBridge.hand(asset, from: library)
            }
            .onOpenURL { url in links.open(url) }
            // A link reaches the window already open rather than a new one.
            .handlesExternalEvents(preferring: ["*"], allowing: ["*"])
            .onChange(of: links.move) { _, move in
                if let move { go(move.place) }
            }
    }

    /// A link's move: the place, on the phone's tab bar and in the sidebar
    /// alike; an instrument is pushed on the phone's More list; the Library's
    /// sheet goes down so the place is what is seen.
    private func go(_ next: ShellPlace) {
        libraryOpen = false
        place = next
        switch next {
        case .tool(let tool):
            tab = .tool(tool)
        case .instrument(let instrument):
            tab = .more
            morePath = [instrument]
        }
    }

    private var instrumentOnScreen: Bool {
        #if os(iOS)
        if sizeClass == .compact { return tab == .more }
        #endif
        if case .instrument = place { return true }
        return false
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
        // The Library's cell opens its sheet and leaves the tab where it was.
        let selection = Binding<ShellTab>(
            get: { tab },
            set: { next in if next == .library { libraryOpen = true } else { tab = next } }
        )
        return TabView(selection: selection) {
            Color.clear
                .tabItem { Label("Library", systemImage: "photo.stack") }
                .tag(ShellTab.library)
            ForEach(Tool.allCases) { tool in
                tool.stack
                    .tabItem { Label(tool.title, systemImage: tool.symbol) }
                    .tag(ShellTab.tool(tool))
            }
            NavigationStack(path: $morePath) { InstrumentsHome().taskPill() }
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .tag(ShellTab.more)
        }
        .environment(\.openLibrary, OpenLibrary { libraryOpen = true })
        .sheet(isPresented: $libraryOpen) {
            LibrarySheet(accepts: phoneAccepts, toolLabel: phoneLabel)
                .environment(library)
                .environment(publications)
                .environment(ConnectionStore.shared)
                .environment(\.shellNavigate, ShellNavigate { tool in
                    libraryOpen = false
                    tab = .tool(tool)
                    place = .tool(tool)
                })
        }
    }

    /// What the tab on screen reads from the Library: its tool's kinds, or —
    /// behind More — every instrument's.
    private var phoneAccepts: [AssetKind] {
        switch tab {
        case .tool(let tool) where tool != .sources: return tool.accepts
        case .more: return [.videoTelemetry, .video, .telemetry, .photo]
        default: return AssetKind.allCases
        }
    }

    private var phoneLabel: String {
        switch tab {
        case .tool(let tool): return tool == .sources ? "any tool" : tool.title
        case .more: return "the instruments"
        case .library: return "this tool"
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
            place.stack
                .id(place)
                .libraryDocked(accepts: place.libraryAccepts, toolLabel: place.libraryLabel, windowWidth: windowWidth)
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
