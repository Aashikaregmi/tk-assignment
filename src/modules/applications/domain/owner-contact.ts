import { InvalidApplicationData } from './errors';

export interface OwnerContactProps {
  fullName: string;
  email: string;
  phone: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// E.164: +, country code, up to 15 digits in total.
const E164 = /^\+[1-9]\d{6,14}$/;

// Personal data: masked in logs and audit by the sensitive-field registry (fullName, email, phone).
export class OwnerContact implements OwnerContactProps {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;

  constructor(props: OwnerContactProps) {
    const fullName = props.fullName.trim();
    const email = props.email.trim();
    if (fullName.length === 0 || fullName.length > 200) {
      throw new InvalidApplicationData('fullName must be 1 to 200 characters');
    }
    if (email.length > 254 || !EMAIL.test(email)) {
      throw new InvalidApplicationData('email must be a valid email address');
    }
    if (!E164.test(props.phone)) {
      throw new InvalidApplicationData('phone must be in E.164 format, e.g. +15550100123');
    }
    this.fullName = fullName;
    this.email = email;
    this.phone = props.phone;
  }
}
