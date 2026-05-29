FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY scripts ./scripts/
ENTRYPOINT ["node", "scripts/host-mdns.mjs"]
