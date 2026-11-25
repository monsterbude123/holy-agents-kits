"""Abstract DNS provider base and provider implementations."""

from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx


@dataclass
class DnsRecord:
    id: str
    name: str
    record_type: str
    content: str


class AbstractDnsProvider(ABC):
    """Abstract base for DNS providers."""

    @abstractmethod
    def create_record(self, subdomain: str, ip: str) -> DnsRecord:
        """Create DNS A record. Returns the created record."""

    @abstractmethod
    def get_record(self, subdomain: str) -> DnsRecord | None:
        """Get existing DNS A record for subdomain, or None."""


class CloudflareProvider(AbstractDnsProvider):
    """Cloudflare DNS provider."""

    BASE_URL = "https://api.cloudflare.com/client/v4"

    def __init__(self, api_token: str, zone_id: str):
        self._token = api_token
        self._zone_id = zone_id
        self._client = httpx.Client(
            base_url=self.BASE_URL,
            headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
        )

    def create_record(self, subdomain: str, ip: str) -> DnsRecord:
        # Check existing first (idempotent)
        existing = self.get_record(subdomain)
        if existing:
            if existing.content == ip:
                return existing  # same IP, skip
            raise ValueError(
                f"DNS 记录已存在但指向不同 IP ({existing.content})，"
                f"使用 --force 覆盖或手动删除后重试"
            )

        resp = self._client.post(
            f"/zones/{self._zone_id}/dns_records",
            json={"type": "A", "name": subdomain, "content": ip, "ttl": 120, "proxied": False},
        )
        resp.raise_for_status()
        data = resp.json()
        if not data.get("success"):
            raise RuntimeError(f"Cloudflare API 错误: {data.get('errors')}")
        record = data["result"]
        return DnsRecord(
            id=record["id"], name=record["name"], record_type=record["type"], content=record["content"]
        )

    def get_record(self, subdomain: str) -> DnsRecord | None:
        resp = self._client.get(
            f"/zones/{self._zone_id}/dns_records",
            params={"type": "A", "name": subdomain},
        )
        resp.raise_for_status()
        data = resp.json()
        records = data.get("result", [])
        if records:
            r = records[0]
            return DnsRecord(id=r["id"], name=r["name"], record_type=r["type"], content=r["content"])
        return None


class AliyunProvider(AbstractDnsProvider):
    """Aliyun DNS provider using aliyun-python-sdk-alidns (legacy SDK).

    We use the legacy `aliyun-python-sdk-core` SDK because its `AcsClient`
    implements the V1 signature scheme (HMAC-SHA1 with all the encoding
    details) that alidns's older API still accepts. The newer
    `alibabacloud-alidns20150109` SDK defaults to V3 (ACS3-HMAC-SHA256) which
    requires a credentials provider object setup that's brittle to wire.
    """

    def __init__(self, access_key_id: str, access_key_secret: str, domain: str):
        from aliyunsdkcore.client import AcsClient

        self._ak_id = access_key_id
        self._ak_secret = access_key_secret
        self._domain = domain
        self._client = AcsClient(access_key_id, access_key_secret, "cn-hangzhou")

    def _rr(self, subdomain: str) -> str:
        """Extract the host record (RR) from a fully-qualified subdomain."""
        suffix = "." + self._domain
        if not subdomain.endswith(suffix):
            raise ValueError(f"子域名 {subdomain} 不属于主域 {self._domain}")
        return subdomain[: -len(suffix)]

    def create_record(self, subdomain: str, ip: str) -> DnsRecord:
        from aliyunsdkalidns.request.v20150109 import AddDomainRecordRequest

        existing = self.get_record(subdomain)
        if existing:
            if existing.content == ip:
                return existing
            raise ValueError(
                f"DNS 记录已存在但指向不同 IP ({existing.content})，"
                f"使用 --force 覆盖或手动删除后重试"
            )

        request = AddDomainRecordRequest.AddDomainRecordRequest()
        request.set_DomainName(self._domain)
        request.set_RR(self._rr(subdomain))
        request.set_Type("A")
        request.set_Value(ip)
        request.set_TTL("600")
        response = self._client.do_action_with_exception(request)
        import json
        data = json.loads(response)
        return DnsRecord(
            id=data["RecordId"],
            name=subdomain,
            record_type="A",
            content=ip,
        )

    def get_record(self, subdomain: str) -> DnsRecord | None:
        from aliyunsdkalidns.request.v20150109 import DescribeDomainRecordsRequest

        request = DescribeDomainRecordsRequest.DescribeDomainRecordsRequest()
        request.set_DomainName(self._domain)
        request.set_RRKeyWord(self._rr(subdomain))
        request.set_TypeKeyWord("A")
        response = self._client.do_action_with_exception(request)
        import json
        data = json.loads(response)
        records = data.get("DomainRecords", {}).get("Record", [])
        if records:
            r = records[0]
            return DnsRecord(
                id=r["RecordId"],
                name=subdomain,
                record_type="A",
                content=r["Value"],
            )
        return None

    def delete_record(self, subdomain: str) -> bool:
        from aliyunsdkalidns.request.v20150109 import DeleteDomainRecordRequest

        existing = self.get_record(subdomain)
        if not existing:
            return False
        request = DeleteDomainRecordRequest.DeleteDomainRecordRequest()
        request.set_RecordId(existing.id)
        self._client.do_action_with_exception(request)
        return True


class DnspodProvider(AbstractDnsProvider):
    """DNSPod (Tencent Cloud) DNS provider — 未实现，构造即拒绝。

    shortcut: 腾讯云 API 3.0 需要 TC3-HMAC-SHA256 签名，本技能没实现；
    无签名的请求只会拿到 401。补签名是唯一正确解，不要改成静默忽略。
    """

    BASE_URL = "https://dnspod.tencentcloudapi.com"

    def __init__(self, secret_id: str, secret_key: str, domain: str):
        raise NotImplementedError(
            "DNSPod 发布尚未实现（缺 TC3-HMAC-SHA256 签名，请求会被拒 401）。"
            "请改用 DNS_PROVIDER=cloudflare 或 aliyun。"
        )

    def create_record(self, subdomain: str, ip: str) -> DnsRecord:
        existing = self.get_record(subdomain)
        if existing:
            if existing.content == ip:
                return existing
            raise ValueError(
                f"DNS 记录已存在但指向不同 IP ({existing.content})，"
                f"使用 --force 覆盖或手动删除后重试"
            )

        hostname = subdomain.rsplit("." + self._domain, 1)[0]
        body = {
            "Domain": self._domain,
            "SubDomain": hostname,
            "RecordType": "A",
            "RecordLine": "默认",
            "Value": ip,
            "TTL": 600,
        }
        headers = {"Content-Type": "application/json"}
        resp = self._client.post(self.BASE_URL, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()
        record_id = str(data.get("Response", {}).get("RecordId", ""))
        return DnsRecord(id=record_id, name=subdomain, record_type="A", content=ip)

    def get_record(self, subdomain: str) -> DnsRecord | None:
        hostname = subdomain.rsplit("." + self._domain, 1)[0]
        body = {"Domain": self._domain, "Subdomain": hostname, "RecordType": "A"}
        headers = {"Content-Type": "application/json"}
        resp = self._client.post(self.BASE_URL, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()
        records = data.get("Response", {}).get("RecordList", [])
        if records:
            r = records[0]
            return DnsRecord(
                id=str(r.get("RecordId", "")), name=subdomain, record_type="A", content=r["Value"]
            )
        return None
