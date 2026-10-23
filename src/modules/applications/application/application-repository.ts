import type { MerchantApplication } from '../domain/merchant-application';

// Port. Abstract class so it can be a DI token.
export abstract class ApplicationRepository {
  // No lock, no transaction needed: for reads that decide whether to do slow work at all.
  abstract findById(id: string): Promise<MerchantApplication | null>;
  // Locks the row until the surrounding unit of work ends, serializing concurrent commands.
  abstract findByIdForUpdate(id: string): Promise<MerchantApplication | null>;
  abstract save(application: MerchantApplication): Promise<void>;
}
