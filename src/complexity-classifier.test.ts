import { describe, it, expect } from 'vitest';
import { classifyComplexity, detectLanguage } from './complexity-classifier';

describe('complexity-classifier', () => {
  describe('detectLanguage', () => {
    it('should detect Korean text', () => {
      expect(detectLanguage('로그인 버튼 추가해줘')).toBe('korean');
    });

    it('should detect English text', () => {
      expect(detectLanguage('add a login button')).toBe('english');
    });

    it('should detect mixed Korean/English text', () => {
      expect(detectLanguage('React 컴포넌트에 로그인 기능 추가')).toBe('mixed');
    });

    it('should default to english for empty input', () => {
      expect(detectLanguage('')).toBe('english');
    });

    it('should default to english for numbers only', () => {
      expect(detectLanguage('12345')).toBe('english');
    });
  });

  describe('classifyComplexity', () => {
    // --- Simple tasks ---
    it('should classify simple Korean task as simple', () => {
      const result = classifyComplexity('버튼 색상 변경해줘');
      expect(result.level).toBe('simple');
      expect(result.suggestedModel).toBe('haiku');
    });

    it('should classify simple English task as simple', () => {
      const result = classifyComplexity('fix the typo in the header');
      expect(result.level).toBe('simple');
      expect(result.suggestedModel).toBe('haiku');
    });

    it('should classify short add/change requests as simple', () => {
      expect(classifyComplexity('추가해줘 버튼 하나').level).toBe('simple');
      expect(classifyComplexity('change button color').level).toBe('simple');
      expect(classifyComplexity('삭제해줘 이 컴포넌트').level).toBe('simple');
    });

    // --- Moderate tasks ---
    it('should classify moderate Korean task', () => {
      const result = classifyComplexity('사용자 프로필 페이지를 만들어줘. 이름, 이메일, 프로필 사진을 보여주고 수정할 수 있게');
      expect(result.level).toBe('moderate');
      expect(result.suggestedModel).toBe('sonnet');
    });

    it('should classify moderate English task', () => {
      const result = classifyComplexity('create a user profile page with name, email, and avatar editing');
      expect(result.level).toBe('moderate');
      expect(result.suggestedModel).toBe('sonnet');
    });

    // --- Complex tasks ---
    it('should classify complex Korean task with architecture keywords', () => {
      const result = classifyComplexity('실시간 채팅 시스템 아키텍처를 설계하고 인증과 결제 시스템을 통합해줘');
      expect(result.level).toBe('complex');
      expect(result.suggestedModel).toBe('opus');
    });

    it('should classify complex English task with architecture keywords', () => {
      const result = classifyComplexity('design a distributed real-time messaging system with authentication and payment integration');
      expect(result.level).toBe('complex');
      expect(result.suggestedModel).toBe('opus');
    });

    it('should classify optimization/refactoring tasks as complex', () => {
      expect(classifyComplexity('전체 코드베이스 리팩토링하고 성능 최적화해줘').level).toBe('complex');
      expect(classifyComplexity('refactor the entire authentication architecture').level).toBe('complex');
    });

    // --- Length-based classification ---
    it('should increase complexity for longer inputs', () => {
      const short = classifyComplexity('버그 수정');
      const long = classifyComplexity(
        '사용자가 로그인하면 대시보드에서 최근 활동을 볼 수 있고, 프로필을 수정할 수 있으며, ' +
        '알림 설정을 변경할 수 있고, 결제 내역을 확인하고, 구독을 관리하며, ' +
        '팀원을 초대하고, 권한을 설정하는 기능이 필요합니다'
      );
      // Long input should be at least moderate
      expect(['moderate', 'complex']).toContain(long.level);
      // Short simple input should stay simple
      expect(short.level).toBe('simple');
    });

    // --- Edge cases ---
    it('should handle empty input', () => {
      const result = classifyComplexity('');
      expect(result.level).toBe('simple');
      expect(result.suggestedModel).toBe('haiku');
    });

    it('should handle emoji-only input', () => {
      const result = classifyComplexity('🚀🔥💻');
      expect(result.level).toBe('simple');
    });

    // --- Confidence ---
    it('should return confidence between 0 and 1', () => {
      const result = classifyComplexity('add a button');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    // --- Reasons ---
    it('should provide reasons for classification', () => {
      const result = classifyComplexity('아키텍처 리팩토링');
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });
});
