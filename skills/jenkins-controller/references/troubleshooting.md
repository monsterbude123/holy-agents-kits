# 控制器排障速查

> 什么时候读这份：控制器容器起不来、鉴权不对、sudo/systemd 不通、nginx 502、收敛脚本没生效。
> 流水线侧的报错 → `jenkins-cli` 技能的 `references/troubleshooting.md`。

先跑体检定位到具体分区：`bash scripts/verify-controller.sh`（10 项，输出 PASS/FAIL/WARN + 退出码）。

| 症状 | 根因 | 处理 |
|---|---|---|
| `sudo: sorry, you must have a tty` | sudo 默认要 tty，Jenkins `sh` 块没有 | sudoers 加 `Defaults:jenkins !use_pty` |
| `sudo: a password is required`（明明在 sudoers 白名单里） | sudoers 是**命令 + 固定参数**的精确白名单，多带一个参数（如 `--no-pager`）就不匹配 | 调用必须照抄白名单原始形式：`sudo -n /bin/systemctl status ai-short-studio-prod.service` |
| `sudo -u www npm install` EACCES（缓存目录） | 宝塔 npm 全局 cache 在 `/www/server/nodejs/cache`，容器没挂 → www 无权建目录；www 家目录也要可写 | 把 `/www/server/nodejs/cache` 挂进容器 + 给 www 可写的家目录；HOME 语义见 `references/controller-container.md` §2 |
| 容器里 `systemctl: command not found` | 镜像没装 systemd | apt 装 systemd（只为拿 `/bin/systemctl`） |
| `sudo systemctl restart` 连不上宿主 systemd | 没挂宿主 systemd socket | 挂 `/run/systemd/private` + `/run/dbus/system_bus_socket` |
| `sudo systemctl restart` 报 `Failed to connect to system scope bus via local transport: No data available` | systemd private socket 拒绝**不同 PID namespace** 的客户端 | compose 开 `pid: host`，再 `docker compose up -d --force-recreate` |
| 容器里 node 版本与宿主不一致 | 镜像自带 node 或没软链 | 镜像不装 nodejs，软链宿主 node 目录，`/usr/local/bin` 优先 PATH |
| 改了 .env 密码，旧密码仍能登录 | `User.addProperty` 追加旧哈希 | 先 remove 旧 `Details` 再 `createAccount` + `save()` |
| 匿名还能看项目列表 | 授权策略仍允许匿名读 | `FullControlOnceLoggedInAuthorizationStrategy()` + `setAllowAnonymousRead(false)` |
| 启动后又出现安装向导 | 迁移的 home 缺 install-state 文件 | `setInstallState(InstallState.INITIAL_SETUP_COMPLETED)` |
| init.groovy.d 没执行 / 改了脚本行为没变 | `jenkins.sh` 只在 `PRE_CLEAR_INIT_GROOVY_D` 非空时清空 `$JENKINS_HOME/init.groovy.d`，且 `copy_reference_file` 不覆盖已有文件 ⇒ 卷内旧脚本盖住镜像里的新脚本 | compose 固定 `PRE_CLEAR_INIT_GROOVY_D: "1"`（见 `references/controller-container.md` §4） |
| 宿主 nginx `nginx -s reload` 报 `kill(pid) failed (3: No such process)`，配置没生效 | 宝塔 nginx 的 pid 文件过期 | 找真正的 master（`ps -eo pid,cmd \| grep "[n]ginx: master process" \| grep "daemon on"`）后 `kill -HUP <pid>`；别 HUP 到容器里的 nginx master |
| 宿主 nginx 502 | upstream 没切或容器没起 | `nginx -t` + reload；`curl -I http://127.0.0.1:28080/login` |
| `NoSuchFieldException: allowsSignup` | 反射取 `HudsonPrivateSecurityRealm` 的私有字段（真名 `disableSignup`） | 用 `realm.allowsSignup()` 判断，别反射 |
| `Could not find matching constructor for: hudson.security.FullControlOnceLoggedInAuthorizationStrategy(java.lang.Boolean)` | 该类只有无参构造 | `new FullControlOnceLoggedInAuthorizationStrategy()` + `strategy.setAllowAnonymousRead(false)` |
| 容器里写文件属主不对（落宿主目录后属主是 110 而不是 1000） | 容器内 jenkins uid/gid 与宿主不一致 | 见 `references/controller-container.md` §1（uid/gid 对齐） |
| `scripts/xxx.sh: No such file or directory` | 脚本已搬到 `jenkins-controller` 技能目录，不再在部署包 `test-190/jenkins/scripts/` | 用 `lib/pkg.sh` 的 `resolve_pkg_dir()` 定位包目录；脚本本体在 `skills/jenkins-controller/scripts/` |
