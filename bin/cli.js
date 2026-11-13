#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const SKILLS_DIR = path.join(__dirname, "..", "skills");
const FEEDBACK_FILE = path.join(__dirname, "..", "FEEDBACK.md");
const FEEDBACK_URL = "https://github.com/monsterbude123/holy-agents-kits/issues/new";
const DEFAULT_TARGET = path.join(os.homedir(), ".agents", "skills");
const SKIP_NAMES = new Set(["node_modules", "__pycache__", ".git"]);

function usage() {
  console.log(`holy-agents-kits —— 安装 Agent Skill

用法:
  holy-agents-kits list
  holy-agents-kits install <skill...> [--dir <path>] [--force]
  holy-agents-kits feedback

参数:
  --dir <path>   安装目录，默认 ~/.agents/skills
  --force        目标已存在时覆盖
  -h, --help     显示本帮助

示例:
  npx holy-agents-kits install jenkins-cli
  npx holy-agents-kits install jenkins-cli jenkins-controller --dir .agents/skills
  npx holy-agents-kits feedback`);
}

function skillNames() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
}

function readDescription(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("description:"));
  if (start < 0) return "";
  const inline = lines[start].slice("description:".length).trim();
  if (inline && !["|", "|-", ">", ">-"].includes(inline)) return inline;
  const parts = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (!/^\s+\S/.test(lines[i])) break;
    parts.push(lines[i].trim());
  }
  return parts.join(" ");
}

function summarize(name) {
  const text = fs.readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return "";
  const desc = readDescription(frontmatter[1]);
  const end = desc.indexOf("。");
  const summary = end > 0 ? desc.slice(0, end) : desc;
  return summary.length > 100 ? summary.slice(0, 100) + "…" : summary;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    if (entry.isFile() && entry.name.endsWith(".pyc")) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function parseArgs(argv) {
  const opts = { command: "", names: [], dir: DEFAULT_TARGET, force: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "-h" || arg === "--help") {
      opts.command = "help";
    } else if (arg === "--force" || arg === "-f") {
      opts.force = true;
    } else if (arg === "--dir" || arg === "-d") {
      const value = rest[++i];
      if (!value) throw new Error("--dir 需要一个路径");
      opts.dir = value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
    } else if (arg.startsWith("-")) {
      throw new Error("未知参数：" + arg);
    } else if (!opts.command) {
      opts.command = arg;
    } else {
      opts.names.push(arg);
    }
  }
  return opts;
}

function cmdList() {
  const names = skillNames();
  if (!names.length) {
    console.error("未找到任何 skill。");
    return 1;
  }
  const width = Math.max(...names.map((n) => n.length)) + 2;
  for (const name of names) {
    console.log(name.padEnd(width) + summarize(name));
  }
  console.log("\n反馈：" + FEEDBACK_URL + "（技能写错、缺步骤、命令跑不通，直接开 issue）");
  return 0;
}

function cmdFeedback() {
  console.log(`反馈入口：
  ${FEEDBACK_URL}

技能写错、缺步骤、命令跑不通，直接开 issue。标题前缀写技能名（如 [git-selective-branch-sync]），
跨技能问题写 [kit]。正文写清：哪份文件、任务原话、实际报错原文、期望结果、环境。
不要贴凭据、token、内网地址或私有代码。完整说明见 FEEDBACK.md。`);
  return 0;
}

function cmdInstall(opts) {
  const available = skillNames();
  if (!opts.names.length) {
    console.error("缺少 skill 名称。可用：" + available.join(", "));
    return 2;
  }
  const unknown = opts.names.filter((n) => !available.includes(n));
  if (unknown.length) {
    console.error("未知 skill：" + unknown.join(", "));
    console.error("可用：" + available.join(", "));
    return 2;
  }

  const target = path.resolve(opts.dir);
  fs.mkdirSync(target, { recursive: true });

  let failed = 0;
  for (const name of opts.names) {
    const dest = path.join(target, name);
    if (fs.existsSync(dest) && !opts.force) {
      console.error("跳过 " + name + "：已存在于 " + dest + "（加 --force 覆盖）");
      failed = 1;
      continue;
    }
    copyDir(path.join(SKILLS_DIR, name), dest);
    console.log("已安装 " + name + " → " + dest);
  }

  // 反馈入口放在安装目录根下，与具体 skill 无关，agent 扫目录时能看到。
  if (fs.existsSync(FEEDBACK_FILE)) {
    const dest = path.join(target, "FEEDBACK.md");
    if (!fs.existsSync(dest) || opts.force) fs.copyFileSync(FEEDBACK_FILE, dest);
    console.log("反馈入口 → " + dest + "（" + FEEDBACK_URL + "）");
  }
  return failed;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    usage();
    return 2;
  }

  if (!opts.command || opts.command === "help") {
    usage();
    return opts.command === "help" ? 0 : 2;
  }
  if (opts.command === "list") return cmdList();
  if (opts.command === "install") return cmdInstall(opts);
  if (opts.command === "feedback") return cmdFeedback();
  console.error("未知命令：" + opts.command);
  usage();
  return 2;
}

process.exitCode = main();
