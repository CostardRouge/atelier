// Naming a place from its coordinates, offline — port of
// `src/shared/roadtrip/gazetteer.ts` (the pure half; the web's
// `load-gazetteer.ts` fetch is the app's, see below).
//
// Ported ahead of the rest of Road Trip because the delivered picture's
// place name (`Exif/DeliveryPlace.swift`) is read from this index. The rules
// it keeps from the web module:
// - **An index that ships with the app, never a lookup going out**: the
//   committed GeoNames file (`public/geo/cities.json`, CC BY 4.0) answers,
//   so no photograph's coordinates ever leave the device.
// - **No answer is a real answer**: past `maxKm` it answers nil, and the caller
//   keeps no place rather than a far one.
// - A row it cannot read is DROPPED, never the whole index.
// - Two cities within `Gazetteer.tieKm` of the nearest are the same answer, and
//   the contest between them is total and order-free: a place beats a SECTION
//   of a place, then the bigger population, then the nearer, then the name —
//   measured on the real index (Perth vs its suburb Northbridge, Broome vs
//   Cable Beach, which GeoNames makes bigger).
// - A bounding box in degrees rejects almost every row before any
//   trigonometry; near a pole the longitude window stops meaning anything and
//   is dropped rather than computed wrong; a meridian gap is taken the short
//   way round, so a town across the antimeridian is not lost.
//
// The point is a `GpsCoord` (the web's `GeoPoint` has the same two fields and
// is not ported yet); the distance is `hooks/geo.ts`'s `haversineKm`, kept
// private here with the web's own radius, 6371.0088 km.
//
// Left to the app: reading `cities.json` from the bundle (the web's
// `load-gazetteer.ts`) and handing its parsed JSON to `parseGazetteer`.

import Foundation

public struct GazetteerCity: Equatable, Sendable {
    /// The place as GeoNames says it out loud ("Kalbarri").
    public var name: String
    /// ISO 3166-1 alpha-2, to tell two places of one name apart.
    public var country: String
    public var lat: Double
    public var lon: Double
    public var population: Double
    /// A district or suburb (GeoNames `PPLX`) rather than a place in its own
    /// right — named only when nothing else is near.
    public var section: Bool

    public init(name: String, country: String, lat: Double, lon: Double, population: Double, section: Bool) {
        self.name = name; self.country = country; self.lat = lat; self.lon = lon
        self.population = population; self.section = section
    }
}

/// The web's two module constants, under one name so they cannot collide.
public enum Gazetteer {
    /// Two cities this close to each other are, for naming purposes, the same answer.
    public static let tieKm: Double = 5
    /// How far a leg may be from a city and still be called by its name.
    public static let defaultMaxKm: Double = 90
}

/// The committed file, validated. Rows it cannot read are dropped rather than
/// failing the whole index.
public func parseGazetteer(_ raw: JSONValue?) -> [GazetteerCity] {
    guard let rows = raw?.objectValue?["cities"]?.arrayValue else { return [] }
    var cities: [GazetteerCity] = []
    for row in rows {
        guard let cells = row.arrayValue else { continue }
        func cell(_ i: Int) -> JSONValue? { i < cells.count ? cells[i] : nil }
        guard let name = cell(0)?.stringValue, !name.isEmpty else { continue }
        guard case .number(let lat)? = cell(2), case .number(let lon)? = cell(3) else { continue }
        if !lat.isFinite || !lon.isFinite { continue }
        if lat < -90 || lat > 90 || lon < -180 || lon > 180 { continue }
        var population = 0.0
        if case .number(let p)? = cell(4), p > 0 { population = p }
        var section = false
        if case .number(let s)? = cell(5), s == 1 { section = true }
        if case .bool(true)? = cell(5) { section = true }
        cities.append(GazetteerCity(
            name: name,
            country: cell(1)?.stringValue ?? "",
            lat: lat,
            lon: lon,
            population: population,
            section: section
        ))
    }
    return cities
}

/// Degrees of longitude between two meridians, the short way round.
private func lonGap(_ a: Double, _ b: Double) -> Double {
    let gap = (a - b).magnitude.truncatingRemainder(dividingBy: 360)
    return gap > 180 ? 360 - gap : gap
}

private let kmPerDegree = 111.32

/// Great-circle distance between two located places, in kilometres — the web's `haversineKm`.
private func gazetteerKm(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
    let r = 6371.0088
    let toRad = Double.pi / 180
    let dLat = (bLat - aLat) * toRad
    let dLon = (bLon - aLon) * toRad
    let sLat = sin(dLat / 2)
    let sLon = sin(dLon / 2)
    let s = sLat * sLat + cos(aLat * toRad) * cos(bLat * toRad) * sLon * sLon
    return 2 * r * asin(min(1, s.squareRoot()))
}

/// JS string order (UTF-16 code units), the web's `<` between two names.
private func jsLess(_ a: String, _ b: String) -> Bool {
    Array(a.utf16).lexicographicallyPrecedes(Array(b.utf16))
}

/// The nearest city to `point`, or nil when none is within `maxKm`.
public func nearestCity(_ cities: [GazetteerCity], _ point: GpsCoord, maxKm: Double = Gazetteer.defaultMaxKm) -> GazetteerCity? {
    let latWindow = maxKm / kmPerDegree
    // Near a pole, and for a window that spans the globe, the longitude filter
    // stops meaning anything — drop it rather than compute a wrong bound.
    let cosLat = cos(point.lat * Double.pi / 180)
    let lonWindow = cosLat > 0.02 ? maxKm / (kmPerDegree * cosLat) : 181

    var near: [(city: GazetteerCity, km: Double)] = []
    var bestKm = Double.infinity
    for city in cities {
        if (city.lat - point.lat).magnitude > latWindow { continue }
        if lonWindow <= 180 && lonGap(city.lon, point.lon) > lonWindow { continue }
        let km = gazetteerKm(point.lat, point.lon, city.lat, city.lon)
        if km > maxKm { continue }
        near.append((city, km))
        if km < bestKm { bestKm = km }
    }
    if near.isEmpty { return nil }

    // Two passes, so the answer cannot depend on the order the rows arrived
    // in: the nearest sets the bar, then everything within `tieKm` competes.
    let tied = near.filter { $0.km <= bestKm + Gazetteer.tieKm }
    var best = 0
    for i in tied.indices where i != best {
        let candidate = tied[i]
        let current = tied[best]
        if candidate.city.section != current.city.section {
            if !candidate.city.section { best = i }
        } else if candidate.city.population != current.city.population {
            if candidate.city.population > current.city.population { best = i }
        } else if candidate.km != current.km {
            if candidate.km < current.km { best = i }
        } else if jsLess(candidate.city.name, current.city.name) {
            best = i
        }
    }
    return tied[best].city
}
