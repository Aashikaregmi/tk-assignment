import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import { REDACTED } from '../sensitive-data';
import { httpLoggerOptions } from './logging.module';

interface LogEntry {
  msg?: string;
  req?: { id?: string; url?: string; headers?: Record<string, string> };
  res?: { headers?: Record<string, string> };
  body?: { password?: string; owner?: { email?: string } };
}

describe('httpLoggerOptions', () => {
  let output = '';
  let requestId: string | null = null;
  const entries = () =>
    output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as LogEntry);
  const completed = () => entries().find((entry) => entry.msg === 'request completed');

  beforeAll(async () => {
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const logger = pinoHttp(httpLoggerOptions('info'), sink);
    const server = createServer((req, res) => {
      logger(req, res);
      req.log.info(
        { body: { password: 'hunter2', owner: { email: 'jane@example.com' } } },
        'handled',
      );
      res.setHeader('set-cookie', 'sid=c00kie');
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/applications?token=qs-t0ken`, {
      headers: { authorization: 'Bearer s3cr3t-jwt', cookie: 'sid=c00kie' },
    });
    await response.text();
    requestId = response.headers.get('x-request-id');

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('never writes secret or personal values', () => {
    expect(output).not.toMatch(/s3cr3t-jwt|c00kie|qs-t0ken|hunter2|jane@example\.com/);
  });

  it('redacts sensitive request and response headers', () => {
    expect(completed()?.req?.headers).toMatchObject({ authorization: REDACTED, cookie: REDACTED });
    expect(completed()?.res?.headers).toMatchObject({ 'set-cookie': REDACTED });
  });

  it('logs the path without the query string', () => {
    expect(completed()?.req?.url).toBe('/applications');
  });

  it('masks application log payloads', () => {
    const handled = entries().find((entry) => entry.msg === 'handled');
    expect(handled?.body).toEqual({ password: REDACTED, owner: { email: 'j***@example.com' } });
  });

  it('tags the request with a generated id and returns it to the client', () => {
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(completed()?.req?.id).toBe(requestId);
  });
});
