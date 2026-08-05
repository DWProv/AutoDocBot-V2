import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type McpIdentity = {
  userId: string;
  displayName?: string;
  tenantId?: string;
  objectId?: string;
  mode: "local" | "entra";
};

export type McpAuthConfig = {
  mode: "local" | "entra";
  localUserId: string;
  entraTenantId?: string;
  entraClientId?: string;
  requiredScope: string;
  allowedClientIds: string[];
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length).trim();
}

export async function resolveMcpIdentity(
  request: IncomingMessage,
  config: McpAuthConfig,
): Promise<McpIdentity> {
  if (config.mode === "local") {
    const header = request.headers["x-autodoc-user-id"];
    const requestedUser = Array.isArray(header) ? header[0] : header;
    return {
      userId: requestedUser?.trim() || config.localUserId,
      displayName: requestedUser?.trim() || config.localUserId,
      mode: "local",
    };
  }

  if (!config.entraTenantId || !config.entraClientId) {
    throw new Error(
      "ENTRA_TENANT_ID und ENTRA_CLIENT_ID müssen im Entra-Modus gesetzt sein.",
    );
  }
  const token = bearerToken(request);
  if (!token) {
    throw new Error("Bearer Access Token fehlt.");
  }

  const issuer = `https://login.microsoftonline.com/${config.entraTenantId}/v2.0`;
  let jwks = jwksCache.get(config.entraTenantId);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(
        `https://login.microsoftonline.com/${config.entraTenantId}/discovery/v2.0/keys`,
      ),
    );
    jwksCache.set(config.entraTenantId, jwks);
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: config.entraClientId,
    algorithms: ["RS256"],
  });
  const tenantId = typeof payload.tid === "string" ? payload.tid : undefined;
  const objectId = typeof payload.oid === "string" ? payload.oid : undefined;
  const scopes = typeof payload.scp === "string" ? payload.scp.split(" ") : [];
  const tokenType = typeof payload.idtyp === "string" ? payload.idtyp : undefined;
  const actorClientId =
    typeof payload.azp === "string"
      ? payload.azp
      : typeof payload.appid === "string"
        ? payload.appid
        : undefined;

  if (tenantId !== config.entraTenantId || !objectId) {
    throw new Error("Tenant- oder Benutzeridentität im Access Token ist ungültig.");
  }
  if (tokenType === "app" || !scopes.includes(config.requiredScope)) {
    throw new Error(
      `Ein delegiertes Benutzer-Token mit Scope ${config.requiredScope} ist erforderlich.`,
    );
  }
  if (
    !actorClientId ||
    !config.allowedClientIds.includes(actorClientId)
  ) {
    throw new Error("Die aufrufende Client-Anwendung ist nicht autorisiert.");
  }

  return {
    userId: `${tenantId}:${objectId}`,
    tenantId,
    objectId,
    displayName:
      typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : objectId,
    mode: "entra",
  };
}
