/**
 * Auto-start middleware - ensures service is running before command execution
 */

/**
 * Ensure service is running, start it if needed
 * @returns {Promise<Object>} Result object with ok status
 */
export async function ensureServiceRunning() {
  const { isRunning: runningCheck, start } = await import('../../service/server.js');
  if (!runningCheck()) {
    const { showProgress } = await import('../utils/output.js');
    const progress = showProgress('Starting service');
    const started = await start();
    progress.stop(started.ok ? 'Service started' : 'Failed to start');
    return started;
  }
  return { ok: true, alreadyRunning: true };
}
