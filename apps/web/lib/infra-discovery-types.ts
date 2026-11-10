import type { InfraDeviceCategory } from "./infra-types";

export interface DetectedLocalNetwork {
  interfaceName?: string;
  localAddress?: string;
  subnetCidr: string | null;
  gateway?: string;
}

export interface DiscoveryCandidate {
  ip: string;
  mac?: string;
  vendorGuess?: string;
  isGateway: boolean;
  alreadyKnown: boolean;
  existingDeviceId?: string;
  existingDeviceName?: string;
  suggestedName: string;
  suggestedCategory: InfraDeviceCategory;
}

export interface NetworkScanResult extends DetectedLocalNetwork {
  scannedAt: string;
  usedNmap: boolean;
  candidates: DiscoveryCandidate[];
}
