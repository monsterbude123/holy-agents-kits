#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const HOOKS_PATH = "scripts/gates";
const hook = join(process.cwd(), HOOKS_PATH, "pre-commit");

function git(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

if (process.argv.includes("--check")) {
  const current = git(["config", "--local", "--get", "core.hooksPath"]).stdout.trim();
  const ok = current === HOOKS_PATH && existsSync(hook);
  if (!ok) {
    console.error(`hooksPath=${current || "<unset>"}, hook=${existsSync(hook) ? "present" : "missing"}`);
    process.exit(1);
  }
  console.log(`hooksPath=${HOOKS_PATH}, hook=present`);
  process.exit(0);
}

const previous = git(["config", "--local", "--get", "core.hooksPath"]).stdout.trim();
git(["config", "--local", "hooks.previousHooksPath", previous || "__UNSET__"]);
git(["config", "--local", "core.hooksPath", HOOKS_PATH]);
console.log(`core.hooksPath=${HOOKS_PATH}（原值 ${previous || "<unset>"} 已留证）`);
