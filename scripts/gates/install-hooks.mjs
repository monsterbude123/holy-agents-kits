#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HOOKS_PATH = "scripts/gates";
const EVIDENCE_KEY = "hooks.previousHooksPath";
const UNSET = "__UNSET__";
const hook = join(process.cwd(), HOOKS_PATH, "pre-commit");

function git(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}
const get = (key) => git(["config", "--local", "--get", key]).stdout.trim();

if (process.argv.includes("--check")) {
  const current = get("core.hooksPath");
  const ok = current === HOOKS_PATH && existsSync(hook);
  if (!ok) {
    console.error(`hooksPath=${current || "<unset>"}, hook=${existsSync(hook) ? "present" : "missing"}`);
    process.exit(1);
  }
  console.log(`hooksPath=${HOOKS_PATH}, hook=present`);
  process.exit(0);
}

// --restore：按留证把 core.hooksPath 恢复回原值（留证缺失就拒绝猜测）
if (process.argv.includes("--restore")) {
  const evidence = get(EVIDENCE_KEY);
  if (!evidence) {
    console.error(`--restore：留证键 ${EVIDENCE_KEY} 不存在，无法判定原值，拒绝猜测`);
    process.exit(1);
  }
  const current = get("core.hooksPath");
  if (evidence === UNSET) {
    git(["config", "--local", "--unset", "core.hooksPath"]);
    console.log(`core.hooksPath 已从 ${current || "<unset>"} 恢复为 <unset>（留证为 ${UNSET}）`);
  } else {
    git(["config", "--local", "core.hooksPath", evidence]);
    console.log(`core.hooksPath 已从 ${current || "<unset>"} 恢复为 ${evidence}`);
  }
  process.exit(0);
}

const previous = get("core.hooksPath");
const evidence = get(EVIDENCE_KEY);
// 已在 scripts/gates 上重复安装时不覆盖留证 —— 原值被自己冲掉就再也回不去了
if (previous !== HOOKS_PATH || !evidence) {
  git(["config", "--local", EVIDENCE_KEY, previous || UNSET]);
}
git(["config", "--local", "core.hooksPath", HOOKS_PATH]);
console.log(`core.hooksPath=${HOOKS_PATH}（原值 ${previous || "<unset>"} 已留证）`);
