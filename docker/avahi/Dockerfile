FROM alpine:3.20
RUN apk add --no-cache avahi avahi-tools dbus iproute2
COPY publish.sh /publish.sh
RUN sed -i 's/\r$//' /publish.sh && chmod +x /publish.sh
ENTRYPOINT ["/publish.sh"]
