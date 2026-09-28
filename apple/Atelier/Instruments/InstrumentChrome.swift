// The small pieces every instrument draws with — the web pages' shared
// furniture, once: the control bar (a surface card), the notice (accent wash,
// danger ink), the dashed empty state, the ‹ 1/3 › clip stepper, a pressed
// chip, the transport (play · time · scrub · duration), the openers (Photos
// and Files, into the shelf) and the file a save hands the exporter.
//
// Studio Papier throughout, read from `\.palette`; mono for every number.

import AVFoundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

// MARK: - the control bar

/// The web's control bar: a surface card with a hairline border.
struct InstrumentBar<Content: View>: View {
    @ViewBuilder let content: () -> Content
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            content()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.line, lineWidth: 1))
    }
}

/// A mono eyebrow in front of a row of controls (`ASPECT`, `LAYOUT`…).
struct InstrumentRowLabel: View {
    let text: String
    @Environment(\.palette) private var palette

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text.uppercased())
            .font(Brand.mono(10, weight: .medium))
            .kerning(1.1)
            .foregroundStyle(palette.muted)
    }
}

// MARK: - notices

/// The web's `.notice`: a sentence on the accent wash, in danger ink, with an
/// optional link-styled verb after it.
struct InstrumentNotice: View {
    let text: String
    var action: String? = nil
    var perform: (() -> Void)? = nil
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(text)
                .font(Brand.sans(14))
                .foregroundStyle(palette.danger)
                .fixedSize(horizontal: false, vertical: true)
            if let action, let perform {
                Button(action, action: perform)
                    .buttonStyle(.plain)
                    .font(Brand.sans(14, weight: .semibold))
                    .foregroundStyle(palette.accentInk)
                    .underline()
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(palette.accentWash, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.danger.opacity(0.35), lineWidth: 1))
    }
}

/// The web's empty state: a dashed card holding a sentence and what to do.
struct InstrumentEmpty<Actions: View>: View {
    let text: String
    @ViewBuilder var actions: () -> Actions
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 14) {
            Text(text)
                .font(Brand.sans(14))
                .foregroundStyle(palette.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            actions()
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.paperRadius)
                .strokeBorder(palette.lineStrong, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
        )
    }
}

extension InstrumentEmpty where Actions == EmptyView {
    init(text: String) {
        self.text = text
        self.actions = { EmptyView() }
    }
}

/// A chip over a picture: light ink on a dark wash, fixed — a photograph does
/// not turn dark at night (`onMedia`).
struct MediaChip: View {
    let text: String
    var dot: Bool = false
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 6) {
            if dot {
                Circle().fill(palette.accent).frame(width: 6, height: 6)
            }
            Text(text)
        }
        .font(Brand.mono(10))
        .foregroundStyle(palette.onMedia)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.black.opacity(0.55), in: Capsule())
    }
}

// MARK: - stepping clips

/// `‹ 2/5 ›` — which of the open assets is on stage, stepped through the
/// shelf's shared focus.
struct ClipStepper: View {
    let ids: [String]
    let activeId: String?
    let onSelect: (String) -> Void
    @Environment(\.palette) private var palette

    private var index: Int { ids.firstIndex(where: { $0 == activeId }) ?? 0 }

    var body: some View {
        HStack(spacing: 4) {
            Button { step(-1) } label: { Image(systemName: "chevron.left") }
                .disabled(index <= 0)
                .accessibilityLabel("Previous clip")
                .keyboardShortcut(.leftArrow, modifiers: [.command])
            Text("\(index + 1)/\(ids.count)")
                .font(Brand.mono(10))
                .foregroundStyle(palette.muted)
                .monospacedDigit()
                .frame(minWidth: 28)
            Button { step(1) } label: { Image(systemName: "chevron.right") }
                .disabled(index >= ids.count - 1)
                .accessibilityLabel("Next clip")
                .keyboardShortcut(.rightArrow, modifiers: [.command])
        }
        .buttonStyle(.bordered)
        .controlSize(.mini)
        .buttonBorderShape(.circle)
    }

    private func step(_ delta: Int) {
        let next = index + delta
        guard next >= 0, next < ids.count else { return }
        onSelect(ids[next])
    }
}

/// A toggle chip — the web's `aria-pressed` pill: the accent when on.
struct InstrumentChip: View {
    let title: String
    let pressed: Bool
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Brand.sans(12, weight: .semibold))
                .foregroundStyle(pressed ? palette.accentInk : palette.inkSoft)
                .padding(.horizontal, 11)
                .frame(height: 30)
                .background(pressed ? palette.accentWash : palette.paper, in: Capsule())
                .overlay(Capsule().stroke(pressed ? palette.accent : palette.lineStrong, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(pressed ? .isSelected : [])
    }
}

// MARK: - the transport

/// Play/pause, the position, a scrub, the length — the web's transport row.
/// Space plays and pauses (the web's `title="Play / pause (Space)"`).
struct InstrumentTransport: View {
    let playback: InstrumentPlayback
    /// Show the precise position (`M:SS.cs`) before the scrub.
    var showsTimecode = true
    /// A second clip following the first (Compare's synced sides).
    var onSeek: ((Double) -> Void)? = nil
    var onToggle: (() -> Void)? = nil
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 12) {
            Button {
                if let onToggle { onToggle() } else { playback.togglePlay() }
            } label: {
                Image(systemName: playback.playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(palette.paper)
                    .frame(width: 34, height: 34)
                    .background(palette.ink, in: Circle())
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.space, modifiers: [])
            .accessibilityLabel(playback.playing ? "Pause" : "Play")
            .help("Play / pause (Space)")

            if showsTimecode {
                Text(formatTimecode(playback.time))
                    .font(Brand.mono(11))
                    .monospacedDigit()
                    .foregroundStyle(palette.muted)
            }
            Slider(
                value: Binding(
                    get: { min(playback.time, max(playback.duration, 0.001)) },
                    set: { value in
                        if let onSeek { onSeek(value) } else { playback.seek(to: value) }
                    }
                ),
                in: 0...max(playback.duration, 0.001)
            )
            .tint(palette.accent)
            .accessibilityLabel("Seek")
            Text(formatDuration(playback.duration))
                .font(Brand.mono(11))
                .monospacedDigit()
                .foregroundStyle(palette.muted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: Brand.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }
}

// MARK: - opening files

/// Photos and Files, both into the instruments' shelf. Attached once per
/// screen; the toolbar's menu only raises the flags.
struct InstrumentImporters: ViewModifier {
    @Binding var files: Bool
    @Binding var photos: Bool
    let types: [UTType]
    /// What Photos may offer; nil means the screen takes no Photos pick
    /// (an `.srt` or a `.cube` lives in Files).
    let photoFilter: PHPickerFilter?
    @State private var items: [PhotosPickerItem] = []

    func body(content: Content) -> some View {
        let shelf = InstrumentShelf.shared
        return content
            .fileImporter(isPresented: $files, allowedContentTypes: types, allowsMultipleSelection: true) { result in
                if case .success(let urls) = result { shelf.add(urls: urls) }
            }
            .photosPicker(isPresented: $photos, selection: $items, maxSelectionCount: 50,
                          matching: photoFilter ?? .images, preferredItemEncoding: .current)
            .onChange(of: items) { _, picked in
                guard !picked.isEmpty else { return }
                Task {
                    for item in picked {
                        if let file = try? await item.loadTransferable(type: PickedMediaFile.self) {
                            shelf.add(ownedCopy: file.url)
                        }
                    }
                    items = []
                }
            }
    }
}

extension View {
    func instrumentImporters(files: Binding<Bool>, photos: Binding<Bool>, types: [UTType],
                             photoFilter: PHPickerFilter?) -> some View {
        modifier(InstrumentImporters(files: files, photos: photos, types: types, photoFilter: photoFilter))
    }
}

/// The toolbar's "Open" menu: Photos (when the screen takes a Photos pick) and Files.
struct InstrumentOpenMenu: View {
    let title: String
    var onPhotos: (() -> Void)? = nil
    let onFiles: () -> Void

    var body: some View {
        Menu {
            if let onPhotos {
                Button(action: onPhotos) { Label("From Photos…", systemImage: "photo.on.rectangle") }
            }
            Button(action: onFiles) { Label("From Files…", systemImage: "folder") }
                .keyboardShortcut("o", modifiers: [.command])
        } label: {
            Label(title, systemImage: "plus")
        }
    }
}

// MARK: - what a save hands the exporter

/// A finished file on its way to a folder: bytes in memory (a PNG) or a file
/// already written (an MP4 in the temporary directory, never read into memory).
struct InstrumentExportFile: FileDocument {
    static var readableContentTypes: [UTType] { [.mpeg4Movie, .png, .jpeg] }
    static var writableContentTypes: [UTType] { [.mpeg4Movie, .png, .jpeg] }

    enum Payload {
        case data(Data)
        case file(URL)
    }

    let payload: Payload
    /// The name it is offered under.
    let name: String

    init(data: Data, name: String) {
        payload = .data(data)
        self.name = name
    }

    init(file: URL, name: String) {
        payload = .file(file)
        self.name = name
    }

    init(configuration: ReadConfiguration) throws {
        payload = .data(configuration.file.regularFileContents ?? Data())
        name = configuration.file.filename ?? "export"
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let wrapper: FileWrapper
        switch payload {
        case .data(let data):
            wrapper = FileWrapper(regularFileWithContents: data)
        case .file(let url):
            wrapper = try FileWrapper(url: url, options: .immediate)
        }
        wrapper.preferredFilename = name
        return wrapper
    }
}

/// `clip.mp4` + `graded` → `clip-graded.mp4` — the web's one output-naming
/// convention (`shared/media/save.ts`'s `outputName`).
func instrumentOutputName(_ sourceName: String, _ suffix: String, ext: String = "mp4") -> String {
    let base = (sourceName as NSString).deletingPathExtension
    return "\(base)-\(suffix).\(ext)"
}

// MARK: - previews

#Preview("Chrome") {
    ScrollView {
        VStack(alignment: .leading, spacing: 16) {
            InstrumentBar {
                HStack {
                    ClipStepper(ids: ["a", "b", "c"], activeId: "b") { _ in }
                    Text("DJI_0001").font(Brand.sans(14, weight: .semibold))
                    Spacer()
                    InstrumentChip(title: "Load map background", pressed: false) {}
                    InstrumentChip(title: "Map background: on", pressed: true) {}
                }
            }
            InstrumentNotice(text: "No telemetry for this video yet.", action: "Add telemetry (.srt)") {}
            InstrumentEmpty(text: "Open your footage — videos pair with their .srt siblings automatically.") {
                Button("Open…") {}.buttonStyle(.borderedProminent)
            }
            HStack { MediaChip(text: "NO. 01"); MediaChip(text: "35.2 m", dot: true) }
                .padding()
                .background(Color.black)
            InstrumentTransport(playback: InstrumentPlayback())
        }
        .padding()
    }
}
