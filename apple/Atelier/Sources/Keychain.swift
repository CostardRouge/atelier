// Where a Winnow token lives on this device: the Keychain, one generic
// password per HOST, never a document, never the connections file, never a
// log. The web keeps no secret at all — its credential is the instance's own
// session cookie, same-site (`docs/winnow-bridge.md` §3.3) — but a native app
// is a genuinely foreign client, so its credential is a Bearer token the
// person pasted (§3.6, "personal token"). The bridge asks that wherever a
// token is kept, the screen SAYS so; the connect form does.
//
// `ThisDeviceOnly`: a token belongs to the device it was pasted on. A backup
// restored elsewhere brings the connection back without its token, and the
// sources screen says exactly that rather than failing with a bare 401.
//
// The store is a protocol so a test or a preview never touches the real
// Keychain (`MemoryCredentials`).

import Foundation
#if canImport(Security)
import Security
#endif

/// Tokens by host. Every call degrades rather than throws, but a WRITE says
/// when it failed: a connection whose token was not kept must not be stored.
protocol CredentialStore: Sendable {
    func token(for host: String) -> String?
    func setToken(_ token: String, for host: String) throws
    func removeToken(for host: String)
}

/// A token the Keychain refused to keep, in the reader's terms.
struct KeychainError: LocalizedError, Equatable {
    let status: Int32
    let message: String

    var errorDescription: String? { message }
}

#if canImport(Security)
/// The system Keychain, `kSecClassGenericPassword`, service × host.
struct Keychain: CredentialStore {
    var service = "website.steeve.atelier.winnow"

    private func query(_ host: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: host,
        ]
    }

    func token(for host: String) -> String? {
        var q = query(host)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func setToken(_ token: String, for host: String) throws {
        let data = Data(token.utf8)
        let status = SecItemUpdate(query(host) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw Self.error(status) }
        var add = query(host)
        add[kSecValueData as String] = data
        add[kSecAttrLabel as String] = "Atelier — Winnow token for \(host)"
        #if os(iOS)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        #endif
        let added = SecItemAdd(add as CFDictionary, nil)
        guard added == errSecSuccess else { throw Self.error(added) }
    }

    func removeToken(for host: String) {
        SecItemDelete(query(host) as CFDictionary)
    }

    private static func error(_ status: OSStatus) -> KeychainError {
        let said = SecCopyErrorMessageString(status, nil) as String?
        return KeychainError(status: status, message: "The Keychain refused the token (\(said ?? "status \(status)")).")
    }
}
#endif

/// Tokens held in memory — a test, a preview, never the app.
final class MemoryCredentials: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [String: String]
    /// Set to make every write fail, the way a locked Keychain would.
    var refuseWrites = false

    init(_ tokens: [String: String] = [:]) { self.tokens = tokens }

    func token(for host: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return tokens[host]
    }

    func setToken(_ token: String, for host: String) throws {
        lock.lock()
        defer { lock.unlock() }
        if refuseWrites { throw KeychainError(status: -25308, message: "The Keychain refused the token (it is locked).") }
        tokens[host] = token
    }

    func removeToken(for host: String) {
        lock.lock()
        defer { lock.unlock() }
        tokens[host] = nil
    }
}
