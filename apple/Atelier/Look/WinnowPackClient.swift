// The part of a Winnow client a PACK needs (`PackRemoteClient`, the eight calls
// of `src/shared/lut/pack-remote.ts`), over the app's own `WinnowClient` — so
// a pack kept on an instance is pushed, adopted, fetched look by look and
// forgotten through the one HTTP client the Sources screen already talks to.
//
// Two "not there" answers are VALUES the pack logic reads, never errors: a
// blob this account does not hold (the client's own nil), and a document
// never pushed or gone (`docEtag` nil on a 404 — which is what makes a first
// push a create with no `If-Match`). Every other failure is the client's own
// `WinnowError`, thrown through with its sentence.
//
// Which connections can keep a pack is read off their capabilities sheet
// (`canKeepPack`: a document bucket listing `lutpack` AND the file bucket);
// an instance that predates either is not offered, rather than failing after
// the first upload.

import Foundation
import AtelierKit

struct WinnowPackClient: PackRemoteClient {
    let client: WinnowClient

    func listAppFiles(_ app: String) async throws -> [String] {
        try await client.listAppFiles(app).files.map(\.id)
    }

    func putAppFile(_ app: String, _ id: String, _ bytes: [UInt8], mediaType: String, maxBytes: Int?) async throws {
        _ = try await client.putAppFile(app, id, Data(bytes), mediaType: mediaType, maxBytes: maxBytes)
    }

    func getAppFile(_ app: String, _ id: String) async throws -> [UInt8]? {
        guard let data = try await client.getAppFile(app, id) else { return nil }
        return [UInt8](data)
    }

    func deleteAppFile(_ app: String, _ id: String) async throws {
        do {
            try await client.deleteAppFile(app, id)
        } catch let error as WinnowError where error.kind == .notfound {
            // Absent is not an error: the blob is already gone.
        }
    }

    func docEtag(_ app: String, _ id: String) async throws -> String? {
        do {
            switch try await client.getDoc(app, id) {
            case .row(let row): return row.etag.isEmpty ? nil : row.etag
            case .notModified: return nil
            }
        } catch let error as WinnowError where error.kind == .notfound {
            return nil
        }
    }

    func putDoc(_ app: String, _ id: String, _ body: JSONValue, ifMatch: String?, maxBytes: Int?) async throws {
        let object = body.objectValue ?? [:]
        let kind = object["kind"]?.stringValue ?? packKind
        let version = Int(object["version"]?.finiteNumber ?? Double(packDocVersion))
        let doc = object["doc"] ?? body
        _ = try await client.putDoc(app, id, DocBody(kind: kind, version: version, doc: doc), ifMatch: ifMatch,
                                    maxBytes: maxBytes)
    }

    func deleteDoc(_ app: String, _ id: String, ifMatch: String?) async throws {
        try await client.deleteDoc(app, id, ifMatch: ifMatch)
    }

    func listDocs(_ app: String, kind: String) async throws -> [JSONValue] {
        try await client.listDocs(app, kind).map(\.doc)
    }
}

extension ConnectionStore {
    /// The instances that can keep a pack, as they stand now — the web's
    /// `packHosts()`, in the connections' order.
    var packHostsNow: [PackHost] {
        let candidates = connections.map { conn -> PackHostCandidate in
            let caps = conn.capabilities
            return PackHostCandidate(
                sourceId: conn.id,
                documentsBucket: caps?.documents?.bucket ?? false,
                documentKinds: caps?.documents?.kinds ?? [],
                filesBucket: caps?.files?.bucket ?? false,
                maxDocBytes: caps?.documents?.maxBytes,
                maxFileBytes: caps?.files?.maxBytes
            )
        }
        return packHosts(candidates) { sourceId in
            guard let conn = self.connection(sourceId) else { return nil }
            return WinnowPackClient(client: self.client(for: conn))
        }
    }
}
