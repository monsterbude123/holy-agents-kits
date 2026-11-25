# 流水线排障速查

> 什么时候读这份：流水线报错、构建失败、拉码失败、插件装不上、构建上下文不对。
> **控制器容器本身的问题**（起不来 / 匿名可读 / sudo / systemd / nginx 502）→ `jenkins-controller` 技能的 `references/troubleshooting.md`。

## 1 症状对照表

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
| REST API 写操作 403（`No valid crumb`） | 只给 cookie+crumb，缺 basic auth；或 crumb 提取失败 | 见 §4 三坑：cookie jar + `Jenkins-Crumb` 头 **+ `-u user:pass`**，缺一不可 |
| 登录后弹"新手入门"插件引导页 | InstallState 未标记完成 | Script Console：`Jenkins.get().setInstallState(InstallState.INITIAL_SETUP_COMPLETED)`；或重打镜像让 InstallState 从根上跳过 |
| 验证/调试裸 `docker run` 起容器报 sock `permission denied` | 漏了 compose 里的 `group_add` | 裸跑补 `--group-add <gid>`（Docker Desktop 为 0，服务器为 .env 的 `DOCKER_GID`） |
| `exec: java: not found` | Dockerfile 里 `ENV PATH=...` 覆盖基础镜像 PATH，丢掉 `$JAVA_HOME/bin` | `ENV JAVA_HOME=/opt/java/openjdk PATH="/usr/local/bin:/opt/java/openjdk/bin:..."`，构建期断言 `java -version` |

## 2 构建卡住（无报错、超基线）怎么判

卡死与失败不同——**没有报错就没有排障入口，唯一抓手是基线时间对比**。硬规则：

1. **记住每个步骤的历史时长基线**（如本仓库 `npm ci + build` 约 1 分钟）。轮询构建时**远超基线必须主动介入，禁止盲等**。
2. 定位三板斧（在宿主上）：
   - `docker top <container>` → 看卡在哪个进程；
   - `netstat -tn` / `ss -tnp` → 看该进程 ESTABLISHED 连接的对端；
   - **对端零进展 = 上游 registry / 网络挂起，不是代码问题**（实战：与内网 npm registry 建连 ESTABLISHED 后长期无数据）。
3. 反证法：**同代码的上一次构建正常 → 立即排除本次代码改动**，把怀疑对象转向环境。
4. 处理：停掉卡死构建 → 验证上游连通性 → 重跑。别改代码碰运气。

## 3 触发构建的幂等纪律

- **POST `/job/<n>/build` 返回空 / 异常 exit ≠ 未入队**——请求可能已生效。
- 触发后先查 `GET /job/<n>/lastBuild/api/json` 的 `number` 是否已 +1，**再决定要不要重试**。
- 不核对就重试会产生冗余构建；冗余构建与卡死构建混在一起会污染因果证据（实战教训：重复触发产生 #6/#7，#7 恰好卡死，一度误判为代码改动导致）。

## 4 Jenkins REST API 与 Script Console 实战

### 4.1 REST 三坑（缺一不可，且报错文案会带偏排查）

1. **写操作必须带 basic auth**：POST `/scriptText`、`/config.xml` 等**即使带了 cookie + crumb 头，仍需 `-u user:pass`**，否则依旧 403 `No valid crumb`——报错只提 crumb，实际缺的是 basic auth，别在 crumb 上反复折腾。
2. **crumb 用原始 XML 正则提取**：`curl -c jar -b jar -u user:pass http://host/crumbIssuer/api/xml` → 正则 `<crumb>([^<]+)</crumb>`。Jenkins 默认安全策略**禁用 xpath 的 `concat()` 等函数**，按网上文档用 xpath 提取会失败。
3. **PowerShell 走内网 HTTP basic auth**：`Invoke-WebRequest` 必须加 `-AllowUnencryptedAuthentication`；crumb 与 session 必须复用同一个 `WebRequestSession`。

标准动作（curl）：

```
curl -c jar -b jar -u user:pass http://<host>/crumbIssuer/api/xml        # 取 crumb（存 cookie）
CRUMB=$(curl -s -c jar -b jar -u user:pass http://<host>/crumbIssuer/api/xml | grep -oP '(?<=<crumb>)[^<]+')
curl -c jar -b jar -u user:pass -X POST -H "Jenkins-Crumb: $CRUMB" \
     --data-urlencode "script@$f" http://<host>/scriptText
```

### 4.2 Script Console 执行 shell 的可靠模板

```groovy
def p = new ProcessBuilder("bash", "-c", c).redirectErrorStream(true).start()
p.inputStream.withReader { it.eachLine { println it } }
p.waitFor()
```

- **不要** `p.text + p.err.text`：两个流要先于 `waitFor()` 读完，否则抛 `java.io.IOException: Stream closed`。
- Groovy 双引号字符串里的 `$` 必须转义（`\$`）或改单引号，否则被当作 Groovy 插值，命令语义被静默改写。
