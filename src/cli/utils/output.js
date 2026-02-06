/**
 * JSON output utilities for CLI
 */

/**
 * Output data as JSON
 * @param {*} data - Data to output
 */
export function out(data) {
  console.log(JSON.stringify(data));
}

/**
 * Progress indicator for long-running operations
 * @param {string} message - Progress message
 * @returns {Object} Progress controller
 */
export function showProgress(message) {
  let dots = 0;
  const interval = setInterval(() => {
    dots = (dots + 1) % 4;
    process.stderr.write(`\r${message}${'.'.repeat(dots)}${' '.repeat(3 - dots)}`);
  }, 200);

  return {
    stop: (finalMessage) => {
      clearInterval(interval);
      process.stderr.write(`\r${finalMessage || message}\n`);
    }
  };
}
