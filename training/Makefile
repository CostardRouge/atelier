# One word per action. `make` alone lists them.
.DEFAULT_GOAL := help
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
EXTRAS := --extra torch --extra raw --extra heif --extra ui --extra onnx --extra mlx
else
EXTRAS := --extra torch --extra raw --extra heif --extra ui --extra onnx
endif
RUN := uv run atelier-train

help: ## list the actions
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS=":.*## "} {printf "  make %-10s %s\n", $$1, $$2}'

setup: ## install everything (Python, PyTorch, RAW support, ONNX export) into .venv
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

serve: ## open the dashboard in the browser (actions, curves, image grids)
	$(RUN) serve

bench: ## time one training step on this machine and estimate a run
	$(RUN) bench

train: ## fit the model on the prepared pairs
	$(RUN) train

finetune: ## fine-tune the FiveK run INIT=runs/<folder> on your pairs
	$(RUN) train --config configs/finetune.toml --source pairs --init $(INIT)

eval: ## score the latest run and draw the grids
	$(RUN) eval

export: ## write the latest run's look as a .cube
	$(RUN) export

records: ## unpack Atelier's training file FILE=<path.json> into data/records
	$(RUN) records $(FILE)

train-develop: ## fit the sliders predictor on the records
	$(RUN) train-develop

export-develop: ## write the sliders predictor as ONNX for Atelier
	$(RUN) export-develop

test: ## run the tests
	uv run pytest

lint: ## check the code style
	uv run ruff check src tests
