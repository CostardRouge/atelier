// The bridge to the Studio, as the Export tab draws it — the view half of the
// web's `StudioLink.tsx` (the logic is `PieceStudioBridge`):
//
// - linked: the project as a CARD with the picture it already carries (a name
//   alone does not tell you whether this is the right clip) and whether a hook
//   is in it; "Send the hook and open the Studio" (or "Update the hook…"),
//   "Send without leaving", "Open the project" and "Unlink"; what a send
//   carries in one line; and which grade a reel exported from the project
//   uses — with "Give the project … grade" when it has none and this does;
// - not linked: every Studio project on this device to link, each with its
//   picture, its name and its date, and "+ Create a project for this clip".
//
// Every sentence is the web's; "this browser" reads "this device".

import ImageIO
import SwiftUI
import AtelierKit

struct PieceStudioLinkView: View {
    let model: PieceEditorModel
    @State private var bridge = PieceStudioBridge()
    @Environment(\.palette) private var palette
    @Environment(\.shellNavigate) private var navigate

    var body: some View {
        let linked = bridge.project(model.post?.projectId)
        VStack(alignment: .leading, spacing: 10) {
            if let linked {
                linkedBody(linked)
            } else {
                choices
            }
            if let note = bridge.note {
                PieceBridgeBox { Text(verbatim: note) }
            }
        }
        .onAppear { bridge.refresh() }
        .onChange(of: model.post?.projectId) { _, _ in bridge.refresh() }
    }

    // MARK: - linked

    @ViewBuilder
    private func linkedBody(_ doc: ProjectDoc) -> some View {
        let elements = PieceStudioBridge.elements(model)
        let idle = bridge.busy == nil
        PieceProjectCard(doc: doc)
        Button {
            Task { await bridge.send(model, openAfter: true, navigate: goToStudio) }
        } label: {
            Text(verbatim: bridge.busy ?? (hasHook(doc) ? "Update the hook and open the Studio" : "Send the hook and open the Studio"))
                .font(Brand.sans(13, weight: .semibold))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(palette.accent)
        .disabled(!idle || elements.isEmpty)
        verbs(doc, idle: idle, canSend: !elements.isEmpty)
        if elements.isEmpty {
            Text("There is no badge to send — the trip’s dates cannot be read.")
                .font(Brand.sans(11))
                .foregroundStyle(palette.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
        Text(verbatim: carries)
            .font(Brand.sans(11))
            .foregroundStyle(palette.faint)
            .fixedSize(horizontal: false, vertical: true)
        gradeBox(doc, idle: idle)
    }

    private func verbs(_ doc: ProjectDoc, idle: Bool, canSend: Bool) -> some View {
        HStack(spacing: 14) {
            Button("Send without leaving") {
                Task { await bridge.send(model, openAfter: false, navigate: goToStudio) }
            }
            .buttonStyle(DevelopLinkButtonStyle(active: true))
            .disabled(!idle || !canSend)
            Button("Open the project") {
                let id = doc.id
                Task { await bridge.open(id, navigate: goToStudio) }
            }
            .buttonStyle(DevelopLinkButtonStyle(active: true))
            .disabled(!idle)
            Spacer(minLength: 0)
            Button("Unlink") {
                Task { await bridge.unlink(model) }
            }
            .buttonStyle(DevelopLinkButtonStyle())
            .disabled(!idle)
            .help("Take the hook and the sent closing card back out of the project, and drop the link")
        }
    }

    /// What a send carries, in one line (`photo-develop.md` §7.7).
    private var carries: String {
        guard let post = model.post else { return "" }
        let card = post.includeCta ? ", the closing card" : ""
        let develop = isDefaultDevelop(post.badge.develop) ? "" : " and the picture’s correction"
        return "A send carries the badge\(card)\(develop); the picture’s crop and the trip’s title style stay here."
    }

    /// Two grades, one file: which one the Studio export will use.
    private func gradeBox(_ doc: ProjectDoc, idle: Bool) -> some View {
        let hook = PieceStudioBridge.hookGrade(model)
        let hereGraded = hook.grade.layers.contains { $0.enabled && $0.intensity > 0 }
        let projectGraded = !doc.lutStack.isEmpty
        let whose = PieceStudioLinkView.whose(hook.scope)
        let sentence: String
        if projectGraded {
            let notHere = hereGraded ? ", not \(whose) shown here" : ""
            sentence = "A reel exported from this project uses the project’s own grade\(notHere). The badge crosses over ungraded, so nothing is graded twice."
        } else if hereGraded {
            sentence = "This project has no grade, so a reel exported from it would go out as shot while the preview here wears \(whose)."
        } else {
            sentence = "Neither this piece nor the project has a grade; a reel from the project goes out as shot."
        }
        return PieceBridgeBox {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: sentence)
                if !projectGraded && hereGraded {
                    Button("Give the project \(whose)") {
                        Task { await bridge.pushGrade(model) }
                    }
                    .buttonStyle(DevelopLinkButtonStyle(active: true))
                    .disabled(!idle)
                }
            }
        }
    }

    static func whose(_ scope: GradeScope) -> String {
        switch scope {
        case .slide: return "this picture’s own grade"
        case .post: return "this piece’s own grade"
        case .trip: return "the trip’s grade"
        }
    }

    // MARK: - not linked

    @ViewBuilder
    private var choices: some View {
        let candidates = bridge.projects ?? []
        let idle = bridge.busy == nil
        if !candidates.isEmpty {
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(candidates, id: \.id) { doc in
                        PieceProjectRow(doc: doc) { bridge.link(model, doc.id) }
                            .disabled(!idle)
                    }
                }
            }
            // Up to four rows show whole; past that the list scrolls in place.
            .frame(height: min(208, CGFloat(candidates.count) * 46))
        }
        Button {
            Task { await bridge.create(model) }
        } label: {
            Text(verbatim: bridge.busy ?? (candidates.isEmpty ? "+ Create a project for this clip" : "+ Or create one for this clip"))
        }
        .buttonStyle(DevelopPillButtonStyle())
        .disabled(!idle)
        if bridge.projects != nil && candidates.isEmpty {
            Text("No Studio projects on this device yet.")
                .font(Brand.sans(11))
                .foregroundStyle(palette.faint)
        }
    }

    // MARK: - going there

    /// To the Studio's tab, with the phone's sheet let down first — a sheet
    /// left up would cover the Studio.
    private func goToStudio() {
        model.inspectorOpen = false
        navigate(.studio)
    }
}

// MARK: - the pieces

/// The linked project: its picture, its name, whether a hook is in it.
struct PieceProjectCard: View {
    let doc: ProjectDoc
    @Environment(\.palette) private var palette

    var body: some View {
        let sent = hasHook(doc)
        HStack(spacing: 12) {
            PieceProjectThumb(doc: doc, small: false)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: doc.name)
                    .font(Brand.sans(13))
                    .foregroundStyle(palette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help(doc.name)
                HStack(spacing: 6) {
                    Circle()
                        .fill(sent ? palette.accent : palette.lineStrong)
                        .frame(width: 6, height: 6)
                        .accessibilityHidden(true)
                    Text(verbatim: sent ? "HOOK IN THE PROJECT" : "NO HOOK SENT YET")
                        .font(Brand.mono(9))
                        .kerning(1)
                        .foregroundStyle(sent ? palette.accentInk : palette.faint)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.paper))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// A project to link: its picture, its name, its date.
struct PieceProjectRow: View {
    let doc: ProjectDoc
    let pick: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: pick) {
            HStack(spacing: 10) {
                PieceProjectThumb(doc: doc, small: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: doc.name)
                        .font(Brand.sans(12))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                    Text(verbatim: PieceProjectRow.date(doc.updatedAt))
                        .font(Brand.mono(10))
                        .foregroundStyle(palette.faint)
                }
                Spacer(minLength: 0)
            }
            .padding(6)
            .background(RoundedRectangle(cornerRadius: 8).fill(palette.paper))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(palette.line, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Link \(doc.name)")
        .accessibilityLabel("Link \(doc.name)")
    }

    /// `12 Mar 2025` — the day it was last saved.
    static func date(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(.dateTime.day().month(.abbreviated).year())
    }
}

/// A project's own thumbnail, which the Studio already keeps.
struct PieceProjectThumb: View {
    let doc: ProjectDoc
    let small: Bool
    @State private var image: CGImage?
    @Environment(\.palette) private var palette

    var body: some View {
        let width: CGFloat = small ? 44 : 58
        let height: CGFloat = small ? 30 : 40
        ZStack {
            palette.paper2
            if let image {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(palette.line, lineWidth: 1))
        .accessibilityHidden(true)
        .task(id: doc.updatedAt) { image = await PieceProjectThumb.decode(doc.thumbnail) }
    }

    static func decode(_ data: Data?) async -> CGImage? {
        guard let data else { return nil }
        return await Task.detached(priority: .utility) { () -> CGImage? in
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 176,
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        }.value
    }
}

/// The paper box a sentence of the bridge sits in.
struct PieceBridgeBox<Content: View>: View {
    @ViewBuilder let content: () -> Content
    @Environment(\.palette) private var palette

    var body: some View {
        content()
            .font(Brand.sans(12))
            .foregroundStyle(palette.inkSoft)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(palette.paper))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(palette.line, lineWidth: 1))
    }
}

#Preview("Studio bridge") {
    ScrollView {
        PieceStudioLinkView(model: PieceEditorFixtures.model())
            .padding(14)
    }
    .frame(width: 352, height: 480)
    .darkroom()
}
