# 门禁例外登记

唯一登记处。任何门禁要豁免，都写在这里 —— 规则文件里不许另写「本条豁免」。

## 两种形式（互不触发）

| 形式 | 含义 | 效果 |
| --- | --- | --- |
| `gate-<编号或标识>` | **整门 SKIP** | 该门禁整体跳过、exit 0 |
| `except-<编号或标识>: <token>` | **单 token 例外** | 只有这一个路径 token 不被判死引用；该门禁其余判定照常 |

- **整门 SKIP**：行首是 `gate-`（`gate-1`、`gate-dead-refs` …），后面跟非数字字符或行尾。
  判据：`^gate-<编号或标识>([^0-9]|$)`。
- **单 token 例外**：行首是 `except-`，`:` 之后是**精确的 token 字符串**
  （全等匹配，不做 glob、不做前缀匹配）。用来登记「本来就不是仓内文件」的路径引用。
- **`gate-` 不会豁免单个 token；`except-` 也不会让整门跳过** ——
  整门 SKIP 只认 `gate-` 前缀，写 `except-` 不会被当成整门跳过（否则这道门从落地起就静默关闭了）。

## 登记

### check-dead-refs（`skills/rules-layer-governance/templates/check-dead-refs.sh`）

# `.agents/.env` 是本机运行时凭据文件，由使用者创建、不入库 —— 它不是死引用
except-dead-refs: .agents/.env

### 机器路径族的豁免走行内标记（不登记在本文件）

`check-doc-hygiene.sh`（human-docs）与 `validate_skill.py` 的 forbid_windows_paths 共用
**行内豁免标记** `<!-- doc-hygiene:allow -->`：打在命中行行尾，该行整行豁免——
教学示例、「字面量即证据」的行专用。与上面两种形式互不通用：机器路径族的豁免随行走
（行号登记会随编辑漂移，标记不会），死引用族的豁免登记在本文件。
