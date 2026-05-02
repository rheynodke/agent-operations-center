# Security model — uiux-generator

This document explains exactly what the skill does, what it does not do, and
why each system-level capability is needed. It exists so install-time
scanners and reviewers have the full picture.

## TL;DR

- **No privileged operations.** The skill never invokes `sudo`, package
  managers, or any elevated command from its code.
- **No network listens on public interfaces.** The live-preview server binds
  to `127.0.0.1` by default. Public exposure is only via the user-triggered
  Cloudflare Quick Tunnel, which the user can stop at any time.
- **All writes are scoped to the user's home directory** (`~/.uiux-preview/`)
  and the output directory the user chose. Nothing writes to system paths.
- **All child processes are spawned with argv arrays**, never through a
  shell — no command injection surface.
- **Only one external download** is performed by the skill, and only when
  the user explicitly runs `install-cloudflared`: the official signed
  `cloudflared` binary from Cloudflare's GitHub releases, saved under
  `~/.local/bin/`.

## Node modules used — justifications

| Module          | Used in                         | Why it's needed                                                             |
| --------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `fs`            | everywhere                      | Read/write spec files, output bundles, state files, log files.              |
| `path`          | everywhere                      | Cross-platform path joining.                                                |
| `os`            | `preview-agent.js`              | `homedir()`, `platform()`, `arch()` — for state dir + binary download URL.  |
| `net`           | `preview-agent.js`              | Probing free ports on `127.0.0.1` (never binds publicly).                   |
| `http`          | `canvas-server.js`              | The live-preview HTTP server on `127.0.0.1`.                                |
| `https`         | `preview-agent.js`              | Downloading the cloudflared binary from GitHub (user-triggered only).       |
| `crypto`        | `canvas-server.js`              | WebSocket handshake (RFC 6455 — SHA-1 accept key). Standard protocol use.   |
| `child_process` | `preview-agent.js`, `serve.js`  | Spawning **two** specific binaries: `node serve.js` and `cloudflared`.      |

The `child_process` surface is intentionally tiny:

1. `spawn(process.execPath, [serveScript, ...flags])` — launches Node on the
   skill's own `serve.js`. The script path is derived from `__dirname`, not
   user input.
2. `spawn(cloudflaredPath, [...fixed flags])` — launches `cloudflared tunnel`
   with fixed argv. The URL is constructed from the local host (default
   `127.0.0.1`) and a numeric port picked by the agent.
3. `spawnSync('which', [bin])` / `spawnSync('where', [bin])` — locates
   binaries on PATH. Input is a fixed string literal (`'cloudflared'`).
4. `spawnSync('taskkill', ['/PID', pid, '/T', '/F'])` — Windows-only, to
   terminate the detached child's process tree. `pid` is a number read from
   the skill's own state file.

No `shell: true`. No string concatenation into argv. No `eval`, no
`Function()`, no `vm`, no `require.extensions` tricks.

## Filesystem surface

- `~/.uiux-preview/` — state directory, created with mode `0700`.
  - `<slug>.json` — state for one preview instance (mode `0600`).
  - `<slug>.out.log`, `<slug>.err.log` — server logs.
  - `<slug>.tunnel.out.log`, `<slug>.tunnel.err.log` — tunnel logs.
- `~/.local/bin/cloudflared` — downloaded only when the user runs
  `install-cloudflared`.
- The **output directory** the user (or the skill's spec) points at —
  typically `/mnt/outputs/uiux-odoo-output/<slug>/` in Cowork.

The skill never writes to: `/etc`, `/usr`, `/var`, `/opt`, `/System`,
`C:\Windows`, the registry, launchd/systemd units, or shell profiles.

## Network surface

| Connection                       | Direction | Trigger                                      |
| -------------------------------- | --------- | -------------------------------------------- |
| `http://127.0.0.1:<port>`        | inbound   | Always (live preview; loopback only).        |
| `github.com` releases download   | outbound  | User runs `install-cloudflared`.             |
| Cloudflare edge (tunnel)         | outbound  | User runs `preview.js tunnel`.               |
| `https://<id>.trycloudflare.com` | inbound → proxied through Cloudflare to `127.0.0.1:<port>` | Only while tunnel is running. |

The tunnel URL is ephemeral (dies on `preview.js stop`) and requires no
Cloudflare account.

## What the skill will **not** do

- Install system packages (no `sudo`, no `apt`, no `brew`, no `dnf`, no
  `winget`, no `yum`, no `pacman`, no `choco`, no PowerShell admin calls).
- Modify shell profiles, launchd/systemd units, cron, or login items.
- Write to `/etc`, `/usr`, `/var`, or any directory outside the user's home
  + the user-chosen output directory.
- Open listening sockets on any interface other than `127.0.0.1` (the
  tunnel's public URL proxies through Cloudflare; your machine never
  accepts direct inbound connections on a public interface).
- Transmit the contents of your repo, home directory, or clipboard to any
  remote host.
- Persist credentials, tokens, or cookies.
- Auto-update itself.

## Reviewer checklist

- [ ] Grep the source for `sudo`, `apt-get`, `brew`, `dnf`, `winget` —
      should return zero matches.
- [ ] Grep for `shell: true` in `spawn`/`exec` calls — should return zero.
- [ ] Grep for `eval(`, `new Function(`, `require(<variable>)` — should
      return zero.
- [ ] Confirm `http.createServer` is bound to `127.0.0.1` or the
      user-supplied `--host` (default `127.0.0.1`).
- [ ] Confirm the only outbound HTTPS URL in the code resolves to
      `github.com/cloudflare/cloudflared/releases/...`.

## Reporting issues

If you find a security concern, please raise it with the skill's author
before installing or deploying the skill further.
