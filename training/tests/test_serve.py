"""The dashboard's API over fake run folders, and a real subprocess action (doctor)."""

import json
import time

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from atelier_training.config import load_config  # noqa: E402
from atelier_training.serve import ALLOWED_FLAGS, create_app  # noqa: E402


def fake_run(runs, name, epochs=3, with_eval=True):
    folder = runs / name
    (folder / "eval" / "grids").mkdir(parents=True)
    (folder / "config.toml").write_text(
        '[train]\nepochs = 10\nsources = ["synthetic"]\n[model]\nlut_size = 9\n[device]\nprefer = "cpu"\n',
        encoding="utf-8",
    )
    lines = [{"epoch": e, "fit": 0.01 / e, "loss": 0.01 / e, "val_psnr": 20.0 + e, "val_de2000_mean": 5.0 - e}
             for e in range(1, epochs + 1)]
    (folder / "metrics.jsonl").write_text("".join(json.dumps(m) + "\n" for m in lines), encoding="utf-8")
    (folder / "best.pt").write_bytes(b"")
    (folder / "style.cube").write_text("TITLE \"x\"\nLUT_3D_SIZE 2\n" + "0 0 0\n" * 8, encoding="utf-8")
    if with_eval:
        (folder / "eval" / "validation.json").write_text(json.dumps({
            "split": "validation", "psnr": 30.0, "de2000_mean": 1.5, "de2000_p95": 3.0,
            "de76_mean": 2.0, "de76_p95": 4.0,
            "grids": ["synthetic/a0001-C"], "pairs": [{"id": "synthetic/a0001-C", "psnr": 30.0, "de2000_mean": 1.5}],
        }), encoding="utf-8")
        (folder / "eval" / "grids" / "synthetic__a0001-C.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    return folder


@pytest.fixture
def client(synthetic):
    config = load_config()
    fake_run(config.paths.runs, "20260101-000000-alpha")
    fake_run(config.paths.runs, "20260102-000000-beta", epochs=2, with_eval=False)
    return TestClient(create_app(config)), config


def test_status_runs_and_files(client):
    c, config = client
    assert c.get("/").status_code == 200 and "Atelier training" in c.get("/").text
    status = c.get("/api/status").json()
    assert status["pairs"] == 0 and any(ch["name"] == "Synthetic set" for ch in status["checks"])

    runs = c.get("/api/runs").json()
    assert [r["name"] for r in runs] == ["20260102-000000-beta", "20260101-000000-alpha"]
    alpha = runs[1]
    assert alpha["best"]["val_psnr"] == 23.0 and alpha["cubes"] == ["style.cube"] and alpha["evals"] == ["validation"]

    detail = c.get("/api/runs/20260101-000000-alpha").json()
    assert len(detail["metrics"]) == 3 and detail["evals"]["validation"]["grids"] == ["synthetic/a0001-C"]
    assert c.get("/api/runs/20260101-000000-alpha/grids/synthetic__a0001-C.jpg").status_code == 200
    assert c.get("/api/runs/20260101-000000-alpha/cube/style.cube").text.startswith('TITLE "x"')
    assert c.get("/api/runs/nope").status_code == 404
    assert c.get("/api/runs/20260101-000000-alpha/grids/..%2F..%2Fconfig.toml").status_code == 404


def test_pairs_listing_after_an_ingest(client):
    from atelier_training.ingest import ingest

    c, config = client
    ingest(config, sources=["synthetic"], workers=1)
    pairs = c.get("/api/pairs?limit=5").json()
    assert len(pairs) == 5 and pairs[0]["source"] == "synthetic"
    assert c.get(f"/api/pairs/preview?folder={pairs[0]['folder']}").status_code == 200
    assert c.get("/api/pairs/preview?folder=../../configs").status_code == 404
    assert c.get("/api/status").json()["pairs"] == 9


def test_an_action_runs_as_a_subprocess_and_streams(client):
    c, config = client
    job = c.post("/api/jobs", json={"action": "doctor", "args": []}).json()
    assert job["running"] is True
    for _ in range(200):
        detail = c.get(f"/api/jobs/{job['id']}").json()
        if not detail["running"]:
            break
        time.sleep(0.1)
    assert detail["running"] is False and detail["returncode"] == 0
    assert any("Synthetic set" in line for line in detail["log"])
    assert (config.paths.runs / "dashboard" / f"{job['id']}.log").is_file()
    with c.stream("GET", f"/api/jobs/{job['id']}/stream") as r:
        body = "".join(r.iter_text())
    assert "event: done" in body and "data: 0" in body


def test_bad_actions_are_refused(client):
    c, _ = client
    assert c.post("/api/jobs", json={"action": "rm", "args": []}).status_code == 409
    assert c.post("/api/jobs", json={"action": "train", "args": ["--evil"]}).status_code == 409
    assert "--set" in ALLOWED_FLAGS
