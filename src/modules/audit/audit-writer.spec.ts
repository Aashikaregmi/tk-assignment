import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { AuditLogOrmEntity } from './audit-log.orm-entity';
import { AuditEntry, AuditWriter } from './audit-writer';

const entry: AuditEntry = {
  actorId: 'admin-1',
  action: 'ApplicationUpdated',
  entityType: 'MerchantApplication',
  entityId: 'app-1',
};

describe('AuditWriter', () => {
  let save: jest.Mock;
  let writer: AuditWriter;

  beforeEach(() => {
    save = jest.fn().mockResolvedValue(undefined);
    writer = new AuditWriter({ manager: { save } } as unknown as TypeOrmUnitOfWork);
  });

  it('masks personal data and redacts secrets in metadata, keeping the rest', async () => {
    // Fake data only.
    const metadata = {
      fields: ['ownerContact', 'businessName'],
      ownerContact: { fullName: 'Jane Example', email: 'jane@example.com', phone: '+15550100123' },
      businessName: 'Example Coffee',
      refreshToken: 'not-a-real-token',
    };

    await writer.write({ ...entry, metadata });

    expect(save).toHaveBeenCalledWith(AuditLogOrmEntity, {
      ...entry,
      metadata: {
        fields: ['ownerContact', 'businessName'],
        ownerContact: { fullName: 'J***', email: 'j***@example.com', phone: '***0123' },
        businessName: 'Example Coffee',
        refreshToken: '[REDACTED]',
      },
    });
    expect(metadata.ownerContact.email).toBe('jane@example.com');
  });

  it('writes empty metadata when there is none', async () => {
    await writer.write(entry);
    expect(save).toHaveBeenCalledWith(AuditLogOrmEntity, { ...entry, metadata: {} });
  });
});
