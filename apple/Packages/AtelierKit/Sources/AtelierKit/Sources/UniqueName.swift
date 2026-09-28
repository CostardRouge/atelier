// Telling two files apart when they want the same name. Port of
// `src/shared/sources/unique-name.ts`.
//
// An export is named after the picture it came from (`develop-roll.md`: a
// delivered picture is named EXACTLY after its source, `DJI_0101.JPG` →
// `DJI_0101.jpg`), which is the maintainer's own convention: his Gallery
// holds the developed file under the capture's own name, and that is what
// pairs the two folders by eye and what Winnow's `reconcile` would pair by
// basename. The cost of that convention is collisions — two crops of one
// picture in a run, or a second export into a folder that already holds the
// first — and the answer is a NUMBER, not a date: `DJI_0101-1.jpg`, `-2`,
// `-3` (the maintainer's call, 2026-09-20 — a stamp is longer and reads
// worse).
//
// The comparison is the CALLER's, through `taken`, because the two cases do
// not compare alike: a run compares what it has already named, a folder
// compares what is on disk — and a macOS volume is case-insensitive, so
// `DJI_0101.jpg` and `DJI_0101.JPG` are one file there and both callers fold
// case before asking. The probe is an injected closure, sync or async.

import Foundation

/// How many numbered names to try before giving up rather than looping.
public let uniqueNameLimit = 999

public struct SplitName: Equatable, Sendable {
    /// Everything before the last dot — the whole name when there is none.
    public var base: String
    /// The last dot and what follows (`.jpg`), or an empty string.
    public var ext: String

    public init(base: String, ext: String) { self.base = base; self.ext = ext }
}

/// A file name in two halves. A leading dot is part of the BASE (`.gitignore`
/// is a name, not an extension), so a numbered twin of it stays hidden.
public func splitName(_ name: String) -> SplitName {
    guard let dot = name.lastIndex(of: "."), dot != name.startIndex else {
        return SplitName(base: name, ext: "")
    }
    return SplitName(base: String(name[..<dot]), ext: String(name[dot...]))
}

/// `DJI_0101.jpg` + 2 → `DJI_0101-2.jpg`; 0 gives the name back.
public func numberedName(_ name: String, _ n: Int) -> String {
    if n <= 0 { return name }
    let split = splitName(name)
    return "\(split.base)-\(n)\(split.ext)"
}

/// Past `uniqueNameLimit` twins of one name: a caller collects this as one
/// file's failure, which is what a folder holding a thousand twins deserves
/// to be told.
public struct UniqueNameError: Error, Equatable, Sendable, CustomStringConvertible {
    public var name: String

    public init(name: String) { self.name = name }

    public var description: String {
        "there are already \(uniqueNameLimit) files named like \(name)"
    }
}

/// `name` itself when nothing has it, else the first free `name-1`, `name-2`…
/// `taken` decides what "has it" means and is asked about each candidate in
/// turn, so a caller that writes as it goes must count what it just took.
/// Throws past `uniqueNameLimit` rather than looping.
public func uniqueName(_ name: String, taken: (String) throws -> Bool) throws -> String {
    if try !taken(name) { return name }
    for n in 1...uniqueNameLimit {
        let candidate = numberedName(name, n)
        if try !taken(candidate) { return candidate }
    }
    throw UniqueNameError(name: name)
}

/// `uniqueName` where the question has to be asked of the disk. The loop is
/// written twice rather than made async everywhere: a run names its files
/// before it has a folder, and making that path await would spread `async`
/// through pure code for nothing.
public func uniqueNameAsync(_ name: String, taken: (String) async throws -> Bool) async throws -> String {
    if try await !taken(name) { return name }
    for n in 1...uniqueNameLimit {
        let candidate = numberedName(name, n)
        if try await !taken(candidate) { return candidate }
    }
    throw UniqueNameError(name: name)
}

/// The same names with the repeats numbered, in order — the first keeps the
/// plain name. Case-folded, because the volume this lands on most likely is.
public func dedupeNames(_ names: [String]) throws -> [String] {
    var used = Set<String>()
    var out: [String] = []
    out.reserveCapacity(names.count)
    for name in names {
        let free = try uniqueName(name) { candidate in used.contains(candidate.lowercased()) }
        used.insert(free.lowercased())
        out.append(free)
    }
    return out
}
