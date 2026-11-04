FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci

FROM deps AS api-build
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV DATABASE_URL=postgresql://docintel:docintel@localhost:5432/docintel
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim AS api
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=api-build /app/node_modules /app/node_modules
COPY --from=api-build /app/package.json /app/package.json
COPY --from=api-build /app/apps/api /app/apps/api
COPY apps/api/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
WORKDIR /app/apps/api
ENV PORT=3001
EXPOSE 3001
ENTRYPOINT ["/entrypoint.sh"]

FROM deps AS web-build
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build --workspace apps/web

FROM node:20-bookworm-slim AS web
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/package.json /app/package.json
COPY --from=web-build /app/apps/web /app/apps/web
WORKDIR /app/apps/web
ENV PORT=3000
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
