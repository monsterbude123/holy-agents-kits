// queryModes.mjs — query 的各模式实现（每模式一个函数，便于拆分与单测）
//
// ctx = { repo, absRepo, manifest }
//   repo    resolveRepo 命中的 manifest 条目
//   absRepo 该仓本地绝对路径
//   manifest 完整 manifest（freshness 需要 last_pull_at）

import { git } from './git.mjs';
import { formatLog, formatTag, formatShow, formatGrab } from './queryFormat.mjs';
import { listTags, resolveTag, queryPythonGrab } from './queryGit.mjs';

/** manifest vs git HEAD 的新鲜度比对 */
export function modeFreshness(ctx) {
  const { repo, absRepo, manifest } = ctx;
  const headSha = git(absRepo, ['rev-parse', 'HEAD']);
  const headShort = git(absRepo, ['rev-parse', '--short', 'HEAD']);
  const match = headSha === repo.current_commit;
  const me = manifest.repos.find((r) => r.full_name === repo.full_name);
  const lastPullAt = me?.last_pull_at ?? '';
  const out =
    '=== ' + repo.full_name + ' freshness ===\n' +
    'manifest.current_commit:  ' + repo.current_commit_short + '\n' +
    'git HEAD:                 ' + headShort + '  ' + (match ? 'MATCH' : 'DRIFT (建议跑 update)') + '\n' +
    'last_pull_at:             ' + lastPullAt + '\n';
  return { ok: true, output: out, message: match ? 'fresh' : 'drift' };
}

/** git log --oneline（可带 --since / --until / --limit） */
export function modeLog(ctx, flags) {
  const { repo, absRepo } = ctx;
  const gitArgs = ['log', '--oneline', '-' + flags.limit];
  if (flags.since) gitArgs.push('--since=' + flags.since);
  if (flags.until) gitArgs.push('--until=' + flags.until);
  const raw = git(absRepo, gitArgs);
  const lines = raw ? raw.split('\n').filter((l) => l.trim()) : [];
  return {
    ok: true,
    output: formatLog(
      repo.full_name,
      repo.current_commit_short,
      repo.current_commit_date,
      lines
    ),
    message: lines.length + ' commits',
  };
}

/** tag 精确查 / pattern 列表 */
export function modeTag(ctx, flags) {
  const { repo, absRepo } = ctx;
  if (!flags.tag) {
    return { ok: false, output: '', message: '--tag 需要 pattern 参数' };
  }
  if (flags.tag.includes('*')) {
    const list = listTags(absRepo, flags.tag);
    if (list.length === 0) {
      return { ok: false, output: '', message: "no tag matches '" + flags.tag + "'" };
    }
    const headShort = git(absRepo, ['rev-parse', '--short', 'HEAD']);
    return {
      ok: true,
      output: formatTag(repo.full_name, null, headShort, 0, list),
      message: list.length + ' tags',
    };
  }
  const exact = resolveTag(absRepo, flags.tag);
  if (!exact) {
    return { ok: false, output: '', message: "tag '" + flags.tag + "' not found" };
  }
  const headShort = git(absRepo, ['rev-parse', '--short', 'HEAD']);
  const behind = parseInt(
    git(absRepo, ['rev-list', '--count', flags.tag + '..HEAD']) || '0',
    10
  );
  return {
    ok: true,
    output: formatTag(repo.full_name, exact, headShort, behind),
    message: 'tag ' + flags.tag + ' @ ' + exact.commit.slice(0, 7),
  };
}

/** git show --stat（可带 --patch） */
export function modeShow(ctx, flags) {
  const { repo, absRepo } = ctx;
  if (!flags.show) {
    return { ok: false, output: '', message: '--show 需要 <sha> 参数' };
  }
  const fullSha = git(absRepo, ['rev-parse', flags.show]);
  if (!fullSha) {
    return { ok: false, output: '', message: "invalid sha '" + flags.show + "'" };
  }
  const gitArgs = ['show', '--stat', fullSha];
  if (flags.patch) gitArgs.push('--patch');
  const raw = git(absRepo, gitArgs);
  if (!raw) {
    return { ok: false, output: '', message: 'git show failed' };
  }
  return {
    ok: true,
    output: formatShow(repo.full_name, flags.show, raw),
    message: 'show ' + flags.show,
  };
}

/** doc-map-manager 文档检索（--grab） */
export async function modeGrab(ctx, flags) {
  const { repo } = ctx;
  if (!flags.grab) {
    return { ok: false, output: '', message: '--grab 需要 <question> 参数' };
  }
  const stdout = await queryPythonGrab(flags.grab);
  if (!stdout) {
    return {
      ok: false,
      output: '',
      message: 'query-index.py failed（确认 docs/.docmap/docmap.db 存在）',
    };
  }
  return {
    ok: true,
    output: formatGrab(repo.full_name, flags.grab, stdout),
    message: 'grab done',
  };
}
