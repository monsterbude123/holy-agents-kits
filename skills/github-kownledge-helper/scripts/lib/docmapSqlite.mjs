// docmapSqlite.mjs — 以 python 读 SQLite，取 doc-map-manager 索引的 repoKey 聚合
//
// 为什么不直接用 node 读 SQLite：Node 22 无内置 SQLite 驱动，引入 npm 依赖会破坏零构建。
// 故 spawn python 执行内联 SQL（python 是 doc-map-manager 的既有前置依赖）。

import { spawn } from 'node:child_process';

const SQL_FULL = `
import sqlite3, sys, json
db = sys.argv[1]
if not __import__('os').path.exists(db):
    print('[]')
    sys.exit(0)
c = sqlite3.connect(db)
rows = c.execute("SELECT path, freshness_score, last_git_commit FROM files").fetchall()
c.close()
out = []
for path, fs, lc in rows:
    parts = path.split('/')
    if len(parts) >= 2 and '__' in parts[0]:
        key = parts[0]
    elif len(parts) >= 3 and '__' in parts[1]:
        key = parts[0] + '/' + parts[1]
    else:
        continue
    out.append({"repoKey": key, "freshnessScore": float(fs) if fs is not None else 0.0, "lastCommit": lc or ""})
seen = {}
for e in out:
    k = e["repoKey"]
    if k not in seen or e["freshnessScore"] > seen[k]["freshnessScore"]:
        seen[k] = e
print(json.dumps(list(seen.values()), ensure_ascii=False))
`;

/** spawn python 跑内联 SQL，返回 stdout */
function runPython(sql, dbPath) {
  return new Promise((resolve) => {
    const child = spawn('python', ['-c', sql, dbPath], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString('utf-8')));
    child.on('close', () => resolve(out));
    child.on('error', () => resolve('[]'));
  });
}

/** 取索引里每个 repoKey 的最高 freshness_score */
export async function querySqliteFull(dbPath) {
  return runPython(SQL_FULL, dbPath);
}
