import path from 'path'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { ensureLogDirectory, initializeMonitoring, loggerConfig } from '../config/logger.config'
import { sanitizeLogData } from './logHelpers'

ensureLogDirectory()
initializeMonitoring()

const { combine, timestamp, errors, splat, json, colorize, printf } = winston.format

const sanitizeFormat = winston.format((info) => {
  return sanitizeLogData(info) as winston.Logform.TransformableInfo
})

const logFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  sanitizeFormat(),
  json()
)

const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  sanitizeFormat(),
  printf(({ timestamp: logTimestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
    return `${logTimestamp} [${level}]: ${message}${metaString}`
  })
)

const appFileTransport = new DailyRotateFile({
  filename: path.join(loggerConfig.directory, 'app-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: logFormat,
})

const errorFileTransport = new DailyRotateFile({
  filename: path.join(loggerConfig.directory, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
})

const exceptionFileTransport = new DailyRotateFile({
  filename: path.join(loggerConfig.directory, 'exceptions-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
})

const rejectionFileTransport = new DailyRotateFile({
  filename: path.join(loggerConfig.directory, 'rejections-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  format: logFormat,
})

// winston attaches a 'finish'/'error' listener to each file transport on
// every logger.child() call (see createModuleLogger below), and this app
// creates one child logger per module (15+ at startup) sharing these same
// transport instances — comfortably past EventEmitter's default cap of 10,
// which otherwise logs a spurious MaxListenersExceededWarning on every boot.
for (const t of [appFileTransport, errorFileTransport, exceptionFileTransport, rejectionFileTransport]) {
  t.setMaxListeners(50)
}

const transports: winston.transport[] = [appFileTransport, errorFileTransport]

if (loggerConfig.consoleEnabled) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
    })
  )
}

export const logger = winston.createLogger({
  levels: winston.config.npm.levels,
  level: loggerConfig.level,
  format: logFormat,
  defaultMeta: {
    service: loggerConfig.serviceName,
    env: process.env.NODE_ENV || 'development',
    pid: process.pid,
  },
  transports,
  exceptionHandlers: [exceptionFileTransport],
  rejectionHandlers: [rejectionFileTransport],
  exitOnError: false,
})

export const createModuleLogger = (
  moduleName: string,
  defaultMeta: Record<string, unknown> = {}
) => {
  return logger.child({
    module: moduleName,
    ...(sanitizeLogData(defaultMeta) as Record<string, unknown>),
  })
}
