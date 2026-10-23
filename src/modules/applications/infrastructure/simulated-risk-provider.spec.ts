import { AppConfig } from '@shared/infrastructure/config/app-config';
import { RiskAssessmentRequest } from '../application/risk-provider';
import { scoreOf, SimulatedRiskProvider } from './simulated-risk-provider';

// A coffee shop LLC: $25,000 a month, $45 tickets.
const coffeeShop: RiskAssessmentRequest = {
  legalBusinessName: 'Example Coffee LLC',
  businessType: 'LLC',
  mcc: '5812',
  monthlyVolumeCents: 2_500_000,
  averageTicketCents: 4_500,
};

const provider = (failures = 0) =>
  new SimulatedRiskProvider({ RISK_PROVIDER_FAILURES: failures } as AppConfig);

describe('SimulatedRiskProvider', () => {
  it.each<[string, Partial<RiskAssessmentRequest>, number, string]>([
    ['an ordinary merchant', {}, 10, 'LOW'],
    ['a sole proprietor', { businessType: 'SOLE_PROPRIETORSHIP' }, 20, 'LOW'],
    ['high tickets', { averageTicketCents: 150_000 }, 30, 'LOW'],
    [
      'high volume and tickets',
      { monthlyVolumeCents: 200_000_000, averageTicketCents: 150_000 },
      55,
      'MEDIUM',
    ],
    ['a high-risk category', { mcc: '7995' }, 60, 'MEDIUM'],
    [
      'everything at once (capped)',
      {
        mcc: '6051',
        monthlyVolumeCents: 200_000_000,
        averageTicketCents: 150_000,
        businessType: 'SOLE_PROPRIETORSHIP',
      },
      100,
      'HIGH',
    ],
  ])('scores %s', async (_case, overrides, score, result) => {
    const request = { ...coffeeShop, ...overrides };
    expect(scoreOf(request)).toBe(score);
    await expect(provider().assess(request, 'key')).resolves.toEqual({ score, result });
  });

  it('answers the same request the same way every time', async () => {
    const simulated = provider();
    const first = await simulated.assess(coffeeShop, 'key');
    await expect(simulated.assess(coffeeShop, 'key')).resolves.toEqual(first);
  });

  it('fails the first N calls for each key, then answers', async () => {
    const simulated = provider(2);

    await expect(simulated.assess(coffeeShop, 'a:1')).rejects.toThrow('unavailable');
    await expect(simulated.assess(coffeeShop, 'a:1')).rejects.toThrow('unavailable');
    await expect(simulated.assess(coffeeShop, 'b:1')).rejects.toThrow('unavailable');
    await expect(simulated.assess(coffeeShop, 'a:1')).resolves.toMatchObject({ result: 'LOW' });
  });
});
