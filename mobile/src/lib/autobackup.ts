import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { runBackup } from './backup';
import { load as loadServer } from './server';
import { getItem, removeItem, setItem } from './storage';

const TASK = 'imadeo.autobackup';
const ENABLED = 'imadeo.autobackup.enabled';
const LAST_RUN = 'imadeo.autobackup.lastRun';

/**
 * How often to ask the system to consider running. Not how often it will.
 *
 * Both platforms treat this as a floor and nothing more. Android will not
 * schedule periodic work more often than every 15 minutes at all, and iOS
 * decides for itself — usually while charging on wifi, sometimes not for a day.
 * Asking for less than the platform allows does not make it happen sooner; it
 * just makes the number in the code a lie.
 */
const EVERY_MINUTES = 15;

/**
 * The background run.
 *
 * Defined at module scope, not inside a component: the OS starts the app in the
 * background with no UI mounted and looks the task up by name, so it has to
 * exist the moment the JS bundle is evaluated.
 */
TaskManager.defineTask(TASK, async () => {
  try {
    const server = await loadServer();
    // Signed out, or no server yet — nothing to send anywhere. Reporting
    // success stops the system from treating it as a failing task and backing
    // off from scheduling it.
    if (!server) return BackgroundTask.BackgroundTaskResult.Success;

    /**
     * Never stops itself.
     *
     * The foreground run has a Stop button behind this callback; a background
     * one has nobody to press it. The system is the thing that decides when the
     * window closes, and it simply suspends the app when it does — anything
     * already uploaded is recorded, and the rest is picked up next time.
     */
    const progress = await runBackup(server, () => {}, () => false);
    await setItem(LAST_RUN, JSON.stringify({ at: Date.now(), sent: progress.done, failed: progress.failed }));

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export interface LastRun {
  at: number;
  sent: number;
  failed: number;
}

/** What the last background run managed, for the Settings row to report. */
export async function lastRun(): Promise<LastRun | null> {
  const raw = await getItem(LAST_RUN);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastRun;
  } catch {
    return null;
  }
}

/** Whether the system will let this app run in the background at all. */
export async function isAvailable(): Promise<boolean> {
  return (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available;
}

export async function isEnabled(): Promise<boolean> {
  // The stored preference and the actual registration can disagree — a restore
  // to a new phone carries the setting but not the scheduled work — so both
  // have to agree before this claims to be on.
  const [wanted, registered] = await Promise.all([
    getItem(ENABLED),
    TaskManager.isTaskRegisteredAsync(TASK),
  ]);
  return wanted === 'yes' && registered;
}

export async function setEnabled(on: boolean): Promise<void> {
  if (on) {
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: EVERY_MINUTES });
    await setItem(ENABLED, 'yes');
    return;
  }

  await removeItem(ENABLED);
  if (await TaskManager.isTaskRegisteredAsync(TASK)) {
    await BackgroundTask.unregisterTaskAsync(TASK);
  }
}

/**
 * Puts the schedule back after an app update or a restore.
 *
 * A registration does not always survive one, and the setting is the thing
 * someone actually chose — so on every launch the schedule is made to match it
 * rather than assumed to still exist.
 */
export async function restore(): Promise<void> {
  const wanted = (await getItem(ENABLED)) === 'yes';
  if (!wanted) return;
  if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
  try {
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: EVERY_MINUTES });
  } catch {
    // Restricted by the system — the Settings row reports that separately.
  }
}
