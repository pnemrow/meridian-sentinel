# Database — Morning Setup Instructions

Postgres is NOT running tonight. The engine operates entirely from the
`output/raw/*.json` cache (real Sayari API data). DB load is a morning task.

## Setup steps (run in order)

```bash
# 1. Create database
createdb sentinel

# 2. Apply schema (3 tables: ofac_sdn, entity_cache, screening_run)
psql sentinel -f db/schema.sql

# Optional but recommended: enable pg_trgm for fuzzy OFAC name matching
psql sentinel -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 3. Load cached Sayari data (49 entities from output/raw/)
export DATABASE_URL=postgresql://localhost/sentinel
python db/loaders/load_cache.py

# 4. Load OFAC SDN (~10k entities, downloads ~15 MB XML)
python db/loaders/load_ofac.py

# Verify:
psql sentinel -c "SELECT count(*) FROM entity_cache;"  -- should be 49
psql sentinel -c "SELECT count(*) FROM ofac_sdn WHERE removed_at IS NULL;"  -- ~10k+
```

## Tables

| Table | Rows | Purpose |
|-------|------|---------|
| `ofac_sdn` | ~10k | Daily-refreshed OFAC SDN feed |
| `entity_cache` | 49 | Sayari API responses from output/raw/*.json |
| `screening_run` | audit | Each compare_ofac_vs_sayari run |

## Why only 3 tables?

The Replit version had 13 tables. 10 were persistence overhead (fixtures,
synthetic sessions, paced-replay state) that a PoC doesn't need.
These 3 tables give us real SQL for the demo + quota-free real data.
Ref: BUILD_SPEC.md §3, §8.
