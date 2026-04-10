// ─── Cost & Quality Script Templates ───────────────────────────────────────────

import type { ScriptTemplate } from '../types'

export const COST_QUALITY_SCRIPTS: ScriptTemplate[] = [

  {
    id: 'pii-scanner',
    name: 'PII Scanner & Masker',
    filename: 'pii-scanner.py',
    description: 'Deteksi dan mask PII sebelum data dikirim ke model AI (FR-14, Data Privacy)',
    category: 'Cost & Quality',
    categoryEmoji: '🛡️',
    tags: ['pii', 'privacy', 'gdpr', 'fr-14', 'adlc'],
    content: `#!/usr/bin/env python3
"""
pii-scanner.py — Deteksi dan mask PII sebelum dikirim ke model AI (FR-14)
Usage: echo "text with PII" | python3 pii-scanner.py [--strict] [--report]
       python3 pii-scanner.py --file input.txt [--output output.txt]

Returns:
  JSON: {"clean": "...", "found": [...], "masked_count": N, "safe": bool}
"""

import re
import sys
import json
import argparse

# ── PII Patterns ──────────────────────────────────────────────────────────────

PII_PATTERNS = [
    # Email addresses
    (r'\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b',
     '[EMAIL_MASKED]', 'email'),

    # Indonesian phone numbers (08xx, +628xx, 628xx)
    (r'\\b(\\+?62|0)[8][0-9]{8,11}\\b',
     '[PHONE_MASKED]', 'phone_id'),

    # International phone (E.164 format)
    (r'\\+[1-9]\\d{6,14}\\b',
     '[PHONE_MASKED]', 'phone_intl'),

    # Indonesian NIK (16 digits)
    (r'\\b\\d{16}\\b',
     '[NIK_MASKED]', 'nik'),

    # Credit card numbers
    (r'\\b(?:\\d[ -]?){13,19}\\b',
     '[CARD_MASKED]', 'credit_card'),

    # API keys / tokens (common patterns)
    (r'\\b(sk-|pk-|gh[pors]_|eyJ|Bearer\\s+)[A-Za-z0-9_-]{20,}',
     '[TOKEN_MASKED]', 'api_token'),

    # AWS credentials
    (r'\\bAKIA[0-9A-Z]{16}\\b',
     '[AWS_KEY_MASKED]', 'aws_key'),

    # Passwords in common patterns
    (r'(?i)(password|passwd|pwd|secret)\\s*[=:]\\s*\\S+',
     '[PASSWORD_MASKED]', 'password'),

    # Indonesian names (common patterns - heuristic)
    # Note: This is a simple heuristic, not perfect
    (r'\\b(Bapak|Ibu|Pak|Bu|Sdr|Sdri)\\.?\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*',
     '[NAME_MASKED]', 'name_id'),
]

def scan_and_mask(text: str) -> dict:
    found = []
    clean = text

    for pattern, replacement, pii_type in PII_PATTERNS:
        matches = re.findall(pattern, clean)
        if matches:
            for match in (matches if isinstance(matches[0], str) else [m[0] for m in matches]):
                found.append({
                    'type': pii_type,
                    'preview': match[:10] + '...' if len(match) > 10 else match,
                })
            clean = re.sub(pattern, replacement, clean)

    return {
        'clean': clean,
        'found': found,
        'masked_count': len(found),
        'safe': len(found) == 0,
    }

def main():
    parser = argparse.ArgumentParser(description='PII Scanner & Masker for ADLC')
    parser.add_argument('--file', help='Input file path')
    parser.add_argument('--output', help='Output file path (default: stdout)')
    parser.add_argument('--strict', action='store_true', help='Exit with error if PII found')
    parser.add_argument('--report', action='store_true', help='Show full report, not just clean text')
    args = parser.parse_args()

    if args.file:
        with open(args.file, 'r', encoding='utf-8') as f:
            text = f.read()
    else:
        text = sys.stdin.read()

    result = scan_and_mask(text)

    if args.report:
        output = json.dumps(result, indent=2, ensure_ascii=False)
    else:
        output = result['clean']

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output)
    else:
        print(output)

    # Alert jika ada PII ditemukan
    if not result['safe']:
        alert = {
            'alert': 'PII_DETECTED',
            'count': result['masked_count'],
            'types': list({f['type'] for f in result['found']}),
        }
        print(json.dumps(alert), file=sys.stderr)

        if args.strict:
            sys.exit(1)

if __name__ == '__main__':
    main()
`,
  },

  {
    id: 'quality-gate',
    name: 'Quality Gate Checker',
    filename: 'quality-gate.sh',
    description: 'Cek apakah semua ADLC quality gates terpenuhi sebelum lanjut ke stage berikutnya',
    category: 'Cost & Quality',
    categoryEmoji: '🛡️',
    tags: ['quality-gate', 'qa', 'ci', 'fr-16', 'adlc'],
    content: `#!/bin/zsh
# quality-gate.sh — ADLC Quality Gate Checker (FR-16, FR-08)
# Cek apakah semua threshold terpenuhi sebelum pipeline lanjut ke stage berikutnya
# Usage: ./quality-gate.sh <stage> <feature_id>
# Stages: prd | prototype | fsd | code | qa | deploy
#
# Returns exit 0 if PASS, exit 1 if FAIL (blocks pipeline)

set -euo pipefail

STAGE="\${1:?Usage: $0 <stage> <feature_id>}"
FEATURE_ID="\${2:?Provide feature ID}"

PASS=true
FAILURES=()

log() { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { PASS=false; FAILURES+=("$1"); log "❌ FAIL: $1"; }
pass() { log "✅ PASS: $1"; }

log "Quality Gate Check — Stage: $STAGE | Feature: $FEATURE_ID"
echo "---"

case "$STAGE" in

  prd)
    log "Checking PRD Quality Gates..."
    # Check Value Score exists
    PRD_FILE="\${PRD_PATH:-/tmp/prd-$FEATURE_ID.md}"
    if [[ -f "$PRD_FILE" ]]; then
      grep -q "Value Score" "$PRD_FILE" && pass "Value Score present in PRD" || fail "Value Score missing from PRD"
      grep -q "User Stories" "$PRD_FILE" && pass "User Stories present" || fail "User Stories missing"
      grep -q "Success Metrics" "$PRD_FILE" && pass "Success Metrics present" || fail "Success Metrics missing"
    else
      fail "PRD file not found at $PRD_FILE"
    fi

    # Check CPO approval status
    APPROVAL_STATUS="\${CPO_APPROVAL_STATUS:-pending}"
    [[ "$APPROVAL_STATUS" == "approved" ]] && pass "CPO Approval: APPROVED" || fail "CPO Approval: $APPROVAL_STATUS"
    ;;

  qa)
    log "Checking QA Quality Gates..."
    # Code coverage
    COVERAGE="\${TEST_COVERAGE:-0}"
    if (( $(echo "$COVERAGE >= 80" | bc -l) )); then
      pass "Code coverage: $COVERAGE% (threshold: 80%)"
    else
      fail "Code coverage: $COVERAGE% below 80% threshold"
    fi

    # Failed tests
    FAILED_TESTS="\${FAILED_TEST_COUNT:-0}"
    [[ "$FAILED_TESTS" -eq 0 ]] && pass "No failed tests" || fail "$FAILED_TESTS test(s) failed"

    # Critical bugs
    CRITICAL_BUGS="\${CRITICAL_BUG_COUNT:-0}"
    [[ "$CRITICAL_BUGS" -eq 0 ]] && pass "No critical bugs" || fail "$CRITICAL_BUGS critical bug(s) unresolved"
    ;;

  deploy)
    log "Checking Deploy Quality Gates..."
    # All previous stages must pass
    for stage in prd prototype fsd code qa; do
      STATUS=$(cat "/tmp/gate-$FEATURE_ID-$stage" 2>/dev/null || echo "not_run")
      [[ "$STATUS" == "pass" ]] && pass "Stage $stage: PASS" || fail "Stage $stage: $STATUS"
    done
    ;;

  *)
    fail "Unknown stage: $STAGE. Valid: prd|prototype|fsd|code|qa|deploy"
    ;;
esac

echo "---"

if [[ "$PASS" == "true" ]]; then
  log "🎉 ALL GATES PASSED — Pipeline can proceed to next stage"
  echo "pass" > "/tmp/gate-$FEATURE_ID-$STAGE"
  echo '{"status":"PASS","stage":"'$STAGE'","feature":"'$FEATURE_ID'"}'
  exit 0
else
  log "🚫 GATE FAILED — Pipeline BLOCKED"
  log "Failures: \${FAILURES[*]}"
  echo "fail" > "/tmp/gate-$FEATURE_ID-$STAGE"
  echo '{"status":"FAIL","stage":"'$STAGE'","feature":"'$FEATURE_ID'","failures":['$(printf '"%s",' "\${FAILURES[@]}" | sed 's/,$//')]'}'
  exit 1
fi
`,
  },

]
