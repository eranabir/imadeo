import { create } from 'zustand';
import { errorMessage } from './api';

export type OperationStatus = 'running' | 'complete' | 'error';

export interface OperationProgress {
  id: number;
  label: string;
  status: OperationStatus;
  completed: number;
  total?: number;
  error?: string;
}

interface OperationStore {
  current: OperationProgress | null;
}

/** One blocking operation at a time; destructive actions must not overlap. */
export const useOperationProgress = create<OperationStore>(() => ({ current: null }));

let nextOperationId = 0;

const update = (id: number, change: Partial<OperationProgress>) => {
  useOperationProgress.setState((state) =>
    state.current?.id === id
      ? { current: { ...state.current, ...change } }
      : state,
  );
};

export const dismissOperation = () => useOperationProgress.setState({ current: null });

/** Runs one long server action and keeps the page visibly busy until it settles. */
export async function runOperation<T>(
  label: string,
  task: (setCompleted: (completed: number) => void) => Promise<T>,
  total?: number,
) {
  const id = ++nextOperationId;
  useOperationProgress.setState({
    current: { id, label, status: 'running', completed: 0, total },
  });

  try {
    const result = await task((completed) =>
      update(id, { completed: total === undefined ? completed : Math.min(total, completed) }),
    );
    update(id, { status: 'complete', completed: total ?? 0 });
    window.setTimeout(() => {
      if (useOperationProgress.getState().current?.id === id) dismissOperation();
    }, 850);
    return result;
  } catch (error) {
    update(id, { status: 'error', error: errorMessage(error) });
    throw error;
  }
}

/**
 * Sends a large selection in bounded requests. Besides avoiding oversized
 * payloads, each completed batch gives the progress panel an honest update.
 */
export function runBatchedOperation<T>(
  label: string,
  ids: string[],
  worker: (batch: string[]) => Promise<T>,
  batchSize = 100,
) {
  return runOperation(
    label,
    async (setCompleted) => {
      const results: T[] = [];
      for (let start = 0; start < ids.length; start += batchSize) {
        const batch = ids.slice(start, start + batchSize);
        results.push(await worker(batch));
        setCompleted(start + batch.length);
      }
      return results;
    },
    ids.length,
  );
}
