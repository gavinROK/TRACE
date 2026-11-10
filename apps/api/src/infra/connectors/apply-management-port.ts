import type { ConnectorCredential } from "./connector.types";

/** Lets the device-level `managementPort` (editable from the device
 * settings panel) act as the default port for a connector call, without
 * requiring the operator to also repeat it inside every credential's
 * payload. A port already present in the credential payload (e.g. a
 * non-standard SSH port saved there) always wins. */
export function withManagementPort(
  credential: ConnectorCredential,
  managementPort: number | null | undefined,
): ConnectorCredential {
  if (managementPort == null || credential.payload.port !== undefined) {
    return credential;
  }
  return { ...credential, payload: { ...credential.payload, port: managementPort } };
}
