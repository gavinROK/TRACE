/** Shared by DeviceProfilePanel and DeviceInventoryPanel. */
export function formatPostureFlag(value: boolean | null): string {
  if (value === null) return "Unknown";
  return value ? "Yes" : "No";
}

export const DEVICE_TYPE_OPTIONS = [
  { value: "LAPTOP", label: "Laptop" },
  { value: "DESKTOP", label: "Desktop" },
  { value: "MOBILE", label: "Mobile" },
  { value: "SERVER", label: "Server" },
  { value: "SWITCH", label: "Switch" },
  { value: "ROUTER", label: "Router" },
  { value: "ACCESS_POINT", label: "Access Point" },
  { value: "VIRTUAL_MACHINE", label: "Virtual Machine" },
  { value: "OTHER", label: "Other" },
];
