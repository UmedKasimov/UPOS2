"""Render the isolated Asterisk configuration without storing SIP secrets in git."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from string import Template


SOURCE = Path("/opt/upos-gateway/config")
ASTERISK = Path("/etc/asterisk")


def required(name: str, pattern: str | None = None) -> str:
    value = os.environ.get(name, "").strip()
    if not value or "\n" in value or "\r" in value or ";" in value or "#" in value:
        raise ValueError(f"Missing or invalid gateway setting: {name}")
    if pattern and not re.fullmatch(pattern, value):
        raise ValueError(f"Invalid gateway setting: {name}")
    return value


remote_host = required("UPOS_GATEWAY_REMOTE_HOST", r"[a-zA-Z0-9.-]+")
remote_port = required("UPOS_GATEWAY_REMOTE_PORT", r"[0-9]{2,5}")
remote_user = required("UPOS_GATEWAY_REMOTE_USER", r"[a-zA-Z0-9_+.-]+")
remote_auth = required("UPOS_GATEWAY_REMOTE_AUTH", r"[a-zA-Z0-9_+.-]+")
remote_password = required("UPOS_GATEWAY_REMOTE_PASSWORD")
browser_password = required("UPOS_GATEWAY_BROWSER_PASSWORD")
public_ip = required("UPOS_GATEWAY_PUBLIC_IP", r"[0-9.]+")
register = os.environ.get("UPOS_GATEWAY_REGISTER") == "1"

registration = ""
if register:
    registration = f"""
[provider-registration]
type=registration
transport=transport-udp
outbound_auth=provider-auth
server_uri=sip:{remote_host}:{remote_port}
client_uri=sip:{remote_user}@{remote_host}
contact_user={remote_user}
retry_interval=30
forbidden_retry_interval=300
expiration=300
"""

values = {
    "REMOTE_HOST": remote_host,
    "REMOTE_PORT": remote_port,
    "REMOTE_USER": remote_user,
    "REMOTE_AUTH": remote_auth,
    "REMOTE_PASSWORD": remote_password,
    "BROWSER_PASSWORD": browser_password,
    "PUBLIC_IP": public_ip,
    "REGISTRATION": registration,
}
for name in ("pjsip.conf", "extensions.conf", "http.conf", "rtp.conf"):
    source = (SOURCE / name).read_text(encoding="utf-8")
    output = Template(source).substitute(values) if name == "pjsip.conf" else source
    target = ASTERISK / name
    target.write_text(output, encoding="utf-8")
    target.chmod(0o600 if name == "pjsip.conf" else 0o644)

# Ubuntu's package autoloads the legacy chan_sip driver on UDP 5060. The
# directive must be inside [modules], before the stock file's [global] block.
modules_path = ASTERISK / "modules.conf"
modules_config = modules_path.read_text(encoding="utf-8")
if "[modules]" not in modules_config:
    raise RuntimeError("Asterisk modules.conf has no [modules] section")
modules_path.write_text(
    modules_config.replace("[modules]", "[modules]\nnoload => chan_sip.so", 1),
    encoding="utf-8",
)

print("UPOS SIP gateway configuration ready; provider registration " + ("enabled" if register else "disabled"), flush=True)
subprocess.run(["/usr/sbin/asterisk", "-f", "-vvv"], check=True)
