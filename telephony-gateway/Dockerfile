FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends asterisk ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.py /opt/upos-gateway/entrypoint.py
COPY config/ /opt/upos-gateway/config/

EXPOSE 5060/udp 8088/tcp 10000-10100/udp
ENTRYPOINT ["python3", "/opt/upos-gateway/entrypoint.py"]
