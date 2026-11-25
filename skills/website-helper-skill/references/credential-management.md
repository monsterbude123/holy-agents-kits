# 凭据管理（最敏感章节）

**核心原则**：`.env` 里的真实值**永远不要**出现在对话 / 截图 / 日志中。

---

## 5.1 用户要新建 / 轮换 AccessKey

1. 让用户去 https://ram.console.aliyun.com/manage/ak **自己操作**
2. 提示：RAM 用户的 AccessKey Secret **只显示一次**，复制后妥善保存
3. 让用户**自己**编辑 `.env`；**不要**让用户把 secret 贴回对话
4. 用户确认改完后，跑 `publish config init` 重载

---

## 5.2 用户要改 SSH 密码

1. 让用户自己到 ECS 控制台**重置密码**
2. 提示：等 30 秒让 ECS 同步
3. 用户自己更新 `.env` 的 `SSH_PASSWORD`（**不要**把密码贴到对话）
4. `publish config init` 重载

---

## 5.3 `publish config show` 的输出

**当前实现风险**：`config show` 可能在 show 里打印明文密码。

**建议改 `src/config/store.py` 的 `save_*` 加 mask**，或 `config_show` 命令自己 mask 输出 `*`。

修复示意（伪代码）：
```python
def masked_config(cfg):
    return {
        **cfg.__dict__,
        "password": "****" if cfg.password else None,
    }
```

---

## 5.4 紧急情况：用户已暴露 secret

如果用户不小心把 secret 贴到了对话：

1. **立即**告诉用户该 secret 视为泄露
2. 让用户去对应控制台**禁用 + 重置**
3. 不要再重复 secret 值
4. 提示用户**同时**检查 `.env` 是否在 git 历史里：
   ```powershell
   git log --all --full-history -- .env
   ```
   如果有，需要清理（`git filter-branch` / BFG），但这会改写历史
5. 强烈建议以后使用密钥文件（`SSH_KEY_PATH`）而非密码

---

## 5.5 `.env` 与 `.env.example` 边界

| 文件 | 内容 | 可提交 |
|------|------|--------|
| `.env.example` | **空值模板**，注释说明每个字段 | ✅ 是 |
| `.env` | 真实 secret | ❌ 已在 `.gitignore` |

**强制规则**：
- 任何 PR / commit 里**永远不要**出现 `.env`
- `.env.example` 里**永远不要**出现真实值（连测试 fake value 也不行）
- 引导用户复制 `.env.example` 为 `.env`，再填值：
  ```powershell
  copy .env.example .env
  notepad .env
  ```
