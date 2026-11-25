"""Nginx server block config generator."""

NGINX_TEMPLATE = """server {{
    listen 80;
    listen [::]:80;

    server_name {server_name};

    root {webroot};
    index index.html index.htm;

    location / {{
        try_files $uri $uri/ =404;
    }}

    # Logs
    access_log /var/log/nginx/{server_name}-access.log;
    error_log /var/log/nginx/{server_name}-error.log;
}}
"""

NGINX_SSL_TEMPLATE = """server {{
    listen 80;
    listen [::]:80;
    server_name {server_name};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {server_name};

    ssl_certificate     /etc/letsencrypt/live/{server_name}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{server_name}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root {webroot};
    index index.html index.htm;

    location / {{
        try_files $uri $uri/ =404;
    }}

    access_log /var/log/nginx/{server_name}-access.log;
    error_log /var/log/nginx/{server_name}-error.log;
}}
"""


def generate_server_block(subdomain: str, webroot: str, with_ssl: bool = False) -> str:
    """Generate Nginx server block configuration."""
    template = NGINX_SSL_TEMPLATE if with_ssl else NGINX_TEMPLATE
    return template.format(server_name=subdomain, webroot=webroot)


# VR-009: 反代模式。WebSocket upgrade 头与 100M body 来自禅道实战（附件上传 + 实时终端）。
PROXY_LOCATION = """    location / {{
        proxy_pass {upstream};
        proxy_http_version 1.1;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        client_max_body_size 100M;
    }}
"""

PROXY_TEMPLATE = """server {{
    listen 80;
    listen [::]:80;

    server_name {server_name};

{location}
    access_log /var/log/nginx/{server_name}-access.log;
    error_log /var/log/nginx/{server_name}-error.log;
}}
"""

PROXY_SSL_TEMPLATE = """server {{
    listen 80;
    listen [::]:80;
    server_name {server_name};
    return 301 https://$host$request_uri;
}}

server {{
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {server_name};

    ssl_certificate     /etc/letsencrypt/live/{server_name}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{server_name}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

{location}
    access_log /var/log/nginx/{server_name}-access.log;
    error_log /var/log/nginx/{server_name}-error.log;
}}
"""


def generate_proxy_server_block(
    subdomain: str, upstream: str, with_ssl: bool = False
) -> str:
    """VR-009: Generate reverse-proxy server block (upstream must be pre-validated)."""
    template = PROXY_SSL_TEMPLATE if with_ssl else PROXY_TEMPLATE
    return template.format(
        server_name=subdomain, location=PROXY_LOCATION.format(upstream=upstream)
    )


def validate_nginx_config(ssh_client) -> tuple[bool, str]:
    """Run 'nginx -t' on the remote host. Returns (ok, output)."""
    exit_code, stdout, stderr = ssh_client.exec_command("nginx -t")
    output = stdout + stderr
    return exit_code == 0, output
