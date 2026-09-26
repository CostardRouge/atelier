// Spec of `Projects/StudioEditing.swift` — the Studio editor's arithmetic that
// lives inline in the web's components (no `.test.ts` twin), pinned from the
// web's own code paths: `StudioEditor.tsx`, `StudioTool.tsx`,
// `ProjectSettingsModal.tsx`, `ProjectGallery.tsx`, `TrimBar.tsx` and
// `use-video-transport.ts`.

import XCTest
@testable import AtelierKit

private func mediaRef(_ name: String, _ size: Int = 100, _ lastModified: Double = 1000) -> SavedMediaRef {
    SavedMediaRef(name: name, size: size, lastModified: lastModified)
}

private func grid(snap: Bool, cols: Int = 3, rows: Int = 3) -> GridConfig {
    GridConfig(show: false, cols: cols, rows: rows, snap: snap)
}

final class StudioTransportTests: XCTestCase {
    func testClampPlaybackRateHoldsTheRateInsideASixteenthToSixteen() {
        XCTAssertEqual(clampPlaybackRate(2), 2)
        XCTAssertEqual(clampPlaybackRate(40), 16)
        XCTAssertEqual(clampPlaybackRate(0.01), 0.0625)
        XCTAssertEqual(clampPlaybackRate(0), 1)
        XCTAssertEqual(clampPlaybackRate(-3), 1)
        XCTAssertEqual(clampPlaybackRate(.nan), 1)
        XCTAssertEqual(clampPlaybackRate(.infinity), 1)
    }

    func testTheRealtimeRateUndoesTheConform() {
        // A 4× slow motion (0.25 capture s per media s) plays at 4×.
        XCTAssertEqual(realtimePlaybackRate(0.25), 4)
        // A 10× lapse plays at a tenth.
        assertClose(realtimePlaybackRate(10), 0.1, 9)
        XCTAssertEqual(previewRate(.realtime, realtimeRate: 4), 4)
        XCTAssertEqual(previewRate(.rate(0.5), realtimeRate: 4), 0.5)
        XCTAssertEqual(realtimeSpeedLabel(4), "real (4×)")
        XCTAssertEqual(realtimeSpeedLabel(1 / 3), "real (0.33×)")
    }

    func testTheDeliveredSpeedMenuAddsTheRealtimeStepOnlyWhenItIsNew() {
        XCTAssertEqual(deliveredSpeedChoices(1), [0.25, 0.5, 1, 2, 4])
        XCTAssertEqual(deliveredSpeedChoices(4), [0.25, 0.5, 1, 2, 4])
        XCTAssertEqual(deliveredSpeedChoices(8), [0.25, 0.5, 1, 2, 4, 8])
        XCTAssertEqual(deliveredSpeedChoices(1 / 3), [0.25, 0.33, 0.5, 1, 2, 4])
    }

    func testTheWindowPlayheadCountsFromTheInPoint() {
        let range = TrimRange(start: 2, end: 8)
        XCTAssertEqual(windowPlayhead(5, range), 3)
        XCTAssertEqual(windowPlayhead(1, range), 0)
    }

    func testArrowsStepAFrameShiftASecondInsideTheRange() {
        let range = TrimRange(start: 1, end: 5)
        assertClose(steppedPlayhead(2, forward: true, shift: false, step: 1 / 30.0, range: range), 2 + 1 / 30.0, 9)
        XCTAssertEqual(steppedPlayhead(2, forward: false, shift: true, step: 1 / 30.0, range: range), 1)
        // Never out of the range.
        XCTAssertEqual(steppedPlayhead(4.5, forward: true, shift: true, step: 0.1, range: range), 5)
        XCTAssertEqual(steppedPlayhead(1.02, forward: false, shift: false, step: 0.1, range: range), 1)
    }

    func testPlayOnTheOutPointReplaysFromTheInPoint() {
        let range = TrimRange(start: 1, end: 5)
        XCTAssertEqual(playStartTime(5, range), 1)
        XCTAssertEqual(playStartTime(0.5, range), 1)
        XCTAssertNil(playStartTime(3, range))
        XCTAssertNil(playStartTime(3, nil))
    }

    func testTheOutPointStopsOnTheHandleOrLoops() {
        let range = TrimRange(start: 1, end: 5)
        XCTAssertEqual(outPointAction(4, range, loop: false), .keepPlaying)
        XCTAssertEqual(outPointAction(5.01, range, loop: false), .stop(at: 5))
        XCTAssertEqual(outPointAction(5, range, loop: true), .loop(to: 1))
        XCTAssertEqual(outPointAction(9, nil, loop: true), .keepPlaying)
    }

    func testIAndOCutAtThePlayheadShiftReleasesAHandle() {
        let d = 10.0
        let step = 0.1
        XCTAssertEqual(trimKeyRange("i", shift: false, current: nil, at: 3, duration: d, frameStep: step),
                       TrimRange(start: 3, end: 10))
        XCTAssertEqual(trimKeyRange("O", shift: false, current: TrimRange(start: 3, end: 10), at: 7, duration: d,
                                    frameStep: step), TrimRange(start: 3, end: 7))
        XCTAssertEqual(trimKeyRange("i", shift: true, current: TrimRange(start: 3, end: 7), at: 5, duration: d,
                                    frameStep: step), TrimRange(start: 0, end: 7))
        XCTAssertEqual(trimKeyRange("o", shift: true, current: TrimRange(start: 3, end: 7), at: 5, duration: d,
                                    frameStep: step), TrimRange(start: 3, end: 10))
        // The handles never cross: an in point past the out stops a frame short.
        let crossed = trimKeyRange("i", shift: false, current: TrimRange(start: 3, end: 7), at: 9, duration: d,
                                   frameStep: step)
        XCTAssertNotNil(crossed)
        assertClose(crossed?.start ?? 0, 6.9, 9)
        XCTAssertNil(trimKeyRange("x", shift: false, current: nil, at: 3, duration: d, frameStep: step))
        XCTAssertNil(trimKeyRange("i", shift: false, current: nil, at: 3, duration: 0, frameStep: step))
    }

    func testATrimIsWrittenOnlyForATrimmedClip() {
        let saved = writeClipTrim([:], "dji_0001", TrimRange(start: 1, end: 4), 10)
        XCTAssertEqual(saved["dji_0001"], SavedTrim(start: 1, end: 4, duration: 10))
        let cleared = writeClipTrim(saved, "dji_0001", fullRange(10), 10)
        XCTAssertNil(cleared["dji_0001"])
        XCTAssertEqual(writeClipTrim([:], "a", fullRange(10), 10), [:])
    }

    func testTheTrimReadoutIsAlwaysALine() {
        XCTAssertEqual(trimReadout(fullRange(10), 10, learned: false),
                       TrimReadout(trimmed: false, text: "Full clip — drag the handles, or press I / O to cut at the playhead"))
        XCTAssertEqual(trimReadout(fullRange(10), 10, learned: true).text, "Full clip")
        // `formatTimecode` floors the centiseconds, as the web's does.
        XCTAssertEqual(trimReadout(TrimRange(start: 1.25, end: 4), 10, learned: true),
                       TrimReadout(trimmed: true, text: "0:01.25 → 0:04.00 · 2.8s"))
    }
}

final class StudioDeckTests: XCTestCase {
    func testAnAddedElementIsStaggeredDownTheFrame() {
        let el = OverlayPanels.freshElement(.text)
        let placed = studioPlacedElement(el, deckCount: 3)
        assertClose(placed.y, min(0.95, el.y + 0.18), 9)
        // Never more than half a frame, never past 0.95.
        XCTAssertEqual(studioPlacedElement(el, deckCount: 40).y, min(0.95, el.y + 0.5))
    }

    func testAnIntroElementIsComposedWhereItMeansToBeAndBringsItsScene() {
        var intro = OverlayPanels.freshElement(.text)
        intro.sceneId = createIntroScene(end: 3).id
        let deck = [OverlayPanels.freshElement(.text), OverlayPanels.freshElement(.text)]
        let result = studioAddElement(intro, elements: deck, scenes: [])
        XCTAssertEqual(result.added.y, intro.y)
        XCTAssertEqual(result.elements.count, 3)
        XCTAssertEqual(result.scenes.count, 1)
        XCTAssertEqual(result.scenes[0].id, intro.sceneId)
        XCTAssertEqual(result.scenes[0].end, 3)
        // A second intro element joins the scene that is there.
        let again = studioAddElement(intro, elements: result.elements, scenes: result.scenes)
        XCTAssertEqual(again.scenes.count, 1)
    }

    func testRemovingASceneTakesItsMembersWithIt() {
        let scene = createIntroScene(end: 3)
        var member = OverlayPanels.freshElement(.text)
        member.sceneId = scene.id
        let other = OverlayPanels.freshElement(.text)
        let result = studioRemoveScene(scene.id, elements: [member, other], scenes: [scene])
        XCTAssertEqual(result.elements.map(\.id), [other.id])
        XCTAssertTrue(result.scenes.isEmpty)
    }

    func testADragClampsToTheFrameAndSnaps() {
        // Travel of a quarter frame to the right.
        let moved = stageDragPosition(startX: 0.2, startY: 0.3, dxPx: 480, dyPx: 0, width: 1920, height: 1080,
                                      grid: grid(snap: false), bypassSnap: false)
        assertClose(moved.x, 0.45, 9)
        assertClose(moved.y, 0.3, 9)
        // The light snap catches the centre.
        let centred = stageDragPosition(startX: 0.49, startY: 0.3, dxPx: 0, dyPx: 0, width: 1920, height: 1080,
                                        grid: grid(snap: false), bypassSnap: false)
        XCTAssertEqual(centred.x, 0.5)
        // Bypassed, it does not.
        let free = stageDragPosition(startX: 0.49, startY: 0.3, dxPx: 0, dyPx: 0, width: 1920, height: 1080,
                                     grid: grid(snap: false), bypassSnap: true)
        XCTAssertEqual(free.x, 0.49)
        // The grid snaps to its thirds.
        let gridded = stageDragPosition(startX: 0.32, startY: 0.65, dxPx: 0, dyPx: 0, width: 1920, height: 1080,
                                        grid: grid(snap: true), bypassSnap: false)
        assertClose(gridded.x, 1 / 3.0, 9)
        assertClose(gridded.y, 2 / 3.0, 9)
        // Out of the frame, held at its edge.
        let out = stageDragPosition(startX: 0.9, startY: 0.1, dxPx: 1000, dyPx: -1000, width: 1920, height: 1080,
                                    grid: grid(snap: false), bypassSnap: true)
        XCTAssertEqual(out, Point(1, 0))
    }

    func testTheWipeAndTheTap() {
        XCTAssertEqual(wipeSplit(480, width: 1920), 0.25)
        XCTAssertEqual(wipeSplit(-5, width: 1920), 0)
        XCTAssertEqual(wipeSplit(5000, width: 1920), 1)
        XCTAssertTrue(isStageTap(dx: 3, dy: -4))
        XCTAssertFalse(isStageTap(dx: 5, dy: 0))
    }
}

final class StudioMediaTests: XCTestCase {
    func testTheDetailSaysWhatIsOnTheStage() {
        XCTAssertEqual(studioMediaDetail(isPhoto: false, width: 1920, height: 1080, codec: "hvc1", fps: 29.97),
                       "1920×1080 · hvc1 · 29.97 fps")
        XCTAssertEqual(studioMediaDetail(isPhoto: false, width: 3840, height: 2160, codec: "avc1", fps: 30),
                       "3840×2160 · avc1 · 30 fps")
        XCTAssertEqual(studioMediaDetail(isPhoto: true, width: 4000, height: 3000, imageType: "JPEG"), "4000×3000 · JPEG")
        XCTAssertEqual(studioMediaDetail(isPhoto: false, width: nil, height: nil), "")
    }

    func testRenamesAreSaid() {
        XCTAssertNil(renamedMediaNotice(0))
        XCTAssertEqual(renamedMediaNotice(1),
                       "1 media file was renamed since last save — recognised by content and adopted under the new name.")
        XCTAssertEqual(renamedMediaNotice(3),
                       "3 media files were renamed since last save — recognised by content and adopted under the new name.")
    }

    func testMissingIsInformationalAndChangedWorthAttention() {
        XCTAssertNil(mediaTroubleNotice(missing: 0, changed: 0))
        let missing = mediaTroubleNotice(missing: 2, changed: 0)
        XCTAssertEqual(missing?.text,
                       "2 media files not in this folder — the project stays editable. Moved, archived or deleted on purpose? Remove them below so this stops asking.")
        XCTAssertEqual(missing?.needsAttention, false)
        XCTAssertEqual(missing?.offersForget, true)
        let both = mediaTroubleNotice(missing: 1, changed: 1)
        XCTAssertEqual(both?.text,
                       "1 media file not in this folder · 1 changed since last save — the project stays editable. Moved, archived or deleted on purpose? Remove them below so this stops asking.")
        XCTAssertEqual(both?.needsAttention, true)
        let changed = mediaTroubleNotice(missing: 0, changed: 1)
        XCTAssertEqual(changed?.text, "1 changed since last save — the project stays editable.")
        XCTAssertEqual(changed?.offersForget, false)
    }

    func testForgettingTheMissingPrunesByNameAndRecountsLocally() {
        let media = ProjectMedia(files: [mediaRef("kept.mp4"), mediaRef("GONE.mp4"), mediaRef("changed.mp4")],
                                 activeId: "kept", trims: ["gone": SavedTrim(start: 1, end: 2, duration: 5)])
        let rec = reconcileMedia(media.files, [mediaRef("kept.mp4"), mediaRef("changed.mp4", 999)])
        XCTAssertEqual(rec.missing, 1)
        let result = forgetMissingMedia(media, rec)
        XCTAssertEqual(result?.media.files.map(\.name), ["kept.mp4", "changed.mp4"])
        XCTAssertEqual(result?.reconciliation.missing, 0)
        XCTAssertEqual(result?.reconciliation.found, 1)
        XCTAssertEqual(result?.reconciliation.changed, 1)
        XCTAssertEqual(result?.reconciliation.items.count, 2)
        // The trims stay: a same-named file added back keeps its cut.
        XCTAssertEqual(result?.media.trims["gone"], SavedTrim(start: 1, end: 2, duration: 5))
        // Nothing missing: nothing to forget.
        let clean = reconcileMedia([mediaRef("kept.mp4")], [mediaRef("kept.mp4")])
        XCTAssertNil(forgetMissingMedia(ProjectMedia(files: [mediaRef("kept.mp4")]), clean))
    }

    func testTheOutroComposesForTheProjectsFormat() {
        assertClose(studioOutroAspect("9:16", frameAspect: 16 / 9.0), 9 / 16.0, 9)
        assertClose(studioOutroAspect("unknown", frameAspect: 4 / 3.0), 4 / 3.0, 9)
        assertClose(studioOutroAspect("unknown", frameAspect: nil), 9 / 16.0, 9)
    }

    func testTheDevelopBatchVerbNeedsAnotherMedia() {
        XCTAssertNil(developApplyToLabel(0))
        XCTAssertEqual(developApplyToLabel(3), "Apply to 3 other media")
    }

    func testTheSaveBadgeWords() {
        XCTAssertEqual(StudioSaveState.allCases.map(\.label),
                       ["Saved", "Saving…", "Edited", "Storage unavailable — in-memory only"])
        XCTAssertEqual(StudioSaveState.allCases.filter(\.needsAction), [.storageError])
        XCTAssertEqual(StudioTab.allCases.map(\.label), ["Overlay", "Style", "Grade", "Info", "Export"])
    }
}

final class StudioSettingsDraftTests: XCTestCase {
    func testTheCadenceDraftOpensOnTheFactorTheAuthorThinksIn() {
        // Measured 4× slow motion.
        var slow = TimeScaleReading.realtime
        slow.scale = 0.25
        XCTAssertEqual(cadenceDraft(.auto, measured: slow), CadenceDraft(mode: .auto, slower: true, factor: 4))
        // A manual 10× lapse wins over the measurement.
        let lapse = TimeScaleSetting(mode: .manual, scale: 10, clipId: "a")
        XCTAssertEqual(cadenceDraft(lapse, measured: slow), CadenceDraft(mode: .manual, slower: false, factor: 10))
        // Real time is "1× slower".
        XCTAssertEqual(cadenceDraft(nil, measured: .realtime), CadenceDraft(mode: .auto, slower: true, factor: 1))
    }

    func testTheDraftWritesCaptureSecondsPerMediaSecond() {
        XCTAssertEqual(timeScaleFromDraft(CadenceDraft(mode: .auto, slower: true, factor: 4)), .auto)
        XCTAssertEqual(timeScaleFromDraft(CadenceDraft(mode: .manual, slower: true, factor: 4)),
                       TimeScaleSetting(mode: .manual, scale: 0.25))
        XCTAssertEqual(timeScaleFromDraft(CadenceDraft(mode: .manual, slower: false, factor: 10)),
                       TimeScaleSetting(mode: .manual, scale: 10))
        // Held inside 1…600; an unreadable factor is 1.
        XCTAssertEqual(timeScaleFromDraft(CadenceDraft(mode: .manual, slower: false, factor: 5000)).scale, 600)
        XCTAssertEqual(timeScaleFromDraft(CadenceDraft(mode: .manual, slower: false, factor: 0.2)).scale, 1)
        XCTAssertEqual(timeScaleFromDraft(CadenceDraft(mode: .manual, slower: false, factor: .nan)).scale, 1)
    }

    func testTheMeasuredLabel() {
        XCTAssertEqual(measuredCadenceLabel(.realtime), "nothing measurable in this clip — treated as real time")
        var slow = TimeScaleReading.realtime
        slow.scale = 0.25
        slow.basis = .timestamps
        slow.mediaFps = 30
        slow.captureFps = 120
        let expected = [describeTimeScale(0.25) ?? "real time", formatCadence(slow)].compactMap { $0 }
            .joined(separator: " · ")
        XCTAssertEqual(measuredCadenceLabel(slow), expected)
        XCTAssertTrue(measuredCadenceLabel(slow).contains("·"))
    }

    func testTheShiftSplitsIntoASignHoursAndMinutes() {
        XCTAssertTrue(shiftParts(330) == (false, 5, 30))
        XCTAssertTrue(shiftParts(-30) == (true, 0, 30))
        XCTAssertTrue(shiftParts(-765) == (true, 12, 45))
        XCTAssertEqual(shiftMinutes(negative: false, hours: 5, minutes: 30), 330)
        XCTAssertEqual(shiftMinutes(negative: true, hours: 0, minutes: 30), -30)
        XCTAssertEqual(shiftMinutes(negative: true, hours: 12, minutes: 45), -765)
        XCTAssertEqual(shiftMinutes(negative: true, hours: 0, minutes: 0), 0)
    }
}

final class StudioProjectFileWordsTests: XCTestCase {
    private func file(name: String, layers: Int, elements: Int) -> ProjectFile {
        var doc = createProjectDoc(name, "9:16", Array(defaultElementsPreset().prefix(elements)), .default,
                                   now: 0, id: "p")
        doc.lutStack = (0..<layers).map { SavedLutLayer(id: "l\($0)", source: "builtin:x", name: "X") }
        return toProjectFile(doc, exportedAt: 0)
    }

    func testTheImportSummary() {
        XCTAssertEqual(projectImportSummary(file(name: "Vol", layers: 2, elements: 1)),
                       "1 element · 9:16 · 2 LUT layers — the media and the project name stay as they are.")
        XCTAssertEqual(projectImportSummary(file(name: "Vol", layers: 0, elements: 2)),
                       "2 elements · 9:16 — the media and the project name stay as they are.")
        XCTAssertEqual(projectImportQuestion(file(name: "Vol du soir", layers: 0, elements: 1)),
                       "Replace this project's overlays, style, grade and format with “Vol du soir”?")
        XCTAssertEqual(projectImportQuestion(file(name: "", layers: 0, elements: 1)),
                       "Replace this project's overlays, style, grade and format with the imported file?")
    }

    func testAnImportedProjectsName() {
        XCTAssertEqual(importedProjectName(file(name: " Vol ", layers: 0, elements: 0), fileName: "x.atelier.json"), "Vol")
        XCTAssertEqual(importedProjectName(file(name: "", layers: 0, elements: 0), fileName: "vol-du-soir.atelier.json"),
                       "vol-du-soir")
        XCTAssertEqual(importedProjectName(file(name: "", layers: 0, elements: 0), fileName: "Plan.JSON"), "Plan")
        XCTAssertEqual(importedProjectName(file(name: "", layers: 0, elements: 0), fileName: ".json"), "Imported project")
    }
}
