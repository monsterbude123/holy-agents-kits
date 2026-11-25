#!/usr/bin/env node
// install --force 必须是"镜像"，不是"只增"：源里删掉的文件要从目标机清掉，
// 机器本地状态（config.json / node_modules / .venv）必须保住。
// 这是破坏性逻辑（rmSync），所以留一条断言式自检。

"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CLI = path.join(HERE, "..", "bin", "cli.js");
const SKILL = "vscode-backend"; // 任意带子目录的技能都可；用它避免依赖小技能

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hak-prune-"));
const fail = (msg) => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.error("install prune 自检失败：" + msg);
  process.exit(1);
};

try {
  execFileSync(process.execPath, [CLI, "install", SKILL, "--dir", tmp], { stdio: "pipe" });

  const target = path.join(tmp, SKILL);
  fs.writeFileSync(path.join(target, "STALE.md"), "stale");
  fs.mkdirSync(path.join(target, "stale-dir"), { recursive: true });
  fs.writeFileSync(path.join(target, "stale-dir", "x.txt"), "stale");
  fs.writeFileSync(path.join(target, "config.json"), '{"port":12345}');
  fs.writeFileSync(path.join(target, "node_modules"), "");

  execFileSync(process.execPath, [CLI, "install", SKILL, "--dir", tmp, "--force"], { stdio: "pipe" });

  if (fs.existsSync(path.join(target, "STALE.md"))) fail("源里没有的 STALE.md 没被清掉");
  if (fs.existsSync(path.join(target, "stale-dir"))) fail("源里没有的 stale-dir 没被清掉");
  if (!fs.existsSync(path.join(target, "SKILL.md"))) fail("SKILL.md 丢了");
  if (fs.readFileSync(path.join(target, "config.json"), "utf8") !== '{"port":12345}')
    fail("config.json 被覆盖或删除（机器本地状态必须保住）");
  if (!fs.existsSync(path.join(target, "node_modules"))) fail("node_modules 被删了");

  console.log("install --force 镜像是真的（多余文件清掉 / config.json 与 node_modules 保住）");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
