import { Injectable } from '@nestjs/common';
import { AppConfig } from '@shared/infrastructure/config/app-config';
import type { RiskResult } from '../domain/application-status';
import { RiskAssessment, RiskAssessmentRequest, RiskProvider } from '../application/risk-provider';

// Money transfer, direct marketing, quasi-cash, gambling: categories card networks treat as high risk.
const HIGH_RISK_MCCS = new Set(['4829', '5967', '6051', '7995']);

// Stand-in for a KYB/risk vendor. Deterministic: the same request always gets the same answer,
// so a repeated idempotency key needs no stored response.
@Injectable()
export class SimulatedRiskProvider implements RiskProvider {
  private readonly failuresPerKey: number;
  // ponytail: per process; a shared store would only matter for failure injection across instances.
  private readonly failures = new Map<string, number>();

  constructor(config: AppConfig) {
    this.failuresPerKey = config.RISK_PROVIDER_FAILURES;
  }

  // Fails the first RISK_PROVIDER_FAILURES calls for each key, to exercise retries.
  assess(request: RiskAssessmentRequest, idempotencyKey: string): Promise<RiskAssessment> {
    const failed = this.failures.get(idempotencyKey) ?? 0;
    if (failed < this.failuresPerKey) {
      this.failures.set(idempotencyKey, failed + 1);
      return Promise.reject(new Error('Simulated risk provider unavailable'));
    }
    const score = scoreOf(request);
    return Promise.resolve({ score, result: resultOf(score) });
  }
}

export function scoreOf(request: RiskAssessmentRequest): number {
  let score = 10;
  if (HIGH_RISK_MCCS.has(request.mcc)) score += 50;
  if (request.monthlyVolumeCents > 100_000_000) score += 25; // over $1M a month
  if (request.averageTicketCents > 100_000) score += 20; // over $1,000 a ticket
  if (request.businessType === 'SOLE_PROPRIETORSHIP') score += 10;
  return Math.min(score, 100);
}

function resultOf(score: number): RiskResult {
  if (score < 35) return 'LOW';
  return score < 70 ? 'MEDIUM' : 'HIGH';
}
