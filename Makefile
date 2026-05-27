# Meridian Sentinel — one-command dev workflow
#
# Prerequisites: Python 3.12+, pip, Docker (for 'make up')
#
# Quick start (no Docker):
#   make install
#   make run
#
# Full stack (Postgres + API in Docker):
#   make up
#   make seed

PYTHON     := python3
PIP        := pip
VENV       := .venv
API_DIR    := services/api
DB_URL     := postgresql://sentinel:sentinel@localhost:5432/sentinel

.PHONY: install run up down seed golden-run test health clean

## install — install Python deps into the current venv
install:
	$(PIP) install -r $(API_DIR)/requirements.txt

## run — start FastAPI on port 8000 (cache-only mode, no Docker needed)
run:
	cd "$(shell pwd)" && \
	PYTHONPATH=. uvicorn services.api.main:app --reload --port 8000

## up — boot Postgres + API via Docker Compose
up:
	docker compose up --build -d
	@echo "API: http://localhost:8000  Postgres: localhost:5432"

## down — stop Docker Compose services
down:
	docker compose down

## seed — load seed investigations into Postgres (requires DB running)
seed:
	DATABASE_URL=$(DB_URL) $(PYTHON) db/seed.py

## seed-json — write seed data to output/investigations_seed.json (no Postgres needed)
seed-json:
	$(PYTHON) db/seed.py

## golden-run — capture golden agent runs live (requires ANTHROPIC_API_KEY)
golden-run:
	@echo "Capturing golden runs (needs ANTHROPIC_API_KEY)..."
	PYTHONPATH=. $(PYTHON) -c "\
import asyncio, sys; sys.path.insert(0, '.'); \
from packages.engine import EntityCache; \
from services.api.ofac.matcher import OfacMatcher; \
from services.api.agent.runner import capture_golden_runs; \
cache = EntityCache('./output'); \
ofac = OfacMatcher.load('./services/api/data'); \
asyncio.run(capture_golden_runs(cache, ofac))"

## test — curl smoke-test all endpoints
test:
	@echo "=== /health ==="; \
	curl -s http://localhost:8000/health | python3 -m json.tool; \
	echo; \
	echo "=== /entities (count only) ==="; \
	curl -s http://localhost:8000/entities | python3 -c "import sys,json; d=json.load(sys.stdin); print('count:', d['count'])"; \
	echo; \
	echo "=== /tools/risk_summary/OWwtbp9y51OcLHJQakLaMw (Sberbank) ==="; \
	curl -s http://localhost:8000/tools/risk_summary/OWwtbp9y51OcLHJQakLaMw | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print('risk_level:', d['risk_level'], '| sanctioned:', d['sanctioned'])"; \
	echo; \
	echo "=== /tools/compare_ofac_vs_sayari (summary only) ==="; \
	curl -s "http://localhost:8000/tools/compare_ofac_vs_sayari?threshold=0.85" | python3 -c "import sys,json; s=json.load(sys.stdin)['data']['summary']; [print(f'  {k}: {v}') for k,v in s.items() if k!='structural_argument']"; \
	echo; \
	echo "=== POST /tools/traverse_ownership (Sberbank, cached) ==="; \
	curl -s -X POST http://localhost:8000/tools/traverse_ownership \
	  -H 'Content-Type: application/json' \
	  -d '{"entity_id":"OWwtbp9y51OcLHJQakLaMw","depth":3}' | \
	  python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print('nodes:', len(d['nodes']), '| edges:', len(d['edges']), '| sanction_hits:', len(d['sanction_hits']))"; \
	echo; \
	echo "=== GET /api/investigations ==="; \
	curl -s http://localhost:8000/api/investigations | python3 -c "import sys,json; d=json.load(sys.stdin); print('investigations:', len(d['investigations']))"; \
	echo; \
	echo "All tests passed."

## health — quick health check
health:
	curl -s http://localhost:8000/health | python3 -m json.tool

## clean — remove Python cache and compiled files
clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
