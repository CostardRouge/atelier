// The mark a file this suite WROTE carries, and how to recognise it — port of
// `src/shared/exif/software-mark.ts`.
//
// A delivered JPEG copies its original's EXIF block whole, so nothing in its
// metadata tells it from the camera's own file — and it is named exactly
// after the picture it came from. Put beside that picture in the folder the
// originals live in, it looks like the camera's delivered rendition of the
// same capture, and would be offered as one (`docs/capture-renditions.md`
// §14.6). The one tag every account writes the same way is `Software`, and a
// reader that finds this value there is looking at something Atelier made —
// never at a camera's render. A file made elsewhere carries no such mark, and
// telling one of those from a camera's file is a separate question this
// module does not answer.

import Foundation

/// What every delivered file says in its `Software` tag.
public let atelierSoftware = "Atelier"

/// True when a `Software` value is this suite's mark — a file we wrote.
///
/// The web's test is `/^Atelier(?![A-Za-z0-9])/` on the trimmed value: the
/// word, then anything that is not an ASCII letter or digit (a later version's
/// `Atelier 2`, a NUL a writer left behind, the end of the string). Checked
/// on the scalars, as a JavaScript regex is, so `Ateliers Photo` is refused.
public func isAtelierMade(_ software: String?) -> Bool {
    guard let software, !software.isEmpty else { return false }
    let trimmed = software.trimmingCharacters(in: .whitespacesAndNewlines)
    let scalars = Array(trimmed.unicodeScalars)
    let mark = Array(atelierSoftware.unicodeScalars)
    guard scalars.count >= mark.count, Array(scalars[0..<mark.count]) == mark else { return false }
    guard scalars.count > mark.count else { return true }
    let next = scalars[mark.count].value
    let isAsciiAlnum = (next >= 0x30 && next <= 0x39) || (next >= 0x41 && next <= 0x5A) || (next >= 0x61 && next <= 0x7A)
    return !isAsciiAlnum
}
