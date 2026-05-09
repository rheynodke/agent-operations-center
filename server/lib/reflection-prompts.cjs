'use strict';

/**
 * Reflection prompt template + version constants.
 *
 * Single LLM call combines 3 tasks: detect NL corrections, distill lessons,
 * tag verbatim endorsed examples. Output is JSON validated against schema.
 *
 * See spec §6.3 + plan Task 6.
 *
 * IMPORTANT: bumping REFLECTION_PROMPT_VERSION does NOT auto-re-reflect old
 * sessions. Existing summaries record their prompt_version; UI exposes
 * manual re-reflect endpoint for sessions on older versions.
 */

const REFLECTION_PROMPT_VERSION = 'v1.0';
const REFLECTION_SCHEMA_VERSION = '1';

const SYSTEM_PROMPT = `You are a reflection analyzer for an AI agent's session. Your output is structured JSON only — no prose, no markdown fences.

TASKS (do all three in this single pass):
1. DETECT: For each ASSISTANT message, decide if the NEXT user turn expresses disagreement/correction (NL signal that the assistant was wrong). Examples of correction: "itu salah", "bukan begitu", "wrong", "incorrect", or any factual contradiction/clarification of the assistant's claim.
2. DISTILL: Extract 0-5 reusable lessons. Each lesson must be specific (e.g., "User's BigQuery dataset is named Odoo17DKEpublic, not Odoo") not generic ("user values clarity"). DO NOT extract lessons from messages you flagged in task 1.
3. CAPTURE: For each ASSISTANT message marked [rating=endorsed], reference it in validated_examples by messageId only. DO NOT include the message text — the host system will fetch it verbatim.

RULES:
- DO NOT flag tone/style disagreements — only factual errors or false claims.
- DO NOT flag follow-up questions or scope expansions.
- DO NOT mix flagged content into lessons.
- Lessons must each be ≤ 200 chars, factual, declarative.
- If session has no learning value (mostly chitchat, no resolution), return empty arrays with session_quality="poor".
- Output JSON matching the schema below. Nothing else.

SCHEMA:
{
  "schema_version": "${REFLECTION_SCHEMA_VERSION}",
  "session_quality": "good" | "mixed" | "poor",
  "flagged_messages": [
    { "messageId": "<id>", "evidence": "T<n> user said: <quote>", "type": "factual_error|user_correction|incomplete" }
  ],
  "lessons": [
    { "kind": "pattern|preference|fact|warning", "text": "<lesson>", "tags": ["<tag>", ...], "evidence_message_ids": ["<id>", ...] }
  ],
  "validated_examples": [
    { "messageId": "<id>", "kind": "code|config|explanation", "title": "<short title>", "tags": [...] }
  ]
}`;

function buildPrompt({ compactTranscript, retryStrict = false }) {
  const prefix = retryStrict ? 'VALID JSON ONLY:\n\n' : '';
  return `${prefix}${SYSTEM_PROMPT}\n\nTRANSCRIPT:\n${compactTranscript}`;
}

module.exports = {
  REFLECTION_PROMPT_VERSION,
  REFLECTION_SCHEMA_VERSION,
  SYSTEM_PROMPT,
  buildPrompt,
};
