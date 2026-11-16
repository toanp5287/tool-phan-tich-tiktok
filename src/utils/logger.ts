import { env } from '../config/env.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const activeWeight = LEVEL_WEIGHT[(env.logLevel as LogLevel) in LEVEL_WEIGHT ? (env.logLevel as LogLevel) : 'info'];

function formatMeta(meta: unknown): string {
  if (meta === undefined) return '';
  if (meta instanceof Error) return ` ${meta.name}: ${meta.message}`;
  try {
    return ` ${JSON.stringify(meta, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

function write(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_WEIGHT[level] < activeWeight) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${formatMeta(meta)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => write('debug', scope, message, meta),
    info: (message, meta) => write('info', scope, message, meta),
    warn: (message, meta) => write('warn', scope, message, meta),
    error: (message, meta) => write('error', scope, message, meta),
  };
}

export const logger = createLogger('app');
