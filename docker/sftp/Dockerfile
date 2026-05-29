FROM atmoz/sftp:alpine
RUN apk add --no-cache jq
COPY entrypoint.sh /custom-entrypoint.sh
RUN sed -i 's/\r$//' /custom-entrypoint.sh && chmod +x /custom-entrypoint.sh
ENTRYPOINT ["/custom-entrypoint.sh"]
