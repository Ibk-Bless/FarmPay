# FarmPay frontend: builds the app, then serves it with nginx, which also forwards /api to the
# backend. Build context: ./frontend
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts postcss.config.js tailwind.config.js ./
COPY public ./public
COPY src ./src
# Optional: the network the wallet must be on (defaults to testnet)
ARG VITE_NETWORK_PASSPHRASE
ENV VITE_NETWORK_PASSPHRASE=$VITE_NETWORK_PASSPHRASE
RUN npm run build

FROM nginxinc/nginx-unprivileged:1-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO /dev/null http://127.0.0.1:8080/ || exit 1
