// Integration tests use `<DB_NAME>_test` (created by the Postgres init script) and the next Redis
// database, so they never share data or queued jobs with a running dev server.
export function testEnv(): Record<string, string | undefined> {
  if (!process.env.DB_NAME) throw new Error('DB_NAME is not set; copy .env.example to .env');
  const redisDb = Number(process.env.REDIS_DB ?? 0) + 1;
  return { ...process.env, DB_NAME: `${process.env.DB_NAME}_test`, REDIS_DB: String(redisDb) };
}
