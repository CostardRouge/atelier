from atelier_training.config import load_config, parse_override


def test_override_reads_toml_values():
    assert parse_override("ingest.long_edge=768") == {"ingest": {"long_edge": 768}}
    assert parse_override("ingest.sources=[\"pairs\"]") == {"ingest": {"sources": ["pairs"]}}
    assert parse_override("paths.pairs=/Volumes/Photos/pairs") == {"paths": {"pairs": "/Volumes/Photos/pairs"}}


def test_paths_resolve_against_the_training_root(workspace):
    config = load_config()
    assert config.root == workspace
    assert config.paths.pairs == workspace / "data" / "pairs"


def test_a_run_file_changes_only_what_it_says(workspace):
    (workspace / "configs" / "mine.toml").write_text("[ingest]\nlong_edge = 256\n", encoding="utf-8")
    config = load_config("configs/mine.toml", ["model.basis=5"])
    assert config.section("ingest")["long_edge"] == 256
    assert config.section("ingest")["fivek_expert"] == "C"
    assert config.section("model")["basis"] == 5
