// index_store.test.mjs — 存储 ORM 索引引擎单测（node:test）
// 覆盖：实体 CRUD / 索引版本 / 原子落盘 / 崩溃模拟 / 漂移比对（纯函数）
//
// 隔离要点：所有仓储实例都绑定到临时目录（rootDir），绝不触碰真实缓冲盘路径。

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore, computeDrift, readIndex, INDEX_FILE, INDEX_VERSION } from '../index_store.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

let tmpRoot;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'gss-store-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** 构造一个快照实体 */
function snap(fullName, sha, over = {}) {
  return {
    fullName,
    group: 'demo',
    commitSha: sha,
    commitShort: sha.slice(0, 7),
    commitDate: '2026-11-27T10:00:00+08:00',
    archiveName: `${fullName.replace('/', '__')}-${sha.slice(0, 7)}.bundle`,
    archiveFormat: 'git-bundle',
    sizeBytes: 1024,
    checksumSha256: 'c'.repeat(64),
    tags: ['demo'],
    ...over,
  };
}

/** 构造一条同步记账实体 */
function rec(fullName, sha, over = {}) {
  return {
    repoFullName: fullName,
    targetId: 'local',
    syncedCommitSha: sha,
    syncedArchiveName: snap(fullName, sha).archiveName,
    syncedAt: '2026-11-27T10:05:00+08:00',
    status: 'synced',
    ...over,
  };
}

describe('IndexStore 实体 CRUD', () => {
  it('save 新增快照并落盘，get 可命中', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    const saved = store.save(snap('o/r', SHA_A));
    assert.strictEqual(saved.fullName, 'o/r');
    assert.deepStrictEqual(store.get('o/r'), saved);
    const onDisk = JSON.parse(readFileSync(join(tmpRoot, INDEX_FILE), 'utf-8'));
    assert.strictEqual(onDisk.snapshots['o/r'].commitSha, SHA_A);
  });

  it('save 同 fullName 覆盖为更新', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.save(snap('o/r', SHA_A));
    store.save(snap('o/r', SHA_B));
    assert.strictEqual(store.list().length, 1);
    assert.strictEqual(store.get('o/r').commitSha, SHA_B);
  });

  it('get 未命中返回 null', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    assert.strictEqual(store.get('nope/none'), null);
  });

  it('list 返回全部快照并按 fullName 排序', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.save(snap('b/two', SHA_A));
    store.save(snap('a/one', SHA_A));
    assert.deepStrictEqual(store.list().map((s) => s.fullName), ['a/one', 'b/two']);
  });

  it('delete 只移除索引条目，不做物理 unlink', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.save(snap('o/r', SHA_A));
    assert.strictEqual(store.delete('o/r'), true);
    assert.strictEqual(store.get('o/r'), null);
    assert.strictEqual(store.delete('o/r'), false);
    assert.ok(existsSync(join(tmpRoot, INDEX_FILE)), '索引文件必须保留');
  });

  it('recordSync 落盘同步记账并可列出', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.recordSync(rec('o/r', SHA_A));
    const records = store.listSyncRecords();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].syncedCommitSha, SHA_A);
    assert.strictEqual(records[0].status, 'synced');
  });

  it('saveTarget 落盘存储目标并可列出', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.saveTarget({ id: 'nas', type: 'smb', endpoint: '//nas/share', enabled: true, priority: 1 });
    const targets = store.listTargets();
    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].type, 'smb');
    assert.strictEqual(targets[0].enabled, true);
  });

  it('索引文件带 version 字段并可原样读回', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.save(snap('o/r', SHA_A));
    const raw = JSON.parse(readFileSync(join(tmpRoot, INDEX_FILE), 'utf-8'));
    assert.strictEqual(raw.version, INDEX_VERSION);
    assert.strictEqual(typeof raw.updatedAt, 'string');
    assert.strictEqual(readIndex(join(tmpRoot, INDEX_FILE)).version, INDEX_VERSION);
  });

  it('拒绝读取比当前实现更新的 schema 版本', () => {
    const indexPath = join(tmpRoot, INDEX_FILE);
    writeFileSync(indexPath, JSON.stringify({ version: '99.0', snapshots: {} }), 'utf-8');
    assert.throws(() => readIndex(indexPath), /版本过新/);
  });

  it('非法枚举值被拒绝', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    assert.throws(() => store.save(snap('o/r', SHA_A, { archiveFormat: 'zip' })), /archiveFormat/);
    assert.throws(() => store.recordSync(rec('o/r', SHA_A, { status: 'unknown' })), /status/);
    assert.throws(() => store.saveTarget({ id: 't', type: 'ftp', endpoint: 'x' }), /type/);
  });
});

describe('IndexStore 原子落盘', () => {
  it('成功写入后不留 .tmp 残卷', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.save(snap('o/r', SHA_A));
    assert.strictEqual(existsSync(join(tmpRoot, `${INDEX_FILE}.tmp`)), false);
  });

  it('模拟写入中断：旧索引仍可读且内容完好', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.save(snap('o/r', SHA_A));
    store.onBeforeRename = () => {
      throw new Error('模拟断电');
    };
    assert.throws(() => store.save(snap('o/r', SHA_B)), /模拟断电/);
    const onDisk = JSON.parse(readFileSync(join(tmpRoot, INDEX_FILE), 'utf-8'));
    assert.strictEqual(onDisk.snapshots['o/r'].commitSha, SHA_A, '旧索引内容必须完好');
    assert.strictEqual(onDisk.version, INDEX_VERSION);
    assert.strictEqual(new IndexStore({ rootDir: tmpRoot }).get('o/r').commitSha, SHA_A);
    assert.ok(existsSync(join(tmpRoot, `${INDEX_FILE}.tmp`)), '中断应留下 .tmp 残卷待 clean-staging 清理');
  });

  it('中断后重试持久化可恢复写入', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.save(snap('o/r', SHA_A));
    store.onBeforeRename = () => {
      throw new Error('模拟断电');
    };
    assert.throws(() => store.save(snap('o/r', SHA_B)), /模拟断电/);
    store.onBeforeRename = null;
    store.persist();
    const onDisk = JSON.parse(readFileSync(join(tmpRoot, INDEX_FILE), 'utf-8'));
    assert.strictEqual(onDisk.snapshots['o/r'].commitSha, SHA_B);
  });

  it('commit：快照与记账一次原子落盘', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.commit(snap('o/r', SHA_A), rec('o/r', SHA_A));
    const onDisk = JSON.parse(readFileSync(join(tmpRoot, INDEX_FILE), 'utf-8'));
    assert.strictEqual(onDisk.snapshots['o/r'].commitSha, SHA_A);
    assert.strictEqual(onDisk.syncRecords['o/r::local'].status, 'synced');
    assert.strictEqual(store.listSyncRecords().length, 1);
  });

  it('commit 中断：旧索引完好，不留「有快照无记账」中间态', () => {
    const store = new IndexStore({ rootDir: tmpRoot });
    store.commit(snap('o/r', SHA_A), rec('o/r', SHA_A));
    store.onBeforeRename = () => {
      throw new Error('模拟断电');
    };
    assert.throws(() => store.commit(snap('o/r', SHA_B), rec('o/r', SHA_B)), /模拟断电/);
    const onDisk = JSON.parse(readFileSync(join(tmpRoot, INDEX_FILE), 'utf-8'));
    assert.strictEqual(onDisk.snapshots['o/r'].commitSha, SHA_A, '旧快照必须完好');
    assert.strictEqual(onDisk.syncRecords['o/r::local'].syncedCommitSha, SHA_A, '旧记账必须完好');
    const fresh = new IndexStore({ rootDir: tmpRoot });
    assert.strictEqual(fresh.get('o/r').commitSha, SHA_A);
    assert.strictEqual(fresh.listSyncRecords().length, 1);
  });
});

describe('computeDrift 漂移比对（纯函数）', () => {
  it('commitSha + archiveName 一致时判定为已对齐', () => {
    const drift = computeDrift([snap('o/r', SHA_A)], [rec('o/r', SHA_A)]);
    assert.strictEqual(drift.upToDate.length, 1);
    assert.strictEqual(drift.toUpload.length, 0);
    assert.strictEqual(drift.toTrash.length, 0);
  });

  it('本地有而目标端没有的快照进入 toUpload', () => {
    const drift = computeDrift([snap('o/r', SHA_A)], []);
    assert.deepStrictEqual(drift.toUpload.map((s) => s.fullName), ['o/r']);
    assert.strictEqual(drift.upToDate.length, 0);
  });

  it('目标端有而本地没有的记录进入 toTrash', () => {
    const drift = computeDrift([], [rec('o/r', SHA_A)]);
    assert.deepStrictEqual(drift.toTrash.map((r) => r.repoFullName), ['o/r']);
    assert.strictEqual(drift.toUpload.length, 0);
  });

  it('commitSha 相同但 archiveName 不同判定为漂移', () => {
    const local = snap('o/r', SHA_A);
    const drifted = rec('o/r', SHA_A, { syncedArchiveName: 'o__r-old.bundle' });
    const drift = computeDrift([local], [drifted]);
    assert.strictEqual(drift.toUpload.length, 1);
    assert.strictEqual(drift.toTrash.length, 1);
    assert.strictEqual(drift.upToDate.length, 0);
  });

  it('忽略跨系统 mtime：时间戳不同仍判定为已对齐', () => {
    const local = snap('o/r', SHA_A, { mtime: 1700000000 });
    const record = rec('o/r', SHA_A, { syncedAt: '2020-01-01T00:00:00Z' });
    const drift = computeDrift([local], [record]);
    assert.strictEqual(drift.upToDate.length, 1);
    assert.strictEqual(drift.toUpload.length, 0);
    assert.strictEqual(drift.toTrash.length, 0);
  });

  it('purged 记录既不需上传也无需回收', () => {
    const drift = computeDrift([], [rec('o/r', SHA_A, { status: 'purged' })]);
    assert.strictEqual(drift.toTrash.length, 0);
    assert.strictEqual(drift.toUpload.length, 0);
    assert.strictEqual(drift.upToDate.length, 0);
  });

  it('纯函数：输入不被修改，多次调用结果一致', () => {
    const locals = [snap('o/r', SHA_A)];
    const records = [rec('o/r', SHA_A)];
    const before = JSON.stringify({ locals, records });
    const first = computeDrift(locals, records);
    const second = computeDrift(locals, records);
    assert.deepStrictEqual(first, second);
    assert.strictEqual(JSON.stringify({ locals, records }), before);
  });
});
