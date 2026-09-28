// The layouts a slide can pick from — a registry, so a document stores an ID
// and the geometry can be tuned without a migration. Port of
// `src/shared/media/layout-templates.ts`. Grouped the way the picker shows
// them; the order here is the order on the shelf.
//
// Every entry is resolvable at any frame shape: a spec walks the whole list at
// 9:16, 4:5 and 1:1 and checks each cell lands inside the frame. The ids are
// what `SlideCollage.layout` stores, so each string matches the web's.

import Foundation

public enum LayoutGroup: String, CaseIterable, Sendable {
    case grid = "Grid"
    case stack = "Stack"
    case bento = "Bento"
    case inset = "Inset"
    case free = "Free"
}

public struct LayoutTemplateEntry: Equatable, Sendable {
    public var id: String
    public var name: String
    public var group: LayoutGroup
    public var template: LayoutTemplate
    public init(id: String, name: String, group: LayoutGroup, template: LayoutTemplate) {
        self.id = id; self.name = name; self.group = group; self.template = template
    }
}

private func grid(_ cols: [Double], _ rows: [Double], _ areas: String) -> LayoutTemplate {
    .tracks(cols: cols, rows: rows, areas: areas)
}

private func entry(_ id: String, _ name: String, _ group: LayoutGroup, _ template: LayoutTemplate) -> LayoutTemplateEntry {
    LayoutTemplateEntry(id: id, name: name, group: group, template: template)
}

/// The web's `LAYOUT_TEMPLATES`. Built in steps rather than one literal, for
/// the type checker's sake.
public let layoutTemplates: [LayoutTemplateEntry] = {
    var list: [LayoutTemplateEntry] = []
    list.append(entry("grid-2x2", "2 × 2", .grid, grid([1, 1], [1, 1], "a b / c d")))
    list.append(entry("grid-2x3", "2 × 3", .grid, grid([1, 1], [1, 1, 1], "a b / c d / e f")))
    list.append(entry("grid-3x3", "3 × 3", .grid, grid([1, 1, 1], [1, 1, 1], "a b c / d e f / g h i")))
    list.append(entry("grid-1x4", "1 × 4", .grid, grid([1], [1, 1, 1, 1], "a / b / c / d")))
    list.append(entry("stack-2", "Two rows", .stack, grid([1], [1, 1], "a / b")))
    list.append(entry("stack-3", "Three rows", .stack, grid([1], [1, 1, 1], "a / b / c")))
    list.append(entry("stack-tall", "Tall top", .stack, grid([1], [3, 2], "a / b")))
    list.append(entry("stack-cols", "Two columns", .stack, grid([1, 1], [1], "a b")))
    list.append(entry("bento-hero", "Hero + 3", .bento, grid([2, 1], [2, 1, 1], "a b / a c / d d")))
    list.append(entry("bento-six", "Six-piece", .bento, grid([1, 1, 1], [1, 1, 1, 1], "a a b / a a c / d e e / d f f")))
    list.append(entry("bento-band", "Band", .bento, grid([1, 1], [1, 1.3, 1], "a b / c c / d e")))
    list.append(entry("bento-l", "Corner L", .bento, grid([1, 1, 1], [1, 1, 1], "a a a / b c c / b c c")))
    list.append(entry("inset-1", "Inset", .inset, .inset(insets: [
        InsetSpec(corner: .br, width: 0.42, aspect: 4.0 / 5),
    ])))
    list.append(entry("inset-2", "Two insets", .inset, .inset(insets: [
        InsetSpec(corner: .tl, width: 0.34, aspect: 1),
        InsetSpec(corner: .br, width: 0.42, aspect: 4.0 / 5),
    ])))
    list.append(entry("prints-3", "Prints", .free, .free(prints: [
        PrintSpec(cx: 0.38, cy: 0.25, width: 0.64, aspect: 4.0 / 5, rotation: -6),
        PrintSpec(cx: 0.62, cy: 0.52, width: 0.6, aspect: 1, rotation: 5),
        PrintSpec(cx: 0.42, cy: 0.78, width: 0.66, aspect: 5.0 / 4, rotation: -3),
    ])))
    list.append(entry("prints-4", "Pile", .free, .free(prints: [
        PrintSpec(cx: 0.32, cy: 0.24, width: 0.5, aspect: 4.0 / 5, rotation: -8),
        PrintSpec(cx: 0.7, cy: 0.33, width: 0.48, aspect: 4.0 / 5, rotation: 7),
        PrintSpec(cx: 0.34, cy: 0.62, width: 0.5, aspect: 1, rotation: 4),
        PrintSpec(cx: 0.66, cy: 0.78, width: 0.52, aspect: 5.0 / 4, rotation: -5),
    ])))
    return list
}()

/// The web's `LAYOUT_GROUPS`, the shelves in order.
public let layoutGroups: [LayoutGroup] = LayoutGroup.allCases

private let byId: [String: LayoutTemplateEntry] = Dictionary(uniqueKeysWithValues: layoutTemplates.map { ($0.id, $0) })

/// The entry for an id, or nil — a stored id the registry no longer has resolves to no layout.
public func layoutTemplate(_ id: String?) -> LayoutTemplateEntry? {
    guard let id, !id.isEmpty else { return nil }
    return byId[id]
}

public func isLayoutId(_ id: String?) -> Bool {
    guard let id else { return false }
    return byId[id] != nil
}

/// How many cells a layout id resolves to; 0 for an unknown id.
public func layoutCellCount(_ id: String?) -> Int {
    guard let entry = layoutTemplate(id) else { return 0 }
    return cellCount(entry.template)
}
