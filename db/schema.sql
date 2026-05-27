-- Meridian Sentinel — 3-table Postgres schema
--
-- Design: thin, auditable, quota-free real data.
-- Tables:
--   ofac_sdn       — daily-refreshed OFAC SDN feed (run db/loaders/load_ofac.py)
--   entity_cache   — Sayari API responses cached from output/raw/*.json
--   screening_run  — each compare_ofac_vs_sayari run (audit trail)
--
-- Setup:
--   createdb sentinel
--   psql sentinel -f db/schema.sql
--   python db/loaders/load_cache.py   # loads output/raw/*.json → entity_cache
--   python db/loaders/load_ofac.py    # downloads + loads OFAC SDN → ofac_sdn

-- Extension: pg_trgm enables fuzzy name matching in compare_against_ofac.
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── ofac_sdn ──────────────────────────────────────────────────────────────────
-- Populated by db/loaders/load_ofac.py (ports ofac_refresh.py logic).
-- Rows are soft-deleted (removed_at) so audit links survive feed updates.

CREATE TABLE IF NOT EXISTS ofac_sdn (
    sdn_id              integer     PRIMARY KEY,
    primary_name        text        NOT NULL,
    primary_name_lower  text        NOT NULL,
    sdn_type            text        NOT NULL,   -- 'Entity' or 'Individual'
    programs            text[]      NOT NULL DEFAULT '{}',
    aliases             jsonb       NOT NULL DEFAULT '[]',
    addresses           jsonb       NOT NULL DEFAULT '[]',
    identifiers         jsonb       NOT NULL DEFAULT '[]',
    list_date           timestamptz,
    publish_date        timestamptz,
    fetched_at          timestamptz NOT NULL DEFAULT now(),
    removed_at          timestamptz             -- NULL = active
);

CREATE INDEX IF NOT EXISTS ofac_sdn_primary_lower_idx
    ON ofac_sdn (primary_name_lower) WHERE removed_at IS NULL;

-- pg_trgm index for fuzzy matching (requires CREATE EXTENSION pg_trgm):
-- CREATE INDEX IF NOT EXISTS ofac_sdn_trgm_idx
--     ON ofac_sdn USING gin (primary_name_lower gin_trgm_ops) WHERE removed_at IS NULL;


-- ── entity_cache ──────────────────────────────────────────────────────────────
-- One row per Sayari entity_id, loaded from output/raw/{id}.json.
-- These are real API responses — every field is traceable to the cached JSON.

CREATE TABLE IF NOT EXISTS entity_cache (
    entity_id           text        PRIMARY KEY,   -- Sayari entity_id
    input_name          text        NOT NULL,      -- original input row name
    match_label         text,                      -- Sayari entity label
    match_score         numeric,                   -- resolution confidence score
    name_mismatch_flag  boolean     NOT NULL DEFAULT false,
    entity_type         text,
    countries           text[]      NOT NULL DEFAULT '{}',
    sanctioned          boolean,
    pep                 boolean,
    risk_factors        text[]      NOT NULL DEFAULT '{}',
    degree              integer,
    source_count        integer,
    entity_url          text,                      -- /v1/entity/{id}
    raw_json            jsonb       NOT NULL,      -- full Sayari API response
    cached_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entity_cache_input_name_idx
    ON entity_cache (lower(input_name));

CREATE INDEX IF NOT EXISTS entity_cache_sanctioned_idx
    ON entity_cache (sanctioned) WHERE sanctioned = true;

CREATE INDEX IF NOT EXISTS entity_cache_risk_factors_idx
    ON entity_cache USING gin (risk_factors);


-- ── screening_run ─────────────────────────────────────────────────────────────
-- Audit log: each compare_ofac_vs_sayari run.
-- Drives the "screening history" view and lets us show that the data is live.

CREATE TABLE IF NOT EXISTS screening_run (
    id                  bigserial   PRIMARY KEY,
    run_at              timestamptz NOT NULL DEFAULT now(),
    total_entities      integer     NOT NULL,
    ofac_catch_count    integer     NOT NULL,
    sayari_catch_count  integer     NOT NULL,
    aha_count           integer     NOT NULL,       -- sayari-only catches
    ofac_fetched_at     timestamptz,               -- when SDN XML was downloaded
    result_json         jsonb       NOT NULL        -- full compare result
);


-- ── investigation ─────────────────────────────────────────────────────────────
-- One row per analyst investigation (a vendor list run).
-- Powers GET /api/investigations.

CREATE TABLE IF NOT EXISTS investigation (
    id                  bigserial   PRIMARY KEY,
    source              text        NOT NULL,  -- 'upload' | 'sftp' | 'api'
    source_detail       text,                  -- filename or SFTP path
    status              text        NOT NULL DEFAULT 'pending',
                                               -- pending | running | complete
    created_at          timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz,
    total_entities      integer     NOT NULL DEFAULT 0,
    flagged_count       integer     NOT NULL DEFAULT 0,
    cleared_count       integer     NOT NULL DEFAULT 0,
    escalated_count     integer     NOT NULL DEFAULT 0,
    blocked_count       integer     NOT NULL DEFAULT 0,
    pending_count       integer     NOT NULL DEFAULT 0,
    result_json         jsonb                  -- snapshot of compare_ofac_vs_sayari result
);

CREATE INDEX IF NOT EXISTS investigation_status_idx
    ON investigation (status, created_at DESC);


-- ── entity_result ─────────────────────────────────────────────────────────────
-- One row per entity per investigation.
-- Powers GET /api/results/{run_id} and /{run_id}/{entity_id}.

CREATE TABLE IF NOT EXISTS entity_result (
    id                  bigserial   PRIMARY KEY,
    investigation_id    bigint      NOT NULL REFERENCES investigation(id) ON DELETE CASCADE,
    entity_id           text,                  -- Sayari entity_id (NULL if unresolved)
    input_name          text        NOT NULL,
    match_label         text,
    outcome             text,                  -- both_catch | sayari_only | etc.
    risk_level          text,                  -- critical | high | medium | low
    ofac_programs       text[]      NOT NULL DEFAULT '{}',
    ownership_factor    text,
    direct_factor       text,
    ofac_match_name     text,
    ofac_sdn_id         integer,
    is_directly_designated  boolean NOT NULL DEFAULT false,
    is_ownership_exposed    boolean NOT NULL DEFAULT false,
    result_json         jsonb       NOT NULL
);

CREATE INDEX IF NOT EXISTS entity_result_investigation_idx
    ON entity_result (investigation_id);

CREATE INDEX IF NOT EXISTS entity_result_entity_id_idx
    ON entity_result (entity_id) WHERE entity_id IS NOT NULL;


-- ── disposition ───────────────────────────────────────────────────────────────
-- Analyst decisions on individual entity results.
-- Powers POST /api/results/{run_id}/{entity_id}/disposition.

CREATE TABLE IF NOT EXISTS disposition (
    id                  bigserial   PRIMARY KEY,
    entity_result_id    bigint      NOT NULL REFERENCES entity_result(id) ON DELETE CASCADE,
    status              text        NOT NULL,  -- pending | cleared | escalated | blocked
    reviewer            text,
    rationale           text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS disposition_entity_result_unique_idx
    ON disposition (entity_result_id);

CREATE INDEX IF NOT EXISTS disposition_entity_result_idx
    ON disposition (entity_result_id);
