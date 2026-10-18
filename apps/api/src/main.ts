import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

// Prisma returns BigInt for the schema's BigInt columns (GithubInstallation
// .installationId, Repository.githubId), and neither JSON.stringify nor
// Express's res.json() know how to serialize those natively. Rendering them
// as numeric strings is the standard fix — precision loss from a plain
// `number` would be a real risk for GitHub's actual id range.
declare global {
  interface BigInt {
    toJSON(): string;
  }
}
BigInt.prototype.toJSON = function (this: bigint): string {
  return this.toString();
};

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
