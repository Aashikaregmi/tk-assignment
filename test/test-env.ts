// Integration tests use `<DB_NAME>_test` (created by the Postgres init script) instead of the dev database.
export function testEnv(): Record<string, string | undefined> {
  if (!process.env.DB_NAME) throw new Error('DB_NAME is not set; copy .env.example to .env');
  return { ...process.env, DB_NAME: `${process.env.DB_NAME}_test` };
}
