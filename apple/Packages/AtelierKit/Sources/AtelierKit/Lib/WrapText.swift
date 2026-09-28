// Greedy word wrapping onto a character budget. Port of
// `src/shared/lib/wrap-text.ts`.
//
// The overlay engine draws a text element as ONE line and never wraps — right
// for a readout, wrong for a sentence. The budget is a character COUNT rather
// than a measured width, so this stays pure: the caller estimates it from the
// font size and the frame, and errs low. An extra line break costs a little
// space; an overflowing line costs the words themselves.
//
// A "character" is counted as the web counts `String.length` — a UTF-16 code
// unit — so the two apps break a line at the same word.

import Foundation

/// Split `text` into lines of at most `maxChars` characters, breaking on
/// whitespace. Line breaks the author typed are kept — they are a decision,
/// not whitespace. A single word longer than the budget is left whole rather
/// than cut: a broken URL is worse than one that overhangs, and the caller can
/// see it happen.
public func wrapText(_ text: String, maxChars: Int) -> [String] {
    let budget = max(1, maxChars)
    var out: [String] = []

    for paragraph in text.components(separatedBy: "\n") {
        // `trim().split(/\s+/).filter(Boolean)`: the words, whitespace collapsed.
        let words = paragraph
            .split(omittingEmptySubsequences: true, whereSeparator: { $0.isWhitespace })
            .map(String.init)
        if words.isEmpty {
            out.append("")
            continue
        }
        var line = ""
        for word in words {
            if line.isEmpty {
                line = word
            } else if line.utf16.count + 1 + word.utf16.count <= budget {
                line += " " + word
            } else {
                out.append(line)
                line = word
            }
        }
        out.append(line)
    }

    // A trailing blank paragraph is the author pressing return at the end; it
    // reserves space nobody asked for.
    while out.count > 1 && out[out.count - 1].isEmpty { out.removeLast() }
    return out
}

/// How many characters of a proportional sans face fit across `widthPx` at
/// `fontPx`. Deliberately pessimistic — 0.55 em per character against a real
/// average nearer 0.5 — because wrapping one word early is invisible and
/// wrapping one word late runs off the frame.
public func charBudget(widthPx: Double, fontPx: Double) -> Int {
    if fontPx <= 0 { return 1 }
    let fit = floor(widthPx / (fontPx * 0.55))
    guard fit.isFinite else { return 1 }
    if fit >= Double(Int.max) { return Int.max }
    return max(1, Int(fit))
}
