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
hand-off, not a mirror.

| Patch | For | Written against | Verified | Status |
| --- | --- | --- | --- | --- |
| `0001-app-documents-bucket.patch` | `docs/roadtrip-persistence.md` phase **P2**: migration `0041_app_documents.sql`, `lib/appDocuments.ts`, the `api/apps/[app]/docs` route pair, `/api/apps` as a self-service prefix, `documents: { bucket, kinds, maxBytes }` in capabilities, README + memory | Winnow `43073f3` (2026-09-06, "Add a Timeline view…") | `typecheck` and `next build` green in the authoring container; `migrate` needs Postgres, which it did not have — run it before merging | not landed |
