import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: true preserves the exact request bytes on req.rawBody so the
  // GitHub webhook handler can verify X-Hub-Signature-256 against them —
  // signature verification does not work against a re-serialized body.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Phase 1 of the backend: the frontend is a separate origin in local dev.
  // This will narrow to an explicit allowlist once real auth is added.
  app.enableCors();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`TRACE API listening on http://localhost:${port}`);
}

void bootstrap();
