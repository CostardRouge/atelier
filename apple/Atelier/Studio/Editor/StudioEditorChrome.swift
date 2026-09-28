// What sits around the Studio's stage — the web's project bar (`PageBar`
// with its trailing pills), the media banners, the clip header and the
// notices under the stage (`StudioEditor.tsx`):
//
// - the project bar: undo / redo (always both drawn), the sync pill of a
//   project kept on an instance, the LOCAL save state as a pill of the same
//   family (a dot and a word — on a phone the word only where it waits on the
//   author), and the format chip with its gear that opens the settings. Every
//   pill one height, so the row reads as one band;
// - the banners: a rename absorbed on open is SAID; missing media is
//   informational (paper, no alarm) and offers to forget it, a CHANGED file is
//   worth attention (the danger ink) — both offer to point at the folder;
//   media the project keeps on an INSTANCE is the recovery's to say — being
//   fetched back, out of reach (connect it in Sources), refused (its reason,
//   a sign-in), or gone — with "Try again", and the folder banner counts
//   only the rest (`StudioStore+Recovery.swift`);
// - the header: ‹ n/N › through the project's media, its name, what is on the
//   stage (size · codec · cadence, or size · type), and a "no telemetry" /
//   "no exif" chip only once the file has actually been read.

import SwiftUI
import AtelierKit

// MARK: - the project bar

struct StudioProjectBar: View {
    @Bindable var editor: StudioEditor
    let compact: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 8) {
            ControlGroup {
                Button {
                    editor.undo()
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                }
                .disabled(!editor.canUndo)
                .help("Undo (⌘Z)")
                Button {
                    editor.redo()
                } label: {
                    Label("Redo", systemImage: "arrow.uturn.forward")
                }
                .disabled(!editor.canRedo)
                .help("Redo (⇧⌘Z)")
            }
            .fixedSize()
            Spacer(minLength: 4)
            DocumentSyncPill(sync: editor.store.sync)
            saveBadge
            Button {
                editor.settingsOpen = true
            } label: {
                HStack(spacing: 6) {
                    Text(aspectPreset(editor.edit.aspectId)?.id ?? editor.edit.aspectId)
                        .font(Brand.mono(11))
                        .kerning(0.6)
                    Image(systemName: "gearshape")
                        .font(.system(size: 13))
                }
                .foregroundStyle(palette.inkSoft)
                .padding(.horizontal, 10)
                .frame(minHeight: 34)
                .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.paper))
                .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).strokeBorder(palette.lineStrong, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Project settings — name, format, import/export")
            .accessibilityLabel("Project settings, format \(editor.edit.aspectId)")
            #if os(macOS)
            .keyboardShortcut(",", modifiers: [.command, .shift])
            #endif
        }
    }

    private var saveBadge: some View {
        let state = editor.saveState
        let showsLabel = !compact || state.needsAction
        return HStack(spacing: 6) {
            Circle().fill(dot(state)).frame(width: 7, height: 7)
            if showsLabel {
                Text(state.label.uppercased())
                    .font(Brand.mono(10))
                    .kerning(1)
                    .lineLimit(1)
            }
        }
        .foregroundStyle(state.needsAction ? palette.danger : state == .saved ? palette.ok : palette.muted)
        .padding(.horizontal, showsLabel ? 10 : 0)
        .frame(minWidth: 34, minHeight: 34)
        .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.paper))
        .overlay(
            RoundedRectangle(cornerRadius: Brand.controlRadius)
                .strokeBorder(state.needsAction ? palette.danger.opacity(0.45) : palette.lineStrong, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state.label)
        .help(state.label)
    }

    private func dot(_ state: StudioSaveState) -> Color {
        switch state {
        case .saved: return palette.ok
        case .saving: return palette.faint
        case .unsaved: return palette.lineStrong
        case .storageError: return palette.danger
        }
    }
}

// MARK: - the name

/// The project's name in the navigation bar, renamed in place — an emptied
/// field gives the old name back rather than saving a blank.
struct StudioProjectTitle: View {
    @Bindable var editor: StudioEditor
    let compact: Bool
    @Environment(\.palette) private var palette
    @State private var draft: String?
    @FocusState private var focused: Bool

    var body: some View {
        let name = editor.edit.name
        if draft != nil {
            TextField("Project name", text: Binding(get: { draft ?? "" }, set: { draft = $0 }))
                .font(Brand.display(compact ? 18 : 22))
                .textFieldStyle(.plain)
                .multilineTextAlignment(.center)
                .frame(minWidth: 160, maxWidth: 360)
                .focused($focused)
                .onSubmit(commit)
                .onChange(of: focused) { _, isFocused in
                    editor.textEditing = isFocused
                    if !isFocused { commit() }
                }
                #if os(macOS)
                .onExitCommand { cancel() }
                #endif
                .onAppear { focused = true }
        } else {
            Button {
                draft = name
            } label: {
                Text(name.isEmpty ? "Untitled project" : name)
                    .font(Brand.display(compact ? 18 : 22))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
            .help("Rename the project")
            .accessibilityLabel("Project name, \(name)")
        }
    }

    private func commit() {
        guard let value = draft else { return }
        let next = value.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = nil
        editor.textEditing = false
        guard !next.isEmpty, next != editor.edit.name else { return }
        editor.update { $0.name = next }
    }

    private func cancel() {
        draft = nil
        editor.textEditing = false
    }
}

// MARK: - the banners

struct StudioMediaBanners: View {
    @Bindable var editor: StudioEditor
    let onRepoint: () -> Void
    @Environment(\.palette) private var palette
    @Environment(\.shellNavigate) private var navigate
    @Environment(\.openURL) private var openURL

    var body: some View {
        let rec = editor.reconciliation
        let recovery = editor.library.recovery
        let missing = missingOutsideRecovery(rec, recovery)
        VStack(alignment: .leading, spacing: 8) {
            if editor.store.storageFailed {
                banner(alarm: true) {
                    Text(StudioSaveState.storageError.label + " — the device refused the write (the disk is full, or the app's storage is not writable). Your edits are still on screen.")
                }
            }
            if let renamed = renamedMediaNotice(rec?.renamed ?? 0) {
                banner(alarm: false) { Text(renamed) }
            }
            ForEach(Array(studioRecoveryLines(recovery).enumerated()), id: \.offset) { _, line in
                banner(alarm: line.alarm) { recoveryLine(line) }
            }
            if let trouble = mediaTroubleNotice(missing: missing, changed: rec?.changed ?? 0) {
                banner(alarm: trouble.needsAttention) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(trouble.text)
                        HStack(spacing: 16) {
                            Button("Point to the media folder…", action: onRepoint)
                                .buttonStyle(DevelopLinkButtonStyle(active: true))
                            if trouble.offersForget {
                                Button("Remove missing files from this project") { editor.store.forgetMissing() }
                                    .buttonStyle(DevelopLinkButtonStyle())
                            }
                        }
                    }
                }
            }
            if let notice = editor.library.notice {
                banner(alarm: true) { Text(notice) }
            }
        }
    }

    /// One line of the recovery, and the verb that would cure it.
    private func recoveryLine(_ line: StudioRecoveryLine) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(line.text)
            if line.retry || line.connect || line.signIn != nil {
                HStack(spacing: 16) {
                    if let host = line.signIn, let url = signInURL(host) {
                        Button("Sign in there") { openURL(url) }
                            .buttonStyle(DevelopLinkButtonStyle(active: true))
                    }
                    if line.connect {
                        Button("Open Sources") { navigate(.sources) }
                            .buttonStyle(DevelopLinkButtonStyle(active: true))
                    }
                    if line.retry {
                        Button("Try again") { editor.store.recoverRemoteMedia() }
                            .buttonStyle(DevelopLinkButtonStyle())
                    }
                }
            }
        }
    }

    private func signInURL(_ host: String) -> URL? {
        let connections = ConnectionStore.shared
        guard let connection = connections.connection(host) else { return nil }
        return URL(string: connections.client(for: connection).loginUrl())
    }

    private func banner<Content: View>(alarm: Bool, @ViewBuilder content: () -> Content) -> some View {
        content()
            .font(Brand.sans(13))
            .foregroundStyle(alarm ? palette.danger : palette.inkSoft)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alarm ? palette.accentWash : palette.paper2, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
            .overlay(
                RoundedRectangle(cornerRadius: Brand.paperRadius)
                    .stroke(alarm ? palette.danger.opacity(0.45) : palette.line, lineWidth: 1)
            )
    }
}

// MARK: - the clip header

struct StudioMediaHeader: View {
    @Bindable var editor: StudioEditor
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 10) {
            if editor.clips.count > 1 {
                HStack(spacing: 4) {
                    stepButton("chevron.left", label: "Previous clip", enabled: editor.activeIndex > 0) {
                        editor.step(-1)
                    }
                    Text("\(editor.activeIndex + 1)/\(editor.clips.count)")
                        .font(Brand.mono(10))
                        .monospacedDigit()
                        .foregroundStyle(palette.muted)
                        .frame(minWidth: 28)
                    stepButton("chevron.right", label: "Next clip",
                               enabled: editor.activeIndex < editor.clips.count - 1) {
                        editor.step(1)
                    }
                }
                .fixedSize()
            }
            Text(editor.active?.baseName ?? "")
                .font(Brand.sans(14, weight: .semibold))
                .foregroundStyle(palette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            let detail = editor.activeDetail
            if !detail.isEmpty {
                Text(detail)
                    .font(Brand.mono(11))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .layoutPriority(-1)
            }
            if let chip = editor.missingDataChip {
                Text(chip.uppercased())
                    .font(Brand.mono(9))
                    .kerning(1)
                    .foregroundStyle(palette.faint)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .overlay(Capsule().stroke(palette.line, lineWidth: 1))
                    .fixedSize()
            }
            Spacer(minLength: 0)
        }
    }

    private func stepButton(_ symbol: String, label: String, enabled: Bool,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
                .frame(width: 24, height: 24)
                .background(Circle().fill(palette.paper))
                .overlay(Circle().stroke(palette.lineStrong, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(palette.inkSoft)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }
}

// MARK: - the notices under the stage

struct StudioStageNotices: View {
    @Bindable var editor: StudioEditor
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let failure = editor.playback.failure, editor.activeVideo != nil {
                notice("This clip cannot be played on this device: \(failure)")
            }
            if editor.unreadableTelemetry {
                notice("No telemetry could be read from this clip's .srt — telemetry fields will show “—”. Free-text elements still work.")
            }
            ForEach(Array(editor.lookMissing.values.sorted()), id: \.self) { why in
                notice(why)
            }
        }
    }

    private func notice(_ text: String) -> some View {
        Text(text)
            .font(Brand.sans(13))
            .foregroundStyle(palette.danger)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.accentWash, in: RoundedRectangle(cornerRadius: Brand.paperRadius))
            .overlay(RoundedRectangle(cornerRadius: Brand.paperRadius).stroke(palette.danger.opacity(0.45), lineWidth: 1))
    }
}
