// cli_sync.mjs — 同步类命令：status / diff / pack / push / pull（零依赖）
//
// 口径：
//   - 打包一律走 buffer_pipeline.packBundle（git bundle --all + 单遍流式 SHA-256 + .staging 隔离）。
//   - 推送一律走 sync_coordinator.SyncCoordinator（两阶段提交：载荷校验 → 索引记账）。
//   - 漂移比对一律走 index_store.computeDrift（索引记账口径，忽略跨系统 mtime）。
//   - 介质目录里的历史版本清单不由本模块组装（那是 prune 的职责）。

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnv } from '../env.mjs';
import { computeDrift } from '../index_store.mjs';
import { packBundle, resolveGitPath } from '../buffer_pipeline.mjs';
import { SyncCoordinator } from '../sync_coordinator.mjs';
import { lifecycleDefaults, scanExpiredTrash } from '../lifecycle.mjs';
import {
  allTargets, createDriver, defaultTarget, deriveFullName, fmtBytes, openStore, resolveEndpoint, resolveTargetSpec,
} from './cli_targets.mjs';

/** 目录内文件统计（本地缓冲盘占用 / 回收站占用）；filter 为可选文件名过滤 */
export function dirUsage(dir, filter = () => true) {
  if (!existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    if (!filter(name)) continue;
    try {
      const s = statSync(join(dir, name));
      if (s.isFile()) { count++; bytes += s.size; }
    } catch {
      /* 断链条目跳过 */
    }
  }
  return { count, bytes };
}

/** 快照提交时间（git log -1 --format=%cI） */
function commitDateOf(repoPath) {
  const r = spawnSync(resolveGitPath(), ['log', '-1', '--format=%cI'], {
    cwd: repoPath, encoding: 'utf-8', shell: false, windowsHide: true,
  });
  return r.status === 0 && r.stdout ? r.stdout.trim() : new Date().toISOString();
}

/** ================= status ================= */
export const defStatus = {
  usage: 'status [--trash]',
  summary: '本地缓冲与各介质同步健康状况（--trash 附回收站占用）',
  booleans: ['--trash'],
  strings: [],
  positionals: 0,
  async run(flags) {
    const env = loadEnv();
    const { rootDir, store } = openStore(env);
    const { ttlDays } = lifecycleDefaults(env);
    const snapshots = store.list();
    const records = store.listSyncRecords();
    const bundles = dirUsage(rootDir, (n) => /\.bundle$/i.test(n));

    console.log('=== status ===');
    console.log(`缓冲盘: ${rootDir}${existsSync(rootDir) ? '' : '（目录尚未创建）'}`);
    console.log(`索引:   ${store.indexPath}`);
    console.log(`版本:   ${store.data.version} | 快照 ${snapshots.length} | 记账 ${records.length} | 登记介质 ${store.listTargets().length}`);
    console.log(`本地快照: ${bundles.count} 个文件 / ${fmtBytes(bundles.bytes)}`);

    const targets = allTargets(store, env);
    if (!targets.length) console.log('介质: （未配置任何介质）');
    for (const t of targets) {
      let line = `  [${t.id}] ${t.type} ${resolveEndpoint(t.endpoint, env)}`;
      try {
        const driver = await createDriver(t, env);
        const r = await driver.ping();
        const drift = computeDrift(snapshots, records.filter((x) => x.targetId === t.id));
        line += ` ping=ok 记账=${drift.upToDate.length + drift.toTrash.length} 待传=${drift.toUpload.length} 待清=${drift.toTrash.length}`;
        if (flags.trash) {
          const scan = await scanExpiredTrash(driver, ttlDays, { index: await driver.readIndex() });
          line += ` 回收站(到期${scan.expired.length}/冷却${scan.cooling.length} ${fmtBytes(scan.totalBytes)})`;
        }
      } catch (err) {
        line += ` ping=失败(${err?.message || err})`;
      }
      console.log(line);
    }

    if (flags.trash) {
      const local = dirUsage(join(rootDir, '.trash'));
      const staging = dirUsage(join(rootDir, '.staging'));
      console.log('回收站:');
      console.log(`  本地缓冲盘 .trash/ ${local.count} 个 / ${fmtBytes(local.bytes)}`);
      console.log(`  本地缓冲盘 .staging/ 残卷 ${staging.count} 个 / ${fmtBytes(staging.bytes)}`);
    }
  },
};

/** ================= diff ================= */
export const defDiff = {
  usage: 'diff <target>',
  summary: '介质漂移清单（toUpload / toTrash / upToDate）',
  booleans: [],
  strings: [],
  positionals: 1,
  async run(flags, positionals) {
    const env = loadEnv();
    const { store } = openStore(env);
    const spec = resolveTargetSpec(positionals[0], store, env);
    const drift = computeDrift(store.list(), store.listSyncRecords().filter((r) => r.targetId === spec.id));
    console.log(`=== diff ${spec.id} ===`);
    console.log(`toUpload: ${drift.toUpload.length}`);
    for (const s of drift.toUpload) {
      console.log(`  - ${s.fullName} @${s.commitShort || String(s.commitSha || '').slice(0, 7)} (${s.archiveName})`);
    }
    console.log(`toTrash: ${drift.toTrash.length}`);
    for (const r of drift.toTrash) {
      console.log(`  - ${r.repoFullName} @${String(r.syncedCommitSha || '').slice(0, 7)} (${r.syncedArchiveName})`);
    }
    console.log(`upToDate: ${drift.upToDate.length}`);
    for (const r of drift.upToDate) {
      console.log(`  - ${r.repoFullName} @${String(r.syncedCommitSha || '').slice(0, 7)} (${r.syncedArchiveName})`);
    }
  },
};

/** ================= pack ================= */
export const defPack = {
  usage: 'pack <repo_path> [--name <owner/repo>]',
  summary: '打包单仓入本地缓冲盘（git bundle + SHA-256 + 索引记账）',
  booleans: [],
  strings: ['--name'],
  positionals: 1,
  async run(flags, positionals) {
    const repoPath = resolve(String(positionals[0] || ''));
    if (!existsSync(repoPath)) throw new Error(`仓库路径不存在：${positionals[0]}`);
    const env = loadEnv();
    const { rootDir, store } = openStore(env);
    const fullName = flags.name || deriveFullName(repoPath);
    const packed = await packBundle(repoPath, { bufferRoot: rootDir, entity: { fullName } });
    if (!packed.ok) throw new Error(`打包失败（${packed.stage}）：${packed.error}`);
    store.save({
      fullName,
      commitSha: packed.commitSha,
      commitShort: packed.commitShort,
      commitDate: commitDateOf(repoPath),
      archiveName: packed.archiveName,
      archiveFormat: 'git-bundle',
      sizeBytes: packed.sizeBytes,
      checksumSha256: packed.sha256,
      tags: (packed.refs || []).map((r) => r.ref),
    });
    console.log('=== pack ===');
    console.log(`仓库:   ${repoPath}`);
    console.log(`fullName: ${fullName}`);
    console.log(`产物:   ${packed.archiveName} (${fmtBytes(packed.sizeBytes)})`);
    console.log(`SHA-256: ${packed.sha256}`);
    console.log(`缓冲:   ${packed.bundlePath}`);
  },
};

/** ================= push ================= */
export const defPush = {
  usage: 'push <repo_path> [--target <id>] [--name <owner/repo>]',
  summary: '推送快照到介质（两阶段提交：载荷校验 → 索引记账）',
  booleans: [],
  strings: ['--target', '--name'],
  positionals: 1,
  async run(flags, positionals) {
    const repoPath = resolve(String(positionals[0] || ''));
    if (!existsSync(repoPath)) throw new Error(`仓库路径不存在：${positionals[0]}`);
    const env = loadEnv();
    const { rootDir, store } = openStore(env);
    const spec = flags.target ? resolveTargetSpec(flags.target, store, env) : defaultTarget(store, env);
    const driver = await createDriver(spec, env);
    const fullName = flags.name || deriveFullName(repoPath);
    const coord = new SyncCoordinator({ driver, bufferRoot: rootDir, targetId: spec.id });
    console.log(`=== push ${spec.id} ===`);
    console.log('阶段 1 · 载荷提交（打包 → 上传 → 字节数/SHA-256 校验）');
    const res = await coord.push({ repoPath, fullName });
    console.log('阶段 2 · 索引提交（远端索引 + 本地 Ledger 双写）');
    console.log(`完成: ${res.snapshot.fullName} @${res.snapshot.commitShort} → ${spec.id}`);
    console.log(`产物: ${res.snapshot.archiveName} (${fmtBytes(res.snapshot.sizeBytes)})`);
  },
};

/** ================= pull ================= */
export const defPull = {
  usage: 'pull <owner/repo> --from <id> [--dest <path>]',
  summary: '从介质拉回快照并还原为工作区',
  booleans: [],
  strings: ['--from', '--dest'],
  positionals: 1,
  async run(flags, positionals) {
    const fullName = String(positionals[0] || '').trim();
    if (!fullName) throw new Error('缺少仓库标识（owner/repo）');
    if (!flags.from) throw new Error('缺少 --from <介质 id>');
    const env = loadEnv();
    const { rootDir, store } = openStore(env);
    const spec = resolveTargetSpec(flags.from, store, env);
    const driver = await createDriver(spec, env);
    const dest = flags.dest
      ? resolve(String(flags.dest))
      : join(rootDir, 'restored', fullName.replace(/[\\/]+/g, '__'));
    const coord = new SyncCoordinator({ driver, bufferRoot: rootDir, targetId: spec.id });
    console.log(`=== pull ${spec.id} ===`);
    const res = await coord.pull({ fullName, destPath: dest });
    console.log(`快照: ${res.snapshot.fullName} @${res.snapshot.commitShort}`);
    console.log(`还原: ${res.destPath}`);
    console.log(`校验: SHA-256 一致 (${fmtBytes(res.sizeBytes)})`);
  },
};
