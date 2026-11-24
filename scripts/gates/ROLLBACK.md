# 回滚锚点登记 —— phase 05（harness 基石层门禁闭环）

> **为什么有这份文件**：05-01 用「index 存改造前内容」当基线，提交同一路径后 index 被覆盖 ⇒ **基线被吞**，
> `git checkout -- <file>` 取回的已是改造后内容。这就是 G-05-04 的根因。
> 本文件是修法：**锚点逐路径显式写下**，并用 ref 钉住，不依赖 index、不依赖悬空 blob。

## 三类锚点

- **`82330ee:<path>`** —— phase 前提交（05-01 改过内容的那几条）
- **`cd2c9d3:<path>`** —— 05-01 交付提交（phase 前就存在、且 05-01 未改内容的那几条）
- **`refs/mm-gsd/rollback-05:<path>`** —— 本 phase 造的 ref（钉住 phase 前是 untracked 工作区内容的那几条 + 悬空 blob `35361d49`）
- **不存在** —— phase 前没有该路径 ⇒ 恢复动作是**删除**

**恢复命令**：锚点 = `<rev或ref>:<path>` ⇒ `git checkout <rev或ref> -- <path>`；锚点 = `不存在` ⇒ 删除该路径。

## 表 A · 回退整个 phase 05（05-01 + 05-02/03/04）到 phase 之前

| 路径 | 锚点 | 改造前标记 | 恢复命令 |
|---|---|---|---|
| `package.json` | `82330ee:package.json` | `python skills/skill-creator-v2/scripts/validate_skill.py --all --root .` | `git checkout 82330ee -- package.json` |
| `scripts/gates/EXCEPTIONS.md` | `不存在` | — | `删除该路径` |
| `scripts/gates/ROLLBACK.md` | `不存在` | — | `删除该路径` |
| `scripts/gates/harness-check.mjs` | `cd2c9d3:scripts/gates/harness-check.mjs` | — | `git checkout cd2c9d3 -- scripts/gates/harness-check.mjs` |
| `scripts/gates/install-hooks.mjs` | `cd2c9d3:scripts/gates/install-hooks.mjs` | — | `git checkout cd2c9d3 -- scripts/gates/install-hooks.mjs` |
| `scripts/gates/pre-commit` | `cd2c9d3:scripts/gates/pre-commit` | — | `git checkout cd2c9d3 -- scripts/gates/pre-commit` |
| `scripts/gates/standards.json` | `cd2c9d3:scripts/gates/standards.json` | — | `git checkout cd2c9d3 -- scripts/gates/standards.json` |
| `skills/idea-backend/references/audit-fix-playbook.md` | `82330ee:skills/idea-backend/references/audit-fix-playbook.md` | `ts-web.md` | `git checkout 82330ee -- skills/idea-backend/references/audit-fix-playbook.md` |
| `skills/rules-layer-governance/references/gate-authoring.md` | `82330ee:skills/rules-layer-governance/references/gate-authoring.md` | — | `git checkout 82330ee -- skills/rules-layer-governance/references/gate-authoring.md` |
| `skills/rules-layer-governance/templates/check-dead-refs.sh` | `82330ee:skills/rules-layer-governance/templates/check-dead-refs.sh` | `SELFTEST PASS` | `git checkout 82330ee -- skills/rules-layer-governance/templates/check-dead-refs.sh` |
| `skills/session-distiller/SKILL.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/SKILL.md` | `≤350 行` | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/SKILL.md` |
| `skills/session-distiller/references/apology-diagnosis.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/references/apology-diagnosis.md` | — | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/references/apology-diagnosis.md` |
| `skills/session-distiller/references/distillation-methodology.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/references/distillation-methodology.md` | — | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/references/distillation-methodology.md` |
| `skills/session-distiller/references/emotional-neutralizer.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/references/emotional-neutralizer.md` | `§2.5 温度值(Temperature)` | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/references/emotional-neutralizer.md` |
| `skills/session-distiller/references/skill-dedup.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/references/skill-dedup.md` | `会话主题指纹` | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/references/skill-dedup.md` |
| `skills/skill-creator-v2/SKILL.md` | `82330ee:skills/skill-creator-v2/SKILL.md` | — | `git checkout 82330ee -- skills/skill-creator-v2/SKILL.md` |
| `skills/skill-creator-v2/evals/evals.json` | `cd2c9d3:skills/skill-creator-v2/evals/evals.json` | — | `git checkout cd2c9d3 -- skills/skill-creator-v2/evals/evals.json` |
| `skills/skill-creator-v2/evals/run-evals.mjs` | `不存在` | — | `删除该路径` |
| `skills/skill-creator-v2/references/schemas.md` | `82330ee:skills/skill-creator-v2/references/schemas.md` | — | `git checkout 82330ee -- skills/skill-creator-v2/references/schemas.md` |
| `skills/skill-creator-v2/scripts/skill_schema.py` | `82330ee:skills/skill-creator-v2/scripts/skill_schema.py` | `DEFAULT_SKILL_MD_MAX_LINES = 150` | `git checkout 82330ee -- skills/skill-creator-v2/scripts/skill_schema.py` |
| `skills/vibe-coding-standards/SKILL.md` | `cd2c9d3:skills/vibe-coding-standards/SKILL.md` | `100~350` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/SKILL.md` |
| `skills/vibe-coding-standards/references/VibeCodingStandards.md` | `cd2c9d3:skills/vibe-coding-standards/references/VibeCodingStandards.md` | `100~350` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/references/VibeCodingStandards.md` |
| `skills/vibe-coding-standards/references/rule-writing-craft.md` | `cd2c9d3:skills/vibe-coding-standards/references/rule-writing-craft.md` | `2026-08-14/external-report.md` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/references/rule-writing-craft.md` |
| `skills/vibe-coding-standards/references/skill-dependency-check.md` | `cd2c9d3:skills/vibe-coding-standards/references/skill-dependency-check.md` | `2026-08-14/external-report.md` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/references/skill-dependency-check.md` |
| `skills/vibe-coding-standards/references/skill-script-paths.md` | `cd2c9d3:skills/vibe-coding-standards/references/skill-script-paths.md` | `2026-08-14/external-report.md` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/references/skill-script-paths.md` |
| `skills/vibe-coding-standards/scripts/validate_vibe_docs.sh` | `refs/mm-gsd/rollback-05:skills/vibe-coding-standards/scripts/validate_vibe_docs.sh` | `TH_MAP=300` | `git checkout refs/mm-gsd/rollback-05 -- skills/vibe-coding-standards/scripts/validate_vibe_docs.sh` |
| `skills/website-helper-skill/README.md` | `refs/mm-gsd/rollback-05:skills/website-helper-skill/README.md` | `≤ 350 行` | `git checkout refs/mm-gsd/rollback-05 -- skills/website-helper-skill/README.md` |
| `skills/website-helper-skill/SKILL.md` | `refs/mm-gsd/rollback-05:skills/website-helper-skill/SKILL.md` | `docs/limitations.md` | `git checkout refs/mm-gsd/rollback-05 -- skills/website-helper-skill/SKILL.md` |
| `skills/website-helper-skill/docs/usage.md` | `refs/mm-gsd/rollback-05:skills/website-helper-skill/docs/usage.md` | — | `git checkout refs/mm-gsd/rollback-05 -- skills/website-helper-skill/docs/usage.md` |

## 表 B · 只回退本次修复（05-02/03/04）到 05-01 交付提交

| 路径 | 锚点 | 改造前标记 | 恢复命令 |
|---|---|---|---|
| `package.json` | `cd2c9d3:package.json` | `node scripts/gates/harness-check.mjs` | `git checkout cd2c9d3 -- package.json` |
| `scripts/gates/EXCEPTIONS.md` | `不存在` | — | `删除该路径` |
| `scripts/gates/ROLLBACK.md` | `不存在` | — | `删除该路径` |
| `scripts/gates/harness-check.mjs` | `cd2c9d3:scripts/gates/harness-check.mjs` | — | `git checkout cd2c9d3 -- scripts/gates/harness-check.mjs` |
| `scripts/gates/install-hooks.mjs` | `cd2c9d3:scripts/gates/install-hooks.mjs` | — | `git checkout cd2c9d3 -- scripts/gates/install-hooks.mjs` |
| `scripts/gates/pre-commit` | `cd2c9d3:scripts/gates/pre-commit` | — | `git checkout cd2c9d3 -- scripts/gates/pre-commit` |
| `scripts/gates/standards.json` | `cd2c9d3:scripts/gates/standards.json` | — | `git checkout cd2c9d3 -- scripts/gates/standards.json` |
| `skills/idea-backend/references/audit-fix-playbook.md` | `cd2c9d3:skills/idea-backend/references/audit-fix-playbook.md` | `ts-web.md` | `git checkout cd2c9d3 -- skills/idea-backend/references/audit-fix-playbook.md` |
| `skills/rules-layer-governance/references/gate-authoring.md` | `cd2c9d3:skills/rules-layer-governance/references/gate-authoring.md` | — | `git checkout cd2c9d3 -- skills/rules-layer-governance/references/gate-authoring.md` |
| `skills/rules-layer-governance/templates/check-dead-refs.sh` | `cd2c9d3:skills/rules-layer-governance/templates/check-dead-refs.sh` | `load_harness_standards` | `git checkout cd2c9d3 -- skills/rules-layer-governance/templates/check-dead-refs.sh` |
| `skills/session-distiller/SKILL.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/SKILL.md` | `≤350 行` | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/SKILL.md` |
| `skills/session-distiller/references/apology-diagnosis.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/references/apology-diagnosis.md` | — | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/references/apology-diagnosis.md` |
| `skills/session-distiller/references/distillation-methodology.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/references/distillation-methodology.md` | — | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/references/distillation-methodology.md` |
| `skills/session-distiller/references/emotional-neutralizer.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/references/emotional-neutralizer.md` | `§2.5 温度值(Temperature)` | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/references/emotional-neutralizer.md` |
| `skills/session-distiller/references/skill-dedup.md` | `refs/mm-gsd/rollback-05:skills/session-distiller/references/skill-dedup.md` | `会话主题指纹` | `git checkout refs/mm-gsd/rollback-05 -- skills/session-distiller/references/skill-dedup.md` |
| `skills/skill-creator-v2/SKILL.md` | `cd2c9d3:skills/skill-creator-v2/SKILL.md` | — | `git checkout cd2c9d3 -- skills/skill-creator-v2/SKILL.md` |
| `skills/skill-creator-v2/evals/evals.json` | `cd2c9d3:skills/skill-creator-v2/evals/evals.json` | — | `git checkout cd2c9d3 -- skills/skill-creator-v2/evals/evals.json` |
| `skills/skill-creator-v2/evals/run-evals.mjs` | `不存在` | — | `删除该路径` |
| `skills/skill-creator-v2/references/schemas.md` | `cd2c9d3:skills/skill-creator-v2/references/schemas.md` | — | `git checkout cd2c9d3 -- skills/skill-creator-v2/references/schemas.md` |
| `skills/skill-creator-v2/scripts/skill_schema.py` | `cd2c9d3:skills/skill-creator-v2/scripts/skill_schema.py` | `load_harness_standards` | `git checkout cd2c9d3 -- skills/skill-creator-v2/scripts/skill_schema.py` |
| `skills/vibe-coding-standards/SKILL.md` | `cd2c9d3:skills/vibe-coding-standards/SKILL.md` | `100~350` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/SKILL.md` |
| `skills/vibe-coding-standards/references/VibeCodingStandards.md` | `cd2c9d3:skills/vibe-coding-standards/references/VibeCodingStandards.md` | `100~350` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/references/VibeCodingStandards.md` |
| `skills/vibe-coding-standards/references/rule-writing-craft.md` | `cd2c9d3:skills/vibe-coding-standards/references/rule-writing-craft.md` | `2026-08-14/external-report.md` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/references/rule-writing-craft.md` |
| `skills/vibe-coding-standards/references/skill-dependency-check.md` | `cd2c9d3:skills/vibe-coding-standards/references/skill-dependency-check.md` | `2026-08-14/external-report.md` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/references/skill-dependency-check.md` |
| `skills/vibe-coding-standards/references/skill-script-paths.md` | `cd2c9d3:skills/vibe-coding-standards/references/skill-script-paths.md` | `2026-08-14/external-report.md` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/references/skill-script-paths.md` |
| `skills/vibe-coding-standards/scripts/validate_vibe_docs.sh` | `cd2c9d3:skills/vibe-coding-standards/scripts/validate_vibe_docs.sh` | `load_harness_standards` | `git checkout cd2c9d3 -- skills/vibe-coding-standards/scripts/validate_vibe_docs.sh` |
| `skills/website-helper-skill/README.md` | `refs/mm-gsd/rollback-05:skills/website-helper-skill/README.md` | `≤ 350 行` | `git checkout refs/mm-gsd/rollback-05 -- skills/website-helper-skill/README.md` |
| `skills/website-helper-skill/SKILL.md` | `refs/mm-gsd/rollback-05:skills/website-helper-skill/SKILL.md` | `docs/limitations.md` | `git checkout refs/mm-gsd/rollback-05 -- skills/website-helper-skill/SKILL.md` |
| `skills/website-helper-skill/docs/usage.md` | `refs/mm-gsd/rollback-05:skills/website-helper-skill/docs/usage.md` | — | `git checkout refs/mm-gsd/rollback-05 -- skills/website-helper-skill/docs/usage.md` |

## 已知限制

- **ref 是本地锚点**：`refs/mm-gsd/rollback-05` 不随 clone / push 传播；换机器或重建仓时，表 A 里 ref 组的锚点会失效。
  仓内**可移植**的记录是本文件的表格本身（路径 + 锚点 + 改造前标记）；等 phase 06/07 把两个 untracked 技能入库后，
  那时的 commit 才是可移植的锚点。
- **ref 组的内容**：`skills/session-distiller/` 与 `skills/website-helper-skill/` 下的文件在 phase 前是 untracked 工作区内容，
  其 blob 由 05-03 动手前 `git hash-object -w` 取得并装进 ref 树；`skills/vibe-coding-standards/scripts/validate_vibe_docs.sh`
  的 phase 前版本是悬空 blob `35361d49`（05-01 提交后不再可达），已一并装进 ref 树。
