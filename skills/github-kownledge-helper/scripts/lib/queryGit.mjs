// queryGit.mjs — query 模式背后的 git / python 调用（纯 IO，无格式化）

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { git } from './git.mjs';
import { get } from './envStrict.mjs';

/**
 * @typedef {Object} TagInfo
 * @property {string} name
 * @property {string} commit
 * @property {string} date
 * @property {string} subject
 */

/** 列出匹配 pattern 的 tag（pattern 为 null 时列全部）
 *  一次 for-each-ref 拿全量（旧实现每 tag 三次子进程，千 tag 仓分钟级）。
 *  语义与旧版一致：annotated tag 取被指向 commit 的 sha / 日期 / 主题，
 *  即「剥壳字段」（*objectname 等）优先于 tag 对象自身字段。 */
export function listTags(absRepo, pattern) {
  const FORMAT =
    '%(refname:short)%09%(objectname)%09%(*objectname)%09%(creatordate:iso-strict)%09%(*creatordate:iso-strict)%09%(contents:subject)%09%(*contents:subject)';
  // pattern 语义对齐旧版 git tag --list（fnmatch glob），换成 for-each-ref 的前缀 glob
  const args = ['for-each-ref', '--format', FORMAT, `refs/tags/${pattern ?? '*'}`];
  const raw = git(absRepo, args);
  if (!raw) return [];
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [name, obj, peeledObj, creatorDate, peeledDate, subject, peeledSubject] =
        line.split('\t');
      return {
        name: (name ?? '').trim(),
        commit: peeledObj || obj || '',
        date: peeledDate || creatorDate || '',
        subject: peeledSubject || subject || '',
      };
    });
}

/** 解析精确 tag；不存在返回 null */
export function resolveTag(absRepo, tagName) {
  const commit = git(absRepo, ['rev-list', '-n', '1', tagName]);
  if (!commit) return null;
  const date = git(absRepo, ['log', '-1', '--format=%cI', tagName]);
  const subject = git(absRepo, ['log', '-1', '--format=%s', tagName]);
  return { name: tagName, commit, date: date ?? '', subject: subject ?? '' };
}

/** 调用 doc-map-manager 的 query-index.py --grab，返回 stdout */
export function queryPythonGrab(query) {
  const scripts = get('doc_map_scripts');
  return new Promise((resolve) => {
    const child = spawn(
      'python',
      [join(scripts, 'query-index.py'), '--grab', query],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString('utf-8')));
    child.on('close', () => resolve(out));
    child.on('error', () => resolve(''));
  });
}
