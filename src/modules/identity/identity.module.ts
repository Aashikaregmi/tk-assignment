import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from '@shared/infrastructure/config/app-config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { jwtOptions } from './jwt-options';
import { PasswordHasher } from './password-hasher';
import { UsersService } from './users.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => jwtOptions(config.JWT_SECRET),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 5 }],
      errorMessage: 'Too many login attempts. Try again later.',
    }),
  ],
  controllers: [AuthController],
  providers: [UsersService, PasswordHasher, AuthService],
  exports: [UsersService],
})
export class IdentityModule {}
