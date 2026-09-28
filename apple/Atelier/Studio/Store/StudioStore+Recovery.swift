// A project's media that lives on an INSTANCE, found again when the project
// opens — the Studio's twin of the re-fetch Trips and Develop do (the web's
// `resolve-media.ts`; `architecture.md`, «A remote ref is re-FETCHED, never
// cached»), over the kernel's `Projects/StudioRecovery.swift`:
//
// 1. what the shell's Library still holds of a capture (an earlier open this
//    session, a pick in its instance tab) is taken from there — no request;
// 2. the rest is asked of its instance, when that instance is connected here:
//    the row by its id, then the proxy and its log through `materialize`, each
//    capture a task scoped to it (so its tile in the Library's instance tab
//    wears the same edge) with its bytes and a Cancel — into the Library's
//    pool first, as every fetched media is the Library's, then into the
//    project for the session;
// 3. an instance not connected here is never asked: said, with Sources as the
//    cure. A 404 is "gone"; any other answer says its own reason, and "not
//    signed in" comes with the sign-in.
//
// Each landing counts the reconciliation again, so the banners follow; a save
// meanwhile keeps every ref the recovery still speaks for
// (`filesKeepingRecovery`), so a clip out of reach never falls off the project.
// Nothing runs at launch: only when a project is opened, or when "Try again"
// is pressed.

import Foundation
import AtelierKit

extension StudioStore {
    /// Find the open project's instance media again — from the Library, else
    /// from its instance. A capture already being fetched is left to that fetch.
    func recoverRemoteMedia() {
        guard let current = open else { return }
        let library = current.library
        let pool = LibraryStore.shared
        let connections = gallery.connections
        let inFlight = library.recovery.filter { $0.phase == .fetching }
        let busy = Set(inFlight.map(\.key))
        var items = remoteMissingMedia(current.reconciliation) { connections.connection($0) != nil }
        var tookFromPool = false
        items.removeAll { item in
            let held = pool.entries.filter { $0.ref.assetId == item.key }
            guard !held.isEmpty else { return false }
            if library.adopt(held) { tookFromPool = true }
            return true
        }
        let fresh = items.filter { !busy.contains($0.key) }
        let stillFlying = inFlight.filter { flying in items.contains { $0.key == flying.key } }
        library.recovery = stillFlying + fresh
        if tookFromPool {
            Task { [weak self] in await self?.recountMedia(library) }
        }
        let fetchable = fresh.filter { $0.phase == .fetching }
        guard !fetchable.isEmpty else { return }
        Task { [weak self] in
            // One capture after another: a clip's proxy is tens of megabytes,
            // and the one opened first is the one wanted first.
            for item in fetchable {
                guard let self, self.open?.library === library else { return }
                await self.fetchBack(item, into: library, pool: pool)
            }
        }
    }

    /// One capture asked of its instance and brought into the pool, then the project.
    private func fetchBack(_ item: StudioRecoveryItem, into library: StudioLibrary, pool: LibraryStore) async {
        let connections = gallery.connections
        guard let split = splitAssetId(item.key), let connection = connections.connection(split.host) else {
            mark(item.key, in: library) { $0.phase = .unreachable }
            return
        }
        let client = connections.client(for: connection)
        do {
            guard let row = try await client.asset(split.id) else {
                mark(item.key, in: library) { $0.phase = .gone }
                return
            }
            let host = split.host
            let files = try await TaskCenter.tracked(materializeTaskLabel(row, .proxy), scope: item.key) {
                try await materialize(client, host, row, fidelity: .proxy, now: nowMillis())
            }
            // The bytes are the Library's whatever happens next: a project
            // closed meanwhile finds them there when it is opened again.
            pool.addFetched(files)
            guard open?.library === library else { return }
            let held = pool.entries.filter { $0.ref.assetId == item.key }
            let joined = library.adopt(held)
            let kept = joined || (!held.isEmpty && held.allSatisfy { library.contains($0.ref) })
            guard kept else {
                mark(item.key, in: library) {
                    $0.phase = .failed
                    $0.reason = "it arrived, and could not be kept on this device"
                }
                return
            }
            library.recovery.removeAll { $0.key == item.key }
            await recountMedia(library)
        } catch is CancellationError {
            mark(item.key, in: library) {
                $0.phase = .failed
                $0.reason = "the fetch was cancelled"
            }
        } catch {
            let signIn = (error as? WinnowError)?.kind == .unauthenticated
            let said = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
            mark(item.key, in: library) {
                $0.phase = .failed
                $0.reason = deviceWords(said)
                $0.signIn = signIn
            }
        }
    }

    /// Count the open project's media again against what its library holds now.
    func recountMedia(_ library: StudioLibrary) async {
        guard let current = open, current.library === library, !current.doc.media.files.isEmpty else { return }
        let entries = library.entries
        let refs = await Task.detached(priority: .utility) { StudioMediaFiles.hashed(entries) }.value
        guard let live = open, live.library === library else { return }
        setReconciliation(reconcileMedia(live.doc.media.files, refs), for: library)
    }

    private func mark(_ key: String, in library: StudioLibrary, _ change: (inout StudioRecoveryItem) -> Void) {
        guard let i = library.recovery.firstIndex(where: { $0.key == key }) else { return }
        change(&library.recovery[i])
    }
}
