import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpawnSync = vi.fn();
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockCpSync = vi.fn();
const mockRmSync = vi.fn();

vi.mock('child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    cpSync: (...args: unknown[]) => mockCpSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
  };
});

import { installDefaultSkills, installNpxSkill, installManualSkills, NPX_SKILLS, MANUAL_SKILLS } from './skill-installer';

describe('skill-installer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('NPX_SKILLS', () => {
    it('should include all 6 skill repos', () => {
      expect(NPX_SKILLS).toHaveLength(6);
      expect(NPX_SKILLS).toContain('nextlevelbuilder/ui-ux-pro-max-skill');
      expect(NPX_SKILLS).toContain('vercel-labs/agent-skills');
      expect(NPX_SKILLS).toContain('supabase/agent-skills');
      expect(NPX_SKILLS).toContain('obra/superpowers');
      expect(NPX_SKILLS).toContain('expo/skills');
      expect(NPX_SKILLS).toContain('callstackincubator/agent-skills');
    });
  });

  describe('MANUAL_SKILLS', () => {
    it('should include everything-claude-code and antigravity', () => {
      expect(MANUAL_SKILLS).toHaveLength(2);
      expect(MANUAL_SKILLS[0].skills).toContain('backend-patterns');
      expect(MANUAL_SKILLS[0].skills).toContain('security-review');
      expect(MANUAL_SKILLS[1].skills).toContain('ethical-hacking-methodology');
      expect(MANUAL_SKILLS[1].skills).toContain('pentest-checklist');
      expect(MANUAL_SKILLS[1].skills).toContain('aws-penetration-testing');
    });
  });

  describe('installNpxSkill', () => {
    it('should run npx skills add with -y flag', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      const result = installNpxSkill('/test/cwd', 'obra/superpowers');

      expect(result.success).toBe(true);
      expect(result.name).toBe('obra/superpowers');
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'npx',
        ['skills', 'add', 'obra/superpowers', '-y'],
        expect.objectContaining({
          cwd: '/test/cwd',
          timeout: 120_000,
          stdio: 'pipe',
        })
      );
    });

    it('should return failure when npx exits non-zero', () => {
      mockSpawnSync.mockReturnValue({ status: 1, stderr: 'not found' });

      const result = installNpxSkill('/test/cwd', 'nonexistent/skill');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle spawn error (e.g. npx not found)', () => {
      mockSpawnSync.mockReturnValue({ status: null, error: new Error('ENOENT') });

      const result = installNpxSkill('/test/cwd', 'some/skill');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('installManualSkills', () => {
    it('should clone repo, copy skills, and clean up', () => {
      // git clone succeeds
      mockSpawnSync.mockReturnValueOnce({ status: 0, stderr: '' });
      // Skills source dir exists after clone
      mockExistsSync.mockReturnValue(true);

      const results = installManualSkills(
        '/test/cwd',
        'https://github.com/test/repo.git',
        ['skill-a', 'skill-b']
      );

      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
      // Should have called git clone
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['clone', '--depth', '1']),
        expect.any(Object)
      );
      // Should create .claude/skills dir
      expect(mockMkdirSync).toHaveBeenCalled();
      // Should copy skill dirs
      expect(mockCpSync).toHaveBeenCalledTimes(2);
      // Should clean up temp dir
      expect(mockRmSync).toHaveBeenCalled();
    });

    it('should return failures when git clone fails', () => {
      mockSpawnSync.mockReturnValue({ status: 128, stderr: 'auth failed' });

      const results = installManualSkills(
        '/test/cwd',
        'https://github.com/private/repo.git',
        ['skill-a']
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('clone failed');
    });

    it('should handle missing skill directory in cloned repo', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });
      mockExistsSync.mockReturnValue(false);

      const results = installManualSkills(
        '/test/cwd',
        'https://github.com/test/repo.git',
        ['nonexistent-skill']
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('not found');
    });
  });

  describe('installDefaultSkills', () => {
    it('should install all npx and manual skills', async () => {
      // All succeed
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });
      mockExistsSync.mockReturnValue(true);

      const results = await installDefaultSkills('/test/cwd');

      // 6 npx + 2 + 3 manual = 11 total
      expect(results.length).toBeGreaterThanOrEqual(11);
      const successes = results.filter(r => r.success);
      expect(successes.length).toBe(results.length);
    });

    it('should continue when individual skills fail', async () => {
      let callCount = 0;
      mockSpawnSync.mockImplementation(() => {
        callCount++;
        // Fail the first npx skill
        if (callCount === 1) return { status: 1, stderr: 'failed' };
        return { status: 0, stderr: '' };
      });
      mockExistsSync.mockReturnValue(true);

      const results = await installDefaultSkills('/test/cwd');

      const failures = results.filter(r => !r.success);
      const successes = results.filter(r => r.success);
      expect(failures.length).toBeGreaterThanOrEqual(1);
      expect(successes.length).toBeGreaterThan(0);
    });
  });
});
