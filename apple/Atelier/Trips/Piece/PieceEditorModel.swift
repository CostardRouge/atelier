// ONE open piece of a trip — the store half of the web's `PostEditor.tsx`:
// the deck and which slide is open, the collage cell in hand, the badge piece
// the Content and Look tabs edit, the element outlined on the stage, the tab,
// the grade's rungs, the develop verbs, and every WRITE a tab or a gesture
// makes. The four tabs, the band and the stage read and write the piece
// through here and nowhere else.
//
// Split by concern, one file each:
// - this file: the document, the deck, the selection, the funnel, the deck
//   edits, the grade rungs, the develop verbs;
// - `+Writes`: the collage's cells, the framing and its cards, the block, the
//   opener, a shade's centre, a clip's cut and speed;
// - `+Library`: the Library's tick and the open slide kept in step both ways,
//   a collage's pictures fetched back, a picture dropped on a cell;
// - `+Stage`: the pictures decoded, the stage rendered, the clock the badge
//   runs on, the clip played, the hook thumbnail kept;
// - `+Keys`: every key the web binds.
//
// Rules kept (`roadtrip.md`):
// - Every write goes through `TripsStore`'s one funnel under the label
//   `post:<id>` (`updatePost`, `changeTrip`), so a slider here is one undo
//   step and never merges with a trip-wide change made elsewhere.
// - The route says WHERE you are (trip, day, piece); the TAB is this
//   screen's own state and never part of it.
// - Selection routes through ONE `selectElement(_:)`: it parses the id back to
//   its badge piece, caption line or card role, switches to the tab that owns
//   the field and asks it to take focus. `selectedId` (the outline) and
//   `piece` (what the chips edit) are separate: a press on the empty picture
//   clears the outline and keeps the piece. A selection is dropped on slide
//   change — the ids belong to one slide.
// - A control about the PIECE is never inside the hook-only branch.
// - The inspector, the Library and the develop sheet follow the SELECTED
//   cell; a new slide starts on its lead.

import CoreGraphics
import Foundation
import Observation
import AtelierKit

/// The inspector's four tabs — Road Trip's own nouns.
enum PieceTab: String, CaseIterable, Identifiable {
    case content, look, picture, export

    var id: String { rawValue }

    var label: String {
        switch self {
        case .content: return "Content"
        case .look: return "Look"
        case .picture: return "Picture"
        case .export: return "Export"
        }
    }
}

/// Which card of a move the stage shows: the last (`end`, the composition —
/// kept as a word so it survives a card added before it), one by index, or
/// none while the needle stands between two.
enum PieceCardPick: Equatable {
    case end
    case index(Int)
    case between

    static func of(_ index: Int?, count: Int) -> PieceCardPick {
        guard let index else { return .between }
        return index >= count - 1 ? .end : .index(max(0, index))
    }
}

/// What a click on the stage asks a tab to focus.
enum PieceFocusTarget: Equatable {
    /// The Content tab's text field (a badge piece's override, a caption).
    case text
}

/// A word in the picture's top-left corner — which card of a move is shown,
/// or why a gesture did nothing.
struct PieceStageCaption: Equatable {
    enum Tone: Equatable {
        case plain, accent, muted
    }

    var text: String
    var tone: Tone
}

/// A develop verb the sheet offers beside Done: writes a COPY now.
struct PieceApplyVerb: Identifiable {
    let id: String
    let label: String
    let hint: String
    let run: (DevelopSettings?) -> Void
}

/// The opener as prepared for the open piece — its content, its context and
/// the drawing, derived once per change of what it reads.
struct PieceHookState {
    var content: BadgeContent?
    var ctx: HookContext
    var hook: ResolvedHook
    var block: HookBlock?
}

@MainActor
@Observable
final class PieceEditorModel {
    /// What the opener is selected as — not an overlay element, so it has no
    /// element id: this one is reserved, parsed by nothing, and read as "the
    /// opener" (the web's `HOOK_ID`).
    static let hookId = "hook"

    let store: TripsStore
    let tripId: String
    let postId: String
    /// The shell's Library (`LibraryStore`, through `PieceLibrary`), when the
    /// environment carries one — a preview may not.
    private(set) var library: (any PieceLibrary)?

    // MARK: - the selection

    /// The slide asked for; `slideIndex` is it clamped to the deck. Moved by
    /// `openSlide(_:)` — the band and the transport's `goTo` go through it.
    private(set) var selected = 0
    /// The cell asked for on a collage; `cellIndex` is it clamped.
    private(set) var selectedCell = 0
    /// What the Library had ticked when a cell was selected — an EMPTY cell
    /// takes only a picture ticked AFTER that (`roadtrip.md`'s trap).
    private(set) var cellBaseline: SavedMediaRef?
    /// The element outlined on the stage; nil = nothing outlined.
    private(set) var selectedId: String?
    /// The badge piece the Content and Look tabs edit.
    var piece: BadgePiece = .kicker
    var tab: PieceTab = .content
    /// On a phone: the inspector is up (a sheet, or the Picture drawer).
    var inspectorOpen = false
    /// A field a tab should focus, and a counter that says it was asked again.
    private(set) var focusRequest: PieceFocusTarget?
    private(set) var focusSeq = 0
    /// A field of this screen types: the editor's keys stand down.
    var textEditing = false

    // MARK: - the sheets

    /// ⚙ Trip, and the section it was asked on — `words`, `cta`, `defaults`,
    /// `car`, `house`, or a closing-card line (`cta:headline:0`).
    var tripSheet: String?
    /// The garage, opened from the opener that drives the trip's car.
    var garageOpen = false
    /// The develop sheet over the SELECTED cell.
    var developOpen = false
    /// A shade whose centre the stage is placing (the Look tab's "Place on
    /// the picture"), by id.
    var placingShade: String?

    // MARK: - the transport (the clock half is `+Stage`)

    let deck = PieceDeckClock()
    /// The open clip's playhead, in source seconds (`setPlayhead`).
    var playhead: Double = 0
    /// The clip's OWN playback, while its cut is open on the band (it loops
    /// there) — `setClipPlaying`.
    var clipPlaying = false
    /// The cut is open on the band — `setTrimming`.
    var trimming = false
    /// What playback loops over — the piece, or the open slide (`L`).
    var loopScope: LoopScope = .piece
    /// The opener's ticks, heard while it plays (`M`) — off until asked for.
    var soundOn = false
    /// Which card of the selected picture's move the stage shows.
    var cardPick: PieceCardPick = .end
    /// Until when the stage says a gesture was refused.
    var refusedUntil: Date?
    /// Each clip's length once decoded, by lower-cased name — so a stored 5 s
    /// over a 3 s clip reads 3 on the band before that slide is opened again.
    var clipDurations: [String: Double] = [:]

    // MARK: - what the stage decoded and drew (`+Stage`)

    /// The open slide's lead as decoded, and the collage's other cells.
    @ObservationIgnored var leadSource: BadgeSource?
    @ObservationIgnored var cellSources: [BadgeSource?] = []
    /// The lead's file and what it measured, once decoded.
    var leadInfo: PieceLeadInfo?
    /// A picture is decoding.
    var loading = false
    /// Why the stage's picture could not be drawn.
    var stageError: String?
    /// The last frame the stage drew, with what the paint measured.
    let stage = PieceStageRenderer()
    /// The stage's box on screen, in points, and the screen's scale (`setStageBox`).
    @ObservationIgnored var stageBox: (points: AtelierKit.Size, scale: Double) = (AtelierKit.Size(0, 0), 2)
    /// The frame a PLAYING clip shows, wrapped as a source; nil while paused.
    @ObservationIgnored var liveFrame: BadgeSource?
    /// The hook's clip length, once decoded — what `hookLength` clamps to.
    var hookClipSeconds = 0.0
    /// The opener's pictures, decoded, and one line per picture that could not be.
    var hookPictures: [String: HookPicture] = [:]
    var hookPictureProblems: [String: String] = [:]
    /// The hook picture's EXIF — the badge's camera credit.
    var hookExif: EffectiveExif?
    /// Each picture's decoded shape — lead first, then every cell.
    var pictureSizes: [AtelierKit.Size?] = []
    /// The Library sync's report for the selected cell (`+Library`).
    var libraryRecovery: PieceRecovery?
    /// A collage's pictures being fetched back, in the order started.
    var collageFetches: [(key: String, value: PieceRecovery)] = []

    // MARK: - what leaves

    /// The piece's exports — the header's one button and the Export tab's.
    let exports = TripPieceExport()

    // MARK: - bookkeeping

    /// Bumped the moment the document moves — by this model's own writes, and
    /// synchronously inside the store's mutation (`watchStore`) — so a
    /// derivation made from the last document is never read again.
    @ObservationIgnored var revision = 0
    @ObservationIgnored var hookCache: (rev: Int, extra: Int, value: PieceHookState)?
    @ObservationIgnored var slidesCache: (rev: Int, value: [DeckSlide])?
    /// Bumped when the opener's pictures or the hook's EXIF change.
    @ObservationIgnored var hookInputs = 0
    /// The looks every picture of the piece is baked through — made again
    /// once the vault resolved the piece's pack looks (`prepareLooks`).
    @ObservationIgnored var looks: TripSlideLooks
    @ObservationIgnored var renderer: SlideRenderer?
    @ObservationIgnored var rendererRev = -1
    @ObservationIgnored var rendererInputs = -1
    @ObservationIgnored var loadedLeadKey: String?
    @ObservationIgnored var loadedCellKeys: [String?] = []
    @ObservationIgnored var clockOpened: String?
    @ObservationIgnored var clockIn: Double?
    @ObservationIgnored var seeking = false
    @ObservationIgnored var seekAgain = false
    @ObservationIgnored var wasPlaying = false
    @ObservationIgnored var openerKey: String?
    @ObservationIgnored var exifKey: String?
    @ObservationIgnored var looksKey: String?
    @ObservationIgnored var tasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored var syncState = PieceSyncState()
    @ObservationIgnored var thumbTimer: Task<Void, Never>?
    let clip = PieceClipPlayer()
    @ObservationIgnored var closed = false
    /// The slide the resets last ran for.
    @ObservationIgnored var openedKey: String?
    /// The pool files this editor opened, their scopes held while it is up.
    @ObservationIgnored var openedFiles: [String: OpenedFile] = [:]
    /// Which watch on the store is the live one.
    @ObservationIgnored var watchGeneration = 0

    init(store: TripsStore, tripId: String, postId: String, library: (any PieceLibrary)? = nil) {
        self.store = store
        self.tripId = tripId
        self.postId = postId
        self.library = library
        looks = TripSlideLooks(looks: .shared, interpolation: LookLibrary.shared.interpolation)
        syncState.seenActive = library?.active
        deck.host = self
        clip.host = self
        openedKey = slideKey
        stage.onFrame = { [weak self] frame in self?.frameLanded(frame) }
        playhead = store.trip(tripId)?.posts.first { $0.id == postId }?.badge.videoTimeSeconds ?? 0
        watchStore()
    }

    /// The Library arrived (or changed) — the environment is read after init.
    func attach(_ next: (any PieceLibrary)?) {
        if library === next { return }
        library = next
        syncState = PieceSyncState()
        syncState.seenActive = next?.active
        libraryChanged()
    }

    /// The editor is on screen: the history is sealed (a step never reaches
    /// back into the overview's), and every pass runs once for the piece.
    func appeared() {
        if closed {
            // Back from another tool: watch again, and read everything afresh
            // — the files were let go, the document may have moved.
            closed = false
            watchGeneration &+= 1
            revision &+= 1
            loadedLeadKey = nil
            loadedCellKeys = []
            exifKey = nil
            openerKey = nil
            looksKey = nil
            watchStore()
        }
        store.sealHistory()
        documentMoved()
    }

    /// The editor is going away: stop what plays and what is waited on, and
    /// let the files go — unless an export still reads them.
    func close() {
        closed = true
        deck.setPlaying(false)
        clip.stop()
        for task in tasks.values { task.cancel() }
        tasks.removeAll()
        thumbTimer?.cancel()
        store.sealHistory()
        if !exports.running {
            for file in openedFiles.values { file.close() }
            openedFiles.removeAll()
        }
    }

    /// Where a pool file's bytes are — opened once through the Library and
    /// held while the editor is up (a clip's decoder reads as it plays).
    func url(for ref: SavedMediaRef) -> URL? {
        let key = fileIdentity(ref)
        if let hit = openedFiles[key] { return hit.url }
        guard let opened = library?.open(ref) else { return nil }
        openedFiles[key] = opened
        return opened.url
    }

    // MARK: - the document

    /// The trip, with every edit on it.
    var trip: TripDoc? { store.trip(tripId) }

    /// The piece; nil once it is gone (deleted, or the trip replaced without it).
    var post: TripPost? { trip?.posts.first { $0.id == postId } }

    /// The frame's aspect (width / height) the piece is composed in.
    var aspect: Double { post.map(pieceAspect) ?? 4.0 / 5 }

    /// The deck, in swipe order: the hook, the content slides, the closing card.
    /// Derived once per document — `deckSlides` prepares the opener to know
    /// whether the hook moves, and the clock reads the deck every frame. The
    /// document is read first so a view reading the deck still follows it.
    var slides: [DeckSlide] {
        guard let trip, let post else { return [] }
        if let cached = slidesCache, cached.rev == revision { return cached.value }
        let made = deckSlides(trip, post)
        slidesCache = (revision, made)
        return made
    }

    var slideIndex: Int { max(0, min(selected, slides.count - 1)) }

    var slide: DeckSlide? {
        let all = slides
        return all.indices.contains(slideIndex) ? all[slideIndex] : nil
    }

    var isHook: Bool { slide?.kind == .hook }
    var isCta: Bool { slide?.kind == .cta }

    /// A stable key for the open slide — what survives the deck being reordered.
    var slideKey: String { slide.map { $0.slideId ?? $0.kind.rawValue } ?? "" }

    /// The key the grade chain and the develop verbs address the open picture
    /// by; nil for the closing card, which has no photograph.
    var pictureKey: PictureKey { slide.map { pictureKeyOf($0) } ?? nil }

    // MARK: - the collage

    /// Several pictures in this slide's frame, or nil.
    var collage: SlideCollage? { isCta ? nil : slide?.collage }

    var cellCount: Int { collage.map(collageCellCount) ?? 1 }

    /// The cell in hand — 0 is the lead, and without a collage the slide itself.
    var cellIndex: Int { collage == nil ? 0 : min(selectedCell, max(0, cellCount - 1)) }

    /// The slide's own picture, as the collage module names it.
    var lead: CollageLead {
        guard let slide else { return CollageLead(media: nil, framing: .default, develop: nil, motion: nil) }
        return CollageLead(media: slide.media, framing: slide.framing, develop: slide.develop, motion: slide.motion)
    }

    /// The selected cell of a collage.
    var cell: CollageCell? { collage.map { collageCellAt(lead, $0, cellIndex) } }

    /// The SELECTED cell's framing — the slide's own when it is cell 0.
    var cellFraming: Framing { cell?.framing ?? slide?.framing ?? .default }
    var cellMotion: FramingMotion? { cell != nil ? cell?.motion : slide?.motion }
    var cellDevelop: DevelopSettings? { cell != nil ? cell?.develop : slide?.develop }
    var cellMedia: SavedMediaRef? { cell != nil ? cell?.media : slide?.media }

    /// Pick cell `i` of the open slide — the inspector, the Library and the
    /// develop sheet follow it.
    func selectCell(_ i: Int) {
        let next = max(0, i)
        cellBaseline = library?.active
        guard next != selectedCell else { return }
        selectedCell = next
        setCardPick(.end)
        requestRender()
        libraryChanged()
    }

    // MARK: - the one funnel

    /// The screen's undo label: a gesture on this piece never merges with a
    /// trip-wide change made a moment later elsewhere.
    var historyLabel: String { "post:\(postId)" }

    /// Rewrite the piece, stamping the trip.
    func updatePost(_ transform: (inout TripPost) -> Void) {
        guard var next = post else { return }
        transform(&next)
        guard next != post else { return }
        revision &+= 1
        store.updatePost(next)
    }

    /// Replace the piece whole — a tab that built its own.
    func setPost(_ next: TripPost) {
        guard next.id == postId, next != post else { return }
        revision &+= 1
        store.updatePost(next)
    }

    /// A trip-wide change made from this piece (the trip's words, its grade,
    /// the car, another piece of the day), stamped now.
    func changeTrip(_ transform: (inout TripDoc) -> Void) {
        guard var next = trip else { return }
        transform(&next)
        guard next != trip else { return }
        next.updatedAt = nowMillis()
        revision &+= 1
        store.change(next, label: historyLabel)
    }

    /// One field of the badge.
    func patchBadge(_ transform: (inout PostBadge) -> Void) {
        updatePost { transform(&$0.badge) }
    }

    /// One field of the OPEN content slide; the hook and the closing card have none.
    func patchSlide(_ transform: (inout PostSlide) -> Void) {
        guard let id = slide?.slideId else { return }
        updatePost { post in
            guard let i = post.slides.firstIndex(where: { $0.id == id }) else { return }
            transform(&post.slides[i])
        }
    }

    // MARK: - selecting what is on the stage

    /// Pick an element — a badge piece, a caption line, a card's line, the
    /// opener — or nothing. Picking one is a request to EDIT it: its tab
    /// comes back with the selection and its field is asked to take focus.
    func selectElement(_ id: String?) {
        if selectedId != id {
            selectedId = id
            requestRender()
        }
        guard let id else { return }
        if id == PieceEditorModel.hookId {
            // The opener's panel is the first thing on the Look tab, and it
            // has no one field to focus — the whole panel IS the selection.
            tab = .look
            return
        }
        if let badgePiece = pieceFromElementId(id) {
            piece = badgePiece
            tab = .content
            focusRequest = .text
        } else if captionLineFromElementId(id) != nil {
            tab = .content
            focusRequest = .text
        } else if ctaRoleFromElementId(id) != nil {
            // The closing card belongs to the whole trip: edited in its sheet,
            // opened on that line with its field focused (the element id is
            // what `TripSettingsSheet`'s `section` reads).
            tripSheet = id
            return
        } else {
            return
        }
        focusSeq &+= 1
    }

    /// The piece picker's choice — the same as a press on the piece.
    func selectPiece(_ next: BadgePiece) {
        selectElement(pieceElementId(next))
    }

    /// A TAP on an element (a press that never travelled): on a phone the
    /// inspector is a sheet, so the tap RAISES it — never mid-drag.
    func activate(_ id: String, compact: Bool) {
        selectElement(id)
        if compact && ctaRoleFromElementId(id) == nil { inspectorOpen = true }
    }

    /// The tab took the focus it was asked for.
    func focusTaken() {
        focusRequest = nil
    }

    /// Open a tab (the phone's strip raises the inspector with it).
    func openTab(_ next: PieceTab) {
        tab = next
        inspectorOpen = true
    }

    /// Open slide `index` of the deck. A new slide resets the cell, the
    /// selection, the card and the cut, and the Library is re-pointed at its
    /// picture. The transport's `goTo` is what a band or a key calls.
    func openSlide(_ index: Int) {
        let next = max(0, min(index, slides.count - 1))
        if next != selected {
            selected = next
            // A selection names an element of ONE slide.
            selectedId = nil
            requestRender()
        }
        slideMaybeChanged()
    }

    /// What a DIFFERENT slide under the index resets — keyed on the slide,
    /// not the index, as the web's effects are: a reorder or an undo can put
    /// another slide where the open one was.
    func slideMaybeChanged() {
        let key = slideKey
        guard key != openedKey else { return }
        openedKey = key
        selectedCell = 0
        cellBaseline = library?.active
        cardPick = .end
        trimming = false
        clipPlaying = false
        dropStalePlacing()
        slideChangedForClock()
        requestRender()
        libraryChanged()
    }

    /// A shade's centre is placed only on the hook, on the Look tab, while the
    /// shade still has a centre to move — anything else drops it, so the
    /// stage never takes presses for a panel nobody can see.
    func dropStalePlacing() {
        if placingShade != nil && shadeHandle == nil { placingShade = nil }
    }

    /// The tab changed (a strip, a selection).
    func tabChanged() {
        dropStalePlacing()
        requestRender()
    }

    // MARK: - the deck

    /// A picture after the hook — the Library's ticked one, or an empty slide —
    /// landed on at once, which is where the author is looking.
    func addSlide() {
        guard let post else { return }
        let count = post.slides.count
        let active = library?.active
        Task { [weak self] in
            let ref: SavedMediaRef?
            if let active, let self { ref = await self.storedRef(active) } else { ref = nil }
            guard let self else { return }
            self.updatePost { $0.slides.append(createPostSlide(ref)) }
            self.deck.goTo(count + 1, 0)
        }
    }

    /// Take the open content slide out; the one before it opens.
    func removeSlide() {
        guard let id = slide?.slideId else { return }
        let at = slideIndex
        updatePost { $0.slides.removeAll { $0.id == id } }
        openSlide(max(0, at - 1))
    }

    /// Move content slide `from` to `to` (indices among the content slides);
    /// the slide that moved stays open. The hook and the card are structural.
    func moveSlide(from: Int, to: Int) {
        guard let post, to >= 0, to < post.slides.count, from != to else { return }
        updatePost { $0.slides = moveItem($0.slides, from, to) }
        // Follow the slide that moved: the stage keeps showing what was moved.
        openSlide(to + 1)
    }

    /// Close the deck with the trip's call to action, or end on the last picture.
    func setIncludeCta(_ on: Bool) {
        updatePost { $0.includeCta = on }
    }

    /// The trip's closing card, edited in the trip's own sheet.
    func editClosingCard() {
        tripSheet = "cta"
    }

    // MARK: - the grade's rungs

    /// Which rung the look on the open picture is written on.
    var gradeScope: GradeScope {
        guard let post else { return .trip }
        return gradeScopeOf(post, pictureKey)
    }

    /// The grade the open picture wears: its own, else the piece's, else the trip's.
    var gradeShown: TripGrade {
        guard let trip, let post else { return emptyGrade() }
        return gradeShownBy(trip, post, pictureKey)
    }

    /// How many pictures of the piece carry a look of their own.
    var ownGrades: Int { post.map(countOwnGrades) ?? 0 }

    /// Move the open picture's look onto another rung — down seeds from what
    /// is shown, up drops what is below. The closing card has no picture rung.
    func setGradeScope(_ scope: GradeScope) {
        guard let trip, let post, !(isCta && scope == .slide) else { return }
        let next = moveGradeScope(trip, post, pictureKey, scope)
        setPost(next)
    }

    /// Write the look shown on the open picture, on the rung it is on.
    func writeGrade(_ grade: TripGrade) {
        guard let trip, let post else { return }
        let write = AtelierKit.writeGrade(trip, post, pictureKey, gradeScope, grade)
        if let next = write.post { setPost(next) }
        if let nextTrip = write.trip { changeTrip { $0 = nextTrip } }
    }

    /// What of the open picture's look does not grade on this device, in words.
    var lookMissing: [String] {
        guard let trip, let post, let slide, !isCta else { return [] }
        return looks.missingWords(slide, trip, post)
    }

    // MARK: - the develop

    /// Write the SELECTED cell's own correction; nil is as shot.
    func setDevelop(_ develop: DevelopSettings?) {
        patchCell(cellIndex, CollageCellPatch(develop: .some(develop)))
    }

    /// The sheet's batch verbs beside Done: each writes a COPY now — the open
    /// picture is left to Done, which is what `pictureKey` keeps out of the count.
    var developApplyVerbs: [PieceApplyVerb] {
        guard let trip, let post else { return [] }
        var verbs: [PieceApplyVerb] = []
        let key = pictureKey
        let otherSlides = isCta ? 0 : countPostPictures(post, key)
        let otherPieces = countDayPictures(trip, post)
        if otherSlides > 0 {
            verbs.append(PieceApplyVerb(
                id: "slides",
                label: "Apply to \(otherSlides) other slide\(otherSlides == 1 ? "" : "s")",
                hint: "the other pictures of this piece",
                run: { [weak self] settings in
                    guard let self, let current = self.post else { return }
                    self.setPost(applyDevelopToPost(current, settings, key))
                }
            ))
        }
        if otherPieces > 0 {
            verbs.append(PieceApplyVerb(
                id: "day",
                label: "Apply to \(otherPieces) picture\(otherPieces == 1 ? "" : "s") of this day",
                hint: "the other pieces telling \(formatIsoDate(post.date))",
                run: { [weak self] settings in
                    guard let self, let currentTrip = self.trip, let current = self.post else { return }
                    let next = applyDevelopToDay(currentTrip, current, settings)
                    self.changeTrip { $0 = next }
                }
            ))
        }
        return verbs
    }

    /// Where the develop sheet's Done writes, in words.
    var developFooterHint: String {
        guard let slide else { return "" }
        if collage != nil && cellIndex > 0 {
            return "writes to cell \(cellIndex + 1) of \(isHook ? "the hook" : "slide \(slide.position)")"
        }
        return isHook ? "writes to the hook" : "writes to slide \(slide.position)"
    }

    // MARK: - the opener

    /// The opener as prepared for this piece — once per change of what it
    /// reads, never per frame: the clock reaches it at paint time.
    var hookState: PieceHookState? {
        guard let trip, let post else { return nil }
        if let cached = hookCache, cached.rev == revision, cached.extra == hookInputs { return cached.value }
        let aspect = pieceAspect(post)
        let badge = post.badge
        let content = badgeContent(trip, post, BadgeOptions(
            mode: badge.mode, words: trip.badgeWords, timeAgo: badge.timeAgo, referenceDate: badge.referenceDate,
            showPin: badge.showPin, showExif: badge.showExif, exif: .some(hookExif?.exif), camera: badge.camera,
            cameraNames: trip.cameraNames, overrides: badge.textOverrides
        ))
        let ctx = hookContextFor(trip, post, aspect, content, hookPictures)
        let hook = resolveHook(badge.hook, ctx)
        let block = content.flatMap { badgeBlockExtent($0, badge.layout, aspect) }
        let state = PieceHookState(content: content, ctx: ctx, hook: hook, block: block)
        hookCache = (revision, hookInputs, state)
        return state
    }

    /// The badge's words as they read now — what the Content tab edits.
    var content: BadgeContent? { hookState?.content }

    /// The opener's variant, and its options.
    var hookVariant: HookVariant? { hookVariantById(post?.badge.hook.first?.id ?? "") }
    var hookOptions: HookOptions { post?.badge.hook.first?.options ?? [:] }

    /// Seconds the opener occupies; 0 when nothing plays.
    var openerSeconds: Double { isHook ? (hookState?.hook.seconds ?? 0) : 0 }

    /// Where the opener's drawing sits on a frame of `frame` pixels, when the
    /// variant lets it be pointed at — only on the hook slide.
    func hookRect(_ frame: AtelierKit.Size) -> AtelierKit.Rect? {
        guard isHook, let variant = hookVariant, let frameBox = variant.frameBox, let state = hookState else { return nil }
        return frameBox(hookOptions, state.ctx, frame)
    }

    /// The garage, from the Virée opener's panel (the host's `configureCar`).
    func configureCar() {
        garageOpen = true
    }

    // MARK: - facts

    /// The piece's name, or its placeholder.
    var displayTitle: String {
        let t = post?.title.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return t.isEmpty ? "Untitled piece" : t
    }

    /// `date · kind`, under the name (beside it on a phone).
    var facts: String {
        guard let post else { return "" }
        return "\(formatIsoDate(post.date)) · \(post.kind.rawValue)"
    }

    /// The Library's scope for the piece: its day, or its span — a post is
    /// keyed by its day, so the day IS the query; a slide is waiting for a
    /// picture (`pick`), and the trip around it is shaded in the month.
    var mediaScope: MediaScope? {
        guard let trip, let post else { return nil }
        let to = post.endDate ?? post.date
        let label = post.endDate.map { "\(formatIsoDate(post.date)) → \(formatIsoDate($0))" } ?? formatIsoDate(post.date)
        return MediaScope(from: post.date, to: to, label: label, publisher: "Trips", intent: .pick,
                          within: ScopeWithin(from: trip.startDate, to: trip.endDate, label: trip.name))
    }

    // MARK: - what leaves

    /// What an export reads, gathered as the stage has it: the opener's
    /// pictures, the hook's EXIF, the badge's settled second, and where each
    /// picture of the deck is on this device (the Library's files, by name).
    func exportInputs() -> TripExportInputs? {
        guard let trip, let post, let library else { return nil }
        var table: [String: URL] = [:]
        for slide in deckSlides(trip, post) {
            var refs: [SavedMediaRef] = slide.media.map { [$0] } ?? []
            if let collage = slide.collage {
                let lead = CollageLead(media: slide.media, framing: slide.framing, develop: slide.develop, motion: slide.motion)
                refs = collageMediaRefs(lead, collage)
            }
            for ref in refs {
                if let file = library.poolFile(named: ref), let bytes = url(for: file) {
                    table[ref.name.lowercased()] = bytes
                }
            }
        }
        let found = table
        return TripExportInputs(trip: trip, post: post, pictures: hookPictures, exif: hookExif?.exif,
                                hookSeconds: settleSeconds, resolve: { ref in found[ref.name.lowercased()] },
                                looks: looks)
    }

    /// The piece's ONE primary export — every slide in the format it is —
    /// reported on the Export tab, so that is where the inspector goes.
    func exportPiece(imagesOnly: Bool = false) {
        guard !exports.running, let inputs = exportInputs() else { return }
        tab = .export
        exports.exportPiece(inputs, imagesOnly: imagesOnly)
    }

    /// Every slide as a still, in swipe order.
    func exportDeck() {
        guard !exports.running, let inputs = exportInputs() else { return }
        tab = .export
        exports.exportDeck(inputs)
    }

    /// The hook burned into a clip — the version that PLAYS the entrance.
    func exportHookClip() {
        guard !exports.running, let inputs = exportInputs() else { return }
        tab = .export
        exports.exportHookClip(inputs)
    }
}

// MARK: - watching the store

extension PieceEditorModel {
    /// The document moved — a write from here, an undo, a copy taken from an
    /// instance: the derivations are dropped at once (synchronously, in the
    /// store's own mutation) and the side effects run on the next turn.
    func watchStore() {
        let generation = watchGeneration
        withObservationTracking {
            _ = store.open
        } onChange: { [weak self] in
            MainActor.assumeIsolated {
                guard let self, generation == self.watchGeneration else { return }
                self.revision &+= 1
                Task { @MainActor [weak self] in
                    guard let self, generation == self.watchGeneration, !self.closed else { return }
                    self.watchStore()
                    self.documentMoved()
                }
            }
        }
    }

    /// What follows a document that moved.
    func documentMoved() {
        guard post != nil else { return }
        if selected > slides.count - 1 { openSlide(slides.count - 1) }
        slideMaybeChanged()
        dropStalePlacing()
        keepInPointInside()
        requestRender()
        libraryChanged()
        refreshOpener()
        prepareLooks()
    }
}
