// buffer_pipeline.mjs — Git Bundle 打包流水线 + 本地暂存缓冲池（纯原生 ESM，零依赖）
//
// 约定（SPEC §5 / TKT-04）：
//   - 打包一律 `git bundle create <file> --all`：只传 HEAD 会丢 tags 与其它分支，
//     且 Detached HEAD 下会失败，破坏「完整追踪」定位；--all 是硬要求。
//   - 打包在 <buffer>/.staging/ 隔离目录进行，verify 通过后原子 rename 进缓冲根目录；
//     任何失败都清掉自己刚建的暂存体，绝不留半成品。
//   - SHA-256 用 node:crypto 流式计算（单遍读盘同时得到字节数），不二次读盘。
//   - 实体带 baseCommitSha 时走增量：`git bundle create <file> HEAD ^<base>`（不改表结构）。
//   - 缓冲根来自 loadEnv().STORAGE_BUFFER_SPACE（缺省 <projectRoot>/buffer），不硬编码。

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv } from './env.mjs';

const STAGING_DIR = '.staging';
const PART_SUFFIX = '.part';

/** git 可执行文件：GIT_BINARY / GIT_PATH 环境变量可覆盖，默认走 PATH 的 git */
export function resolveGitPath() {
  return process.env.GIT_BINARY || process.env.GIT_PATH || 'git';
}

/** 缓冲盘根目录：loadEnv 的 STORAGE_BUFFER_SPACE，缺省回退 <PROJECT_ROOT>/buffer */
export function resolveBufferRoot(options = {}) {
  if (options.bufferRoot) return resolve(options.bufferRoot);
  const env = loadEnv();
  return resolve(env.STORAGE_BUFFER_SPACE || join(env.PROJECT_ROOT, 'buffer'));
}

/** 打包 rev 参数：实体带 baseCommitSha → 增量；否则全量 --all */
export function bundleRevArgs(entity = {}) {
  const base = entity.baseCommitSha;
  return base ? ['HEAD', `^${base}`] : ['--all'];
}

/** 跑一条 git 命令（spawn 无 shell 拼接，防注入） */
function runGit(cwd, args) {
  const r = spawnSync(resolveGitPath(), args, {
    cwd, encoding: 'utf-8', shell: false, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { ok: false, code: -1, stdout: '', stderr: r.error.message };
  return {
    ok: r.status === 0, code: r.status ?? -1,
    stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(),
  };
}

/** 单遍流式 SHA-256 + 字节数（不整读入内存，也不二次读盘） */
export function computeFileSha256(filePath) {
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => { hash.update(chunk); sizeBytes += chunk.length; });
    stream.on('error', fail);
    stream.on('end', () => done({ sha256: hash.digest('hex'), sizeBytes }));
  });
}

/** 读 bundle 内含 ref 清单（git bundle list-heads） */
export function listBundleRefs(repoPath, bundlePath) {
  const r = runGit(repoPath, ['bundle', 'list-heads', bundlePath]);
  if (!r.ok) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, ref] = line.split(/\s+/);
    return { sha, ref };
  });
}

/** 校验 bundle 合法性（git bundle verify，需在仓库上下文内执行） */
export function verifyBundle(repoPath, bundlePath) {
  return runGit(repoPath, ['bundle', 'verify', bundlePath]);
}

/** 缓冲产物文件名：显式 archiveName 优先（缺 .bundle 则补），否则 <owner>__<repo>-<短SHA> */
function bundleFileName(entity, commitShort) {
  const raw = entity.archiveName;
  if (raw) return /\.bundle$/i.test(raw) ? raw : `${raw}.bundle`;
  const slug = (entity.fullName || 'unknown__repo')
    .replace(/[\\/]+/g, '__').replace(/[^A-Za-z0-9._-]/g, '-');
  return `${slug}-${commitShort}.bundle`;
}

/** 删除自己刚建的 .staging 临时体（允许；不碰任何其它文件） */
function dropStagingFile(path) {
  try {
    rmSync(path, { force: true, maxRetries: 5, retryDelay: 100 });
  } catch { /* 暂存体删除失败不影响主流程结论 */ }
}

/**
 * 把本地 git 仓库打成单文件 .bundle 落到本地缓冲盘。
 * @param {string} repoPath 本地 git 仓库路径
 * @param {{entity?:object, bufferRoot?:string}} [options] entity: SnapshotEntity 片段
 *   （fullName / archiveName / baseCommitSha?）
 * @returns {Promise<object>} {ok, stage, error, archiveName, bundlePath, sha256,
 *   sizeBytes, commitSha, commitShort, incremental, refs}
 */
export async function packBundle(repoPath, options = {}) {
  const entity = options.entity || options;
  const repo = resolve(repoPath);
  const bufferRoot = resolveBufferRoot(options);
  const stagingDir = join(bufferRoot, STAGING_DIR);

  const inside = runGit(repo, ['rev-parse', '--git-dir']);
  if (!inside.ok) return { ok: false, stage: 'precheck', error: inside.stderr || 'not a git repository' };
  const head = runGit(repo, ['rev-parse', 'HEAD']);
  if (!head.ok) return { ok: false, stage: 'precheck', error: head.stderr || 'no HEAD commit' };
  const commitSha = head.stdout;
  const commitShort = commitSha.slice(0, 7);

  const archiveName = bundleFileName(entity, commitShort);
  const finalPath = join(bufferRoot, archiveName);
  const stagingPath = join(stagingDir, `${archiveName}${PART_SUFFIX}`);
  const revArgs = bundleRevArgs(entity);

  mkdirSync(stagingDir, { recursive: true });
  dropStagingFile(stagingPath); // 清同名历史残卷

  const created = runGit(repo, ['bundle', 'create', stagingPath, ...revArgs]);
  if (!created.ok) {
    dropStagingFile(stagingPath);
    return { ok: false, stage: 'create', error: created.stderr || 'git bundle create failed', archiveName };
  }
  const verified = verifyBundle(repo, stagingPath);
  if (!verified.ok) {
    dropStagingFile(stagingPath);
    return { ok: false, stage: 'verify', error: verified.stderr || 'git bundle verify failed', archiveName };
  }
  const { sha256, sizeBytes } = await computeFileSha256(stagingPath);
  const refs = listBundleRefs(repo, stagingPath);

  try {
    renameSync(stagingPath, finalPath); // 同卷 rename = 原子移入缓冲根目录
  } catch (e) {
    dropStagingFile(stagingPath);
    return { ok: false, stage: 'publish', error: e.message, archiveName };
  }
  return {
    ok: true, archiveName, bundlePath: finalPath, sha256, sizeBytes,
    commitSha, commitShort, incremental: Boolean(entity.baseCommitSha), refs,
  };
}
