FROM node:22-alpine
RUN apk add --no-cache iproute2
WORKDIR /init
COPY init.mjs ./init.mjs
RUN sed -i 's/\r$//' ./init.mjs
ENTRYPOINT ["node", "init.mjs"]
