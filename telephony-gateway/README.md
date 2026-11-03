# U-POS SIP gateway

This optional Asterisk service bridges the provider's UDP SIP account to
U-POS browser clients over WebRTC/WSS. It is disabled until explicitly
configured on the server. No SIP passwords belong in this repository.

The gateway uses host networking on Airnet: UDP 5060 for the provider,
UDP 10000–10100 for RTP, and loopback HTTP 8088 for the SIP WebSocket.
Nginx terminates TLS at `wss://app.u-pos.uz/sip/ws` using the included
`nginx-location.conf` block. The public firewall should allow UDP 5060
only from the provider PBX and UDP 10000–10100 from callers' networks.

Create `runtime/gateway.env` on the server with these keys:

```
UPOS_GATEWAY_REMOTE_HOST=89.126.209.246
UPOS_GATEWAY_REMOTE_PORT=5060
UPOS_GATEWAY_REMOTE_USER=210
UPOS_GATEWAY_REMOTE_AUTH=210
UPOS_GATEWAY_REMOTE_PASSWORD=<existing provider SIP password>
UPOS_GATEWAY_BROWSER_PASSWORD=<new random SIP password>
UPOS_GATEWAY_PUBLIC_IP=176.96.243.203
UPOS_GATEWAY_REGISTER=0
```

Start with `UPOS_GATEWAY_REGISTER=0`, then verify the Asterisk healthcheck,
`http show status`, `pjsip show endpoints`, and WSS handshake. Enable provider
registration only during an agreed call test; registration of line 210 may
replace the PortSIP UC contact on the provider PBX.

Set the following keys in `/opt/upos/.env` after gateway registration works:

```
UPOS_GATEWAY_ENABLED=1
UPOS_GATEWAY_PROVIDER_ID=<U-POS provider UUID>
UPOS_GATEWAY_BROWSER_HOST=app.u-pos.uz
UPOS_GATEWAY_BROWSER_WSS=wss://app.u-pos.uz/sip/ws
UPOS_GATEWAY_BROWSER_PASSWORD=<same new browser SIP password>
```

The browser-facing API rewrites only the configured provider account. Native
SIP clients continue to receive their original provider configuration. To
roll back, set `UPOS_GATEWAY_ENABLED=0`, restart the U-POS app, then set
`UPOS_GATEWAY_REGISTER=0` and restart the gateway.
