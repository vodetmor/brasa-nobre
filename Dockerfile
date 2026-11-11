FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN node scripts/assets.js || true
RUN mkdir -p uploads && chown -R node:node /app/uploads
USER node
ENV NODE_ENV=production
CMD ["node","--disable-warning=ExperimentalWarning","src/server.js"]
