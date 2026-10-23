import { Injectable } from '@nestjs/common';
import { UsersService } from '@modules/identity';
import { ReviewerDirectory } from '../application/reviewer-directory';

@Injectable()
export class IdentityReviewerDirectory implements ReviewerDirectory {
  constructor(private readonly users: UsersService) {}

  async isReviewer(userId: string): Promise<boolean> {
    return (await this.users.findById(userId))?.role === 'REVIEWER';
  }
}
