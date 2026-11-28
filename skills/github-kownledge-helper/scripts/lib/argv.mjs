// argv.mjs — 原生 argv 解析（零依赖，替代旧 CLI 框架）
//
// 能力：
//   - `--flag`（布尔）与 `--opt value`（取值）两类选项
//   - 位置参数按顺序收集
//   - 未知选项直接报错（与旧 CLI 框架的严格性一致）
//   - `--` 之后全部视为位置参数
//
// 约定：布尔选项以 `--no-xxx` 形式给出时，键名去掉 `no-` 前缀。

/**
 * @typedef {Object} ArgSpec
 * @property {string[]} [booleans] 布尔选项（无值）
 * @property {string[]} [strings] 取值选项（需一个值）
 */

/**
 * @param {string[]} tokens 参数片段（不含 node / 脚本路径）
 * @param {ArgSpec} spec 选项声明
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
        // `--no-x` → x=false（与旧 CLI 框架语义一致）；`--x` → x=true
        if (t.startsWith('--no-')) flags[t.slice(5)] = false;
        else flags[t.slice(2)] = true;
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
