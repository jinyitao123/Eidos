FROM golang:1.26-alpine AS builder

WORKDIR /build
COPY server/go.mod server/go.sum ./server/
COPY pipeline/go.mod pipeline/go.sum ./pipeline/
WORKDIR /build/server
ENV GOPROXY=https://goproxy.cn,direct
RUN go mod download
WORKDIR /build/pipeline
RUN go mod download

WORKDIR /build
COPY server/ ./server/
COPY pipeline/ ./pipeline/

WORKDIR /build/server
RUN CGO_ENABLED=0 go build -o /ontologyserver ./cmd/ontologyserver

WORKDIR /build/pipeline
RUN CGO_ENABLED=0 go build -o /generate ./cmd/generate

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /ontologyserver /ontologyserver
COPY --from=builder /generate /generate
EXPOSE 9091
CMD ["/ontologyserver"]
