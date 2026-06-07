import { env } from '../config/env';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const levels: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const colors: Record<LogLevel, string> = {
  error: '\x1b[1;31m', // Bold Red
  warn: '\x1b[1;33m', // Bold Yellow
  info: '\x1b[1;36m', // Bold Cyan
  debug: '\x1b[1;35m', // Bold Magenta
};

const reset = '\x1b[0m';
const dim = '\x1b[2;37m'; // Dim white for timestamp

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return levels[level] <= levels[this.level];
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    ...args: any[]
  ): string {
    const timestamp = new Date().toISOString();
    const color = colors[level];
    const levelStr = level.toUpperCase().padEnd(5);

    const formattedArgs =
      args.length > 0
        ? ' ' +
          args
            .map(arg =>
              typeof arg === 'object'
                ? JSON.stringify(arg, null, 2)
                : String(arg)
            )
            .join(' ')
        : '';

    return `${dim}[${timestamp}]${reset} ${color}${levelStr}${reset} ${message}${formattedArgs}`;
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, ...args));
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, ...args));
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, ...args));
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, ...args));
    }
  }
}

export const logger = new Logger(env.LOG_LEVEL as LogLevel);
