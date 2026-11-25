---
name: website-helper-skill
description: "把本地网页或已有后端发布到子域名（HTTPS 自动证书）——自带 publish CLI，DNS / Nginx / SSL 一条命令走完，也能给反代后端挂域名。用户说发布、上线、部署子域名、加子域名、更新网站、回滚上一版、申请/续签证书、设计并部署页面、给 docker 服务挂域名、反向代理时用。凭据只从仓库根 .agents/.env 读，绝不回显。"
---

# website-helper-skill — 子域名发布

`publish` CLI 随本技能一起发。装完、填完 `.env`，一件事就是一条命令：

```bash
publish deploy blog -d blog.example.com -w ./dist --ip 1.2.3.4      # 静态目录 → 子域名 + 证书
publish deploy app  -d app.example.com  --upstream http://127.0.0.1:8088  # 已有后端挂域名
publish rollback blog.example.com                                    # 退回上一版
```

`-w` 与 `--upstream` **必须且只能给一个**；首次部署用 `--ip` 指定 A 记录。

**三条岔路**（先看这里，别急着读文档）：

| 现象 | 先查 |
|---|---|
| 证书申请失败 | DNS 还没传播 → `nslookup <子域> 8.8.8.8`，等 5–30 分钟再 `publish cert renew` |
| 域名 404 且 `server: nginx`、`content-length: 138` | 配置没被加载 → 面板机（宝塔等）不读 `sites-enabled`，见 [field-notes.md](references/field-notes.md) §1 |
| 浏览器连不上 | 云厂商安全组没放行 80/443 |

---

## 首次使用（三步）

1. 装 CLI：`cd $SKILL_DIR && pip install -e .`（装完 `publish` 进 PATH）
2. 填配置：`cp $SKILL_DIR/.env.example <仓库根>/.agents/.env`，让用户自己填真值
3. 确认：`publish config init && publish config show`（密钥已掩码，字段齐就行）

`$SKILL_DIR` = 本技能安装目录的绝对路径（如 `~/.agents/skills/website-helper-skill`），执行前替换成真实值。

---

## 红线（做任何一步之前）

1. 绝不复述 `.env` 里 `*_KEY` / `*_SECRET` / `*_PASSWORD` / `*_TOKEN` 的值——回复、日志、截图都不行。
2. 只看字段名与是否存在；用户粘贴了真实 secret，立即提醒轮换。
3. 让用户自己编辑 `.agents/.env`，不要在对话里写或改凭据值。
4. 要展示配置状态就 `publish config show`，**不要 `cat .env`**。

---

## 命令速查

```bash
publish config init | show
publish deploy NAME -d DOMAIN (-w DIR | --upstream URL) [--ip IP] [--no-ssl] [--force]
publish rollback DOMAIN
publish list
publish cert status | publish cert renew [DOMAIN]
```

---

## 一次性的 SSH 编排（agent 临时用，不写进项目 CI）

- `python $SKILL_DIR/scripts/ssh-exec.py "<remote cmd>"` —— 远程跑命令，复用 `.agents/.env` 的 SSH 凭据
  （密钥优先、密码兜底；Windows 无 sshpass 也能用）。
- `python $SKILL_DIR/scripts/deploy-ssh.py --image X --compose Y --remote-dir Z [--env-file E] [--dry-run]`
  —— 绕开镜像仓库：推镜像 + 推 compose/.env → `compose up`，先 `--dry-run` 预演。

参数全部由调用方传入，技能不假设项目内容；**别把这两个脚本拷进某个项目的 `scripts/`**。

---

## 交付前检查

```
[ ] pip install -e $SKILL_DIR 成功，publish --help 有输出
[ ] <仓库根>/.agents/.env 存在、已填、在 .gitignore 里
[ ] publish config show 字段齐且密钥掩码
[ ] 用户给了：子域名 + （本地目录 或 后端 URL）
[ ] 首次部署给了 --ip；DNS_PROVIDER 不是 dnspod（未实现）
[ ] 目标机 nginx include 目录已确认（面板环境尤其）
```

按需深入 → [usage.md](references/usage.md)（含反代、幂等、批量）·
[troubleshooting.md](references/troubleshooting.md) · [credential-management.md](references/credential-management.md) ·
[design-deploy-workflow.md](references/design-deploy-workflow.md)（要顺便设计页面时）·
[limits.md](references/limits.md)（能做什么 / 不能做什么）。

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
