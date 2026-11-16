# FarmPay backend: builds the TypeScript, then runs only the compiled output with production
# dependencies, as an unprivileged user. Build context: ./backend
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=4000 \
    INDEX_DB_PATH=/data/index.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# The order index is a rebuildable cache, but keeping it avoids re-reading every order on restart.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--no-warnings", "dist/index.js"]
