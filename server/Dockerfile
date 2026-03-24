FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY server/bin/ontologyserver /ontologyserver
COPY pipeline/bin/generate /generate
EXPOSE 9091
CMD ["/ontologyserver"]
