// The piece editor's EXPORT tab — the web's `panels/ExportTab.tsx`: what
// leaves the tool.
//
// The tab leads with the PLAN — one line per slide, its format and why —
// because the deck already decided every format on the Content tab and this
// is where the author checks it before pressing anything (`exportPlan`, the
// kernel's, deciding nothing). Under it the one primary export, then the
// per-format escapes, then the bridge that sends the badge into a Studio
// project. All of it is about the PIECE, so all of it shows whichever slide
// is open (`roadtrip.md`, «A control about the PIECE…»).
//
// - What goes out: the last export's sentence, the plan line by line (a
//   blocked line struck through, never hidden), the hook's reason in full, the
//   blockers in red, *Delivers* (`PieceDeliversRow`), *Everything as images*
//   — the one override, which changes the medium and never the reason —,
//   where the files go (`PieceDelivery`: a folder picked at the click, or the
//   share sheet) and *Export the piece*, which counts what it writes.
// - One format at a time: every slide as a PNG, and the hook as a video when
//   the HOOK SLIDE is one (the slide's medium, never the file's type).
// - Studio: `PieceStudioLinkView`.
//
// What evaporates natively, and is said rather than drawn: the web's
// "this browser cannot encode video" (AVFoundation always can — `canEncode`
// is true) and its HEVC transcode (`TranscodeControl`, `useTranscode`): this
// device decodes a DJI's H.265 as it is, so a clip is never transcoded first.
//
// The folder picker lives HERE, in the tab, because it is where the verbs
// are — and, on a phone, inside the sheet the tab is, which is the one place
// a dialog can be presented from while that sheet is up. The header's Export
// raises this tab to ask (`requestExport`).

import SwiftUI
import UniformTypeIdentifiers
import AtelierKit

struct ExportTabView: View {
    let model: PieceEditorModel
    /// The one override the export keeps — not a mode: what a contact sheet
    /// of a reel is.
    @State private var imagesOnly = false
    /// The tab has settled on screen — a sheet raised to ask must finish
    /// coming up before a dialog is presented from it.
    @State private var settled = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PiecePlanSection(model: model, imagesOnly: $imagesOnly)
            PieceFormatsSection(model: model)
            DevelopSection(id: "piece.export.studio", title: "Studio", info: PieceExportWords.studioInfo,
                           remember: .local) {
                PieceStudioLinkView(model: model)
            }
        }
        .task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            settled = true
        }
        .onDisappear { settled = false }
        .fileImporter(isPresented: picking, allowedContentTypes: [.folder]) { result in
            switch result {
            case .success(let folder):
                model.folderPicked(folder)
            case .failure(let error):
                model.delivery.refused(error)
            }
        }
    }

    /// The folder asked for by a verb, once the tab is on screen.
    private var picking: Binding<Bool> {
        Binding(
            get: { settled && model.delivery.asking != nil },
            set: { if !$0 { model.delivery.askDismissed() } }
        )
    }
}

// MARK: - What goes out

struct PiecePlanSection: View {
    let model: PieceEditorModel
    @Binding var imagesOnly: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        let plan = PiecePlanSection.plan(model, imagesOnly: imagesOnly)
        DevelopSection(id: "piece.export.plan", title: "What goes out", badge: describePlan(plan),
                       info: PieceExportWords.planInfo, remember: .local) {
            if let note = model.exports.note {
                Text(verbatim: note)
                    .font(Brand.sans(12))
                    .foregroundStyle(palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            PieceDeliveryLines(model: model)
            PiecePlanList(plan: plan)
            if let first = plan.items.first {
                Text(verbatim: PieceExportWords.reasonSentence(first.reason, first.seconds, first.speed))
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(plan.blockers, id: \.self) { blocker in
                Text(verbatim: blocker)
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            PieceDeliversRow(model: model)
            OverlayPanelRow("As images") {
                OverlayPanelToggle("Everything as images", isOn: imagesOnly, words: "Every slide as a still") { on in
                    imagesOnly = on
                }
            }
            PieceIntoRow(delivery: model.delivery)
            PieceExportRun(model: model, files: plan.files, imagesOnly: imagesOnly)
        }
    }

    /// The run the button would start — read from the deck, never decided here.
    static func plan(_ model: PieceEditorModel, imagesOnly: Bool) -> PieceExportPlan {
        guard let trip = model.trip, let post = model.post else {
            return PieceExportPlan(items: [], files: 0, images: 0, videos: 0, blockers: [])
        }
        let library = model.library
        // A device always has an encoder here: AVFoundation writes H.264.
        let options = ExportPlanOptions(
            canEncode: true,
            hasPicture: { slide in slide.media == nil || library?.poolFile(named: slide.media) != nil },
            imagesOnly: imagesOnly
        )
        return exportPlan(trip, post, options)
    }
}

/// One line per slide: `01 · still` or `02 · 4.0s 2×`, then the file.
struct PiecePlanList: View {
    let plan: PieceExportPlan
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(plan.items, id: \.position) { item in
                row(item)
            }
        }
    }

    private func row(_ item: PlanItem) -> some View {
        let blocked = item.blocker != nil
        let title = item.name + (item.silent ? " · silent" : "")
        return HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(verbatim: PieceExportWords.planPrefix(item))
                .font(Brand.mono(11))
                .monospacedDigit()
                .foregroundStyle(palette.muted)
                .frame(width: 92, alignment: .leading)
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(verbatim: item.name)
                    .strikethrough(blocked)
                    .foregroundStyle(blocked ? palette.faint : palette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if item.silent {
                    Text(" · silent")
                        .foregroundStyle(palette.muted)
                        .fixedSize()
                }
            }
            .font(Brand.sans(13))
        }
        .help(title)
        .accessibilityElement(children: .combine)
        .accessibilityValue(item.blocker ?? "")
    }
}

/// Where the files go — this device's choice, said under it.
struct PieceIntoRow: View {
    let delivery: PieceDelivery

    var body: some View {
        OverlayPanelRow("Into", hint: hint) {
            Picker("Into", selection: Binding(get: { delivery.into }, set: { delivery.setInto($0) })) {
                ForEach(PieceDeliveryInto.allCases) { into in
                    Text(into.title).tag(into)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
        }
    }

    private var hint: String {
        delivery.into == .folder
            ? "A folder you choose — asked at the click, before a pixel is rendered. A file of the same name there is replaced."
            : "The share sheet, once the files are rendered — Photos, AirDrop, Files or another app. They are let go when you press Done."
    }
}

/// *Export the piece*: its running line in place of its word, its Cancel.
struct PieceExportRun: View {
    let model: PieceEditorModel
    let files: Int
    let imagesOnly: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        let running = model.exports.exporting
        let busy = running != nil || model.delivery.writing != nil
        HStack(spacing: 12) {
            Button {
                model.requestExport(.piece(imagesOnly: imagesOnly))
            } label: {
                Label(running ?? "Export the piece", systemImage: "square.and.arrow.up")
                    .font(Brand.sans(13, weight: .semibold))
                    .lineLimit(1)
            }
            .buttonStyle(.borderedProminent)
            .tint(palette.accent)
            .disabled(busy || files == 0)
            .help("Every slide of this piece, in the format it is")
            if running != nil {
                Button("Cancel") { model.exports.cancel() }
                    .buttonStyle(DevelopLinkButtonStyle())
                    .help("Stop between two slides — what was rendered stays")
            }
        }
        .padding(.top, 2)
    }
}

/// Where the last run's files went, or the share sheet waiting for them.
struct PieceDeliveryLines: View {
    let model: PieceEditorModel
    @Environment(\.palette) private var palette

    var body: some View {
        let delivery = model.delivery
        let ready = delivery.holding ? model.exports.delivered.map(\.url) : []
        VStack(alignment: .leading, spacing: 6) {
            if let folder = delivery.writing {
                line("Writing into \(folder)…", palette.faint)
            } else if let folder = delivery.landed {
                line("into \(folder)", palette.faint)
            }
            ForEach(delivery.failures, id: \.self) { failure in
                Text(verbatim: failure)
                    .font(Brand.sans(11))
                    .foregroundStyle(palette.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            if !ready.isEmpty {
                shareBlock(ready)
            }
        }
    }

    private func line(_ text: String, _ colour: Color) -> some View {
        Text(verbatim: text)
            .font(Brand.mono(10))
            .foregroundStyle(colour)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private func shareBlock(_ urls: [URL]) -> some View {
        let count = urls.count
        let title: String = count == 1 ? "Share the file" : "Share the \(count) files"
        return HStack(spacing: 12) {
            ShareLink(items: urls) {
                Label(title, systemImage: "square.and.arrow.up")
            }
            .buttonStyle(DevelopPillButtonStyle(on: true))
            Button("Done") { model.delivery.done(model.exports) }
                .buttonStyle(DevelopLinkButtonStyle())
                .help("Let the rendered files go")
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: Brand.controlRadius).fill(palette.accentWash))
        .overlay(RoundedRectangle(cornerRadius: Brand.controlRadius).stroke(palette.line, lineWidth: 1))
    }
}

// MARK: - One format at a time

struct PieceFormatsSection: View {
    let model: PieceEditorModel

    var body: some View {
        let slides = model.slides
        let hookIsVideoSlide = slides.first?.medium == .video
        let exporting = model.exports.exporting != nil || model.delivery.writing != nil
        let stills: String = slides.count == 1 ? "The slide as a PNG" : "All \(slides.count) slides as PNGs"
        let clip = "As a video · \(PieceExportWords.fixed1(model.hookLength))s"
        DevelopSection(id: "piece.export.formats", title: "One format at a time",
                       info: [PieceFormatsSection.sentence(model)], remember: .local) {
            OverlayPanelRow("Stills") {
                Button {
                    model.requestExport(.deck)
                } label: {
                    Label(stills, systemImage: "arrow.down.circle")
                }
                .buttonStyle(DevelopPillButtonStyle())
                .disabled(exporting)
            }
            if hookIsVideoSlide {
                OverlayPanelRow("Hook") {
                    Button {
                        model.requestExport(.hookClip)
                    } label: {
                        Label(clip, systemImage: "arrow.down.circle")
                    }
                    .buttonStyle(DevelopPillButtonStyle())
                    .disabled(exporting)
                }
            }
        }
    }

    /// The section's ⓘ: how the hook goes out, and which grade applies.
    static func sentence(_ model: PieceEditorModel) -> String {
        let hookSlide = model.slides.first
        let hook = PieceStudioBridge.hookGrade(model)
        let graded = hook.grade.layers.contains { $0.enabled && $0.intensity > 0 }
        return PieceExportWords.formatsSentence(
            hookIsVideoSlide: hookSlide?.medium == .video,
            hookIsVideo: model.hookRef.map { BadgeSources.isClip($0.name) } ?? false,
            speed: hookSlide?.speed ?? 1,
            hasHookFile: model.hookRef != nil,
            graded: graded,
            ownGrades: model.ownGrades,
            scope: hook.scope
        )
    }
}

// MARK: - the words

/// The tab's sentences — the web's, one place.
enum PieceExportWords {
    static let planInfo = [
        "Each slide leaves in the format it IS — decided on the Content tab, not here. Files are numbered in swipe order, so a deck mixing a clip and two photographs still uploads in the right one.",
        "A picture from your Winnow leaves from the file in the Library. Where that proxy could not fill the frame — a landscape proxy cropped to 4:5 already falls short, at ×1.25 — its full-size original is what should leave, and this device does not fetch it for a piece yet. Delivers says what the open picture will really give.",
        "HEVC footage — most DJI clips — is read here as it is: this device decodes it natively, so nothing is ever transcoded first.",
    ]

    static let studioInfo = [
        "Link the Studio project this clip is graded in and the badge can be sent there as an intro scene — with the trip’s closing card as the project’s outro when this piece closes on it. One export then carries the grade, the telemetry, the hook and the end card, with nothing left to join afterwards.",
        "Sending again replaces the last one and touches nothing else. The shades stay here: a Studio scene has one flat scrim rather than a gradient, so the strongest shade’s colour and strength cross over and its shape does not.",
    ]

    /// `01 · still`, `02 · 4.0s`, `03 · 4.0s 2×`.
    static func planPrefix(_ item: PlanItem) -> String {
        let position = String(format: "%02d", item.position)
        guard item.medium == .video else { return "\(position) · still" }
        let pace = item.speed != 1 ? " \(number(item.speed))×" : ""
        return "\(position) · \(fixed1(item.seconds))s\(pace)"
    }

    /// Why a slide goes out as it does, in full — the web's `reasonSentence`
    /// (`SlideDelivery.tsx`). A re-timed clip has no sound: audio is copied,
    /// never re-encoded — said beside the length rather than found in the file.
    static func reasonSentence(_ reason: SlideReason, _ seconds: Double, _ speed: Double) -> String {
        let pace = speed != 1 ? " at \(number(speed))×, without sound" : ""
        let length = fixed1(seconds)
        switch reason {
        case .animated:
            return "This slide animates, so it goes out as a \(length)s video\(pace)."
        case .moving:
            return "Its picture is a clip, so it goes out as \(length)s of video\(pace)."
        case .forcedVideo:
            return "A still picture, held for \(length)s of video because you asked."
        case .settled:
            return "This slide animates, but you asked for an image: the badge is drawn settled, as it comes to rest."
        case .frozen:
            return "Its picture is a clip, but you asked for an image: the frame you chose is what goes out."
        case .plain:
            return "A still picture, delivered as one."
        }
    }

    /// The "One format at a time" ⓘ — how the hook goes out, then the grade.
    static func formatsSentence(hookIsVideoSlide: Bool, hookIsVideo: Bool, speed: Double, hasHookFile: Bool,
                                graded: Bool, ownGrades: Int, scope: GradeScope) -> String {
        var sentence: String
        if hookIsVideoSlide {
            if !hookIsVideo {
                sentence = "The hook is painted over its photograph, frame by frame, so its entrance plays. It comes out silent — there is no track to copy"
            } else if speed != 1 {
                sentence = "The hook’s clip starts on its in point and plays at \(number(speed))×, so the badge animates in on the first frame at its own pace. A re-timed clip goes out without sound"
            } else {
                sentence = "The hook’s clip starts on its in point, so the badge animates in on the first frame. Audio is copied through"
            }
        } else if hasHookFile {
            sentence = "The hook goes out as an image: nothing on it moves. Give it an animation on the Look tab, or set the slide to Video to hold it as a card"
        } else {
            sentence = "Give the hook a picture from the Library first"
        }
        if ownGrades > 0 {
            let which = ownGrades == 1 ? "one of them has a look of its own" : "\(ownGrades) of them have a look of their own"
            sentence += ", and each picture goes through the grade it wears — \(which)."
        } else if graded {
            sentence += ", and every picture goes through \(scope == .post ? "this piece’s own" : "the trip’s") grade."
        } else {
            sentence += "; nothing is graded — no grade is set."
        }
        return sentence
    }

    /// `toFixed(1)`.
    static func fixed1(_ x: Double) -> String {
        String(format: "%.1f", x)
    }

    /// A number as JavaScript's template literal prints it: `2`, `0.5`.
    static func number(_ x: Double) -> String {
        if x.isFinite, x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
        return String(x)
    }
}

#Preview("Export tab") {
    ScrollView {
        ExportTabView(model: PieceEditorFixtures.model())
            .padding(.horizontal, 14)
    }
    .frame(width: 352, height: 760)
    .darkroom()
}
