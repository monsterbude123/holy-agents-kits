#!/usr/bin/env bash
# =============================================================================
# switch-nginx-upstream.sh —— 把 jenkins.0xfiang.com 的 nginx 反代指向切到/切回
#
#   切换:  proxy_pass http://127.0.0.1:8080   ->   http://127.0.0.1:28080
#   回滚:  proxy_pass http://127.0.0.1:28080  ->   http://127.0.0.1:8080
#
#   * 改之前先把原文件备份到备份目录（带时间戳）
#   * 改完先 `nginx -t` 校验语法，不通过就自动还原备份并退出
#   * 校验通过再 `nginx -s reload`
#   * 支持 --dry-run（只看计划不改文件）和 --rollback（还原最近一次备份）
#   * 脚本不碰任何密钥
#
#   用法（需要 root）:
#     sudo bash scripts/switch-nginx-upstream.sh --dry-run
#     sudo bash scripts/switch-nginx-upstream.sh            # 切到容器 28080
#     sudo bash scripts/switch-nginx-upstream.sh --rollback  # 切回宿主 8080
# =============================================================================
set -euo pipefail

CONF="${NGINX_VHOST_CONF:-/www/server/panel/vhost/nginx/jenkins.0xfiang.com.conf}"
NGINX_BIN="${NGINX_BIN:-/www/server/nginx/sbin/nginx}"
BACKUP_DIR="${NGINX_BACKUP_DIR:-/www/server/panel/vhost/nginx/.jenkins-190-backup}"
OLD_UPSTREAM="http://127.0.0.1:8080"
NEW_UPSTREAM="http://127.0.0.1:28080"

DRY_RUN=0
ROLLBACK=0

usage() {
    sed -n '2,20p' "$0"
}

for arg in "$@"; do
    case "$arg" in
        --dry-run)  DRY_RUN=1 ;;
        --rollback) ROLLBACK=1 ;;
        -h|--help)  usage; exit 0 ;;
        *) echo "未知参数: $arg" >&2; usage >&2; exit 2 ;;
    esac
done

[ "$(id -u)" -eq 0 ] || { echo "ERROR: 需要 root 权限（改 nginx 配置并 reload）" >&2; exit 1; }
[ -f "$CONF" ] || { echo "ERROR: 找不到 nginx 站点配置: $CONF" >&2; exit 1; }
[ -x "$NGINX_BIN" ] || { echo "ERROR: 找不到 nginx 可执行文件: $NGINX_BIN" >&2; exit 1; }

stamp() { date +%Y%m%d-%H%M%S; }

# --- nginx 重载 ---------------------------------------------------------------
# 宝塔 nginx 的 pid 文件(/www/server/nginx/logs/nginx.pid)经常是过期的旧 pid，
# 这时 `nginx -s reload` 会报:
#     nginx: [alert] kill(<old pid>, 1) failed (3: No such process)
# 而配置其实没被重载 → 线上 502。兜底做法:直接找到真正的 nginx master 进程发 HUP。
# 注意区分宿主宝塔 nginx(daemon on)与容器里的 nginx(daemon off)。
reload_nginx() {
    local err_file master
    err_file="$(mktemp "${TMPDIR:-/tmp}/nginx-reload.XXXXXX")"
    if "$NGINX_BIN" -s reload 2>"$err_file"; then
        rm -f "$err_file"
        echo "OK: nginx -s reload 成功"
        return 0
    fi
    echo "WARN: nginx -s reload 失败 -> $(tr '\n' ' ' < "$err_file")"
    rm -f "$err_file"
    master="$(ps -eo pid,cmd | grep '[n]ginx: master process' | grep 'daemon on' | awk '{print $1}' | head -n 1)"
    if [ -z "$master" ]; then
        master="$(ps -eo pid,cmd | grep '[n]ginx: master process' | awk '{print $1}' | head -n 1)"
    fi
    if [ -z "$master" ]; then
        echo "ERROR: 找不到 nginx master 进程，无法重载 nginx" >&2
        return 1
    fi
    echo "INFO: 改用 kill -HUP $master 重载 nginx"
    kill -HUP "$master"
    sleep 2
    echo "OK: nginx 已重载 (master pid=$master)"
}

count_matches() {
    local port="$1"
    grep -c -E "proxy_pass[[:space:]]+http://127\.0\.0\.1:${port}" "$CONF" 2>/dev/null || true
}

latest_backup() {
    ls -1t "$BACKUP_DIR"/jenkins.0xfiang.com.conf.*.bak 2>/dev/null | head -n 1 || true
}

# --- 回滚模式 ----------------------------------------------------------------
if [ "$ROLLBACK" -eq 1 ]; then
    bak="$(latest_backup)"
    [ -n "$bak" ] || { echo "ERROR: 备份目录里没有可用的备份: $BACKUP_DIR" >&2; exit 1; }
    echo "INFO: 回滚，使用备份 $bak"
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: cp -f $bak $CONF"
        echo "DRY-RUN: $NGINX_BIN -t && $NGINX_BIN -s reload"
        exit 0
    fi
    cp -f "$bak" "$CONF"
    if ! "$NGINX_BIN" -t; then
        echo "ERROR: nginx -t 未通过，已保留还原后的配置，请人工检查 $CONF" >&2
        exit 1
    fi
    reload_nginx
    echo "OK: 已回滚到备份版本并 reload"
    grep -n "proxy_pass" "$CONF" | sed 's/^/    /'
    exit 0
fi

# --- 切换模式 ----------------------------------------------------------------
old_count="$(count_matches 8080)"
new_count="$(count_matches 28080)"

echo "INFO: 配置文件: $CONF"
echo "INFO: 当前 proxy_pass 指向 8080 的行数 = $old_count，指向 28080 的行数 = $new_count"

if [ "$old_count" -eq 0 ]; then
    if [ "$new_count" -gt 0 ]; then
        echo "INFO: 已经是容器上游（28080），无需修改"
        if [ "$DRY_RUN" -eq 1 ]; then
            echo "DRY-RUN: $NGINX_BIN -t && $NGINX_BIN -s reload"
        else
            "$NGINX_BIN" -t && reload_nginx
            echo "OK: 已重新加载 nginx"
        fi
        exit 0
    fi
    echo "ERROR: 配置里既没有 8080 也没有 28080 的 proxy_pass，请人工确认 $CONF" >&2
    exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
    tmp="$(mktemp "${TMPDIR:-/tmp}/nginx-conf.XXXXXX")"
    trap 'rm -f "$tmp"' EXIT
    cp "$CONF" "$tmp"
    # 两步替换：先用占位符避免 "\1" 后紧跟数字被误解析成 \12 这样的多位数反向引用
    sed -i "s#\(proxy_pass[[:space:]]\{1,\}http://127\.0\.0\.1:\)8080#\1@@JENKINS_PORT@@#g" "$tmp"
    sed -i "s#@@JENKINS_PORT@@#28080#g" "$tmp"
    echo "DRY-RUN: 备份 -> $BACKUP_DIR/jenkins.0xfiang.com.conf.$(stamp).bak"
    echo "DRY-RUN: diff -u $CONF $tmp"
    diff -u "$CONF" "$tmp" || true
    echo "DRY-RUN: $NGINX_BIN -t && $NGINX_BIN -s reload"
    exit 0
fi

# --- 备份 → 改写 → 校验 → reload -------------------------------------------
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/jenkins.0xfiang.com.conf.$(stamp).bak"
cp -p "$CONF" "$BACKUP_FILE"
echo "INFO: 已备份到 $BACKUP_FILE"

sed -i "s#\(proxy_pass[[:space:]]\{1,\}http://127\.0\.0\.1:\)8080#\1@@JENKINS_PORT@@#g" "$CONF"
sed -i "s#@@JENKINS_PORT@@#28080#g" "$CONF"

if ! grep -q -E "proxy_pass[[:space:]]+http://127\.0\.0\.1:28080" "$CONF"; then
    echo "ERROR: 改写后没有找到 28080 的 proxy_pass，已还原备份" >&2
    cp -p "$BACKUP_FILE" "$CONF"
    exit 1
fi

echo "INFO: nginx -t 校验中 ..."
if ! "$NGINX_BIN" -t; then
    echo "ERROR: nginx -t 未通过，已自动还原 $BACKUP_FILE" >&2
    cp -p "$BACKUP_FILE" "$CONF"
    exit 1
fi
echo "OK: nginx -t 通过"

reload_nginx
echo "OK: 已 reload nginx，jenkins.0xfiang.com 现在指向 $NEW_UPSTREAM"
grep -n "proxy_pass" "$CONF" | sed 's/^/    /'
echo "INFO: 回滚命令: sudo bash $0 --rollback"
