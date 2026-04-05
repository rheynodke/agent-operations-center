'use strict';

/**
 * Build flat available models list from openclaw.json config.
 */
function getAvailableModels(config) {
  const providers = config.models?.providers || {};
  const defaults  = config.agents?.defaults?.models || {};
  const result    = [];

  for (const [provider, providerData] of Object.entries(providers)) {
    const models = providerData.models || [];
    for (const model of models) {
      const value = `${provider}/${model.id}`;
      const alias = defaults[value]?.alias || model.name || model.id;
      result.push({
        value,
        label: alias !== model.id ? `${alias} (${model.id})` : model.id,
        provider,
        modelId: model.id,
        reasoning: model.reasoning || false,
        contextWindow: model.contextWindow || 0,
      });
    }
  }

  // Also include models from defaults.models that may reference non-provider models
  for (const [key, meta] of Object.entries(defaults)) {
    if (!result.find(r => r.value === key)) {
      const [prov, ...rest] = key.split('/');
      result.push({
        value: key,
        label: meta.alias || rest.join('/') || key,
        provider: prov,
        modelId: rest.join('/'),
        reasoning: false,
        contextWindow: 0,
      });
    }
  }

  return result;
}

module.exports = { getAvailableModels };
