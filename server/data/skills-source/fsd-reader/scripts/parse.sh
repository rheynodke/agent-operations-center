#!/bin/bash
# FSD Reader — parse FSD Markdown into structured JSON + validate.
#
# Usage:
#   ./parse.sh --fsd PATH [--output PATH]
#
# Exits non-zero if validation fails (hard errors). Warnings logged to stderr.

set -euo pipefail

FSD=""
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --fsd)    FSD="$2"; shift 2;;
    --output) OUTPUT="$2"; shift 2;;
    -h|--help) grep '^#' "$0" | sed 's/^# \?//'; exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

[ -z "$FSD" ] && { echo "ERROR: --fsd required"; exit 1; }
[ ! -f "$FSD" ] && { echo "ERROR: FSD not found: $FSD"; exit 1; }

DATE=$(date +%Y-%m-%d)
[ -z "$OUTPUT" ] && OUTPUT="outputs/parsed/$(basename "$FSD" .md).json"
mkdir -p "$(dirname "$OUTPUT")"

# Use Python for parsing (available on most dev machines + Odoo)
python3 - <<PYEOF "$FSD" "$OUTPUT"
import sys, re, json, os

fsd_path = sys.argv[1]
out_path = sys.argv[2]

with open(fsd_path) as f:
    content = f.read()

errors = []
warnings = []
meta = {}
sections = {}
stories = []

# Extract YAML header (between first ```yaml and matching ```)
yaml_match = re.search(r'^```yaml\n(.+?)\n```', content, re.MULTILINE | re.DOTALL)
if not yaml_match:
    errors.append({"code": "MISSING_HEADER", "message": "No YAML header block found in FSD"})
else:
    yaml_text = yaml_match.group(1)
    for line in yaml_text.split('\n'):
        if ':' in line:
            key, _, val = line.partition(':')
            meta[key.strip()] = val.strip()

    # Validate required header fields
    if 'mode' not in meta or not meta.get('mode'):
        errors.append({"code": "MISSING_MODE", "message": "YAML header missing 'mode' field"})
    elif meta['mode'] not in ('odoo', 'frontend', 'backend', 'fullstack'):
        errors.append({"code": "INVALID_MODE", "message": f"Invalid mode: {meta['mode']}"})

    if 'target-version' not in meta or not meta.get('target-version'):
        errors.append({"code": "MISSING_TARGET_VERSION", "message": "YAML header missing 'target-version' field"})

    if 'ship-as' not in meta or not meta.get('ship-as'):
        errors.append({"code": "MISSING_SHIP_AS", "message": "YAML header missing 'ship-as' field"})

# Extract Status
status_match = re.search(r'\*\*Status:\*\*\s*([a-z\-]+)', content)
status = status_match.group(1) if status_match else None
meta['status'] = status
if status not in ('approved', 'peer-reviewed', 'draft', 'deprecated'):
    if status:
        errors.append({"code": "INVALID_STATUS", "message": f"Status '{status}' not in allowed set"})
    else:
        errors.append({"code": "MISSING_STATUS", "message": "FSD missing **Status:** line"})

# Extract feature name from filename
basename = os.path.basename(fsd_path).replace('.md', '')
m = re.match(r'^\d{4}-\d{2}-\d{2}-fsd-(.+)$', basename)
meta['feature'] = m.group(1) if m else basename

# PRD/Feasibility links
prd_m = re.search(r'\*\*PRD:\*\*\s*`?([^`\n]+)`?', content)
feas_m = re.search(r'\*\*Feasibility Brief:\*\*\s*`?([^`\n]+)`?', content)
if prd_m: meta['prdLink'] = prd_m.group(1).strip()
else: warnings.append({"code": "NO_PRD_LINK", "message": "FSD missing PRD link"})
if feas_m: meta['feasibilityLink'] = feas_m.group(1).strip()
else: warnings.append({"code": "NO_FEASIBILITY_LINK", "message": "FSD missing Feasibility Brief link"})

# Index sections — match `## §N <title>`
section_pattern = re.compile(r'^## §(\d+) (.+)$', re.MULTILINE)
matches = list(section_pattern.finditer(content))
for i, match in enumerate(matches):
    num = match.group(1)
    title = match.group(2)
    line_start = content[:match.start()].count('\n') + 1
    line_end = (content[:matches[i+1].start()].count('\n')
                if i+1 < len(matches) else content.count('\n'))
    slug = re.sub(r'[^a-z0-9]+', '_', title.lower()).strip('_')
    sections[f"{num}_{slug}"] = {
        "title": title,
        "lineStart": line_start,
        "lineEnd": line_end,
    }

# Required sections check (allow §1-§9 minimum)
required_nums = {'1', '2', '3', '4', '5', '6', '7', '8', '9'}
present_nums = set(k.split('_')[0] for k in sections.keys())
missing = required_nums - present_nums
for num in sorted(missing):
    errors.append({"code": "MISSING_SECTION", "message": f"FSD missing §{num} section"})

# Architecture diagram (warning)
if '```dot' not in content:
    warnings.append({"code": "NO_ARCH_DIAGRAM", "message": "No dot/graphviz diagram in FSD"})

# Extract Story → Implementation Mapping (§9)
story_section = next((k for k in sections if k.startswith('9_')), None)
if not story_section:
    errors.append({"code": "MISSING_STORY_MAPPING", "message": "Story → Implementation Mapping section (§9) absent"})
else:
    # Find table rows after § heading
    sec = sections[story_section]
    # Crude table parse — look for lines starting with `|` between line ranges
    lines = content.split('\n')[sec['lineStart']:sec['lineEnd']]
    in_table = False
    table_idx = 0
    for line in lines:
        if line.strip().startswith('|'):
            if not in_table:
                in_table = True
                continue  # header row
            if '---' in line:
                continue  # separator row
            cols = [c.strip() for c in line.strip('|').split('|')]
            if len(cols) >= 2 and cols[0] and cols[0] != "_[story 1]_":
                table_idx += 1
                story_text = cols[0]
                fsd_refs = re.findall(r'§\d+', cols[1] if len(cols) > 1 else '')
                if not fsd_refs:
                    errors.append({
                        "code": "ORPHAN_STORY",
                        "story": f"S{table_idx}",
                        "message": f"Story '{story_text[:60]}...' has no FSD section citation"
                    })
                stories.append({
                    "id": f"S{table_idx}",
                    "text": story_text,
                    "fsdSections": fsd_refs,
                    "notes": cols[2] if len(cols) > 2 else "",
                })

# API contracts check (§3) — must have OpenAPI block atau api-contract reference
api_section_key = next((k for k in sections if k.startswith('3_')), None)
if api_section_key:
    sec = sections[api_section_key]
    sec_content = '\n'.join(content.split('\n')[sec['lineStart']-1:sec['lineEnd']])
    has_openapi = 'openapi:' in sec_content.lower() or '```yaml' in sec_content
    has_apicontract_ref = 'api-contract' in sec_content
    if not has_openapi and not has_apicontract_ref:
        # Heuristic: too few code blocks = probably free-form
        code_blocks = sec_content.count('```')
        if code_blocks < 2:
            errors.append({
                "code": "API_FREEFORM",
                "section": "§3",
                "message": "API contracts described as prose; no OpenAPI block or api-contract reference"
            })

# Compile output
result = {
    "meta": meta,
    "sections": sections,
    "stories": stories,
    "validation": {
        "passed": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }
}

with open(out_path, 'w') as f:
    json.dump(result, f, indent=2)

# stderr summary
print(f"Parsed: {fsd_path}", file=sys.stderr)
print(f"  Sections: {len(sections)} indexed", file=sys.stderr)
print(f"  Stories:  {len(stories)} extracted", file=sys.stderr)
print(f"  Errors:   {len(errors)}", file=sys.stderr)
print(f"  Warnings: {len(warnings)}", file=sys.stderr)
print(f"  Output:   {out_path}", file=sys.stderr)

if errors:
    print(f"\n❌ Validation failed:", file=sys.stderr)
    for e in errors:
        print(f"  [{e['code']}] {e['message']}", file=sys.stderr)
    sys.exit(2)

if warnings:
    print(f"\n⚠️  Warnings:", file=sys.stderr)
    for w in warnings:
        print(f"  [{w['code']}] {w['message']}", file=sys.stderr)

print("\n✓ FSD validation passed.", file=sys.stderr)
PYEOF

# Re-run exit code from python
EXIT_CODE=$?
exit $EXIT_CODE
