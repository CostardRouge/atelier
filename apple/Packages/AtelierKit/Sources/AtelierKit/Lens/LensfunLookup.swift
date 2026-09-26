// Lensfun on THIS DEVICE, the pure half — port of the logic of
// `src/shared/lens/lensfun-store.ts` (`ShotLens`, `imageCrop`, `LookUp`,
// `lookUpLens`, `profileFor`, the kept `MatchRecord`). The consent, the
// network and the disk are the app's: they are HANDED IN, so the order of the
// questions and every refusal is held by a spec on Linux.
//
// - **Consent** is the device's, never a roll's (`local-first.md`: an
//   exported `.roll.json` must not carry someone's permission to talk to a
//   third party). Off until turned on. A kept answer is read WITHOUT it — the
//   answer is already on the device.
// - **The lookup** asks for the fewest database files that can answer
//   (`LensfunSource.swift`): the camera maker's, then the independent lens
//   makers' for that kind of body only when the lens was not in the first.
// - **What is kept** is the ANSWER, keyed by the body and the lens as the EXIF
//   names them (`lensKey`): the matched camera and the matched lens with its
//   whole calibration (every focal length, every aperture — a few kilobytes),
//   or "not in Lensfun". Never a file. So the second picture from that lens
//   asks nothing, at any focal length. A "not in Lensfun" is asked again after
//   a month: the database grows.
//
// Names: the web's `imageCrop` and `profileFor` are `lensImageCrop` and
// `lensProfileFor` here — the kernel is one module, and both web names are a
// field or a word away from a collision (`LensShot.imageCrop`).

import Foundation

/// What a picture's EXIF says about its glass.
public struct ShotLens: Equatable, Sendable {
    public var make: String?
    public var model: String?
    public var lensModel: String?
    public var focalLength: Double?
    /// The 35 mm equivalent, which says a body shot in a CROP mode (a full-frame Sony in APS-C).
    public var focalLength35: Double?
    public var fNumber: Double?

    public init(make: String? = nil, model: String? = nil, lensModel: String? = nil, focalLength: Double? = nil,
                focalLength35: Double? = nil, fNumber: Double? = nil) {
        self.make = make; self.model = model; self.lensModel = lensModel
        self.focalLength = focalLength; self.focalLength35 = focalLength35; self.fNumber = fNumber
    }

    /// The glass a picture's record names — nil when it names no camera (the
    /// web's `shotExif?.make && shotExif.model` gate).
    public init?(exif: ExifData?) {
        guard let exif, let make = exif.make, !make.isEmpty, let model = exif.model, !model.isEmpty else { return nil }
        self.init(make: make, model: model, lensModel: exif.lensModel, focalLength: exif.focalLength,
                  focalLength35: exif.focalLength35, fNumber: exif.fNumber)
    }

    /// What a lookup is re-asked on: the body, the lens, the focal length and
    /// the aperture (the web's `shotKey`).
    public var key: String {
        let focal = focalLength.map { String($0) } ?? ""
        let f = fNumber.map { String($0) } ?? ""
        return "\(lensKey(make ?? "", model ?? "", lensModel))|\(focal)|\(f)"
    }
}

/// The crop factor of the PICTURE: the body's, unless the EXIF's 35 mm
/// equivalent says it was shot in a crop mode — the calibration is then read
/// against the smaller area really exposed. The web's `imageCrop`.
public func lensImageCrop(_ camera: LensfunCamera, _ shot: ShotLens) -> Double {
    let f = shot.focalLength ?? 0
    let f35 = shot.focalLength35 ?? 0
    let said = f > 0 && f35 > 0 ? f35 / f : 0
    return said > camera.crop * 1.1 && said < camera.crop * 3 ? said : camera.crop
}

/// Why a lens has no profile.
public enum LensMissing: String, Sendable {
    /// The picture does not say its camera and focal length.
    case noExif = "no-exif"
    /// This camera is not in Lensfun.
    case camera
    /// This lens is not in Lensfun.
    case lens
}

/// A lookup's answer — the web's `LookUp`.
public enum LensLookUp: Equatable, Sendable {
    case found(camera: LensfunCamera, lens: LensfunLens)
    case missing(LensMissing)
    /// Lensfun could not be reached.
    case offline
    /// The person has not allowed the lookup (and nothing is kept for this lens).
    case notAllowed
}

/// How long "not in Lensfun" is believed before the database is asked again.
public let lensMissTtlMs = 30.0 * 24 * 3600 * 1000

/// One kept answer, per body + lens as the EXIF names them.
public struct LensMatchRecord: Equatable, Sendable {
    public var id: String
    public var camera: LensfunCamera?
    public var lens: LensfunLens?
    /// When it was asked, in ms since the epoch.
    public var at: Double

    public init(id: String, camera: LensfunCamera?, lens: LensfunLens?, at: Double) {
        self.id = id; self.camera = camera; self.lens = lens; self.at = at
    }

    /// As the device keeps it — the web's IndexedDB object, key for key.
    public var json: JSONValue {
        .object([
            "id": .string(id),
            "camera": camera?.json ?? .null,
            "lens": lens?.json ?? .null,
            "at": .number(at),
        ])
    }
}

/// A kept answer read back; nil for anything that is not one.
public func readLensMatchRecord(_ raw: JSONValue?) -> LensMatchRecord? {
    guard let o = raw?.objectValue, let id = o["id"]?.stringValue, let at = o["at"]?.finiteNumber else { return nil }
    return LensMatchRecord(id: id, camera: readLensfunCamera(o["camera"]), lens: readLensfunLens(o["lens"]), at: at)
}

// MARK: - the lookup

/// The camera and the lens a picture was taken with, from the device's kept
/// answers, else from Lensfun when the person allowed it. Never throws.
///
/// - Parameters:
///   - now: the clock, in ms (the web's `Date.now()`).
///   - allowed: the device's consent.
///   - readMatch / writeMatch: the device's kept answers; a failure is a nil
///     read and a silent write — the next picture asks again.
///   - fileDb: one database file, fetched and read (`parseLensfunXml`), nil
///     when it cannot be had.
public func lookUpLens(_ shot: ShotLens, now: Double, allowed: Bool,
                       readMatch: (String) async -> LensMatchRecord?,
                       writeMatch: (LensMatchRecord) async -> Void,
                       fileDb: (String) async -> LensfunDb?) async -> LensLookUp {
    guard let make = shot.make, !make.isEmpty, let model = shot.model, !model.isEmpty,
          let focal = shot.focalLength, focal > 0 else { return .missing(.noExif) }
    let id = lensKey(make, model, shot.lensModel)
    if let kept = await readMatch(id), kept.lens != nil || now - kept.at < lensMissTtlMs {
        if let camera = kept.camera, let lens = kept.lens { return .found(camera: camera, lens: lens) }
        return .missing(kept.camera != nil ? .lens : .camera)
    }
    if !allowed { return .notAllowed }

    let files = cameraFiles(makerKey(make))
    var tried: [LensfunDb] = []
    var camera: LensfunCamera?
    var cameraFile: String?
    var reached = false
    for file in files {
        guard let db = await fileDb(file) else { continue }
        reached = true
        tried.append(db)
        camera = findCamera([db], make, model)
        if camera != nil {
            cameraFile = file
            break
        }
    }
    guard let found = camera, let foundFile = cameraFile else {
        if !reached && !files.isEmpty { return .offline }
        await writeMatch(LensMatchRecord(id: id, camera: nil, lens: nil, at: now))
        return .missing(.camera)
    }
    var match = findLens(tried, found, shot.lensModel)
    if match == nil {
        for file in lensFiles(foundFile) {
            guard let db = await fileDb(file) else { continue }
            tried.append(db)
            match = findLens(tried, found, shot.lensModel)
            if match != nil { break }
        }
    }
    await writeMatch(LensMatchRecord(id: id, camera: found, lens: match?.lens, at: now))
    if let lens = match?.lens { return .found(camera: found, lens: lens) }
    return .missing(.lens)
}

/// The profile a found lens gives THIS picture: its focal length, its
/// aperture, its body's sensor. Nil when the picture has no focal length or
/// the database measured nothing for the lens. The web's `profileFor`.
public func lensProfileFor(_ camera: LensfunCamera, _ lens: LensfunLens, _ shot: ShotLens,
                           onRender: Bool = false) -> LensProfileApplied? {
    guard let focal = shot.focalLength, focal > 0 else { return nil }
    let aperture: Double? = (shot.fNumber ?? 0) > 0 ? shot.fNumber : nil
    let resolved = profileTerms(lens, LensShot(focal: focal, aperture: aperture, imageCrop: lensImageCrop(camera, shot)))
    let has = resolved.has
    if !has.distortion && !has.tca && !has.vignette { return nil }
    let lensName = "\(lens.maker) \(lens.models.first ?? "")".trimmingCharacters(in: .whitespaces)
    let cameraName = "\(camera.maker) \(camera.models.first ?? "")".trimmingCharacters(in: .whitespaces)
    return LensProfileApplied(lens: lensName, camera: cameraName, focal: focal, aperture: aperture,
                              terms: resolved.terms, has: has, onRender: onRender)
}

// MARK: - the kept records, as JSON

private func numbers(_ v: [Double]) -> JSONValue {
    .array(v.map { .number($0) })
}

private func readNumbers(_ v: JSONValue?) -> [Double]? {
    guard let a = v?.arrayValue else { return nil }
    var out: [Double] = []
    for x in a {
        guard let n = x.finiteNumber else { return nil }
        out.append(n)
    }
    return out
}

private func readStrings(_ v: JSONValue?) -> [String]? {
    guard let a = v?.arrayValue else { return nil }
    return a.compactMap { $0.stringValue }
}

extension LensfunCamera {
    public var json: JSONValue {
        .object([
            "maker": .string(maker),
            "models": .array(models.map { .string($0) }),
            "mount": .string(mount),
            "crop": .number(crop),
        ])
    }
}

public func readLensfunCamera(_ raw: JSONValue?) -> LensfunCamera? {
    guard let o = raw?.objectValue, let maker = o["maker"]?.stringValue, let models = readStrings(o["models"]),
          let mount = o["mount"]?.stringValue, let crop = o["crop"]?.finiteNumber else { return nil }
    return LensfunCamera(maker: maker, models: models, mount: mount, crop: crop)
}

extension LensfunLens {
    public var json: JSONValue {
        let distortionJSON: [JSONValue] = distortion.map { e in
            .object(["model": .string(e.model.rawValue), "focal": .number(e.focal), "terms": numbers(e.terms)])
        }
        let tcaJSON: [JSONValue] = tca.map { e in
            .object(["model": .string(e.model.rawValue), "focal": .number(e.focal), "terms": numbers(e.terms)])
        }
        let vignettingJSON: [JSONValue] = vignetting.map { e in
            .object([
                "focal": .number(e.focal), "aperture": .number(e.aperture),
                "distance": .number(e.distance), "terms": numbers(e.terms),
            ])
        }
        return .object([
            "maker": .string(maker),
            "models": .array(models.map { .string($0) }),
            "mounts": .array(mounts.map { .string($0) }),
            "crop": .number(crop),
            "aspect": .number(aspect),
            "type": .string(type),
            "focalMin": focalMin.map { .number($0) } ?? .null,
            "focalMax": focalMax.map { .number($0) } ?? .null,
            "distortion": .array(distortionJSON),
            "tca": .array(tcaJSON),
            "vignetting": .array(vignettingJSON),
        ])
    }
}

public func readLensfunLens(_ raw: JSONValue?) -> LensfunLens? {
    guard let o = raw?.objectValue, let maker = o["maker"]?.stringValue, let models = readStrings(o["models"]),
          let mounts = readStrings(o["mounts"]), let crop = o["crop"]?.finiteNumber,
          let aspect = o["aspect"]?.finiteNumber, let type = o["type"]?.stringValue else { return nil }
    var distortion: [DistortionEntry] = []
    for e in o["distortion"]?.arrayValue ?? [] {
        guard let d = e.objectValue, let model = d["model"]?.stringValue.flatMap(DistortionModel.init(rawValue:)),
              let focal = d["focal"]?.finiteNumber, let terms = readNumbers(d["terms"]) else { return nil }
        distortion.append(DistortionEntry(model: model, focal: focal, terms: terms))
    }
    var tca: [TcaEntry] = []
    for e in o["tca"]?.arrayValue ?? [] {
        guard let d = e.objectValue, let model = d["model"]?.stringValue.flatMap(TcaModel.init(rawValue:)),
              let focal = d["focal"]?.finiteNumber, let terms = readNumbers(d["terms"]) else { return nil }
        tca.append(TcaEntry(model: model, focal: focal, terms: terms))
    }
    var vignetting: [VignettingEntry] = []
    for e in o["vignetting"]?.arrayValue ?? [] {
        guard let d = e.objectValue, let focal = d["focal"]?.finiteNumber, let aperture = d["aperture"]?.finiteNumber,
              let distance = d["distance"]?.finiteNumber, let terms = readNumbers(d["terms"]) else { return nil }
        vignetting.append(VignettingEntry(focal: focal, aperture: aperture, distance: distance, terms: terms))
    }
    return LensfunLens(maker: maker, models: models, mounts: mounts, crop: crop, aspect: aspect, type: type,
                       focalMin: o["focalMin"]?.finiteNumber, focalMax: o["focalMax"]?.finiteNumber,
                       distortion: distortion, tca: tca, vignetting: vignetting)
}
