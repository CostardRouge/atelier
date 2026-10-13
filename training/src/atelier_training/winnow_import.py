"""``atelier-train winnow-import``: his original → final pairs, read from his own Winnow.

Winnow (CostardRouge/winnow) links a finished export in its Gallery back to
the original it was edited from — ``assets.original_asset_id``, written by
``src/lib/reconcile.ts`` — which is exactly the pair this trainer learns from.
Everything here was READ in Winnow's own code, never guessed (the timeline
import of 2026-09 was once written against a guess and broke on every key):

- ``GET /api/assets?kind=final&limit=N&cursor=…`` → ``{assets, next_cursor}``
  (``src/app/api/assets/route.ts``; ``kind`` takes ``incoming`` or ``final``,
  ``limit`` is capped at 500, the cursor is opaque). Every row is ``a.*`` plus
  ``original_asset_id`` / ``original_filename`` (``src/lib/assetQuery.ts``).
- ``GET /api/assets/:id`` → ``{asset}``; ``GET /api/assets/:id/download``
  streams the indexed original file as an attachment
  (``src/app/api/assets/[id]/download/route.ts``).
- Credentials: a session cookie ``winnow_session`` from
  ``POST /api/auth/login {username, password}`` (``src/app/api/auth/login``),
  or an app token ``Authorization: Bearer wnw_…`` minted in Winnow's account
  page (``src/lib/auth.ts``, migration 0045).

READ-ONLY and LOCAL: GET requests only (and the login POST), the files land in
``data/pairs/winnow-<original id>/`` with a ``manifest.toml`` the validator
already reads, a run is idempotent (a file already there is not fetched
again), and no credential is ever written under the repository — a token
comes from ``$WINNOW_TOKEN`` or a file outside it, a password from the
terminal prompt, and the cookie lives in memory for the run.

SLIM (``--slim``): an original is 40–75 MB and the trainer reads only the
512 px cache, so each group is fetched, prepared into the cache
(``ingest.prepare_group``) and its files DELETED before the next one, leaving
the manifest and a ``slim`` block in ``winnow.json`` — the disk holds one
group's files at a time. A group already on disk is slimmed in passing; a
slim group whose cache is still there is not fetched again.
"""

from __future__ import annotations

import json
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .datasets.pairs import MANIFEST, manifest_text, slim_block
from .imaging import RAW_EXTS, is_picture

PAGE = 500  # Winnow's PAGE_MAX
USER_AGENT = "atelier-training/0.1 (winnow-import)"


class WinnowError(RuntimeError):
    pass


@dataclass
class WinnowClient:
    """The few reads the import needs, over urllib so the core has no HTTP dependency."""

    base_url: str
    token: str | None = None
    cookie: str | None = None
    opener: Callable[[urllib.request.Request], Any] = urllib.request.urlopen
    timeout: float = 60.0

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        if not re.match(r"^https?://", self.base_url):
            raise WinnowError(f"the host must start with http:// or https:// (got {self.base_url!r})")

    def _request(
        self, path: str, params: dict[str, Any] | None = None, body: dict | None = None
    ) -> urllib.request.Request:
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method="POST" if body is not None else "GET")
        req.add_header("User-Agent", USER_AGENT)
        req.add_header("Accept", "application/json, */*")
        if body is not None:
            req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        if self.cookie:
            req.add_header("Cookie", f"winnow_session={self.cookie}")
        return req

    def _open(self, req: urllib.request.Request):
        try:
            return self.opener(req, timeout=self.timeout) if self.opener is urllib.request.urlopen else self.opener(req)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise WinnowError("Winnow refused the credentials (401/403): a token that expired, or a cookie "
                                  "from another instance.") from e
            if e.code == 404:
                raise WinnowError(f"not found on the instance: {req.full_url}") from e
            raise WinnowError(f"Winnow answered {e.code} on {req.full_url}") from e
        except urllib.error.URLError as e:
            raise WinnowError(f"cannot reach {self.base_url}: {e.reason}") from e

    def json(self, path: str, params: dict[str, Any] | None = None, body: dict | None = None) -> Any:
        with self._open(self._request(path, params, body)) as res:
            return json.loads(res.read().decode("utf-8"))

    def login(self, username: str, password: str) -> None:
        """``POST /api/auth/login`` → the session cookie, kept in memory for this run only."""
        req = self._request("/api/auth/login", body={"username": username, "password": password})
        with self._open(req) as res:
            for header in res.headers.get_all("Set-Cookie") or []:
                m = re.match(r"winnow_session=([^;]+)", header)
                if m:
                    self.cookie = m.group(1)
                    return
        raise WinnowError("the login answered without a winnow_session cookie.")

    def finals(self) -> Iterator[dict[str, Any]]:
        """Every row of the Gallery half, page after page."""
        cursor: str | None = None
        while True:
            page = self.json("/api/assets", {"kind": "final", "limit": PAGE, "cursor": cursor})
            yield from page.get("assets", [])
            cursor = page.get("next_cursor")
            if not cursor:
                return

    def asset(self, asset_id: int) -> dict[str, Any] | None:
        try:
            return self.json(f"/api/assets/{asset_id}").get("asset")
        except WinnowError as e:
            if "not found" in str(e):
                return None
            raise

    def download(self, asset_id: int, dest: Path) -> Path:
        """``/download`` streamed to ``dest`` through a temporary name, so a cut transfer leaves no half file."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        with self._open(self._request(f"/api/assets/{asset_id}/download")) as res, tmp.open("wb") as f:
            shutil.copyfileobj(res, f, length=1 << 20)
        tmp.replace(dest)
        return dest


@dataclass
class ImportPlan:
    groups: dict[int, dict[str, Any]] = field(default_factory=dict)  # original id → {original, finals}
    skipped: list[tuple[int, str]] = field(default_factory=list)

    @property
    def pair_count(self) -> int:
        return sum(len(g["finals"]) for g in self.groups.values())


def _safe_name(filename: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", filename).strip() or "file"
    return name


def _is_picture_row(row: dict[str, Any]) -> bool:
    return row.get("media_type") == "photo" and is_picture(Path(f"x.{str(row.get('ext') or '').lstrip('.')}"))


def _prefer_raw_companion(row: dict[str, Any]) -> dict[str, Any]:
    """A paired capture (`group_kind: raw_jpeg`, Winnow's `lib/pairing.ts`) is listed by its delivered half
    — a Sony `.HIF` beside its `.ARW` — and the companion's id, name and extension ride on the row. The
    RAW is the richer original to learn from, so it stands in for the HEIF when it is there."""
    ext = "." + str(row.get("companion_ext") or "").lstrip(".").lower()
    if row.get("companion_id") and ext in RAW_EXTS and row.get("group_kind") in (None, "raw_jpeg"):
        return {**row, "id": int(row["companion_id"]), "filename": row.get("companion_filename") or f"{row['id']}{ext}",
                "ext": ext.lstrip("."), "stood_in_for": row["id"]}
    return row


def _resolve_original(client: WinnowClient, oid: int) -> dict[str, Any] | None:
    """The original's row — or its RAW companion's own row when the capture is a pair."""
    fetched = client.asset(oid)
    if not fetched:
        return None
    stand_in = _prefer_raw_companion(fetched)
    if stand_in is not fetched:  # the companion's own row carries its hash and name
        fetched = client.asset(int(stand_in["id"])) or stand_in
        fetched.setdefault("stood_in_for", stand_in["stood_in_for"])
    return fetched


def plan_import(client: WinnowClient, since: str | None = None, limit: int = 0,
                log: Callable[[str], None] = print, workers: int = 8) -> ImportPlan:
    """Group the Gallery's finals by the original they link to, then fetch each original's row once —
    ``workers`` at a time, since a gallery of thousands is thousands of small GETs."""
    plan = ImportPlan()
    by_original: dict[int, list[dict[str, Any]]] = {}
    for row in client.finals():
        oid = row.get("original_asset_id")
        if not oid:
            continue  # a final nobody reconciled: no pair to learn from
        if since and (row.get("captured_at") or "") < since and (row.get("capture_date") or "") < since:
            continue
        if not _is_picture_row(row):
            plan.skipped.append((int(row["id"]), f"{row.get('filename')}: not a still picture this tool reads"))
            continue
        by_original.setdefault(int(oid), []).append(row)
    log(f"{sum(len(v) for v in by_original.values())} final(s) linked to {len(by_original)} original(s) "
        f"on the instance; reading the originals…")

    ids = sorted(by_original)
    originals: dict[int, dict[str, Any] | None] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for n, (oid, original) in enumerate(zip(ids, pool.map(lambda i: _resolve_original(client, i), ids),
                                                strict=True), 1):
            originals[oid] = original
            if n % 200 == 0:
                log(f"  {n}/{len(ids)} originals read")

    for oid in ids:
        original = originals[oid]
        if original is None:
            plan.skipped.append((oid, "the original is gone from the instance"))
            continue
        if not _is_picture_row(original):
            plan.skipped.append((oid, f"{original.get('filename')}: the original is not a still"))
            continue
        finals = by_original[oid]
        if limit:
            finals = finals[: max(0, limit - plan.pair_count)]
            if not finals:
                break
        plan.groups[oid] = {"original": original, "finals": finals}
    log(f"{len(plan.groups)} original(s) with {plan.pair_count} linked final(s) usable"
        + (f", {len(plan.skipped)} row(s) skipped" if plan.skipped else ""))
    return plan


@dataclass
class Slim:
    """What ``--slim`` needs from the trainer, injected so this module never decodes a picture:
    ``prepare(folder)`` → ``{"prepared": [stem…], "skipped": {stem: reason}}``, and
    ``ready(folder, block)`` — whether a slim group's prepared pairs are all still cached."""

    prepare: Callable[[Path], dict[str, Any]]
    ready: Callable[[Path, dict[str, Any]], bool]


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _gigabytes(n: int) -> str:
    return f"{n / 1e9:.1f} GB"


def import_pairs(client: WinnowClient, out: Path, plan: ImportPlan, dry_run: bool = False,
                 log: Callable[[str], None] = print, slim: Slim | None = None) -> dict[str, int]:
    """Write one group folder per original: the files (fetched once) and the manifest. With ``slim``,
    each group is prepared into the cache and its files deleted before the next one is fetched."""
    counts = {"groups": 0, "fetched": 0, "kept": 0, "prepared": 0, "freed": 0}
    for oid, group in sorted(plan.groups.items()):
        original, finals = group["original"], group["finals"]
        folder = out / f"winnow-{oid}"
        original_name = _safe_name(str(original["filename"]))
        edits: list[tuple[str, str | None]] = []
        wanted: list[tuple[int, Path]] = [(int(original["id"]), folder / original_name)]
        for final in finals:
            name = _safe_name(str(final["filename"]))
            if name == original_name:
                name = f"final-{final['id']}-{name}"
            edits.append((f"finals/{name}", f"winnow #{final['id']}"))
            wanted.append((int(final["id"]), folder / "finals" / name))
        if dry_run:
            log(f"  {folder.name}: {original_name} + {len(finals)} final(s)")
            continue
        block = slim_block(folder) if slim else None
        if slim and block and {int(f["id"]) for f in finals} <= set(block.get("finals", [])) \
                and slim.ready(folder, block):
            counts["kept"] += len(wanted)
            counts["groups"] += 1
            continue  # prepared on an earlier run, its cache intact: nothing to fetch
        for asset_id, dest in wanted:
            if dest.is_file() and dest.stat().st_size > 0:
                counts["kept"] += 1
                continue
            client.download(asset_id, dest)
            counts["fetched"] += 1
        folder.mkdir(parents=True, exist_ok=True)
        title = original.get("captured_at") or original.get("capture_date") or None
        (folder / MANIFEST).write_text(manifest_text(original_name, edits, title=title), encoding="utf-8")
        meta: dict[str, Any] = {
            "host": client.base_url,
            "original": {"id": int(original["id"]), "linked_id": oid, "filename": original.get("filename"),
                         "content_hash": original.get("content_hash"), "captured_at": original.get("captured_at")},
            "finals": [{"id": f["id"], "filename": f.get("filename"), "content_hash": f.get("content_hash")}
                       for f in finals],
        }
        (folder / "winnow.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        counts["groups"] += 1
        if slim is None:
            log(f"  {folder.name}: {original_name} + {len(finals)} final(s)")
            continue
        # The slim block is written only once its pairs are in the cache, and the files deleted only after.
        result = slim.prepare(folder)
        freed = 0
        for dest in [d for _, d in wanted] + list(folder.rglob("*.part")):  # a cut transfer's leftover too
            freed += _size(dest)
            dest.unlink(missing_ok=True)
        if (folder / "finals").is_dir() and not any((folder / "finals").iterdir()):
            (folder / "finals").rmdir()
        meta["slim"] = {"finals": [int(f["id"]) for f in finals], "prepared": result["prepared"],
                        "skipped": result["skipped"], "freed_bytes": freed}
        (folder / "winnow.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        counts["prepared"] += len(result["prepared"])
        counts["freed"] += freed
        skipped = f", {len(result['skipped'])} skipped" if result["skipped"] else ""
        log(f"  {folder.name}: {len(result['prepared'])} pair(s) prepared{skipped}, {_gigabytes(freed)} freed")
    return counts


def read_token(token: str | None, token_file: Path | None) -> str | None:
    if token:
        return token.strip()
    if token_file:
        if not token_file.is_file():
            raise WinnowError(f"no token file at {token_file}")
        return token_file.read_text(encoding="utf-8").strip() or None
    return None
