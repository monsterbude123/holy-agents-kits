# 流水线排障速查

> 什么时候读这份：流水线报错、构建失败、拉码失败、插件装不上、构建上下文不对。
> **控制器容器本身的问题**（起不来 / 匿名可读 / sudo / systemd / nginx 502）→ `jenkins-controller` 技能的 `references/troubleshooting.md`。

| 症状 | 根因 | 处理 |
|---|---|---|
| `permission denied` on `/var/run/docker.sock` | DOCKER_GID 与宿主不符 | `stat -c '%g' /var/run/docker.sock` → 改 .env → `up -d --force-recreate` |
| `could not read Username for 'http://...'` | 私有仓库且无凭据 | 配 Credentials 并在 checkout 引用 credentialsId |
| `COPY failed: file not found` | 构建上下文选错 / .dockerignore 误排 | `-f` 显式指定 Dockerfile，上下文给项目根 |
| `docker run -v` 挂出来是空目录 | bind 路径是宿主路径，容器内路径宿主不存在 | 用宿主真实路径，或改 named volume |
| 构建 / 日志时间差 8 小时 | 容器时区 | 挂 `/etc/localtime:ro` + `TZ`（AGENTS.md §3.2） |
| 插件装不上 / 向导卡住 | Update Center 不可达（离线） | 预装进镜像或用内网插件镜像源 |
| pipeline 卡死不结束 | 无 timeout / input 占节点 | 补 `options { timeout(...) }`，`input` 移出 steps |
| 401 / 404 / 403（拉码 / webhook） | 见 `references/dood-and-gitlab.md` §2 | 对照处理 |
| node 容器构建报 workspace 无权限 | 构建容器用户与 workspace 属主（uid 1000）不符 | 构建容器用 uid 1000 用户，或 `docker run --user 1000:1000` |
| 拉码 503 且带 `Proxy-Connection` 头 | 内网 ACL 不认容器 NAT 网段 | 走宿主 TCP 转发器；服务器内网直连无此问题 |
| REST API 写操作 403 | crumb 缺失 / 无 session | crumb 请求带 cookie jar（`-c/-b`）再带 `Jenkins-Crumb` 头 |
| 登录后弹"新手入门"插件引导页 | InstallState 未标记完成 | Script Console：`Jenkins.get().setInstallState(InstallState.INITIAL_SETUP_COMPLETED)` |
| `exec: java: not found` | Dockerfile 里 `ENV PATH=...` 覆盖基础镜像 PATH，丢掉 `$JAVA_HOME/bin` | `ENV JAVA_HOME=/opt/java/openjdk PATH="/usr/local/bin:/opt/java/openjdk/bin:..."`，构建期断言 `java -version` |
