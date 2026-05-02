# Output Format — Claude Code Orchestrator

## Bundle structure

```
outputs/codework/{date}-{feature}/
├── prompt-1.md         # task prompt for run 1
├── run-1.log           # claude stdout/stderr
├── changes-1.txt       # git status --short after run 1
├── diff-1.patch        # git diff after run 1
├── question-1.md       # if claude couldn't proceed (escalate)
├── prompt-2.md         # if retry needed
├── run-2.log
├── ...
├── manifest.json       # task scope + iterations + final status
└── changes-summary.md  # human-readable summary (optional, agent-authored)
```

## manifest.json (mandatory)

```json
{
  "feature": "discount-line",
  "fsd": "outputs/2026-04-25-fsd-discount-line.md",
  "worktree": "/path/to/repo/.worktrees/discount-line",
  "mode": "implement",
  "sections": "§2,§4,§5",
  "targets": "models/discount_line.py,views/discount_line_views.xml",
  "iterations": 2,
  "max_iterations": 3,
  "final_status": "claude-completed",
  "ready_for_commit": true,
  "claude_bin": "/opt/homebrew/bin/claude",
  "timestamp": "2026-05-02T10:30:00+07:00"
}
```

## Final status values

| Status | Meaning | Next action |
|---|---|---|
| `claude-completed` | Claude exited 0; agent must verify quality gates | If gates pass → `commit-strategy` |
| `needs-clarification` | Claude wrote question file (couldn't proceed) | Escalate to EM with task tag `fsd-clarification` |
| `iteration-exhausted` | 3x retry, still failing gates | Escalate to EM (likely spec gap) |
| `pending` | Initial state | (should not appear in final manifest) |

## Prompt structure (per run)

`prompt-{N}.md` includes:
1. Task header — mode, feature, FSD path, sections, target files
2. Responsibilities — what claude must do (read FSD, follow conventions, run gates)
3. On Ambiguity instruction — write question file instead of guessing
4. Quality gates — exact commands to run
5. (Run 2+) Refinement note — previous failure excerpt + specific issues to fix

## Anti-pattern

- ❌ Manifest `final_status: claude-completed` tanpa quality gate verification
- ❌ Dispatch tanpa worktree path
- ❌ Dispatch tanpa FSD validation step
- ❌ `max_iterations > 3` — pattern indicates spec gap, escalate instead
- ❌ Skip iteration log — debug claude behavior susah tanpa audit trail
- ❌ Override `claude_bin` di production tanpa env var (`CLAUDE_BIN`)
