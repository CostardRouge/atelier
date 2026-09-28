// The pixel under the pointer, held OUTSIDE the view's state. Port of
// `src/shared/develop/readout-store.ts`.
//
// A readout changes on every pointer move over the picture; as a state of the
// picture's view it would re-render the whole workbench — the inspector, the
// filmstrip, every panel — sixty times a second. Held here, only the one line
// that shows it subscribes.
//
// The `Readout` it carries is `Render/Clipping.swift`'s (`readoutOf` reads a
// pixel into one), never a second definition.

import Foundation

/// What the pointer is over, and on which side of the divider.
public struct StageReadout: Equatable, Sendable {
    public var readout: Readout
    /// Left of the before/after divider: the picture AS SHOT.
    public var before: Bool
    public init(readout: Readout, before: Bool) { self.readout = readout; self.before = before }
}

/// One readout and its listeners. The web's closure-built store is a class
/// here, one per stage (`createReadoutStore`).
public final class ReadoutStore {
    private var value: StageReadout?
    private var listeners: [Int: () -> Void] = [:]
    private var nextToken = 0

    public init() {}

    public func get() -> StageReadout? { value }

    /// A readout that says what the last one said is not a change: nobody is told.
    public func set(_ next: StageReadout?) {
        if value == next { return }
        value = next
        for listener in listeners.values { listener() }
    }

    /// The listener runs on every change; the closure returned takes it off.
    public func subscribe(_ listener: @escaping () -> Void) -> () -> Void {
        let token = nextToken
        nextToken += 1
        listeners[token] = listener
        return { [weak self] in self?.listeners[token] = nil }
    }
}

public func createReadoutStore() -> ReadoutStore {
    ReadoutStore()
}
