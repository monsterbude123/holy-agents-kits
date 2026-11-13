# 容器化 Jenkins 控制器（宿主机 Jenkins → 容器）

> 什么时候读这份：把宿主机 systemd 装的 Jenkins 换成容器、迁旧 home 进卷、收敛鉴权、切 nginx 上游。

宿主机 Jenkins 换成容器后，跑在控制器上的流水线（`agent any`）仍然要操作宿主：
systemctl 管服务、`sudo -u www npm install/build`、往宿主目录写产物。
**四件事要同时打通**：宿主身份（uid/gid）、sudo 免密、宿主 systemd 可达、宿主工具链；
外加**容器化后的安全收敛**（旧 home 常是无密码保护 + 允许匿名读）。

本仓库的落地实例：`test-190/jenkins/`（包根即 compose 目录）。

---

## 1 uid/gid 与宿主对齐

基础镜像里 jenkins 是 1000:1000，宿主 jenkins 常是 110:114（www 1000:1000，home `/home/www`）。
要"以 www 身份跑构建、在宿主目录落文件属主正确"，镜像里就把账号改成宿主的：

```dockerfile
RUN set -eux; \
    if getent passwd 110 >/dev/null || getent group 114 >/dev/null; then \
        echo "ERROR: uid 110 / gid 114 已被占用"; exit 1; fi; \
    groupmod -g 114 jenkins && usermod -u 110 -g 114 jenkins; \
    groupadd -g 1000 www && useradd -u 1000 -g 1000 -d /home/www -s /sbin/nologin -m www; \
    chown -R 110:114 /var/jenkins_home
```

要点：

- **冲突必须显式失败**，不要静默跳过（先 `getent passwd 110` / `getent group 114` 查）。
- 顺序：先 `groupmod` 改 gid，再 `usermod -u -g` 改用户。
- 迁进卷的旧 home 属主也按**宿主** uid 修（`chown -R 110:114 /var/jenkins_home`），不是 1000:1000。
- 自检：`docker exec jenkins-190 id jenkins` 应显示 110:114，`id www` 应显示 1000:1000。

---

## 2 sudo 免密规则（sudoers drop-in）

容器里 sudo 默认要 tty，而 Jenkins `sh` 块没有 tty → 必须 `Defaults:jenkins !use_pty`。
规则文件放 `/etc/sudoers.d/`，权限 `root:root 0440`，构建时用 `visudo -cf` 自检：

```
# Jenkins 无密码管理 ai-short-studio 服务
# 注意：Jenkins sh 块没 tty，要覆盖 use_pty default
Defaults:jenkins !use_pty
jenkins ALL=(ALL) NOPASSWD: /bin/systemctl restart ai-short-studio-prod.service
jenkins ALL=(ALL) NOPASSWD: /bin/rm -rf /opt/ai-short-studio-prod/.next
jenkins ALL=(www) NOPASSWD: /bin/npm
jenkins ALL=(www) NOPASSWD: /bin/bash
```

要点：

- 按"命令白名单"逐条列，别写 `ALL=(ALL) NOPASSWD: ALL`。
- `sudo -u www npm install` 这类要单独写 `(www)` 作用域的规则。
- sudoers 里写 `/bin/npm` 可解析（Debian 的 `/bin` 是 `/usr/bin` 的软链），
  但目标脚本要有可执行位，否则报 permission denied。
- ★**白名单是「命令 + 固定参数」的精确匹配**：写的是 `/bin/systemctl status ai-short-studio-prod.service`，
  调用时多带一个 `--no-pager` 就**不再匹配**，sudo 会退回要密码（报 `sudo: a password is required`）。
  容器里驱动宿主服务要照抄白名单里的原始形式，别自作主张加参数。
- **HOME 语义**（sudoers(5) 原文）：`always_set_home` = 任何调用形态都取**目标用户**家目录；
  `set_home` = 只在 `-s` / `-i` 启动 shell 时取；`env_reset` 生效且 HOME 不在 `env_keep` 时同样取目标用户家目录。
  三者都不是"发起者（jenkins）的家目录"。本仓库实测 `sudo -u jenkins sudo -u www /bin/bash -c 'echo $HOME'` → `/home/www`。
- `sudo -u www npm install` EACCES 的真因**不是 HOME 取错**，而是宝塔 npm 的全局 cache 目录
  `/www/server/nodejs/cache` 没挂进容器（www 无权创建），外加 www 家目录要可写 → 把 cache 目录挂进去。
- 自检：`visudo -c`；容器内 `sudo -n -l` 能看到 Defaults 与白名单。

---

## 3 触达宿主 systemd + 宿主工具链

- 容器内要有 `/bin/systemctl`：基础镜像不带，apt 装 `systemd` 即可（只为拿这个二进制，
  容器里并不跑 systemd）；postinst 可能报 "not been booted with systemd"，
  用 `SYSTEMD_OFFLINE=1` + `DEBIAN_FRONTEND=noninteractive` 兜住（写成 ARG，别留成最终镜像的 ENV）。
- 要操作**宿主** systemd，必须挂宿主 systemd 的 socket：
  `/run/systemd/private:/run/systemd/private` 和 `/run/dbus/system_bus_socket:/run/dbus/system_bus_socket`。
- ★**只挂 socket 还不够**：systemd 的 private socket 会**拒绝来自不同 PID namespace 的客户端**，
  报 `Failed to connect to system scope bus via local transport: No data available`
  → compose 必须同时开 `pid: host`（与宿主共享 PID namespace），
  改完要 `docker compose up -d --force-recreate` 才生效。
- node/npm 要与宿主宝塔工具链一致（如 v24.15.0），就 bind 宿主 node 目录再软链，
  **镜像里不要装 nodejs**（否则 `/usr/bin/node` 会按 PATH 顺序抢在宝塔 node 前面）：
  `/usr/local/bin/node -> /www/server/nodejs/v24.15.0/bin/node`、
  `/usr/bin/npm -> /www/server/nodejs/v24.15.0/lib/node_modules/npm/bin/npm-cli.js`。
- 宿主业务目录按需 bind 进容器（如 `/opt/<app>-prod`），属主与容器内 uid 对齐（见 §1）；
  宿主不存在的目录**不要**写进 compose（会导致 docker 建出空目录，覆盖语义）。

---

## 4 容器化控制器的安全收敛（init.groovy.d）

宿主旧 home 常是"无密码保护的 HudsonPrivateSecurityRealm + 允许匿名只读"，迁进容器后要收敛。
放 `init.groovy.d/01-security.groovy`，**每次启动都会跑，必须幂等**。
实测过的核心 API（jenkins 2.568.2 core）：

```groovy
import hudson.model.User
import hudson.security.HudsonPrivateSecurityRealm
import hudson.security.HudsonPrivateSecurityRealm.Details
import hudson.security.FullControlOnceLoggedInAuthorizationStrategy
import jenkins.install.InstallState
import jenkins.model.Jenkins

def jenkins = Jenkins.get()
def realm = jenkins.getSecurityRealm()
if (!(realm instanceof HudsonPrivateSecurityRealm)) {
    realm = new HudsonPrivateSecurityRealm(false)   // false = 关闭自注册
    jenkins.setSecurityRealm(realm)
} else if (realm.allowsSignup()) {
    realm = new HudsonPrivateSecurityRealm(false)   // 只有仍允许自注册才重建
    jenkins.setSecurityRealm(realm)
}
// 注意：没有 setSignUpDisabled 方法，私有字段名是 disableSignup（不是 allowsSignup），
// 反射取字段会抛 NoSuchFieldException: allowsSignup —— 别再这么写
def strategy = jenkins.getAuthorizationStrategy()
if (!(strategy instanceof FullControlOnceLoggedInAuthorizationStrategy)) {
    strategy = new FullControlOnceLoggedInAuthorizationStrategy()  // 只有无参 @DataBoundConstructor
}
strategy.setAllowAnonymousRead(false)                 // 禁匿名只读（用 setter，不是构造入参）
jenkins.setAuthorizationStrategy(strategy)
```

账号 / 密码处理（三个坑一起记）：

- `HudsonPrivateSecurityRealm.Details.fromPlainPassword` / `fromHashedPassword` 是**包私有静态**，Groovy 调不到。
- 只能用 `realm.createAccount(user, pass)`：public、返回 `User`、内部做
  `User.getById(name,true)` + `user.addProperty(Details.fromPlainPassword(pass))`，
  **但不调用 `user.save()`** → 必须自己 `u.save()`。
- `User.addProperty` 是**追加**不是替换：旧密码哈希还在，新密码不生效 →
  先 `user.getProperties().remove(user.getProperty(Details.class))`（再 `user.save()`），再 `createAccount`。

```groovy
def user = User.getById(adminUser, false)
if (user != null) {
    for (def p : user.getProperties()) {             // 收集全部旧 Details，逐个移除
        if (p instanceof Details) { user.getProperties().remove(p) }
    }
    user.save()
}
def u = realm.createAccount(adminUser, adminPass)
u.save()
jenkins.setInstallState(InstallState.INITIAL_SETUP_COMPLETED)  // 迁移的 home 没有这个文件时向导会重现
jenkins.save()
```

要点：

- 密码从环境变量读（.env → compose `env_file`）；缺失就**告警并原样不动**，别改任何配置。
- 日志里**永远不要**打印密码或 passwordHash；结尾只打印
  `user=… anonymousReadDenied=… passwordPropertyPresent=…`。
- 脚本每次启动都重设密码 → **`.env` 里的密码始终是权威值**，改密码改 .env 后重启即可。
- 脚本放镜像的 `/usr/share/jenkins/ref/init.groovy.d/`；官方 `jenkins.sh` 的真实行为是：
  `PRE_CLEAR_INIT_GROOVY_D` **非空**才 `rm -rf "${JENKINS_HOME}/init.groovy.d"`，
  而 `copy_reference_file` **不覆盖已存在的文件**
  → 迁进旧卷后，卷里那份旧脚本会一直赢，镜像里的新脚本永远不执行（症状：改了脚本却行为没变）
  → **compose 固定 `PRE_CLEAR_INIT_GROOVY_D: "1"`**，让镜像里的脚本每次启动都覆盖旧卷里的那份。
- 禁匿名只读后：`/` 与 `/api/json` 匿名必须非 200；但 **`/login` 必须 200**，否则没人能登录。

---

## 5 迁移旧 home 进 named volume

```bash
docker volume create jenkins-190_jenkins_home
tar -czf /var/backups/jenkins-migration/jenkins-home-$(date +%Y%m%d%H%M%S).tar.gz -C /var/lib jenkins
docker run --rm -v /var/lib/jenkins:/src:ro -v jenkins-190_jenkins_home:/dst alpine \
  sh -c 'cp -a /src/. /dst/ && chown -R 110:114 /dst && chmod 700 /dst'
```

要点：

- 源目录**保持不动**，回滚就是把 nginx upstream 切回旧 systemd 服务。
- 卷里已有 `config.xml` 就拒绝执行（除非 `--force`），避免覆盖生产数据。
- 辅助容器用 alpine（宿主已有）；`cp -a` 保权限 / 属主；chown 按宿主 uid（§1）。
- 所有脚本支持 `--dry-run`，重复执行幂等；脚本绝不打印密码 / 令牌。

---

## 6 切 nginx upstream（带 nginx -t 保护）

宝塔 nginx vhost：`/www/server/panel/vhost/nginx/<domain>.conf`，二进制 `/www/server/nginx/sbin/nginx`。
把 `proxy_pass http://127.0.0.1:8080` 改成 `:28080` 时**分两步 sed**，先换占位符再换端口：

```bash
sed -i 's#\(proxy_pass[[:space:]]\{1,\}http://127\.0\.0\.1:\)8080#\1@@JENKINS_PORT@@#g' "$CONF"
sed -i 's#@@JENKINS_PORT@@#28080#g' "$CONF"
```

要点：

- 直接写 `\1` + 数字会被 sed 当成多位反向引用（GNU sed 只认 `\1`~\`\9`），行为不可预期 → 必须占位符两步走。
- 改之前备份 `.bak`；改完先 `nginx -t`，失败自动还原并退出；最后 reload。
- ★reload 不能只信 `nginx -s reload`：宝塔的 pid 文件可能过期 →
  `kill(pid) failed (3: No such process)`，**配置根本没重载**。兜底做法是找真正的 master
  （`ps -eo pid,cmd | grep "[n]ginx: master process" | grep "daemon on"`，别误选容器里的 nginx master）
  后 `kill -HUP <pid>`。
- 切换脚本要支持 `--dry-run`（只打印 diff）和 `--rollback`（还原最近备份）。
- 旧服务端口在宿主**故意留空**（如 8080）给回滚用；切换只改 nginx upstream，不改端口。

---

## 7 本仓库的落地脚本（不要另写一份）

控制器容器化的所有动作已经固化成可重复脚本，直接用，不要手搓临时脚本。
**脚本清单与开关以 SKILL.md §4 为准**，本节只记脚本自身的设计约定：

- 脚本用 `lib/pkg.sh` 的 `resolve_pkg_dir()` 定位部署包（先看 `PKG_DIR` 环境变量，
  再看仓库内相对路径，最后兜底 `/opt/deploy-services/test-190/jenkins`）⇒ 同一份脚本本地/服务器通用。
- `verify-controller.sh` 覆盖 10 项：容器状态 / 身份 uid-gid / DooD / 宿主工具链 / 宿主 systemd /
  git 权限 / 匿名鉴权 / 迁移数据 / init 收敛痕迹 / nginx upstream + 旧服务状态。
- 体检脚本的口令只从包内 `.env` 读进临时 netrc（600，退出即删），输出只含状态码，**永不回显密码**。
- `cutover.sh` 每个阶段幂等、可单独重跑；`finalize` 只停用旧 systemd 服务并打印回滚命令，**旧数据不动**。
- 校验优先于声明：`verify-controller.sh` 的退出码 0/1/2 就是结论，别用"应该没问题"代替。
