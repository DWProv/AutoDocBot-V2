import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type AccountLinkPayload = {
  userId: string;
  expiresAt: number;
  nonce: string;
};

export class OneTimeAccountLinkStore {
  readonly #secret: string;
  readonly #ttlMs: number;
  readonly #issued = new Map<string, { userId: string; expiresAt: number }>();

  constructor(secret: string, ttlMs = 10 * 60 * 1000) {
    this.#secret = secret;
    this.#ttlMs = ttlMs;
  }

  create(userId: string): string {
    this.purgeExpired();
    for (const [nonce, link] of this.#issued) {
      if (link.userId === userId) this.#issued.delete(nonce);
    }
    const payload: AccountLinkPayload = {
      userId,
      expiresAt: Date.now() + this.#ttlMs,
      nonce: randomBytes(18).toString("base64url"),
    };
    this.#issued.set(payload.nonce, {
      userId: payload.userId,
      expiresAt: payload.expiresAt,
    });
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );
    const signature = this.#sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  consume(token: string): string {
    const [encodedPayload, suppliedSignature] = token.split(".");
    if (!encodedPayload || !suppliedSignature) {
      throw new Error("Der Kontoverknüpfungs-Link ist ungültig.");
    }

    const expectedSignature = Buffer.from(this.#sign(encodedPayload), "base64url");
    const actualSignature = Buffer.from(suppliedSignature, "base64url");
    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw new Error("Die Signatur des Kontoverknüpfungs-Links ist ungültig.");
    }

    let payload: AccountLinkPayload;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      ) as AccountLinkPayload;
    } catch {
      throw new Error("Der Kontoverknüpfungs-Link enthält ungültige Daten.");
    }
    if (
      typeof payload.userId !== "string" ||
      typeof payload.expiresAt !== "number" ||
      typeof payload.nonce !== "string"
    ) {
      throw new Error("Der Kontoverknüpfungs-Link enthält ungültige Daten.");
    }

    const issued = this.#issued.get(payload.nonce);
    if (
      !issued ||
      issued.userId !== payload.userId ||
      issued.expiresAt !== payload.expiresAt
    ) {
      throw new Error(
        "Der Kontoverknüpfungs-Link wurde bereits verwendet oder ist nicht mehr aktiv.",
      );
    }

    this.#issued.delete(payload.nonce);
    if (payload.expiresAt <= Date.now()) {
      throw new Error("Der Kontoverknüpfungs-Link ist abgelaufen.");
    }
    return payload.userId;
  }

  purgeExpired(): void {
    const now = Date.now();
    for (const [nonce, link] of this.#issued) {
      if (link.expiresAt <= now) this.#issued.delete(nonce);
    }
  }

  #sign(encodedPayload: string): string {
    return createHmac("sha256", this.#secret)
      .update(encodedPayload)
      .digest("base64url");
  }

}
