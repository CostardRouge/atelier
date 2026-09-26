// Dragging a picture out of the Library and onto something that wants one —
// the transfer half of `src/shared/library/asset-drag.ts`.
//
// Two channels, as on the web: the transfer carries a KEY, and the drag ITEM
// (the picture's name, a `resolve` that hands the file over — at once for a
// picture in the Library, after a fetch for a tile an instance still holds)
// lives in the app's memory for the length of the drag. The web puts the key
// under its own MIME type with a plain-text twin; a SwiftUI drag carries what
// a `Transferable` exports, so here the key travels as TEXT behind a prefix —
// what tells our drag apart from a file dropped from the Finder, or a word of
// selected text, and what a drop outside the app pastes: something inert
// rather than nothing. The in-memory item and its closures are the app's.

import Foundation

/// The prefix a drag's text carries — ours, and nobody else's.
public let assetDragPrefix = "atelier-asset:"

/// Where the dragged picture is: `library` lands at once, `instance` is
/// fetched on drop, so a target shows it arriving rather than a drop that did
/// nothing.
public enum AssetDragOrigin: String, Equatable, Sendable, CaseIterable {
    case library, instance
}

/// The text a drag of `key` carries.
public func assetDragText(_ key: String) -> String {
    assetDragPrefix + key
}

/// The key a drop carries, or nil when it carries something else — a file, a
/// selection, our prefix over nothing.
public func draggedAssetKey(_ text: String?) -> String? {
    guard let text, text.hasPrefix(assetDragPrefix) else { return nil }
    let key = text.dropFirst(assetDragPrefix.count).trimmingCharacters(in: .whitespacesAndNewlines)
    return key.isEmpty ? nil : key
}

/// The key a pool asset's row or tile drags under — the web's `asset:<id>`.
public func libraryDragKey(_ assetId: String) -> String {
    "asset:\(assetId)"
}

/// The key an instance's tile drags under — the web's `remote:<host>/<id>`.
public func instanceDragKey(_ host: String, _ id: Int) -> String {
    "remote:\(host)/\(id)"
}
