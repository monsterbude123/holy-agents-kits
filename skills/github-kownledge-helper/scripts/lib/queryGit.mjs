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

/** 列出匹配 pattern 的 tag（pattern 为 null 时列全部） */
export function listTags(absRepo, pattern) {
  const listArgs = pattern ? ['tag', '--list', pattern] : ['tag', '--list'];
  const raw = git(absRepo, listArgs);
  if (!raw) return [];
  return raw
    .split('\n')
    .filter((n) => n.trim())
    .map((name) => ({
      name: name.trim(),
      commit: git(absRepo, ['rev-list', '-n', '1', name]) || '',
      date: git(absRepo, ['log', '-1', '--format=%cI', name]) || '',
      subject: git(absRepo, ['log', '-1', '--format=%s', name]) || '',
    }));
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
