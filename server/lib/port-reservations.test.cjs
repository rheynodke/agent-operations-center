'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Isolated DB
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-portresv-'));
process.env.AOC_DATA_DIR = TMP;

const db = require('./db.cjs');

test.before(async () => {
  await db.initDatabase();
});

test.beforeEach(() => {
  // Clean slate per test
  try { db.releaseReservationByUser(1); db.releaseReservationByUser(2); db.releaseReservationByUser(3); } catch {}
  // Wipe any stale rows from prior tests
  try {
    const sql = require('better-sqlite3'); // not used — placeholder
  } catch {}
});

test('reservePortTriple returns triples that are stride-3 from base', async () => {
  const a = db.reservePortTriple(11);
  assert.equal(a.port % 3, 19000 % 3);
  assert.equal(typeof a.reservationId, 'string');
});

test('20 sequential reservations get 20 distinct ports', async () => {
  const ports = new Set();
  const ids = [];
  for (let i = 0; i < 20; i++) {
    const r = db.reservePortTriple(100 + i);
    assert.ok(!ports.has(r.port), `duplicate port ${r.port}`);
    ports.add(r.port);
    ids.push(r.reservationId);
  }
  // Cleanup
  for (const id of ids) db.releaseReservation(id);
});

test('20 PARALLEL reservations get 20 distinct ports', async () => {
  // Flush from previous test
  for (let i = 0; i < 20; i++) db.releaseReservationByUser(100 + i);

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      Promise.resolve().then(() => db.reservePortTriple(200 + i)),
    ),
  );
  const ports = new Set(results.map((r) => r.port));
  assert.equal(ports.size, 20, 'expected 20 unique ports');
  for (const r of results) db.releaseReservation(r.reservationId);
});

test('release frees the triple for re-use', async () => {
  const a = db.reservePortTriple(300);
  db.releaseReservation(a.reservationId);
  const b = db.reservePortTriple(301);
  assert.equal(b.port, a.port, 'port should be reusable after release');
  db.releaseReservation(b.reservationId);
});

test('markReservationLive transitions state', async () => {
  const r = db.reservePortTriple(400);
  db.markReservationSpawning(r.reservationId, 12345);
  db.markReservationLive(r.reservationId);
  const all = db.listReservations().filter((x) => x.reservationId === r.reservationId);
  assert.equal(all.length, 3);
  assert.ok(all.every((x) => x.state === 'live'));
  assert.ok(all.every((x) => x.pid === 12345));
  db.releaseReservation(r.reservationId);
});

test('findStaleReservations with negative cutoff returns recent reserving rows', async () => {
  const r = db.reservePortTriple(500);
  // Negative threshold means "anything reserved before time + |t|" — i.e. future.
  // So all current rows look stale.
  const stale = db.findStaleReservations(-10_000);
  const found = stale.find((x) => x.reservationId === r.reservationId);
  assert.ok(found, 'recent reserving row should be returned with future cutoff');
  db.releaseReservation(r.reservationId);
});

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});
