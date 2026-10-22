import { Injectable } from '@nestjs/common';
import { TypeOrmUnitOfWork } from '@shared/infrastructure/database/typeorm-unit-of-work';
import { UserOrmEntity } from './user.orm-entity';

@Injectable()
export class UsersService {
  constructor(private readonly uow: TypeOrmUnitOfWork) {}

  findById(id: string): Promise<UserOrmEntity | null> {
    return this.uow.manager.findOneBy(UserOrmEntity, { id });
  }

  // Case-insensitive; matches the unique index on lower(email).
  findByEmail(email: string): Promise<UserOrmEntity | null> {
    return this.uow.manager
      .createQueryBuilder(UserOrmEntity, 'user')
      .where('lower(user.email) = lower(:email)', { email })
      .getOne();
  }
}
