import { Test } from "@nestjs/testing";
import { InfraModule } from "./infra.module";

/**
 * Resolves the entire infra-module dependency graph — the one check
 * that catches a module-wiring mistake (a missing export, a circular
 * dependency, a provider nobody registered) that `tsc` and ESLint
 * cannot see, since DI wiring is resolved at runtime. Scoped to
 * InfraModule rather than the full AppModule so this doesn't pull in
 * GithubModule's @octokit/auth-app dependency, which Jest can't load
 * here (it ships ESM-only — a pre-existing repo issue unrelated to the
 * infra work, not something to route around by weakening jest config
 * for every test). Never calls `app.init()`, so PrismaService's
 * `$connect()` never runs — no live Postgres needed.
 */
describe("InfraModule", () => {
  beforeAll(() => {
    process.env.TRACE_MASTER_KEY = Buffer.alloc(32, 1).toString("base64");
  });

  it("resolves the entire infra dependency graph", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InfraModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
