import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from '@shared/infrastructure/config/app-config.module';
import { LoggingModule } from '@shared/infrastructure/logging/logging.module';

@Module({
  imports: [AppConfigModule, LoggingModule],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
