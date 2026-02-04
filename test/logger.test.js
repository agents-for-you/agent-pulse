/**
 * @fileoverview Logger unit tests
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Logger, LogLevel } from '../src/utils/logger.js'

describe('Logger', () => {
  it('should create logger with default options', () => {
    const logger = new Logger()
    assert.strictEqual(logger.name, 'agent')
    assert.strictEqual(logger.level, LogLevel.INFO)
    assert.strictEqual(logger.json, false)
    assert.strictEqual(logger.timestamp, true)
  })

  it('should create logger with custom options', () => {
    const logger = new Logger({
      name: 'test',
      level: LogLevel.DEBUG,
      json: true,
      timestamp: false
    })
    assert.strictEqual(logger.name, 'test')
    assert.strictEqual(logger.level, LogLevel.DEBUG)
    assert.strictEqual(logger.json, true)
    assert.strictEqual(logger.timestamp, false)
  })

  it('should create child logger with correct name', () => {
    const parent = new Logger({ name: 'parent' })
    const child = parent.child('child')
    assert.strictEqual(child.name, 'parent:child')
    assert.strictEqual(child.level, parent.level)
  })

  it('should respect log level filtering', () => {
    const logger = new Logger({ level: LogLevel.WARN })
    // These should not throw
    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')
  })
})

describe('LogLevel', () => {
  it('should have correct order', () => {
    assert.ok(LogLevel.DEBUG < LogLevel.INFO)
    assert.ok(LogLevel.INFO < LogLevel.WARN)
    assert.ok(LogLevel.WARN < LogLevel.ERROR)
    assert.ok(LogLevel.ERROR < LogLevel.SILENT)
  })
})
