// The trip's car, as a document field — what the garage edits and what the
// Virée opener drives. Port of `src/shared/roadtrip/car-spec.ts`.
//
// A car is a property of the TRIP (the maintainer's call, 2026-09-15): one car
// per journey, every piece of it drives the same one, and it travels in the
// `.roadtrip.json` backup (`TripDoc.car`, v19, portable). A spec names a MODEL
// from the registry (`CarRegistry.swift`), a body colour, a FINISH (factory
// gloss, or a matte textured coating like Raptor) and the GEAR fitted — each a
// toggle, modelled from the maintainer's own Prado.
//
// The rules it keeps:
// - the reader never throws and never trusts a stored value: an unknown model,
//   an unreadable colour or finish, a gear flag that is not a boolean each land
//   on the default, and a partial spec keeps what it says;
// - the default is the maintainer's car — the Prado J120 in Raptor black,
//   matte, every piece of gear on;
// - the stored gear flags are never rewritten by what is DRAWN
//   (`effectiveGear`): turning the bar or the basket back on restores what
//   rode on it.

import Foundation

/// The web's `CAR_MODEL_IDS` — the models this build knows.
public enum CarModelId: String, CaseIterable, Sendable {
    case pradoJ120 = "prado-j120"
}

public enum CarFinish: String, CaseIterable, Sendable {
    case gloss
    case matte
}

/// One toggle of `CarGear`, in the garage's order — the web's `GEAR_KEYS`
/// (`CarGearKey.allCases`) and `GEAR_LABELS` (`label`).
public enum CarGearKey: String, CaseIterable, Sendable {
    /// The tubular bar around the headlights.
    case bullBar
    /// Two round lights on the bull bar — only drawn with it.
    case spotLights
    /// The roof basket; the load below rides in it and is only drawn with it.
    case rack
    /// A solar panel, on the left of the basket.
    case solar
    /// The aluminium storage box, front right.
    case box
    /// Three jerry cans across the rear: water, petrol, water.
    case jerryCans
    /// The awning bag along the basket's left side.
    case awning
    case mudFlaps
    /// The tinted visors over the door windows.
    case visors
    /// The spare wheel on the tailgate.
    case spare
    case mirrors

    /// What the toggle is called on screen.
    public var label: String {
        switch self {
        case .bullBar: return "bull bar"
        case .spotLights: return "spot lights"
        case .rack: return "roof basket"
        case .solar: return "solar panel"
        case .box: return "storage box"
        case .jerryCans: return "jerry cans"
        case .awning: return "awning bag"
        case .mudFlaps: return "mud flaps"
        case .visors: return "window visors"
        case .spare: return "spare wheel"
        case .mirrors: return "door mirrors"
        }
    }
}

/// Everything that can be bolted on, each a toggle.
public struct CarGear: Equatable, Sendable {
    public var bullBar: Bool
    public var spotLights: Bool
    public var rack: Bool
    public var solar: Bool
    public var box: Bool
    public var jerryCans: Bool
    public var awning: Bool
    public var mudFlaps: Bool
    public var visors: Bool
    public var spare: Bool
    public var mirrors: Bool

    public init(bullBar: Bool = true, spotLights: Bool = true, rack: Bool = true, solar: Bool = true,
                box: Bool = true, jerryCans: Bool = true, awning: Bool = true, mudFlaps: Bool = true,
                visors: Bool = true, spare: Bool = true, mirrors: Bool = true) {
        self.bullBar = bullBar; self.spotLights = spotLights; self.rack = rack; self.solar = solar
        self.box = box; self.jerryCans = jerryCans; self.awning = awning; self.mudFlaps = mudFlaps
        self.visors = visors; self.spare = spare; self.mirrors = mirrors
    }

    /// The web's `GEAR_KEYS`, in the garage's order.
    public static let keys: [CarGearKey] = CarGearKey.allCases

    /// The web's `DEFAULT_GEAR`: every piece of gear on — the car as it was photographed.
    public static let `default` = CarGear()

    /// Every piece of gear off — the web specs' `BARE`.
    public static let bare = CarGear(bullBar: false, spotLights: false, rack: false, solar: false, box: false,
                                     jerryCans: false, awning: false, mudFlaps: false, visors: false,
                                     spare: false, mirrors: false)

    /// A flag by key — the web's `gear[key]`.
    public subscript(key: CarGearKey) -> Bool {
        get {
            switch key {
            case .bullBar: return bullBar
            case .spotLights: return spotLights
            case .rack: return rack
            case .solar: return solar
            case .box: return box
            case .jerryCans: return jerryCans
            case .awning: return awning
            case .mudFlaps: return mudFlaps
            case .visors: return visors
            case .spare: return spare
            case .mirrors: return mirrors
            }
        }
        set {
            switch key {
            case .bullBar: bullBar = newValue
            case .spotLights: spotLights = newValue
            case .rack: rack = newValue
            case .solar: solar = newValue
            case .box: box = newValue
            case .jerryCans: jerryCans = newValue
            case .awning: awning = newValue
            case .mudFlaps: mudFlaps = newValue
            case .visors: visors = newValue
            case .spare: spare = newValue
            case .mirrors: mirrors = newValue
            }
        }
    }
}

public struct CarSpec: Equatable, Sendable {
    public var model: CarModelId
    /// The body colour, `#rrggbb`.
    public var color: String
    public var finish: CarFinish
    public var gear: CarGear

    public init(model: CarModelId, color: String, finish: CarFinish, gear: CarGear) {
        self.model = model; self.color = color; self.finish = finish; self.gear = gear
    }

    /// The web's `DEFAULT_CAR` — frozen there, a value here: a copy edited is
    /// never the constant.
    public static let `default` = defaultCarSpec()
}

public struct CarColour: Equatable, Sendable {
    public var id: String
    public var name: String
    public var hex: String
    /// A preset that carries its own finish (a coating) sets it when picked.
    public var finish: CarFinish?
    /// A word about it, shown on hover.
    public var note: String?

    public init(id: String, name: String, hex: String, finish: CarFinish? = nil, note: String? = nil) {
        self.id = id; self.name = name; self.hex = hex; self.finish = finish; self.note = note
    }
}

/// The web's `CAR_COLOURS`: the J120's factory range as it is remembered, by
/// name rather than by paint code (none is claimed), plus the maintainer's own
/// two — the dark green the car wore first and the Raptor black it wears now.
public let carColours: [CarColour] = [
    CarColour(id: "ebony", name: "Ebony black", hex: "#141416"),
    CarColour(id: "glacier", name: "Glacier white", hex: "#f2f1ea"),
    CarColour(id: "silver", name: "Silver pearl", hex: "#c3c5c8"),
    CarColour(id: "graphite", name: "Graphite", hex: "#5a5c60"),
    CarColour(id: "champagne", name: "Champagne", hex: "#b9aa8b"),
    CarColour(id: "dark-blue", name: "Dark blue", hex: "#1f2b46"),
    CarColour(id: "merlot", name: "Merlot", hex: "#5c1b21"),
    CarColour(id: "dark-green", name: "Dark green", hex: "#1f3b2f", note: "The car before Raptor"),
    CarColour(id: "raptor-black", name: "Raptor black", hex: "#232326", finish: .matte, note: "A matte, textured coating"),
]

/// The maintainer's car: the Prado in Raptor black, fully geared — a fresh value each call.
public func defaultCarSpec() -> CarSpec {
    CarSpec(model: .pradoJ120, color: "#232326", finish: .matte, gear: .default)
}

/// `/^#[0-9a-f]{6}$/i` — seven ASCII bytes, a hash then six hex digits.
private func isCarHex(_ s: String) -> Bool {
    let bytes = Array(s.utf8)
    guard bytes.count == 7, bytes[0] == UInt8(ascii: "#") else { return false }
    for b in bytes[1...] {
        let digit = (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102)
        if !digit { return false }
    }
    return true
}

/// A stored spec, read defensively: an unknown model, an unreadable colour or
/// finish, a gear flag that is not a boolean, each lands on the default —
/// never a throw, and a partial spec keeps what it says.
public func readCarSpec(_ raw: JSONValue?) -> CarSpec {
    let fallback = defaultCarSpec()
    // The web reads an array as an object with no keys; that lands on the
    // fallback field by field, which is the fallback.
    guard let r = raw?.objectValue else { return fallback }
    let model = r["model"]?.stringValue.flatMap(CarModelId.init(rawValue:)) ?? fallback.model
    let color: String
    if let text = r["color"]?.stringValue, isCarHex(text) {
        color = text.lowercased()
    } else {
        color = fallback.color
    }
    let finish = r["finish"]?.stringValue.flatMap(CarFinish.init(rawValue:)) ?? fallback.finish
    let gearIn = r["gear"]?.objectValue ?? [:]
    var gear = fallback.gear
    for key in CarGear.keys {
        if let value = gearIn[key.rawValue]?.boolValue { gear[key] = value }
    }
    return CarSpec(model: model, color: color, finish: finish, gear: gear)
}

extension CarSpec {
    /// The writer: the record as the document holds it —
    /// `{ model, color, finish, gear: { bullBar, … } }`, every flag written.
    public var json: JSONValue {
        var gearOut: [String: JSONValue] = [:]
        for key in CarGear.keys { gearOut[key.rawValue] = .bool(gear[key]) }
        return .object([
            "model": .string(model.rawValue),
            "color": .string(color),
            "finish": .string(finish.rawValue),
            "gear": .object(gearOut),
        ])
    }
}

/// The gear as it is actually drawn: the spot lights need the bar to sit on,
/// the roof load needs the basket to ride in. The stored flags are left as
/// they are, so turning the bar or the basket back on restores them.
public func effectiveGear(_ gear: CarGear) -> CarGear {
    var shown = gear
    shown.spotLights = gear.bullBar && gear.spotLights
    shown.solar = gear.rack && gear.solar
    shown.box = gear.rack && gear.box
    shown.jerryCans = gear.rack && gear.jerryCans
    shown.awning = gear.rack && gear.awning
    return shown
}

/// Whether two specs describe the same car, flag by flag — the hex compared
/// whatever its case.
public func sameCarSpec(_ a: CarSpec, _ b: CarSpec) -> Bool {
    a.model == b.model
        && a.color.lowercased() == b.color.lowercased()
        && a.finish == b.finish
        && CarGear.keys.allSatisfy { a.gear[$0] == b.gear[$0] }
}

/// The preset a colour is, by its hex — "Custom" for any other.
public func colourName(_ color: String) -> String {
    let hex = color.lowercased()
    return carColours.first { $0.hex == hex }?.name ?? "Custom"
}

/// The gear that is on, in the garage's order, as words.
public func gearWords(_ gear: CarGear) -> [String] {
    let shown = effectiveGear(gear)
    return CarGear.keys.filter { shown[$0] }.map(\.label)
}

/// One line saying what the car is: the model, its colour and finish, its gear.
public func describeCar(_ spec: CarSpec, _ modelName: String) -> String {
    let words = gearWords(spec.gear)
    let gearText = words.isEmpty ? "no gear" : words.joined(separator: ", ")
    return "\(modelName) · \(colourName(spec.color)), \(spec.finish.rawValue) · \(gearText)"
}
