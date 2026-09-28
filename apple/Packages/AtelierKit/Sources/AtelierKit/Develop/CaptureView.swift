// The capture's files as a VIEWER lists them — the words on the lightbox's
// chips, what each one can show, and what the `Develop` verb under the picture
// carries away. Port of `src/shared/develop/capture-view.ts` (R6 of
// `docs/capture-renditions.md`).
//
// The viewer writes NOTHING — *"la visionneuse n'écrit aucun choix, c'est
// juste de la visualisation"*. Looking at the camera's JPEG beside the proxy
// is looking; what carries the choice is the VERB (`viewedRendition`). The
// fetching, the slicing of a RAW's render and the images are the app's.
//
// The web reads an instance's row as `WinnowAssetRow`; the kernel takes the
// few fields the viewer needs as `CaptureRow` (the wire's snake_case keys in
// lowerCamel), so a later port of the Winnow client maps its row onto it.

import Foundation

/// The rows a viewer can put on screen: everything but the SENSOR's. A viewer
/// draws files; developing a sensor plane is the Develop tool's work, and a
/// chip that can only say "open Develop" is a control that disappoints.
public func viewableRenditions(_ rows: [Rendition]) -> [Rendition] {
    rows.filter { $0.role != .sensor }
}

/// The chip's word — the fidelity chip's own: `Proxy`, else the file's name.
public func viewLabel(_ row: Rendition) -> String {
    row.role == .proxy ? "Proxy" : row.name
}

/// The line under the picture while that file is shown: what it is, its
/// pixels where measured, its weight, and whether a click will fetch it.
public func viewFacts(_ row: Rendition, _ format: (Int) -> String) -> String {
    var parts: [String] = []
    if row.role == .proxy {
        parts.append("the proxy, where the picture opens")
    } else if row.reach == .embedded {
        parts.append("the render the camera wrote inside the RAW")
    } else {
        parts.append("the file itself")
    }
    if let pixels = row.pixels { parts.append("\(pixels.width) × \(pixels.height)") }
    if let bytes = row.bytes { parts.append(format(bytes)) }
    if !row.here, let assetId = row.assetId, !assetId.isEmpty {
        parts.append("fetched from its instance on request, held for this session")
    }
    return parts.joined(separator: " · ")
}

/// What the `Develop` verb hands to the tool: the rendition being viewed, as
/// the roll stores it — nil for the one the picture opens on, which is what
/// the workbench stores for "chose nothing", so a look at the proxy never
/// writes a choice the pill would then draw as one.
public func viewedRendition(_ rows: [Rendition], _ viewing: String?) -> String? {
    guard let viewing, !viewing.isEmpty else { return nil }
    guard let row = rows.first(where: { $0.id == viewing }), row.blocked == nil else { return nil }
    return row.id == openingRendition(rows)?.id ? nil : row.id
}

/// The fields of an instance's asset row the viewer reads.
public struct CaptureRow: Equatable, Sendable {
    public var id: Int
    public var filename: String
    public var width: Int?
    public var height: Int?
    public var fileSize: Int?
    /// `raw_jpeg`, `live_photo`, … — how the instance paired the companion.
    public var groupKind: String?
    public var companionId: Int?
    public var companionFilename: String?
    public var companionFileSize: Int?
    /// `photo` or `video`.
    public var companionMediaType: String?
    public var companionWidth: Int?
    public var companionHeight: Int?

    public init(id: Int, filename: String, width: Int? = nil, height: Int? = nil, fileSize: Int? = nil,
                groupKind: String? = nil, companionId: Int? = nil, companionFilename: String? = nil,
                companionFileSize: Int? = nil, companionMediaType: String? = nil,
                companionWidth: Int? = nil, companionHeight: Int? = nil) {
        self.id = id; self.filename = filename; self.width = width; self.height = height; self.fileSize = fileSize
        self.groupKind = groupKind; self.companionId = companionId; self.companionFilename = companionFilename
        self.companionFileSize = companionFileSize; self.companionMediaType = companionMediaType
        self.companionWidth = companionWidth; self.companionHeight = companionHeight
    }
}

private func rowSize(_ width: Int?, _ height: Int?) -> PixelSize? {
    guard let width, let height, width > 0, height > 0 else { return nil }
    return PixelSize(width: width, height: height)
}

/// One of the row's files as a capture's file: a RAW's stated pixels are its SENSOR's.
private func rowFile(_ name: String, _ bytes: Int?, _ here: Bool, _ assetId: String, _ width: Int?, _ height: Int?) -> CaptureFile {
    var file = CaptureFile(name: name, bytes: bytes, here: here, assetId: assetId)
    if isRawImage(name) { file.sensor = rowSize(width, height) } else { file.pixels = rowSize(width, height) }
    return file
}

/// An instance's ROW as a capture, for the sheet that looks at a day before
/// anything is fetched: the proxy it shows, the primary's own file, and the
/// companion the instance paired with it — the same three files a fetched
/// picture's origin names, so the ids match what the workbench lists once the
/// picture crosses (`delivered:<name>` on both sides). `held` says which of
/// them the session already holds. Nothing is read from a head here: a RAW's
/// render size stays unmeasured until it is looked at. A companion that is not
/// a photograph — a Live Photo's `.mov` — is never a file of the capture.
public func rowCaptureInput(_ row: CaptureRow, _ host: String, _ held: (String) -> Bool) -> CaptureInput {
    let assetId = "\(host)/\(row.id)"
    var others = [rowFile(row.filename, row.fileSize, held(assetId), assetId, row.width, row.height)]
    if let cid = row.companionId, cid != 0, let cname = row.companionFilename, !cname.isEmpty,
       row.groupKind == nil || row.groupKind == "" || row.groupKind == "raw_jpeg",
       row.companionMediaType == nil || row.companionMediaType == "" || row.companionMediaType == "photo" {
        let companionId = "\(host)/\(cid)"
        others.append(rowFile(cname, row.companionFileSize, held(companionId), companionId, row.companionWidth, row.companionHeight))
    }
    return CaptureInput(
        open: CaptureFile(name: row.filename, bytes: nil, here: true, assetId: assetId),
        openIsProxy: true,
        others: others
    )
}
