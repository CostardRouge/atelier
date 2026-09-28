// A picture that comes from the shell's LIBRARY — dropped on the filmstrip, or
// carried by the `Develop` verb under a picture looked at large (the web's
// `RollEditor.tsx`, «the shell's verb»; `develop-roll.md`).
//
// The Library already knows where the file is and what it is: a file pointed
// at is added by its bookmark (never copied), a file inside a folder by the
// folder's bookmark and its path, and a Photos pick is COPIED into the roll's
// container, the one way the roll reaches it tomorrow. A picture FETCHED from
// an instance is not: it goes on by its ref, and the roll fetches it again
// from its asset id when it is looked at (`RollEditor+Winnow.swift`) — the
// Library's own session copy first, while it is there. The ref travels as the Library
// holds it, so the roll names the media by its hash, or by its instance's
// asset id, never by its name alone. A picture already on the roll is OPENED,
// never added twice.
//
// The verb also carries the FILE of the capture that was on screen
// (`MediaView.rendition`) onto the picture — the same field the chip above
// the photograph writes — and sets a RAW base aside where it stood, exactly
// as choosing a file under the chip does.

import Foundation
import AtelierKit

extension RollEditor {
    /// Add (or find again) a picture the Library hands over, open it, and put
    /// on it the rendition that was being looked at.
    func addFromLibrary(_ dropped: DroppedAsset, rendition: String? = nil) {
        guard classifyPart(dropped.ref.name) == .image else {
            notice = "only a photograph can be developed"
            return
        }
        let id: String
        switch store.add(dropped, to: rollId) {
        case .added(let added):
            id = added
            notice = "added 1"
        case .found(let found):
            id = found
            notice = "found 1 again"
        case .already(let known):
            id = known
            notice = nil
        case .failed:
            notice = "\(dropped.ref.name) could not be read"
            return
        }
        adoptStoreChange()
        pool.retry([id])
        if let rendition {
            update { roll in
                patchPicture(roll, id) { picture in
                    guard picture.rendition != rendition else { return }
                    picture.rendition = rendition
                    if let develop = picture.develop, isRawDevelop(develop) { picture.develop = withoutBase(develop) }
                }
            }
        }
        open(id)
        requestRender()
    }

    /// A drag out of the Library landed on the roll: the picture is resolved —
    /// fetched first when an instance still holds it — then added.
    func addDragged(_ item: AssetDragItem) {
        if item.origin == .instance {
            notice = "fetching \(item.label) from \(item.sourceLabel ?? "its instance")…"
        }
        Task { @MainActor in
            guard let dropped = await item.resolve() else {
                notice = "\(item.label) could not be had"
                return
            }
            addFromLibrary(dropped)
        }
    }
}

extension RollStore {
    /// A Library picture put on a roll: by its bookmark, by its folder's
    /// bookmark and path, or — a session copy — copied into the container.
    func add(_ dropped: DroppedAsset, to rollId: String) -> Added {
        switch dropped.location {
        case .bookmark(let bookmark):
            guard let url = try? RollStore.resolveBookmark(bookmark) else { return .failed }
            return addPicture(to: rollId, url: url, ref: dropped.ref)
        case .folder(let bookmark, let path):
            return addPicture(to: rollId, folder: bookmark, path: path, ref: dropped.ref)
        case .session(let path):
            // A picture FETCHED from an instance goes on by its ref alone: the
            // roll finds it in the Library, else fetches it again from its
            // asset id — never a byte cache of an instance's picture
            // (`develop-media.md`, `RollEditor+Winnow.swift`).
            if RollStore.isRemote(dropped.ref) { return addRef(to: rollId, dropped.ref) }
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return .failed }
            return addPicture(to: rollId, data: data, ref: dropped.ref)
        }
    }
}
