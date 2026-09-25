// How much room this device gives the app — ONE coarse answer. The TYPE half
// of `src/shared/lib/device-class.ts`: a device is either CONSTRAINED (a
// phone or a tablet, or a machine that says it has 4 GiB or less) or ROOMY
// (everything else). Nothing here decides a pixel count; the modules that
// spend memory (`HeldBudget.swift`, the RAW budget) ask this and choose their
// own numbers, each explained where it lives (`device-memory.md`).
//
// Not ported here: the web's `deviceClassFor(facts)` and `readDeviceFacts()`,
// which sniff `navigator` — a browser has nothing to measure. The app answers
// from what the platform really knows (`ProcessInfo.physicalMemory`, the
// idiom) and hands the class down; the `localStorage['atelier.device']`
// override becomes an app preference of the same meaning.

import Foundation

public enum DeviceClass: String, CaseIterable, Sendable {
    case constrained
    case roomy
}
