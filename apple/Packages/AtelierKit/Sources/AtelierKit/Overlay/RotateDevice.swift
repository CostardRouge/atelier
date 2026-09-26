// The "turn your phone" pictogram's motion — port of
// `src/shared/overlay/rotate-device.ts`, pure.
//
// A social export is a flat video: no gesture to detect, nothing to react to,
// so the only way to invite a viewer to rotate their screen is to SHOW the
// gesture. The tipping is the message and must read in a fraction of a
// second — hence the cycle: a beat upright (the eye finds the phone), a firm
// quarter turn, a beat on its side (the destination registers), the way back.
// A function of time alone, like the rest of the animation layer.

import Foundation

/// Shares of one cycle: hold, turn, hold, return. They sum to 1.
private let holdStart = 0.18
private let turnShare = 0.3
private let holdEnd = 0.3

/// How far through the quarter turn the phone is at `local` seconds (from the
/// moment the element appeared), 0 upright, 1 fully on its side. With
/// `returns` false the phone tips once and stays there for the rest of the
/// cycle.
public func tipProgress(_ local: Double, _ cycle: Double, returns: Bool = true) -> Double {
    let len = max(0.2, cycle)
    let wrapped = (local.truncatingRemainder(dividingBy: len) + len).truncatingRemainder(dividingBy: len)
    let p = wrapped / len
    if p < holdStart { return 0 }
    if p < holdStart + turnShare { return easeAt(.inOut, (p - holdStart) / turnShare) }
    if !returns { return 1 }
    let backStart = holdStart + turnShare + holdEnd
    if p < backStart { return 1 }
    return 1 - easeAt(.inOut, (p - backStart) / max(0.001, 1 - backStart))
}

/// The pictogram's rotation in radians; positive turns clockwise on screen.
public func tipAngle(_ local: Double, _ cycle: Double, direction: RotateDirection = .cw, returns: Bool = true) -> Double {
    let sign: Double = direction == .cw ? 1 : -1
    return sign * tipProgress(local, cycle, returns: returns) * Double.pi / 2
}
