#!/usr/bin/env node
// harness-check —— 统一门禁编排器：三个检查器 → 一份结构化报告（stdout）。
//
// 报告里的 file 一律是**仓根相对路径**且真实存在（能直接打开定位）；
// line 是该文件内的 1 基行号，0 表示「整文件级问题」（计数类，行数在 message 里）。
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const STANDARD_PATH = "scripts/gates/standards.json";
const standard = JSON.parse(readFileSync(STANDARD_PATH, "utf8"));
const maxLines = standard.components.skill_md.max_lines;

// 路径归一：反斜杠 → /，去掉 ./ 前缀
const slash = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    status: r.status === null ? 2 : r.status,
  };
}

const pyArgs = [
  "skills/skill-creator-v2/scripts/validate_skill.py",
  "--all", "--root", ".", "--json", "--max-lines", String(maxLines),
];
const vibeArgs = ["skills/vibe-coding-standards/scripts/validate_vibe_docs.sh", "."];
const deadArgs = ["skills/rules-layer-governance/templates/check-dead-refs.sh"];
const hygArgs = ["skills/human-docs/scripts/check-doc-hygiene.sh", "."];
const applied = {
  validate_skill_argv: ["python", ...pyArgs],
  vibe_argv: ["bash", ...vibeArgs],
  dead_refs_argv: ["bash", ...deadArgs],
  doc_hygiene_argv: ["bash", ...hygArgs],
};

const r1 = run("python", pyArgs);
let reports = [];
let schemaFailed = false;
try {
  const j = JSON.parse(r1.stdout);
  reports = Array.isArray(j.reports) ? j.reports : [];
  schemaFailed = Boolean(j.failed);
} catch {
  reports = [];
  schemaFailed = true;
}

// python 侧的 file 是「相对 skill 目录」的路径 ⇒ 拼上 skill 目录才是仓根相对路径
const pyIssues = [];
const passed = [];
for (const rep of reports) {
  const skillDir = slash(rep.skill);
  const issues = Array.isArray(rep.issues) ? rep.issues : [];
  if (rep.error) {
    pyIssues.push({
      file: skillDir ? `${skillDir}/SKILL.md` : "SKILL.md",
      line: 0,
      level: "error",
      code: "skill.parse",
      message: rep.error,
    });
    continue;
  }
  for (const i of issues) {
    const rel = slash(i.file);
    let file = rel;
    if (rel && !/^\//.test(rel) && !/^[A-Za-z]:\//.test(rel) && skillDir) {
      file = `${skillDir}/${rel}`;
    }
    pyIssues.push({
      file,
      line: typeof i.line === "number" ? i.line : 0,
      level: i.level,
      code: i.code,
      message: i.message,
    });
  }
  if (issues.filter((i) => i.level === "error").length === 0) passed.push(skillDir);
}

// 两个 shell 检查器的输出已是「文件:行 → 目标」形态：按行解析出 file/line
function parseShellIssues(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^(?:WARN|FAIL|死引用)\s+(\S+?):(\d+)\s*(.*)$/);
    if (!m) continue;
    out.push({ file: slash(m[1]), line: Number(m[2]), message: line.trim() });
  }
  return out;
}

const r2 = run("bash", vibeArgs);
const r3 = run("bash", deadArgs);
const r4 = run("bash", hygArgs);

const checkers = [
  { name: "validate_skill", exit_code: r1.status, issues: pyIssues },
  { name: "validate_vibe_docs", exit_code: r2.status, issues: parseShellIssues(r2.stdout) },
  { name: "check_dead_refs", exit_code: r3.status, issues: parseShellIssues(r3.stdout) },
  { name: "check_doc_hygiene", exit_code: r4.status, issues: parseShellIssues(r4.stdout) },
];
const ok = !schemaFailed && checkers.every((c) => c.exit_code === 0);

const report = {
  standard,
  standard_version: standard.version,
  standard_source: STANDARD_PATH,
  applied,
  checkers,
  passed,
  ok,
  overall_exit_code: ok ? 0 : 1,
};
console.log(JSON.stringify(report, null, 2));

// --json = 报告模式，恒 0 退出，供机读断言消费；默认 = 门禁模式，按结果退出。
process.exit(process.argv.includes("--json") ? 0 : report.overall_exit_code);
