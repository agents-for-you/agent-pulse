/**
 * Update commands: check-update, update
 */
import * as updater from '../../utils/updater.js';
import { out, showProgress } from '../utils/output.js';

export const commands = {
  // Check for updates
  async 'check-update'() {
    try {
      const status = await updater.checkForUpdates();

      if (!status.ok) {
        out({
          ok: false,
          error: status.error,
          suggestion: 'Check your internet connection'
        });
        return;
      }

      out({
        ok: true,
        current: status.current,
        latest: status.latest,
        updateAvailable: status.updateAvailable,
        message: updater.formatUpdateStatus(status)
      });
    } catch (err) {
      out({ ok: false, error: err.message });
    }
  },

  // Update to latest version
  async 'update'(args) {
    const force = args.includes('--force');
    const checkOnly = args.includes('--check');

    if (checkOnly) {
      try {
        const status = await updater.checkForUpdates();
        out(status);
      } catch (err) {
        out({ ok: false, error: err.message });
      }
      return;
    }

    const progress = showProgress('Checking for updates');
    try {
      const onProgress = (type, msg) => {
        if (type === 'info') {
          progress.stop(msg);
          // Start new progress
          progress.interval = setInterval(() => {
            process.stderr.write(`.`);
          }, 200);
        }
      };

      const result = await updater.performUpdate({ force, onProgress });

      if (result.updated) {
        progress.stop(`Updated: ${result.message}`);
      } else if (result.alreadyUpToDate) {
        progress.stop(result.message);
      } else {
        progress.stop('Update failed');
      }

      out(result);
    } catch (err) {
      progress.stop('Update failed');
      out({ ok: false, error: err.message });
    }
  }
};
