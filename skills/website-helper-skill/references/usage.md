# 使用指南

> 一键把本地网页发布到子域名（HTTPS 自动证书）

---

## 1. 一次性配置

### 1.1 安装 publish 工具

```powershell
cd $SKILL_DIR
pip install -e .    # 安装 publish 命令到 PATH
```

### 1.2 创建配置

```powershell
# 模板在技能根目录；目标是仓库根的 .agents/.env（store.py 从这里读）
cp $SKILL_DIR/.env.example <仓库根>/.agents/.env
# 让用户自己编辑 .agents/.env 填入真实值
```

```env
DNS_PROVIDER=aliyun    # cloudflare / aliyun（dnspod 未实现）
ALIYUN_ACCESS_KEY_ID=<你的 AccessKey ID>
ALIYUN_ACCESS_KEY_SECRET=<你的 AccessKey Secret>
ALIYUN_DOMAIN=<你的主域>          # 如 example.com

SSH_HOST=<你的云机器 IP>
SSH_USER=root
SSH_PORT=22
SSH_PASSWORD=<你的 SSH 密码>       # 或 SSH_KEY_PATH
```

> ⚠️ **安全**：`.agents/.env` 必须在 `.gitignore` 中，绝不要提交。

### 1.3 加载配置

```powershell
publish config init
```

成功看到：
```
📄 读取 .env ...
✅ DNS: aliyun 已配置
✅ SSH: root@<IP>
```

---

## 2. 日常使用

### 2.1 发布一个新子域名

```powershell
publish deploy <name> -d <sub>.<domain> -w <本地目录> --ip <云机器IP>
```

**自动执行 4 步**：
1. **DNS** — 在阿里云/Cloudflare/DNSPod 创建 A 记录
2. **Nginx** — 上传文件到 `/var/www/<domain>/`，写站点配置
3. **SSL** — Let's Encrypt 申请证书，自动 80→443 跳转
4. **驾驶舱** — 写入发布历史

**示例**：

```powershell
publish deploy blog -d blog.example.com -w ./dist --ip 1.2.3.4
```

完成后访问 `https://blog.example.com`。

### 2.2 部署 Vite / React / Vue 项目

```powershell
npm run build
publish deploy myapp -d myapp.example.com -w ./dist --ip 1.2.3.4
```

SPA history 路由 fallback 自动生效。

### 2.3 幂等更新

重复运行同样命令即可：

```powershell
publish deploy blog -d blog.example.com -w ./dist --ip 1.2.3.4
```

- DNS 已存在 → 跳过
- Nginx 已存在 → 备份后覆盖
- SSL 已签发 → 跳过

### 2.4 回滚

```powershell
publish rollback blog.example.com
```

每个子域名最多保留 **5 个备份**，超量自动删最旧。

### 2.5 证书管理

```powershell
publish cert status                    # 列表 + 到期日
publish cert renew blog.example.com    # 强制续签
```

certbot systemd timer 每 12h 自动续期 < 30 天的证书。

### 2.6 批量部署

```powershell
1..3 | ForEach-Object {
  publish deploy "site$_" -d "site$_.example.com" -w "dist$_" --ip 1.2.3.4
}
```

### 2.7 反代模式（给已有后端挂域名）

后端已经在跑（docker 服务、`127.0.0.1:8088`、内网服务名）时，不传 `-w`，传 `--upstream`：

```powershell
publish deploy zentao -d zentao.example.com --upstream http://127.0.0.1:8088 --ip 1.2.3.4
```

生成的 nginx 配置带 `proxy_pass`、WebSocket upgrade 头、`client_max_body_size 100M`、300s 读超时。
`-w` 与 `--upstream` 互斥，两个都给或都不给会直接拒绝。目标机不是原生 nginx 时先看
[field-notes.md](field-notes.md) §1（面板环境常不读 sites-enabled）。

---

## 3. 管理命令

| 命令 | 作用 |
|------|------|
| `publish list` | 列出所有已发布子域名 |
| `publish cert status` | 证书状态 + 到期日 |
| `publish cert renew <域名>` | 强制续签某证书 |
| `publish rollback <域名>` | 回滚到上一版 |
| `publish config init` | 从仓库根 .agents/.env 重新加载 |
| `publish config show` | 显示当前配置（密码掩码） |

---

## 4. publish CLI 模块清单

> `SKILL.md` §1 的目录树只留指针，逐个模块的职责以本表为准（改动 publish 子树的代码后同步本表）。

| 模块 | 职责 |
|------|------|
| `cli.py` | 入口 / 路由（typer 命令定义） |
| `cli_helpers.py` | 纯函数（DNS provider 分发） |
| `commands/` | `config` / `cert` / `list` 命令体 |
| `actions/` | 每件事一个 action（dns / nginx / ssl），返回 Step，不抛异常 |
| `pipeline.py` | Step + Pipeline：失败短路、计时、监听 |
| `dns/base.py` | DNS 提供商（Aliyun / Cloudflare；DNSPod 构造即抛 NotImplementedError） |
| `docker/` | compose / probe / install 的 SSH 包装 |
| `ssh/client.py` | SSH 客户端 |
| `nginx/config.py` | server block 生成（静态 root / 反代 proxy_pass） |
| `nginx/deploy.py` | Nginx 部署、备份、回滚 |
| `certs/cert_manager.py` | SSL 证书管理 |
| `cockpit/logger.py` | 发布历史（写 `` CWD/docs/specs/.state-card.md ``） |
| `config/store.py` | 配置存储（从仓库根 .agents/.env 加载，剥成对引号） |
| `utils/validators.py` | 入参校验（子域名 / IPv4 / webroot / upstream / 名称） |

---

## 5. 完整路由（意图 → 文档）

> `SKILL.md` §2 只留最常用的 6 条；本表是全部 11 条意图的路由。

| 意图 | 跳到 |
|------|------|
| 帮我发布 / 上线 / 部署到 xxx.<domain> | 本文件 §2.1 发布一个新子域名 |
| 给已有后端（docker / 端口）挂域名 | 本文件 §2.7 反代模式 |
| 帮我做个页面 / 图站 / UI / 设计并部署 | [design-deploy-workflow.md](design-deploy-workflow.md) |
| 更新一下 / 重新发一下 | 本文件 §2.3 幂等更新 |
| 回滚 / 退回上一版 | 本文件 §2.4 回滚 |
| 证书 / SSL / 续签 | 本文件 §2.5 证书管理 |
| publish 命令不工作 / 报错 | [troubleshooting.md](troubleshooting.md) |
| 我要修改密钥 / 改密码 | [credential-management.md](credential-management.md) |
| 能做什么 / 不支持什么 | [limits.md](limits.md) |
| 装 nginx / 装 certbot | [../scripts/install-server.sh](../scripts/install-server.sh) |
| SSH 连目标机 / 跑远程命令 / 查看远端 docker / 部署目录 | [../scripts/ssh-exec.py](../scripts/ssh-exec.py) |
| 把镜像+compose 推过去 up / 绕开 registry 直推部署 / hermes 罢工部署 | [../scripts/deploy-ssh.py](../scripts/deploy-ssh.py) |
