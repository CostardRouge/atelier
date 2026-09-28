// The open project and the shell's LIBRARY — the web's `useActiveAsset
// (STUDIO_KINDS)` in `StudioEditor.tsx`, for an app whose project keeps a
// working set of its own:
//
// - what the person PUTS TO WORK in the Library while the editor is on screen
//   (a row, a tile, `Use in Studio`, a pick in the instance tab — the Library's
//   `activations`) joins the project and opens on the stage, every file of its
//   capture handed over by what its location IS (`StudioLibrary.adopt`); an
//   echo of the Library settling its own active asset is nothing;
// - a picture DRAGGED out of the Library onto the stage does the same — an
//   instance's tile fetched first;
// - the other way, the media the Studio opens is the Library's active one
//   whenever the Library's selection holds it, so its row wears the ring;
// - the open media's capture DAY is published to the Library, which then
//   lists what the connected instance holds for it (a native addition: the
//   web's Studio publishes none, and its instance tab asks for a day by hand).
//   The day is measured or absent (`studioCaptureDay`).
//
// An instance's file keeps its identity on the way: the Library registered it
// with the ORIGINAL's hash and origin (`registerMediaIdentity`), so the
// project names it by content, the Grade tab's develop is guarded by the
// original's hash, and the Export tab's capture fetch, a still's original
// fetch and the finals sent home find where the capture is.

import Foundation
import AtelierKit

extension StudioEditor {
    /// A Library asset put to work: every file of its capture joins the
    /// project, then it opens on the stage. Nothing for an asset the Studio
    /// cannot edit (a lone `.srt`).
    func take(_ asset: Asset, from pool: LibraryStore) {
        guard assetUsableBy(studioKinds, asset) else { return }
        let files = assetFiles(asset.parts).compactMap { pool.entry(for: $0) }
        guard !files.isEmpty else { return }
        library.adopt(files)
        guard clips.contains(where: { $0.id == asset.id }) else { return }
        setActive(asset.id)
    }

    /// A drag out of the Library landed on the stage: resolved — fetched first
    /// when an instance still holds it — then taken.
    func takeDragged(_ item: AssetDragItem, from pool: LibraryStore) {
        Task { @MainActor [weak self] in
            guard let dropped = await item.resolve() else {
                let from = item.sourceLabel.map { " from \($0)" } ?? ""
                self?.library.notice = "\(item.label) could not be brought\(from)."
                return
            }
            guard let self, let asset = pool.asset(dropped.assetId) else { return }
            self.take(asset, from: pool)
        }
    }

    /// The day the open media was captured — its log's first timestamp, a
    /// still's EXIF (the instance's record merged under it), else the capture
    /// instant an instance dated its file with. Nil when nothing measured says.
    var captureDay: IsoDate? {
        guard active != nil else { return nil }
        let logged: Cue? = isPhoto ? nil : rawCues.first(where: { $0.timestamp != nil })
        let exifDate: String? = isPhoto ? photoExif?.dateTimeOriginal : nil
        let vouched: Double? = activeFile.flatMap { file in mediaOrigin(file) != nil ? file.lastModified : nil }
        let stamp: String? = logged?.timestamp
        return studioCaptureDay(logTimestamp: stamp, exifDateTime: exifDate, vouchedStamp: vouched)
    }

    /// What the Studio tells the Library it is on: the open media's day.
    var mediaScope: MediaScope? {
        studioMediaScope(captureDay)
    }
}
