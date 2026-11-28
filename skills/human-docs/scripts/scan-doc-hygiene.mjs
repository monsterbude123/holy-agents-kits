#!/usr/bin/env node
// scan-doc-hygiene.mjs — check-doc-hygiene.sh 的扫描引擎(node 边车)
//
// 为什么独立成文件:bash 内联 node -e 会被 MSYS 参数折叠吃掉正则里的反斜杠
// (实测 MSYS_NO_PATHCONV=1 环境下 \\ → \,正则直接语法错误),文件形态不经手
// bash 参数传递;且 node 原生支持 lookbehind,不赌 grep 风味(本仓开发机 PATH 里
// grep 可能是 ugrep,-P/-c 行为有差异)。
//
// 输入:stdin = 待扫文件清单(仓根相对路径,一行一个);argv = [root, dirsCsv, excludesCsv]
// 输出:TSV → A\tfile\tline\tsnippet(机器特定路径)/ B\tfile\tline\t目标路径(存在的链接目标)
// 口径:带 `<!-- doc-hygiene:allow -->` 的行整行豁免;链接只判 ](<path>) 不含空格者;
//      机器路径正则 = skill_schema.py LOCAL_PATH_RE 基座(lookbehind 防 https:// 误伤)
//      + MSYS 家目录 /c/Users/,不收 /home/(容器家目录与 URL 段全是误伤)
import fs from "node:fs";
import path from "node:path";

const [root, dirsCsv, excludesCsv] = process.argv.slice(2);
if (!root) {
  console.error("usage: scan-doc-hygiene.mjs <root> <dirsCsv> <excludesCsv> < filelist");
  process.exit(2);
}
const dirs = (dirsCsv || ".").split(",");
const excludes = (excludesCsv || "").split(",").filter(Boolean);
// bash 风格 glob → 正则:* 跨目录段(与 bash [[ == ]] 语义一致),其余字符原义
const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
const exRes = excludes.map(globRe);
// 目标目录判定:缺省 "." = 整仓;其余按「等于或位于该目录下」
const inDir = (f) =>
  dirs.some((d) => (d === "." ? true : f === d || f.startsWith(d + "/")));

const re = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]|(?<![A-Za-z0-9])[A-Za-z]%3[Aa][\\/]|(?<![A-Za-z0-9])\/c\/Users\//;
const link = /\]\(([^)\s]+)\)/g;

const list = fs.readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
for (const f of list) {
  if (exRes.some((r) => r.test(f))) continue;
  if (!inDir(f)) continue;
  let lines;
  try {
    lines = fs.readFileSync(path.join(root, f), "utf8").split(/\r?\n/);
  } catch {
    continue;
  }
  lines.forEach((s, i) => {
    if (s.includes("doc-hygiene:allow")) return;
    if (re.test(s)) console.log("A\t" + f + "\t" + (i + 1) + "\t" + s.trim().slice(0, 80));
    let m;
    link.lastIndex = 0;
    while ((m = link.exec(s))) {
      const t = m[1];
      if (/^(https?:|mailto:|#|\/)/i.test(t) || t.includes("://")) continue;
      const tgt = t.split("#")[0];
      if (!tgt) continue;
      const abs = path.resolve(root, path.dirname(f), tgt);
      try {
        fs.statSync(abs);
      } catch {
        continue;
      }
      console.log("B\t" + f + "\t" + (i + 1) + "\t" + path.relative(root, abs).replace(/\\/g, "/"));
    }
  });
}
