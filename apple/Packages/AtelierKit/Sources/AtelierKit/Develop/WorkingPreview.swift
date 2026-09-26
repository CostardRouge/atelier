// A WORKING PREVIEW — the copy of a local picture a roll keeps so it can be
// developed while the file itself is away (the maintainer's Q2: local pictures
// only, per roll, opt-in, its weight said). Lightroom calls the same thing a
// smart preview. Port of `src/shared/develop/working-preview.ts`.
//
// On the web a preview is handed around as an ordinary `File` named like the
// picture, MARKED in a `WeakSet` so anything that must tell the difference
// (the fidelity chip, the export) can. A value type has no identity to mark:
// here a preview is its own type, `WorkingPreviewFile`, and the TYPE is the
// mark — `isWorkingPreview` asks it, under the web's name. Where the app keeps
// the bytes (the web keeps them in IndexedDB) is the app's.

import Foundation

/// The long edge a working preview is made at — a Winnow proxy's.
public let workingPreviewEdge = 2048
/// JPEG quality of a working preview.
public let workingPreviewQuality = 0.82
/// What one preview weighs, roughly, for the sentence said BEFORE any is made.
public let workingPreviewEstimateBytes = 450_000

/// A stored preview: named like its picture, dated like it, a JPEG unless said otherwise.
public struct WorkingPreviewFile: Equatable, Sendable {
    public var name: String
    public var lastModified: Double
    public var type: String
    public var data: Data

    public init(name: String, lastModified: Double, type: String = "image/jpeg", data: Data) {
        self.name = name; self.lastModified = lastModified; self.type = type; self.data = data
    }
}

/// A preview for the bytes of a stored one; an empty type is a JPEG's.
public func workingPreviewFile(_ data: Data, type: String = "", name: String, lastModified: Double) -> WorkingPreviewFile {
    WorkingPreviewFile(name: name, lastModified: lastModified, type: type.isEmpty ? "image/jpeg" : type, data: data)
}

/// Whether what a block was handed is a working preview rather than the real
/// file — the export must never deliver one, the fidelity chip says so.
public func isWorkingPreview(_ file: Any?) -> Bool {
    file is WorkingPreviewFile
}

/// Where a roll's opt-in is kept: this device's, like the previews themselves.
public func workingPreviewsKey(_ rollId: String) -> String {
    "atelier.develop.previews.\(rollId)"
}
