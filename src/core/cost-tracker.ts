/**
 * Cost Tracker: calculates charges based on SDK-reported costs and billing mode.
 *
 * Pricing model:
 * - BYOK: user pays API cost directly, we charge markup only (platform fee)
 * - Managed: we pay API cost, charge user cost * (1 + markup)
 *
 * Credits: 1 credit = $0.001
 */

import type { CostSnapshot, BillingConfig, ChargeResult } from './types.js';

/**
 * Markup rates by billing mode and context.
 *
 *   BYOK CLI:     10-15% platform fee
 *   BYOK Cloud:   15-20% platform fee + infra (separate)
 *   Managed CLI:  50-100% markup on API cost
 *   Managed Cloud: 100-200% markup on API cost + infra (separate)
 */
export const MARKUP_RATES = {
  byok: {
    cli: 0.15,
    cloud: 0.20,
  },
  managed: {
    cli: 1.0,
    cloud: 2.0,
  },
} as const;

/**
 * Calculate the charge for a given cost snapshot and billing configuration.
 *
 * @param cost - SDK-reported cost snapshot
 * @param billing - Billing mode and context
 * @returns Charge result with credits, markup, and USD amounts
 */
export function calculateCharge(cost: CostSnapshot, billing: BillingConfig): ChargeResult {
  const markupRate = MARKUP_RATES[billing.mode][billing.context];
  const actualCostUsd = cost.totalCostUsd;

  let finalCostUsd: number;

  if (billing.mode === 'byok') {
    // BYOK: user pays API cost separately, we only charge markup (fee)
    finalCostUsd = actualCostUsd * markupRate;
  } else {
    // Managed: we pay API cost, charge user full amount with markup
    finalCostUsd = actualCostUsd * (1 + markupRate);
  }

  // Convert to credits (1 credit = $0.001), ceil to avoid under-charging
  const chargedCredits = finalCostUsd > 0
    ? Math.ceil(finalCostUsd * 1000)
    : 0;

  return {
    chargedCredits,
    markupRate,
    actualCostUsd,
    finalCostUsd,
  };
}
