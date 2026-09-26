// Lensfun on THIS DEVICE — the app's half of `src/shared/lens/lensfun-store.ts`
// (the kernel's `LensfunLookup.swift` holds the logic; this is what it is
// handed): the consent, the fetch, and the answers kept on disk.
//
// The suite's THIRD network exception (`local-first.md`, `lens-profiles.md`,
// his YES of 2026-09-23), and every rule of it:
//
// - **Consent** is the DEVICE's (`UserDefaults` `atelier.lensfun`, the web's
//   own key), off until turned on, never on a roll: an exported `.roll.json`
//   must not carry someone's permission to talk to a third party.
// - **The fetch** reaches ONE host, `raw.githubusercontent.com`, for the
//   fewest database files that can answer (`LensfunSource.swift`), on an
//   ephemeral session — no cookie, no cache on disk, nothing about the
//   picture sent. A file is read once per launch and then let go; a failure
//   is not remembered, so the next ask tries again.
// - **What is kept** is the ANSWER, never a file: per body + lens as the EXIF
//   names them, the matched camera and the whole calibrated lens, or "not in
//   Lensfun" (believed for a month) — `lens-profiles.json` beside the rolls.
//   Every storage failure degrades to asking again.

import Foundation
import Observation
import AtelierKit

@MainActor
@Observable
final class LensfunStore {
    static let shared = LensfunStore()

    /// The web's own consent key.
    static let consentKey = "atelier.lensfun"

    /// The person allowed the lookup on this device.
    private(set) var allowed: Bool
    /// This launch's answers, by the shot's key (body · lens · focal · aperture).
    private(set) var answers: [String: LensLookUp] = [:]
    /// Shots being looked up now.
    private(set) var looking: Set<String> = []

    private let fileURL: URL
    @ObservationIgnored private var kept: [String: LensMatchRecord]?
    @ObservationIgnored private var parsed: [String: Task<LensfunDb?, Never>] = [:]
    private let session: URLSession

    init(root: URL = RollStore.defaultRoot()) {
        allowed = UserDefaults.standard.string(forKey: LensfunStore.consentKey) == "on"
        fileURL = root.appendingPathComponent("lens-profiles.json")
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    // MARK: - consent

    func setAllowed(_ on: Bool) {
        if on {
            UserDefaults.standard.set("on", forKey: LensfunStore.consentKey)
        } else {
            UserDefaults.standard.removeObject(forKey: LensfunStore.consentKey)
        }
        allowed = on
    }

    // MARK: - answers

    func answer(for shot: ShotLens) -> LensLookUp? {
        answers[shot.key]
    }

    func isLooking(_ shot: ShotLens) -> Bool {
        looking.contains(shot.key)
    }

    /// The camera and the lens the shot names — kept, else asked of Lensfun
    /// when allowed. Never throws.
    @discardableResult
    func lookUp(_ shot: ShotLens) async -> LensLookUp {
        let key = shot.key
        looking.insert(key)
        let result = await AtelierKit.lookUpLens(
            shot, now: nowMillis(), allowed: allowed,
            readMatch: { id in await self.readMatch(id) },
            writeMatch: { record in await self.writeMatch(record) },
            fileDb: { file in await self.fileDb(file) }
        )
        answers[key] = result
        looking.remove(key)
        return result
    }

    // MARK: - what the device keeps

    private func loadKept() -> [String: LensMatchRecord] {
        if let kept { return kept }
        var out: [String: LensMatchRecord] = [:]
        if let data = try? Data(contentsOf: fileURL),
           let text = String(data: data, encoding: .utf8),
           let list = JSONValue.parse(text)?.objectValue?["matches"]?.arrayValue {
            for item in list {
                if let record = readLensMatchRecord(item) { out[record.id] = record }
            }
        }
        kept = out
        return out
    }

    private func readMatch(_ id: String) async -> LensMatchRecord? {
        loadKept()[id]
    }

    private func writeMatch(_ record: LensMatchRecord) async {
        var all = loadKept()
        all[record.id] = record
        kept = all
        let sorted = all.values.sorted { $0.id < $1.id }
        let json = JSONValue.object(["matches": .array(sorted.map(\.json))])
        let url = fileURL
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(json.serialized().utf8).write(to: url, options: .atomic)
        } catch {
            // Not kept: the next picture from this lens asks again.
        }
    }

    // MARK: - the fetch

    /// One database file, fetched and read once per launch; nil when it cannot be had.
    private func fileDb(_ file: String) async -> LensfunDb? {
        if let held = parsed[file] { return await held.value }
        let session = self.session
        let task = Task.detached(priority: .utility) { () -> LensfunDb? in
            guard let url = URL(string: lensfunUrl(file)) else { return nil }
            var request = URLRequest(url: url)
            request.httpShouldHandleCookies = false
            guard let answer = try? await session.data(for: request) else { return nil }
            let (data, response) = answer
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let text = String(data: data, encoding: .utf8) else { return nil }
            return parseLensfunXml(text)
        }
        parsed[file] = task
        let db = await task.value
        // A failure is not remembered: the next ask tries the network again.
        if db == nil { parsed[file] = nil }
        return db
    }
}
