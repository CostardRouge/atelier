// The Export tab's *Delivers* row — the web's `useDeliveryRow` as
// `PostEditor.tsx` feeds it: what the OPEN picture will really give the
// deck's own frame (1920 on the long edge, at the piece's aspect), in the
// calculator's one sentence (`deliversLine`), measured from the file itself.
//
// Rules kept (`roadtrip.md`, «A still leaves from the pixels the frame
// needs»; `renditions-build.md`):
// - Measured only while the Export tab is up — measuring reads the file, and
//   a sentence is not worth that on every slide stepped past.
// - Never for a collage: each cell is drawn into a fraction of the frame, so
//   the whole frame's answer would be wrong for every one of them. A clip is
//   not a still and is not measured either. Both say "—" and the web's hint.
// - A picture that MOVES is measured at its deepest zoom (`deepestFraming`):
//   its closest frame is the one that asks the most pixels.
// - Said, never chosen: there is no door here to force or refuse an original.
//
// One native departure, SAID in the hint rather than left to be found in the
// file: this device's piece export draws every still from the file in the
// Library (`TripPieceExport`'s resolver) and does not yet fetch a proxy's
// original where the proxy would be upscaled, as the web's does
// (`deliveryFor`). So the line is always the file in hand's, and where the
// web would have fetched the original, the hint names that original and says
// the proxy is what leaves here.

import SwiftUI
import AtelierKit

/// A still's pixels, as measured for the row — the file's own, upright.
struct PieceMeasured: Equatable {
    /// Which file and which of its names were measured.
    var key: String
    var size: AtelierKit.Size
    /// The pixels are the render a camera wrote inside its RAW.
    var viaRawPreview: Bool
}

struct PieceDeliversRow: View {
    let model: PieceEditorModel
    @State private var measured: PieceMeasured?
    @Environment(\.palette) private var palette

    static let waiting = "measured for the picture on screen, once it is in the Library"

    /// Over a proxy whose original is a RAW this device reads no render size,
    /// so the kernel's "read at export" is never promised here.
    static let rawReason = "its original is a RAW: only the render inside it is decodable, and this device does not read that render's size yet — the proxy is what leaves"

    var body: some View {
        let target = PieceDeliversRow.target(model)
        let fresh = measured.flatMap { $0.key == target?.key ? $0 : nil }
        let said = PieceDeliversRow.words(model, fresh, target?.ref)
        OverlayPanelRow("Delivers", hint: said.hint, alignTop: true) {
            Text(verbatim: said.line ?? "—")
                .font(Brand.mono(12))
                .monospacedDigit()
                .foregroundStyle(said.line == nil ? palette.muted : palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .task(id: target?.key) {
            guard let target else { return }
            let result = await PieceDeliversRow.measure(target.url, name: target.ref.name)
            guard !Task.isCancelled else { return }
            measured = result.map { PieceMeasured(key: target.key, size: $0.size, viaRawPreview: $0.viaRawPreview) }
        }
    }

    // MARK: - which file

    /// The open picture's file, when there is one worth measuring: not a
    /// collage, not the closing card, not a clip.
    static func target(_ model: PieceEditorModel) -> (ref: SavedMediaRef, url: URL, key: String)? {
        guard model.collage == nil, !model.isCta, let ref = model.cellRef, !BadgeSources.isClip(ref.name),
              let url = model.url(for: ref) else { return nil }
        return (ref, url, "\(url.absoluteString)|\(ref.name)")
    }

    // MARK: - what it says

    /// The line and its hint, from what was measured.
    static func words(_ model: PieceEditorModel, _ measured: PieceMeasured?,
                      _ ref: SavedMediaRef?) -> (line: String?, hint: String?) {
        guard let measured, let ref else { return (nil, waiting) }
        let out = frameSize(model.aspect, Double(deckLongEdge))
        let framing = deepestFraming(model.cellFraming, model.cellMotion)
        let origin = (model.library as? LibraryStore)?.entry(for: ref)?.origin
        let proxy = origin?.fidelity == .proxy
        // The file in hand is what this device's export draws: no original
        // is handed in, so the arithmetic answers for the file alone.
        let summary = fixedFrameDelivery(measured.size, proxy, nil, framing, out,
                                         viaRawPreview: measured.viaRawPreview)
        return (summary.line, reason(origin, measured.size, framing, out))
    }

    /// Why these pixels, in the web's words — and, where the web would fetch
    /// the original, that this device does not yet.
    static func reason(_ origin: MediaOrigin?, _ size: AtelierKit.Size, _ framing: Framing,
                       _ out: AtelierKit.Size) -> String? {
        guard let origin, origin.fidelity == .proxy else { return nil }
        if isProxyOverRaw(origin) { return rawReason }
        let original = originalOf(origin)
        let choice = choosePixels(.auto, pixelHeadroom(size, framing, out), original, size)
        guard choice.from == .original else { return choice.reason }
        let why = choice.reason ?? "the proxy would be upscaled"
        return "\(why) — \(originalLabel(original)) is not fetched for a piece on this device yet: the proxy is what leaves"
    }

    // MARK: - measuring

    /// The file's own pixels as SHOWN. A RAW is read the way the export reads
    /// it — the render inside it first (`PictureDecoder`, whose image is lazy:
    /// nothing is decoded to learn its size); any other still from its header.
    static func measure(_ url: URL, name: String) async -> (size: AtelierKit.Size, viaRawPreview: Bool)? {
        await Task.detached(priority: .utility) { () -> (size: AtelierKit.Size, viaRawPreview: Bool)? in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if PictureDecoder.isRaw(name) {
                guard let data = try? Data(contentsOf: url, options: .mappedIfSafe),
                      let decoded = PictureDecoder.decode(data, name: name) else { return nil }
                let size = AtelierKit.Size(Double(decoded.width), Double(decoded.height))
                return (size, decoded.viaRawPreview)
            }
            guard let shown = InstrumentImages.shownSize(url) else { return nil }
            return (AtelierKit.Size(Double(shown.width), Double(shown.height)), false)
        }.value
    }
}

#Preview("Delivers") {
    VStack(alignment: .leading) {
        PieceDeliversRow(model: PieceEditorFixtures.model())
    }
    .frame(width: 340)
    .padding(16)
    .darkroom()
}
