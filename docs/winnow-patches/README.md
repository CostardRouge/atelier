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

**Empty today** — `0001-app-documents-bucket.patch` (the document bucket, phase
P2 of `docs/roadtrip-persistence.md`) landed on Winnow's `main` and was deleted
from here on 2026-09-07, which is exactly what this folder's rule asks for.

| Patch | For | Written against | Verified | Status |
| --- | --- | --- | --- | --- |
| _(none)_ | | | | |
