'use strict';
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_LINES = 200;
const MIN_LINES = 10;
const MAX_LINES = 2000;
const TAIL_TIMEOUT_MS = 5000;
const TAIL_MAX_BUFFER = 4 * 1024 * 1024;

function clampLines(input) {
  const n = Number(input);
  if (!Number.isFinite(n)) return DEFAULT_LINES;
  return Math.max(MIN_LINES, Math.min(MAX_LINES, Math.floor(n)));
}

/**
 * Tail the last N lines from a file. Returns notFound=true rather than
 * throwing when the file is missing, so callers can render an empty-state
 * UI without distinguishing "no file yet" from a real error.
 *
 * @param {{file: string, lines?: number}} params
 * @returns {Promise<{logFile:string, lines:string[], notFound:boolean, error?:string}>}
 */
async function tailFile({ file, lines }) {
  if (!fs.existsSync(file)) {
    return { logFile: file, lines: [], notFound: true };
  }
  const n = clampLines(lines);
  try {
    const { stdout } = await execFileAsync('tail', ['-n', String(n), file], {
      timeout: TAIL_TIMEOUT_MS,
      maxBuffer: TAIL_MAX_BUFFER,
    });
    const arr = stdout.split('\n');
    if (arr.length > 0 && arr[arr.length - 1] === '') arr.pop();
    return { logFile: file, lines: arr, notFound: false };
  } catch (err) {
    return { logFile: file, lines: [], notFound: false, error: err.message };
  }
}

module.exports = { tailFile, clampLines, DEFAULT_LINES, MIN_LINES, MAX_LINES };
