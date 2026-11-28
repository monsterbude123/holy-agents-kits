// lifecycle.test.mjs — 生命周期清理引擎单测（node:test，零依赖）
// 覆盖：铁律1 绝对保底 / 铁律2 演练优先 / 铁律3 索引先行 / 铁律4 孤儿防御 + TTL 边界。
// 全部用例在 mkdtemp 临时目录内跑；afterEach 强删（Windows 需 maxRetries 抗 EBUSY）。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LocalFsDriver } from '../local_driver.mjs';
import { IndexStore } from '../index_store.mjs';
import { DRIVER_ERROR_CODES } from '../driver_spi.mjs';
import {
  evaluateRetention, isExpired, scanExpiredTrash, purgeExpired,
  scanOrphans, quarantineOrphans, softEvict, summarizePlan,
} from '../lifecycle.mjs';

const REPO = 'owner/repo';
const ARCHIVE = 'owner__repo-aaa1111.bundle';
const DAY = 86400000;

let tmpRoot, media, buffer, driver, store;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'gss-'));
  media = join(tmpRoot, 'media');
  buffer = join(tmpRoot, 'buffer');
  mkdirSync(media, { recursive: true });
  mkdirSync(buffer, { recursive: true });
  driver = new LocalFsDriver({ root: media });
  store = new IndexStore({ rootDir: buffer });
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const snap = (over = {}) => ({
  fullName: REPO, group: 'owner', commitSha: 'sha-aaa1111', commitShort: 'aaa1111',
  commitDate: '2026-01-01T00:00:00Z', archiveName: ARCHIVE, archiveFormat: 'git-bundle',
  sizeBytes: 12, checksumSha256: 'deadbeef', tags: [], ...over,
});
const stampOf = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const trashPath = (name, body = 'payload') => {
  const p = join(media, '.trash', name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
  return p;
};
const countFiles = (dir) => {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
  return n;
};
/** 登记到本地 Ledger + 介质索引（模拟一次已同步的快照） */
const register = async (archiveName = ARCHIVE) => {
  store.save(snap({ archiveName }));
  store.recordSync({ repoFullName: REPO, targetId: 't1', syncedCommitSha: 'sha-aaa1111', syncedArchiveName: archiveName, syncedAt: '2026-01-01T00:00:00Z', status: 'synced' });
  await driver.writeIndex({
    version: '1.0', updatedAt: null,
    snapshots: { [REPO]: snap({ archiveName }) },
    syncRecords: { [`${REPO}::t1`]: { repoFullName: REPO, targetId: 't1', syncedCommitSha: 'sha-aaa1111', syncedArchiveName: archiveName, syncedAt: '2026-01-01T00:00:00Z', status: 'synced' } },
    targets: {},
  });
};

describe('铁律1 绝对保底律：任何仓库至少保留 1 个最新可用快照', () => {
  it('仓库只有 1 个快照时，淘汰清单为空（不得列入淘汰）', () => {
    const r = evaluateRetention([snap()], 2);
    assert.equal(r.trash.length, 0);
    assert.equal(r.keep.length, 1);
    assert.equal(r.floorKept, true);
  });
  it('3 个快照 + keepCount=2 → 淘汰 1 个，且保底留最新 1 个', () => {
    const snaps = [
      snap({ archiveName: 'old.bundle', commitSha: 'sha-old', commitDate: '2026-01-01T00:00:00Z' }),
      snap({ archiveName: 'mid.bundle', commitSha: 'sha-mid', commitDate: '2026-02-01T00:00:00Z' }),
      snap({ archiveName: 'new.bundle', commitSha: 'sha-new', commitDate: '2026-03-01T00:00:00Z' }),
    ];
    const r = evaluateRetention(snaps, 2);
    assert.equal(r.trash.length, 1);
    assert.equal(r.trash[0].archiveName, 'old.bundle');
    assert.equal(r.keep.length, 2);
    assert.ok(r.keep.some((s) => s.archiveName === 'new.bundle'), '最新快照必须被保留');
    assert.equal(r.floorKept, true);
  });
  it('keepCount=0 / 负数被硬夹为 1：绝不把仓库清零', () => {
    const snaps = [1, 2, 3].map((i) => snap({ archiveName: `s${i}.bundle`, commitSha: `sha${i}`, commitDate: `2026-0${i}-01T00:00:00Z` }));
    for (const kc of [0, -5, undefined, null]) {
      const r = evaluateRetention(snaps, kc);
      assert.ok(r.keep.length >= 1, `keepCount=${kc} 必须至少保留 1 个`);
      assert.equal(r.floorKept, true);
      assert.ok(r.trash.length < snaps.length, '绝不允许淘汰全部快照');
    }
  });
});

describe('阶段3 冷却期 TTL 精确判定', () => {
  it('恰好等于 TTL 判为到期（保护窗口 = [0, TTL)），差 1ms 未到期则不算', () => {
    const base = Date.parse('2026-01-01T00:00:00Z');
    const entry = { name: '20260101T000000Z_x.bundle' };
    assert.equal(isExpired(entry, 7, base + 7 * DAY), true, '恰好 7 天 = 到期');
    assert.equal(isExpired(entry, 7, base + 7 * DAY - 1), false, '差 1ms 仍在冷却期');
    assert.equal(isExpired(entry, 7, base + 6 * DAY), false, '冷却期内不算到期');
  });
  it('scanExpiredTrash：超期进 expired，冷却期进 cooling，孤儿目录默认排除', async () => {
    await register();
    trashPath('20260101T000000Z_owner__repo-aaa1111.bundle'); // 早已超期
    trashPath(`${stampOf(new Date())}_owner__repo-ccc3333.bundle`); // 刚进回收站
    const old = trashPath('no-stamp.bundle');
    const oldMs = (Date.now() - 10 * DAY) / 1000;
    utimesSync(old, oldMs, oldMs); // 无时间戳名 → 退化按 mtime 判定
    trashPath(join('orphans', '20260101T000000Z_stray.bundle'));

    const r = await scanExpiredTrash(driver, 7);
    assert.equal(r.expired.length, 2, '超期文件应被识别（含 mtime 兜底）');
    assert.equal(r.cooling.length, 1, '冷却期内文件不得列入');
    assert.ok(r.expired.some((f) => f.archiveName === ARCHIVE));
    assert.equal(r.expired.find((f) => f.archiveName === ARCHIVE).repoFullName, REPO, '必须给出所属仓库');
    assert.ok(!r.expired.some((f) => f.path.includes('/orphans/')), '孤儿目录默认不参与物理清理');
    assert.ok(r.totalBytes > 0);
  });
});

describe('铁律2 演练优先律：默认 dry-run，零破坏性', () => {
  it('dry-run 后 .trash/ 与介质目录一个文件都没少，且给出拟删清单与可释放字节数', async () => {
    await register();
    const p = trashPath('20260101T000000Z_owner__repo-aaa1111.bundle', 'x'.repeat(64));
    const before = countFiles(media);
    const scan = await scanExpiredTrash(driver, 7);
    const res = await purgeExpired(driver, scan.expired, { store });
    assert.equal(res.dryRun, true);
    assert.equal(res.purged.length, 0);
    assert.equal(res.fileCount, 1);
    assert.ok(res.freedBytes > 0, '必须报告可释放字节数');
    assert.equal(countFiles(media), before, 'dry-run 不得减少任何文件');
    assert.equal(existsSync(p), true, 'dry-run 不得删除目标文件');
  });
  it('softEvict 默认 dry-run：只出清单，不进回收站', async () => {
    writeFileSync(join(media, 'a.bundle'), 'x');
    const res = await softEvict(driver, [{ path: 'a.bundle', archiveName: 'a.bundle', sizeBytes: 1 }]);
    assert.equal(res.dryRun, true);
    assert.equal(res.moved.length, 0);
    assert.equal(existsSync(join(media, 'a.bundle')), true);
    assert.equal(existsSync(join(media, '.trash')), false, 'dry-run 不得创建回收站落点');
  });
});

describe('铁律3 索引先行：先记账落盘，再物理删除', () => {
  it('传真执行标志后文件才消失，且索引记账状态为 purged、索引未写坏', async () => {
    await register();
    const p = trashPath('20260101T000000Z_owner__repo-aaa1111.bundle');
    const scan = await scanExpiredTrash(driver, 7);
    const res = await purgeExpired(driver, scan.expired, { store, execute: true });
    assert.equal(res.dryRun, false);
    assert.equal(res.purged.length, 1);
    assert.equal(res.failed.length, 0);
    assert.equal(existsSync(p), false, '传真执行标志后才允许物理删除');

    const ledger = JSON.parse(readFileSync(join(buffer, '.ghh-index.json'), 'utf-8'));
    assert.equal(ledger.version, '1.0', '索引 schema 不得被写坏');
    assert.equal(ledger.syncRecords[`${REPO}::t1`].status, 'purged');
    const media = await driver.readIndex();
    assert.equal(media.syncRecords[`${REPO}::t1`].status, 'purged');
    assert.equal(media.snapshots[REPO].status, 'purged');
    assert.deepEqual(store.listSyncRecords()[0].repoFullName, REPO, '其余记账字段必须保留');
  });
  it('物理删除发生时索引已是 purged（索引先行时序）', async () => {
    await register();
    trashPath('20260101T000000Z_owner__repo-aaa1111.bundle');
    const seen = [];
    class SpyDriver extends LocalFsDriver {
      async _purge(p) {
        seen.push(readFileSync(join(media, '.ghh-index.json'), 'utf-8'));
        return super._purge(p);
      }
    }
    const spy = new SpyDriver({ root: media });
    const scan = await scanExpiredTrash(spy, 7);
    await purgeExpired(spy, scan.expired, { store, execute: true });
    assert.equal(seen.length, 1);
    assert.match(seen[0], /"status": "purged"/, '删除前索引必须已记账 purged');
  });
  it('冷却期内文件即使传真执行标志也不删（阶段3 保护），且索引不变', async () => {
    await register();
    const p = trashPath(`${stampOf(new Date())}_owner__repo-aaa1111.bundle`);
    const scan = await scanExpiredTrash(driver, 7);
    assert.equal(scan.expired.length, 0);
    const res = await purgeExpired(driver, scan.cooling, { store, execute: true });
    assert.equal(res.purged.length, 0);
    assert.equal(res.skipped.length, 1);
    assert.equal(res.skipped[0].reason, 'within-cooldown');
    assert.equal(existsSync(p), true, '冷却期内文件必须留在回收站');
    assert.equal(store.listSyncRecords()[0].status, 'synced', '未到期不得记账核销');
  });
  it('无索引记账目标时拒绝物理删除（文件仍在）', async () => {
    trashPath('20260101T000000Z_owner__repo-aaa1111.bundle');
    const scan = await scanExpiredTrash(driver, 7);
    await assert.rejects(() => purgeExpired(driver, scan.expired, { execute: true }), (e) => e.code === DRIVER_ERROR_CODES.GSS_E_INVALID_ARG);
    assert.equal(countFiles(join(media, '.trash')), 1, '拒绝执行时不得删除任何文件');
  });
});

describe('铁律4 孤儿防御：未登记游离文件只隔离不删除', () => {
  it('孤儿被扫描出来，dry-run 不动它，真执行隔离到 .trash/orphans/ 且文件仍在', async () => {
    await register();
    const stray = join(media, 'stray.bundle');
    writeFileSync(stray, 'not-in-index');
    const { orphans } = await scanOrphans(driver);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].name, 'stray.bundle');

    const dry = await quarantineOrphans(driver, orphans);
    assert.equal(dry.dryRun, true);
    assert.equal(existsSync(stray), true, 'dry-run 不得移动孤儿');
    assert.equal(existsSync(join(media, '.trash', 'orphans')), false);

    const done = await quarantineOrphans(driver, orphans, { execute: true });
    assert.equal(done.quarantined.length, 1);
    assert.ok(done.quarantined[0].quarantinePath.includes('/orphans/'), '必须隔离到 .trash/orphans/');
    assert.equal(existsSync(stray), false, '原件应被移走');
    assert.equal(existsSync(done.quarantined[0].quarantinePath), true, '隔离不等于删除：文件必须还在，等人工裁决');
  });
  it('已登记的文件不算孤儿', async () => {
    await register();
    writeFileSync(join(media, ARCHIVE), 'registered');
    const { orphans } = await scanOrphans(driver);
    assert.equal(orphans.length, 0);
  });
});

describe('dry-run 汇总', () => {
  it('summarizePlan 给出文件数与可释放字节数', () => {
    const s = summarizePlan([{ size: 10 }, { size: 5 }, null]);
    assert.equal(s.fileCount, 2);
    assert.equal(s.freedBytes, 15);
  });
});
