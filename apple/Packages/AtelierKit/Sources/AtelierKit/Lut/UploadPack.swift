// "Upload .cube" writing into the VAULT instead of into the document. Port of
// `src/shared/lut/upload-pack.ts`; reading the picked file and baking its
// thumbnail are the app's, the vault is `PackVault`.
//
// The leak this closes (`docs/lut-packs.md` §3.1, `media-pipeline.md`): an
// uploaded look used to ride as the layer's whole `.cube` text — 3.6–6.9 MB
// of ASCII into every trip, project and roll file and every Winnow sync. The
// hard rule is the opposite: a document carries a REFERENCE, never a lattice.
// So an upload does what importing a pack does — the bytes go into the vault
// keyed by their SHA-256, and the layer stores ~120 bytes naming them.
//
// Rules kept:
// - ONE standing personal pack (`pk_uploads`, "My looks"), each upload a look
//   at its root: a pack per upload would make ten uploads ten families of one
//   look in the picker's rail, and "Keep on <instance>" one gesture per look.
// - The same bytes uploaded twice are ONE look, matched on the HASH — so a
//   renamed copy is recognised and the stack gets the existing reference.
// - A failed parse or a refused store THROWS with a sentence; falling back to
//   an inlined lattice would quietly reopen the leak.
// - The READ path for an inlined lattice (`restoreLayers`' `custom` branch)
//   stays: documents written before exist, and nothing migrates them.

import Foundation

/// The standing personal pack. A FIXED id: it is the same library on every
/// device, and a reference already written into a trip names it.
public let uploadPackId = "pk_uploads"

/// What the picker and the credits popover call it.
public let uploadPackName = "My looks"

/// What an upload answers: the reference a layer stores, its name in the
/// stack, and the parsed lattice so the caller grades at once.
public struct UploadedLook: Equatable, Sendable {
    public var ref: PackRef
    public var name: String
    public var lut: CubeLut

    public init(ref: PackRef, name: String, lut: CubeLut) {
        self.ref = ref; self.name = name; self.lut = lut
    }
}

/// A look's label: the author's own file name, minus the extension and its
/// surrounding whitespace — the name itself when nothing is left.
public func uploadedLabel(_ fileName: String) -> String {
    let label = packTrimmed(packStem(fileName))
    return label.isEmpty ? fileName : label
}

/// The personal pack as it stands before its first upload.
public func emptyUploadPack() -> LutPackIndex {
    LutPackIndex(id: uploadPackId, name: uploadPackName, author: "", tree: [], looks: [], hidden: [])
}

/// The look a NEW upload adds to the personal pack — at its root, its id the
/// label's slug made unique within the pack (a reference names ONE look), its
/// family read from its name since no category sits above it.
public func newUploadLook(in pack: LutPackIndex, fileName: String, size: Int, lattice: Int, hash: String,
                          thumb: String? = nil) -> PackLook {
    let label = uploadedLabel(fileName)
    let base = packSlug(label)
    var id = base
    var n = 2
    while pack.looks.contains(where: { $0.id == id }) {
        id = "\(base)-\(n)"
        n += 1
    }
    return PackLook(
        id: id,
        label: label,
        node: "",
        file: fileName,
        family: familyForLookName(fileName),
        lattice: lattice,
        bytes: size,
        hash: hash,
        thumb: thumb.flatMap { $0.isEmpty ? nil : $0 }
    )
}

/// Read an uploaded `.cube` into the vault and answer the reference a layer
/// should store. `bytes` are the file's, read once; the text is decoded from
/// them. `bakeThumb` is asked only for a look the pack does not hold yet.
public func uploadLookIntoVault(
    _ bytes: [UInt8],
    fileName: String,
    vault: PackVault,
    bakeThumb: ((CubeLut, PackFamily) async -> String?)? = nil
) async throws -> UploadedLook {
    guard let lut = parseCube(packCubeText(bytes)) else {
        throw PackVaultError("\(fileName) isn’t a supported 3D .cube LUT (1D LUTs aren’t).")
    }
    let hash = sha256Hex(bytes)
    let known = await vault.storedLatticeHashes()
    if !known.contains(hash) {
        let ok = await vault.saveLookLattice(uploadPackId, hash, try encodeLattice(lut))
        if !ok { throw PackVaultError("This browser refused to store the look (storage full?).") }
    }

    let pack = await vault.loadPacks().first { $0.id == uploadPackId } ?? emptyUploadPack()
    // The same file twice is the same look, whatever it is called now.
    if let existing = pack.looks.first(where: { $0.hash == hash }) {
        return UploadedLook(ref: PackRef(pack: pack.id, look: existing.id, hash: hash), name: existing.label, lut: lut)
    }

    let family = familyForLookName(fileName)
    let thumb = await bakeThumb?(lut, family)
    let look = newUploadLook(in: pack, fileName: fileName, size: bytes.count, lattice: lut.size, hash: hash,
                             thumb: thumb)
    var next = pack
    next.looks.append(look)
    await vault.savePack(next)
    return UploadedLook(ref: PackRef(pack: pack.id, look: look.id, hash: hash), name: look.label, lut: lut)
}
