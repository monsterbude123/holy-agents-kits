// add.mjs — 收录新仓库（clone + manifest + docs）
// 流程：查重 → clone（完整优先，失败降级浅克隆）→ 读 git 状态 → 追加 manifest → 同步 docs → 触发增量索引

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectRoot, reposRoot } from '../lib/paths.mjs';
import {
  readManifest,
  writeManifest,
  appendEntry,
  findByFullName,
} from '../lib/manifest.mjs';
import { nowIsoShanghai } from '../lib/time.mjs';
import { buildEntryFromRepo } from '../lib/buildEntryFromRepo.mjs';
import { gitStream } from '../lib/git.mjs';
import { cloneWithFallback, cleanupPartialClone, DEFAULT_CLONE_TIMEOUT_MS } from '../lib/cloneStrategy.mjs';
import { runSyncDocs } from './sync-docs.mjs';
import { parseRepoInput } from '../lib/parseRepoInput.mjs';
import { runBuildIndex } from '../lib/buildIndex.mjs';

/** 把字符串或 AddInput 规范化为 AddInput */
function resolveInput(input) {
  if (typeof input !== 'string') return input;
  const ref = parseRepoInput(input);
  // 字符串重载：http(s) URL 就用它当 cloneUrl；否则走默认 github URL
  let cloneUrl;
  if (/^https?:\/\//.test(input)) {
    cloneUrl = input.endsWith('.git') ? input : input + '.git';
  }
  return { owner: ref.owner, repo: ref.repo, cloneUrl };
}

/**
 * 收录新仓库。
 * 接受 `string`（owner/repo 或 https URL）或 `AddInput` 对象。
 * cwd：决定项目根位置（CLI 默认项目根，测试可传 tmpRoot）。
 */
export async function addRepo(input, cwd = process.cwd()) {
  const r = resolveInput(input);
  const root = getProjectRoot(cwd);
  const fullName = `${r.owner}/${r.repo}`;
  const url = r.cloneUrl ?? `https://github.com/${fullName}.git`;
  const group = r.group ?? '';
  const dirName = `${r.owner}__${r.repo}`;
  // path 相对 repos 根（repos 根可配置到项目根之外）
  const relPath = group ? `${group}/${dirName}` : dirName;
  const absTarget = join(reposRoot(), relPath);

  // 1. 重复检查
  const manifest = readManifest(cwd);
  if (findByFullName(manifest, fullName)) {
    return {
      ok: false,
      fullName,
      message: `duplicate full_name: ${fullName}（已收录）`,
    };
  }

  // 2. 目标已存在但 manifest 没有 → 拒绝（避免覆盖未登记目录）
  if (existsSync(absTarget)) {
    return {
      ok: false,
      fullName,
      message: `target exists but not in manifest: ${absTarget}`,
    };
  }

  // 3. clone（完整优先；失败按 rules.md §4.5 降级为浅克隆重试）
  mkdirSync(join(absTarget, '..'), { recursive: true });
  const cloneRes = await cloneWithFallback({
    url,
    target: absTarget,
    timeoutMs: r.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS,
    allowShallow: r.allowShallow !== false,
    shallowFirst: r.shallowFirst === true,
    run: (cloneArgs) =>
      gitStream(
        root,
        ['clone', ...cloneArgs, url, absTarget],
        (line, stream) => {
          // 过滤进度条（pitfalls §009）
          if (
            /^\s*[\w-]+:.*\d+%/.test(line) ||
            /^\s*Receiving objects:/.test(line) ||
            /^\s*Resolving deltas:/.test(line)
          ) {
            return;
          }
          const tag = stream === 'stderr' ? '[clone/err]' : '[clone]';
          console.log(`${tag} ${line}`);
        },
        { label: `clone:${dirName}`, timeoutMs: r.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS, detached: true }
      ),
  });
  if (!cloneRes.ok) {
    // 失败必不留半成品目录（rules.md §4.4）
    cleanupPartialClone(absTarget);
    return {
      ok: false,
      fullName,
      message: `clone failed (exit ${cloneRes.code}, ${cloneRes.attempts} attempt(s)): ${cloneRes.message}`,
    };
  }

  // 4. 构造 entry
  const now = nowIsoShanghai();
  const entry = buildEntryFromRepo(absTarget, {
    owner: r.owner,
    repo: r.repo,
    group,
    now,
  });

  // 5. 追加 manifest
  appendEntry(manifest, entry, now);
  writeManifest(manifest, cwd);

  // 6. 同步 docs
  runSyncDocs(cwd);

  // 7. 触发索引（异步，不阻塞响应）
  if (!r.skipBuildIndex) {
    void runBuildIndex();
  }

  return {
    ok: true,
    fullName,
    message: `added ${fullName} @ ${entry.current_commit_short}`,
    entry,
  };
}

/** CLI 注册信息（由 cli.mjs 汇总） */
export const def = {
  usage:
    'add <repo> [--group <group>] [--no-build-index] [--shallow] [--timeout <minutes>]',
  summary:
    '收录新仓库（owner/repo 或 https URL，默认完整 clone + 同步 docs + doc manager 索引；失败降级浅克隆）',
  booleans: ['--no-build-index', '--shallow'],
  strings: ['--group', '--timeout'],
  positionals: 1,
  async run(flags, positionals) {
    const input = positionals[0];
    const parsed = parseRepoInput(input);
    // --timeout <minutes>：覆盖默认 clone 超时（大仓在慢速网络下需要更长）
    const timeoutMin = flags.timeout ? Number(flags.timeout) : undefined;
    if (timeoutMin !== undefined && (!Number.isFinite(timeoutMin) || timeoutMin <= 0)) {
      return { ok: false, message: `--timeout 需要正数分钟，收到：${flags.timeout}` };
    }
    const r = await addRepo({
      owner: parsed.owner,
      repo: parsed.repo,
      cloneUrl: /^https?:\/\//.test(input)
        ? input.endsWith('.git')
          ? input
          : input + '.git'
        : undefined,
      group: flags.group,
      skipBuildIndex: flags['build-index'] === false,
      shallowFirst: flags.shallow === true,
      cloneTimeoutMs: timeoutMin ? timeoutMin * 60_000 : undefined,
    });
    console.log(`${r.ok ? '✓' : '✗'} ${r.fullName} — ${r.message}`);
    if (!r.ok) process.exit(1);
  },
};
