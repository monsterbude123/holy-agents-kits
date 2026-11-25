---
name: website-helper-skill
description: "把本地网页或已有后端发布到子域名（HTTPS 自动证书）——自带 publish CLI，DNS / Nginx / SSL 一条命令走完，也能给反代后端挂域名。用户说发布、上线、部署子域名、加子域名、更新网站、回滚上一版、申请/续签证书、设计并部署页面、给 docker 服务挂域名、反向代理时用。凭据只从仓库根 .agents/.env 读，绝不回显。"
---

# website-helper-skill — 子域名发布

> 自闭环：CLI、配置模板、装机脚本全在本技能目录内；不假设任何外部路径。
> 本文里的 `$SKILL_DIR` = 本技能安装目录的绝对路径（如 `~/.agents/skills/website-helper-skill`），执行前替换成真实值。

---

## 0 守则（不可破）

1. 绝不复述 `.env` 里 `*_KEY` / `*_SECRET` / `*_PASSWORD` / `*_TOKEN` 的值（回复、日志、截图都不行）。
2. 只看字段名与是否存在；用户若粘贴了真实 secret，立即提醒轮换。
3. 引导用户自己编辑 `.agents/.env`，不要在对话里写或改凭据值。
4. 要展示配置状态就 `publish config show`（密钥字段已掩码），不要 `cat .env`。
5. 部署前先确认目标机 nginx 的 include 目录（见 references/field-notes.md §1），面板类环境常不读 sites-enabled。

---

## 1 目录结构

```
$SKILL_DIR/
├── SKILL.md                     # 本文件 — 入口 + 路由
├── .env.example                 # 全部变量 + 取值来源（入库，无真值）
├── pyproject.toml               # pip install -e . → publish 命令进 PATH
├── publish/                     # CLI 实现（模块职责见 references/usage.md）
├── scripts/                     # install-server.sh / init-publish.sh / ssh-exec.py / deploy-ssh.py
├── references/                  # usage / troubleshooting / credential-management / design-deploy-workflow / limits / field-notes
└── tests/                       # pytest：pipeline、docker、反代、.env 解析
```

---

## 2 路由（按意图跳）

| 用户说 | 去读 |
|--------|------|
| 发布 / 上线 / 部署到 `x.<domain>` | [references/usage.md](references/usage.md) §2 |
| 给已有后端（docker、`:8088` 之类）挂域名 | [references/usage.md](references/usage.md) §2.2 反代 + [field-notes.md](references/field-notes.md) §3 |
| 做个页面 / 图站 / 设计并部署 | [references/design-deploy-workflow.md](references/design-deploy-workflow.md) |
| 更新 / 重新发 / 回滚 | [references/usage.md](references/usage.md) §2.3 / §2.4 |
| 证书 / SSL / 续签 | [references/usage.md](references/usage.md) §2.5 |
| 报错、404、连不上 | [references/troubleshooting.md](references/troubleshooting.md) → 仍不行看 [field-notes.md](references/field-notes.md) |
| 凭据怎么写、怎么轮换 | [references/credential-management.md](references/credential-management.md) |
| 能做什么 / 不能做什么 | [references/limits.md](references/limits.md) |

---

## 3 开机三步

1. **装 CLI**：`cd $SKILL_DIR && pip install -e .`（装完 `publish` 进 PATH；也可 `uv pip install -e .`）。
2. **填配置**：`cp $SKILL_DIR/.env.example <仓库根>/.agents/.env`，让用户自己填真值。
3. **加载**：`publish config init`（读 `<仓库根>/.agents/.env`），再 `publish config show` 确认字段齐、值已掩码。

---

## 4 命令速查

```bash
publish config init                          # 从 .agents/.env 载入
publish config show                          # 看配置（密钥掩码）
publish deploy NAME -d DOMAIN -w DIR         # 静态：上传目录 + 建站
publish deploy NAME -d DOMAIN --upstream URL # 反代：给已有后端挂域名
publish rollback DOMAIN                      # 回滚上一版
publish list                                 # 已发布清单
publish cert status | publish cert renew [DOMAIN]
```

`-w/--webroot` 与 `--upstream` **必须且只能给一个**；首次 deploy 用 `--ip` 指定 A 记录指向。

---

## 5 一次性的 SSH 编排（agent 临时用，不属于任何项目的 CI）

- `python $SKILL_DIR/scripts/ssh-exec.py "<remote cmd>"` — 远程执行多条命令，复用 `.agents/.env` 的 SSH 凭据（密钥优先，密码兜底；Windows 无 sshpass 也能跑）。
- `python $SKILL_DIR/scripts/deploy-ssh.py --image X --compose Y --remote-dir Z [--env-file E] [--dry-run]` — 绕开镜像仓库：推镜像 + 推 compose/.env → `compose up`。先 `--dry-run` 预演。
- 参数全部由调用方传入，技能不假设项目内容；不要把这两个脚本拷进某个项目的 `scripts/`。

---

## 6 交付前检查

```
[ ] pip install -e $SKILL_DIR 成功，publish --help 有输出
[ ] <仓库根>/.agents/.env 存在、已填、在 .gitignore 里
[ ] publish config show 字段齐且密钥掩码
[ ] 用户给了：子域名 + （本地目录 或 后端 URL）
[ ] 首次部署给了 --ip；DNS_PROVIDER 不是 dnspod（未实现）
[ ] 目标机 nginx include 目录已确认（面板环境尤其）
```

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
