"""The Winnow import against a stub that answers the routes read in Winnow's own code."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import pytest

from atelier_training.cli import main
from atelier_training.config import load_config
from atelier_training.datasets.pairs import scan_pairs
from atelier_training.imaging import RawSupportMissing, save_image
from atelier_training.ingest import ingest
from atelier_training.winnow_import import Slim, WinnowClient, WinnowError, import_pairs, plan_import


def png_bytes(tmp_path, value):
    p = tmp_path / f"{value}.png"
    save_image(np.full((8, 12, 3), value, np.float32), p)
    return p.read_bytes()


class Stub(BaseHTTPRequestHandler):
    assets: dict = {}
    finals: list = []
    seen: list = []
    token = "wnw_secret"
    cookie = "sess123"

    def log_message(self, *a):  # quiet
        pass

    def _authed(self):
        auth = self.headers.get("Authorization", "")
        cookie = self.headers.get("Cookie", "")
        return auth == f"Bearer {self.token}" or f"winnow_session={self.cookie}" in cookie

    @staticmethod
    def _wire(row):
        return {k: v for k, v in row.items() if k != "bytes"} if isinstance(row, dict) else row

    def _json(self, code, body):
        data = json.dumps(body, default=lambda o: None).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/api/auth/login":
            if body.get("username") == "steeve" and body.get("password") == "pw":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Set-Cookie", f"winnow_session={self.cookie}; Path=/; HttpOnly")
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")
            else:
                self._json(401, {"error": "Invalid username or password"})
            return
        self._json(404, {})

    def do_GET(self):
        url = urlparse(self.path)
        self.seen.append(self.path)
        if not self._authed():
            return self._json(401, {"error": "auth"})
        if url.path == "/api/assets":
            q = parse_qs(url.query)
            assert q.get("kind") == ["final"] and q.get("limit") == ["500"]
            cursor = q.get("cursor", [None])[0]
            page = [self._wire(r) for r in (self.finals[:2] if cursor is None else self.finals[2:])]
            more = cursor is None and len(self.finals) > 2
            return self._json(200, {"assets": page, "next_cursor": "c2" if more else None})
        m = url.path.removeprefix("/api/assets/").split("/")
        asset_id = int(m[0])
        if len(m) == 1:
            row = self.assets.get(asset_id)
            return self._json(200, {"asset": self._wire(row)}) if row else self._json(404, {"error": "Asset not found"})
        if m[1] == "download":
            row = self.assets[asset_id]
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(row["bytes"])))
            self.end_headers()
            self.wfile.write(row["bytes"])
            return
        self._json(404, {})


@pytest.fixture
def stub(tmp_path):
    a, b, c = png_bytes(tmp_path, 0.2), png_bytes(tmp_path, 0.6), png_bytes(tmp_path, 0.9)
    Stub.assets = {
        1: {"id": 1, "filename": "DSC01.ARW", "ext": "arw", "media_type": "photo",
            "captured_at": "2026-07-01T10:00:00Z", "content_hash": "h1", "bytes": a},
        # A Sony pair: the HIF is listed, the ARW rides on the row as its companion and is what gets fetched.
        2: {"id": 2, "filename": "DSC02.HIF", "ext": "hif", "media_type": "photo", "group_kind": "raw_jpeg",
            "companion_id": 3, "companion_ext": "arw", "companion_filename": "DSC02.ARW",
            "captured_at": "2026-08-01T10:00:00Z", "content_hash": "h2", "bytes": b"heif"},
        3: {"id": 3, "filename": "DSC02.ARW", "ext": "arw", "media_type": "photo", "group_role": "companion",
            "captured_at": "2026-08-01T10:00:00Z", "content_hash": "h3", "bytes": a},
        10: {"id": 10, "filename": "DSC01.jpg", "ext": "jpg", "media_type": "photo", "original_asset_id": 1,
             "captured_at": "2026-07-01T10:00:00Z", "content_hash": "h10", "bytes": b},
        11: {"id": 11, "filename": "DSC01-bw.jpg", "ext": "jpg", "media_type": "photo", "original_asset_id": 1,
             "captured_at": "2026-07-01T10:00:00Z", "content_hash": "h11", "bytes": c},
        12: {"id": 12, "filename": "DSC02.jpg", "ext": "jpg", "media_type": "photo", "original_asset_id": 2,
             "captured_at": "2026-08-01T10:00:00Z", "content_hash": "h12", "bytes": b},
        13: {"id": 13, "filename": "clip.mp4", "ext": "mp4", "media_type": "video", "original_asset_id": 2,
             "captured_at": "2026-08-01T10:00:00Z", "bytes": b},
        14: {"id": 14, "filename": "orphan.jpg", "ext": "jpg", "media_type": "photo", "original_asset_id": None,
             "bytes": b},
        15: {"id": 15, "filename": "gone.jpg", "ext": "jpg", "media_type": "photo", "original_asset_id": 99,
             "bytes": b},
    }
    Stub.finals = [Stub.assets[i] for i in (10, 11, 12, 13, 14, 15)]
    Stub.seen = []
    server = HTTPServer(("127.0.0.1", 0), Stub)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def test_plan_groups_finals_by_original_and_skips_what_it_cannot_learn(stub):
    client = WinnowClient(stub, token="wnw_secret")
    plan = plan_import(client, log=lambda s: None)
    assert sorted(plan.groups) == [1, 2]
    assert [f["id"] for f in plan.groups[1]["finals"]] == [10, 11]
    assert {sid for sid, _ in plan.skipped} == {13, 99}
    assert plan.pair_count == 3
    assert plan_import(client, since="2026-07-15", log=lambda s: None).pair_count == 1


def test_import_writes_groups_the_validator_reads_and_is_idempotent(stub, tmp_path):
    client = WinnowClient(stub, token="wnw_secret")
    out = tmp_path / "pairs"
    plan = plan_import(client, log=lambda s: None)
    counts = import_pairs(client, out, plan, log=lambda s: None)
    assert counts == {"groups": 2, "fetched": 5, "kept": 0, "prepared": 0, "freed": 0}
    scan = scan_pairs(out, check_sizes=False)  # the stub's ARW is PNG bytes: no size check
    assert scan.issues == [] and scan.pair_count == 3
    g1 = out / "winnow-1"
    for name in ("DSC01.ARW", "finals/DSC01.jpg", "finals/DSC01-bw.jpg"):
        assert (g1 / name).is_file(), name
    meta = json.loads((g1 / "winnow.json").read_text())
    assert meta["original"]["content_hash"] == "h1" and [f["id"] for f in meta["finals"]] == [10, 11]
    assert "winnow #10" in (g1 / "manifest.toml").read_text()
    assert not list(out.rglob("*.part"))
    g2 = out / "winnow-2"
    assert (g2 / "DSC02.ARW").read_bytes() == Stub.assets[3]["bytes"] and not (g2 / "DSC02.HIF").exists()
    assert json.loads((g2 / "winnow.json").read_text())["original"] == {
        "id": 3, "linked_id": 2, "filename": "DSC02.ARW", "content_hash": "h3", "captured_at": "2026-08-01T10:00:00Z"}

    again = import_pairs(client, out, plan_import(client, log=lambda s: None), log=lambda s: None)
    assert again == {"groups": 2, "fetched": 0, "kept": 5, "prepared": 0, "freed": 0}


def test_cookie_login_and_refused_credentials(stub):
    client = WinnowClient(stub)
    with pytest.raises(WinnowError, match="refused"):
        plan_import(client, log=lambda s: None)
    with pytest.raises(WinnowError, match="refused"):
        client.login("steeve", "wrong")
    client.login("steeve", "pw")
    assert client.cookie == "sess123"
    assert plan_import(client, log=lambda s: None).pair_count == 3
    with pytest.raises(WinnowError, match="http"):
        WinnowClient("winnow.example")


def test_cli_dry_run_and_token_file(stub, workspace, capsys, monkeypatch):
    monkeypatch.delenv("WINNOW_TOKEN", raising=False)  # a standing token on this machine must not leak into the test
    token_file = workspace / "secret.token"
    token_file.write_text("wnw_secret\n")
    assert main(["winnow-import", "--host", stub, "--token-file", str(token_file), "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "winnow-1: DSC01.ARW + 2 final(s)" in out and "nothing written" in out
    assert not (load_config().paths.pairs).exists()

    monkeypatch.setenv("WINNOW_TOKEN", "wnw_secret")
    assert main(["winnow-import", "--host", stub, "--limit", "1"]) == 0
    assert scan_pairs(load_config().paths.pairs, check_sizes=False).pair_count == 1
    assert main(["winnow-import", "--host", stub, "--token", "bad"]) == 1
    assert "refused" in capsys.readouterr().out


def _downloads():
    return [p for p in Stub.seen if p.endswith("/download")]


def test_slim_prepares_each_group_then_deletes_its_files_and_ingest_reuses_it(stub, workspace, monkeypatch, capsys):
    monkeypatch.setenv("WINNOW_TOKEN", "wnw_secret")
    # The fixture's ARW is PNG bytes under a RAW name: a decodable original for the one group taken here.
    Stub.assets[1] = {**Stub.assets[1], "filename": "DSC01.png", "ext": "png"}
    config = load_config()
    g1 = config.paths.pairs / "winnow-1"

    # A group fetched whole first, then slimmed in passing: nothing fetched again, its files deleted.
    assert main(["winnow-import", "--host", stub, "--limit", "2"]) == 0
    assert (g1 / "DSC01.png").is_file()
    Stub.seen = []
    assert main(["winnow-import", "--host", stub, "--limit", "2", "--slim"]) == 0
    assert _downloads() == []
    assert "2 pair(s) prepared" in capsys.readouterr().out
    assert sorted(p.name for p in g1.iterdir()) == ["manifest.toml", "winnow.json"]
    block = json.loads((g1 / "winnow.json").read_text())["slim"]
    assert block["finals"] == [10, 11] and block["prepared"] == ["finals/DSC01", "finals/DSC01-bw"]
    assert block["skipped"] == {} and block["freed_bytes"] > 0
    for stem in block["prepared"]:
        assert (config.paths.cache / "pairs" / "winnow-1" / stem / "input.npy").is_file()

    # The validator and ingest read a slim group from its manifest and its cache alone.
    scan = scan_pairs(config.paths.pairs)
    assert scan.issues == [] and scan.pair_count == 2
    report = ingest(config, sources=["pairs"], force=True)
    assert (report.reused, report.written, report.skipped) == (2, 0, [])
    assert len(report.entries) == 2

    # Run again: a slim group whose cache is intact is not fetched.
    Stub.seen = []
    assert main(["winnow-import", "--host", stub, "--limit", "2", "--slim"]) == 0
    assert _downloads() == []

    # Its cache gone: ingest says how to get it back, and the import fetches it again.
    import shutil
    shutil.rmtree(config.paths.cache / "pairs" / "winnow-1")
    report = ingest(config, sources=["pairs"])
    assert len(report.skipped) == 2 and "winnow-import --slim" in report.skipped[0][1]
    assert main(["winnow-import", "--host", stub, "--limit", "2", "--slim"]) == 0
    assert len(_downloads()) == 3
    assert ingest(config, sources=["pairs"]).reused == 2


def test_slim_pairs_slims_the_groups_already_prepared_offline(stub, workspace, monkeypatch, capsys):
    monkeypatch.setenv("WINNOW_TOKEN", "wnw_secret")
    Stub.assets[1] = {**Stub.assets[1], "filename": "DSC01.png", "ext": "png"}
    config = load_config()
    assert main(["winnow-import", "--host", stub, "--limit", "2"]) == 0
    g1 = config.paths.pairs / "winnow-1"
    ingest(config, sources=["pairs"], workers=1)
    prepared = [p for p in (config.paths.cache / "pairs" / "winnow-1").rglob("input.npy")]
    assert len(prepared) == 2
    capsys.readouterr()

    assert main(["slim-pairs", "--dry-run"]) == 0  # says, deletes nothing
    assert "would free" in capsys.readouterr().out and (g1 / "DSC01.png").is_file()

    Stub.seen = []
    assert main(["slim-pairs"]) == 0
    assert _downloads() == []  # offline: nothing asked of the instance
    assert sorted(p.name for p in g1.iterdir()) == ["manifest.toml", "winnow.json"]
    block = json.loads((g1 / "winnow.json").read_text())["slim"]
    assert block["finals"] == [10, 11] and block["prepared"] == ["finals/DSC01", "finals/DSC01-bw"]
    assert block["freed_bytes"] > 0
    # A whole ingest of the pairs still serves both pairs, from the cache alone.
    report = ingest(config, sources=["pairs"], workers=1)
    assert (report.reused, report.written, report.skipped) == (2, 0, [])
    assert main(["slim-pairs"]) == 0
    assert "1 already slim" in capsys.readouterr().out.splitlines()[-1]


def test_slim_pairs_keeps_a_group_whose_edit_is_not_in_the_cache(stub, workspace, monkeypatch, capsys):
    monkeypatch.setenv("WINNOW_TOKEN", "wnw_secret")
    Stub.assets[1] = {**Stub.assets[1], "filename": "DSC01.png", "ext": "png"}
    config = load_config()
    assert main(["winnow-import", "--host", stub, "--limit", "2"]) == 0
    ingest(config, sources=["pairs"], workers=1)
    import shutil
    shutil.rmtree(config.paths.cache / "pairs" / "winnow-1" / "finals" / "DSC01-bw")
    assert main(["slim-pairs"]) == 0
    assert "kept, 1 edit(s) not in the cache" in capsys.readouterr().out
    assert (config.paths.pairs / "winnow-1" / "DSC01.png").is_file()
    assert "slim" not in json.loads((config.paths.pairs / "winnow-1" / "winnow.json").read_text())


def test_slim_keeps_the_files_when_no_decoder_could_read_them(stub, tmp_path):
    client = WinnowClient(stub, token="wnw_secret")
    out = tmp_path / "pairs"

    def no_raw(folder):
        raise RawSupportMissing(folder / "DSC01.ARW")

    with pytest.raises(RawSupportMissing):
        import_pairs(client, out, plan_import(client, limit=2, log=lambda s: None), log=lambda s: None,
                     slim=Slim(prepare=no_raw, ready=lambda folder, block: True))
    assert (out / "winnow-1" / "DSC01.ARW").is_file()
    assert "slim" not in json.loads((out / "winnow-1" / "winnow.json").read_text())
