// The personal PRESET BOOK on this device — one list of named lights, the
// same in every Develop surface (`develop-roll.md`, D4). The kernel's
// `PresetBook` is the document; this store keeps it as ONE file beside the
// rolls (`Application Support/Atelier/presets.json`), written through with the
// same debounce as a roll and flushed with them.
//
// Rules kept from the web (`preset-book.ts`): the book's id is minted like any
// document's — a UUID, never a fixed name — so a second device finds it by
// listing its kind once Sources arrive; a preset is a COPY of numbers, applied
// and never followed, and never a material (`withoutBase`); saving under a
// taken name replaces it in place; a preset of zeros with no look is refused.
// Keeping the book on a Winnow (the web's `PresetsPlaceRow`) waits for the
// app's Winnow client.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class PresetBookStore {
    private(set) var book: PresetBook
    private let url: URL
    @ObservationIgnored private var pending: Task<Void, Never>?

    init(root: URL? = nil) {
        let folder = root ?? RollStore.defaultRoot()
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("presets.json")
        url = file
        let stored = (try? Data(contentsOf: file)).flatMap { JSONValue.parse($0) }
        book = readPresetBook(stored) ?? createPresetBook(newRollId())
    }

    var presets: [DevelopPreset] { book.presets }

    /// Where the book is kept, as the Presets section says it.
    var keptOn: String { "on this device" }

    /// Save the numbers under `name` — the list rules are the kernel's; a look
    /// (a `SavedGrade` as written) rides with the light when given. Returns
    /// false when nothing was saved (a blank name, an as-shot develop with no look).
    @discardableResult
    func save(name: String, settings: DevelopSettings?, look: JSONValue? = nil) -> Bool {
        let next = savePresetInBook(book, name, settings, newRollId(), look: look)
        if next == book { return false }
        book = next
        persist()
        return true
    }

    func remove(_ id: String) {
        let next = removePresetFromBook(book, id)
        if next == book { return }
        book = next
        persist()
    }

    /// Who signs a delivered picture — read by the export.
    func setIdentity(_ identity: DeliveryIdentity) {
        let next = withIdentity(book, identity)
        if next == book { return }
        book = next
        persist()
    }

    private func persist() {
        pending?.cancel()
        let text = book.json.serialized(pretty: true)
        let target = url
        pending = Task { [weak self] in
            try? await Task.sleep(nanoseconds: RollStore.saveDebounceNanos)
            guard !Task.isCancelled else { return }
            try? text.write(to: target, atomically: true, encoding: .utf8)
            self?.pending = nil
        }
    }

    /// Write now — the app is going to the background.
    func flush() {
        guard let task = pending else { return }
        task.cancel()
        pending = nil
        try? book.json.serialized(pretty: true).write(to: url, atomically: true, encoding: .utf8)
    }
}
