#!/usr/bin/env bash
# =============================================================================
# verify-controller.sh —— 容器化 Jenkins 控制器全量体检（只读）
#
#   一次跑完下面这些断言，替代一次性排查脚本：
#     1  容器运行中 + healthy
#     2  控制器身份（jenkins uid/gid、www、home 目录属主）
#     3  DooD：容器内能看到宿主容器
#     4  宿主工具链：node / npm / sudo -u www 的 HOME
#     5  宿主 systemd 可达（pid: host）+ sudoers 规则可见
#     6  流水线目录 git 可用（ls-remote）
#     7  鉴权：匿名 / =403、/api/json =403、/login =200、管理员 /api/json =200
#     8  迁移数据：users / jobs / credentials.xml
#     9  初始化收敛脚本的执行痕迹（SUMMARY 行）
#     10 nginx upstream 与旧 systemd 服务状态
#
#   只读：不改任何配置、不重启任何服务。
#   口令：只从包内 .env 读进 netrc 临时文件（600），用完删除；**任何输出都不含口令**。
#
#   用法（在包根目录执行）:
#     bash scripts/verify-controller.sh
#     bash scripts/verify-controller.sh --container jenkins-190 \
#        --base-url http://127.0.0.1:28080 \
#        --public-url https://jenkins.0xfiang.com \
#        --service ai-short-studio-prod.service \
#        --project-dir /opt/ai-short-studio-prod
#
#   退出码:
#     0  全部断言通过
#     1  有断言失败
#     2  用法或环境错（找不到 docker / 容器不存在 / 缺 .env）
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/pkg.sh
. "$SCRIPT_DIR/lib/pkg.sh"

CONTAINER="${CONTAINER:-jenkins-190}"
BASE_URL="${BASE_URL:-http://127.0.0.1:28080}"
PUBLIC_URL="${PUBLIC_URL:-https://jenkins.0xfiang.com}"
VHOST="${VHOST:-/www/server/panel/vhost/nginx/jenkins.0xfiang.com.conf}"
PROJECT_DIR="${PROJECT_DIR:-/opt/ai-short-studio-prod}"
OLD_SVC="${OLD_SVC:-jenkins.service}"
SERVICE="${SERVICE:-ai-short-studio-prod.service}"
EXPECT_UID="${EXPECT_UID:-110}"
EXPECT_GID="${EXPECT_GID:-114}"
ENV_FILE="${ENV_FILE:-}"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
FAILED=0

usage() { sed -n '2,32p' "$0"; }

while [ $# -gt 0 ]; do
    case "$1" in
        --container)   CONTAINER="$2"; shift 2 ;;
        --base-url)    BASE_URL="$2"; shift 2 ;;
        --public-url)  PUBLIC_URL="$2"; shift 2 ;;
        --vhost)       VHOST="$2"; shift 2 ;;
        --project-dir) PROJECT_DIR="$2"; shift 2 ;;
        --service)     SERVICE="$2"; shift 2 ;;
        --old-service) OLD_SVC="$2"; shift 2 ;;
        --env-file)    ENV_FILE="$2"; shift 2 ;;
        --package-dir) PKG_DIR="$2"; shift 2 ;;
        -h|--help)     usage; exit 0 ;;
        *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
    esac
done

PKG_DIR="$(require_pkg_dir)" || exit 2
ENV_FILE="${ENV_FILE:-$PKG_DIR/.env}"

ok()   { PASS_COUNT=$((PASS_COUNT+1)); printf 'PASS  %-22s %s\n' "$1" "$2"; }
bad()  { FAIL_COUNT=$((FAIL_COUNT+1)); FAILED=1; printf 'FAIL  %-22s %s\n' "$1" "$2"; }
warn() { WARN_COUNT=$((WARN_COUNT+1)); printf 'WARN  %-22s %s\n' "$1" "$2"; }
skip() { printf 'SKIP  %-22s %s\n' "$1" "$2"; }

section() { printf '\n===== %s =====\n' "$1"; }

http_code() {
    local out
    out="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null)" || out="000"
    printf '%s' "${out:-000}"
}

# --- 前置 ---------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || { echo "ERROR: 找不到 docker" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "ERROR: 无法连接 docker daemon" >&2; exit 2; }
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: 找不到 $ENV_FILE（管理员凭据只在这里）" >&2
    exit 2
fi

ADMIN_USER="$(grep -E '^JENKINS_ADMIN_USER=' "$ENV_FILE" | head -1 | sed -E 's/^[^=]*=//; s/^"//; s/"$//')"
ADMIN_PASS="$(grep -E '^JENKINS_ADMIN_PASSWORD=' "$ENV_FILE" | head -1 | sed -E 's/^[^=]*=//; s/^"//; s/"$//')"
if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ]; then
    echo "ERROR: $ENV_FILE 里缺少 JENKINS_ADMIN_USER / JENKINS_ADMIN_PASSWORD" >&2
    exit 2
fi

# netrc 里两个机器名都写一份，口令只落在 600 临时文件里，用完删除
NETRC="$(mktemp "${TMPDIR:-/tmp}/jenkins-netrc.XXXXXX")"
chmod 600 "$NETRC"
printf 'machine 127.0.0.1 login %s password %s\n' "$ADMIN_USER" "$ADMIN_PASS" > "$NETRC"
printf 'machine jenkins.0xfiang.com login %s password %s\n' "$ADMIN_USER" "$ADMIN_PASS" >> "$NETRC"
cleanup() { rm -f "$NETRC"; }
trap cleanup EXIT

# --- 1 容器 ------------------------------------------------------------------
section "1 容器状态"
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
if [ "$state" = "running" ]; then ok "容器运行中" "$CONTAINER ($state/$health)"; else bad "容器运行中" "$CONTAINER state=$state"; fi
if [ "$health" = "healthy" ]; then ok "健康检查" "healthy"; else warn "健康检查" "health=$health"; fi
docker ps --filter "name=$CONTAINER" --format '      {{.Names}} | {{.Status}} | {{.Ports}}'

# --- 2 身份 ------------------------------------------------------------------
section "2 控制器身份"
idout="$(docker exec "$CONTAINER" id jenkins 2>/dev/null || true)"
if printf '%s' "$idout" | grep -q "uid=${EXPECT_UID}"; then
    ok "jenkins uid" "$(printf '%s' "$idout" | tr -s ' ' | cut -d' ' -f1-4)"
else
    bad "jenkins uid" "期望 uid=${EXPECT_UID}: ${idout:-无输出}"
fi
if printf '%s' "$idout" | grep -q "gid=${EXPECT_GID}"; then
    ok "jenkins gid" "gid=${EXPECT_GID}"
else
    bad "jenkins gid" "期望 gid=${EXPECT_GID}: ${idout:-无输出}"
fi
wwwid="$(docker exec "$CONTAINER" id www 2>/dev/null || true)"
if printf '%s' "$wwwid" | grep -q 'uid=1000'; then ok "www 身份" "uid=1000"; else warn "www 身份" "${wwwid:-无输出}"; fi
for d in /var/jenkins_home /home/www; do
    lsout="$(docker exec "$CONTAINER" stat -c '%n %u:%g %a' "$d" 2>/dev/null || true)"
    if [ -n "$lsout" ]; then ok "目录属主" "$lsout"; else warn "目录属主" "$d 不存在"; fi
done

# --- 3 DooD ------------------------------------------------------------------
section "3 DooD（docker.sock）"
dood="$(docker exec "$CONTAINER" docker ps --format '{{.Names}}' 2>&1 | head -5 || true)"
doodn="$(printf '%s' "$dood" | grep -c . || true)"
if [ "$doodn" -ge 1 ]; then ok "容器内可见宿主容器" "$doodn 个"; else bad "容器内可见宿主容器" "$dood"; fi

# --- 4 宿主工具链 ------------------------------------------------------------
section "4 宿主工具链"
nv="$(docker exec "$CONTAINER" node --version 2>/dev/null || true)"
[ -n "$nv" ] && ok "node" "$nv" || bad "node" "容器内没有 node"
npmv="$(docker exec "$CONTAINER" /usr/bin/npm --version 2>/dev/null || true)"
[ -n "$npmv" ] && ok "npm" "$npmv" || bad "npm" "容器内没有 npm"
homeout="$(docker exec "$CONTAINER" sudo -u www /bin/bash -c 'echo $HOME' 2>/dev/null || true)"
if [ "$homeout" = "/home/www" ]; then
    ok "sudo -u www HOME" "$homeout"
else
    bad "sudo -u www HOME" "$homeout（期望 /home/www）"
fi
npmwww="$(docker exec "$CONTAINER" sudo -u www /usr/bin/npm --version 2>/dev/null || true)"
[ -n "$npmwww" ] && ok "www 身份 npm" "$npmwww" || bad "www 身份 npm" "执行失败（检查 npm cache 挂载）"

# --- 5 宿主 systemd + sudoers ------------------------------------------------
section "5 宿主 systemd 与 sudoers"
# 注意：sudoers 里写的是「命令 + 固定参数」的精确白名单
#（/bin/systemctl status ai-short-studio-prod.service），多带一个 --no-pager
# 就不再匹配，sudo 会退回要密码。所以这里必须照抄白名单里的原始调用。
sysout="$(docker exec "$CONTAINER" sudo -n /bin/systemctl status "$SERVICE" 2>&1 | head -5 || true)"
if printf '%s' "$sysout" | grep -q 'a password is required'; then
    bad "宿主 systemd" "sudoers 未放行 status $SERVICE（检查白名单参数是否完全一致）"
elif printf '%s' "$sysout" | grep -q 'Failed to connect to system scope bus'; then
    bad "宿主 systemd" "跨 PID namespace 被拒（compose 需要 pid: host）"
elif printf '%s' "$sysout" | grep -qi 'Active:'; then
    ok "宿主 systemd" "$(printf '%s' "$sysout" | grep -i 'Active:' | head -1 | tr -s ' ')"
else
    bad "宿主 systemd" "$sysout"
fi
sudol="$(docker exec "$CONTAINER" sudo -n -l 2>&1 || true)"
if printf '%s' "$sudol" | grep -q '!use_pty'; then ok "sudoers" "含 !use_pty"; else bad "sudoers" "缺 !use_pty（sh 块会要 tty）"; fi
if printf '%s' "$sudol" | grep -q "$SERVICE"; then ok "sudoers 规则" "含 $SERVICE"; else warn "sudoers 规则" "未见 $SERVICE"; fi

# --- 6 git -------------------------------------------------------------------
section "6 流水线目录 git"
gitout="$(docker exec "$CONTAINER" git -C "$PROJECT_DIR" ls-remote origin HEAD 2>&1 | tail -1 || true)"
if printf '%s' "$gitout" | grep -Eq '^[0-9a-f]{40}\s'; then ok "git ls-remote" "$gitout"; else bad "git ls-remote" "$gitout"; fi
sshls="$(docker exec "$CONTAINER" ls -l /var/jenkins_home/.ssh 2>&1 | head -5 || true)"
printf '%s\n' "$sshls" | sed 's/^/      /'

# --- 7 鉴权 ------------------------------------------------------------------
section "7 鉴权"
for spec in "$BASE_URL/:403" "$BASE_URL/api/json:403" "$BASE_URL/login:200"; do
    url="${spec%:*}"; expect="${spec##*:}"
    code="$(http_code "$url")"
    if [ "$code" = "$expect" ]; then ok "匿名 $url" "$code"; else bad "匿名 $url" "$code（期望 $expect）"; fi
done
acode="$(curl -sk --netrc-file "$NETRC" -o /dev/null -w '%{http_code}' --max-time 20 "$BASE_URL/api/json" 2>/dev/null || echo 000)"
if [ "$acode" = "200" ]; then ok "管理员 /api/json" "200"; else bad "管理员 /api/json" "$acode（期望 200）"; fi

# --- 8 迁移数据 --------------------------------------------------------------
section "8 迁移数据"
users="$(docker exec "$CONTAINER" ls /var/jenkins_home/users 2>&1 | tr '\n' ' ' | sed 's/_[0-9a-f]\{16,\}//g' || true)"
if printf '%s' "$users" | grep -q "$ADMIN_USER"; then ok "users" "$users"; else bad "users" "$users"; fi
jobs="$(docker exec "$CONTAINER" ls /var/jenkins_home/jobs 2>&1 | tr '\n' ' ' || true)"
if [ -n "$jobs" ]; then ok "jobs" "$jobs"; else warn "jobs" "目录为空或不存在"; fi
creds="$(docker exec "$CONTAINER" grep -o '<id>[^<]*</id>' /var/jenkins_home/credentials.xml 2>/dev/null | head -5 | tr '\n' ' ' || true)"
if [ -n "$creds" ]; then ok "credentials.xml" "$creds"; else warn "credentials.xml" "没有 id"; fi

# --- 9 初始化收敛脚本 --------------------------------------------------------
section "9 初始化收敛脚本"
initlog="$(docker logs "$CONTAINER" 2>&1 | grep -E 'SUMMARY|jenkins-init' | tail -5 || true)"
if printf '%s' "$initlog" | grep -q 'anonymousReadDenied=true'; then
    ok "收敛脚本" "$(printf '%s' "$initlog" | grep SUMMARY | tail -1)"
else
    bad "收敛脚本" "没看到 anonymousReadDenied=true（init.groovy.d 未生效？）"
fi

# --- 10 nginx 与旧服务 -------------------------------------------------------
section "10 nginx 上游与旧服务"
if [ -f "$VHOST" ]; then
    upstream="$(grep -n 'proxy_pass' "$VHOST" | tr -s ' ' | head -3 | tr '\n' ';')"
    if printf '%s' "$upstream" | grep -q '28080'; then ok "nginx upstream" "$upstream"; else bad "nginx upstream" "$upstream（期望指向 28080）"; fi
else
    warn "nginx upstream" "找不到 $VHOST"
fi
for path in / /login /api/json; do
    code="$(http_code "$PUBLIC_URL$path")"
    printf '      %-12s %s\n' "$path" "$code"
done
oldact="$(systemctl is-active "$OLD_SVC" 2>&1 || true)"
oldena="$(systemctl is-enabled "$OLD_SVC" 2>&1 || true)"
if [ "$oldact" = "inactive" ]; then ok "旧服务已停" "$OLD_SVC is-active=$oldact"; else warn "旧服务已停" "$OLD_SVC is-active=$oldact"; fi
if [ "$oldena" = "disabled" ]; then ok "旧服务已禁用" "$OLD_SVC is-enabled=$oldena"; else warn "旧服务已禁用" "$OLD_SVC is-enabled=$oldena"; fi

# --- 汇总 --------------------------------------------------------------------
section "汇总"
printf 'PASS=%d  FAIL=%d  WARN=%d\n' "$PASS_COUNT" "$FAIL_COUNT" "$WARN_COUNT"
if [ "$FAILED" -ne 0 ]; then
    echo "RESULT: FAILED"
    exit 1
fi
echo "RESULT: OK"
