// The capture files a lightbox chip FETCHED — an instance's original, the
// companion it paired — held for the session so looking again costs nothing,
// the native twin of the web's `sources/original-cache.ts` as the viewers use
// it (R6, `renditions-build.md`). Keyed by asset id (`<host>/<id>`), written
// to the Library's session folder (never persisted), under the kernel's
// byte ceiling (`HeldBudget.swift`: the least recently used goes first, never
// the one used last).
//
// `version` moves whenever something lands, so a chip that fetched reads as
// in hand (`↓` gone) without the viewer re-asking.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class SessionOriginals {
    static let shared = SessionOriginals()

    private(set) var version = 0
    @ObservationIgnored private var files: [String: URL] = [:]
    @ObservationIgnored private var bytes: [String: Int] = [:]
    @ObservationIgnored private var used: [String: Double] = [:]
    @ObservationIgnored private var tick = 0.0
    @ObservationIgnored private let folder: URL
    @ObservationIgnored private let ceiling: Int

    init(folder: URL? = nil, ceiling: Int? = nil) {
        self.folder = folder ?? FileManager.default.temporaryDirectory
            .appendingPathComponent("Atelier-Library", isDirectory: true)
            .appendingPathComponent("originals-\(UUID().uuidString)", isDirectory: true)
        let gib = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        self.ceiling = ceiling ?? heldCeiling(gib, DevelopDevice.current)
    }

    /// Whether the file under `key` is in hand.
    func isHeld(_ key: String) -> Bool {
        files[key] != nil
    }

    /// The file held under `key`, touched as used.
    func url(_ key: String) -> URL? {
        guard let url = files[key] else { return nil }
        tick += 1
        used[key] = tick
        return url
    }

    /// Hold `data` as `name` under `key`; the least recently used go past the ceiling.
    @discardableResult
    func hold(_ key: String, name: String, data: Data) -> URL? {
        let dir = folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let target = dir.appendingPathComponent(RollStore.safeFileName(name))
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try data.write(to: target, options: .atomic)
        } catch {
            return nil
        }
        if let old = files[key] { try? FileManager.default.removeItem(at: old.deletingLastPathComponent()) }
        tick += 1
        files[key] = target
        bytes[key] = data.count
        used[key] = tick
        let entries = files.keys.map { HeldEntry(key: $0, bytes: bytes[$0] ?? 0, lastUsed: used[$0] ?? 0) }
        for gone in toEvict(entries, ceiling) {
            if let url = files[gone] { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
            files[gone] = nil
            bytes[gone] = nil
            used[gone] = nil
        }
        version += 1
        return target
    }
}
