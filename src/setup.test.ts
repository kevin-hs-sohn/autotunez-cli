import { describe, it, expect, vi, beforeEach } from 'vitest';
import { needsSetup, getMissingFiles } from './setup';
import * as fs from 'fs';

vi.mock('fs');

const mockExistsSync = vi.mocked(fs.existsSync);

describe('needsSetup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return true when CLAUDE.md is missing', () => {
    mockExistsSync.mockImplementation((filePath) => {
      const p = filePath.toString();
      if (p.endsWith('CLAUDE.md')) return false;
      return true;
    });

    expect(needsSetup('/test/dir')).toBe(true);
  });

  it('should return true when SCRATCHPAD.md is missing', () => {
    mockExistsSync.mockImplementation((filePath) => {
      const p = filePath.toString();
      if (p.endsWith('SCRATCHPAD.md')) return false;
      return true;
    });

    expect(needsSetup('/test/dir')).toBe(true);
  });

  it('should return true when plan.md is missing', () => {
    mockExistsSync.mockImplementation((filePath) => {
      const p = filePath.toString();
      if (p.endsWith('plan.md')) return false;
      return true;
    });

    expect(needsSetup('/test/dir')).toBe(true);
  });

  it('should return false when all required files exist', () => {
    mockExistsSync.mockReturnValue(true);

    expect(needsSetup('/test/dir')).toBe(false);
  });

  it('should return true when all files are missing', () => {
    mockExistsSync.mockReturnValue(false);

    expect(needsSetup('/test/dir')).toBe(true);
  });
});

describe('getMissingFiles', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return all missing files', () => {
    mockExistsSync.mockReturnValue(false);

    const missing = getMissingFiles('/test/dir');
    expect(missing).toContain('CLAUDE.md');
    expect(missing).toContain('SCRATCHPAD.md');
    expect(missing).toContain('plan.md');
    expect(missing).toHaveLength(3);
  });

  it('should return empty array when all files exist', () => {
    mockExistsSync.mockReturnValue(true);

    expect(getMissingFiles('/test/dir')).toEqual([]);
  });

  it('should return only missing files', () => {
    mockExistsSync.mockImplementation((filePath) => {
      const p = filePath.toString();
      return p.endsWith('CLAUDE.md');
    });

    const missing = getMissingFiles('/test/dir');
    expect(missing).not.toContain('CLAUDE.md');
    expect(missing).toContain('SCRATCHPAD.md');
    expect(missing).toContain('plan.md');
  });
});
