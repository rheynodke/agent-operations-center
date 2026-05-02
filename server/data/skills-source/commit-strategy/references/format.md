# Output Format — Commit Strategy

## Plan document

`outputs/commits/{date}-{branch}/plan.md`

Required sections:
1. **Header** — mode (Odoo OCA / Conventional), worktree, branch, FSD, issue, modules touched
2. **Diff stat** — `git diff --stat` output
3. **Changed files** — `git status --short` output
4. **Commit format** — convention reminder
5. **Suggested commit grouping** — per-commit blocks
6. **Execution** — copy-paste-ready bash
7. **Sign-off** — SWE self-review checkbox

## Per-commit block schema

```markdown
### Commit N (proposed)

**Subject:** `[<type>][<modules>] <subject>` (Odoo) atau `<type>(<scope>): <subject>` (Conventional)

**Files:**
- path/to/file1
- path/to/file2

**Body:**
~~~
<body lines wrapped at 72 chars>

FSD: <path> §<N>
Closes #<N> (atau Refs #<N>)
~~~
```

## Subject line strict rules

| Rule | Odoo | Conventional |
|---|---|---|
| Length | ≤72 chars total (incl. prefix) | ≤72 chars total (incl. type+scope) |
| Mood | Imperative | Imperative |
| Case | Lowercase (kecuali proper noun) | Lowercase (kecuali proper noun) |
| Period at end | No | No |
| Module/scope spaces | `[mod1,mod2]` no space | `(scope)` |

## Body strict rules

- Wrap at 72 chars
- Explain *why*, not *what*
- FSD § citation kalau ada
- Issue link kalau ada (`Closes #N` atau `Refs #N`)

## Type semantics (Odoo)

| Prefix | When | NOT |
|---|---|---|
| `[add]` | New file/module/model/feature | Modified existing file |
| `[imp]` | Improve existing behavior | Pure refactor without behavior change |
| `[ref]` | Internal refactor, public API unchanged | Adds new feature |
| `[fix]` | Bug fix | New feature presented as "fix" |

## Type semantics (Conventional)

| Type | When |
|---|---|
| `feat` | User-facing new feature |
| `fix` | User-facing bug fix |
| `refactor` | Internal restructure |
| `test` | Tests only |
| `chore` | Tooling, deps, build |
| `docs` | Documentation |
| `style` | Whitespace/formatting only |
| `perf` | Performance |
| `ci` | CI config |
| `build` | Build system changes |

## Anti-pattern

- ❌ "WIP" / "fix" / "update files" — context-free
- ❌ Big-bang commit (50 files, 1 message)
- ❌ Skip FSD § when FSD exists
- ❌ Past tense ("added", "fixed")
- ❌ Subject > 72 chars
- ❌ `[mod1, mod2]` with space (Odoo) — strict no-space
- ❌ Mix unrelated changes in 1 commit
- ❌ Amend pushed commit on shared branch
- ❌ `--no-verify` bypass without approval
