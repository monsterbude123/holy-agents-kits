---
name: jenkins-ci
description: Jenkins 流水线编写与日常运维：写/生成/校验 Jenkinsfile、选型（Declarative / Scripted / Shared Library）、DooD 挂 docker.sock 构建部署、GitLab 凭据与 webhook、lint 规则分级、pipeline 报错排障。Invoke when 用户要写或改 Jenkinsfile、生成 CI 流水线、scaffold shared library、让 Jenkins 拉代码构建镜像部署容器、配 GitLab webhook/凭据，或排查 pipeline 报错。部署/迁移/切换控制器容器本身用 jenkins-controller 技能。触发词：Jenkinsfile、CI 流水线、DooD、docker.sock、GitLab webhook、shared library、Jenkinsfile lint。
---

# jenkins-ci：流水线怎么写

本仓库 Jenkins 跑在 Docker 容器里，经宿主 `docker.sock` 操作宿主 daemon（DooD）；代码源 GitLab，
产物是应用镜像与应用容器。

**边界**：只管「流水线怎么写 + 流水线侧排障」。控制器本身（部署/迁移/切上游/体检/鉴权收敛）→
`jenkins-controller` 技能。K8s、云厂商托管 Jenkins、插件开发、制品仓库选型不在范围内，碰到直接说明。

## §1 骨架流程

| 步 | 做什么 | 完成判据 |
|---|---|---|
| 1 选型 | Declarative 默认；运行期要生成 stage 才换 Scripted；多仓库复用才抽 Shared Library | 一句话决定，拿不准从 Declarative 起步 |
| 2 写 | 按 `references/pipeline-authoring.md` 模板生成 Jenkinsfile | 结构完整：`stages` / `steps` / `post` 位置正确 |
| 3 校验 | 跑 lint，按 ERROR → WARNING 分级修 | 退出码 0 且输出 `error=0` |
| 4 部署 | DooD 建镜像、起容器 | 守 §2.2 四条铁律，产物有回收 |
| 5 排障 | 按症状表定位根因 | 落到具体规则或坑位，不靠猜 |

## §2 核心逻辑

### 2.1 凭据与密钥

- 凭据只走 `credentials()` / `withCredentials`；Jenkinsfile、脚本、日志里不出现明文。
- `sh` 块用**单引号**让 shell 展开变量；Groovy 双引号插值会把密钥写进进程列表和构建日志。
- 输出只打印字段名与掩码，结尾摘要形如 `user=admin anonymousReadDenied=true passwordPropertyPresent=true`。
- 真值只存权威源（本仓：仓库根 `.agents/.env` 与服务器包内 `.env`），不落代码、不落对话。

### 2.2 DooD 四条铁律

1. 授权靠 `group_add` + 宿主 docker 组 gid（`.env` 的 `DOCKER_GID`），禁止 `chmod 666`。
2. `docker run -v` 的路径是**宿主**路径；别把容器内 workspace 路径当宿主路径挂。
3. 产物归宿主 daemon → `post` 里 prune，临时容器 `docker rm -f`。
4. 构建容器用户对齐 workspace 属主（uid 1000），否则 EACCES：用 `--user 1000:1000` 或镜像里建同名用户。

### 2.3 控制器侧的依赖

流水线依赖控制器已打通的四件事（uid/gid 对齐、sudo 免密、宿主 systemd 可达、鉴权收敛）。
本技能只消费结果、不重做；不通就去 `jenkins-controller` 的体检脚本定位。

## §3 核心循环

出稿 → lint → 修 ERROR（必须）→ 修 WARNING（应当）→ 复跑到 `error=0` → 交付。
**退出条件**：退出码 0 且 `error=0`。连续两轮没实质进展就停下，把选择权交回用户。

## §4 脚本

```bash
python scripts/validate_jenkinsfile.py <Jenkinsfile>        # 0 通过 / 1 有 ERROR / 2 用法错
python scripts/generate_shared_library.py --name <lib> --package <pkg>
```

两者都支持 `--help`，只依赖标准库；stdout 是报告，stderr 是过程日志。

## §5 参考文件

| 文件 | 什么时候读 |
|---|---|
| `references/pipeline-authoring.md` | 选型、写 Jenkinsfile、查语法、抽 Shared Library |
| `references/dood-and-gitlab.md` | 流水线要操作宿主 docker、接 GitLab 私有仓库或 webhook |
| `references/lint-rules.md` | 判断一条 lint 规则该不该修、判级边界 |
| `references/troubleshooting.md` | 流水线按症状排障；控制器问题转 `jenkins-controller` |
