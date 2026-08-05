import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

type EncryptedValue = {
  iv: string;
  tag: string;
  ciphertext: string;
};

export class EncryptedJsonStore<T> {
  readonly #filePath: string;
  readonly #key: Buffer;
  readonly #values = new Map<string, T>();

  constructor(filePath: string, key: Buffer) {
    if (key.length !== 32) {
      throw new Error("Der Schlüssel für den Token Store muss 32 Byte lang sein.");
    }
    this.#filePath = filePath;
    this.#key = key;
    this.#load();
  }

  get(key: string): T | undefined {
    return this.#values.get(key);
  }

  set(key: string, value: T): void {
    this.#values.set(key, value);
    this.#persist();
  }

  delete(key: string): boolean {
    const deleted = this.#values.delete(key);
    if (deleted) this.#persist();
    return deleted;
  }

  #encrypt(value: T): EncryptedValue {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  #decrypt(value: EncryptedValue): T {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#key,
      Buffer.from(value.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  }

  #load(): void {
    if (!existsSync(this.#filePath)) return;
    const stored = JSON.parse(readFileSync(this.#filePath, "utf8")) as Record<
      string,
      EncryptedValue
    >;
    for (const [key, value] of Object.entries(stored)) {
      this.#values.set(key, this.#decrypt(value));
    }
  }

  #persist(): void {
    mkdirSync(dirname(this.#filePath), { recursive: true, mode: 0o700 });
    const serialized = Object.fromEntries(
      [...this.#values.entries()].map(([key, value]) => [key, this.#encrypt(value)]),
    );
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(serialized), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.#filePath);
  }
}

export function loadOrCreateEncryptionKey(options: {
  encodedKey?: string;
  localKeyPath: string;
  allowLocalKeyFile: boolean;
}): Buffer {
  if (options.encodedKey) {
    const key = Buffer.from(options.encodedKey, "base64");
    if (key.length !== 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY muss 32 Byte Base64-kodiert enthalten.");
    }
    return key;
  }
  if (!options.allowLocalKeyFile) {
    throw new Error("TOKEN_ENCRYPTION_KEY ist im Entra-Modus erforderlich.");
  }
  if (existsSync(options.localKeyPath)) {
    return readFileSync(options.localKeyPath);
  }
  mkdirSync(dirname(options.localKeyPath), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  writeFileSync(options.localKeyPath, key, { mode: 0o600 });
  return key;
}
