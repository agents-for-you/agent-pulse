/**
 * Timing utilities for demo scenarios
 * Provides delays, scheduling, and time measurement
 */

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Sleep with random jitter (for more natural conversation pacing)
 */
export function jitter(baseMs, varianceMs = 500) {
  const jitter = Math.random() * varianceMs - varianceMs / 2
  return sleep(Math.max(0, baseMs + jitter))
}

/**
 * Create a delay that can be cancelled
 */
export function cancellableDelay(ms) {
  let timeout = null
  let resolve = null

  const promise = new Promise(r => {
    resolve = r
    timeout = setTimeout(r, ms)
  })

  return {
    promise,
    cancel: () => {
      if (timeout) clearTimeout(timeout)
      if (resolve) resolve()
    }
  }
}

/**
 * Run a function with a timeout
 */
export async function withTimeout(fn, ms, timeoutMsg = 'Operation timed out') {
  const { promise: delay, cancel } = cancellableDelay(ms)

  try {
    const result = await Promise.race([fn(), delay])
    cancel()
    return result
  } catch (err) {
    if (err.message === timeoutMsg || !err.message) {
      throw new Error(timeoutMsg)
    }
    throw err
  }
}

/**
 * Measure execution time
 */
export async function measure(fn, label = 'Operation') {
  const start = Date.now()
  try {
    const result = await fn()
    const elapsed = Date.now() - start
    return { result, elapsed, success: true }
  } catch (err) {
    const elapsed = Date.now() - start
    return { error: err, elapsed, success: false }
  }
}

/**
 * Create a simple timer
 */
export function timer(label = 'Timer') {
  const start = Date.now()
  let splits = []

  return {
    elapsed() {
      return Date.now() - start
    },
    split(name) {
      const elapsed = Date.now() - start
      splits.push({ name, elapsed })
      return elapsed
    },
    format() {
      const ms = this.elapsed()
      if (ms < 1000) return `${ms}ms`
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
      const min = Math.floor(ms / 60000)
      const sec = ((ms % 60000) / 1000).toFixed(1)
      return `${min}m ${sec}s`
    },
    getSplits() {
      return splits
    }
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retry(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2
  } = options

  let lastError = null
  let delay = baseDelay

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt === maxAttempts) break

      await sleep(delay)
      delay = Math.min(delay * backoffMultiplier, maxDelay)
    }
  }

  throw lastError
}

/**
 * Create a throttled function
 */
export function throttle(fn, minInterval) {
  let lastCall = 0
  let pending = null

  return async function (...args) {
    const now = Date.now()
    const timeSince = now - lastCall

    if (timeSince >= minInterval) {
      lastCall = now
      return await fn(...args)
    }

    if (pending) return pending

    pending = (async () => {
      await sleep(minInterval - timeSince)
      lastCall = Date.now()
      pending = null
      return await fn(...args)
    })()

    return pending
  }
}

/**
 * Create a debounced function
 */
export function debounce(fn, delay) {
  let timeout = null

  return function (...args) {
    if (timeout) clearTimeout(timeout)

    return new Promise(resolve => {
      timeout = setTimeout(async () => {
        timeout = null
        resolve(await fn(...args))
      }, delay)
    })
  }
}

/**
 * Schedule repeated execution
 */
export function interval(fn, ms, options = {}) {
  const { immediate = false } = options
  let timeout = null
  let stopped = false

  const tick = async () => {
    if (stopped) return
    try {
      await fn()
    } catch (err) {
      console.error('Interval error:', err)
    }
    if (!stopped) {
      timeout = setTimeout(tick, ms)
    }
  }

  if (immediate) {
    fn()
  }

  timeout = setTimeout(tick, ms)

  return {
    stop: () => {
      stopped = true
      if (timeout) clearTimeout(timeout)
    }
  }
}

/**
 * Run multiple operations concurrently with a limit
 */
export async function concurrent(tasks, limit = 5) {
  const results = []
  const executing = []

  for (const task of tasks) {
    const promise = Promise.resolve(task()).then(result => {
      executing.splice(executing.indexOf(promise), 1)
      return result
    })

    results.push(promise)
    executing.push(promise)

    if (executing.length >= limit) {
      await Promise.race(executing)
    }
  }

  return Promise.all(results)
}

/**
 * Create a rate-limited function (max N calls per period)
 */
export function rateLimit(fn, maxCalls, periodMs) {
  const calls = []

  return async function (...args) {
    const now = Date.now()

    // Remove old calls outside the period
    while (calls.length > 0 && calls[0] <= now - periodMs) {
      calls.shift()
    }

    // Check if we've hit the limit
    if (calls.length >= maxCalls) {
      const oldestCall = calls[0]
      const waitTime = oldestCall + periodMs - now
      await sleep(waitTime)
    }

    calls.push(now)
    return await fn(...args)
  }
}

/**
 * Timeout promise that rejects after ms
 */
export function timeout(ms, message = 'Timeout') {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms)
  })
}
