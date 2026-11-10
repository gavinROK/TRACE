import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { ConnectorCredential } from "../connectors/connector.types";
import { CreateCredentialDto } from "./dto/create-credential.dto";
import { MasterKeyStore } from "./master-key.store";
import { decryptSecret, encryptSecret } from "./secret-cipher";

/**
 * Owns every InfraCredential row. No other service may read or write
 * these rows directly — in particular, `getDecryptedForConnector` is the
 * only way to get plaintext back out, it is never called from a
 * controller, and nothing that returns an HTTP response ever includes a
 * decrypted payload (see credentials.controller.ts, which only returns
 * metadata).
 */
@Injectable()
export class CredentialsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MasterKeyStore) private readonly masterKeyStore: MasterKeyStore,
  ) {}

  async create(environmentId: string, dto: CreateCredentialDto) {
    const environment = await this.prisma.infraEnvironment.findUnique({ where: { id: environmentId } });
    if (!environment) {
      throw new NotFoundException("Environment not found");
    }
    if (dto.deviceId) {
      const device = await this.prisma.infraDevice.findFirst({
        where: { id: dto.deviceId, environmentId },
        select: { id: true },
      });
      if (!device) {
        throw new BadRequestException("deviceId must belong to the same environment");
      }
    }

    const masterKey = await this.masterKeyStore.getKey();
    const encrypted = encryptSecret(dto.payload, masterKey);

    const credential = await this.prisma.infraCredential.create({
      data: {
        environmentId,
        deviceId: dto.deviceId,
        label: dto.label,
        protocol: dto.protocol,
        encryptedPayload: encrypted.encryptedPayload,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
    });

    return this.toMetadata(credential);
  }

  async listForEnvironment(environmentId: string) {
    const credentials = await this.prisma.infraCredential.findMany({
      where: { environmentId },
      orderBy: { createdAt: "desc" },
    });
    return credentials.map((credential) => this.toMetadata(credential));
  }

  async remove(environmentId: string, credentialId: string): Promise<void> {
    const credential = await this.prisma.infraCredential.findFirst({
      where: { id: credentialId, environmentId },
      select: { id: true },
    });
    if (!credential) {
      throw new NotFoundException("Credential not found");
    }
    await this.prisma.infraCredential.delete({ where: { id: credentialId } });
  }

  /** Finds the most recently created credential for a device (or, if
   * none is device-specific, the environment's most recent one for that
   * protocol) and decrypts it for exactly one connector call. Never
   * returned from a controller. */
  async getDecryptedForDevice(
    environmentId: string,
    deviceId: string,
    protocol: ConnectorCredential["protocol"],
  ): Promise<ConnectorCredential | undefined> {
    const credential = await this.prisma.infraCredential.findFirst({
      where: {
        environmentId,
        protocol,
        OR: [{ deviceId }, { deviceId: null }],
      },
      orderBy: [{ deviceId: "desc" }, { createdAt: "desc" }],
    });
    if (!credential) return undefined;

    const masterKey = await this.masterKeyStore.getKey();
    const payload = decryptSecret(
      { encryptedPayload: credential.encryptedPayload, iv: credential.iv, authTag: credential.authTag },
      masterKey,
    );
    return { protocol, payload };
  }

  private toMetadata(credential: { id: string; environmentId: string; deviceId: string | null; label: string; protocol: string; createdAt: Date; updatedAt: Date }) {
    return {
      id: credential.id,
      environmentId: credential.environmentId,
      deviceId: credential.deviceId,
      label: credential.label,
      protocol: credential.protocol,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
}
