import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedJsonStore } from "./encrypted-json-store.js";

const directory = mkdtempSync(join(tmpdir(), "autodocbot-store-check-"));
const filePath = join(directory, "connections.json");
const key = randomBytes(32);

try {
  const first = new EncryptedJsonStore<{ accessToken: string }>(filePath, key);
  first.set("tenant:user", { accessToken: "sensitive-test-token" });

  const rawFile = readFileSync(filePath, "utf8");
  if (rawFile.includes("sensitive-test-token")) {
    throw new Error("Token wurde unverschlüsselt gespeichert.");
  }

  const second = new EncryptedJsonStore<{ accessToken: string }>(filePath, key);
  if (second.get("tenant:user")?.accessToken !== "sensitive-test-token") {
    throw new Error("Verschlüsselte Verbindung konnte nicht wieder geladen werden.");
  }

  second.delete("tenant:user");
  const third = new EncryptedJsonStore<{ accessToken: string }>(filePath, key);
  if (third.get("tenant:user")) {
    throw new Error("Gelöschte Verbindung ist weiterhin vorhanden.");
  }

  console.log("Verschlüsselter Token Store erfolgreich geprüft.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
