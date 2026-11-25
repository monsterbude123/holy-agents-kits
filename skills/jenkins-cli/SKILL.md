---
name: jenkins-cli
description: Jenkins 流水线编写与日常运维：写/生成/校验 Jenkinsfile、选型（Declarative / Scripted / Shared Library）、DooD 挂 docker.sock 构建部署、GitLab 凭据与 webhook、lint 规则分级、pipeline 报错排障。Invoke when 用户要写或改 Jenkinsfile、生成 CI 流水线、scaffold shared library、让 Jenkins 拉代码构建镜像部署容器、配 GitLab webhook/凭据，或排查 pipeline 报错。部署/迁移/切换控制器容器本身用 jenkins-controller 技能。触发词：Jenkinsfile、CI 流水线、DooD、docker.sock、GitLab webhook、shared library、Jenkinsfile lint。
---

# jenkins-cli：流水线怎么写

本仓库的 Jenkins 跑在 Docker 容器里，经宿主 `docker.sock` 操作宿主 daemon（DooD）；代码源 GitLab，
产物是应用镜像与应用容器。

**边界**：本技能只管「流水线怎么写 + 流水线侧排障」。
控制器本身（部署/迁移/切上游/体检/鉴权收敛）→ **`jenkins-controller`** 技能。
不管 K8s / 云厂商托管 Jenkins、插件开发、制品仓库选型——碰到直接说明不在范围内。

## 0 快路径（先查这张表）

| 诉求 | 直接做 | 判据 |
|---|---|---|
| "写条流水线 / 改 Jenkinsfile" | `references/pipeline-authoring.md` 选模板 → 改 | lint error=0 |
| "校验 Jenkinsfile" | `python scripts/validate_jenkinsfile.py <Jenkinsfile>` | 退出码 0，且输出 `error=0` |
| "抽一套共享库" | `python scripts/generate_shared_library.py` | 生成目录 + 骨架文件 |
| "拉码 401/404/403、webhook 不触发" | `references/dood-and-gitlab.md` §2 | — |
| "容器里 docker.sock 权限 / workspace 权限" | `references/dood-and-gitlab.md` §1 | — |
| "这条 lint 警告该不该修" | `references/lint-rules.md` §2 | — |
| "pipeline 卡住 / 插件装不上 / 时间差 8 小时" | `references/troubleshooting.md` §1 | — |
| "构建卡住但没报错 / 触发后不知有没有入队" | `references/troubleshooting.md` §2、§3 | 介入判据 = 超基线 |
| "REST 操作 Jenkins 报 403 / 跑 Script Console" | `references/troubleshooting.md` §4 | — |
| "部署完还是旧版本 / Deploy 段怎么写" | `references/pipeline-authoring.md` §2 要点 | 部署后冒烟通过 |
| "控制器容器起不来 / 匿名可读 / nginx 502" | **换 `jenkins-controller` 技能** | — |

## 1 骨架流程

五步，每步有产出与判据；卡在哪步就回看对应 reference。

| 步 | 做什么 | 产出 | 判据 / 去哪 |
|---|---|---|---|
| 1 选型 | Declarative / Scripted / Shared Library | 一句话决定 | 只有多仓库复用才抽库 → `references/pipeline-authoring.md` |
| 2 写 | 按模板生成 Jenkinsfile | Jenkinsfile | 同上（模板 + 语法速查） |
| 3 校验 | 跑 lint，按分级修 | error=0 的报告 | `scripts/validate_jenkinsfile.py`；规则表见 `references/lint-rules.md` |
| 4 部署 | DooD 建镜像起容器 | 镜像 + 容器 | DooD 铁律见 `references/dood-and-gitlab.md` |
| 5 排障 | 症状对照表定位 | 根因 + 修法 | `references/troubleshooting.md` §1 |

## 2 核心逻辑

### 2.1 选型

拿不准就 Declarative；需要运行期生成 stage 才换 Scripted；同一套流程要在多仓库复用才抽 Shared Library。

### 2.2 凭据与密钥（硬约束）

- 凭据只走 `credentials()` / `withCredentials`；Jenkinsfile、脚本、日志里不出现明文。
- `sh` 块用**单引号**让 shell 展开变量；Groovy 双引号插值会把密钥写进进程列表和构建日志。
- 控制器脚本只打印**字段名**与**掩码**；结尾摘要形如 `user=admin anonymousReadDenied=true passwordPropertyPresent=true`。
- 真值只存权威源（本仓库：仓库根 `.agents/.env` 与服务器上的包内 `.env`），不落代码、不落对话。

### 2.3 DooD 四条铁律

1. 授权靠 `group_add` + 宿主 docker 组 gid（`.env` 的 `DOCKER_GID`），**禁止 chmod 666 docker.sock**。
2. `docker run -v` 里的路径是**宿主**路径；别把容器内的 workspace 路径当宿主路径挂。
3. 产物归宿主 daemon → `post` 里 prune，临时容器 `docker rm -f`。
4. 构建容器用户要与 workspace 属主（uid 1000）一致，否则 node 构建报 EACCES：
   用 `--user 1000:1000` 或镜像里建同名用户。

### 2.4 控制器侧的硬约束（只列不改）

控制器 uid/gid、sudo 免密、宿主 systemd 可达、鉴权收敛——四件必须同时打通，
做法与体检在 `jenkins-controller` 技能里，本技能只在流水线里依赖它们的**结果**
（例如流水线里 `sudo -u www` 落文件属主对不对）。

## 3 核心循环

出稿 → lint → 修 ERROR（必须）→ 修 WARNING（应当）→ 复跑到 error=0 → 交付。
连续两轮没实质进展就停下来，把选择权交回用户，别无限循环。

## 4 排障入口

| 症状 | 先看 |
|---|---|
| 拉码 401 / 404 / 403、webhook 不触发 | `references/dood-and-gitlab.md` §2 |
| socket 权限、workspace 权限、镜像堆积 | `references/dood-and-gitlab.md` §1 |
| lint 规则判级拿不准 | `references/lint-rules.md` §2 |
| 流水线卡死、插件装不上、时间差、构建上下文错 | `references/troubleshooting.md` §1 |
| 构建卡住没报错、触发后重复入队 | `references/troubleshooting.md` §2、§3 |
| REST 403、Script Console 执行命令 | `references/troubleshooting.md` §4 |
| 部署完还是旧版本、部署后要验证 | `references/pipeline-authoring.md` §2 要点 |
| 控制器容器 / 鉴权 / nginx / sudo / systemd | **换 `jenkins-controller` 技能** |

## 5 文件索引

| 文件 | 什么时候读 |
|---|---|
| `references/pipeline-authoring.md` | 写 Jenkinsfile、选型、查语法、抽 Shared Library |
| `references/dood-and-gitlab.md` | 流水线操作宿主 docker、接 GitLab |
| `references/lint-rules.md` | 判断一条 lint 规则该不该修 |
| `references/troubleshooting.md` | 流水线侧按症状排障（含 REST / Script Console 实战） |
| `scripts/validate_jenkinsfile.py` | 校验 Jenkinsfile（退出码 0/1/2） |
| `scripts/generate_shared_library.py` | 生成 Shared Library 脚手架 |

## 6 参考

- Pipeline 语法 / 最佳实践：https://www.jenkins.io/doc/book/pipeline/syntax/ 、 https://www.jenkins.io/doc/pipeline/examples/ 、 https://www.jenkins.io/doc/book/pipeline/pipeline-best-practices/
- 插件文档索引：https://plugins.jenkins.io/ 、 https://www.jenkins.io/doc/pipeline/steps/
- DooD 权限问题：https://community.jenkins.io/t/problem-with-group-permissions-for-docker-agent-and-dockerized-jenkins-controller-in-a-docker-outside-of-docker-dood-setup/36882
- GitLab↔Jenkins：https://docs.gitlab.com/ja-jp/integration/jenkins/
- 实战 Jenkinsfile 合集：https://gist.github.com/merikan/228cdb1893fca91f0663bab7b095757c

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
