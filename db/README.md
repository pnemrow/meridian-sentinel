# Database

This folder is the optional Postgres persistence layer. The app does not require Postgres at all by default; the demo path uses file based persistence under `output/` and is fully self contained.

This folder exists for the case where a reviewer wants to exercise the Postgres branch in `services/api/routers/investigations.py`, which writes investigation metadata and dispositions to a relational schema instead of JSON files.

## Bringing up the database

The simplest path is the `db` profile in `docker-compose.yml`:

```bash
docker compose --profile db up
```

This brings up Postgres alongside the API. The schema in `schema.sql` is loaded automatically on first start via Postgres's `/docker-entrypoint-initdb.d` mechanism.

To populate the schema with cached Sayari profiles and the OFAC SDN feed after Postgres is healthy:

```bash
export DATABASE_URL=postgresql://sentinel:sentinel@localhost:5432/sentinel

# Optional but recommended for fuzzy OFAC name matching
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# Load cached Sayari profiles (49 entities from output/raw/) into entity_cache
python db/loaders/load_cache.py

# Load OFAC SDN feed into ofac_sdn
python db/loaders/load_ofac.py

# Verify
psql "$DATABASE_URL" -c "SELECT count(*) FROM entity_cache;"
psql "$DATABASE_URL" -c "SELECT count(*) FROM ofac_sdn WHERE removed_at IS NULL;"
```

## Schema

Three tables, intentionally minimal.

| Table | Rows | Purpose |
|-------|------|---------|
| `ofac_sdn` | ~10k | Treasury SDN feed, refreshable from `services/api/data/sdn.xml` |
| `entity_cache` | 49 | Sayari API responses for list_1, mirrored from `output/raw/*.json` |
| `screening_run` | audit | One row per `compare_ofac_vs_sayari` invocation |

## Why Postgres is optional

For a proof of concept the file based path is more inspectable. Every artifact lives under `output/` and can be opened, grepped, or diffed directly. Postgres is the production move; the code in `services/api/routers/investigations.py` falls back to file storage when `DATABASE_URL` is unset, so the same routes work either way.
