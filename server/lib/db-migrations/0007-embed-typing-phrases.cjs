'use strict';

/**
 * Migration 0007 — add typing_phrases column to agent_embeds.
 *
 * Stores a JSON array of custom typing indicator phrases shown in the
 * embed chat widget while the agent is composing a response.
 * NULL means the widget uses its built-in default (waiting_text).
 *
 * Idempotent: checks PRAGMA table_info before ALTER TABLE.
 */
module.exports = {
  id: '0007-embed-typing-phrases',
  description: 'Add typing_phrases (TEXT, nullable) column to agent_embeds for custom widget typing indicators',
  up(db) {
    // Guard for idempotency — only ALTER if column doesn't already exist
    const cols = db.exec("PRAGMA table_info('agent_embeds')")[0]?.values?.map(r => r[1]) || [];
    if (!cols.includes('typing_phrases')) {
      db.exec(`ALTER TABLE agent_embeds ADD COLUMN typing_phrases TEXT`);
    }
  },
};
