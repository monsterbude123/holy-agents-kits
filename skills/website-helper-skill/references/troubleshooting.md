# 故障排查

## 4.1 emoji 崩（UnicodeEncodeError）

PowerShell 默认 cp1252 会导致 emoji 报错。

**临时**：
```powershell
$env:PYTHONIOENCODING = "utf-8"
publish config init
```

**永久**：确保 `publish/cli.py` 有 Windows UTF-8 reconfigure 块。

---

## 4.2 AccessKey Secret 错

服务端返回 `InvalidAccessKeySecret`。

1. 去对应 DNS 提供商控制台核对 secret
2. **不要**把 secret 贴到对话
3. 更新 `.env` 后 `publish config init`

---

## 4.3 RAM 权限不足（阿里云）

服务端返回 `Forbidden.RAM`。

**最小权限 JSON**：

```json
{
  "Version": "1",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "alidns:DescribeDomainRecords",
      "alidns:AddDomainRecord",
      "alidns:UpdateDomainRecord",
      "alidns:DeleteDomainRecord",
      "alidns:DescribeDomains"
    ],
    "Resource": "acs:alidns:*:*:domain/<主域>"
  }]
}
```

---

## 4.4 nginx 没装

云机器返回 `nginx: command not found`。

**自动**：
```bash
cd <项目目录>
bash $SKILL_DIR/scripts/install-server.sh
```

**手动**（Ubuntu/Debian）：
```bash
ssh root@<IP>
DEBIAN_FRONTEND=noninteractive apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx
```

---

## 4.5 SSL 失败：DNS 还没传播

等待 5-30 分钟：
```powershell
nslookup <sub>.<domain> 8.8.8.8
```
看到正确 IP 后：
```powershell
publish cert renew <sub>.<domain>
```

---

## 4.6 浏览器连接拒绝

云厂商安全组需放行 80/443。

阿里云：ECS 控制台 → 安全组 → 入方向：
- `80/80`   TCP, `0.0.0.0/0`
- `443/443` TCP, `0.0.0.0/0`
