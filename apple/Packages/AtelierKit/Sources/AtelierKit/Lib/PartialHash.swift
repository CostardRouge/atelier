// Partial content hash — the identity Atelier and Winnow share. Port of
// `src/shared/lib/partial-hash.ts`, itself a byte-for-byte reimplementation of
// Winnow's `partialHash()` (`src/lib/hash.ts` in `CostardRouge/winnow`), which
// is what its `assets.content_hash` column stores. Computing the same value
// here is what lets a document written on the phone name the same media as one
// written in the browser or held on an instance.
//
//   sha256( utf8(String(size)) ‖ head ‖ tail )
//     head = bytes[0 ..< min(64 KiB, size)]
//     tail = bytes[size − min(64 KiB, size − 64 KiB) ..< size]   — only when size > 64 KiB
//
// Two properties are deliberate and must survive any edit:
//
// - It reads AT MOST 128 KiB whatever the file weighs, so hashing a folder of
//   multi-GB rushes stays instant — which is why the input is a `HashableBlob`
//   (a size and a slice) and not always a whole `Data`: the app hashes a file
//   through two reads, never by loading it.
// - It is therefore a PARTIAL hash: two files that share a size and both
//   64 KiB windows but differ in the middle collide. A hash match is strong
//   evidence, never proof; reconciliation keeps the file name as its tiebreak.
//
// Any change here silently breaks identity across the two projects. It is
// pinned by fixtures in the spec beside this file, generated from Winnow's own
// implementation — regenerate them from that repository, never from here.

import Foundation

/// The window read from each end, and the threshold above which a tail exists.
private let window = 64 * 1024

/// The minimal shape this needs — a `Data` is one, and so is anything the app
/// wraps around a file handle: a size, and the bytes of `[start, end)`.
public protocol HashableBlob {
    var size: Int { get }
    /// The bytes in `[start, end)`, as `Blob.slice(start, end)` gives them.
    func slice(_ start: Int, _ end: Int) throws -> Data
}

extension Data: HashableBlob {
    public var size: Int { count }

    public func slice(_ start: Int, _ end: Int) throws -> Data {
        // A `Data` slice keeps its parent's indices, so the range is offset
        // from `startIndex`, never from 0.
        let lo = Swift.max(0, Swift.min(start, count))
        let hi = Swift.max(lo, Swift.min(end, count))
        return subdata(in: (startIndex + lo)..<(startIndex + hi))
    }
}

/// The content hash of `blob`, as lowercase hex.
///
/// Reads two slices at most, then digests them in one pass — the concatenation
/// never exceeds 128 KiB plus the few bytes of the size prefix.
public func partialHash(_ blob: HashableBlob) throws -> String {
    let size = blob.size
    let headLength = min(window, size)
    let head = try blob.slice(0, headLength)
    // Below the threshold the head already covers the whole file; above it, the
    // tail starts where the head stopped until the file is long enough for the
    // two windows to separate. Mirrors Winnow's arithmetic exactly.
    let tailLength = size > window ? min(window, size - window) : 0
    let tail = tailLength > 0 ? try blob.slice(size - tailLength, size) : Data()
    return digestParts(size: size, head: head, tail: tail)
}

/// The content hash of bytes already in memory — the same value, no `throws`.
public func partialHash(_ data: Data) -> String {
    let size = data.count
    let headLength = min(window, size)
    let head = data.subdata(in: data.startIndex..<(data.startIndex + headLength))
    let tailLength = size > window ? min(window, size - window) : 0
    let tail = tailLength > 0
        ? data.subdata(in: (data.startIndex + size - tailLength)..<(data.startIndex + size))
        : Data()
    return digestParts(size: size, head: head, tail: tail)
}

private func digestParts(size: Int, head: Data, tail: Data) -> String {
    // The decimal size is hashed as TEXT, not as bytes — sha256("0") for an
    // empty file, which the spec pins.
    var message = Array(String(size).utf8)
    message.reserveCapacity(message.count + head.count + tail.count)
    message.append(contentsOf: head)
    message.append(contentsOf: tail)
    return SHA256.hex(SHA256.digest(message))
}
