FROM node:22-alpine
LABEL maintainer="cysb-platform"

WORKDIR /app

# 零外部依赖：项目纯 Node 内置模块，无需 npm install
COPY . .

# 数据/上传/日志目录（容器可写层，重启后回到镜像基线 = 演示数据）
RUN mkdir -p data uploads data/logs data/reports && \
    chmod -R 777 data uploads

EXPOSE 3000
ENV PORT=3000 NODE_ENV=production

# 健康检查：5s 一次，连不上重试 3 次
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/network >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
