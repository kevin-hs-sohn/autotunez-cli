import { describe, it, expect } from 'vitest';
import {
  calculateCharge,
  MARKUP_RATES,
} from './cost-tracker';
import type { CostSnapshot, BillingConfig } from './types';

const baseCost: CostSnapshot = {
  totalCostUsd: 0.10,
  inputTokens: 1000,
  outputTokens: 500,
  modelUsage: {
    'claude-sonnet-4-20250514': {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      costUSD: 0.10,
      contextWindow: 200000,
    },
  },
};

describe('cost-tracker', () => {
  describe('MARKUP_RATES', () => {
    it('should have lower markup for BYOK CLI', () => {
      expect(MARKUP_RATES.byok.cli).toBeLessThan(MARKUP_RATES.managed.cli);
    });

    it('should have lower markup for CLI than Cloud', () => {
      expect(MARKUP_RATES.byok.cli).toBeLessThan(MARKUP_RATES.byok.cloud);
      expect(MARKUP_RATES.managed.cli).toBeLessThan(MARKUP_RATES.managed.cloud);
    });
  });

  describe('calculateCharge', () => {
    it('should calculate BYOK CLI charge (platform fee only)', () => {
      const billing: BillingConfig = { mode: 'byok', context: 'cli' };
      const result = calculateCharge(baseCost, billing);

      // BYOK: user pays API cost directly, we only charge markup
      expect(result.actualCostUsd).toBe(0.10);
      expect(result.markupRate).toBe(MARKUP_RATES.byok.cli);
      // finalCostUsd = actualCost * markupRate (fee portion only)
      expect(result.finalCostUsd).toBeCloseTo(0.10 * MARKUP_RATES.byok.cli, 4);
      // chargedCredits = ceil(finalCostUsd * 1000)
      expect(result.chargedCredits).toBe(Math.ceil(0.10 * MARKUP_RATES.byok.cli * 1000));
    });

    it('should calculate BYOK Cloud charge (platform fee + infra)', () => {
      const billing: BillingConfig = { mode: 'byok', context: 'cloud' };
      const result = calculateCharge(baseCost, billing);

      expect(result.markupRate).toBe(MARKUP_RATES.byok.cloud);
      expect(result.finalCostUsd).toBeCloseTo(0.10 * MARKUP_RATES.byok.cloud, 4);
    });

    it('should calculate managed CLI charge (API cost + markup)', () => {
      const billing: BillingConfig = { mode: 'managed', context: 'cli' };
      const result = calculateCharge(baseCost, billing);

      // Managed: we pay API cost, charge user cost * (1 + markup)
      expect(result.actualCostUsd).toBe(0.10);
      expect(result.markupRate).toBe(MARKUP_RATES.managed.cli);
      expect(result.finalCostUsd).toBeCloseTo(0.10 * (1 + MARKUP_RATES.managed.cli), 4);
      expect(result.chargedCredits).toBe(Math.ceil(0.10 * (1 + MARKUP_RATES.managed.cli) * 1000));
    });

    it('should calculate managed Cloud charge (highest markup)', () => {
      const billing: BillingConfig = { mode: 'managed', context: 'cloud' };
      const result = calculateCharge(baseCost, billing);

      expect(result.markupRate).toBe(MARKUP_RATES.managed.cloud);
      expect(result.finalCostUsd).toBeCloseTo(0.10 * (1 + MARKUP_RATES.managed.cloud), 4);
    });

    it('should return 0 credits for zero cost', () => {
      const zeroCost: CostSnapshot = {
        totalCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        modelUsage: {},
      };
      const billing: BillingConfig = { mode: 'managed', context: 'cli' };
      const result = calculateCharge(zeroCost, billing);

      expect(result.chargedCredits).toBe(0);
      expect(result.finalCostUsd).toBe(0);
    });

    it('should always return at least 1 credit for non-zero cost', () => {
      const tinyCost: CostSnapshot = {
        totalCostUsd: 0.0001,
        inputTokens: 1,
        outputTokens: 1,
        modelUsage: {},
      };
      const billing: BillingConfig = { mode: 'byok', context: 'cli' };
      const result = calculateCharge(tinyCost, billing);

      expect(result.chargedCredits).toBeGreaterThanOrEqual(1);
    });

    it('should handle large costs correctly', () => {
      const largeCost: CostSnapshot = {
        totalCostUsd: 5.0,
        inputTokens: 50000,
        outputTokens: 25000,
        modelUsage: {},
      };
      const billing: BillingConfig = { mode: 'managed', context: 'cloud' };
      const result = calculateCharge(largeCost, billing);

      expect(result.actualCostUsd).toBe(5.0);
      expect(result.chargedCredits).toBeGreaterThan(5000);
    });
  });
});
