#!/usr/bin/env node
// cli.mjs — CLI 统一入口（零依赖：原生 argv 解析，替代旧 CLI 框架）
//
// 用法：node scripts/cli.mjs <command> [options]
// 所有命令在项目根执行。
//
// 各子命令的 usage / 选项声明 / 执行体都住在自己的 commands/<cmd>.mjs 里，
// 本文件只负责：汇总命令表 → 解析 argv → 分派 → 帮助文本。

import { pathToFileURL } from 'node:url';

import { parseArgs } from './lib/argv.mjs';
import { def as defAdd } from './commands/add.mjs';
import { def as defAddBatch } from './commands/add-batch.mjs';
import { def as defUpdate } from './commands/update.mjs';
import { def as defUpdateAll } from './commands/update-all.mjs';
import { def as defQuery, defAll as defQueryAll } from './commands/query.mjs';
import { def as defSyncManifest } from './commands/sync-manifest.mjs';
import { def as defSyncDocs } from './commands/sync-docs.mjs';
import { def as defVerifyDocs } from './commands/verify-docs.mjs';
import { def as defSyncTo } from './commands/sync-to.mjs';

const VERSION = '0.1.0';

/** 子命令表：usage / summary / 选项声明 / 执行体 */
const COMMANDS = {
  'sync-manifest': defSyncManifest,
  'sync-docs': defSyncDocs,
  update: defUpdate,
  'update-all': defUpdateAll,
  query: defQuery,
  'query-all': defQueryAll,
  add: defAdd,
  'add-batch': defAddBatch,
  'verify-docs': defVerifyDocs,
  'sync-to': defSyncTo,
};

function printHelp() {
  console.log('ghh — github-kownledge-helper 跨平台 CLI');
  console.log('');
  console.log('用法: node scripts/cli.mjs <command> [options]');
  console.log('');
  console.log('命令:');
  for (const cmd of Object.values(COMMANDS)) {
    console.log(`  ${cmd.usage}`);
    console.log(`      ${cmd.summary}`);
  }
  console.log('');
  console.log('全局选项:');
  console.log('  -h, --help     显示本帮助');
  console.log('  -V, --version  显示版本号');
}

function printCommandHelp(cmd) {
  console.log(`用法: node scripts/cli.mjs ${cmd.usage}`);
  console.log('');
  console.log(cmd.summary);
}

/**
 * CLI 主入口。argv 为完整 argv（含 node / 脚本路径）。
 */
export async function main(argv = process.argv) {
  const tokens = argv.slice(2);

  if (tokens.length === 0 || tokens.includes('--help') || tokens.includes('-h')) {
    printHelp();
    return;
  }
  if (tokens.includes('--version') || tokens.includes('-V')) {
    console.log(VERSION);
    return;
  }

  const name = tokens[0];
  const cmd = COMMANDS[name];
  if (!cmd) {
    console.error(`✗ 未知命令：${name}`);
    console.error('  可用命令：' + Object.keys(COMMANDS).join(' / '));
    process.exit(1);
  }

  const rest = tokens.slice(1);
  if (rest.includes('--help') || rest.includes('-h')) {
    printCommandHelp(cmd);
    return;
  }

  let parsed;
  try {
    parsed = parseArgs(rest, {
      booleans: cmd.booleans,
      strings: cmd.strings,
    });
  } catch (e) {
    console.error(`✗ ${e.message}`);
    console.error(`  用法：node scripts/cli.mjs ${cmd.usage}`);
    process.exit(1);
  }

  if (parsed.positionals.length < cmd.positionals) {
    console.error(`✗ 参数不足：需要 ${cmd.positionals} 个位置参数`);
    console.error(`  用法：node scripts/cli.mjs ${cmd.usage}`);
    process.exit(1);
  }

  try {
    await cmd.run(parsed.flags, parsed.positionals, rest);
  } catch (err) {
    // 命令体异常兜底：不裸抛堆栈，按既有 ✗ 风格输出并以非零码退出
    console.error(`✗ ${err?.message || err}`);
    if (err?.code) console.error(`  错误码：${err.code}`);
    process.exit(1);
  }
}

// 直接执行时运行 main；被 import 时仅导出符号。
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main(process.argv);
}
