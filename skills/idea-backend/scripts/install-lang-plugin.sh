#!/usr/bin/env bash
# 装语言插件 + 判 edition 门禁（一次做完，别的 agent 直接用）
#
#   bash scripts/install-lang-plugin.sh gate <pluginId> [--idea-root <root>]
#       读插件 descriptor 的顶层硬依赖 + 社区版平台提供哪些 capability 模块 → 出结论
#   bash scripts/install-lang-plugin.sh install <pluginId> [--idea-root <root>] [--build <build>]
#       按 IDE build 选 marketplace 版本 → 下载 → 解到**用户插件目录** → 打印装了什么
#   bash scripts/install-lang-plugin.sh shim <capability> [<capability>...]
#       写一个本地 shim 插件，声明社区版平台不提供的 capability 模块（如 go-capable）
#   bash scripts/install-lang-plugin.sh verify [--idea-root <root>]
#       从 idea.log 读本机的真实加载结论（权威判据）
#
# 机器路径一律读 config.json（installRoot / configDir / build）；不硬编码。
# 门禁机制说明见 references/capability-matrix.md §3.1。
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$SKILL_DIR/config.json"
[ -f "$CONFIG" ] || { echo "ERROR: 缺 $CONFIG —— 先跑 scripts/setup-env.sh init <安装根>" >&2; exit 2; }

cfg() { node -e "let v;try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));v=process.argv[2].split('.').reduce((o,k)=>o&&o[k],j)}catch(e){}console.log(v===undefined||v===null?'':v)" "$(cygpath -m "$CONFIG" 2>/dev/null || echo "$CONFIG")" "$1"; }

IDEA_ROOT="$(cfg idea.installRoot)"
CONFIG_DIR="$(cfg idea.configDir)"
IDEA_BUILD="$(cfg idea.build)"
IDEA_VERSION="$(cfg idea.version)"
[ -n "$IDEA_ROOT" ] || { echo "ERROR: config.json 没有 idea.installRoot" >&2; exit 2; }
[ -n "$CONFIG_DIR" ] || CONFIG_DIR="$APPDATA/JetBrains/$(basename "$IDEA_ROOT")"

cmd="${1:-}"; shift || true
PLUGIN_ID=""; BUILD="$IDEA_BUILD"

if [ "$cmd" = "shim" ]; then
  # shim 的位置参数全是 capability 名（不能被下面的通用解析吃掉）
  SHIM_CAPS=("$@")
else
  while [ $# -gt 0 ]; do
    case "$1" in
      --idea-root) IDEA_ROOT="$2"; shift 2;;
      --build) BUILD="$2"; shift 2;;
      --plugin-dir) PLUGIN_DIR="$2"; shift 2;;
      *) PLUGIN_ID="$1"; shift;;
    esac
  done
fi

# --- marketplace 选版：挑 compatibleVersions 覆盖本机市场版本、且 build 同一分支的最新一版 ---
# compatibleVersions 的值是**市场版本区间**（如 "2026.2.4 — 2026.2.5"），不是 build 号；
# 插件自己的 version 才是 build 号（可能比 IDE build 高一个 patch，如 Rust 262.12573.30 vs IDE 262.12573.28）。
resolve_update() { # <pluginId> <ideMarketingVersion> <ideBuild>
  curl -s "https://plugins.jetbrains.com/api/plugins/$1/updates?size=40&page=1" | node -e '
    let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{
      const want=process.argv[1], build=process.argv[2];
      const tv=s=>String(s||"").split(".").map(x=>parseInt(x,10)||0);
      const cmp=(a,b)=>{for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;};
      const covers=(range,w)=>{
        // "2026.2.5" | "2026.2.4 — 2026.2.5" | "build 252.28539 — 252.*"
        const parts=String(range||"").split(/—|–|\.\.\./).map(s=>s.trim()).filter(Boolean);
        if(!parts.length) return false;
        const nums=parts.map(p=>(p.match(/(\d+)\.(\d+)(?:\.(\d+))?/)||[])).filter(m=>m[1]);
        if(!nums.length) return false;
        const lo=tv(nums[0][1]+"."+nums[0][2]+"."+(nums[0][3]||0));
        const hi=nums[1]?tv(nums[1][1]+"."+nums[1][2]+"."+(nums[1][3]||0)):lo;
        return cmp(w,lo)>=0 && cmp(w,hi)<=0;
      };
      const j=JSON.parse(raw);
      const wv=tv(want);
      const hit=j.filter(u=>{
        const cv=u.compatibleVersions||{};
        const ok=Object.keys(cv).some(k=>/^IDEA/.test(k)&&covers(cv[k],wv));
        if(!ok) return false;
        const vb=tv(String(u.version||"").split(".")[0]);
        return vb[0]===tv(build)[0];   // 同一 build 分支
      });
      const pick=hit.sort((a,b)=>tv(String(b.version).split(".").join("."))[1]-tv(String(a.version).split(".").join("."))[1])[0];
      if(pick) console.log(pick.id+"\t"+pick.version+"\t"+pick.name);
    });' "$2" "$3"
}

# --- 读插件 descriptor 的顶层硬依赖 -------------------------------------------------
plugin_gates() { # <pluginId>
  local tmp; tmp="$(mktemp -d)"
  local zip="$tmp/p.zip" info
  info="$(resolve_update "$1" "$IDEA_VERSION" "$BUILD")" || true
  [ -n "$info" ] || { echo "  (Marketplace 上找不到匹配 build=$BUILD 的版本)"; rm -rf "$tmp"; return 1; }
  local uid ver name
  IFS=$'\t' read -r uid ver name <<< "$info"
  echo "  marketplace: id=$uid version=$ver name=$name"
  curl -sL "https://plugins.jetbrains.com/plugin/download?updateId=$uid" -o "$zip" || { rm -rf "$tmp"; return 1; }
  unzip -o -q "$zip" -d "$tmp/x" 2>/dev/null
  # 逐个 jar 找 META-INF/plugin.xml（含 IdeaPlugin.xml 这类异名）
  node -e '
    const fs=require("fs"),path=require("path");
    const root=process.argv[1];
    const walk=(d,out=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else if(e.name.endsWith(".jar"))out.push(p);}return out;};
    let root4=null, gates=[], caps=new Set();
    for(const jar of walk(root)){
      let z;try{z=require("child_process").execSync("unzip -p "+JSON.stringify(jar)+" \\"META-INF/*plugin.xml\\" 2>/dev/null||true",{encoding:"utf8",maxBuffer:1<<28});}catch(e){continue;}
      if(!z||!z.includes("<idea-plugin"))continue;
      const head=z.split(/<content\b/)[0];
      const deps=[...head.matchAll(/<plugin id="([^"]+)"\s*\/>/g)].map(m=>m[1]);
      const mods=[...head.matchAll(/<module name="([^"]+)"\s*\/>/g)].map(m=>m[1]);
      gates.push(...deps.filter(d=>/ultimate$|-capable$/.test(d)));
      caps.add(...mods);
      const id=(head.match(/<id>([^<]+)</)||[])[1];
      if(id) root4=id;
    }
    console.log("  插件 xmlId: "+(root4||"(未取到)"));
    console.log("  硬门禁依赖: "+(gates.length?[...new Set(gates)].join(", "):"(无)"));
  ' "$tmp/x"
  rm -rf "$tmp"
}

# --- 社区版平台提供哪些 capability 模块 -------------------------------------------
community_caps() {
  local jar="$IDEA_ROOT/lib/intellij.idea.community.customization.jar"
  [ -f "$jar" ] || { echo "  (找不到 $jar)"; return; }
  unzip -p "$jar" META-INF/IdeaPlugin.xml 2>/dev/null \
    | grep -o '<module value="[^"]*"' | sed 's/.*value="//;s/"//' | grep -E 'capable$' | sed 's/^/  提供: /'
}

case "$cmd" in
  gate)
    [ -n "$PLUGIN_ID" ] || { echo "usage: install-lang-plugin.sh gate <pluginId> [--idea-root <root>]" >&2; exit 2; }
    echo "[门禁] $PLUGIN_ID（IDE build=$BUILD）"
    plugin_gates "$PLUGIN_ID"
    echo "  社区版平台 capability 模块表："
    community_caps
    ;;
  install)
    [ -n "$PLUGIN_ID" ] || { echo "usage: install-lang-plugin.sh install <pluginId> [--idea-root <root>]" >&2; exit 2; }
    echo "[安装] $PLUGIN_ID → $CONFIG_DIR/plugins"
    info="$(resolve_update "$PLUGIN_ID" "$IDEA_VERSION" "$BUILD")" || true
    if [ -z "$info" ]; then echo "  ERROR: 没有匹配 build=$BUILD 的版本" >&2; exit 1; fi
    IFS=$'\t' read -r uid ver name <<< "$info"
    echo "  版本: $ver（updateId=$uid）"
    tmp="$(mktemp -d)"; zip="$tmp/p.zip"
    curl -sL "https://plugins.jetbrains.com/plugin/download?updateId=$uid" -o "$zip" || { echo "  ERROR: 下载失败" >&2; rm -rf "$tmp"; exit 1; }
    mkdir -p "$CONFIG_DIR/plugins"
    unzip -o -q "$zip" -d "$CONFIG_DIR/plugins" || { echo "  ERROR: 解压失败" >&2; rm -rf "$tmp"; exit 1; }
    rm -rf "$tmp"
    echo "  已解到 $CONFIG_DIR/plugins（顶层目录名保持 zip 原样）"
    echo "  下一步：重启 IDEA → install-lang-plugin.sh verify 看真实加载结论"
    ;;
  shim)
    [ $# -gt 0 ] || { echo "usage: install-lang-plugin.sh shim <capability> [...]" >&2; exit 2; }
    dir="$CONFIG_DIR/plugins/community-lang-caps"
    mkdir -p "$dir"
    python "$SKILL_DIR/scripts/lang-caps-shim.py" "$dir" "$@"
    echo "  下一步：重启 IDEA → install-lang-plugin.sh verify"
    ;;
  verify)
    log="$(cfg idea.logDir)/idea.log"
    [ -f "$log" ] || { echo "ERROR: 找不到 $log" >&2; exit 2; }
    echo "[最近一次启动的加载结论]"
    grep "Loaded custom plugins" "$log" | tail -1
    echo "--- 门禁类拒绝（最近一次启动的 Problems found loading plugins 段）---"
    # 取最后一段（用时间戳定位，避免读到旧会话的记录）
    # 同一次会话里，Problems 段出现在 "Loaded custom plugins" **之前**；
    # 当前会话的那一段 = 位于「上一次 Loaded 行」与「本次 Loaded 行」之间的最后一段
    hit="$(awk '
      /Loaded custom plugins/            { prev=last; last=NR }
      /Problems found loading plugins:/  { prob=NR }
      END { if (prob != "" && prob > prev && prob < last) print prob }
    ' "$log")"
    if [ -n "$hit" ]; then
      tail -n +"$hit" "$log" | awk 'NR>1 && /^2026-/ {exit} NR>1 && NF {print "  "$0}' | head -8
    else
      echo "  (本次启动无门禁拒绝)"
    fi
    echo "--- 语言被认出来的凭据（plugin detected via plugin ID）---"
    grep "plugin detected via plugin ID" "$log" | tail -6 | sed 's/^.*PluginDetector - /  /'
    ;;
  *)
    sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//;s/^#$//'
    exit 2;;
esac
