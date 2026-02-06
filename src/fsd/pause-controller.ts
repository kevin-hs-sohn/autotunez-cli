/**
 * PauseController - Manages pause/resume state for FSD execution
 *
 * The execution loop can call `await controller.waitIfPaused()` at safe points.
 * When paused, this will block until resume() is called.
 */

export class PauseController {
  private _isPaused = false;
  private resumeResolve: (() => void) | null = null;
  private pausePromise: Promise<void> | null = null;

  get isPaused(): boolean {
    return this._isPaused;
  }

  /**
   * Pause execution. Future calls to waitIfPaused() will block.
   */
  pause(): void {
    if (this._isPaused) return;

    this._isPaused = true;
    this.pausePromise = new Promise((resolve) => {
      this.resumeResolve = resolve;
    });
  }

  /**
   * Resume execution. Unblocks any waitIfPaused() calls.
   */
  resume(): void {
    if (!this._isPaused) return;

    this._isPaused = false;
    if (this.resumeResolve) {
      this.resumeResolve();
      this.resumeResolve = null;
    }
    this.pausePromise = null;
  }

  /**
   * Wait if currently paused. Returns immediately if not paused.
   * Call this at safe points in the execution loop.
   */
  async waitIfPaused(): Promise<void> {
    if (this._isPaused && this.pausePromise) {
      await this.pausePromise;
    }
  }

  /**
   * Reset the controller state
   */
  reset(): void {
    this._isPaused = false;
    this.resumeResolve = null;
    this.pausePromise = null;
  }
}

// Global instance for FSD mode
export const fsdPauseController = new PauseController();
