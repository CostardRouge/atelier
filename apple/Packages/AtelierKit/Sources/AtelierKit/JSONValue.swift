// A JSON value as a Swift enum — what the web's `unknown` is to its readers.
//
// Every document reader in the kernel (`normaliseDevelop`, `readRollDoc`, …)
// takes a JSONValue rather than a typed Codable, for the same reason the web's
// take `unknown`: a stored roll may come from an older build, a newer one, a
// file off a stranger's disk, or a phone that never learned a field. Reading
// through this type is what lets a reader clamp, fall back and LEAVE BEHIND,
// instead of throwing on the first surprise — and what lets a field this port
// does not yet interpret (a keystone, a layer list) round-trip UNTOUCHED, so a
// roll edited on the phone never drops what the web app wrote.

import Foundation

public enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public var objectValue: [String: JSONValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    public var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    /// A number that is finite — JSON cannot carry NaN, but a Swift caller can.
    public var finiteNumber: Double? {
        if case .number(let n) = self, n.isFinite { return n }
        return nil
    }

    public var isNull: Bool { self == .null }
}

// MARK: - Codable, so a JSONValue reads from and writes to JSON directly

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not a JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n):
            // A whole number is written as one, the way JavaScript writes it —
            // `1` and not `1.0` — so a document written here diffs cleanly
            // against one the web app wrote.
            if n.isFinite, n == n.rounded(), abs(n) < 1e15 {
                try c.encode(Int64(n))
            } else {
                try c.encode(n)
            }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

// MARK: - literals, for tests and defaults

extension JSONValue: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    public init(nilLiteral: ()) { self = .null }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(stringLiteral value: String) { self = .string(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
    }
}

// MARK: - text

extension JSONValue {
    /// Parse JSON text, or nil when it is not JSON. Never throws: a file off a
    /// disk is not trusted, and the reader says why rather than crashing.
    public static func parse(_ text: String) -> JSONValue? {
        guard let data = text.data(using: .utf8) else { return nil }
        return parse(data)
    }

    public static func parse(_ data: Data) -> JSONValue? {
        try? JSONDecoder().decode(JSONValue.self, from: data)
    }

    /// Serialised with sorted keys, so two writes of one document are one text —
    /// and without the `\/` Foundation writes by default, which the web never does.
    public func serialized(pretty: Bool = false) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = pretty
            ? [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
            : [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(self), let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }
}
