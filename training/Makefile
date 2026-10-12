# One word per action. `make` alone lists them.
.DEFAULT_GOAL := help
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
EXTRAS := --extra torch --extra raw --extra mlx
else
EXTRAS := --extra torch --extra raw
endif
RUN := uv run atelier-train

help: ## list the actions
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS=":.*## "} {printf "  make %-10s %s\n", $$1, $$2}'

setup: ## install everything (Python, PyTorch, RAW support) into .venv
	uv sync $(EXTRAS)

setup-light: ## install without PyTorch (reading data and tests only)
	uv sync

doctor: ## check this machine and the data folders
	$(RUN) doctor

synth: ## make the small synthetic set (to try everything without real data)
	$(RUN) synth

validate: ## check your groups of pairs
	$(RUN) validate

ingest: ## prepare the training pairs
	$(RUN) ingest

test: ## run the tests
	uv run pytest

lint: ## check the code style
	uv run ruff check src tests
