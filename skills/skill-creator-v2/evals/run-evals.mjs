#!/usr/bin/env node
// run-evals —— 跑 `evals/evals.json` 里 judge=machine 的用例（机判回归护栏）。
//
// I/O 契约（skills/skill-creator-v2/references/structure.md §5.3）：
//   stdout 只输出一行合法 JSON —— {"ok":true,"data":...} 或 {"ok":false,"error":"..."}；
//   日志走 stderr；退出码 成功 0 / 失败 1。
//
// 路径一律按**脚本自身位置**解析（import.meta.url），绝不依赖 process.cwd()。
// 依赖的件不存在时（仓外安装副本：bin/cli.js 只带 skills/<name>，不带 scripts/ 与别的技能）
// ⇒ 该用例标 skipped 并写明原因，不假装通过、也不假装失败。
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, "..");
const REPO = resolve(SKILL_DIR, "..", "..");
const EVALS = join(HERE, "evals.json");

const log = (s) => process.stderr.write(s + "\n");
const results = [];
let failed = 0;

function record(id, ok, detail, skipped) {
  results.push({ id, ok, detail, ...(skipped ? { skipped: true } : {}) });
  if (!ok && !skipped) failed++;
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { status: r.status === null ? 2 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// ---- 用例 1：description 的触发词回归护栏 --------------------------------
function caseTrigger(ev) {
  const file = join(SKILL_DIR, "SKILL.md");
  if (!existsSync(file)) return { skipped: true, detail: "SKILL.md 不存在" };
  const text = readFileSync(file, "utf8");
  const desc = (text.match(/^description:\s*(.*)$/m) || [, ""])[1];
  // expectations 里写清的触发关键词，逐个必须出现在 description 里
  const keywords = ["skill", "SKILL.md", "references"];
  const missing = keywords.filter((k) => !desc.includes(k));
  return {
    ok: missing.length === 0,
    detail: missing.length ? `description 缺触发关键词：${missing.join("、")}` : "description 含全部触发关键词",
  };
}

// ---- 用例 2：human-docs 合规（校验 error 为 0 + 统一门禁 passed 清单含它） ----
function caseHumanDocs(ev) {
  const validator = join(REPO, "skills", "skill-creator-v2", "scripts", "validate_skill.py");
  const gate = join(REPO, "scripts", "gates", "harness-check.mjs");
  if (!existsSync(validator)) return { skipped: true, detail: "仓内没有 validate_skill.py（仓外安装副本）" };
  if (!existsSync(gate)) return { skipped: true, detail: "仓内没有统一门禁脚本 harness-check.mjs" };
  const target = join(REPO, "skills", "human-docs");
  const v = sh("python", [validator, target, "--json"]);
  let errs = 0;
  try {
    const j = JSON.parse(v.stdout);
    errs = (j.reports || []).flatMap((r) => r.issues || []).filter((i) => i.level === "error").length;
  } catch {
    return { ok: false, detail: `validate_skill 的输出不是合法 JSON（exit ${v.status}）` };
  }
  if (errs !== 0) return { ok: false, detail: `human-docs 仍有 ${errs} 条 error` };
  const g = sh("node", [gate, "--json"]);
  try {
    const j = JSON.parse(g.stdout);
    const hit = (j.passed || []).some((p) => p.includes("human-docs"));
    return hit
      ? { ok: true, detail: "human-docs 0 error 且在门禁报告的 passed 清单里" }
      : { ok: false, detail: "human-docs 不在门禁报告的 passed 清单里" };
  } catch {
    return { ok: false, detail: `门禁报告不是合法 JSON（exit ${g.status}）` };
  }
}

// ---- 用例 3：死引用检出（临时 fixture，不依赖仓内现存的坏链接） ----------------
function caseDeadRef(ev) {
  const checker = join(REPO, "skills", "rules-layer-governance", "templates", "check-dead-refs.sh");
  if (!existsSync(checker)) return { skipped: true, detail: "仓内没有死引用检查器（仓外安装副本）" };
  const dir = mkdtempSync(join(tmpdir(), "mm-gsd-probe-evals-"));
  const fixture = join(dir, "rule.md");
  try {
    writeFileSync(fixture, "# 样例\n\n- 指向不存在的文件：[gone](./nowhere/missing.md)\n");
    const r = sh("bash", [checker, fixture]);
    const out = r.stdout + r.stderr;
    const hit = out.includes("死引用") && out.includes("rule.md") && /rule\.md:3/.test(out);
    return hit
      ? { ok: true, detail: "坏链接被报出且带文件:行" }
      : { ok: false, detail: `没报出坏链接（exit ${r.status}）：${out.slice(0, 160)}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const IMPL = { 1: caseTrigger, 2: caseHumanDocs, 3: caseDeadRef };

function main() {
  if (!existsSync(EVALS)) {
    console.log(JSON.stringify({ ok: false, error: `找不到 ${EVALS}` }));
    process.exit(1);
  }
  let spec;
  try {
    spec = JSON.parse(readFileSync(EVALS, "utf8"));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: `evals.json 解析失败：${e.message}` }));
    process.exit(1);
  }
  const skipped = [];
  for (const ev of spec.evals || []) {
    if (ev.judge === "agent") {
      skipped.push({ id: ev.id, reason: "agent 判定用例：由 scripts/run_eval.py 判（需 claude CLI），本 runner 不跑" });
      record(ev.id, true, "agent 判定用例，本 runner 不跑", true);
      continue;
    }
    const fn = IMPL[ev.id];
    if (!fn) {
      skipped.push({ id: ev.id, reason: "runner 里没有这条用例的实现" });
      record(ev.id, true, "runner 未实现该用例", true);
      continue;
    }
    let r;
    try {
      r = fn(ev);
    } catch (e) {
      r = { ok: false, detail: `用例执行异常：${e.message}` };
    }
    record(ev.id, r.ok, r.detail, r.skipped);
    log(`#${ev.id} ${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"} ${r.detail}`);
  }
  const data = {
    skill_name: spec.skill_name || null,
    total: results.length,
    passed: results.filter((r) => r.ok && !r.skipped).length,
    failed,
    skipped,
    results,
  };
  console.log(JSON.stringify(failed === 0 ? { ok: true, data } : { ok: false, error: `${failed} 条 machine 用例未通过`, data }));
  process.exit(failed === 0 ? 0 : 1);
}

main();
