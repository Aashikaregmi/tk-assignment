import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppConfig } from '@shared/infrastructure/config/app-config';
import { RiskReviewWorker } from '@modules/applications';
import { OutboxRelay } from '@modules/outbox';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // Runs shutdown lifecycle hooks on SIGTERM so connections and workers close cleanly.
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Merchant Applications API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(app.get(AppConfig).PORT);
  app.get(OutboxRelay).start();
  app.get(RiskReviewWorker).start();
}

void bootstrap();
