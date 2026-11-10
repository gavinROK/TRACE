import { ForbiddenException } from "@nestjs/common";
import { AiActionClassification } from "@prisma/client";
import { CredentialEnrollmentController } from "./credential-enrollment.controller";

function fakeReq(actor: string) {
  return { actor } as never;
}

describe("CredentialEnrollmentController — actor gating", () => {
  const enrollment = { isEnabled: jest.fn(), getActive: jest.fn(), complete: jest.fn(), cancel: jest.fn() };
  const approvals = { create: jest.fn() };
  const controller = new CredentialEnrollmentController(enrollment as never, approvals as never);

  beforeEach(() => jest.clearAllMocks());

  describe("propose", () => {
    it("refuses a real browser session outright — it should use the device panel's own credential form", async () => {
      await expect(
        controller.propose(fakeReq("user:u1"), "env1", "d1", { protocol: "SSH" as never }),
      ).rejects.toThrow(ForbiddenException);
      expect(approvals.create).not.toHaveBeenCalled();
    });

    it("refuses the MCP actor when the capability is disabled, creating no pending action", async () => {
      enrollment.isEnabled.mockReturnValue(false);

      await expect(
        controller.propose(fakeReq("claude-mcp"), "env1", "d1", { protocol: "SSH" as never }),
      ).rejects.toThrow(ForbiddenException);
      expect(approvals.create).not.toHaveBeenCalled();
    });

    it("creates an ADMINISTRATIVE pending action for the MCP actor once enabled — never carries a secret", async () => {
      enrollment.isEnabled.mockReturnValue(true);
      approvals.create.mockResolvedValue({ id: "pa1" });

      const result = await controller.propose(fakeReq("claude-mcp"), "env1", "d1", { protocol: "SSH" as never, label: "router-ssh" });

      expect(approvals.create).toHaveBeenCalledWith({
        environmentId: "env1",
        toolName: "request_credential_enrollment",
        toolInput: { deviceId: "d1", protocol: "SSH", label: "router-ssh" },
        classification: AiActionClassification.ADMINISTRATIVE,
        requestedBy: "claude-mcp",
      });
      expect(result).toEqual(expect.objectContaining({ pending: true, pendingActionId: "pa1" }));
    });
  });

  describe("getActive", () => {
    it("is readable by either actor — never returns a secret, only session metadata", async () => {
      enrollment.getActive.mockResolvedValue({ id: "ces1", status: "AUTHORIZED" });

      const result = await controller.getActive("env1", "d1");

      expect(enrollment.getActive).toHaveBeenCalledWith("env1", "d1");
      expect(result).toEqual({ id: "ces1", status: "AUTHORIZED" });
    });
  });

  describe("complete", () => {
    it("refuses the MCP actor — a secret can only ever arrive from a real browser session", async () => {
      await expect(
        controller.complete(fakeReq("claude-mcp"), "env1", "ces1", { label: "x", payload: { password: "p" } }),
      ).rejects.toThrow(ForbiddenException);
      expect(enrollment.complete).not.toHaveBeenCalled();
    });

    it("lets a real browser session complete its own authorized session", async () => {
      enrollment.complete.mockResolvedValue({ id: "cred1" });

      const result = await controller.complete(fakeReq("user:u1"), "env1", "ces1", { label: "router-ssh", payload: { password: "p" } });

      expect(enrollment.complete).toHaveBeenCalledWith("env1", "ces1", "user:u1", { label: "router-ssh", payload: { password: "p" } });
      expect(result).toEqual({ id: "cred1" });
    });
  });

  describe("cancel", () => {
    it("refuses the MCP actor", async () => {
      await expect(controller.cancel(fakeReq("claude-mcp"), "env1", "ces1")).rejects.toThrow(ForbiddenException);
      expect(enrollment.cancel).not.toHaveBeenCalled();
    });

    it("lets a real browser session cancel at any time", async () => {
      const result = await controller.cancel(fakeReq("user:u1"), "env1", "ces1");

      expect(enrollment.cancel).toHaveBeenCalledWith("env1", "ces1", "user:u1");
      expect(result).toEqual({ ok: true });
    });
  });
});
