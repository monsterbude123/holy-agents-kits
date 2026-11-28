// sync_coordinator.mjs — 两阶段提交同步协调器（Push / Pull / 灾难恢复）
// 架构裁决：索引 schema 唯一事实源 = index_store.mjs，driver 层只做字节透传（readIndex 可为 null）；
// Phase 1 = 打包→上传→校验 bytesWritten+SHA-256；Phase 2 = 校验通过后才回写远端索引与本地 Ledger；
// 任一步异常 → 半成品 moveToTrash（绝不 purge，purge 只属 lifecycle），远端索引与本地 Ledger 零污染。

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DriverError, DRIVER_ERROR_CODES as E } from './driver_spi.mjs';
import { IndexStore, readIndex, writeIndexAtomic } from './index_store.mjs';
import { computeFileSha256, packBundle, resolveBufferRoot, resolveGitPath } from './buffer_pipeline.mjs';

/** 远端索引归一化：driver.readIndex() 的 null → 空索引（结构取自 IndexStore，不另造 schema） */
function normalizeRemoteIndex(raw, store) {
  const base = store.data;
  const shape = { version: base.version, updatedAt: null, snapshots: {}, syncRecords: {}, targets: {} };
  if (!raw || typeof raw !== 'object') return shape;
  const major = (v) => parseInt(String(v ?? base.version).split('.')[0], 10);
  if (major(raw.version) > major(base.version)) throw new Error(`远端索引 schema 版本过新: ${raw.version}`);
  return {
    ...shape, ...raw, version: base.version,
    snapshots: { ...shape.snapshots, ...raw.snapshots },
    syncRecords: { ...shape.syncRecords, ...raw.syncRecords },
    targets: { ...shape.targets, ...raw.targets },
  };
}

/** 半成品回退：移入介质 .trash/（绝不物理删除）；回退失败不掩盖主异常 */
async function trashHalfProduct(driver, remotePath) {
  try {
    if (await driver.exists(remotePath)) await driver.moveToTrash(remotePath);
  } catch { /* 忽略：主异常优先上报 */ }
}

/** 回滚 Phase 2：本地索引恢复旧快照 + 远端索引恢复旧内容（各自原子）；失败不掩盖主异常 */
async function rollbackCommit(driver, store, previousRemote, previousLocal) {
  try { writeIndexAtomic(store.indexPath, previousLocal); store.data = previousLocal; } catch { /* 忽略 */ }
  try { await driver.writeIndex(previousRemote ?? normalizeRemoteIndex(null, store)); } catch { /* 忽略 */ }
}

/** 快照实体的提交时间（ISO 8601）：git log -1 --format=%cI */
function commitDateOf(repoPath) {
  const r = spawnSync(resolveGitPath(), ['log', '-1', '--format=%cI'], { cwd: repoPath, encoding: 'utf-8', shell: false, windowsHide: true });
  return r.status === 0 && r.stdout ? r.stdout.trim() : new Date().toISOString();
}

export class SyncCoordinator {
  /** driver 必填；bufferRoot 缺省取 loadEnv().STORAGE_BUFFER_SPACE；targetId 缺省 'default' */
  constructor(options = {}) {
    if (!options.driver) throw new Error('driver is required');
    this.driver = options.driver;
    this.targetId = options.targetId || 'default';
    this.bufferRoot = resolveBufferRoot(options);
    this.store = new IndexStore({ rootDir: this.bufferRoot });
  }

  /** Phase 1（Payload Commit）：打包 → 上传 → 完整性校验；失败即回退半成品 */
  async uploadPayload(repoPath, entity, options = {}) {
    const packed = await packBundle(repoPath, { bufferRoot: this.bufferRoot, entity });
    if (!packed.ok) throw new DriverError(E.GSS_E_INVALID_ARG, `pack failed (${packed.stage}): ${packed.error}`);
    try {
      const res = await this.driver.upload(packed.bundlePath, packed.archiveName, { onProgress: options.onProgress, signal: options.signal });
      if (Number(res?.bytesWritten) !== packed.sizeBytes) {
        throw new DriverError(E.GSS_E_CHECKSUM, `字节数不符: 期望 ${packed.sizeBytes} 实际 ${res?.bytesWritten}`);
      }
      if (res?.sha256 !== packed.sha256) {
        throw new DriverError(E.GSS_E_CHECKSUM, `SHA-256 不符: 期望 ${packed.sha256} 实际 ${res?.sha256}`);
      }
      return packed;
    } catch (err) {
      await trashHalfProduct(this.driver, packed.archiveName);
      throw err;
    }
  }

  /** Phase 2（Index Commit）：远端索引 + 本地 Ledger 双写；任一失败即回滚双方并回退半成品 */
  async commitIndex(snapshot, record) {
    const previousRemote = await this.driver.readIndex();
    const remote = normalizeRemoteIndex(previousRemote, this.store);
    remote.snapshots[snapshot.fullName] = snapshot;
    remote.syncRecords[`${record.repoFullName}::${record.targetId}`] = record;
    await this.driver.writeIndex(remote);
    const previousLocal = readIndex(this.store.indexPath);
    try {
      this.store.commit(snapshot, record); // 单次原子落盘：不留「有快照无记账」中间态
    } catch (err) {
      await rollbackCommit(this.driver, this.store, previousRemote, previousLocal);
      await trashHalfProduct(this.driver, snapshot.archiveName);
      throw err;
    }
    return remote;
  }

  /** Push：Phase 1 → Phase 2；任一步异常 → 半成品进 .trash/，索引与 Ledger 零污染 */
  async push(options = {}) {
    const { repoPath, fullName } = options;
    if (!repoPath || !fullName) throw new DriverError(E.GSS_E_INVALID_ARG, 'repoPath 与 fullName 必填');
    const packed = await this.uploadPayload(repoPath, { fullName, archiveName: options.archiveName, baseCommitSha: options.baseCommitSha }, options);
    const snapshot = {
      fullName, group: options.group, commitSha: packed.commitSha, commitShort: packed.commitShort,
      commitDate: commitDateOf(repoPath), archiveName: packed.archiveName, archiveFormat: 'git-bundle',
      sizeBytes: packed.sizeBytes, checksumSha256: packed.sha256, tags: (packed.refs || []).map((r) => r.ref),
    };
    const record = {
      repoFullName: fullName, targetId: this.targetId, syncedCommitSha: packed.commitSha,
      syncedArchiveName: packed.archiveName, syncedAt: new Date().toISOString(), status: 'synced',
    };
    await this.commitIndex(snapshot, record);
    return { ok: true, snapshot, record, bundlePath: packed.bundlePath };
  }

  /** Pull：远端索引 → 下载 → 校验 SHA-256 → git clone 还原工作区 */
  async pull(options = {}) {
    const { fullName, destPath } = options;
    if (!fullName || !destPath) throw new DriverError(E.GSS_E_INVALID_ARG, 'fullName 与 destPath 必填');
    const remote = normalizeRemoteIndex(await this.driver.readIndex(), this.store);
    const snapshot = remote.snapshots[fullName];
    if (!snapshot) throw new DriverError(E.GSS_E_NOT_FOUND, `远端索引没有 ${fullName} 的快照`);
    const localBundle = join(this.bufferRoot, snapshot.archiveName);
    mkdirSync(this.bufferRoot, { recursive: true });
    const res = await this.driver.download(snapshot.archiveName, localBundle, { onProgress: options.onProgress, signal: options.signal });
    const actual = await computeFileSha256(localBundle);
    if (actual.sha256 !== snapshot.checksumSha256 || (res?.sha256 && res.sha256 !== snapshot.checksumSha256)) {
      rmSync(localBundle, { force: true }); // 损坏的本地缓存件（未入账，非介质实体）
      throw new DriverError(E.GSS_E_CHECKSUM, `下载校验失败: ${fullName}`);
    }
    const clone = spawnSync(resolveGitPath(), ['clone', localBundle, destPath], { encoding: 'utf-8', shell: false, windowsHide: true });
    if (clone.status !== 0) throw new DriverError(E.GSS_E_IO, `git clone 失败: ${(clone.stderr || '').trim()}`);
    this.store.commit(snapshot, {
      repoFullName: fullName, targetId: this.targetId, syncedCommitSha: snapshot.commitSha,
      syncedArchiveName: snapshot.archiveName, syncedAt: new Date().toISOString(), status: 'synced',
    });
    return { ok: true, snapshot, destPath, sha256: actual.sha256, sizeBytes: actual.sizeBytes };
  }

  /** 灾难恢复：仅凭远端 .ghh-index.json 重建本地 Ledger 与索引 */
  async rebuild() {
    const remote = normalizeRemoteIndex(await this.driver.readIndex(), this.store);
    this.store.data.snapshots = Object.fromEntries(Object.entries(remote.snapshots).filter(([, s]) => s.status !== 'purged'));
    this.store.data.syncRecords = { ...remote.syncRecords };
    this.store.data.targets = { ...remote.targets, ...this.store.data.targets };
    this.store.persist();
    const missing = [];
    for (const s of Object.values(remote.snapshots)) if (s.status !== 'purged' && !(await this.driver.exists(s.archiveName))) missing.push(s.fullName);
    return { ok: true, snapshots: Object.keys(remote.snapshots).length, syncRecords: Object.keys(remote.syncRecords).length, missing };
  }
}
