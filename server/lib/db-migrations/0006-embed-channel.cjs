'use strict';

/**
 * Migration 0006 — embed channel tables.
 *
 * Creates four new tables and extends two existing tables for the
 * embed channel chat widget feature:
 *
 * New tables:
 *   - agent_embeds         — embed configuration per agent
 *   - embed_sessions       — visitor session tracking
 *   - embed_audit_log      — security/compliance event log
 *   - embed_metrics_daily  — pre-aggregated daily metrics
 *   - embed_rate_limit_state — sliding-window rate limit counters
 *
 * Existing table extensions:
 *   - agent_profiles.is_public_agent — marks agents eligible for public embed
 *   - users.dlp_encryption_key       — per-user DLP encryption key
 *
 * Timestamp note: all *_at columns use INTEGER (Unix ms) throughout —
 * consistent with 0005-satisfaction-tables, intentionally diverging from the
 * older TEXT-ISO convention in the baseline schema. Avoids silent
 * type-coercion bugs in range queries.
 */
module.exports = {
  id: '0006-embed-channel',
  description: 'Create embed channel tables (agent_embeds, embed_sessions, embed_audit_log, embed_metrics_daily, embed_rate_limit_state) + extend agent_profiles.is_public_agent and users.dlp_encryption_key',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_embeds (
        id              TEXT PRIMARY KEY,
        agent_id        TEXT NOT NULL,
        owner_id        INTEGER NOT NULL,
        mode            TEXT NOT NULL,
        embed_token     TEXT NOT NULL UNIQUE,
        signing_secret  TEXT,
        production_origin TEXT NOT NULL,
        dev_origins       TEXT NOT NULL DEFAULT '[]',
        brand_name        TEXT NOT NULL,
        brand_color       TEXT NOT NULL DEFAULT '#3B82F6',
        brand_color_text  TEXT DEFAULT '#FFFFFF',
        avatar_source     TEXT NOT NULL DEFAULT 'agent',
        avatar_url        TEXT,
        welcome_title     TEXT NOT NULL,
        welcome_subtitle  TEXT,
        quick_replies     TEXT NOT NULL DEFAULT '[]',
        waiting_text      TEXT NOT NULL DEFAULT 'Sebentar, saya cek dulu...',
        offline_message   TEXT NOT NULL DEFAULT 'We''re temporarily offline. Please try again later.',
        hide_powered_by   INTEGER NOT NULL DEFAULT 1,
        consent_text      TEXT,
        language_default  TEXT NOT NULL DEFAULT 'id',
        dlp_preset             TEXT NOT NULL,
        dlp_allowlist_patterns TEXT NOT NULL DEFAULT '[]',
        enabled         INTEGER NOT NULL DEFAULT 1,
        disable_mode    TEXT,
        daily_token_quota   INTEGER NOT NULL DEFAULT 100000,
        daily_message_quota INTEGER NOT NULL DEFAULT 1000,
        rate_limit_per_ip   INTEGER NOT NULL DEFAULT 30,
        retention_days      INTEGER NOT NULL DEFAULT 30,
        alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
        turnstile_sitekey TEXT,
        turnstile_secret  TEXT,
        widget_version    TEXT NOT NULL DEFAULT 'v1',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_embeds_owner ON agent_embeds(owner_id);
      CREATE INDEX IF NOT EXISTS idx_embeds_agent ON agent_embeds(agent_id);

      CREATE TABLE IF NOT EXISTS embed_sessions (
        id                  TEXT PRIMARY KEY,
        embed_id            TEXT NOT NULL,
        visitor_uuid        TEXT NOT NULL,
        visitor_meta        TEXT NOT NULL DEFAULT '{}',
        gateway_session_key TEXT NOT NULL,
        traffic_type        TEXT NOT NULL,
        origin              TEXT NOT NULL,
        started_at          INTEGER NOT NULL,
        last_active_at      INTEGER NOT NULL,
        cleared_at          INTEGER,
        message_count       INTEGER NOT NULL DEFAULT 0,
        token_total         INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_embed_sessions_embed ON embed_sessions(embed_id);
      CREATE INDEX IF NOT EXISTS idx_embed_sessions_visitor ON embed_sessions(embed_id, visitor_uuid);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_embed_sessions_active
        ON embed_sessions(embed_id, visitor_uuid)
        WHERE cleared_at IS NULL;

      CREATE TABLE IF NOT EXISTS embed_audit_log (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        embed_id      TEXT NOT NULL,
        session_id    TEXT,
        owner_id      INTEGER NOT NULL,
        event_type    TEXT NOT NULL,
        severity      TEXT NOT NULL DEFAULT 'info',
        origin        TEXT,
        visitor_uuid  TEXT,
        ip_hash       TEXT,
        context_data  TEXT NOT NULL DEFAULT '{}',
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_embed_time ON embed_audit_log(embed_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_event_type ON embed_audit_log(embed_id, event_type, created_at DESC);

      CREATE TABLE IF NOT EXISTS embed_metrics_daily (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        embed_id              TEXT NOT NULL,
        owner_id              INTEGER NOT NULL,
        date                  TEXT NOT NULL,
        traffic_type          TEXT NOT NULL,
        unique_visitors       INTEGER NOT NULL DEFAULT 0,
        message_count         INTEGER NOT NULL DEFAULT 0,
        token_total           INTEGER NOT NULL DEFAULT 0,
        response_latency_p50  INTEGER,
        response_latency_p95  INTEGER,
        dlp_redactions        INTEGER NOT NULL DEFAULT 0,
        dlp_blocks            INTEGER NOT NULL DEFAULT 0,
        tool_violations       INTEGER NOT NULL DEFAULT 0,
        rate_limit_hits       INTEGER NOT NULL DEFAULT 0,
        auth_failures         INTEGER NOT NULL DEFAULT 0,
        errors                INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_embed_metrics_daily
        ON embed_metrics_daily(embed_id, date, traffic_type);

      CREATE TABLE IF NOT EXISTS embed_rate_limit_state (
        scope_key    TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count        INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );
    `);

    // ALTER existing — guarded for idempotency
    const profileCols = db.exec("PRAGMA table_info('agent_profiles')")[0]?.values?.map(r => r[1]) || [];
    if (!profileCols.includes('is_public_agent')) {
      db.exec(`ALTER TABLE agent_profiles ADD COLUMN is_public_agent INTEGER NOT NULL DEFAULT 0`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agent_profiles_public
        ON agent_profiles(provisioned_by, is_public_agent)
        WHERE is_public_agent = 1
    `);

    const userCols = db.exec("PRAGMA table_info('users')")[0]?.values?.map(r => r[1]) || [];
    if (!userCols.includes('dlp_encryption_key')) {
      db.exec(`ALTER TABLE users ADD COLUMN dlp_encryption_key TEXT`);
    }
  },
};
