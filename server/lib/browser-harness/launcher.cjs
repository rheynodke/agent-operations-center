'use strict';
/**
 * Chrome launcher for browser-harness pool slots.
 *
 * Spawns a detached Chrome process with --remote-debugging-port and an
 * isolated --user-data-dir per slot, so multiple agents can run in parallel
 * without sharing cookies/sessions.
 *
 * macOS-first (matches AOC's deployment target). Chromium fallback for
 * Linux is best-effort; Windows isn't supported.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { profilesRoot } = require('./installer.cjs');

const MAC_CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const LINUX_CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function detectChromePath() {
  if (process.env.AOC_CHROME_PATH && fs.existsSync(process.env.AOC_CHROME_PATH)) {
    return process.env.AOC_CHROME_PATH;
  }
  const candidates = process.platform === 'darwin' ? MAC_CHROME_CANDIDATES : LINUX_CHROME_CANDIDATES;
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

function profileDir(slotId) {
  return path.join(profilesRoot(), `aoc-${slotId}`);
}

/** Probe whether a TCP port already has a listener (Chrome already booted there). */
function isPortOpen(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => { if (done) return; done = true; try { socket.destroy(); } catch {} resolve(open); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/** Wait until the CDP HTTP endpoint responds (Chrome is fully ready). */
async function waitForCdp(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        const data = await r.json();
        return { ready: true, version: data.Browser, webSocketDebuggerUrl: data.webSocketDebuggerUrl };
      }
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return { ready: false };
}

/**
 * Launch a Chrome process for a pool slot.
 * @returns {Promise<{ pid, port, profile, chromePath, version, webSocketDebuggerUrl }>}
 */
async function launchChrome({ slotId, port }) {
  const chromePath = detectChromePath();
  if (!chromePath) {
    throw new Error(
      'Chrome not found. Install Google Chrome (or set AOC_CHROME_PATH env var).'
    );
  }
  if (await isPortOpen(port)) {
    throw new Error(`Port ${port} is already in use — another Chrome (or service) is running there.`);
  }

  const profile = profileDir(slotId);
  fs.mkdirSync(profile, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=ChromeWhatsNewUI,InterestFeedContentSuggestions',
    '--disable-background-networking',
    // Keep window visible — the user wants to see what the agent is doing on
    // their Mac mini. For headless mode add `--headless=new` here later.
  ];

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Don't await ready inline — caller can poll. But poll briefly to surface
  // hard-fail (e.g., Chrome crashed at startup) early.
  const ready = await waitForCdp(port, 8000);
  if (!ready.ready) {
    try { process.kill(child.pid, 'SIGTERM'); } catch {}
    throw new Error(`Chrome started (pid ${child.pid}) but CDP didn't become ready on port ${port} within 8s`);
  }

  return {
    pid: child.pid,
    port,
    profile,
    chromePath,
    version: ready.version,
    webSocketDebuggerUrl: ready.webSocketDebuggerUrl,
  };
}

/** SIGTERM the Chrome process; returns whether the kill signal was sent. */
function killChrome(pid) {
  if (!pid) return false;
  try { process.kill(pid, 'SIGTERM'); return true; }
  catch (err) {
    if (err.code === 'ESRCH') return false; // already dead
    throw err;
  }
}

/** Returns true if the pid is still running. */
function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

module.exports = {
  detectChromePath,
  profileDir,
  launchChrome,
  killChrome,
  isProcessAlive,
  isPortOpen,
  waitForCdp,
};
