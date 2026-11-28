// query.mjs — 答疑 CLI（单命令 + 多互斥模式 flag）
// 模式：--log / --tag / --show / --grab / --freshness / --recent (--all)
// 复用：lib/queryFlags.mjs（解析）/ lib/queryModes.mjs（各模式）/ lib/queryFormat.mjs（格式化）

import { join } from 'node:path';
import { getProjectRoot } from '../lib/paths.mjs';
import { readManifest } from '../lib/manifest.mjs';
import { parseQueryFlags } from '../lib/queryFlags.mjs';
import { formatRecent } from '../lib/queryFormat.mjs';
import {
  modeFreshness,
  modeLog,
  modeTag,
  modeShow,
  modeGrab,
} from '../lib/queryModes.mjs';

/** 按 full_name / name / path / docs_path 模糊匹配 manifest 中的仓库 */
export function resolveRepo(needle, cwd = process.cwd()) {
  const m = readManifest(cwd);
  for (const r of m.repos) {    if (
      r.full_name === needle ||
      r.name === needle ||
      r.path === needle ||
      r.path.endsWith('/' + needle) ||
      r.path.endsWith('__' + needle) ||
      r.docs_path.endsWith('/' + needle)
    ) {
      return {
        full_name: r.full_name,
        owner: r.owner,
        name: r.name,
        path: r.path,
        docs_path: r.docs_path,
        group: r.group,
        current_commit: r.current_commit,
        current_commit_short: r.current_commit_short,
        current_commit_date: r.current_commit_date,
      };
    }
  }
  return null;
}

/**
 * 答疑主入口。
 * args：query 的 argv 片段（位置参数为 repo，选项为模式 flag）
 */
export async function runQuery(args, cwd = process.cwd()) {
  const flags = parseQueryFlags(args);
  const root = getProjectRoot(cwd);

  if (flags.all && flags.mode === 'recent') {
    const m = readManifest(cwd);
    const items = m.repos.map((r) => ({
      full_name: r.full_name,
      short: r.current_commit_short,
      date: r.current_commit_date,
    }));
    return {
      ok: true,
      output: formatRecent(items, flags.since),
      message: items.length + ' repos',
    };
  }

  const repo = resolveRepo(flags.repo ?? '', cwd);
  if (!repo) {
    return {
      ok: false,
      output: '',
      message: 'NOT FOUND: ' + flags.repo + '（按 full_name / name / path 匹配均无）',
    };
  }

  const ctx = {
    repo,
    absRepo: join(root, repo.path),
    manifest: readManifest(cwd),
  };

  if (flags.mode === 'freshness') return modeFreshness(ctx);
  if (flags.mode === 'log') return modeLog(ctx, flags);
  if (flags.mode === 'tag') return modeTag(ctx, flags);
  if (flags.mode === 'show') return modeShow(ctx, flags);
  if (flags.mode === 'grab') return modeGrab(ctx, flags);

  return { ok: false, output: '', message: 'unknown mode' };
}

/** CLI 注册信息（由 cli.mjs 汇总） */
export const def = {
  usage:
    'query <repo> [--log | --tag <pattern> | --show <sha> | --grab <question> | --freshness]',
  summary:
    '答疑：log / tag / show / grab / freshness / 全仓 recent（见 q <repo> --help）',
  booleans: [
    '--log',
    '--freshness',
    '--json',
    '--patch',
    '--no-cross-check',
    '--all',
    '--recent',
  ],
  strings: [
    '--tag',
    '--show',
    '--grab',
    '--limit',
    '--since',
    '--until',
    '--context',
    '--top',
  ],
  positionals: 1,
  async run(flags, positionals, raw) {
    const r = await runQuery(raw);
    console.log(r.output);
    if (!r.ok) {
      console.error(`✗ ${r.message}`);
      process.exit(1);
    }
  },
};

/** query-all 的 CLI 注册信息（全仓最近活动） */
export const defAll = {
  usage: 'query-all [--since <date>]',
  summary: '全仓最近活动（按 manifest.current_commit_date）',
  booleans: [],
  strings: ['--since'],
  positionals: 0,
  async run(flags) {
    const args = ['--all', '--recent'];
    if (flags.since) args.push('--since', flags.since);
    const r = await runQuery(args);
    console.log(r.output);
    if (!r.ok) process.exit(1);
  },
};

export { parseQueryFlags } from '../lib/queryFlags.mjs';
export {
  formatLog,
  formatTag,
  formatShow,
  formatGrab,
  formatRecent,
} from '../lib/queryFormat.mjs';
