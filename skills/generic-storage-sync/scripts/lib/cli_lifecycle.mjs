// cli_lifecycle.mjs — 清理类命令：prune / clean-trash / clean-staging（零依赖）
//
// 口径（上游已定，不另立）：
//   - 索引只记每个仓库的「当前版本」；历史版本清单来自介质目录（driver.list() 列 .bundle）。
//     prune 的淘汰清单由「介质目录 + 索引记账」组装，再喂给 lifecycle.evaluateRetention。
//   - prune / clean-trash 默认 dry-run：只打印拟删清单 + 所属仓库 + 可释放字节数，不删任何东西；
//     带 --yes 才真执行。
//   - 物理删除只发生在 lifecycle.purgeExpired，且只在冷却期满 + --yes 时。
//   - .trash/orphans/ 默认不进入自动物理清理队列（孤儿需人工裁决）。

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../env.mjs';
import { INDEX_FILE } from '../index_store.mjs';
import {
  evaluateRetention, lifecycleDefaults, purgeExpired, scanExpiredTrash, softEvict,
} from '../lifecycle.mjs';
import {
  allTargets, createDriver, fmtBytes, openStore, resolveTargetSpec, slugToFullName,
} from './cli_targets.mjs';

/**
 * 组装淘汰清单：介质目录（.bundle）+ 索引记账 → 每仓分组 → evaluateRetention。
 * 铁律1 补强：索引登记的「当前版本」永远强制保留，不进淘汰清单。
 */
export async function planPrune(driver, store, spec, keepCount) {
  const listed = await driver.list('');
  const media = (listed || []).filter((e) => e && e.isFile && /\.bundle$/i.test(e.name || ''));

  const reg = new Map();
  for (const s of store.list()) {
    if (s.archiveName) reg.set(s.archiveName, s.fullName);
  }
  for (const r of store.listSyncRecords()) {
    if (r.targetId === spec.id && r.syncedArchiveName && !reg.has(r.syncedArchiveName)) {
      reg.set(r.syncedArchiveName, r.repoFullName);
    }
  }
  const current = new Map();
  for (const s of store.list()) if (s.archiveName) current.set(s.fullName, s.archiveName);

  const items = media.map((e) => {
    const hit = reg.get(e.name);
    return {
      path: e.path,
      name: e.name,
      archiveName: e.name,
      size: Number(e.size) || 0,
      repoFullName: hit || slugToFullName(e.name),
      commitSha: String(e.name || '').match(/-([0-9a-f]{7,40})\.bundle$/i)?.[1] || '',
      // 排序统一用介质 mtime（单一时钟）；索引只负责仓库归属与「当前版本」保底，
      // 避免 git 提交时间与落盘时间混排导致淘汰顺序错乱。
      commitDate: new Date(Number(e.mtimeMs) || 0).toISOString(),
    };
  });

  const byRepo = new Map();
  for (const it of items) {
    const list = byRepo.get(it.repoFullName) || [];
    list.push(it);
    byRepo.set(it.repoFullName, list);
  }

  const trash = [];
  for (const [repo, list] of byRepo) {
    const r = evaluateRetention(list, keepCount);
    const keepNames = new Set(r.keep.map((x) => x.archiveName));
    const cur = current.get(repo);
    if (cur && list.some((x) => x.archiveName === cur)) keepNames.add(cur);
    trash.push(...r.trash.filter((x) => !keepNames.has(x.archiveName)));
  }
  const freedBytes = trash.reduce((n, x) => n + (Number(x.size) || 0), 0);
  return { total: items.length, trash, freedBytes };
}

/** ================= prune ================= */
export const defPrune = {
  usage: 'prune [target] [--yes]',
  summary: '淘汰超量快照进回收站（默认 dry-run，--yes 才执行）',
  booleans: ['--yes'],
  strings: [],
  positionals: 1,
  async run(flags, positionals) {
    const env = loadEnv();
    const { store } = openStore(env);
    const execute = flags.yes === true;
    const { keepCount } = lifecycleDefaults(env);
    const targets = positionals.length
      ? [resolveTargetSpec(positionals[0], store, env)]
      : allTargets(store, env);

    console.log(`=== prune [${execute ? '执行' : 'dry-run'}] ===`);
    console.log(`保留上限: ${keepCount} 个/仓库（铁律1 保底 ≥ 1）`);
    if (!targets.length) {
      console.log('（未配置任何介质）');
      return;
    }
    for (const spec of targets) {
      console.log(`  [${spec.id}] ${spec.type}`);
      try {
        const driver = await createDriver(spec, env);
        const plan = await planPrune(driver, store, spec, keepCount);
        console.log(`    介质快照 ${plan.total} 个，待淘汰 ${plan.trash.length} 个`);
        for (const c of plan.trash) {
          console.log(`      - ${c.archiveName}  (仓库 ${c.repoFullName})  ${fmtBytes(c.size)}`);
        }
        console.log(`    可释放: ${fmtBytes(plan.freedBytes)}`);
        const res = await softEvict(driver, plan.trash, { execute });
        if (execute) console.log(`    已移入回收站 ${res.moved.length} 个，失败 ${res.failed.length} 个`);
        else console.log('    (演练模式，未删除任何文件；加 --yes 执行)');
      } catch (err) {
        console.log(`    跳过：${err?.message || err}`);
      }
    }
  },
};

/** ================= clean-trash ================= */
export const defCleanTrash = {
  usage: 'clean-trash [target] [--yes]',
  summary: '物理清理冷却期满的回收站（默认 dry-run，--yes 才执行）',
  booleans: ['--yes'],
  strings: [],
  positionals: 1,
  async run(flags, positionals) {
    const env = loadEnv();
    const { store } = openStore(env);
    const execute = flags.yes === true;
    const { ttlDays } = lifecycleDefaults(env);
    const targets = positionals.length
      ? [resolveTargetSpec(positionals[0], store, env)]
      : allTargets(store, env);

    console.log(`=== clean-trash [${execute ? '执行' : 'dry-run'}] ===`);
    console.log(`冷却期 TTL: ${ttlDays} 天（保护窗口 [0, TTL)，恰好等于 TTL 即判到期）`);
    if (!targets.length) {
      console.log('（未配置任何介质）');
      return;
    }
    for (const spec of targets) {
      console.log(`  [${spec.id}] ${spec.type}`);
      try {
        const driver = await createDriver(spec, env);
        const remoteIndex = await driver.readIndex();
        const scan = await scanExpiredTrash(driver, ttlDays, { index: remoteIndex });
        // 索引只记「当前版本」，历史版本无记账 → 按 <owner>__<repo>-<sha>.bundle 约定反推仓库归属
        const expired = scan.expired.map((it) => ({ ...it, repoFullName: it.repoFullName || slugToFullName(it.archiveName) }));
        console.log(`    到期 ${expired.length} 个 / ${fmtBytes(scan.totalBytes)}；冷却中 ${scan.cooling.length} 个`);
        for (const it of expired) {
          console.log(`      - ${it.name}  (仓库 ${it.repoFullName || '未知'})  ${fmtBytes(it.size)}`);
        }
        const res = await purgeExpired(driver, expired, { execute, ttlDays, store, index: remoteIndex });
        console.log(`    可释放: ${fmtBytes(res.freedBytes)}`);
        const liveSkipped = (res.skipped || []).filter((s) => s.reason === 'live-snapshot-exists');
        if (liveSkipped.length) console.log(`    跳过核销 ${liveSkipped.length} 个：介质根仍有同名活快照，账本保持原状`);
        if (execute) console.log(`    已物理清理 ${res.purged.length} 个，失败 ${res.failed.length} 个`);
        else console.log('    (演练模式，未删除任何文件；加 --yes 执行)');
      } catch (err) {
        console.log(`    跳过：${err?.message || err}`);
      }
    }
  },
};

/** ================= clean-staging ================= */
export const defCleanStaging = {
  usage: 'clean-staging [--dry-run]',
  summary: '清理本地缓冲盘 .staging/ 残卷与索引原子写临时件',
  booleans: ['--dry-run'],
  strings: [],
  positionals: 0,
  async run(flags) {
    const env = loadEnv();
    const { rootDir } = openStore(env);
    const stagingDir = join(rootDir, '.staging');
    const files = existsSync(stagingDir) ? readdirSync(stagingDir) : [];
    const indexTmp = join(rootDir, `${INDEX_FILE}.tmp`);
    const tmpExists = existsSync(indexTmp);

    console.log('=== clean-staging ===');
    console.log(`暂存目录: ${stagingDir}`);
    console.log(`残卷: ${files.length} 个`);
    for (const f of files) console.log(`  - ${f}`);
    if (tmpExists) console.log(`  - ${INDEX_FILE}.tmp (索引原子写残件)`);
    if (flags['dry-run']) {
      console.log('(dry-run，未删除任何文件)');
      return;
    }
    for (const f of files) rmSync(join(stagingDir, f), { force: true, recursive: true, maxRetries: 5 });
    if (tmpExists) rmSync(indexTmp, { force: true });
    console.log(`已清理 ${files.length + (tmpExists ? 1 : 0)} 个残卷`);
  },
};
