// The develop CLIPBOARD: one record held for the session, so "the same
// correction on the next picture" costs two clicks — and crosses Trips ↔
// Studio with zero storage, because the clipboard is module state, not a
// document field. Port of `src/shared/develop/develop-clipboard.ts`.
//
// Never persisted: a clipboard that outlived the app would paste yesterday's
// light onto today's picture without anyone having copied it.
//
// The web's module state is a class here — `DevelopClipboard.shared` for the
// web's free functions, or an instance of the app's own.

import Foundation

public final class DevelopClipboard {
    public static let shared = DevelopClipboard()

    private var held: DevelopSettings?
    private var listeners: [Int: () -> Void] = [:]
    private var nextToken = 0

    public init() {}

    private func notify() {
        for listener in listeners.values { listener() }
    }

    /// Keep a copy of `settings`; an as-shot develop clears the clipboard.
    /// The NUMBERS travel, never the material: a base is a fact about one
    /// picture's bytes, and its metered gain on a JPEG would be stops too bright.
    public func copy(_ settings: DevelopSettings?) {
        let numbers = settings.map(withoutBase)
        held = (numbers != nil && !isDefaultDevelop(numbers)) ? cloneDevelop(numbers) : nil
        notify()
    }

    /// What was copied, as a fresh value, or nil when nothing is held.
    public func paste() -> DevelopSettings? {
        held.map(cloneDevelop)
    }

    public var hasCopied: Bool { held != nil }

    /// The listener runs on every copy and on a clear; the closure returned takes it off.
    public func subscribe(_ listener: @escaping () -> Void) -> () -> Void {
        let token = nextToken
        nextToken += 1
        listeners[token] = listener
        return { [weak self] in self?.listeners[token] = nil }
    }

    /// Forget what is held.
    public func clear() {
        held = nil
        notify()
    }
}

/// The web's names, over the shared clipboard.
public func copyDevelop(_ settings: DevelopSettings?) {
    DevelopClipboard.shared.copy(settings)
}

public func pasteDevelop() -> DevelopSettings? {
    DevelopClipboard.shared.paste()
}

public func hasCopiedDevelop() -> Bool {
    DevelopClipboard.shared.hasCopied
}

public func subscribeDevelopClipboard(_ listener: @escaping () -> Void) -> () -> Void {
    DevelopClipboard.shared.subscribe(listener)
}

/// Tests only: forget what is held.
public func clearDevelopClipboard() {
    DevelopClipboard.shared.clear()
}
