'use strict';

/**
 * Migration 0005 — satisfaction tables.
 *
 * Three tables for AOC's self-learning satisfaction pipeline:
 *
 * 1. message_ratings — append-style event log, INSERT OR REPLACE on
 *    (message_id, source, rater_external_id) for last-write-wins on
 *    flip (👍 → 👎). source ∈ button|reaction|nl_correction.
 *
 * 2. session_satisfaction_summary — one row per reflected session,
 *    written by reflection-service after session_end. Holds counts,
 *    rates, LLM token usage, status, prompt_version.
 *
 * 3. agent_satisfaction_metrics_daily — pre-aggregated dashboard rollup,
 *    UPSERT'd by daily job. Avoids scanning ratings on every render.
 *
 * See spec §4 (Storage Schema).
 */
module.exports = {
  id: '0005-satisfaction-tables',
  description: 'Create satisfaction tables for self-learning pipeline',
  up(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS message_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        channel TEXT NOT NULL,
        source TEXT NOT NULL,
        rating TEXT NOT NULL,
        reason TEXT,
        rater_external_id TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_ratings_agent_session ON message_ratings(agent_id, session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ratings_owner_created ON message_ratings(owner_id, created_at DESC)`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_dedupe ON message_ratings(message_id, source, rater_external_id)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS session_satisfaction_summary (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        endorsed_count INTEGER NOT NULL,
        flagged_count INTEGER NOT NULL,
        presumed_good_count INTEGER NOT NULL,
        hallucination_rate REAL NOT NULL,
        endorsement_rate REAL NOT NULL,
        reflection_status TEXT NOT NULL,
        reflection_skip_reason TEXT,
        lessons_extracted INTEGER DEFAULT 0,
        examples_captured INTEGER DEFAULT 0,
        llm_input_tokens INTEGER,
        llm_output_tokens INTEGER,
        prompt_version TEXT,
        reflection_at INTEGER NOT NULL,
        duration_ms INTEGER
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_session_summary_agent_time ON session_satisfaction_summary(agent_id, reflection_at DESC)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS agent_satisfaction_metrics_daily (
        agent_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        channel TEXT NOT NULL,
        session_count INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        endorsed_count INTEGER NOT NULL,
        flagged_count INTEGER NOT NULL,
        hallucination_rate REAL NOT NULL,
        endorsement_rate REAL NOT NULL,
        PRIMARY KEY (agent_id, owner_id, day, channel)
      )
    `);
  },
};
