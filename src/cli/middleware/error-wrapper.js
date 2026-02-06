/**
 * Error handling wrapper for commands
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function with error handling
 */
export function wrapCommand(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      // Distinguish different error types for debugging
      let errorCode = 'INTERNAL_ERROR';
      let errorMsg = err.message;

      // Distinguish by error type
      if (err.name === 'TypeError') {
        errorCode = 'TYPE_ERROR';
      } else if (err.code === 'ENOENT') {
        errorCode = 'FILE_ERROR';
      } else if (err.message.includes('ECONNREFUSED')) {
        errorCode = 'NETWORK_DISCONNECTED';
      }

      return { ok: false, code: errorCode, error: errorMsg };
    }
  };
}
