// queryFormat.mjs — query 的输出格式化（纯函数，无 IO）
//
// emoji 用 \u{N} 形式书写，避免不同编辑器/编码链路把字符替换成 U+FFFD

import { parseQueryIndexOutput } from './verifyDocs.mjs';

const EMOJI_GREEN = '\u{1F7E2}';
const EMOJI_YELLOW = '\u{1F7E1}';
const EMOJI_RED = '\u{1F534}';

/**
 * @typedef {Object} TagInfo
 * @property {string} name
 * @property {string} commit
 * @property {string} date
 * @property {string} subject
 */

/**
 * @typedef {Object} RecentItem
 * @property {string} full_name
 * @property {string} short
 * @property {string} date
 */

export function formatLog(fullName, shortSha, lastPullAt, lines) {
  const header =
    '=== ' +
    fullName +
    ' log (HEAD=' +
    shortSha +
    ', last_pull_at=' +
    lastPullAt +
    ') ===';
  if (lines.length === 0) return header + '\n(no commits)\n';
  return header + '\n' + lines.join('\n') + '\n';
}

export function formatTag(fullName, exact, headShort, behindCount, list) {
  if (exact) {
    const headMatch = exact.commit.startsWith(headShort) ? 'true' : 'false';
    const behindStr = behindCount > 0 ? behindCount + ' commits' : '0';
    return (
      '=== ' +
      fullName +
      " tag '" +
      exact.name +
      "' ===\n" +
      'commit:  ' +
      exact.commit +
      '\n' +
      'date:    ' +
      exact.date +
      '\n' +
      'message: ' +
      exact.subject +
      '\n' +
      'vs HEAD: exactly at HEAD (' +
      headMatch +
      ') | behind HEAD by ' +
      behindStr +
      '\n'
    );
  }
  const tags = list ?? [];
  return (
    '=== ' +
    fullName +
    ' tags (' +
    tags.length +
    ' matches) ===\n' +
    tags
      .map((t) => t.name + '\t-> ' + t.commit + '\t' + t.date + '\t' + t.subject)
      .join('\n') +
    '\n'
  );
}

export function formatShow(fullName, sha, raw) {
  return '=== ' + fullName + ' show ' + sha + ' ===\n' + raw + '\n';
}

export function formatGrab(fullName, question, stdout) {
  const hits = parseQueryIndexOutput(stdout);
  const head = '=== ' + fullName + ' grab "' + question + '" ===';
  if (hits.length === 0) return head + '\n(no match)\n';
  const lines = hits.map((h) => {
    const emoji =
      h.freshness === 'green'
        ? EMOJI_GREEN
        : h.freshness === 'yellow'
          ? EMOJI_YELLOW
          : EMOJI_RED;
    return (
      emoji +
      ' ' +
      h.freshnessScore.toFixed(2) +
      '  ' +
      h.repo +
      '/' +
      h.file +
      ' (score=' +
      h.score.toFixed(2) +
      ')'
    );
  });
  return head + '\n' + lines.join('\n') + '\n';
}

export function formatRecent(items, since) {
  const sinceStr = since ? ' (since ' + since + ')' : '';
  return (
    '=== recent activity across ' +
    items.length +
    ' repos' +
    sinceStr +
    ' ===\n' +
    items.map((i) => i.full_name + '\tHEAD ' + i.short + '\t' + i.date).join('\n') +
    '\n'
  );
}
