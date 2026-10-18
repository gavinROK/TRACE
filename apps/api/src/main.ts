import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
