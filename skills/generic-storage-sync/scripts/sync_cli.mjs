#!/usr/bin/env node
// sync_cli.mjs — generic-storage-sync 统一 CLI 入口（零依赖：原生 argv 解析）
//
// 用法：node scripts/sync_cli.mjs <command> [options]
// 所有命令在项目根执行；配置一律走 .agents/.env，禁止硬编码本机绝对路径。
//
// 清理类命令（prune / clean-trash）默认 dry-run：只打印拟删清单 + 所属仓库 + 可释放字节数，
// 不删任何东西；带 --yes 才真执行（物理删除只发生在 lifecycle.purgeExpired）。

import { pathToFileURL } from 'node:url';

import { defTarget } from './lib/cli_targets.mjs';
import { defDiff, defPack, defPull, defPush, defStatus } from './lib/cli_sync.mjs';
import { defCleanStaging, defCleanTrash, defPrune } from './lib/cli_lifecycle.mjs';

const VERSION = '1.0.0';

/**
 * 原生 argv 解析：--flag（布尔）/ --opt value（取值）/ 位置参数；-- 之后全部视为位置参数。
 * 未知选项直接报错（与仓库既有 CLI 风格一致）。
 * @param {string[]} tokens 参数片段（不含 node / 脚本路径）
 * @param {{booleans?: string[], strings?: string[]}} spec 选项声明
 * @returns {{flags: Record<string, string|boolean>, positionals: string[]}}
 */
export function parseArgs(tokens, spec = {}) {
  const booleans = new Set(spec.booleans ?? []);
  const strings = new Set(spec.strings ?? []);
  const flags = {};
  const positionals = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--') {
      positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (t.startsWith('--')) {
      if (booleans.has(t)) {
        flags[t.slice(2)] = true;
        continue;
      }
      if (strings.has(t)) {
        const v = tokens[i + 1];
        if (v === undefined) throw new Error(`选项 ${t} 缺少取值`);
        flags[t.slice(2)] = v;
        i++;
        continue;
      }
      throw new Error(`未知选项：${t}`);
    }
    positionals.push(t);
  }
  return { flags, positionals };
}

/** 子命令表：usage / summary / 选项声明 / 执行体 */
const COMMANDS = {
  target: defTarget,
  status: defStatus,
  diff: defDiff,
  pack: defPack,
  push: defPush,
  pull: defPull,
  prune: defPrune,
  'clean-trash': defCleanTrash,
  'clean-staging': defCleanStaging,
};

function printHelp() {
  console.log('gss — generic-storage-sync 通用异构存储同步 CLI');
  console.log('');
  console.log('用法: node scripts/sync_cli.mjs <command> [options]');
  console.log('');
  console.log('命令:');
  for (const cmd of Object.values(COMMANDS)) {
    console.log(`  ${cmd.usage}`);
    console.log(`      ${cmd.summary}`);
    if (cmd.subcommands) {
      for (const sub of Object.values(cmd.subcommands)) console.log(`      · ${sub.usage} — ${sub.summary}`);
    }
  }
  console.log('');
  console.log('全局选项:');
  console.log('  -h, --help     显示本帮助');
  console.log('  -V, --version  显示版本号');
  console.log('');
  console.log('配置: 介质与路径统一走 .agents/.env（STORAGE_TARGET_<ID> / STORAGE_BUFFER_SPACE 等）。');
}

/** CLI 主入口。argv 为完整 argv（含 node / 脚本路径）。返回进程退出码。 */
export async function main(argv = process.argv) {
  const tokens = argv.slice(2);

  if (tokens.length === 0 || tokens[0] === '--help' || tokens[0] === '-h') {
    printHelp();
    return 0;
  }
  if (tokens[0] === '--version' || tokens[0] === '-V') {
    console.log(VERSION);
    return 0;
  }

  const entry = COMMANDS[tokens[0]];
  if (!entry) {
    console.error(`✗ 未知命令：${tokens[0]}`);
    console.error('  可用命令：' + Object.keys(COMMANDS).join(' / '));
    return 1;
  }

  let cmd = entry;
  let rest = tokens.slice(1);
  if (entry.subcommands) {
    const sub = entry.subcommands[rest[0]];
    if (!sub) {
      console.error(`✗ 未知子命令：${tokens[0]} ${rest[0] || ''}`.trimEnd());
      console.error('  可用子命令：' + Object.keys(entry.subcommands).join(' / '));
      return 1;
    }
    cmd = sub;
    rest = rest.slice(1);
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(`用法: node scripts/sync_cli.mjs ${cmd.usage}`);
    console.log('');
    console.log(cmd.summary);
    return 0;
  }

  let parsed;
  try {
    parsed = parseArgs(rest, { booleans: cmd.booleans, strings: cmd.strings });
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error(`  用法：node scripts/sync_cli.mjs ${cmd.usage}`);
    return 1;
  }

  if (parsed.positionals.length < cmd.positionals) {
    console.error(`✗ 参数不足：需要 ${cmd.positionals} 个位置参数`);
    console.error(`  用法：node scripts/sync_cli.mjs ${cmd.usage}`);
    return 1;
  }

  try {
    await cmd.run(parsed.flags, parsed.positionals, rest);
  } catch (err) {
    console.error(`✗ ${err?.message || err}`);
    if (err?.code) console.error(`  错误码：${err.code}`);
    return 1;
  }
  return 0;
}

// 直接执行时运行 main；被 import 时仅导出符号。
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const code = await main(process.argv);
  if (code) process.exitCode = code; // 命令体自行设置的 exitCode（如探活失败）不被 0 覆盖
}
