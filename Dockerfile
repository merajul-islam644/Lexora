# Lexora is a static SPA talking straight to the SELISE Blocks APIs (Data
# Gateway + Storage) with the signed-in user's own token -- the image only
# builds the web bundle and serves it.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite bakes the public VITE_* config (API url, tenant key, OIDC client)
# from .env.production at build time.
RUN npm run build

# Blocks runs containers with run-as-non-root; the unprivileged nginx image
# listens on 8080 as uid 101 out of the box.
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/dist-web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
