// lifecycle.mjs — 生命周期与安全清理引擎（SPEC §6）：四阶淘汰管道 + 防灾四铁律
// 纯原生 ESM / 零 npm 依赖。物理删除唯一入口 = driver.purge()，只允许本模块在冷却期满后调用。
// 四阶管道：1 淘汰判定 evaluateRetention → 2 软淘汰 moveToTrash → 3 冷却期(TTL) → 4 物理抹除 purgeExpired
// 防灾四铁律（逐条硬拦，勿绕过）：
//   [铁律1 绝对保底] 任一仓库任一介质至少保留 1 个最新可用快照，严禁清零 → evaluateRetention 保底 keep>=1
//   [铁律2 演练优先] 清理动作默认 dry-run：只产出拟删清单/所属仓库/可释放字节数；执行须显式 execute=true
//   [铁律3 索引先行] 物理删除前先把索引记账标记 status='purged' 并原子落盘，再删文件；无记账目标拒绝删除；
//                     介质根仍有同名活文件时跳过核销（只清回收站死副本，账本不动）
//   [铁律4 孤儿防御] 未在索引登记的游离文件不直接删，先隔离到 .trash/orphans/ 交人工裁决
import { DriverError, DRIVER_ERROR_CODES as E } from './driver_spi.mjs';
import { loadEnv } from './env.mjs';

export const TRASH_DIRNAME = '.trash', ORPHAN_DIRNAME = 'orphans';
export const DEFAULT_MAX_RETAINED = 2, DEFAULT_TRASH_TTL_DAYS = 7;

const DAY_MS = 86400000;
const STAMP_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z_/;
const sumBytes = (list = []) => (Array.isArray(list) ? list : []).reduce((n, f) => n + (Number(f?.size ?? f?.sizeBytes) || 0), 0);
const newestFirst = (a, b) => (Date.parse(b?.commitDate || '') || 0) - (Date.parse(a?.commitDate || '') || 0)
  || String(b?.commitSha || '').localeCompare(String(a?.commitSha || '')) || String(a?.archiveName || '').localeCompare(String(b?.archiveName || ''));
const safeReadIndex = async (driver) => { try { return (await driver?.readIndex?.()) ?? null; } catch { return null; } };

/** 配置默认值：keepCount / ttlDays 一律走 loadEnv()，不硬编码本机路径 */
export function lifecycleDefaults(env = loadEnv()) { return { keepCount: Number(env.STORAGE_MAX_RETAINED_SNAPSHOTS) || DEFAULT_MAX_RETAINED, ttlDays: Number(env.STORAGE_TRASH_TTL_DAYS) || DEFAULT_TRASH_TTL_DAYS }; }
/** 拆回收站条目名 <ts>_<archive>（驱动约定的落点名） */
export function parseTrashName(name = '') { const m = STAMP_RE.exec(name);
  return m ? { stamp: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`, archiveName: name.slice(m[0].length) } : { stamp: null, archiveName: name };
}
/** 进入回收站的时间：优先文件名时间戳（rename 不刷新 mtime，否则会误判为早到期），退化到 mtimeMs */
export function trashEntryTime(entry = {}) {
  const { stamp } = parseTrashName(entry.name || ''); const t = stamp ? Date.parse(stamp) : 0;
  return Number.isFinite(t) && t > 0 ? t : (Number(entry.mtimeMs) || 0);
}
/** 冷却期判定：age >= TTL 即到期（恰好等于 TTL 判为到期；保护窗口 = [0, TTL)）；无时间戳=无法证明到期→保守保留 */
export function isExpired(entry, ttlDays, now = Date.now()) { const t = trashEntryTime(entry);
  return t ? now - t >= Math.max(0, Number(ttlDays) || 0) * DAY_MS : false;
}
/** dry-run 汇总（铁律2 输出物）：拟删文件数 + 可释放字节数 */
export function summarizePlan(items = []) { const list = (Array.isArray(items) ? items : []).filter(Boolean);
  return { fileCount: list.length, freedBytes: sumBytes(list) };
}
/** 铁律1 绝对保底律：纯函数算保留/淘汰清单，任何输入都至少保留最新 1 个 */
export function evaluateRetention(repoSnapshots = [], keepCount = DEFAULT_MAX_RETAINED) {
  const snaps = (Array.isArray(repoSnapshots) ? repoSnapshots : []).filter((s) => s && (s.archiveName || s.commitSha));
  const keepN = Math.max(1, parseInt(keepCount, 10) || 1); // 保留数下限硬夹为 1：严禁清零
  const sorted = [...snaps].sort(newestFirst);
  const keep = sorted.slice(0, keepN); const trash = sorted.slice(keepN);
  const floorKept = snaps.length === 0 ? true : keep.length >= 1 && trash.length < snaps.length;
  return { keep, trash, keepCount: keepN, floorKept, reason: snaps.length === 0 ? 'no-snapshot' : (trash.length ? 'over-limit' : 'within-limit') };
}
/** 索引登记的产物名 → 仓库归属（snapshots 优先，syncRecords 兜底） */
function registeredMap(index) { const map = new Map();
  for (const s of Object.values(index?.snapshots || {})) if (s?.archiveName) map.set(s.archiveName, s.fullName);
  for (const r of Object.values(index?.syncRecords || {})) if (r?.syncedArchiveName) map.set(r.syncedArchiveName, r.repoFullName);
  return map;
}
/** 铁律2 执行闸：默认 dry-run（只出清单），execute=true 才调 action */
async function runGuarded(items, execute, action) {
  const planned = []; const done = []; const failed = [];
  for (const it of items || []) {
    planned.push(it);
    if (!execute) continue;
    try { done.push(await action(it)); } catch (err) { failed.push({ ...it, error: err?.code || err?.message || String(err) }); }
  }
  return { planned, done, failed };
}
/** 阶段2 软淘汰：移入介质 .trash/，严禁物理删除；默认 dry-run（铁律2） */
export async function softEvict(driver, candidates = [], options = {}) {
  const items = candidates.map((c) => ({ path: c?.path ?? c?.archiveName, name: c?.name ?? c?.archiveName, size: Number(c?.size ?? c?.sizeBytes) || 0, repoFullName: c?.repoFullName ?? null, archiveName: c?.archiveName ?? null }));
  const r = await runGuarded(items, options.execute === true, async (it) => ({ ...it, trashPath: (await driver.moveToTrash(it.path))?.to ?? null }));
  return { dryRun: options.execute !== true, ...r, moved: r.done, fileCount: items.length, reclaimedBytes: sumBytes(items) };
}
/** 阶段3 冷却期扫描：列出超过 TTL 的待清理文件（默认排除 .trash/orphans/：孤儿须人工裁决） */
export async function scanExpiredTrash(driver, ttlDays = DEFAULT_TRASH_TTL_DAYS, options = {}) {
  const ttl = Number(ttlDays) || DEFAULT_TRASH_TTL_DAYS;
  const now = Number(options.now) || Date.now();
  let entries = [];
  try { entries = await driver.list(options.trashRoot || driver.trashRoot); }
  catch (err) { if (err?.code === E.GSS_E_NOT_FOUND) return { ttlDays: ttl, expired: [], cooling: [], totalBytes: 0 }; throw err; }
  const reg = registeredMap(options.index ?? (await safeReadIndex(driver)));
  const expired = []; const cooling = [];
  for (const entry of entries || []) {
    if (!entry || entry.isDirectory) continue;
    if (!options.includeOrphans && String(entry.path || '').includes(`/${ORPHAN_DIRNAME}/`)) continue;
    const { archiveName } = parseTrashName(entry.name || '');
    const item = { path: entry.path, name: entry.name, archiveName, size: Number(entry.size) || 0, mtimeMs: entry.mtimeMs, repoFullName: reg.get(archiveName) || null };
    (isExpired(item, ttl, now) ? expired : cooling).push(item);
  }
  return { ttlDays: ttl, expired, cooling, totalBytes: sumBytes(expired) };
}
/** 铁律3 索引先行：只改 SyncRecordEntity.status（唯一记账口径），其余字段保留。
 *  apply=false（dry-run 预演）时为纯计算：只返回「将标记哪些记录」的清单，不改任何索引数据。 */
function markPurged(indexData, archiveName, item, now, apply = true) {
  if (!archiveName || !indexData) return [];
  const at = new Date(now).toISOString(); const changed = [];
  const groups = [[indexData.syncRecords || {}, (r) => r.syncedArchiveName, (r) => `${r.repoFullName}::${r.targetId}`], [indexData.snapshots || {}, (s) => s.archiveName, (s) => `snapshot:${s.fullName}`]];
  for (const [map, nameOf, idOf] of groups) {
    for (const rec of Object.values(map)) {
      if (nameOf(rec) !== archiveName || rec.status === 'purged') continue;
      if (apply) { rec.status = 'purged'; rec.purgedAt = at; rec.purgedPath = item.path; }
      changed.push(idOf(rec));
    }
  }
  return changed;
}
/** 解析索引记账目标：本地 Ledger(IndexStore) + 介质索引；两者皆无 → 拒绝物理删除 */
async function resolveIndexTargets(driver, options) { const targets = [];
  if (options.store) targets.push({ data: options.store.data, write: async (d) => { options.store.data = d; options.store.persist(); } });
  const remote = options.index ?? (await safeReadIndex(driver));
  if (remote) targets.push({ data: remote, write: async (d) => (options.writeIndex ? options.writeIndex(d) : driver.writeIndex(d)) });
  return targets;
}
/** 阶段4 物理抹除：仅冷却期满 + 显式 execute=true；铁律3 先记账落盘再删文件。
 *  活快照防御：介质根下仍有同名活文件（如 push 半途失败后同 commit 重推成功的重名件）→
 *  只清回收站死副本，跳过核销（skipped 记 reason='live-snapshot-exists'），账本口径不被破坏。 */
export async function purgeExpired(driver, fileList = [], options = {}) {
  const execute = options.execute === true;
  const ttl = Number(options.ttlDays) || lifecycleDefaults().ttlDays;
  const now = Number(options.now) || Date.now();
  const eligible = []; const skipped = [];
  for (const f of fileList || []) {
    const item = { ...f, size: Number(f?.size ?? f?.sizeBytes) || 0 };
    if (!isExpired(item, ttl, now)) { skipped.push({ ...item, reason: 'within-cooldown' }); continue; }
    eligible.push(item);
  }
  const targets = await resolveIndexTargets(driver, options);
  if (execute && eligible.length && !targets.length) throw new DriverError(E.GSS_E_INVALID_ARG, '缺少索引记账目标，拒绝物理删除（铁律3）');
  const markable = []; // 需要记账核销的条目（介质根无同名活文件）
  for (const item of eligible) {
    const archiveName = item.archiveName || parseTrashName(item.name || '').archiveName;
    let live = false;
    try { live = Boolean(archiveName) && (await driver.exists(archiveName)) === true; } catch { live = false; }
    if (live) skipped.push({ ...item, reason: 'live-snapshot-exists' });
    else markable.push(item);
  }
  // 记账（铁律3）：execute=true 才真正改索引数据；dry-run 走 apply=false 纯预演，零内存副作用
  const purgedRecords = [];
  for (const item of markable) {
    const archiveName = item.archiveName || parseTrashName(item.name || '').archiveName;
    for (const t of targets) purgedRecords.push(...markPurged(t.data, archiveName, item, now, execute));
  }
  if (execute) for (const t of targets) await t.write(t.data); // 铁律3：原子落盘先于物理删除
  const r = await runGuarded(eligible, execute, async (it) => { await driver.purge(it.path); return { ...it, purged: true }; });
  return { dryRun: !execute, planned: eligible, purged: r.done, failed: r.failed, skipped, purgedRecords, ...summarizePlan(eligible) };
}
/** 铁律4 孤儿扫描：未在索引登记的游离文件只报告，绝不删除 */
export async function scanOrphans(driver, options = {}) {
  const reg = registeredMap(options.index ?? (await safeReadIndex(driver))); const orphans = [];
  for (const e of (await driver.list(options.root || driver.root)) || []) {
    if (!e || !e.isFile) continue;
    if (String(e.name || '').startsWith('.')) continue; // .trash / .ghh-index.json / .staging 等元数据
    if (reg.has(e.name)) continue;
    orphans.push({ path: e.path, name: e.name, size: Number(e.size) || 0, mtimeMs: e.mtimeMs });
  }
  return { orphans, registered: [...reg.keys()] };
}
/** 铁律4 孤儿隔离：移到 .trash/orphans/ 交人工裁决，绝不物理删除；默认 dry-run */
export async function quarantineOrphans(driver, orphans = [], options = {}) {
  const dir = options.orphanTrashDir || driver.joinPath(driver.trashRoot, ORPHAN_DIRNAME);
  const r = await runGuarded(orphans, options.execute === true, async (it) => ({ ...it, quarantinePath: (await driver.moveToTrash(it.path, dir))?.to ?? null }));
  return { dryRun: options.execute !== true, ...r, quarantined: r.done, ...summarizePlan(orphans) };
}
