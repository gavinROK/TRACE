import { Injectable } from "@nestjs/common";
import { InfraManagementProtocol, InfraMetricKind } from "@prisma/client";
import * as snmp from "net-snmp";
import type {
  ConnectorCapability,
  ConnectorTarget,
  HealthResult,
  InfraConnector,
  MetricReading,
} from "../connector.types";
import { ConnectorError } from "../connector.types";

interface SnmpV3CredentialPayload {
  username: string;
  authProtocol: "SHA" | "MD5";
  authKey: string;
  privProtocol?: "AES" | "DES";
  privKey?: string;
  port?: number;
}

const OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0";
const OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0";
const OID_IF_TABLE = "1.3.6.1.2.1.2.2.1";

/**
 * SNMPv3 read-only connector (PRODUCT_SPEC.md section 10, Priority 3).
 * Deliberately exposes no executeCommand/performAction — SNMP read
 * access must never be treated as implying write/configuration access,
 * so this connector cannot claim a capability it doesn't have.
 */
@Injectable()
export class SnmpConnector implements InfraConnector {
  readonly protocol = InfraManagementProtocol.SNMP_V3;

  getCapabilities(): ConnectorCapability[] {
    return ["getHealth", "getConfiguration", "getMetrics"];
  }

  async getHealth(target: ConnectorTarget): Promise<HealthResult> {
    try {
      const varbinds = await this.get(target, [OID_SYS_UPTIME]);
      if (snmp.isVarbindError(varbinds[0])) {
        throw new ConnectorError(snmp.varbindError(varbinds[0]));
      }
      return { onlineState: "ONLINE", checkedAt: new Date() };
    } catch (error) {
      return {
        onlineState: "OFFLINE",
        checkedAt: new Date(),
        detail: error instanceof Error ? error.message : "unreachable",
      };
    }
  }

  async getConfiguration(target: ConnectorTarget): Promise<Record<string, unknown>> {
    const varbinds = await this.get(target, [OID_SYS_DESCR, OID_SYS_UPTIME]);
    return {
      sysDescr: this.decodeValue(varbinds[0]),
      sysUpTimeTicks: this.decodeValue(varbinds[1]),
    };
  }

  /** Walks the interface table and reports each interface's operational
   * link speed as a CUSTOM metric reading, labeled by ifDescr. Interface
   * counters/errors (ifInErrors, ifOutErrors) are a documented follow-up
   * — see docs/ARCHITECTURE.md. */
  async getMetrics(target: ConnectorTarget): Promise<MetricReading[]> {
    const table = await this.walk(target, OID_IF_TABLE);
    const collectedAt = new Date();
    const descrByIndex = new Map<string, string>();
    const readings: MetricReading[] = [];

    for (const varbind of table) {
      const [, column, index] = varbind.oid.match(/^1\.3\.6\.1\.2\.1\.2\.2\.1\.(\d+)\.(\d+)$/) ?? [];
      if (!column || !index) continue;
      if (column === "2") {
        descrByIndex.set(index, this.decodeValue(varbind) as string);
      }
      if (column === "5") {
        readings.push({
          kind: InfraMetricKind.CUSTOM,
          label: `ifSpeed[${descrByIndex.get(index) ?? index}]`,
          value: Number(this.decodeValue(varbind)),
          unit: "bps",
          collectedAt,
        });
      }
    }
    return readings;
  }

  private get(target: ConnectorTarget, oids: string[]): Promise<snmp.Varbind[]> {
    const session = this.openSession(target);
    return new Promise((resolve, reject) => {
      session.get(oids, (error, varbinds) => {
        session.close();
        if (error) reject(new ConnectorError(`SNMP GET failed: ${error.message}`, error));
        else resolve(varbinds ?? []);
      });
    });
  }

  private walk(target: ConnectorTarget, baseOid: string): Promise<snmp.Varbind[]> {
    const session = this.openSession(target);
    const collected: snmp.Varbind[] = [];
    return new Promise((resolve, reject) => {
      session.subtree(
        baseOid,
        (varbinds: snmp.Varbind[]) => collected.push(...varbinds),
        (error: Error | null) => {
          session.close();
          if (error) reject(new ConnectorError(`SNMP WALK failed: ${error.message}`, error));
          else resolve(collected);
        },
      );
    });
  }

  private openSession(target: ConnectorTarget): snmp.Session {
    const credential = target.credential?.payload as SnmpV3CredentialPayload | undefined;
    if (!credential?.username || !credential.authKey) {
      throw new ConnectorError(`No SNMPv3 credential attached to device ${target.deviceId}`);
    }
    const user = {
      name: credential.username,
      level: credential.privKey ? snmp.SecurityLevel.authPriv : snmp.SecurityLevel.authNoPriv,
      authProtocol: credential.authProtocol === "MD5" ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha,
      authKey: credential.authKey,
      privProtocol: credential.privProtocol === "DES" ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes,
      privKey: credential.privKey,
    };
    return snmp.createV3Session(target.host, user, { port: credential.port ?? 161, timeout: 5_000 });
  }

  private decodeValue(varbind: snmp.Varbind): unknown {
    if (snmp.isVarbindError(varbind)) {
      throw new ConnectorError(snmp.varbindError(varbind));
    }
    return Buffer.isBuffer(varbind.value) ? varbind.value.toString("utf8") : varbind.value;
  }
}
