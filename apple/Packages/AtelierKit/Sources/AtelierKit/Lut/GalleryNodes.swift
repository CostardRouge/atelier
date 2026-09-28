// What the look picker's rail lists, and what each of its nodes holds. Port of
// `src/shared/lut/gallery-nodes.ts`.
//
// The picker is a TREE and a grid (`docs/lut-packs.md` §6, variant B): one
// family at a time in the grid, every family in the rail with its count. That
// shape is a PERFORMANCE decision as much as a layout: the grid never asks for
// more than one node's looks, and a 25-look pack of 65³ lattices (41 MB)
// cannot all be resolved to draw one screen (`media-pipeline.md`).
//
// Pure data: the built-in manifest, the film stocks and the packs in, a flat
// list of nodes out. Where the web hands each item a `resolve()` closure that
// fetches or generates its cube, an item here carries WHAT to resolve
// (`GalleryLookSource`) and the app resolves it — a built-in from its bundle,
// a film stock by `filmCubeFor(filmSettingsFor(_:))`, a pack look from its
// vault. A tile normally draws its pre-baked `thumb` and resolves nothing.

import Foundation

/// How a picked look is named back to the host.
public let filmPick = "film:"
public let packPick = "pack:"
/// The starred shortlist's own row.
public let favouritesNode = "favourites"

private let builtinRootNode = "builtin"
private let filmNodeId = "film"

/// Where an item's cube comes from — what the web's `resolve()` would fetch.
public enum GalleryLookSource: Equatable, Sendable {
    /// A built-in, by its manifest id.
    case builtin(id: String)
    /// A film stock, generated from its numbers.
    case film(FilmStockId)
    /// A pack look, by the reference the vault resolves (`hash` empty when the
    /// index records none).
    case pack(pack: String, look: String, hash: String)
}

/// One tile.
public struct GalleryItem: Equatable, Sendable {
    /// `<builtin id>`, `film:<stock>`, or `pack:<packId>/<lookId>`.
    public var id: String
    public var name: String
    /// A tile that already exists — a pack look's baked at import, a built-in's
    /// baked by the generator and shipped. The item draws without resolving.
    public var thumb: String?
    /// The cube, for when there is no tile, and for the scene's live bake. Set
    /// EVEN when a tile exists: the grid reads the tile, but the scene grades
    /// the one look that is aimed.
    public var resolve: GalleryLookSource
    /// Which reference this look expects to be read ON.
    public var family: PackFamily

    public init(id: String, name: String, thumb: String? = nil, resolve: GalleryLookSource, family: PackFamily) {
        self.id = id; self.name = name; self.thumb = thumb; self.resolve = resolve; self.family = family
    }
}

/// One row of the rail.
public struct GalleryNode: Equatable, Sendable {
    public var id: String
    public var label: String
    /// 0 for a family, 1 for a category, 2 for a camera.
    public var depth: Int
    /// A caution the node carries — the pack's own ("D-Log, not D-Log M").
    public var hint: String?
    /// Set on a pack's root node: the credits belong to it.
    public var pack: LutPackIndex?
    /// True when the node holds no look of its own and shows its branch's (or,
    /// for Favourites, repeats looks other rows own).
    public var aggregate: Bool
    public var items: [GalleryItem]

    public init(id: String, label: String, depth: Int, hint: String? = nil, pack: LutPackIndex? = nil,
                aggregate: Bool = false, items: [GalleryItem]) {
        self.id = id; self.label = label; self.depth = depth; self.hint = hint; self.pack = pack
        self.aggregate = aggregate; self.items = items
    }
}

/// A pack look's pick id — what the grade panel turns back into a reference.
public func packPickId(_ packId: String, _ lookId: String) -> String {
    "\(packPick)\(packId)/\(lookId)"
}

/// The pack and look a pick id names, or nil.
public func readPackPick(_ id: String) -> (pack: String, look: String)? {
    guard id.hasPrefix(packPick) else { return nil }
    let rest = id.dropFirst(packPick.count)
    guard let cut = rest.firstIndex(of: "/"), cut > rest.startIndex else { return nil }
    return (String(rest[rest.startIndex..<cut]), String(rest[rest.index(after: cut)...]))
}

/// Every node, in rail order: ★ Favourites when anything starred still exists,
/// the film stocks where the host offers them, the built-ins and their
/// folders, then one branch per pack.
///
/// `thumbs` is the tiles a build ships, keyed by item id; **nil means bake
/// LIVE** — nothing carries a `thumb`, a pack's looks included, which is the
/// explicit "on my picture" mode. `builtins` is the manifest the web reads
/// from `virtual:luts`, handed in by the app.
public func galleryNodes(
    _ packs: [LutPackIndex],
    includeFilm: Bool,
    builtins: [BuiltinLut],
    thumbs: [String: String]? = [:],
    favourites: [String] = []
) -> [GalleryNode] {
    var nodes: [GalleryNode] = []
    /// A tile a build already baked, if this is not the live mode.
    func baked(_ id: String) -> String? {
        guard let url = thumbs?[id], !url.isEmpty else { return nil }
        return url
    }
    func builtinItems(_ list: [BuiltinLut]) -> [GalleryItem] {
        list.map { l in
            // The generator's own reading of the same name, deliberately.
            GalleryItem(id: l.id, name: l.name, thumb: baked(l.id), resolve: .builtin(id: l.id),
                        family: familyForLookName(l.name))
        }
    }

    if includeFilm {
        nodes.append(GalleryNode(
            id: filmNodeId,
            label: filmGroupLabel,
            depth: 0,
            items: filmStocks.map { s in
                let id = "\(filmPick)\(s.id.rawValue)"
                // An emulsion is a response to a display-referred picture,
                // never a conversion: it is judged on the photograph.
                return GalleryItem(id: id, name: s.name, thumb: baked(id), resolve: .film(s.id), family: .rec709)
            }
        ))
    }

    nodes.append(GalleryNode(id: builtinRootNode, label: "Built-in", depth: 0,
                             items: builtinItems(ungroupedLuts(builtins))))
    for group in lutGroups(builtins) {
        nodes.append(GalleryNode(id: "\(builtinRootNode)/\(group.label)", label: group.label, depth: 1,
                                 items: builtinItems(group.luts)))
    }

    let usePreBaked = thumbs != nil
    for pack in packs {
        let rootLooks = visibleLooks(pack).filter { $0.node.isEmpty }
        let packName: String
        if !pack.name.isEmpty { packName = pack.name } else if !pack.author.isEmpty { packName = pack.author } else { packName = "Pack" }
        nodes.append(GalleryNode(
            id: "pack/\(pack.id)",
            label: packName,
            depth: 0,
            pack: pack,
            items: rootLooks.map { packItem(pack, $0, usePreBaked) }
        ))
        for entry in flattenNodes(pack.tree) {
            let branch = looksUnder(pack, entry.node.id)
            if branch.isEmpty { continue }
            // A category whose looks all hang from its cameras shows its WHOLE
            // branch: an empty grid there would read as holding nothing.
            let direct = branch.filter { $0.node == entry.node.id }
            let hint = entry.node.hint.flatMap { $0.isEmpty ? nil : $0 }
            nodes.append(GalleryNode(
                id: "pack/\(pack.id)/\(entry.node.id)",
                label: entry.node.label,
                depth: entry.depth + 1,
                hint: hint,
                items: (direct.isEmpty ? branch : direct).map { packItem(pack, $0, usePreBaked) }
            ))
        }
    }

    // ★ Favourites, first in the rail. It repeats items other nodes own —
    // `aggregate`, which keeps a search from listing every star twice. A star
    // whose look is gone is left out silently: the list keeps it, so bringing
    // the look back brings the star back.
    if !favourites.isEmpty {
        var byId: [String: GalleryItem] = [:]
        for item in nodes.flatMap(\.items) { byId[item.id] = item }
        let items = favourites.compactMap { byId[$0] }
        if !items.isEmpty {
            nodes.insert(GalleryNode(id: favouritesNode, label: "★ Favourites", depth: 0, aggregate: true, items: items),
                         at: 0)
        }
    }

    // A node whose looks all hang from its children shows the WHOLE branch:
    // `Built-in` holds nothing at `luts/`'s own level, and a pack's root holds
    // nothing when every look is filed under a category.
    return nodes.map { node in
        if !node.items.isEmpty { return node }
        var seen = Set<String>()
        var items: [GalleryItem] = []
        for child in nodes where child.id.hasPrefix("\(node.id)/") {
            for item in child.items where !seen.contains(item.id) {
                seen.insert(item.id)
                items.append(item)
            }
        }
        var next = node
        next.aggregate = true
        next.items = items
        return next
    }
}

/// One pack look as a tile: normally its thumbnail baked at import, resolving
/// nothing; asked to bake LIVE, a source to resolve like everything else.
private func packItem(_ pack: LutPackIndex, _ look: PackLook, _ usePreBaked: Bool) -> GalleryItem {
    let thumb = usePreBaked ? look.thumb.flatMap { $0.isEmpty ? nil : $0 } : nil
    return GalleryItem(
        id: packPickId(pack.id, look.id),
        name: look.label,
        thumb: thumb,
        resolve: .pack(pack: pack.id, look: look.id, hash: look.hash ?? ""),
        family: look.family
    )
}

/// Every item of every node matching a query, for a search that ignores the
/// rail — reading only the nodes that OWN their looks, or an aggregating row
/// would show every match twice.
public func matchingItems(_ nodes: [GalleryNode], _ query: String) -> [(node: GalleryNode, items: [GalleryItem])] {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if q.isEmpty { return [] }
    return nodes
        .filter { !$0.aggregate }
        .map { node in (node: node, items: node.items.filter { $0.name.lowercased().contains(q) }) }
        .filter { !$0.items.isEmpty }
}
