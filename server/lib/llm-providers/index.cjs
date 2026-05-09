'use strict';

/**
 * LLM provider registry. MVP has one impl: claude-code (subprocess).
 * Future providers (anthropic-api, openai-compatible) plug in here without
 * touching reflection-service.
 *
 * See spec §5 + plan Task 5.
 */

const claudeCode = require('./claude-code-provider.cjs');

const PROVIDERS = {
  'claude-code': claudeCode,
};

function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) {
    throw new Error(`unknown LLM provider: ${name}. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return p;
}

function listProviders() {
  return Object.keys(PROVIDERS);
}

module.exports = { getProvider, listProviders };
