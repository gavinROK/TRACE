import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CredentialsService } from "./credentials.service";
import { decryptSecret, encryptSecret } from "./secret-cipher";

jest.mock("./secret-cipher");

describe("CredentialsService", () => {
  const prisma = {
    infraEnvironment: { findUnique: jest.fn() },
    infraDevice: { findFirst: jest.fn() },
    infraCredential: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
  };
  const masterKeyStore = { getKey: jest.fn() };
  const service = new CredentialsService(prisma as never, masterKeyStore as never);

  beforeEach(() => {
    jest.clearAllMocks();
    masterKeyStore.getKey.mockResolvedValue(Buffer.alloc(32));
    (encryptSecret as jest.Mock).mockReturnValue({ encryptedPayload: "enc", iv: "iv", authTag: "tag" });
  });

  describe("create", () => {
    it("rejects an unknown environment", async () => {
      prisma.infraEnvironment.findUnique.mockResolvedValue(null);

      await expect(
        service.create("env1", { label: "x", protocol: "SSH" as never, payload: {} }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.infraCredential.create).not.toHaveBeenCalled();
    });

    it("rejects a deviceId that belongs to a different environment", async () => {
      prisma.infraEnvironment.findUnique.mockResolvedValue({ id: "env1" });
      prisma.infraDevice.findFirst.mockResolvedValue(null);

      await expect(
        service.create("env1", { label: "x", protocol: "SSH" as never, deviceId: "d-other-env", payload: {} }),
      ).rejects.toThrow(BadRequestException);
    });

    it("encrypts the payload before storing it, never the plaintext", async () => {
      prisma.infraEnvironment.findUnique.mockResolvedValue({ id: "env1" });
      prisma.infraCredential.create.mockResolvedValue({
        id: "c1",
        environmentId: "env1",
        deviceId: null,
        label: "beelink-ssh",
        protocol: "SSH",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.create("env1", { label: "beelink-ssh", protocol: "SSH" as never, payload: { password: "super-secret" } });

      expect(encryptSecret).toHaveBeenCalledWith({ password: "super-secret" }, Buffer.alloc(32));
      expect(prisma.infraCredential.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ encryptedPayload: "enc", iv: "iv", authTag: "tag" }),
      });
      const call = prisma.infraCredential.create.mock.calls[0][0];
      expect(JSON.stringify(call)).not.toContain("super-secret");
    });
  });

  describe("getDecryptedForDevice", () => {
    it("returns undefined when no matching credential exists", async () => {
      prisma.infraCredential.findFirst.mockResolvedValue(null);

      const result = await service.getDecryptedForDevice("env1", "d1", "SSH" as never);

      expect(result).toBeUndefined();
    });

    it("prefers a device-specific credential over an environment-wide one", async () => {
      prisma.infraCredential.findFirst.mockResolvedValue({
        encryptedPayload: "enc",
        iv: "iv",
        authTag: "tag",
      });
      (decryptSecret as jest.Mock).mockReturnValue({ username: "gavin" });

      const result = await service.getDecryptedForDevice("env1", "d1", "SSH" as never);

      expect(prisma.infraCredential.findFirst).toHaveBeenCalledWith({
        where: { environmentId: "env1", protocol: "SSH", OR: [{ deviceId: "d1" }, { deviceId: null }] },
        orderBy: [{ deviceId: "desc" }, { createdAt: "desc" }],
      });
      expect(result).toEqual({ protocol: "SSH", payload: { username: "gavin" } });
    });
  });

  describe("remove", () => {
    it("throws NotFoundException for a credential outside the environment", async () => {
      prisma.infraCredential.findFirst.mockResolvedValue(null);

      await expect(service.remove("env1", "missing")).rejects.toThrow(NotFoundException);
      expect(prisma.infraCredential.delete).not.toHaveBeenCalled();
    });

    it("deletes a credential that belongs to the environment", async () => {
      prisma.infraCredential.findFirst.mockResolvedValue({ id: "c1" });

      await service.remove("env1", "c1");

      expect(prisma.infraCredential.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    });
  });

  describe("listForEnvironment", () => {
    it("never includes a decrypted payload in the returned metadata", async () => {
      prisma.infraCredential.findMany.mockResolvedValue([
        {
          id: "c1",
          environmentId: "env1",
          deviceId: "d1",
          label: "beelink-ssh",
          protocol: "SSH",
          encryptedPayload: "enc",
          iv: "iv",
          authTag: "tag",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.listForEnvironment("env1");

      expect(result).toEqual([
        expect.objectContaining({ id: "c1", label: "beelink-ssh", protocol: "SSH" }),
      ]);
      expect(result[0]).not.toHaveProperty("encryptedPayload");
      expect(result[0]).not.toHaveProperty("iv");
      expect(result[0]).not.toHaveProperty("authTag");
    });
  });
});
