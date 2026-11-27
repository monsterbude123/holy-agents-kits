#!/usr/bin/env bash
# Coverage report via JaCoCo inside the project devcontainer (the project's real test runtime).
# Usage: scripts/jacoco-report.sh [moduleTestArgs]     # default: full `mvn test`
# Runs mvn test with the JaCoCo agent, generates target/site/jacoco/jacoco.xml, and prints
# an overall summary plus the classes with the LOWEST line coverage (the quality signal).
set -u
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "help" ]; then
  sed -n '2,/^[^#]/p' "$0" | sed 's/^# \{0,1\}//' | sed '/^$/d'; exit 0
fi
# devcontainer 容器名因项目而异（docker ps 查真实名）；未传 DEVCONTAINER 直接报错退出，不猜默认名
CTR="${DEVCONTAINER:-}"
if [ -z "$CTR" ]; then
  echo "错误：请用 DEVCONTAINER=<容器名> 传入 devcontainer 容器名（docker ps 查）" >&2
  exit 2
fi
TEST_ARGS="${1:-}"
JACOCO_VER="${JACOCO_VER:-0.8.12}"

docker exec -u vscode "$CTR" bash -lc "cd /workspace && mvn -q test $TEST_ARGS org.jacoco:jacoco-maven-plugin:$JACOCO_VER:prepare-agent org.jacoco:jacoco-maven-plugin:$JACOCO_VER:report" || {
  echo "ERROR: mvn/jacoco run failed (container: $CTR)"; exit 1; }

docker exec -u vscode "$CTR" bash -lc "cd /workspace && node -e '
const fs=require(\"fs\");
const x=fs.readFileSync(\"target/site/jacoco/jacoco.xml\",\"utf8\");
const counters=(e)=>{const c={};for(const m of e.matchAll(/<(INSTRUCTION|BRANCH|LINE)[^>]*mis=\"(\d+)\" covered=\"(\d+)\"/g))c[m[1]]={mis:+m[2],cov:+m[3]};return c};
const pkgRe=/<package name=\"([^\"]+)\"[^>]*>((?:[\s\S](?!</package>))*)<\/package>/g;
const rows=[];let pm;
while((pm=pkgRe.exec(x))){const pk=pm[1];const clsRe=/<class name=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/class>/g;let cm;
 while((cm=clsRe.exec(pm[2]))){const c=counters(cm[2]);if(c.LINE){rows.push({cls:pk+\".\"+cm[1],line:c.LINE})}}}
const all=counters(x.match(/<counter[^>]*type=\"LINE\"[^>]*\/>/g).join(\"\").match(/<counter[^>]*type=\"LINE\"[^>]*\/>/)[0]);
const lineC=x.match(/<counter type=\"LINE\"[^>]*mis=\"(\d+)\" covered=\"(\d+)\"\/>\s*<\/report>/);
if(lineC){const mis=+lineC[1],cov=+lineC[2];const pct=(100*cov/(mis+cov)).toFixed(1);
 console.log(\"OVERALL line coverage: \"+pct+\"% (\"+cov+\"/\"+(mis+cov)+\")\")}
rows.sort((a,b)=>(a.line.cov/(a.line.cov+a.line.mis))-(b.line.cov/(b.line.cov+b.line.mis)));
console.log(\"lowest-covered classes:\");
rows.slice(0,15).forEach(r=>{const t=r.line.cov+r.line.mis;console.log(\"  \"+(t?((100*r.line.cov/t).toFixed(0)+\"%\"):\"0%\")+\"  \"+r.cls)});
' "
