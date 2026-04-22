// node --test server/lib/comments.test.cjs
//
// Tests for task_comments DB layer: add, list, update, soft-delete, recent-N.
// Uses an isolated DATA_DIR so the real aoc.db is untouched.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-comments-test-'));
process.env.AOC_DATA_DIR = TMP;
process.env.JWT_SECRET = 'test-secret';

const db = require('./db.cjs');

let task;

test.before(async () => {
  await db.initDatabase();
  // Seed a task so comments have a parent. createTask is available on the module.
  task = db.createTask({ title: 'Parent task', agentId: 'tester' });
});

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('addTaskComment rejects empty body / bad authorType', () => {
  assert.throws(() => db.addTaskComment({ taskId: task.id, authorType: 'user', authorId: '1', body: '' }), /body/);
  assert.throws(() => db.addTaskComment({ taskId: task.id, authorType: 'user', authorId: '1', body: '   ' }), /body/);
  assert.throws(() => db.addTaskComment({ taskId: task.id, authorType: 'other', authorId: '1', body: 'hi' }), /authorType/);
  assert.throws(() => db.addTaskComment({ authorType: 'user', authorId: '1', body: 'hi' }), /taskId/);
});

test('addTaskComment + listTaskComments round-trip', () => {
  const c1 = db.addTaskComment({ taskId: task.id, authorType: 'user',  authorId: '42', authorName: 'Alice', body: 'first' });
  const c2 = db.addTaskComment({ taskId: task.id, authorType: 'agent', authorId: 'bob', authorName: 'Bob',   body: 'second' });

  assert.equal(c1.authorType, 'user');
  assert.equal(c1.authorId, '42');
  assert.equal(c1.authorName, 'Alice');
  assert.equal(c2.authorType, 'agent');

  const list = db.listTaskComments(task.id);
  assert.equal(list.length, 2);
  // Ordered ASC by created_at
  assert.equal(list[0].id, c1.id);
  assert.equal(list[1].id, c2.id);
});

test('updateTaskComment sets edited_at and rejects empty body', () => {
  const c = db.addTaskComment({ taskId: task.id, authorType: 'user', authorId: '1', body: 'original' });
  assert.equal(c.editedAt, undefined);

  const updated = db.updateTaskComment(c.id, { body: 'changed' });
  assert.equal(updated.body, 'changed');
  assert.ok(updated.editedAt, 'editedAt should be set after update');

  assert.throws(() => db.updateTaskComment(c.id, { body: '' }), /body/);
});

test('deleteTaskComment soft-deletes and hides from default list', () => {
  const c = db.addTaskComment({ taskId: task.id, authorType: 'user', authorId: '1', body: 'to delete' });
  const deleted = db.deleteTaskComment(c.id);
  assert.ok(deleted.deletedAt, 'deletedAt should be set');

  const defaultList = db.listTaskComments(task.id);
  assert.equal(defaultList.find(x => x.id === c.id), undefined, 'should be hidden by default');

  const withDeleted = db.listTaskComments(task.id, { includeDeleted: true });
  assert.ok(withDeleted.find(x => x.id === c.id), 'should appear when includeDeleted=true');
});

test('getRecentTaskComments returns last N, oldest-first, excludes deleted', async () => {
  const task2 = db.createTask({ title: 'Recent-N probe', agentId: 'tester' });
  // Insert 5 comments with distinct timestamps
  const created = [];
  for (let i = 0; i < 5; i++) {
    created.push(db.addTaskComment({ taskId: task2.id, authorType: 'user', authorId: '1', body: `msg-${i}` }));
    await new Promise(r => setTimeout(r, 10));
  }
  // Delete the middle one
  db.deleteTaskComment(created[2].id);

  const recent3 = db.getRecentTaskComments(task2.id, 3);
  // Out of [msg-0..msg-4] minus msg-2 → remaining {0,1,3,4}; last 3 DESC = [4,3,1], reversed ASC = [1,3,4]
  const bodies = recent3.map(c => c.body);
  assert.deepEqual(bodies, ['msg-1', 'msg-3', 'msg-4']);
});
