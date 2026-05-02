# Installing `cloudflared`

`cloudflared` is Cloudflare's official tunnel client. The `preview.js` CLI
uses it (and **only** it) when you ask for a public URL via
`node preview.js tunnel`.

## Recommended — userspace install (no privileges)

The skill can install cloudflared into your home directory with zero
elevated permissions:

```
node scripts/preview.js install-cloudflared
```

This downloads the official signed binary from Cloudflare's GitHub release
page (https://github.com/cloudflare/cloudflared/releases/latest) into
`~/.local/bin/cloudflared` on macOS and Linux, or
`%USERPROFILE%\.local\bin\cloudflared.exe` on Windows.

If `~/.local/bin` is not on your `PATH` yet, add it:

```
export PATH="$HOME/.local/bin:$PATH"
```

(or put the line in `~/.bashrc` / `~/.zshrc` / your shell's profile.)

## Alternative — package managers (run these yourself)

These options are listed for reference. The skill does **not** run them —
you execute them from your own shell with whatever privileges you choose.

**macOS — Homebrew**

```
brew install cloudflared
```

**Windows — winget**

```
winget install --id Cloudflare.cloudflared -e
```

**Debian / Ubuntu — APT (privileged; you run it)**

The commands below need elevated permissions. Review them before running:

```
# Add the Cloudflare signing key
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg > /tmp/cf.gpg
# (then move /tmp/cf.gpg to /usr/share/keyrings/ with your preferred tool)
# Add the apt source:
#   deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] \
#       https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main
# Then:  apt-get update && apt-get install cloudflared
```

Full instructions: https://pkg.cloudflare.com/ (official Cloudflare docs).

**Fedora / RHEL — RPM (privileged; you run it)**

```
# Review the RPM first, then install it with your package manager of choice:
#   https://pkg.cloudflare.com/cloudflared-stable-linux-x86_64.rpm
```

Full instructions: https://pkg.cloudflare.com/

## Verifying the install

```
cloudflared --version
node scripts/preview.js install-cloudflared --dry-run    # confirms it's detected
```

## What the tunnel actually does

`cloudflared tunnel --url http://127.0.0.1:<port>` opens a connection from
your machine to Cloudflare's edge and hands you a one-off
`https://<random>.trycloudflare.com` URL that proxies to your local server.

- No Cloudflare account needed.
- URL is ephemeral — dies when you run `node preview.js stop`.
- Traffic goes through Cloudflare's network; be aware of that if your
  preview contains sensitive mockup data.
- Your local server stays bound to `127.0.0.1`; nothing else listens on a
  public interface.
