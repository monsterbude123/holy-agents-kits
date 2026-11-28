// verifyDocs.mjs — 解析 doc-map-manager query-index.py --grab 的 stdout

// 注：\u{...} 转义必须配 `u` 标志，否则非 unicode 模式下被当作字面量 "u{1F7E2}" 匹配不到任何 emoji
const FRESHNESS_RE =
  /^\s*(\u{1F7E2}|\u{1F7E1}|\u{1F534})\s*新鲜度:\s*([\d.]+)/u;
const PATH_RE = /^\s*##\s+([^/\s]+)\/(\S+?)\s+(?:\S+\s+)?\(score:\s*([\d.]+)\)/;

/**
 * 解析 query-index.py --grab 的 stdout 文本为 DocHit[]。
 * 输出格式（doc-map-manager 标准）：
 *   🟢/🟡/🔴 新鲜度: 0.NN
 *   ## <owner>__<repo>/<file> L<start>-L<end> (score: 0.NN)
 *   L<start>   > 引用行...
 * 注：path 行可能有 L<range> 前缀；引用行以 L\d+ 开头可能误判。改用「逐行扫 + 找最近 path 行」策略。
 */
export function parseQueryIndexOutput(stdout) {
  const hits = [];
  const lines = String(stdout ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i]?.match(FRESHNESS_RE);
    if (!f) continue;
    // 向下最多 5 行找 path 行
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const p = lines[j]?.match(PATH_RE);
      if (!p) continue;
      hits.push({
        repo: p[1] ?? '',
        file: (p[2] ?? '').trim(),
        freshness:
          f[1] === '\u{1F7E2}' ? 'green' : f[1] === '\u{1F7E1}' ? 'yellow' : 'red',
        freshnessScore: parseFloat(f[2] ?? '0'),
        score: parseFloat(p[3] ?? '0'),
      });
      break;
    }
  }
  return hits;
}

/**
 * 把 hits 按 repo 维度汇总，与 manifest 的 repo 列表对比出 missing。
 */
export function summarizeFreshness(manifestRepos, hits) {
  const hitRepos = new Set(hits.map((h) => h.repo));
  return {
    total: manifestRepos.length,
    green: hits.filter((h) => h.freshness === 'green').length,
    yellow: hits.filter((h) => h.freshness === 'yellow').length,
    red: hits.filter((h) => h.freshness === 'red').length,
    missing: manifestRepos.filter((r) => !hitRepos.has(r)),
  };
}

/** 从 manifest path 提取 owner__repo 形式（如 "repos/comfyanonymous__ComfyUI" → "comfyanonymous__ComfyUI"） */
export function pathToRepoKey(relPath) {
  // 匹配最后一段 owner__repo
  const m = relPath.match(/(?:^|\/)([^/]+)__([^/]+)$/);
  if (m) return `${m[1]}__${m[2]}`;
  return relPath;
}
