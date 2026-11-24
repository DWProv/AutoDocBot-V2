export type AtlassianToken = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

type RefreshableConnection = {
  token: AtlassianToken;
  tokenExpiresAt: number;
};

type ConnectionStore<T> = {
  get(userId: string): T | undefined;
  set(userId: string, connection: T): void;
  delete(userId: string): unknown;
};

function isInvalidRefreshToken(status: number, body: unknown): boolean {
  if (![400, 401, 403].includes(status) || !body || typeof body !== "object") {
    return false;
  }
  const { error, error_description } = body as Record<string, unknown>;
  if (error === "invalid_grant") return true;
  // Some Atlassian responses use unauthorized_client for an invalid refresh
  // token. A generic client/secret error must never delete user connections.
  return error === "unauthorized_client" &&
    typeof error_description === "string" &&
    /^(?:refresh_token is invalid|unknown or invalid refresh token)\.?$/iu.test(
      error_description.trim(),
    );
}

export function createAtlassianConnectionResolver<T extends RefreshableConnection>(
  options: {
    store: ConnectionStore<T>;
    clientId: string;
    clientSecret: string;
    fetch?: typeof fetch;
    onConnectionInvalidated?: (reason: "missing_refresh_token" | "invalid_refresh_token") => void;
  },
): (userId: string) => Promise<T | undefined> {
  const pendingRefreshes = new Map<string, Promise<T | undefined>>();

  function invalidate(userId: string, connection: T, reason: "missing_refresh_token" | "invalid_refresh_token") {
    // A completed browser login may already have replaced this connection.
    if (options.store.get(userId) !== connection) return options.store.get(userId);
    options.store.delete(userId);
    options.onConnectionInvalidated?.(reason);
    return undefined;
  }

  async function refresh(userId: string, connection: T): Promise<T | undefined> {
    if (!connection.token.refresh_token) {
      return invalidate(userId, connection, "missing_refresh_token");
    }

    let response: Response;
    let body: unknown;
    try {
      response = await (options.fetch ?? fetch)("https://auth.atlassian.com/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: options.clientId,
          client_secret: options.clientSecret,
          refresh_token: connection.token.refresh_token,
        }),
      });
      body = await response.json();
    } catch {
      // Network failures, timeouts and non-JSON error pages are not evidence
      // of revoked consent. Keep the connection and never expose response data.
      throw new Error("Die Atlassian-Verbindung konnte vorübergehend nicht geprüft werden. Bitte versuche es später erneut.");
    }

    if (!response.ok) {
      if (isInvalidRefreshToken(response.status, body)) {
        return invalidate(userId, connection, "invalid_refresh_token");
      }
      throw new Error(`Die Atlassian-Anmeldung konnte nicht erneuert werden (HTTP ${response.status}). Die gespeicherte Verbindung wurde beibehalten. Bitte versuche es später erneut; bei wiederholtem Fehler muss die Anwendungskonfiguration geprüft werden.`);
    }

    const token = body as Partial<AtlassianToken> | null;
    if (!token || typeof token.access_token !== "string" || !token.access_token ||
      typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0 ||
      (token.refresh_token !== undefined && (typeof token.refresh_token !== "string" || !token.refresh_token)) ||
      (token.scope !== undefined && typeof token.scope !== "string")) {
      throw new Error("Atlassian hat eine ungültige Antwort zur Token-Erneuerung geliefert. Die gespeicherte Verbindung wurde beibehalten.");
    }

    if (options.store.get(userId) !== connection) return options.store.get(userId);
    const refreshed: T = {
      ...connection,
      token: {
        access_token: token.access_token,
        expires_in: token.expires_in,
        refresh_token: token.refresh_token ?? connection.token.refresh_token,
        scope: token.scope ?? connection.token.scope,
      },
      tokenExpiresAt: Date.now() + token.expires_in * 1000,
    };
    options.store.set(userId, refreshed);
    return refreshed;
  }

  return async (userId) => {
    const connection = options.store.get(userId);
    if (!connection) return undefined;
    if (connection.tokenExpiresAt > Date.now() + 60_000) return connection;
    const existing = pendingRefreshes.get(userId);
    if (existing) return existing;

    const pending = refresh(userId, connection);
    pendingRefreshes.set(userId, pending);
    try {
      return await pending;
    } finally {
      if (pendingRefreshes.get(userId) === pending) pendingRefreshes.delete(userId);
    }
  };
}
