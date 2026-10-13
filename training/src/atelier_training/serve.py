"""``atelier-train serve``: the local dashboard — actions, curves and image grids in a browser.

One small FastAPI app over the folders the other commands already write
(``runs/``, ``data/cache/``) and one static page (``static/index.html``).
Bound to ``127.0.0.1`` only, no auth, no network: it is a window on this
machine's files. Actions run the CLI itself as a SUBPROCESS (so the dashboard
does exactly what the Terminal does, and a crash in a run never takes the page
down); its output is streamed line by line as server-sent events and kept in
``runs/dashboard/<job>.log``. One job at a time: a training run is the whole
machine's GPU.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import Config, load_config

STATIC = Path(__file__).resolve().parent / "static"
ACTIONS = ("doctor", "synth", "validate", "ingest", "train", "eval", "export", "bench")


@dataclass
class Job:
    id: str
    action: str
    args: list[str]
    started: float
    log_file: Path
    returncode: int | None = None
    lines: list[str] = field(default_factory=list)
    process: subprocess.Popen | None = None

    @property
    def running(self) -> bool:
        return self.returncode is None

    def as_dict(self) -> dict[str, Any]:
        return {"id": self.id, "action": self.action, "args": self.args, "started": self.started,
                "running": self.running, "returncode": self.returncode, "lines": len(self.lines)}


class Jobs:
    """The subprocesses the page started, one at a time, their output kept in memory and on disk."""

    def __init__(self, config: Config):
        self.config = config
        self.folder = config.paths.runs / "dashboard"
        self.jobs: dict[str, Job] = {}
        self.lock = threading.Lock()

    @property
    def current(self) -> Job | None:
        running = [j for j in self.jobs.values() if j.running]
        return running[-1] if running else None

    def start(self, action: str, args: list[str]) -> Job:
        if action not in ACTIONS:
            raise ValueError(f"unknown action {action!r}")
        bad = [a for a in args if not isinstance(a, str) or a.startswith("-") and a not in ALLOWED_FLAGS
               and not any(a.startswith(f + "=") for f in ALLOWED_FLAGS)]
        if bad:
            raise ValueError(f"argument not allowed: {bad[0]!r}")
        with self.lock:
            if self.current is not None:
                raise RuntimeError(f"a job is already running ({self.current.action}); stop it or wait.")
            self.folder.mkdir(parents=True, exist_ok=True)
            job_id = f"{int(time.time())}-{action}"
            job = Job(id=job_id, action=action, args=args, started=time.time(), log_file=self.folder / f"{job_id}.log")
            env = dict(os.environ, ATELIER_TRAINING_ROOT=str(self.config.root), PYTHONUNBUFFERED="1")
            job.process = subprocess.Popen(
                [sys.executable, "-m", "atelier_training.cli", action, *args],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env, cwd=str(self.config.root),
            )
            self.jobs[job_id] = job
        threading.Thread(target=self._pump, args=(job,), daemon=True).start()
        return job

    def _pump(self, job: Job) -> None:
        assert job.process is not None and job.process.stdout is not None
        with job.log_file.open("w", encoding="utf-8") as f:
            for line in job.process.stdout:
                line = line.rstrip("\n")
                job.lines.append(line)
                f.write(line + "\n")
                f.flush()
        job.returncode = job.process.wait()

    def stop(self, job_id: str) -> Job:
        job = self.jobs[job_id]
        if job.running and job.process is not None:
            job.process.terminate()
            try:
                job.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                job.process.kill()
        return job


ALLOWED_FLAGS = ("--source", "--name", "--epochs", "--resume", "--init", "--run", "--split", "--grids",
                 "--image", "--out", "--limit", "--force", "--workers", "--steps", "--set", "--config")


def run_summary(folder: Path) -> dict[str, Any]:
    """What the runs list shows for one run: its config's headline, the last metrics line, the eval."""
    from .train import load_run

    run = load_run(folder)
    metrics = run.read_metrics()
    last = metrics[-1] if metrics else None
    best = max((m for m in metrics if "val_psnr" in m), key=lambda m: m["val_psnr"], default=None)
    evals = sorted((folder / "eval").glob("*.json")) if (folder / "eval").is_dir() else []
    return {
        "name": folder.name,
        "sources": run.sources,
        "epochs": int(run.config.get("train", {}).get("epochs", 0)),
        "done_epochs": last["epoch"] if last else 0,
        "last": last,
        "best": {k: best[k] for k in ("epoch", "val_psnr", "val_de2000_mean")} if best else None,
        "has_best": (folder / "best.pt").is_file(),
        "has_last": (folder / "last.pt").is_file(),
        "cubes": sorted(p.name for p in folder.glob("*.cube")),
        "evals": [p.stem for p in evals],
        "model": run.config.get("model", {}),
    }


def list_runs(config: Config) -> list[dict[str, Any]]:
    runs = config.paths.runs
    if not runs.is_dir():
        return []
    out = []
    for folder in sorted((p for p in runs.iterdir() if p.is_dir() and (p / "config.toml").is_file()), reverse=True):
        try:
            out.append(run_summary(folder))
        except Exception as e:  # noqa: BLE001 — a half-written run is listed as such, never hidden
            out.append({"name": folder.name, "error": str(e)})
    return out


def create_app(config: Config | None = None):
    """The FastAPI app; imported lazily so the core never needs fastapi."""
    from fastapi import Body, FastAPI, HTTPException
    from fastapi.responses import FileResponse, StreamingResponse
    from fastapi.staticfiles import StaticFiles

    config = config or load_config()
    jobs = Jobs(config)
    app = FastAPI(title="Atelier training", docs_url=None, redoc_url=None)
    app.state.config = config
    app.state.jobs = jobs

    def run_folder(name: str) -> Path:
        folder = config.paths.runs / name
        if "/" in name or ".." in name or not (folder / "config.toml").is_file():
            raise HTTPException(404, f"no run {name!r}")
        return folder

    @app.get("/api/status")
    def status() -> dict[str, Any]:
        from . import doctor

        checks, _ = doctor.run(config)
        index = config.paths.cache / "index.jsonl"
        lines = index.read_text(encoding="utf-8").splitlines() if index.is_file() else []
        pairs = sum(1 for line in lines if line.strip())
        return {
            "root": str(config.root),
            "checks": [{"name": c.name, "status": c.status, "message": c.message, "fix": c.fix} for c in checks],
            "pairs": pairs,
            "sources": config.section("ingest").get("sources", []),
            "current": jobs.current.as_dict() if jobs.current else None,
        }

    @app.get("/api/runs")
    def runs() -> list[dict[str, Any]]:
        return list_runs(config)

    @app.get("/api/runs/{name}")
    def run_detail(name: str) -> dict[str, Any]:
        from .train import load_run

        folder = run_folder(name)
        run = load_run(folder)
        evals = {}
        if (folder / "eval").is_dir():
            for p in sorted((folder / "eval").glob("*.json")):
                evals[p.stem] = json.loads(p.read_text(encoding="utf-8"))
        return {**run_summary(folder), "config": run.config, "metrics": run.read_metrics(), "evals": evals}

    @app.get("/api/runs/{name}/grids/{file}")
    def grid_file(name: str, file: str):
        folder = run_folder(name)
        path = folder / "eval" / "grids" / file
        if "/" in file or ".." in file or not path.is_file():
            raise HTTPException(404)
        return FileResponse(path)

    @app.get("/api/runs/{name}/cube/{file}")
    def cube_file(name: str, file: str):
        folder = run_folder(name)
        path = folder / file
        if "/" in file or not file.endswith(".cube") or not path.is_file():
            raise HTTPException(404)
        return FileResponse(path, media_type="text/plain", filename=file)

    @app.get("/api/pairs")
    def pairs(limit: int = 48, source: str | None = None) -> list[dict[str, Any]]:
        index = config.paths.cache / "index.jsonl"
        if not index.is_file():
            return []
        out = []
        for line in index.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            e = json.loads(line)
            if source and e["source"] != source:
                continue
            out.append({k: e[k] for k in ("id", "source", "group", "label", "width", "height", "folder")})
            if len(out) >= limit:
                break
        return out

    @app.get("/api/pairs/preview")
    def pair_preview(folder: str):
        path = (config.paths.cache / folder / "preview.jpg").resolve()
        if not path.is_relative_to(config.paths.cache.resolve()) or not path.is_file():
            raise HTTPException(404)
        return FileResponse(path)

    @app.get("/api/jobs")
    def list_jobs() -> list[dict[str, Any]]:
        return [j.as_dict() for j in jobs.jobs.values()]

    @app.post("/api/jobs")
    def start_job(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:  # noqa: B008 — FastAPI's own idiom
        action, args = payload.get("action"), payload.get("args") or []
        if not isinstance(action, str) or not isinstance(args, list):
            raise HTTPException(422, "expected {action: str, args: [str]}")
        try:
            return jobs.start(action, [str(a) for a in args]).as_dict()
        except (ValueError, RuntimeError) as e:
            raise HTTPException(409, str(e)) from e

    @app.get("/api/jobs/{job_id}")
    def job_detail(job_id: str, offset: int = 0) -> dict[str, Any]:
        job = jobs.jobs.get(job_id)
        if job is None:
            raise HTTPException(404)
        return {**job.as_dict(), "log": job.lines[offset:]}

    @app.post("/api/jobs/{job_id}/stop")
    def stop_job(job_id: str) -> dict[str, Any]:
        if job_id not in jobs.jobs:
            raise HTTPException(404)
        return jobs.stop(job_id).as_dict()

    @app.get("/api/jobs/{job_id}/stream")
    def stream_job(job_id: str):
        job = jobs.jobs.get(job_id)
        if job is None:
            raise HTTPException(404)

        def events():
            sent = 0
            while True:
                while sent < len(job.lines):
                    yield f"data: {json.dumps(job.lines[sent])}\n\n"
                    sent += 1
                if not job.running:
                    yield f"event: done\ndata: {json.dumps(job.returncode)}\n\n"
                    return
                time.sleep(0.25)

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


def serve(config: Config, host: str = "127.0.0.1", port: int = 8765, open_browser: bool = True) -> None:
    import uvicorn

    app = create_app(config)
    url = f"http://{host}:{port}/"
    print(f"Atelier training dashboard on {url} — Ctrl-C to stop.")
    if open_browser:
        import webbrowser

        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=host, port=port, log_level="warning")
