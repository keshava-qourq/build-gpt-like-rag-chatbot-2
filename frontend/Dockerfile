# Build stage: compiles the Vite app. VITE_API_BASE_URL is a build
# argument, not a runtime environment variable -- Vite inlines every VITE_*
# value into the bundle at build time (see src/lib/api.ts), so it has to be
# available before `vite build` runs, not just at container start.
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# Runtime stage: a plain static file server for the built bundle. nginx
# serves the single exposed port both backend/docker-compose.yml's
# `frontend` service and the ECS frontend task run the container on.
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - http://localhost:5173/ > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
