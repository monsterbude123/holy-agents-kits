# 演进日志与升级协议（generic-storage-sync）

> 本技能是**独立技能**，与仓库管家 `github-kownledge-helper` 物理隔离、零代码耦合。
> 本文件记录本技能的结构性演进；设计规格见 [SPEC.md](../SPEC.md)，安全红线见 [rules.md](rules.md)。

---

## 1. 何时必须升级本技能

- 新增 / 修改存储介质类型（`sftp` / `smb` / `baidu` / `quark` 接入）
- 改动索引 schema（`index_store.mjs` 的实体字段或索引结构）
- 改动两阶段提交语义或生命周期淘汰策略
- 沉淀新的踩坑与排障经验
- 用户显式要求升级

**不归本技能**：git 业务（clone / pull / commit log / 文档抽取）——那是仓库管家的职责。

---

## 2. 升级纪律

1. **先更新 SPEC.md**（设计变了先改设计，再改代码）。
2. **再更新代码 + 单测**（`node:test`，先红后绿）。
3. **同步 references**：`rules.md`（红线）/ `storage-design.md`（物理设计）/ `commands.md`（命令）/ `driver-spi.md`（对外契约）。
4. **本文件演进日志 +1 条**。
5. **仓库根 `CHANGELOG.md` +1 条**。
6. **门禁过检**：`python ~/.agents/skills/skill-creator-v2/scripts/validate_skill.py .agents/skills/generic-storage-sync` → **0 error 0 warn**。

### 升级回执格式

`已升级 · 沉淀到 references/<file> §NN · CHANGELOG+1 · 演进日志+1`

---

## 3. 禁止事项

- ❌ 破坏「物理删除只发生在 `clean-trash --yes`」红线。
- ❌ 让驱动层自定义索引 schema（schema 唯一事实源是 `index_store.mjs`）。
- ❌ 整文件读入内存做传输或校验。
- ❌ 用 `node:path` 的 `join` 拼远端路径（会压掉 UNC 前缀）。
- ❌ 在文档与代码中硬编码本机绝对路径。
- ❌ 引入 npm 依赖或编译步骤。
- ❌ 升级不写 CHANGELOG / 演进日志。

---

## 4. 演进日志

| 日期 | 任务摘要 | 沉淀位置 |
| --- | --- | --- |
| 2026-11-28 | 技能全量落地：索引 ORM、驱动 SPI + 本地盘驱动、Git Bundle 打包、两阶段提交协调器、四阶生命周期清理、驱动合规套件、统一 CLI；19 张工单全部闭环（103 用例全绿，门禁 0 error 0 warn） | SKILL.md + references/*.md + scripts/ |
| 2026-11-28 | 跨技能接入：`github-kownledge-helper` 的 workflows.md §7 增加存储归档调用协议；rules.md §8 固化两技能职责边界 | 技能 github-kownledge-helper 的 references/workflows.md + references/rules.md |
| 2026-11-27 | 技能骨架落地：SPEC.md / TICKETS.md / .env.example / scripts/env.mjs | SPEC.md + TICKETS.md |
