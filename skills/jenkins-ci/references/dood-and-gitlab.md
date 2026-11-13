# DooD 坑与 GitLab 集成

> 什么时候读这份：流水线里要操作宿主 docker（构建镜像、起容器）、接 GitLab 私有仓库或 webhook。

## 1 DooD（挂 docker.sock）必知的坑

| 坑 | 说明 |
|---|---|
| sock 权限 | sock 属 `root:docker` 660，靠 `group_add`（宿主 docker 组 gid）授权；**禁止 chmod 666** |
| `docker run -v` 是宿主路径 | daemon 在宿主侧，bind mount 指的是**宿主**路径；Jenkins workspace 在 named volume 里宿主并不存在 → 应用容器别 bind mount workspace，要挂载就用宿主真实路径 |
| 构建上下文没问题 | `docker build` 上下文经 API 传输，workspace 在 volume 里也能 build |
| 产物归属宿主 | 镜像 / 容器都出现在宿主 `docker images/ps`，pipeline 不清理就堆积；`post` 里 prune，临时容器 `docker rm -f` |
| workspace 属主 | 容器内 uid 1000 创建的文件宿主上显示陌生 UID，属正常；卷权限错配用一次性容器 `chown -R 1000:1000` 修 |
| 容器内跑构建工具链 | Jenkins 容器没装 node/maven 等工具时，用 `docker run --rm --volumes-from jenkins-190 -w "$WORKSPACE/<sub>" <tool-image> ...`：构建容器复用 jenkins_home 卷，`$WORKSPACE` 路径两边一致，产物直接落 workspace |
| 控制器 uid 与宿主不一致 | 基础镜像 jenkins=1000:1000，宿主 jenkins 常是 110:114（www 1000:1000）；要以宿主身份（`sudo -u www`）在宿主目录落文件，须在 Dockerfile 里改 uid/gid 并 chown 卷内数据，见 `jenkins-controller` 技能的 `references/controller-container.md` §1 |

DOCKER_GID 怎么定：上目标机 `stat -c '%g' /var/run/docker.sock`，与 `.env` 里的 `DOCKER_GID`
不符就改 `.env` 后 `docker compose up -d --force-recreate`（group_add 只在创建容器时生效）。

## 2 GitLab 集成

- 拉私有仓库：Jenkins UI → Credentials → **Username with password**（GitLab 用户名 + PAT，
  scope `read_repository`；要触发 / 写回给 `api`）。优先 Project/Group Access Token，可单独吊销。
- webhook 自动触发：装 gitlab-plugin → 任务勾 "GitLab connection" + "Push Events"，
  GitLab 侧 webhook 指向 `http://<jenkins-host>/project/<job>`，Secret Token 用 Jenkins 生成的。
- 常见认证错误：401 = 凭据缺失 / 过期 / scope 不足；404 = 把 PAT 当 pipeline trigger token 用；
  403 = webhook secret 不符。**禁止** URL 里塞 `user:token@`（明文暴露）。
- SSH 拉取首连免交互：`ssh-keyscan <gitlab-host> >> /var/jenkins_home/.ssh/known_hosts`。
- REST API 写操作要 crumb：先带 cookie jar（`-c/-b`）取 crumb，再带 `Jenkins-Crumb` 头；
  否则 403（这个 403 与 GitLab 403 不是一回事）。
- 容器里拉码报 503 且响应带 `Proxy-Connection` 头（宿主直连正常）= 内网 ACL 不认容器 NAT 网段，
  走宿主 TCP 转发器绕过；服务器内网直连无此问题。
