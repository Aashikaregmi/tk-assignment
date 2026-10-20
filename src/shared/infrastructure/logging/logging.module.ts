import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';
import { AppConfig } from '../config/app-config';
import { maskDeep } from '../sensitive-data';

export function httpLoggerOptions(level: string): Options {
  return {
    level,
    genReqId: (_req, res) => {
      const id = randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // pino-http passes these the already-serialized req/res; spreading makes them plain objects for maskDeep.
    serializers: {
      req: (req: { url?: string }) => maskDeep({ ...req, url: req.url?.split('?')[0] }),
      res: (res: object) => maskDeep({ ...res }),
    },
    formatters: { log: (entry) => maskDeep(entry) as Record<string, unknown> },
  };
}

export const LoggingModule = LoggerModule.forRootAsync({
  inject: [AppConfig],
  useFactory: (config: AppConfig) => ({ pinoHttp: httpLoggerOptions(config.LOG_LEVEL) }),
});
