# AI 聊天服務 — EasyPanel 部署用
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
COPY kb ./kb
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
