import { MasterKeyStore } from "./master-key.store";

const execFileMock = jest.fn();
jest.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

describe("MasterKeyStore", () => {
  const originalEnv = process.env.TRACE_MASTER_KEY;
  const originalPlatform = process.platform;

  afterEach(() => {
    process.env.TRACE_MASTER_KEY = originalEnv;
    Object.defineProperty(process, "platform", { value: originalPlatform });
    execFileMock.mockReset();
  });

  it("uses TRACE_MASTER_KEY when set, without touching the Keychain", async () => {
    process.env.TRACE_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

    const store = new MasterKeyStore();
    const key = await store.getKey();

    expect(key).toHaveLength(32);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects a TRACE_MASTER_KEY override that is not 32 bytes", async () => {
    process.env.TRACE_MASTER_KEY = Buffer.alloc(16, 1).toString("base64");

    const store = new MasterKeyStore();

    await expect(store.getKey()).rejects.toThrow(/32 bytes/);
  });

  it("reads an existing key from the Keychain on macOS", async () => {
    delete process.env.TRACE_MASTER_KEY;
    Object.defineProperty(process, "platform", { value: "darwin" });
    const existingKey = Buffer.alloc(32, 9).toString("base64");
    execFileMock.mockImplementation((_cmd: string, _args: string[], callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      callback(null, { stdout: `${existingKey}\n`, stderr: "" });
    });

    const store = new MasterKeyStore();
    const key = await store.getKey();

    expect(key.toString("base64")).toBe(existingKey);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0][1]).toContain("find-generic-password");
  });

  it("generates and stores a new key when none exists yet", async () => {
    delete process.env.TRACE_MASTER_KEY;
    Object.defineProperty(process, "platform", { value: "darwin" });
    execFileMock.mockImplementation(
      (_cmd: string, args: string[], callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
        if (args.includes("find-generic-password")) {
          callback(new Error("not found"));
        } else {
          callback(null, { stdout: "", stderr: "" });
        }
      },
    );

    const store = new MasterKeyStore();
    const key = await store.getKey();

    expect(key).toHaveLength(32);
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock.mock.calls[1][1]).toContain("add-generic-password");
  });

  it("throws on a non-macOS platform with no override set", async () => {
    delete process.env.TRACE_MASTER_KEY;
    Object.defineProperty(process, "platform", { value: "linux" });

    const store = new MasterKeyStore();

    await expect(store.getKey()).rejects.toThrow(/TRACE_MASTER_KEY/);
  });
});
