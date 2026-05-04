'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { extractProvidersWithEnvRefs } = require('./migrate-multitenant.cjs');

test('extractProvidersWithEnvRefs: replaces literal apiKey with ${PROVIDER_NAME_API_KEY}', () => {
  const input = {
    models: {
      providers: {
        anthropic: { apiKey: 'sk-ant-real', api: 'anthropic-messages', models: ['x'] },
        openai:    { apiKey: 'sk-openai-real', api: 'openai-chat',     models: ['y'] },
      },
    },
  };
  const { providers, secrets } = extractProvidersWithEnvRefs(input);

  assert.equal(providers.models.providers.anthropic.apiKey, '${ANTHROPIC_API_KEY}');
  assert.equal(providers.models.providers.openai.apiKey,    '${OPENAI_API_KEY}');
  assert.equal(providers.models.providers.anthropic.api, 'anthropic-messages');
  assert.deepEqual(providers.models.providers.openai.models, ['y']);

  assert.deepEqual(secrets, [
    { envVar: 'ANTHROPIC_API_KEY', literal: 'sk-ant-real',    provider: 'anthropic' },
    { envVar: 'OPENAI_API_KEY',    literal: 'sk-openai-real', provider: 'openai' },
  ]);
});

test('extractProvidersWithEnvRefs: skips providers with empty or missing apiKey', () => {
  const input = {
    models: {
      providers: {
        kilocode:    { apiKey: '',          api: 'x' },
        modelstudio: {                       api: 'y' },     // no apiKey field
        kimi:        { apiKey: 'sk-kimi-z', api: 'z' },
      },
    },
  };
  const { providers, secrets } = extractProvidersWithEnvRefs(input);

  // Empty/missing keys: pass through unchanged
  assert.equal(providers.models.providers.kilocode.apiKey, '');
  assert.equal(providers.models.providers.modelstudio.apiKey, undefined);
  // Real key: replaced
  assert.equal(providers.models.providers.kimi.apiKey, '${KIMI_API_KEY}');

  // Only one secret extracted
  assert.deepEqual(secrets, [
    { envVar: 'KIMI_API_KEY', literal: 'sk-kimi-z', provider: 'kimi' },
  ]);
});

test('extractProvidersWithEnvRefs: skips apiKey already in ${VAR} form', () => {
  const input = {
    models: {
      providers: {
        anthropic: { apiKey: '${MY_KEY}', api: 'x' },
      },
    },
  };
  const { providers, secrets } = extractProvidersWithEnvRefs(input);
  assert.equal(providers.models.providers.anthropic.apiKey, '${MY_KEY}');
  assert.deepEqual(secrets, []);
});

test('extractProvidersWithEnvRefs: provider name is normalized to UPPER_SNAKE', () => {
  const input = {
    models: {
      providers: {
        'custom-api-kimi-com': { apiKey: 'sk-x', api: 'x' },
      },
    },
  };
  const { providers, secrets } = extractProvidersWithEnvRefs(input);
  assert.equal(providers.models.providers['custom-api-kimi-com'].apiKey,
               '${CUSTOM_API_KIMI_COM_API_KEY}');
  assert.deepEqual(secrets, [
    { envVar: 'CUSTOM_API_KIMI_COM_API_KEY', literal: 'sk-x', provider: 'custom-api-kimi-com' },
  ]);
});

test('extractProvidersWithEnvRefs: returns input shape if no models.providers section', () => {
  const input = { agents: {} };
  const { providers, secrets } = extractProvidersWithEnvRefs(input);
  assert.deepEqual(providers, { models: { providers: {} } });
  assert.deepEqual(secrets, []);
});

test('extractProvidersWithEnvRefs: does not mutate input', () => {
  const input = { models: { providers: { x: { apiKey: 'real' } } } };
  const before = JSON.stringify(input);
  extractProvidersWithEnvRefs(input);
  assert.equal(JSON.stringify(input), before);
});
