# Patches for the Winnow repository

Changes that belong in `CostardRouge/winnow` but were authored from an Atelier
session that could read that repository and not push to it. Each file is a
`git format-patch` of one commit, written against the Winnow `main` of the day
and verified there as far as the authoring container allowed.

Apply from a Winnow checkout:

```bash
git am /path/to/atelier/docs/winnow-patches/0001-app-documents-bucket.patch
npm run typecheck && npm run migrate && npm run build
```

Delete a patch here once it has landed on Winnow's `main` — this folder is a
hand-off, not a mirror. A patch applied on a local branch has NOT landed: the
maintainer merges and pushes, agents never do.

| Patch | For | Written against | Verified | Status |
| --- | --- | --- | --- | --- |
| `0001-app-documents-bucket.patch` | `docs/roadtrip-persistence.md` phase **P2**: migration `0041_app_documents.sql`, `lib/appDocuments.ts`, the `api/apps/[app]/docs` route pair, `/api/apps` as a self-service prefix, `documents: { bucket, kinds, maxBytes }` in capabilities, README + memory | Winnow `43073f3` (2026-09-06, "Add a Timeline view…") | **Applied and verified 2026-09-07** on Winnow's `claude/app-documents-bucket` branch: `git am` clean on `43073f3`, the stack's own `migrate` service applies 0041 and records it, and the routes answer 201/304/412/404/415/413/204 with rows scoped by owner (a foreign row 404s on GET and on PUT). Then exercised end to end from Atelier — create, conflict, keep mine, gone. | applied on a local branch, **not merged, not pushed** |
