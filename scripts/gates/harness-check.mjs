#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const STANDARD_PATH = "scripts/gates/standards.json";
const standard = JSON.parse(readFileSync(STANDARD_PATH, "utf8"));
const maxLines = standard.components.skill_md.max_lines;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return {
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    status: r.status === null ? 2 : r.status,
  };
}

function lineOf(message) {
  const m = String(message).match(/(?:^|[:：\s])(\d{1,5})(?=\D|$)/);
  return m ? Number(m[1]) : 0;
}

const pyArgs = [
  "skills/skill-creator-v2/scripts/validate_skill.py",
  "--all", "--root", ".", "--json", "--max-lines", String(maxLines),
];
const applied = { validate_skill_argv: ["python", ...pyArgs] };
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

const pyIssues = [];
const passed = [];
for (const rep of reports) {
  if (rep.error) {
    pyIssues.push({ file: rep.skill || "skills/", line: 0, message: rep.error });
    continue;
  }
  const issues = Array.isArray(rep.issues) ? rep.issues : [];
  for (const i of issues) {
    pyIssues.push({
      file: rep.skill || "skills/",
      line: lineOf(i.message),
      level: i.level,
      code: i.code,
      message: i.message,
    });
  }
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length === 0) passed.push(String(rep.skill || "").replace(/^\.\//, ""));
}

const r2 = run("bash", ["skills/vibe-coding-standards/scripts/validate_vibe_docs.sh", "."]);
const vibeIssues = r2.stdout.split("\n").filter((l) => /^(FAIL|WARN)/.test(l)).map((l) => {
  const m = l.match(/^(FAIL|WARN)\s+(\S+)/);
  return { file: m ? m[2] : "skills/vibe-coding-standards/", line: 0, message: l };
});

const r3 = run("bash", ["skills/rules-layer-governance/templates/check-dead-refs.sh"]);
const refIssues = r3.stdout.split("\n").filter((l) => l.includes("死引用 ")).map((l) => {
  const m = l.match(/死引用\s+(\S+):(\d+)/);
  return {
    file: m ? m[1] : "AGENTS.md",
    line: m ? Number(m[2]) : 0,
    message: l,
  };
});

const checkers = [
  { name: "validate_skill", exit_code: r1.status, issues: pyIssues },
  { name: "validate_vibe_docs", exit_code: r2.status, issues: vibeIssues },
  { name: "check_dead_refs", exit_code: r3.status, issues: refIssues },
];
const ok = !schemaFailed && checkers.every((c) => c.exit_code === 0);

const report = {
  standard,
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
