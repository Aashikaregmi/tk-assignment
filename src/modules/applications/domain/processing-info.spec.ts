import { InvalidApplicationData } from './errors';
import { ProcessingInfo, ProcessingInfoProps } from './processing-info';

const valid: ProcessingInfoProps = {
  monthlyVolumeCents: 2_500_000,
  averageTicketCents: 4_500,
  mcc: '5812',
};

describe('ProcessingInfo', () => {
  it('keeps valid values', () => {
    expect(new ProcessingInfo(valid)).toEqual(valid);
  });

  it('allows an average ticket equal to the monthly volume', () => {
    const single = { ...valid, averageTicketCents: valid.monthlyVolumeCents };
    expect(() => new ProcessingInfo(single)).not.toThrow();
  });

  it.each<[string, Partial<ProcessingInfoProps>, RegExp]>([
    ['fractional cents', { monthlyVolumeCents: 2_500_000.5 }, /monthlyVolumeCents/],
    ['zero volume', { monthlyVolumeCents: 0 }, /monthlyVolumeCents/],
    ['negative ticket', { averageTicketCents: -1 }, /averageTicketCents/],
    ['NaN', { averageTicketCents: Number.NaN }, /averageTicketCents/],
    ['beyond safe integers', { monthlyVolumeCents: 2 ** 53 }, /monthlyVolumeCents/],
    ['ticket above volume', { averageTicketCents: 2_500_001 }, /cannot exceed/],
    ['3-digit MCC', { mcc: '581' }, /mcc/],
    ['5-digit MCC', { mcc: '58121' }, /mcc/],
    ['non-numeric MCC', { mcc: '58a2' }, /mcc/],
  ])('rejects %s', (_case, override, message) => {
    const create = () => new ProcessingInfo({ ...valid, ...override });
    expect(create).toThrow(InvalidApplicationData);
    expect(create).toThrow(message);
  });
});
