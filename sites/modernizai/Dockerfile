FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN rm -rf vps && mkdir -p /dados && chown node:node /dados
ENV TZ=America/Sao_Paulo ADMIN_DADOS=/dados
VOLUME /dados
EXPOSE 3000
USER node
CMD ["node", "server.js"]
