import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs');

import { loadProjectContext } from './project-context.js';

describe('project-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadProjectContext', () => {
    it('should load all context files when they exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce('# CLAUDE.md content')
        .mockReturnValueOnce('# SCRATCHPAD content')
        .mockReturnValueOnce('# Plan content');

      const result = loadProjectContext('/test/project');
      expect(result.claudeMd).toBe('# CLAUDE.md content');
      expect(result.scratchpad).toBe('# SCRATCHPAD content');
      expect(result.plan).toBe('# Plan content');
      expect(result.foundFiles).toEqual(['CLAUDE.md', 'SCRATCHPAD.md', 'plan.md']);
    });

    it('should return undefined for missing files', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = loadProjectContext('/test/project');
      expect(result.claudeMd).toBeUndefined();
      expect(result.scratchpad).toBeUndefined();
      expect(result.plan).toBeUndefined();
      expect(result.foundFiles).toEqual([]);
    });

    it('should handle partial files', () => {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true)   // CLAUDE.md exists
        .mockReturnValueOnce(false)  // SCRATCHPAD.md missing
        .mockReturnValueOnce(true);  // plan.md exists
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce('# CLAUDE.md')
        .mockReturnValueOnce('# Plan');

      const result = loadProjectContext('/test/project');
      expect(result.claudeMd).toBe('# CLAUDE.md');
      expect(result.scratchpad).toBeUndefined();
      expect(result.plan).toBe('# Plan');
      expect(result.foundFiles).toEqual(['CLAUDE.md', 'plan.md']);
    });
  });
});
