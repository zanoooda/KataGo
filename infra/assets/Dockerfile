FROM alpine:3.20

RUN apk add --no-cache bash curl jq tar gzip unzip coreutils grep sed

WORKDIR /work
COPY download-assets.sh /work/download-assets.sh
RUN chmod +x /work/download-assets.sh

CMD ["/work/download-assets.sh"]
