// index_store.mjs — Storage-ORM 风格快照索引（介质载体无关，零 npm 依赖）
// 物理载体：介质根目录下的 .ghh-index.json（单文件、轻量、可直接被人读）
// 原子落盘：写 .tmp 再 renameSync 替换；崩溃后原索引零污染（残留 .tmp 交由 clean-staging 清理）
// 实体（SPEC §3.1）：
//   SnapshotEntity{ fullName, group?, commitSha, commitShort, commitDate, archiveName,
//     archiveFormat:'git-bundle'|'tar-zst'|'raw', sizeBytes, checksumSha256, baseCommitSha?, tags:[],
//     status?/purgedAt?/purgedPath?（lifecycle 核销时写入） }
//     ↑ 索引只记每仓「当前版本」（键=fullName）；历史版本清单以介质目录为准
//   SyncRecordEntity{ repoFullName, targetId, syncedCommitSha, syncedArchiveName, syncedAt,
//     status:'synced'|'pending'|'drifted'|'purged' }
//   StorageTargetEntity{ id, type:'local'|'sftp'|'smb'|'baidu'|'quark', endpoint, enabled, priority, lastSyncedAt? }

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnv } from './env.mjs';

export const INDEX_FILE = '.ghh-index.json';
export const INDEX_VERSION = '1.0';

const ARCHIVE_FORMATS = ['git-bundle', 'tar-zst', 'raw'];
const SYNC_STATUSES = ['synced', 'pending', 'drifted', 'purged'];
const TARGET_TYPES = ['local', 'sftp', 'smb', 'baidu', 'quark'];
const emptyIndex = () => ({ version: INDEX_VERSION, updatedAt: null, snapshots: {}, syncRecords: {}, targets: {} });

/** 实体字段校验：enums 中 null 表示只校验「非空字符串」。 */
function check(entity, label, enums) {
  for (const [field, allowed] of Object.entries(enums)) {
    const value = entity?.[field];
    if (typeof value !== 'string' || !value || (allowed && !allowed.includes(value))) throw new Error(`${label}.${field} 非法: ${value}`);
  }
}

/** 读取索引；文件不存在返回空索引。schema 版本高于当前实现时拒绝读取。 */
export function readIndex(indexPath) {
  if (!existsSync(indexPath)) return emptyIndex();
  const parsed = JSON.parse(readFileSync(indexPath, 'utf-8'));
  const major = parseInt(String(parsed.version ?? INDEX_VERSION).split('.')[0], 10);
  if (major > parseInt(INDEX_VERSION.split('.')[0], 10)) throw new Error(`索引 schema 版本过新: ${parsed.version}`);
  return { ...emptyIndex(), ...parsed };
}

/** 原子落盘：写 .tmp 再 rename 替换。hooks.beforeRename 为故障注入点（模拟写入中断）。 */
export function writeIndexAtomic(indexPath, data, hooks = {}) {
  mkdirSync(dirname(indexPath), { recursive: true });
  const tmp = `${indexPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  hooks.beforeRename?.();
  renameSync(tmp, indexPath);
}

// 差异比对（纯函数，无 I/O）：以 commitSha + archiveName 判定一致性，忽略跨系统 mtime。
// toUpload = 本地有、目标端无对应记录的快照；toTrash = 目标端有、本地对不上的记录。
export function computeDrift(localSnapshots = [], targetRecords = []) {
  const keyOf = (repo, sha, archive) => `${repo}|${sha}|${archive}`;
  const localKeys = new Set(localSnapshots.filter((s) => s?.fullName).map((s) => keyOf(s.fullName, s.commitSha, s.archiveName)));
  const toUpload = [];
  const toTrash = [];
  const upToDate = [];
  const covered = new Set();
  for (const record of targetRecords) {
    if (!record?.repoFullName || record.status === 'purged') continue; // 已核销：不再动它
    const key = keyOf(record.repoFullName, record.syncedCommitSha, record.syncedArchiveName);
    if (!localKeys.has(key)) { toTrash.push(record); } else { upToDate.push(record); covered.add(key); }
  }
  for (const snap of localSnapshots) {
    if (snap?.fullName && !covered.has(keyOf(snap.fullName, snap.commitSha, snap.archiveName))) toUpload.push(snap);
  }
  return { toUpload, toTrash, upToDate };
}

export class IndexStore {
  constructor(options = {}) {
    this.rootDir = options.rootDir || loadEnv().STORAGE_BUFFER_SPACE;
    this.indexPath = join(this.rootDir, INDEX_FILE);
    this.onBeforeRename = options.onBeforeRename || null;
    this.data = readIndex(this.indexPath);
  }
  /** 原子落盘；onBeforeRename 故障注入点用于模拟写入中断。 */
  persist() {
    const payload = { ...this.data, version: INDEX_VERSION, updatedAt: new Date().toISOString() };
    writeIndexAtomic(this.indexPath, payload, { beforeRename: this.onBeforeRename });
  }
  save(snapshot) { return this.commit(snapshot, null); }
  /** 原子提交：快照与记账一次落盘，避免两写之间崩溃留下「有快照无记账」。 */
  commit(snapshot, record) {
    if (snapshot) {
      check(snapshot, 'SnapshotEntity', { fullName: null, archiveFormat: ARCHIVE_FORMATS });
      this.data.snapshots[snapshot.fullName] = { tags: [], ...snapshot };
    }
    if (record) {
      check(record, 'SyncRecordEntity', { repoFullName: null, targetId: null, status: SYNC_STATUSES });
      this.data.syncRecords[`${record.repoFullName}::${record.targetId}`] = { ...record };
    }
    this.persist();
    if (snapshot) return this.data.snapshots[snapshot.fullName];
    return this.data.syncRecords[`${record.repoFullName}::${record.targetId}`];
  }
  get(fullName) {
    return this.data.snapshots[fullName] ?? null;
  }
  list() {
    return Object.values(this.data.snapshots).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
  /** 只移除索引条目，不触碰介质实体文件（淘汰一律进 .trash/，由 lifecycle 负责）。 */
  delete(fullName) {
    if (!(fullName in this.data.snapshots)) return false;
    delete this.data.snapshots[fullName];
    this.persist();
    return true;
  }
  recordSync(record) { return this.commit(null, record); }
  listSyncRecords() {
    return Object.values(this.data.syncRecords);
  }
  saveTarget(target) {
    check(target, 'StorageTargetEntity', { id: null, type: TARGET_TYPES });
    this.data.targets[target.id] = { ...target };
    this.persist();
    return this.data.targets[target.id];
  }
  listTargets() {
    return Object.values(this.data.targets);
  }
}
