# 校验项与修法

`scripts/validate_skill.py` 是唯一的判定实现（规则在 `scripts/skill_schema.py`）。
校验报错时查这张表。

```bash
python .agents/skills/skill-creator-v2/scripts/validate_skill.py --all --root .
python .agents/skills/skill-creator-v2/scripts/validate_skill.py skills/<name> --json
```

退出码：`0` 全部通过；`1` 存在 error；`2` 用法错误。

---

## 1 error（必须修）

| code | 含义 | 修法 |
|---|---|---|
| `frontmatter` | 缺少 YAML frontmatter，或 YAML 解析失败 | 文件以 `---` 开头，`---` 结尾；块内保持合法 YAML |
| `frontmatter.keys` | 出现未定义的顶层键 | 只允许 `name` / `description` / `license` / `allowed-tools` / `metadata` / `compatibility`；其他挪进 `metadata` |
| `frontmatter.missing` | 缺 `name` 或 `description` | 补上，两者都是必需 |
| `name.empty` | `name` 为空 | 填技能名 |
| `name.format` | 不是 kebab-case | 只允许小写字母、数字、**单个**连字符 |
| `name.length` | 超过 64 字符 | 换短名字 |
| `name.mismatch` | `name` 与目录名不一致 | **改目录名去对齐 `name`**（改名会破坏已安装路径，优先改 `name`） |
| `description.empty` | `description` 为空 | 补描述 |
| `description.length` | 超过 1024 字符 | 压缩；把细节挪到正文，description 只留触发信息 |
| `description.brackets` | 含 `<` `>` | 换成中文书名号或去掉 |
| `body.length` | 正文超过 150 行 | 跑 `split_skill.py` 自动抽到 `references/`；或手工把非核心章节搬走 |
| `reference.missing` | 正文引用了不存在的 `references/x.md` | 补文件，或删掉这句引用 |
| `script.missing` | 正文引用了不存在的 `scripts/x.py` / `x.mjs` | 补文件，或改引用路径 |
| `body.code` | 正文内嵌了实现型代码块 | 把代码搬进 `scripts/`，正文只留 `python scripts/x.py` 这种调用方式 |
| `env.committed` | 技能目录存在真实 `.env`（可能含密钥） | `git rm --cached <skill>/.env`，仓库 .gitignore 已覆盖；入库的只应是 `.env.example`（运行时协议 §5.2） |

**`body.code` 怎么区分**：只有调用脚本的命令块是允许的；
块里出现 `def` / `class` / `import` / `from` / `function` / `=>` 这类实现特征才判错。

---

## 2 warn（逐条确认）

| code | 含义 | 修法 |
|---|---|---|
| `description.short` | 描述偏短（< 40 字符） | 补「什么时候用」与触发词 |
| `reference.orphan` | `references/` 里的文件没被正文引用 | 在正文加一条指针；确实没用就删掉 |
| `reference.length` | 单个 reference 超过 300 行 | 按主题继续拆 |
| `script.orphan` | `scripts/` 里的脚本没被正文引用 | 在正文写清怎么调；否则它永远不会被执行 |
| `env.example-missing` | 正文提到密钥型环境变量但缺 `.env.example` | 参照 scaffold 生成的模板补一份：声明变量名 + 取值说明 |

> `references/INDEX.md`、`references/README.md`、`scripts/__init__.py` 免检——它们是索引与包标记。

---

## 3 脚本查不了、必须人看的东西

自动校验只管**形式**。下面这些是内容质量，只能靠人（或模型）判断：

| 检查项 | 怎么看 |
|---|---|
| description 能不能真的触发 | 写 10 条用户可能说的话，判断会不会加载这个技能；不该触发的也要测 |
| references 内容是否过期 | 改了正文逻辑，回头看引用的 reference 是否还对得上 |
| scripts 是不是真的能跑 | 逐个执行 `--help`；跑不动的脚本等于没有 |
| 步骤顺序是不是必要 | 骨架流程里有没有可以并行或省略的步骤 |
| 退出条件是否明确 | 核心循环写没写清「什么时候算完成」 |
| 有没有把不该写的写进技能 | 密钥、内网地址、个人信息 |
| 脚本有没有安全自检 | 无 `eval`、无拼接 shell、无下载执行；错误信息不回显密钥全文（模板只回显前 4 位是基准） |
| lint 过没过 | Python 跑 `ruff check scripts/`；Node 有配置才跑 `eslint`。lint 只兜低级错，代替不了人看 |

---

## 4 交付前最后一遍

```bash
python .agents/skills/skill-creator-v2/scripts/validate_skill.py --all --root .
```

- error = 0
- warn 逐条确认过
- 正文 ≤ 150 行
- 占位与 TODO 全部消化
- 每个 `references/`、`scripts/` 文件都被正文引用过
