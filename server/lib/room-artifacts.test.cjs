'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const os     = require('node:os');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── Isolation helpers ────────────────────────────────────────────────────────

function clearRequireCache() {
  delete require.cache[require.resolve('./db.cjs')];
  delete require.cache[require.resolve('./config.cjs')];
  delete require.cache[require.resolve('./room-artifacts.cjs')];
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('room-artifacts', () => {
  let db, artifacts, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-artifacts-'));
    process.env.AOC_DATA_DIR  = tmpDir;
    process.env.OPENCLAW_HOME = tmpDir;

    clearRequireCache();
    db        = require('./db.cjs');
    artifacts = require('./room-artifacts.cjs');

    await db.initDatabase();

    // Create a test room to satisfy the FK constraint
    db.getDb().run(
      "INSERT INTO mission_rooms (id, kind, name, member_agent_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ['room-1', 'global', 'Test Room', '[]', new Date().toISOString(), new Date().toISOString()]
    );
  });

  after(() => {
    clearRequireCache();
    delete process.env.AOC_DATA_DIR;
    delete process.env.OPENCLAW_HOME;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  // ── createArtifact ──────────────────────────────────────────────────────────

  it('createArtifact stores artifact + version in DB and file on disk', () => {
    const { artifact, version } = artifacts.createArtifact({
      roomId:    'room-1',
      category:  'outputs',
      title:     'Sprint Report',
      description: 'Q1 sprint summary',
      tags:      ['sprint', 'q1'],
      createdBy: 'agent-pm',
      content:   '# Sprint Report\nAll done.',
      fileName:  'sprint-report.md',
      mimeType:  'text/markdown',
    });

    // Artifact shape
    assert.ok(artifact, 'artifact returned');
    assert.ok(artifact.id, 'artifact has id');
    assert.equal(artifact.roomId, 'room-1');
    assert.equal(artifact.category, 'outputs');
    assert.equal(artifact.title, 'Sprint Report');
    assert.equal(artifact.description, 'Q1 sprint summary');
    assert.deepStrictEqual(artifact.tags, ['sprint', 'q1']);
    assert.equal(artifact.createdBy, 'agent-pm');
    assert.equal(artifact.pinned, false);
    assert.equal(artifact.archived, false);
    assert.ok(artifact.latestVersionId, 'latestVersionId set');

    // Version shape
    assert.ok(version, 'version returned');
    assert.ok(version.id, 'version has id');
    assert.equal(version.artifactId, artifact.id);
    assert.equal(version.versionNumber, 1);
    assert.equal(version.fileName, 'sprint-report.md');
    assert.equal(version.mimeType, 'text/markdown');
    assert.ok(version.sizeBytes > 0, 'size_bytes > 0');
    assert.ok(version.sha256, 'sha256 set');
    assert.ok(version.filePath, 'filePath set');

    // File on disk
    assert.ok(fs.existsSync(version.filePath), 'file exists on disk');
    const diskContent = fs.readFileSync(version.filePath, 'utf-8');
    assert.equal(diskContent, '# Sprint Report\nAll done.');

    // latest_version_id matches version.id
    assert.equal(artifact.latestVersionId, version.id);
  });

  // ── addArtifactVersion ──────────────────────────────────────────────────────

  it('addArtifactVersion increments version_number and updates latest_version_id', () => {
    const { artifact: art1 } = artifacts.createArtifact({
      roomId:    'room-1',
      category:  'research',
      title:     'Market Research',
      createdBy: 'agent-pm',
      content:   'Initial findings.',
      fileName:  'research-v1.md',
    });

    const { version: v2, artifact: art2 } = artifacts.addArtifactVersion({
      artifactId: art1.id,
      content:    'Updated findings with more data.',
      fileName:   'research-v2.md',
      mimeType:   'text/plain',
      createdBy:  'agent-pm',
    });

    assert.equal(v2.versionNumber, 2, 'second version is #2');
    assert.equal(v2.artifactId, art1.id);
    assert.equal(v2.fileName, 'research-v2.md');

    // Artifact's latestVersionId is updated
    assert.equal(art2.latestVersionId, v2.id);
    assert.notEqual(art2.latestVersionId, art1.latestVersionId, 'latest_version_id changed');

    // File exists on disk
    assert.ok(fs.existsSync(v2.filePath), 'v2 file exists on disk');
    const diskContent = fs.readFileSync(v2.filePath, 'utf-8');
    assert.equal(diskContent, 'Updated findings with more data.');
  });

  // ── listArtifacts ───────────────────────────────────────────────────────────

  it('listArtifacts returns non-archived by default', () => {
    // Create a room just for this test to avoid cross-test contamination
    db.getDb().run(
      "INSERT INTO mission_rooms (id, kind, name, member_agent_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ['room-list-test', 'global', 'List Test Room', '[]', new Date().toISOString(), new Date().toISOString()]
    );

    const { artifact: active } = artifacts.createArtifact({
      roomId: 'room-list-test', category: 'briefs', title: 'Active Brief',
      createdBy: 'agent-pm', content: 'active', fileName: 'active.md',
    });
    const { artifact: toArchive } = artifacts.createArtifact({
      roomId: 'room-list-test', category: 'briefs', title: 'Archived Brief',
      createdBy: 'agent-pm', content: 'archived', fileName: 'archived.md',
    });

    artifacts.archiveArtifact(toArchive.id, true);

    const list = artifacts.listArtifacts({ roomId: 'room-list-test' });
    const ids  = list.map(a => a.id);
    assert.ok(ids.includes(active.id), 'active artifact in list');
    assert.ok(!ids.includes(toArchive.id), 'archived artifact NOT in default list');
  });

  it('listArtifacts filters by category', () => {
    db.getDb().run(
      "INSERT INTO mission_rooms (id, kind, name, member_agent_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ['room-cat-test', 'global', 'Cat Test Room', '[]', new Date().toISOString(), new Date().toISOString()]
    );

    artifacts.createArtifact({
      roomId: 'room-cat-test', category: 'decisions', title: 'Decision 1',
      createdBy: 'agent-pm', content: 'dec', fileName: 'dec.md',
    });
    artifacts.createArtifact({
      roomId: 'room-cat-test', category: 'outputs', title: 'Output 1',
      createdBy: 'agent-pm', content: 'out', fileName: 'out.md',
    });

    const decisions = artifacts.listArtifacts({ roomId: 'room-cat-test', category: 'decisions' });
    assert.ok(decisions.every(a => a.category === 'decisions'), 'all decisions');
    assert.ok(decisions.length >= 1);

    const outputs = artifacts.listArtifacts({ roomId: 'room-cat-test', category: 'outputs' });
    assert.ok(outputs.every(a => a.category === 'outputs'), 'all outputs');
  });

  // ── getArtifact ─────────────────────────────────────────────────────────────

  it('getArtifact returns artifact with all versions', () => {
    const { artifact } = artifacts.createArtifact({
      roomId: 'room-1', category: 'assets', title: 'Multi-version Asset',
      createdBy: 'agent-pm', content: 'v1 content', fileName: 'asset-v1.txt',
    });

    artifacts.addArtifactVersion({
      artifactId: artifact.id, content: 'v2 content',
      fileName: 'asset-v2.txt', createdBy: 'agent-pm',
    });

    const result = artifacts.getArtifact(artifact.id);
    assert.ok(result, 'result returned');
    assert.ok(result.artifact, 'has artifact');
    assert.ok(Array.isArray(result.versions), 'versions is array');
    assert.equal(result.versions.length, 2, '2 versions');
    assert.equal(result.versions[0].versionNumber, 1);
    assert.equal(result.versions[1].versionNumber, 2);
  });

  it('getArtifact returns null for unknown id', () => {
    const result = artifacts.getArtifact('non-existent-id');
    assert.equal(result, null);
  });

  // ── getArtifactContent ──────────────────────────────────────────────────────

  it('getArtifactContent reads correct file from disk', () => {
    const content1 = '# Doc v1\nFirst draft.';
    const content2 = '# Doc v2\nSecond draft.';

    const { artifact } = artifacts.createArtifact({
      roomId: 'room-1', category: 'briefs', title: 'Content Read Test',
      createdBy: 'agent-pm', content: content1, fileName: 'doc-v1.md',
    });

    artifacts.addArtifactVersion({
      artifactId: artifact.id, content: content2,
      fileName: 'doc-v2.md', createdBy: 'agent-pm',
    });

    const r1 = artifacts.getArtifactContent(artifact.id, 1);
    assert.ok(r1, 'v1 result returned');
    assert.equal(r1.content, content1);
    assert.equal(r1.version.versionNumber, 1);

    const r2 = artifacts.getArtifactContent(artifact.id, 2);
    assert.ok(r2, 'v2 result returned');
    assert.equal(r2.content, content2);
    assert.equal(r2.version.versionNumber, 2);
  });

  it('getArtifactContent returns null for unknown version', () => {
    const { artifact } = artifacts.createArtifact({
      roomId: 'room-1', category: 'outputs', title: 'No ver 99',
      createdBy: 'agent-pm', content: 'x', fileName: 'x.md',
    });
    const result = artifacts.getArtifactContent(artifact.id, 99);
    assert.equal(result, null);
  });

  // ── pinArtifact ─────────────────────────────────────────────────────────────

  it('pinArtifact toggles pinned flag', () => {
    const { artifact } = artifacts.createArtifact({
      roomId: 'room-1', category: 'decisions', title: 'Pin Test',
      createdBy: 'agent-pm', content: 'pin me', fileName: 'pin.md',
    });

    assert.equal(artifact.pinned, false);

    const pinned = artifacts.pinArtifact(artifact.id, true);
    assert.equal(pinned.pinned, true);

    const unpinned = artifacts.pinArtifact(artifact.id, false);
    assert.equal(unpinned.pinned, false);
  });

  // ── archiveArtifact ─────────────────────────────────────────────────────────

  it('archiveArtifact toggles archived flag', () => {
    const { artifact } = artifacts.createArtifact({
      roomId: 'room-1', category: 'research', title: 'Archive Test',
      createdBy: 'agent-pm', content: 'archive me', fileName: 'archive.md',
    });

    assert.equal(artifact.archived, false);

    const archived = artifacts.archiveArtifact(artifact.id, true);
    assert.equal(archived.archived, true);

    const unarchived = artifacts.archiveArtifact(artifact.id, false);
    assert.equal(unarchived.archived, false);
  });

  // ── deleteArtifact ──────────────────────────────────────────────────────────

  it('deleteArtifact removes from DB and disk', () => {
    const { artifact, version } = artifacts.createArtifact({
      roomId: 'room-1', category: 'assets', title: 'Delete Me',
      createdBy: 'agent-pm', content: 'bye bye', fileName: 'delete-me.md',
    });

    const filePathBeforeDelete = version.filePath;
    assert.ok(fs.existsSync(filePathBeforeDelete), 'file exists before delete');

    artifacts.deleteArtifact(artifact.id);

    // Not in DB
    const result = artifacts.getArtifact(artifact.id);
    assert.equal(result, null, 'artifact not found after delete');

    // Directory purged from disk
    const dirPath = path.dirname(filePathBeforeDelete);  // version dir
    const artifactDir = path.dirname(dirPath);            // artifact dir
    assert.ok(!fs.existsSync(artifactDir), 'artifact dir removed from disk');
  });

  // ── category validation ─────────────────────────────────────────────────────

  it('createArtifact rejects invalid category', () => {
    assert.throws(
      () => artifacts.createArtifact({
        roomId:    'room-1',
        category:  'invalid-cat',
        title:     'Bad Category',
        createdBy: 'agent-pm',
        content:   'x',
        fileName:  'x.md',
      }),
      /Invalid category/i
    );
  });
});
