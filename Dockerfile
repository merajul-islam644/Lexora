# Lexora serves a static SPA -- the entire API is the lexora-api Blocks
# Function, so the image only builds the web bundle and serves it.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite bakes the public VITE_* config (API url, tenant key, OIDC client,
# function id) from .env.production at build time.
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist-web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080 80
