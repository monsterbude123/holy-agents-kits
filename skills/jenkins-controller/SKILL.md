---
name: jenkins-controller
description: 容器化 Jenkins 控制器的部署、迁移、切换与体检。Invoke when 用户要部署/重建 Jenkins 控制器容器、把宿主机 systemd Jenkins 迁到容器、切 nginx upstream、轮换管理员口令、跑控制器全量体检，或排查控制器容器起不来、匿名可读、sudo/systemd 不可达、init.groovy.d 没生效、nginx 502。日常写流水线/改 Jenkinsfile 用 jenkins-cli 技能。触发词：Jenkins 容器、cutover、迁移 JENKINS_HOME、nginx upstream、匿名可读、sudo 免密、systemd、init.groovy.d。
---

# jenkins-controller：控制器容器的生命周期

只管**控制器本身**（跑 Jenkins 的容器/进程）：部署、迁移、切上游、安全收敛、体检。
写流水线、改 Jenkinsfile、配凭据 → `jenkins-cli` 技能，不要在这里找。

部署包**不入仓**（内容 = compose、Dockerfile、init.groovy.d、sudoers drop-in）；定位走
`scripts/lib/pkg.sh` 的 `resolve_pkg_dir()`：`PKG_DIR` 环境变量 → 仓库内相对路径（仅当包真的在仓里）→
服务器兜底 `/opt/deploy-services/test-190/jenkins`。
服务器上脚本与包同根：`/opt/deploy-services/{.agents/skills/jenkins-controller,test-190/jenkins}`。

## §1 骨架流程

五个阶段由 `cutover.sh` 编排，每阶段幂等、可单独重跑。

| 阶段 | 做什么 | 成功判据 |
|---|---|---|
| prepare | 预检包与宿主路径；生成 `.env`（口令本地随机）；对齐 TZ 与 DOCKER_GID | `.env` 字段齐备且值取自宿主 |
| migrate | 停旧 systemd 服务；旧 JENKINS_HOME 迁进命名卷；chown 到容器 uid/gid | 卷内属主 = 容器 jenkins uid/gid；users/jobs/credentials.xml 齐 |
| deploy | 构建镜像（锁小版本）→ 起容器 → 等 healthy → 鉴权校验 | 容器 healthy；匿名 403 / 登录页 200 / 管理员 200 |
| switch | 改 nginx upstream → `nginx -t` → reload | vhost 里 `proxy_pass http://127.0.0.1:28080`；三码 403/200/403 |
| finalize | 停用旧 systemd 服务，数据保留可回滚 | `is-active=inactive`、`is-enabled=disabled`；旧数据仍在 |

宿主**故意留空旧端口 8080** 给回滚用：只切上游，不改端口。

## §2 核心逻辑

### 2.1 不变量（改任意一项都要按判据重验）

| 不变量 | 判据 | 改砸了的症状 |
|---|---|---|
| 容器内 jenkins uid/gid 与宿主一致 | `docker exec <c> id jenkins` → uid=110 gid=114 | 落文件属主错、`sudo -u www` 写不进去 |
| sudo 免密无 tty | `docker exec <c> sudo -n -l`，Defaults 含 `!use_pty` | `sorry, you must have a tty` |
| 宿主 systemd 可达 | `docker exec <c> sudo -n /bin/systemctl status <svc>` | `Failed to connect to system scope bus…` |
| 匿名读被拒、登录页可达 | 匿名 `/` 与 `/api/json` 非 200、`/login` 200 | 匿名能看项目列表 |
| 每次启动跑最新收敛脚本 | compose 固定 `PRE_CLEAR_INIT_GROOVY_D: "1"` | 改了 groovy 行为没变 |
| 时区与宿主一致 | 挂 `/etc/localtime` + 设 `TZ` | 日志时间差 8 小时 |
| 上游指向容器端口 | vhost 里 `proxy_pass http://127.0.0.1:28080` | 502 |

### 2.2 硬约束

- 口令只进 `.env`（600）；脚本输出只有字段名与掩码，临时 netrc 用完即删。
- 唯一权威源是 `.agents/.env`（本地）与包内 `.env`（服务器），不新建第二份真值。
- 写操作前先备份数据与配置，并把回滚命令打印出来。
- 验证优先于声明：对外行为用真实 HTTP 状态码断言，别拿「应该没问题」交差。

## §3 核心循环

```
verify-controller.sh → 失败项落到具体分区 → 按 troubleshooting 修 → 复跑
                    └→ 动过不变量 → 回 §2.1 逐条重验
```

**退出条件**：`FAIL=0` 且退出码 0；破坏性操作前已备份、回滚命令已打印。
连续两轮没实质进展就停下，把选择权交回用户。

## §4 脚本

全部在 `scripts/`，都能 `--help`，破坏性脚本都支持 `--dry-run`。

| 脚本 | 作用 | 关键开关 |
|---|---|---|
| `cutover.sh` | 分阶段编排 prepare/migrate/deploy/switch/finalize | `--dry-run` `--force` |
| `verify-controller.sh` | 10 项只读体检，一次跑完全部断言 | `--container` `--base-url` `--package-dir` |
| `deploy.sh` | 构建镜像 + 起容器 + 等健康 + 校验 | `--dry-run` `--verify-only` `--auth-check` |
| `migrate-from-host.sh` | 旧 JENKINS_HOME 迁进命名卷 + chown + 同步收敛脚本 | `--dry-run` `--force` |
| `switch-nginx-upstream.sh` | 切/回 nginx upstream（含 nginx pid 过期兜底） | `--dry-run` `--rollback` |
| `gen-admin-secret.sh` | 在服务器本地生成/轮换管理员口令（不回显） | `--force` `--dry-run` |
| `lib/pkg.sh` | 定位部署包目录（先看 `PKG_DIR`，再仓库内路径，最后 `/opt/deploy-services`） | — |
| `win/remote-batch.ps1` | 一次 SSH 跑完多段只读检查，清单在 `win/checks/` | `-ChecksFile` |
| `win/push-file.ps1` / `win/push-pkg.ps1` | 上传单文件 / 整包（分块，避命令行长度上限） | `-LocalFile` / `-LocalDir` |
| `win/run-remote.ps1` / `win/run-phases.ps1` | 送脚本到远端执行 / 顺序跑 cutover 阶段 | `-ScriptPath` `-Phases` |

高频三条：全量体检 `bash scripts/verify-controller.sh`；快速一眼
`pwsh -File scripts/win/remote-batch.ps1 -ChecksFile scripts/win/checks/quick.txt`；
现状全貌把清单换成 `checks/host-baseline.txt`（一次 SSH 往返跑完 14 段）。

## §5 参考文件

| 文件 | 什么时候读 |
|---|---|
| `references/controller-container.md` | 部署/迁移的完整做法：uid/gid 对齐、sudoers、systemd 与 pid:host、init.groovy.d 收敛、迁卷、切上游 |
| `references/troubleshooting.md` | 按症状查控制器故障（sudo/systemd/匿名可读/nginx 502/脚本没生效） |

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
