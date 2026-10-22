import type { MerchantApplication } from '../domain/merchant-application';

// Port. Abstract class so it can be a DI token; the TypeORM adapter comes in S22.
export abstract class ApplicationRepository {
  // Locks the row until the surrounding unit of work ends, serializing concurrent commands.
  abstract findByIdForUpdate(id: string): Promise<MerchantApplication | null>;
  abstract save(application: MerchantApplication): Promise<void>;
}
