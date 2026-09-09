import { commandStack } from './commands/CommandStack';
import { setDocumentHandlers } from './createDocumentStore';

/** How long editing must pause before a document is written. */
const DEBOUNCE_MS = 2000;

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface PendingWrite {
  relativePath: string;
  data: unknown;
}

/**
 * Turns a document into the files it should be written as.
 *
 * Most documents are a single file, but the expression set is one editable
 * document spread across many exp3.json files, so a scope can register a
 * splitter instead of relying on `relativePath`.
 */
export type DocumentSplitter = (data: unknown) => PendingWrite[];

/**
 * Writes edited documents back to the workspace, on a debounce.
 *
 * Saving is automatic because the workspace is a private copy: there is no
 * "unsaved original" to protect, and the main process writes atomically with a
 * rotating backup, so the risk of an autosave is far lower than the risk of a
 * user losing an afternoon of tuning.
 */
export class AutosaveService {
  private workspaceId: string | null = null;
  private readonly pending = new Map<string, PendingWrite[]>();
  private readonly splitters = new Map<string, DocumentSplitter>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private listeners = new Set<(status: SaveStatus, error?: string) => void>();
  private status: SaveStatus = 'idle';

  /** Points autosave at a workspace, discarding anything queued for the old one. */
  setWorkspace(workspaceId: string | null): void {
    this.workspaceId = workspaceId;
    this.pending.clear();
    this.clearTimer();
    this.setStatus('idle');
  }

  /** Registers how a multi-file document maps onto files on disk. */
  registerSplitter(scope: string, splitter: DocumentSplitter): void {
    this.splitters.set(scope, splitter);
  }

  subscribe(listener: (status: SaveStatus, error?: string) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  getStatus(): SaveStatus {
    return this.status;
  }

  /** Queues a document; repeated calls for the same file collapse into one write. */
  queue(scope: string, relativePath: string | null, data: unknown): void {
    if (!this.workspaceId) return;

    const splitter = this.splitters.get(scope);
    const writes = splitter
      ? splitter(data)
      : relativePath
        ? [{ relativePath, data }]
        : [];
    if (writes.length === 0) return;

    this.pending.set(scope, writes);
    this.setStatus('pending');
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Writes everything queued right now — used before export and on close. */
  async flush(): Promise<void> {
    this.clearTimer();
    if (!this.workspaceId || this.pending.size === 0 || this.inFlight) return;

    const workspaceId = this.workspaceId;
    const batch = [...this.pending.values()].flat();
    this.pending.clear();
    this.inFlight = true;
    this.setStatus('saving');

    try {
      for (const write of batch) {
        const result = await window.api.writeJsonFile({
          workspaceId,
          relativePath: write.relativePath,
          // Two-space indent keeps the files diff-friendly and matches what
          // Cubism Editor emits, so exports stay readable to other tools.
          contents: `${JSON.stringify(write.data, null, 2)}\n`
        });
        if (!result.ok) throw new Error(result.error ?? `Không ghi được ${write.relativePath}`);
      }
      commandStack.markSaved();
      this.setStatus('saved');
    } catch (error) {
      console.error('[autosave] write failed', error);
      this.setStatus('error', error instanceof Error ? error.message : String(error));
    } finally {
      this.inFlight = false;
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setStatus(status: SaveStatus, error?: string): void {
    this.status = status;
    for (const listener of this.listeners) listener(status, error);
  }
}

export const autosave = new AutosaveService();

/** Connects document stores to autosave. Called once from the app entry. */
export function installAutosave(): void {
  setDocumentHandlers({
    onChanged: (scope, relativePath, data) => autosave.queue(scope, relativePath, data),
    onLoaded: () => {
      // A freshly loaded document is by definition in sync with disk.
      commandStack.markSaved();
    }
  });
}
