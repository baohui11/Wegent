FROM node:22-slim
WORKDIR /app/pi_runtime
COPY pi_runtime/package.json ./
RUN npm install --omit=dev
COPY pi_runtime/ ./
ENV PI_RUNTIME_PORT=8300
EXPOSE 8300
CMD ["node", "server.mjs"]
