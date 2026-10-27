FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node
EXPOSE 5000
CMD ["node", "src/server.js"]
