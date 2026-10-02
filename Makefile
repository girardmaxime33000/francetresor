PYTHON ?= .venv/bin/python

.PHONY: data setup test lint

setup:
	python3.12 -m venv .venv
	.venv/bin/pip install -r requirements.txt

data:
	$(PYTHON) scripts/build_data.py

test:
	$(PYTHON) -m pytest -q

lint:
	$(PYTHON) -m ruff check scripts tests
