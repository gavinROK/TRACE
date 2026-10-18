import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { GithubWebhookController } from "./github-webhook.controller";

const SECRET = "test-webhook-secret";

function sign(body: Buffer): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function requestWith(payload: object): { rawBody: Buffer } {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return { rawBody };
}

describe("GithubWebhookController", () => {
  const config = { get: jest.fn() };
  const prisma = { githubInstallation: { deleteMany: jest.fn() } };
  const controller = new GithubWebhookController(config as never, prisma as never);

  beforeEach(() => {
    config.get.mockReturnValue(SECRET);
    prisma.githubInstallation.deleteMany.mockReset();
  });

  it("rejects when no webhook secret is configured", async () => {
    config.get.mockReturnValue(undefined);
    const payload = { zen: "test" };

    await expect(
      controller.handle(
        requestWith(payload) as never,
        sign(Buffer.from(JSON.stringify(payload))),
        "ping",
      ),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("rejects an invalid signature", async () => {
    const payload = { zen: "test" };

    await expect(
      controller.handle(requestWith(payload) as never, "sha256=wrong", "ping"),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("acknowledges a correctly-signed ping event", async () => {
    const payload = { zen: "test" };
    const req = requestWith(payload);

    const result = await controller.handle(req as never, sign(req.rawBody), "ping");

    expect(result).toEqual({ ok: true });
  });

  it("deletes the installation on installation.deleted", async () => {
    const payload = { action: "deleted", installation: { id: 42 } };
    const req = requestWith(payload);

    const result = await controller.handle(req as never, sign(req.rawBody), "installation");

    expect(result).toEqual({ received: true, processed: true });
    expect(prisma.githubInstallation.deleteMany).toHaveBeenCalledWith({
      where: { installationId: 42n },
    });
  });

  it("does not touch the installation on non-deleted installation actions", async () => {
    const payload = { action: "created", installation: { id: 42 } };
    const req = requestWith(payload);

    await controller.handle(req as never, sign(req.rawBody), "installation");

    expect(prisma.githubInstallation.deleteMany).not.toHaveBeenCalled();
  });

  it("acknowledges but does not process an unhandled event type", async () => {
    const payload = { anything: true };
    const req = requestWith(payload);

    const result = await controller.handle(req as never, sign(req.rawBody), "star");

    expect(result).toEqual({ received: true, processed: false });
  });
});
