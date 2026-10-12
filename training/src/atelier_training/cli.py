"""``atelier-train``: the one entry point. ``atelier-train --help`` lists the commands."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .config import Config, load_config

NOT_YET = {
    "train": "Training arrives in M2 (the image-adaptive 3D LUT model) — see PLAN.md.",
    "eval": "Evaluation (ΔE in Lab, PSNR, image grids) arrives in M2 — see PLAN.md.",
    "export": "Exporting a learned .cube arrives in M2 — see PLAN.md.",
}


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

    report = ingest(config, sources=args.source or None, force=args.force, limit=args.limit, progress=progress)
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


def cmd_not_yet(args: argparse.Namespace) -> int:
    print(NOT_YET[args.command])
    return 2


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
    p.set_defaults(func=cmd_ingest)

    for name in NOT_YET:
        sub.add_parser(name, parents=[common], help=NOT_YET[name].split(" — ")[0]).set_defaults(func=cmd_not_yet)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
