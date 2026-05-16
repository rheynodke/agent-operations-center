'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function parseEtimeToSeconds(etime) {
  // Formats: "MM:SS", "HH:MM:SS", "D-HH:MM:SS"
  let days = 0;
  let rest = etime;
  if (etime.includes('-')) {
    const [d, r] = etime.split('-');
    days = Number(d);
    rest = r;
  }
  const parts = rest.split(':').map(Number);
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) [h, m, s] = parts;
  else if (parts.length === 2) [m, s] = parts;
  else return null;
  if ([days, h, m, s].some((n) => !Number.isFinite(n))) return null;
  return days * 86400 + h * 3600 + m * 60 + s;
}

function parsePsOutput(stdout) {
  const out = new Map();
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 4) continue;
    const pid = Number(cols[0]);
    const etime = cols[1];
    const rssKb = Number(cols[2]);
    const cpu = Number(cols[3]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const uptimeSeconds = parseEtimeToSeconds(etime);
    if (uptimeSeconds == null) continue;
    if (!Number.isFinite(rssKb) || !Number.isFinite(cpu)) continue;
    out.set(pid, {
      uptimeSeconds,
      rssMb: Math.round(rssKb / 1024),
      cpuPercent: Number(cpu.toFixed(1)),
    });
  }
  return out;
}

/**
 * Batched ps probe — one process call regardless of pid count.
 * @param {number[]} pids
 * @returns {Promise<Map<number, {uptimeSeconds:number, rssMb:number, cpuPercent:number}>>}
 */
async function psProbe(pids) {
  if (!Array.isArray(pids) || pids.length === 0) return new Map();
  const validPids = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (validPids.length === 0) return new Map();
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-p', validPids.join(','), '-o', 'pid=,etime=,rss=,%cpu='],
      { timeout: 5000 },
    );
    return parsePsOutput(stdout);
  } catch {
    // ps exits non-zero when all pids dead — return empty so callers null-fill.
    return new Map();
  }
}

module.exports = { psProbe, parsePsOutput, parseEtimeToSeconds };
