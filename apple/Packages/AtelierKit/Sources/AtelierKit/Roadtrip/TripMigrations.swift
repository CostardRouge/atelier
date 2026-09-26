// A stored trip brought up to the current version — port of
// `migrateTripDoc` in `src/shared/roadtrip/trip-types.ts`, every step from v1
// to v28, and the READER that runs it (`readTripDoc`). The record itself is
// `TripTypes.swift`.
//
// The migration runs on the JSON, exactly as the web's runs on the stored
// object — a document written by ANY version must read here exactly as it
// reads there. So it keeps the web's semantics to the letter:
// - It is idempotent and returns a current (or newer) document untouched.
// - `a ?? b` is JavaScript's: absent OR null takes the fallback; a truthiness
//   test (`if (badge?.shades)`, `words.yearAgo ? … : …`) is JavaScript's,
//   where an empty list is true; a `<` against the version reads it as
//   `Number()` reads it, so a document with no version runs no step at all.
// - The blocks run in SOURCE order, not version order — and that matters: the
//   badge is only created by the v2 block and slides arrive with v5, so every
//   block that fills a field on them sits after both (the v12 trap, measured
//   on a v1 document on the web). They are kept in the web's order here.
// - Where the web reads a value through a reader (`normaliseFraming`,
//   `developOrNull`, `gradeOrNull`, `readCarSpec`, `readCollage`,
//   `readCascade`, `readMotion`, `mapFromRoute`), the port reads it through
//   the same reader and writes what it returns.
//
// What each step does, and why nothing a trip already draws changes:
// - v1 → v2: the badge — a media hint and badge settings per post, the title
//   style per trip. The one step that adopts a LOOK, safe because no v1 post
//   had a badge to alter.
// - v2 → v3: the fr/en enum becomes the WORDS it stood for (a French trip
//   keeps saying what it said); each badge gets its text overrides and piece
//   styles.
// - v3 → v4: the anniversary boolean becomes a temporal MODE (`auto` if it was
//   on — the intent kept, the untrue anniversary dropped), the hook gets its
//   duration (the legacy 4 s), the year lines move into the temporal words.
// - v4 → v5: a post is a DECK; every post becomes a deck of one, no closing card.
// - v5 → v6: the vignette and the scrim become ONE stack of shades.
// - v6 → v7: the trip's remembered looks, empty. v7 → v8: the Studio link, none.
// - v8 → v9: a stage's ordered places, empty. v9 → v10: the grade, empty.
// - v10 → v11: the source, `local`. v11 → v12: the framing, centred cover.
// - v12 → v13: the cover, the mosaic. v13 → v14: a slide's medium (`auto`)
//   and screen time. v14 → v15: the opener, the badge. v15 → v16: a clip's
//   speed, 1. v16 → v17: a picture's develop, as shot; the presets, read
//   without their looks. v17 → v18: a framing's mirror and fit.
// - v18 → v19: the trip's car, the maintainer's Prado. v19 → v20: the retired
//   Route opener CONVERTED to an Itinerary over the trip's own located places.
//   v20 → v21: the car read again — a trip stamped v19 by the Itinerary branch
//   skipped the car block.
// - v21 → v22: a picture's own grade, following the piece. v22 → v23: the
//   camera credit, opt-in (off). v23 → v24: a slide's collage, none.
//   v24 → v25: the badge's cascade, none. v25 → v26: a grade's film texture,
//   none. v26 → v27: the stored `destination` DELETED (derived from the legs
//   since). v27 → v28: a picture's motion, holding still.

import Foundation

/// JavaScript's LOOSE readings of a stored value — what the web's reader does
/// with a value of the wrong type, so a migration here lands where it lands
/// there. An absent value is `undefined`.
enum JSLoose {
    /// `Number(v)`: undefined is NaN, null 0, a boolean 0 or 1, text parsed as
    /// JavaScript parses it, a list of none 0 and of one its element.
    static func number(_ v: JSONValue?) -> Double {
        guard let v else { return .nan }
        switch v {
        case .null: return 0
        case .bool(let b): return b ? 1 : 0
        case .number(let n): return n
        case .string(let s): return stringNumber(s)
        case .array(let list):
            if list.isEmpty { return 0 }
            guard list.count == 1 else { return .nan }
            switch list[0] {
            case .null: return 0
            case .number(let n): return n
            case .string(let s): return stringNumber(s)
            case .array: return number(list[0])
            default: return .nan
            }
        case .object: return .nan
        }
    }

    /// JavaScript truthiness: an empty list or record is TRUE.
    static func truthy(_ v: JSONValue?) -> Bool {
        guard let v else { return false }
        switch v {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0 && !n.isNaN
        case .string(let s): return !s.isEmpty
        case .array, .object: return true
        }
    }

    /// `v?.length` read as a condition: a non-empty list or text.
    static func hasLength(_ v: JSONValue?) -> Bool {
        switch v {
        case .array(let list)?: return !list.isEmpty
        case .string(let s)?: return !s.isEmpty
        case .object(let o)?: return truthy(o["length"])
        default: return false
        }
    }

    /// JavaScript's white space and line terminators, what `Number()` trims.
    private static func isSpace(_ u: Unicode.Scalar) -> Bool {
        switch u.value {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        case 0x2000...0x200A: return true
        default: return false
        }
    }

    /// `Number("…")`: a decimal literal, `Infinity`, or a 0x / 0o / 0b integer.
    private static func stringNumber(_ s: String) -> Double {
        let scalars = Array(s.unicodeScalars)
        var lo = 0
        var hi = scalars.count
        while lo < hi && isSpace(scalars[lo]) { lo += 1 }
        while hi > lo && isSpace(scalars[hi - 1]) { hi -= 1 }
        if lo == hi { return 0 }
        let text = String(String.UnicodeScalarView(scalars[lo..<hi]))
        switch text {
        case "Infinity", "+Infinity": return .infinity
        case "-Infinity": return -.infinity
        default: break
        }
        let lower = text.lowercased()
        for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] where lower.hasPrefix(prefix) {
            let digits = lower.dropFirst(2)
            guard !digits.isEmpty else { return .nan }
            var value = 0.0
            for ch in digits {
                guard let d = ch.hexDigitValue, d < radix else { return .nan }
                value = value * Double(radix) + Double(d)
            }
            return value
        }
        return isDecimalLiteral(text) ? (Double(text) ?? .nan) : .nan
    }

    /// `[+-]? (digits [. digits?] | . digits) ([eE] [+-]? digits)?`
    private static func isDecimalLiteral(_ text: String) -> Bool {
        let c = Array(text.utf8)
        var i = 0
        func digits() -> Int {
            let start = i
            while i < c.count && c[i] >= 48 && c[i] <= 57 { i += 1 }
            return i - start
        }
        if i < c.count && (c[i] == 43 || c[i] == 45) { i += 1 }
        let whole = digits()
        var fraction = 0
        if i < c.count && c[i] == 46 {
            i += 1
            fraction = digits()
        }
        if whole == 0 && fraction == 0 { return false }
        if i < c.count && (c[i] == 101 || c[i] == 69) {
            i += 1
            if i < c.count && (c[i] == 43 || c[i] == 45) { i += 1 }
            if digits() == 0 { return false }
        }
        return i == c.count
    }
}

private typealias JObject = [String: JSONValue]

/// `v ?? fallback` — absent or null takes the fallback.
private func orElse(_ v: JSONValue?, _ fallback: @autoclosure () -> JSONValue) -> JSONValue {
    if let v, v != .null { return v }
    return fallback()
}

/// `(list ?? []).map((x) => ({ ...x, … }))` — each RECORD rewritten; an entry
/// that is not one is left as it is (the web would throw on it, and the
/// record reader drops it).
private func mapRecords(_ v: JSONValue?, _ f: (JObject) -> JObject) -> JSONValue {
    .array((v?.arrayValue ?? []).map { entry in entry.objectValue.map { .object(f($0)) } ?? entry })
}

private func eachPost(_ m: inout JObject, _ f: (JObject) -> JObject) {
    m["posts"] = mapRecords(m["posts"], f)
}

/// `{ ...post, badge: { ...post.badge, … } }`.
private func withBadge(_ post: JObject, _ f: (inout JObject) -> Void) -> JObject {
    var out = post
    var badge = post["badge"]?.objectValue ?? [:]
    f(&badge)
    out["badge"] = .object(badge)
    return out
}

/// `{ ...post, slides: (post.slides ?? []).map((slide) => ({ ...slide, … })) }`.
private func withSlides(_ post: JObject, _ f: (inout JObject) -> Void) -> JObject {
    var out = post
    out["slides"] = mapRecords(post["slides"]) { slide in
        var s = slide
        f(&s)
        return s
    }
    return out
}

/// `Object.fromEntries(Object.entries(m.hookDefaults ?? {}).map(([k, d]) => [k, d ? { ...d, … } : d]))`.
private func eachHookDefaults(_ m: inout JObject, _ f: (inout JObject) -> Void) {
    let entries = m["hookDefaults"]?.objectValue ?? [:]
    m["hookDefaults"] = .object(entries.mapValues { value in
        guard JSLoose.truthy(value), var d = value.objectValue else { return value }
        f(&d)
        return .object(d)
    })
}

private func graded(_ v: JSONValue?) -> JSONValue { gradeOrNull(v)?.json ?? .null }
private func developed(_ v: JSONValue?) -> JSONValue { developOrNull(v)?.json ?? .null }
private func collaged(_ v: JSONValue?) -> JSONValue { readCollage(v)?.json ?? .null }
private func moving(_ v: JSONValue?) -> JSONValue { readMotion(v)?.json ?? .null }
private func cascaded(_ v: JSONValue?) -> JSONValue { readCascade(v)?.json ?? .null }

/// A retired Route layer converted to an Itinerary; any other layer as it is.
/// `nil` when the list is not a list — the web leaves such a piece alone.
private func convertRoute(_ layers: JSONValue?, _ places: [(name: JSONValue?, lat: JSONValue?, lon: JSONValue?)],
                          _ makeId: () -> String) -> JSONValue? {
    guard let list = layers?.arrayValue else { return nil }
    return .array(list.map { layer in
        guard let o = layer.objectValue, o["id"] == .string("route") else { return layer }
        let options = mapFromRoute(o["options"]?.objectValue ?? [:], storedPlaces: places) { _ in makeId() }
        return .object(["id": .string("map"), "options": options.json])
    })
}

/// A stored trip, as a record of any version, brought up to the current one —
/// the web's `migrateTripDoc` over its JSON. Idempotent; a current or newer
/// document comes back untouched. `makeId` mints the ids a step creates (a
/// converted shade, a converted stop).
public func migrateTripJSON(_ doc: [String: JSONValue], makeId: () -> String = newTripId) -> [String: JSONValue] {
    let v = JSLoose.number(doc["version"])
    if v >= Double(tripDocVersion) { return doc }
    var m = doc

    if v < 10 {
        // No trip had a grade before: its grade is empty, every post follows it.
        m["grade"] = orElse(m["grade"], emptyGrade().json)
        eachPost(&m) { post in
            var p = post
            p["grade"] = orElse(post["grade"], .null)
            return p
        }
    }
    if v < 11 {
        // Everything written before sources existed lives in this browser.
        m["sourceId"] = orElse(m["sourceId"], .string(defaultSourceId))
    }
    if v < 9 {
        // A stage with no place keeps `name` as its label.
        m["stages"] = mapRecords(m["stages"]) { stage in
            var s = stage
            s["places"] = orElse(stage["places"], .array([]))
            return s
        }
    }
    if v < 2 {
        m["theme"] = orElse(m["theme"], themeFromPreset(defaultTripThemePreset)?.json ?? .null)
        eachPost(&m) { post in
            var p = post
            p["media"] = orElse(post["media"], .null)
            let kind = post["kind"]?.stringValue.flatMap(PostKind.init(rawValue:)) ?? .photo
            p["badge"] = orElse(post["badge"], defaultPostBadge(kind, makeId: makeId).json)
            return p
        }
    }
    if v < 5 {
        // A deck of one is exactly what every post was before decks existed.
        m["cta"] = orElse(m["cta"], defaultCta.json)
        eachPost(&m) { post in
            var p = post
            p["slides"] = orElse(post["slides"], .array([]))
            p["includeCta"] = orElse(post["includeCta"], .bool(false))
            return p
        }
    }
    if v < 8 {
        eachPost(&m) { post in
            var p = post
            p["projectId"] = orElse(post["projectId"], .null)
            return p
        }
    }
    if v < 7 {
        m["hookDefaults"] = orElse(m["hookDefaults"], .object([:]))
    }
    if v < 6 {
        // The vignette and the scrim become the shades they always were.
        eachPost(&m) { post in
            let badge = post["badge"]?.objectValue
            if JSLoose.truthy(badge?["shades"]) { return post }
            let old = badge?["backdrop"]?.objectValue
            var shades: [JSONValue] = []
            let gradient = old?["gradient"]
            let strength = old?["gradientStrength"]
            if JSLoose.truthy(gradient), gradient != .string("off"), JSLoose.number(orElse(strength, .number(0))) > 0 {
                var shade = createShade(
                    id: makeId(),
                    direction: old?["gradientFrom"] == .string("top") ? .top : .bottom,
                    // `linear` reached roughly half the frame; `under` hugged the block.
                    reach: 0.58,
                    followHook: gradient == .string("under")
                ).json.objectValue ?? [:]
                // The strength and the colour cross AS STORED, whatever their type.
                shade["strength"] = orElse(strength, .number(0.65))
                shade["color"] = orElse(old?["gradientColor"], .string("#000000"))
                shades.append(.object(shade))
            }
            if JSLoose.number(orElse(old?["vignette"], .number(0))) > 0 {
                shades.append(vignetteShade(JSLoose.number(old?["vignette"]) * 0.85, id: makeId()).json)
            }
            return withBadge(post) { b in
                b["shades"] = .array(shades)
                b["backdrop"] = nil
            }
        }
    }
    if v < 4 {
        // The v3 boolean announced an anniversary on any date a year or more
        // later; it lands on `auto` — the intent kept, the lie dropped.
        eachPost(&m) { post in
            let legacy = post["badge"]?.objectValue?["showAnniversary"]
            return withBadge(post) { b in
                b["timeAgo"] = orElse(b["timeAgo"], .string(JSLoose.truthy(legacy) ? "auto" : "off"))
                b["referenceDate"] = orElse(b["referenceDate"], .null)
                b["showPin"] = orElse(b["showPin"], .bool(false))
                b["durationSeconds"] = orElse(b["durationSeconds"], .number(legacyBadgeDuration))
                b["shades"] = orElse(b["shades"], .array([]))
                b["showAnniversary"] = nil
            }
        }
        // The temporal vocabulary moved into its own record; a trip that had
        // French year lines keeps them.
        if let words = m["badgeWords"]?.objectValue, !JSLoose.truthy(words["time"]) {
            let french = words["of"] == .string("sur")
            var time = (french ? frenchTimeAgoWords : defaultTimeAgoWords).json.objectValue ?? [:]
            if JSLoose.truthy(words["yearAgo"]), let said = words["yearAgo"] { time["anniversary"] = said }
            if JSLoose.truthy(words["yearsAgo"]), let said = words["yearsAgo"] { time["anniversaryPlural"] = said }
            var next = words
            next["pin"] = orElse(words["pin"], .string(badgePinGlyph))
            next["time"] = .object(time)
            next["yearAgo"] = nil
            next["yearsAgo"] = nil
            m["badgeWords"] = .object(next)
        }
    }
    if v < 3 {
        // v2 stored a two-value language enum; v3 stores the words themselves.
        let legacy = m["badgeLanguage"]
        m["badgeWords"] = orElse(m["badgeWords"], (legacy == .string("fr") ? frenchBadgeWords : defaultBadgeWords).json)
        m["badgeLanguage"] = nil
        eachPost(&m) { post in
            withBadge(post) { b in
                b["textOverrides"] = orElse(b["textOverrides"], .object([:]))
                b["pieceStyles"] = orElse(b["pieceStyles"], .object([:]))
            }
        }
    }
    // LAST, and it matters: these blocks run in SOURCE order, and the badge is
    // only built by the v2 block above while slides arrive with v5.
    if v < 12 {
        // Nothing was reframed before this existed: the centred cover-crop.
        eachPost(&m) { post in
            withSlides(withBadge(post) { b in b["framing"] = normaliseFraming(b["framing"]).json }) { s in
                s["framing"] = normaliseFraming(s["framing"]).json
            }
        }
    }
    if v < 13 {
        m["cover"] = orElse(m["cover"], defaultTripCover().json)
    }
    if v < 14 {
        // Every slide is `auto`, which delivers exactly what it did; the hook's
        // screen time takes the default derived from the badge's own hold.
        eachPost(&m) { post in
            let composed = withBadge(post) { b in
                b["medium"] = orElse(b["medium"], .string(SlideMedium.auto.rawValue))
                let held = orElse(b["durationSeconds"], .number(legacyBadgeDuration))
                b["hookSeconds"] = orElse(b["hookSeconds"], .number(defaultHookSeconds(held.finiteNumber)))
            }
            return withSlides(composed) { s in
                s["medium"] = orElse(s["medium"], .string(SlideMedium.auto.rawValue))
                s["seconds"] = orElse(s["seconds"], .number(defaultSlideSeconds))
            }
        }
        eachHookDefaults(&m) { d in
            d["medium"] = orElse(d["medium"], .string(SlideMedium.auto.rawValue))
            d["hookSeconds"] = orElse(d["hookSeconds"], .number(defaultHookSeconds(d["durationSeconds"]?.finiteNumber)))
        }
    }
    if v < 15 {
        // Every piece composed before openers existed is the badge; the trip's
        // saved looks take it too, or the next piece would have no opener.
        let fresh = JSONValue.array(defaultHookLayers().map(\.json))
        eachPost(&m) { post in
            withBadge(post) { b in b["hook"] = JSLoose.hasLength(b["hook"]) ? b["hook"] : fresh }
        }
        eachHookDefaults(&m) { d in d["hook"] = JSLoose.hasLength(d["hook"]) ? d["hook"] : fresh }
    }
    if v < 16 {
        // Every clip played as shot: speed 1. The remembered looks are left
        // alone — a speed belongs to the clip in hand.
        eachPost(&m) { post in
            withSlides(withBadge(post) { b in b["videoSpeed"] = orElse(b["videoSpeed"], .number(1)) }) { s in
                s["videoSpeed"] = orElse(s["videoSpeed"], .number(1))
            }
        }
    }
    if v < 17 {
        // Nothing was developed: every picture as shot, junk clamped or none.
        // The presets are read WITHOUT their looks, as the web's reader is
        // called here (no look reader handed in).
        eachPost(&m) { post in
            withSlides(withBadge(post) { b in b["develop"] = developed(b["develop"]) }) { s in
                s["develop"] = developed(s["develop"])
            }
        }
        m["developPresets"] = .array(normaliseDevelopPresets(m["developPresets"]).map { preset in
            var p = preset
            p.look = nil
            return tripPresetJSON(p)
        })
    }
    if v < 18 {
        // Nothing was mirrored or letterboxed: every framing lands unmirrored on cover.
        eachPost(&m) { post in
            withSlides(withBadge(post) { b in b["framing"] = normaliseFraming(b["framing"]).json }) { s in
                s["framing"] = normaliseFraming(s["framing"]).json
            }
        }
    }
    if v < 19 {
        // No car → the default; junk → the default; a partial spec keeps what it says.
        m["car"] = readCarSpec(m["car"]).json
    }
    if v < 20 {
        // The Route trace is retired: a piece composed with one is CONVERTED —
        // the trip's own located places become its stops.
        var places: [(name: JSONValue?, lat: JSONValue?, lon: JSONValue?)] = []
        for stage in m["stages"]?.arrayValue ?? [] {
            for place in stage.objectValue?["places"]?.arrayValue ?? [] {
                guard let p = place.objectValue, JSLoose.truthy(p["coords"]) else { continue }
                let coords = p["coords"]?.objectValue
                places.append((name: p["name"], lat: coords?["lat"], lon: coords?["lon"]))
            }
        }
        eachPost(&m) { post in
            guard let hook = convertRoute(post["badge"]?.objectValue?["hook"], places, makeId) else { return post }
            return withBadge(post) { b in b["hook"] = hook }
        }
        // The trip remembers a look per KIND, each of which can carry a route.
        if let kinds = m["hookDefaults"]?.objectValue, !kinds.isEmpty {
            m["hookDefaults"] = .object(kinds.mapValues { value in
                guard var d = value.objectValue, let hook = convertRoute(d["hook"], places, makeId) else { return value }
                d["hook"] = hook
                return .object(d)
            })
        }
    }
    if v < 21 {
        // A trip stamped v19 by the Itinerary branch skipped the car block.
        m["car"] = readCarSpec(m["car"]).json
    }
    if v < 22 {
        // Every picture's own grade starts null — follow the piece.
        eachPost(&m) { post in
            withSlides(withBadge(post) { b in b["grade"] = graded(b["grade"]) }) { s in
                s["grade"] = graded(s["grade"])
            }
        }
    }
    if v < 23 {
        // The camera credit is opt-in per piece: `false` is the whole migration.
        eachPost(&m) { post in
            withBadge(post) { b in b["showExif"] = orElse(b["showExif"], .bool(false)) }
        }
        eachHookDefaults(&m) { d in d["showExif"] = orElse(d["showExif"], .bool(false)) }
    }
    if v < 24 {
        // A slide may hold several pictures; every stored one holds its one.
        eachPost(&m) { post in
            withSlides(withBadge(post) { b in b["collage"] = collaged(b["collage"]) }) { s in
                s["collage"] = collaged(s["collage"])
            }
        }
    }
    if v < 25 {
        // Every stored badge keeps its per-piece entrances.
        eachPost(&m) { post in
            withBadge(post) { b in b["cascade"] = cascaded(b["cascade"]) }
        }
        eachHookDefaults(&m) { d in d["cascade"] = cascaded(d["cascade"]) }
    }
    if v < 26 {
        // A grade carries a film texture on each of its rungs; none stored.
        m["grade"] = gradeOrNull(m["grade"])?.json ?? emptyGrade().json
        eachPost(&m) { post in
            var p = post
            p["grade"] = graded(post["grade"])
            p = withBadge(p) { b in b["grade"] = graded(b["grade"]) }
            return withSlides(p) { s in s["grade"] = graded(s["grade"]) }
        }
    }
    if v < 27 {
        // The prose subtitle is DERIVED from the legs now; the stored copy goes.
        m["destination"] = nil
    }
    if v < 28 {
        // A picture may move in its frame; every stored one holds still.
        eachPost(&m) { post in
            let moved = withBadge(post) { b in
                b["motion"] = moving(b["motion"])
                b["collage"] = collaged(b["collage"])
            }
            return withSlides(moved) { s in
                s["motion"] = moving(s["motion"])
                s["collage"] = collaged(s["collage"])
            }
        }
    }

    m["version"] = .number(Double(tripDocVersion))
    return m
}

/// A stored or received trip read onto the current shape, or nil when what
/// arrived is not a trip record (not a record, or no id). Every migration runs
/// first, as the web's store runs `migrateTripDoc` on read; the record is then
/// typed, a key this port does not know carried on the record that held it.
public func readTripDoc(_ raw: JSONValue?, now: Double = nowMillis(), makeId: () -> String = newTripId) -> TripDoc? {
    guard let o = raw?.objectValue else { return nil }
    return tripDocFromCurrent(migrateTripJSON(o, makeId: makeId), now: now, makeId: makeId)
}

/// A trip held in memory, brought up to the current version — the web's
/// `migrateTripDoc` for a record whose `version` says it is older. A current
/// one comes back as it is.
public func migrateTripDoc(_ doc: TripDoc, now: Double = nowMillis(), makeId: () -> String = newTripId) -> TripDoc {
    if doc.version >= tripDocVersion { return doc }
    return readTripDoc(doc.json, now: now, makeId: makeId) ?? doc
}
