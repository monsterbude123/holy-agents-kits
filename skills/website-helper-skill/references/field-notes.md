# 实战踩坑笔记（部署前先读这张）

> 来源：2026-08-20 一次真实首次部署（阿里云 + 宝塔 nginx + 反向代理）。只留可复用的坑，
> 项目专属内容不入库。排查具体报错时配合 [troubleshooting.md](troubleshooting.md) 读。

## 1 代理后端之前：先确认 nginx 的 include 目录

把 `sites-available` 写到 `/etc/nginx/` 是**原生 nginx 习惯**，很多面板不读它。现象：域名 404，
响应头 `server: nginx` + `content-length: 138`（默认 server 的占位页），而后端直连正常。

```bash
nginx -T 2>&1 | grep -E 'server_name\s+<子域名>'   # 没结果 = 配置没被加载
```

| 环境 | 实际 include 路径 |
|------|------------------|
| 原生 nginx（Debian/Ubuntu） | `/etc/nginx/sites-enabled/` |
| 宝塔 | `/www/server/panel/vhost/nginx/*.conf` |
| cPanel nginx | `/etc/nginx/conf.d/` |
| DirectAdmin | `/usr/local/directadmin/data/users/<user>/nginx.conf` |
| OpenLiteSpeed | `/usr/local/lsws/conf/vhosts/<vhost>/vhost.conf` |

部署前先 `nginx -T | head -40` 看 include 行，别默认 sites-enabled。

## 2 `.env` 的三个坑

**引号**：PowerShell 的 `Out-File` 会给值加双引号，paramiko 把带引号的路径当文件名打开
→ `OSError [Errno 22]`。`store._parse_env_file` 已剥成对外层引号（只剥成对的，不匹配的原样保留）。

**字段优先级**：`load_ssh_config` 是 `key_path > password`——只要 `SSH_KEY_PATH` 非空就走密钥，
不会 fallback 到密码。想临时改用密码，要把 `SSH_KEY_PATH=` **整行注释掉**（清空成 `""` 仍非 None）。

**跨项目污染**：仓库根的 `.agents/.env` 是多个工具共用的，字段前缀可能混。只看 key 不看值：

```bash
grep -E '^[A-Z]' .agents/.env | cut -d= -f1
```

## 3 反代部署别走 `deploy` 的一体化流程？

现在可以走：`publish deploy NAME -d DOMAIN --upstream http://127.0.0.1:8088`。历史教训是——
当目标机不是原生 nginx（见 §1）时，`deploy` 写的配置不会被加载，此时应拆成三步手工做：
DNS 记录 → 按正确 include 目录写 `proxy_pass` 配置 → `publish cert renew`。

## 4 凭据三条（不可破）

1. 绝不打 `.env` 字段值，即使只为诊断。
2. 绝不把 SSH 密码回显到对话。
3. 绝不"自动续用"上一轮密码，即使同一项目。

用户一旦把 secret 贴进对话：视为已泄露 → 让其在控制台 disable/reset → 自己改 `.env`（不要贴回聊天）→
必要时清理 git 历史。

## 5 首次部署的顺序

`install-server.sh` 装机 → `.agents/.env` 填值 → `publish config init` → `publish deploy`（A 记录）→
等 DNS 传播（`nslookup <sub>.<domain> 8.8.8.8`）→ `publish cert renew <sub>.<domain>`。
证书申请失败九成是 DNS 还没传播，不是配置错。
