import { InvalidApplicationData } from './errors';

export interface ProcessingInfoProps {
  monthlyVolumeCents: number;
  averageTicketCents: number;
  mcc: string;
}

const MCC = /^\d{4}$/;

// Requested card processing. Money is integer cents: no floating-point rounding.
export class ProcessingInfo implements ProcessingInfoProps {
  readonly monthlyVolumeCents: number;
  readonly averageTicketCents: number;
  readonly mcc: string;

  constructor(props: ProcessingInfoProps) {
    requirePositiveCents('monthlyVolumeCents', props.monthlyVolumeCents);
    requirePositiveCents('averageTicketCents', props.averageTicketCents);
    if (props.averageTicketCents > props.monthlyVolumeCents) {
      throw new InvalidApplicationData('averageTicketCents cannot exceed monthlyVolumeCents');
    }
    if (!MCC.test(props.mcc)) {
      throw new InvalidApplicationData('mcc must be a 4-digit merchant category code');
    }
    this.monthlyVolumeCents = props.monthlyVolumeCents;
    this.averageTicketCents = props.averageTicketCents;
    this.mcc = props.mcc;
  }
}

function requirePositiveCents(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidApplicationData(`${field} must be a positive whole number of cents`);
  }
}
