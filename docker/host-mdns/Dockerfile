FROM node:22-alpine
WORKDIR /app
COPY docker/host-mdns/package.json ./package.json
RUN npm install --omit=dev && npm cache clean --force
COPY scripts/host-mdns.mjs scripts/load-config-env.mjs ./scripts/
ENV SFTP_CONFIG_DIR=/config
ENTRYPOINT ["node", "scripts/host-mdns.mjs"]
