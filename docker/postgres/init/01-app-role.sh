#!/bin/sh
# Runs once, on first start with an empty data volume. Creates the role the API connects as and
# a separate database for integration tests. In both databases the role can read and write rows
# in tables the owner creates later, and nothing else.
set -e
test_db="${POSTGRES_DB}_test"

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" -v test_db="$test_db" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE :"test_db";
SQL

for db in "$POSTGRES_DB" "$test_db"; do
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" -v app_user="$APP_DB_USER" <<'SQL'
GRANT USAGE ON SCHEMA public TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
SQL
done
