import { describe, it, expect, beforeEach } from 'vitest';
import { PauseController } from './pause-controller.js';

describe('PauseController', () => {
  let controller: PauseController;

  beforeEach(() => {
    controller = new PauseController();
  });

  it('should not be paused initially', () => {
    expect(controller.isPaused).toBe(false);
  });

  it('should be paused after pause() is called', () => {
    controller.pause();
    expect(controller.isPaused).toBe(true);
  });

  it('should not be paused after resume() is called', () => {
    controller.pause();
    controller.resume();
    expect(controller.isPaused).toBe(false);
  });

  it('should return immediately from waitIfPaused when not paused', async () => {
    const start = Date.now();
    await controller.waitIfPaused();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('should block waitIfPaused when paused and unblock on resume', async () => {
    controller.pause();

    let resolved = false;
    const waitPromise = controller.waitIfPaused().then(() => {
      resolved = true;
    });

    // Should not be resolved yet
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Resume should unblock
    controller.resume();
    await waitPromise;
    expect(resolved).toBe(true);
  });

  it('should reset state correctly', () => {
    controller.pause();
    expect(controller.isPaused).toBe(true);

    controller.reset();
    expect(controller.isPaused).toBe(false);
  });

  it('should handle multiple pause/resume cycles', () => {
    controller.pause();
    expect(controller.isPaused).toBe(true);

    controller.resume();
    expect(controller.isPaused).toBe(false);

    controller.pause();
    expect(controller.isPaused).toBe(true);

    controller.resume();
    expect(controller.isPaused).toBe(false);
  });

  it('should ignore duplicate pause calls', () => {
    controller.pause();
    controller.pause();
    expect(controller.isPaused).toBe(true);

    controller.resume();
    expect(controller.isPaused).toBe(false);
  });

  it('should ignore duplicate resume calls', () => {
    controller.pause();
    controller.resume();
    controller.resume();
    expect(controller.isPaused).toBe(false);
  });
});
