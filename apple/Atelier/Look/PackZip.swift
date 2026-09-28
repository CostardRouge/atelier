// A purchased pack as it usually ARRIVES — a `.zip` — read without unpacking
// it anywhere. The web picks a FOLDER (`pickDirectoryTree`); a phone's Files
// app hands over the zip the shop sent far more often than a folder, and iOS
// has no unzip a sandboxed app can call. So the import reads the archive's
// central directory once and each `.cube` entry's bytes on demand, one at a
// time, exactly as `importPackFromFolder` reads one file at a time — never
// the whole archive in memory (a pack ships 140 MB of grain clips beside its
// looks, and those are never read).
//
// What is read: stored (method 0) and deflated (method 8) entries, inflated by
// the Compression framework's raw DEFLATE. What is REFUSED, with a sentence
// rather than a wrong pack: ZIP64 (an archive past 4 GB), an encrypted entry,
// any other compression method. A folder the archive wraps its files in
// (`AUTHENTIC/…`) becomes the pack's root, the way a picked folder's own name
// does on the web.

import Compression
import Foundation

struct PackZipError: Error, CustomStringConvertible, Sendable {
    let description: String
}

struct PackZip: Sendable {
    struct Entry: Sendable {
        let path: String
        let method: UInt16
        let flags: UInt16
        let compressedSize: Int
        let size: Int
        let localHeaderOffset: Int
    }

    let url: URL
    let entries: [Entry]

    /// The archive's table of contents, read from its end.
    init(url: URL) throws {
        self.url = url
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let length = Int(try handle.seekToEnd())
        guard length >= 22 else { throw PackZipError(description: "That file is not a zip archive.") }
        let tailLength = min(length, 22 + 65_535)
        let tail = try PackZip.read(handle, at: length - tailLength, count: tailLength)
        // The end-of-central-directory record, searched backwards past a comment.
        var eocd: Int?
        var i = tail.count - 22
        while i >= 0 {
            if PackZip.u32(tail, i) == 0x0605_4B50 {
                eocd = i
                break
            }
            i -= 1
        }
        guard let end = eocd else { throw PackZipError(description: "That file is not a zip archive.") }
        let count = Int(PackZip.u16(tail, end + 10))
        let directorySize = Int(PackZip.u32(tail, end + 12))
        let directoryOffset = Int(PackZip.u32(tail, end + 16))
        if count == 0xFFFF || directorySize == 0xFFFF_FFFF || directoryOffset == 0xFFFF_FFFF {
            throw PackZipError(description: "This archive is a ZIP64 one, which this import does not read — unzip it in Files first.")
        }
        guard directoryOffset + directorySize <= length else {
            throw PackZipError(description: "That archive is damaged: its table of contents points past its end.")
        }
        let directory = try PackZip.read(handle, at: directoryOffset, count: directorySize)
        var found: [Entry] = []
        var at = 0
        for _ in 0..<count {
            guard at + 46 <= directory.count, PackZip.u32(directory, at) == 0x0201_4B50 else { break }
            let flags = PackZip.u16(directory, at + 8)
            let method = PackZip.u16(directory, at + 10)
            let compressed = Int(PackZip.u32(directory, at + 20))
            let size = Int(PackZip.u32(directory, at + 24))
            let nameLength = Int(PackZip.u16(directory, at + 28))
            let extraLength = Int(PackZip.u16(directory, at + 30))
            let commentLength = Int(PackZip.u16(directory, at + 32))
            let offset = Int(PackZip.u32(directory, at + 42))
            let nameStart = at + 46
            guard nameStart + nameLength <= directory.count else { break }
            let name = String(decoding: directory[nameStart..<(nameStart + nameLength)], as: UTF8.self)
            if !name.hasSuffix("/") {
                found.append(Entry(path: name, method: method, flags: flags, compressedSize: compressed, size: size,
                                   localHeaderOffset: offset))
            }
            at = nameStart + nameLength + extraLength + commentLength
        }
        entries = found
    }

    /// The pack's files as the import reads them: `.cube` entries only, their
    /// paths relative to the one folder the archive wraps them in, when it
    /// wraps them all in one — and that folder's name, for the pack's.
    func cubeFiles() -> (rootName: String, files: [(path: String, entry: Entry)]) {
        // A hidden segment (a dot file, an AppleDouble `._` sidecar) and the
        // Finder's `__MACOSX/` shadow folder are never looks — and must not
        // stop the one real folder from being recognised as the wrapper.
        let cubes = entries.filter { entry in
            let segments = entry.path.split(separator: "/")
            return entry.path.lowercased().hasSuffix(".cube")
                && !segments.contains { $0.hasPrefix(".") }
                && segments.first != "__MACOSX"
        }
        let firsts = Set(cubes.map { $0.path.split(separator: "/", maxSplits: 1).first.map(String.init) ?? "" })
        let wrapped = firsts.count == 1 && cubes.allSatisfy { $0.path.contains("/") }
        let root = wrapped ? (firsts.first ?? "") : ""
        let stem = url.deletingPathExtension().lastPathComponent
        let files = cubes.map { entry -> (path: String, entry: Entry) in
            let path = wrapped ? String(entry.path.dropFirst(root.count + 1)) : entry.path
            return (path, entry)
        }
        return (wrapped ? root : stem, files)
    }

    /// One entry's bytes, inflated.
    func bytes(_ entry: Entry) throws -> [UInt8] {
        if entry.flags & 0x1 != 0 {
            throw PackZipError(description: "This file is encrypted in the archive.")
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let header = try PackZip.read(handle, at: entry.localHeaderOffset, count: 30)
        guard header.count == 30, PackZip.u32(header, 0) == 0x0403_4B50 else {
            throw PackZipError(description: "The archive is damaged at this file.")
        }
        let start = entry.localHeaderOffset + 30 + Int(PackZip.u16(header, 26)) + Int(PackZip.u16(header, 28))
        let packed = try PackZip.read(handle, at: start, count: entry.compressedSize)
        guard packed.count == entry.compressedSize else {
            throw PackZipError(description: "The archive ends inside this file.")
        }
        switch entry.method {
        case 0:
            return packed
        case 8:
            return try PackZip.inflate(packed, size: entry.size)
        default:
            throw PackZipError(description: "This file is compressed in a way this import does not read (method \(entry.method)).")
        }
    }

    // MARK: - bytes

    private static func read(_ handle: FileHandle, at offset: Int, count: Int) throws -> [UInt8] {
        guard count > 0 else { return [] }
        try handle.seek(toOffset: UInt64(offset))
        let data = try handle.read(upToCount: count) ?? Data()
        return [UInt8](data)
    }

    private static func u16(_ b: [UInt8], _ i: Int) -> UInt16 {
        guard i + 1 < b.count else { return 0 }
        return UInt16(b[i]) | UInt16(b[i + 1]) << 8
    }

    private static func u32(_ b: [UInt8], _ i: Int) -> UInt32 {
        guard i + 3 < b.count else { return 0 }
        let lo = UInt32(b[i]) | UInt32(b[i + 1]) << 8
        let hi = UInt32(b[i + 2]) << 16 | UInt32(b[i + 3]) << 24
        return lo | hi
    }

    /// Raw DEFLATE (RFC 1951) — what `COMPRESSION_ZLIB` decodes, header-less.
    private static func inflate(_ packed: [UInt8], size: Int) throws -> [UInt8] {
        guard size > 0 else { return [] }
        var out = [UInt8](repeating: 0, count: size)
        let written = packed.withUnsafeBufferPointer { src -> Int in
            out.withUnsafeMutableBufferPointer { dst -> Int in
                guard let s = src.baseAddress, let d = dst.baseAddress else { return 0 }
                return compression_decode_buffer(d, size, s, packed.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written == size else { throw PackZipError(description: "This file could not be inflated.") }
        return out
    }
}
