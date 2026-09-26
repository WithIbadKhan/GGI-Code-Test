import { pino, type Logger } from 'pino';

export function createLogger(options: { level: string; pretty: boolean }): Logger {
  return pino({
    level: options.level,
    // Never write credentials to the logs.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[REDACTED]',
    },
    ...(options.pretty ? { transport: { target: 'pino-pretty' } } : {}),
  });
}
