# osmium-tool in a container, so nothing is installed on the host (GPL-3.0 build tool, not shipped).
FROM debian:bookworm-slim
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends osmium-tool && rm -rf /var/lib/apt/lists/*
WORKDIR /data
ENTRYPOINT ["osmium"]
