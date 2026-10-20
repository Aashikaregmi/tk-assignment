import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

@Module({
  providers: [
    {
      // Registered here, not in main.ts, so e2e tests built from AppModule run the same validation.
      // whitelist + forbidNonWhitelisted reject unknown body fields, which blocks mass assignment
      // (e.g. a SALES user sending `status: "APPROVED"` in a PATCH).
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
  ],
})
export class AppModule {}
