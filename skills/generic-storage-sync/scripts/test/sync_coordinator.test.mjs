// sync_coordinator.test.mjs — 两阶段提交协调器集成测试（node:test，零依赖）
// 介质用真 LocalFsDriver（真文件、真 .trash/、真原子索引），只替换 upload / purge 钩子模拟故障。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LocalFsDriver } from '../local_driver.mjs';
import { DriverError, DRIVER_ERROR_CODES as E } from '../driver_spi.mjs';
import { IndexStore } from '../index_store.mjs';
import { SyncCoordinator } from '../sync_coordinator.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
const rejectsWith = (fn, code) => assert.rejects(fn, (e) => e.code === code);

/** 真实 git fixture：main 分支 + tag */
function makeRepo(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'c1']);
  git(dir, ['tag', 'v1.0.0']);
  return { path: dir, headSha: git(dir, ['rev-parse', 'HEAD']) };
}

let purgeCalls = [];
/** 物理删除守卫：协调器若调用 purge 会被记录（红线：purge 只属 lifecycle） */
class GuardedDriver extends LocalFsDriver {
  async _purge(p) { purgeCalls.push(p); return super._purge(p); }
}
/** 断网：介质上留下半截产物后抛 GSS_E_NETWORK */
class NetworkFailDriver extends GuardedDriver {
  async _upload(localSrc, remoteDst) {
    const dst = this.resolveTarget(remoteDst);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, 'partial-payload');
    throw new DriverError(E.GSS_E_NETWORK, 'network down');
  }
}
/** 哈希篡改：文件真落地，但回报错误的 sha256 */
class TamperHashDriver extends GuardedDriver {
  async _upload(localSrc, remoteDst, options) {
    return { ...(await super._upload(localSrc, remoteDst, options)), sha256: 'f'.repeat(64) };
  }
}
/** 字节数篡改：回报少 1 字节 */
class TamperBytesDriver extends GuardedDriver {
  async _upload(localSrc, remoteDst, options) {
    const res = await super._upload(localSrc, remoteDst, options);
    return { ...res, bytesWritten: res.bytesWritten - 1 };
  }
}

let tmpRoot, repo, media, bufferRoot;
const archiveOf = (fullName, headSha) => `${fullName.replace(/[\\/]+/g, '__')}-${headSha.slice(0, 7)}.bundle`;
const localIndexFile = () => join(bufferRoot, '.ghh-index.json');
const trashFiles = () => (existsSync(join(media, '.trash')) ? readdirSync(join(media, '.trash')) : []);
const localStore = () => new IndexStore({ rootDir: bufferRoot });
const coordOf = (driver) => new SyncCoordinator({ driver, bufferRoot, targetId: 'disk-a' });
/** 失败后必须满足的零污染断言：远端索引未写脏、本地 Ledger 无半截记录 */
const assertZeroPollution = async (driver) => {
  assert.equal(await driver.readIndex(), null, '远端索引不得被写入');
  assert.equal(existsSync(localIndexFile()), false, '本地索引文件不得被创建');
  assert.deepEqual(localStore().listSyncRecords(), [], '本地 Ledger 不得有半截记账');
  assert.deepEqual(localStore().list(), [], '本地索引不得有半截快照');
};

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'gss-'));
  repo = makeRepo(tmpRoot, 'repo');
  media = join(tmpRoot, 'media');
  bufferRoot = join(tmpRoot, 'buffer');
  mkdirSync(media, { recursive: true });
  mkdirSync(bufferRoot, { recursive: true });
  purgeCalls = [];
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('sync_coordinator · Push 两阶段提交', () => {
  it('1 · 正常 push：远端索引含该快照，本地记账状态为 synced', async () => {
    const driver = new LocalFsDriver({ root: media });
    const res = await coordOf(driver).push({ repoPath: repo.path, fullName: 'acme/widget' });
    assert.equal(res.ok, true);
    const remote = await driver.readIndex();
    assert.equal(remote.version, '1.0');
    assert.equal(remote.snapshots['acme/widget'].checksumSha256, res.snapshot.checksumSha256);
    assert.equal(remote.syncRecords['acme/widget::disk-a'].status, 'synced');
    const store = localStore();
    assert.equal(store.listSyncRecords().length, 1);
    assert.equal(store.listSyncRecords()[0].status, 'synced');
    assert.equal(store.get('acme/widget').commitSha, repo.headSha);
    assert.ok(existsSync(join(media, res.snapshot.archiveName)), '介质上必须有 bundle');
  });

  it('2 · 断网：远端索引未写脏、本地 Ledger 无半截记录、半成品进 .trash/', async () => {
    const driver = new NetworkFailDriver({ root: media });
    await rejectsWith(() => coordOf(driver).push({ repoPath: repo.path, fullName: 'acme/widget' }), E.GSS_E_NETWORK);
    await assertZeroPollution(driver);
    const archive = archiveOf('acme/widget', repo.headSha);
    assert.equal(existsSync(join(media, archive)), false, '半成品不得留在介质原位');
    assert.ok(trashFiles().some((f) => f.endsWith(archive)), `半成品必须进 .trash/: ${trashFiles()}`);
    assert.equal(purgeCalls.length, 0, '协调器不得调用 purge');
  });

  it('3 · 哈希篡改：Phase 2 未执行（远端索引无该快照），半成品被回退', async () => {
    const driver = new TamperHashDriver({ root: media });
    await rejectsWith(() => coordOf(driver).push({ repoPath: repo.path, fullName: 'acme/widget' }), E.GSS_E_CHECKSUM);
    await assertZeroPollution(driver);
    const archive = archiveOf('acme/widget', repo.headSha);
    assert.ok(trashFiles().some((f) => f.endsWith(archive)), `半成品必须进 .trash/: ${trashFiles()}`);
    assert.equal(purgeCalls.length, 0);
  });

  it('4 · 字节数不符：Phase 1 校验拦下，同样零污染', async () => {
    const driver = new TamperBytesDriver({ root: media });
    await rejectsWith(() => coordOf(driver).push({ repoPath: repo.path, fullName: 'acme/widget' }), E.GSS_E_CHECKSUM);
    await assertZeroPollution(driver);
    assert.ok(trashFiles().length > 0, '半成品必须被回退');
  });

  it('5 · 打包失败（非 git 目录）：介质与索引均无痕迹', async () => {
    const notRepo = join(tmpRoot, 'not-a-repo');
    mkdirSync(notRepo, { recursive: true });
    const driver = new LocalFsDriver({ root: media });
    await rejectsWith(() => coordOf(driver).push({ repoPath: notRepo, fullName: 'acme/broken' }), E.GSS_E_INVALID_ARG);
    await assertZeroPollution(driver);
  });

  it('6 · 重复 push 同一快照：远端索引与本地记账各只有一条', async () => {
    const driver = new LocalFsDriver({ root: media });
    const coord = coordOf(driver);
    await coord.push({ repoPath: repo.path, fullName: 'acme/widget' });
    await coord.push({ repoPath: repo.path, fullName: 'acme/widget' });
    const remote = await driver.readIndex();
    assert.equal(Object.keys(remote.snapshots).length, 1);
    assert.equal(Object.keys(remote.syncRecords).length, 1);
    assert.equal(localStore().listSyncRecords().length, 1);
  });

  it('6b · 增量 push：baseCommitSha 必须保留在快照与远端索引中', async () => {
    // 再提交一版，保证 base != HEAD（增量 bundle 才非空且可 verify）
    writeFileSync(join(repo.path, 'v2.txt'), 'v2\n');
    git(repo.path, ['add', '.']);
    git(repo.path, ['commit', '-q', '-m', 'c2']);
    const baseSha = repo.headSha;
    const driver = new LocalFsDriver({ root: media });
    const res = await coordOf(driver).push({ repoPath: repo.path, fullName: 'acme/widget', baseCommitSha: baseSha });
    assert.equal(res.snapshot.baseCommitSha, baseSha, 'snapshot 实体必须保留 baseCommitSha');
    const remote = await driver.readIndex();
    assert.equal(remote.snapshots['acme/widget'].baseCommitSha, baseSha, '远端索引必须保留 baseCommitSha');
    const store = localStore();
    assert.equal(store.get('acme/widget').baseCommitSha, baseSha, '本地 Ledger 也必须保留 baseCommitSha');
  });
});

describe('sync_coordinator · Pull 与灾难恢复', () => {
  it('7 · pull：下载并校验 SHA-256 后 git clone 还原出仓库', async () => {
    const driver = new LocalFsDriver({ root: media });
    const coord = coordOf(driver);
    await coord.push({ repoPath: repo.path, fullName: 'acme/widget' });
    const dest = join(tmpRoot, 'restored');
    const out = await coord.pull({ fullName: 'acme/widget', destPath: dest });
    assert.equal(out.ok, true);
    // 换行符归一：Windows 上 git checkout 可能带 CRLF
    assert.equal(readFileSync(join(dest, 'README.md'), 'utf-8').replace(/\r\n/g, '\n'), '# fixture\n');
    assert.equal(git(dest, ['rev-parse', 'HEAD']), repo.headSha);
  });

  it('8 · pull 远端被篡改：校验失败且不产出工作区', async () => {
    const driver = new LocalFsDriver({ root: media });
    const coord = coordOf(driver);
    await coord.push({ repoPath: repo.path, fullName: 'acme/widget' });
    writeFileSync(join(media, archiveOf('acme/widget', repo.headSha)), 'corrupted');
    const dest = join(tmpRoot, 'restored-bad');
    await rejectsWith(() => coord.pull({ fullName: 'acme/widget', destPath: dest }), E.GSS_E_CHECKSUM);
    assert.equal(existsSync(dest), false, '校验失败不得产出工作区');
  });

  it('9 · pull 远端无该快照：GSS_E_NOT_FOUND', async () => {
    const driver = new LocalFsDriver({ root: media });
    await rejectsWith(
      () => coordOf(driver).pull({ fullName: 'acme/absent', destPath: join(tmpRoot, 'absent') }),
      E.GSS_E_NOT_FOUND
    );
  });

  it('9b · pull 增量快照（带 baseCommitSha）：拒绝直接 clone 并提示先还原 base 版本', async () => {
    const driver = new LocalFsDriver({ root: media });
    const coord = coordOf(driver);
    await coord.push({ repoPath: repo.path, fullName: 'acme/widget' });
    // 模拟库调用方的增量快照在场：远端索引补写 baseCommitSha（CLI 路径从不带）
    const remote = await driver.readIndex();
    remote.snapshots['acme/widget'].baseCommitSha = repo.headSha;
    await driver.writeIndex(remote);
    const dest = join(tmpRoot, 'restored-inc');
    await assert.rejects(
      () => coord.pull({ fullName: 'acme/widget', destPath: dest }),
      (e) => e.code === E.GSS_E_INVALID_ARG && e.message.includes('baseCommitSha')
    );
    assert.equal(existsSync(dest), false, '拒绝还原时不得产出工作区');
  });

  it('10 · rebuild：仅凭远端索引重建本地 Ledger 与索引', async () => {
    const driver = new LocalFsDriver({ root: media });
    await coordOf(driver).push({ repoPath: repo.path, fullName: 'acme/widget' });
    rmSync(localIndexFile(), { force: true }); // 本地数据丢失
    const fresh = coordOf(driver);
    assert.deepEqual(fresh.store.listSyncRecords(), [], '重建前本地为空');
    const out = await fresh.rebuild();
    assert.equal(out.snapshots, 1);
    assert.equal(out.syncRecords, 1);
    assert.deepEqual(out.missing, []);
    const store = localStore();
    assert.ok(store.get('acme/widget'), '本地索引必须被重建');
    assert.equal(store.listSyncRecords()[0].status, 'synced');
    assert.equal(store.get('acme/widget').commitSha, repo.headSha);
  });
});
