#!/bin/sh
set -eu
mkdir -p "${STORAGE_DIR:-/data/uploads}"

create_extension() {
  npx prisma db execute --stdin <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
SQL
}

echo "Waiting for Postgres..."
attempt=0
until create_extension; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 30 ]; then
    echo "Postgres did not become ready"
    exit 1
  fi
  echo "Postgres is not ready yet"
  sleep 2
done

echo "Applying database schema..."
npx prisma db push --skip-generate
exec node dist/main.js
