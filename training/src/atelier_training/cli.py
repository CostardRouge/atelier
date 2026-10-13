"""``atelier-train``: the one entry point. ``atelier-train --help`` lists the commands."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .config import Config, load_config

TORCH_MISSING = "PyTorch is not installed: run `make setup` (or `uv sync --extra torch`) first."


def _config(args: argparse.Namespace) -> Config:
    return load_config(args.config, args.set or [])


def cmd_doctor(args: argparse.Namespace) -> int:
    from . import doctor

    config = _config(args)
    print(f"atelier-train {__version__} — training folder: {config.root}\n")
    checks, code = doctor.run(config)
    for check in checks:
        print(check.render())
    print()
    print("Ready for the next step." if code == 0 else "Fix the ✗ lines above first.")
    return code


def cmd_synth(args: argparse.Namespace) -> int:
    from .synthetic import generate

    config = _config(args)
    s = config.section("synthetic")
    out = config.paths.synthetic
    truth = generate(
        out,
        groups=int(s.get("groups", 12)),
        size=tuple(s.get("size", [96, 64])),  # type: ignore[arg-type]
        edits_per_group=int(s.get("edits_per_group", 3)),
        fivek_photos=int(s.get("fivek_photos", 8)),
        seed=int(s.get("seed", 7)),
        style=str(s.get("style") or "") or None,
        lut_size=int(config.section("model").get("lut_size", 33)),
    )
    print(f"Synthetic set written to {out}: {len(truth['pairs'])} groups, {len(truth['fivek'])} FiveK-like photos.")
    print("Try it: `atelier-train ingest --source synthetic`.")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    from .datasets.pairs import scan_pairs

    config = _config(args)
    root = Path(args.folder) if args.folder else config.paths.pairs
    tol = float(config.section("ingest").get("aspect_tolerance", 0.01))
    scan = scan_pairs(root, aspect_tolerance=tol)
    for issue in scan.issues:
        print(issue)
    print(
        f"\n{len(scan.groups)} group(s), {scan.pair_count} usable pair(s), "
        f"{len(scan.errors)} error(s), {len(scan.warnings)} warning(s)."
    )
    return 1 if scan.errors else 0


def cmd_init_group(args: argparse.Namespace) -> int:
    from .datasets.pairs import InitGroupError, init_group

    try:
        path = init_group(Path(args.folder), force=args.force)
    except InitGroupError as e:
        print(f"✗ {e}")
        return 1
    print(f"✓ wrote {path} — open it and check that the right file is the original.")
    return 0


def cmd_ingest(args: argparse.Namespace) -> int:
    from .ingest import ingest

    config = _config(args)

    def progress(n: int, total: int, ref) -> None:  # noqa: ANN001
        if n == 1 or n == total or n % 25 == 0:
            print(f"  {n}/{total}  {ref.id}")

    report = ingest(config, sources=args.source or None, force=args.force, limit=args.limit, progress=progress,
                    workers=args.workers)
    for note in report.notes:
        print(f"  ! {note}")
    for pid, why in report.skipped[:20]:
        print(f"  ✗ {pid}: {why}")
    if len(report.skipped) > 20:
        print(f"  … and {len(report.skipped) - 20} more skipped.")
    print(
        f"\nPrepared {report.written} pair(s), reused {report.reused}, skipped {len(report.skipped)} "
        f"→ {config.paths.cache / 'index.jsonl'}"
    )
    return 0 if report.entries or not (report.skipped or report.notes) else 1


def _needs_torch() -> bool:
    from .device import module_available

    if module_available("torch"):
        return True
    print(f"✗ {TORCH_MISSING}")
    return False


def _run_folder(args: argparse.Namespace, config: Config) -> Path | None:
    """``--run`` as given, else the most recent run folder."""
    from .train import latest_run

    if args.run:
        folder = Path(args.run)
        if not folder.is_dir():
            folder = config.paths.runs / args.run
        return folder if (folder / "config.toml").is_file() else None
    return latest_run(config.paths.runs)


def cmd_train(args: argparse.Namespace) -> int:
    if not _needs_torch():
        return 2
    from .train import train

    config = _config(args)
    try:
        run = train(config, sources=args.source or None, name=args.name,
                    resume=Path(args.resume) if args.resume else None,
                    init=Path(args.init) if args.init else None, epochs=args.epochs)
    except (RuntimeError, FileNotFoundError) as e:
        print(f"✗ {e}")
        return 1
    print(f"\nRun {run.folder.name} done → {run.folder}")
    print("Next: `atelier-train eval` for the numbers and the grids, `atelier-train export` for the .cube.")
    return 0


def cmd_eval(args: argparse.Namespace) -> int:
    if not _needs_torch():
        return 2
    from .evaluate import evaluate

    config = _config(args)
    folder = _run_folder(args, config)
    if folder is None:
        print("✗ no run found: train one first, or pass --run <folder>.")
        return 1
    try:
        evaluate(config, folder, which_split=args.split, grids=args.grids, sources=args.source or None)
    except (RuntimeError, FileNotFoundError) as e:
        print(f"✗ {e}")
        return 1
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    if not _needs_torch():
        return 2
    from .export import export_for_image, export_style

    config = _config(args)
    folder = _run_folder(args, config)
    if folder is None:
        print("✗ no run found: train one first, or pass --run <folder>.")
        return 1
    if args.image:
        export_for_image(config, folder, Path(args.image), Path(args.out) if args.out else None)
    else:
        export_style(config, folder, limit=args.limit)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    from .device import module_available

    if not module_available("fastapi") or not module_available("uvicorn"):
        print("✗ The dashboard needs FastAPI: run `make setup` (or `uv sync --extra ui`) first.")
        return 2
    from .serve import serve

    serve(_config(args), host=args.host, port=args.port, open_browser=not args.no_browser)
    return 0


def cmd_bench(args: argparse.Namespace) -> int:
    if not _needs_torch():
        return 2
    from .train import bench

    bench(_config(args), steps=args.steps)
    return 0


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--config", help="a run file (TOML) layered over configs/default.toml")
    common.add_argument("--set", action="append", metavar="SECTION.KEY=VALUE",
                        help="change one setting, e.g. --set ingest.long_edge=768 (repeatable)")

    parser = argparse.ArgumentParser(prog="atelier-train", description="Learn the maintainer's editing style, locally.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("doctor", parents=[common], help="check this machine and the data folders").set_defaults(
        func=cmd_doctor)
    sub.add_parser("synth", parents=[common], help="make the small synthetic set").set_defaults(func=cmd_synth)

    p = sub.add_parser("validate", parents=[common], help="check your groups of pairs and list every problem")
    p.add_argument("folder", nargs="?", help="a pairs folder (default: paths.pairs)")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("init-group", help="write a guessed manifest.toml for one group folder")
    p.add_argument("folder")
    p.add_argument("--force", action="store_true", help="replace an existing manifest")
    p.set_defaults(func=cmd_init_group)

    p = sub.add_parser("ingest", parents=[common], help="prepare the training pairs (resized, cached)")
    p.add_argument("--source", action="append", choices=["fivek", "pairs", "synthetic"],
                   help="which data to prepare (repeatable; default: ingest.sources)")
    p.add_argument("--force", action="store_true", help="redo pairs already prepared")
    p.add_argument("--limit", type=int, default=0, help="stop after this many pairs (0 = all)")
    p.add_argument("--workers", type=int, default=None,
                   help="pairs prepared at once (default: ingest.workers; 0 = automatic, 1 = no parallelism)")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("train", parents=[common], help="fit the adaptive LUT on the prepared pairs")
    p.add_argument("--source", action="append", choices=["fivek", "pairs", "synthetic"],
                   help="which prepared pairs to train on (repeatable; default: ingest.sources)")
    p.add_argument("--name", help="a word for the run folder")
    p.add_argument("--epochs", type=int, help="override train.epochs")
    p.add_argument("--resume", metavar="RUN", help="continue this run from its last checkpoint")
    p.add_argument("--init", metavar="RUN", help="start a new run from this run's best weights (fine-tuning)")
    p.set_defaults(func=cmd_train)

    p = sub.add_parser("eval", parents=[common], help="score a run (PSNR, ΔE) and draw input | edit | model grids")
    p.add_argument("--run", help="the run folder (default: the most recent)")
    p.add_argument("--split", choices=["validation", "train", "all"], default="validation")
    p.add_argument("--grids", type=int, default=24, help="how many grids to draw, worst ΔE first")
    p.add_argument("--source", action="append", choices=["fivek", "pairs", "synthetic"])
    p.set_defaults(func=cmd_eval)

    p = sub.add_parser("export", parents=[common], help="write the learned look as a .cube Atelier loads")
    p.add_argument("--run", help="the run folder (default: the most recent)")
    p.add_argument("--image", help="a picture: export the LUT the model predicts for it")
    p.add_argument("--out", help="where to write the .cube (default: inside the run folder)")
    p.add_argument("--limit", type=int, default=0, help="average the style over this many training pairs (0 = all)")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("serve", parents=[common], help="open the local dashboard (actions, curves, image grids)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--host", default="127.0.0.1", help="keep it local: 127.0.0.1")
    p.add_argument("--no-browser", action="store_true", help="do not open the page in the browser")
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("bench", parents=[common], help="time one training step here and estimate a whole run")
    p.add_argument("--steps", type=int, default=5)
    p.set_defaults(func=cmd_bench)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
