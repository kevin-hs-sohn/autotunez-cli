export type ComplexityLevel = 'simple' | 'moderate' | 'complex';

export interface ClassificationResult {
  level: ComplexityLevel;
  suggestedModel: 'haiku' | 'sonnet' | 'opus';
  confidence: number;
  reasons: string[];
}

type DetectedLanguage = 'korean' | 'english' | 'mixed';

// Hangul Unicode range: U+AC00 to U+D7AF (syllables), U+1100 to U+11FF (jamo)
const HANGUL_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;

/**
 * Detect the primary language of the input text.
 */
export function detectLanguage(input: string): DetectedLanguage {
  if (!input.trim()) return 'english';

  const chars = [...input.replace(/\s/g, '')];
  if (chars.length === 0) return 'english';

  const hangulCount = chars.filter(c => HANGUL_REGEX.test(c)).length;
  const latinCount = chars.filter(c => /[a-zA-Z]/.test(c)).length;
  const ratio = hangulCount / chars.length;

  if (latinCount > 0 && ratio > 0.1 && ratio < 0.9) return 'mixed';
  if (ratio > 0.5) return 'korean';
  if (hangulCount > 0) return 'mixed';
  return 'english';
}

// Keyword categories for complexity detection
const SIMPLE_KEYWORDS_KO = ['추가', '변경', '수정', '삭제', '버그', '수정', '오타', '색상', '텍스트', '버튼'];
const SIMPLE_KEYWORDS_EN = ['fix', 'add', 'change', 'update', 'remove', 'delete', 'rename', 'typo', 'color', 'button', 'text'];

const MODERATE_KEYWORDS_KO = ['만들어', '구현', '페이지', '기능', '화면', '컴포넌트', '폼', 'API'];
const MODERATE_KEYWORDS_EN = ['create', 'implement', 'build', 'page', 'feature', 'component', 'form', 'endpoint'];

const COMPLEX_KEYWORDS_KO = ['최적화', '리팩토링', '아키텍처', '마이그레이션', '보안', '성능', '캐시', '인덱스'];
const COMPLEX_KEYWORDS_EN = ['optimize', 'refactor', 'architecture', 'migration', 'security', 'performance', 'cache', 'index'];

const VERY_COMPLEX_KEYWORDS_KO = ['멀티', '분산', '실시간', '인증', '결제', '통합', '시스템', '설계'];
const VERY_COMPLEX_KEYWORDS_EN = ['distributed', 'real-time', 'realtime', 'authentication', 'payment', 'integration', 'system design', 'microservice'];

/**
 * Classify the complexity of a user input to suggest an appropriate model.
 *
 * Uses keyword matching (Korean + English), input length, and language detection.
 */
export function classifyComplexity(input: string): ClassificationResult {
  const trimmed = input.trim();
  const reasons: string[] = [];

  if (!trimmed) {
    return { level: 'simple', suggestedModel: 'haiku', confidence: 0.9, reasons: ['empty input'] };
  }

  const lang = detectLanguage(trimmed);
  const lower = trimmed.toLowerCase();

  // Score-based classification
  let score = 0;

  // Keyword matching
  const simpleKeywords = [...SIMPLE_KEYWORDS_KO, ...SIMPLE_KEYWORDS_EN];
  const moderateKeywords = [...MODERATE_KEYWORDS_KO, ...MODERATE_KEYWORDS_EN];
  const complexKeywords = [...COMPLEX_KEYWORDS_KO, ...COMPLEX_KEYWORDS_EN];
  const veryComplexKeywords = [...VERY_COMPLEX_KEYWORDS_KO, ...VERY_COMPLEX_KEYWORDS_EN];

  const simpleMatches = simpleKeywords.filter(k => lower.includes(k));
  const moderateMatches = moderateKeywords.filter(k => lower.includes(k));
  const complexMatches = complexKeywords.filter(k => lower.includes(k));
  const veryComplexMatches = veryComplexKeywords.filter(k => lower.includes(k));

  if (simpleMatches.length > 0) {
    score -= simpleMatches.length;
    reasons.push(`simple keywords: ${simpleMatches.join(', ')}`);
  }
  if (moderateMatches.length > 0) {
    score += moderateMatches.length;
    reasons.push(`moderate keywords: ${moderateMatches.join(', ')}`);
  }
  if (complexMatches.length > 0) {
    score += complexMatches.length * 2;
    reasons.push(`complex keywords: ${complexMatches.join(', ')}`);
  }
  if (veryComplexMatches.length > 0) {
    score += veryComplexMatches.length * 3;
    reasons.push(`very complex keywords: ${veryComplexMatches.join(', ')}`);
  }

  // Length-based scoring
  // Korean text conveys more meaning per character than English (~1.5x info density)
  const effectiveLength = lang === 'korean' ? trimmed.length * 2
    : lang === 'mixed' ? trimmed.length * 1.5
    : trimmed.length;

  if (effectiveLength > 100) {
    score += 2;
    reasons.push('long input');
  } else if (effectiveLength > 50) {
    score += 1;
    reasons.push('medium-length input');
  }

  // Determine level
  let level: ComplexityLevel;
  let suggestedModel: 'haiku' | 'sonnet' | 'opus';

  if (score >= 4) {
    level = 'complex';
    suggestedModel = 'opus';
  } else if (score >= 1) {
    level = 'moderate';
    suggestedModel = 'sonnet';
  } else {
    level = 'simple';
    suggestedModel = 'haiku';
  }

  if (reasons.length === 0) {
    reasons.push('no specific complexity indicators');
  }

  // Confidence: higher when more signals agree
  const totalSignals = simpleMatches.length + moderateMatches.length + complexMatches.length + veryComplexMatches.length;
  const confidence = totalSignals > 0 ? Math.min(0.9, 0.5 + totalSignals * 0.1) : 0.5;

  return { level, suggestedModel, confidence, reasons };
}
