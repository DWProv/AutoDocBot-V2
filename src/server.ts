import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  articleSpecSchema,
  validateArticleSpec,
  type ArticleSpec,
} from "./article/article-spec.js";
import { renderConfluenceStorage } from "./article/renderer.js";
import { onboardingSampleSpec } from "./article/sample-process.js";
import {
  baseStyleGuide,
  buildAgentStyleInstructions,
  resolveStyleGuide,
  type ResolvedStyleGuide,
} from "./article/styleguide.js";
import { generateProcessSvg } from "./diagram/process-svg.js";
import {
  resolveMcpIdentity,
  type McpIdentity,
} from "./auth/mcp-identity.js";
import {
  EncryptedJsonStore,
  loadOrCreateEncryptionKey,
} from "./auth/encrypted-json-store.js";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

type AccessibleResource = {
  id: string;
  name: string;
  url: string;
  scopes: string[];
};

type AtlassianProfile = {
  account_id: string;
  name: string;
  email?: string;
};

type ConfluenceSpace = {
  id: string;
  key: string;
  name: string;
  type?: string;
  status?: string;
};

type SpaceListResponse = {
  results: ConfluenceSpace[];
};

type PageResponse = {
  id: string;
  title: string;
  version?: {
    authorId?: string;
    number?: number;
  };
};

type AttachmentResponse = {
  results?: Array<{
    id: string;
    title: string;
    mediaType?: string;
  }>;
};

type AtlassianConnection = {
  token: TokenResponse;
  tokenExpiresAt: number;
  cloudId: string;
  profile: AtlassianProfile;
  spaces: ConfluenceSpace[];
};

const requiredEnv = [
  "ATLASSIAN_CLIENT_ID",
  "ATLASSIAN_CLIENT_SECRET",
  "ATLASSIAN_SITE_URL",
  "ATLASSIAN_SPACE_ID",
  "ATLASSIAN_REDIRECT_URI",
] as const;

for (const name of requiredEnv) {
  if (!process.env[name]) {
    throw new Error(`Fehlende Umgebungsvariable: ${name}`);
  }
}

const config = {
  clientId: process.env.ATLASSIAN_CLIENT_ID!,
  clientSecret: process.env.ATLASSIAN_CLIENT_SECRET!,
  siteUrl: process.env.ATLASSIAN_SITE_URL!.replace(/\/+$/, ""),
  spaceId: process.env.ATLASSIAN_SPACE_ID!,
  redirectUri: process.env.ATLASSIAN_REDIRECT_URI!,
  port: Number(process.env.PORT ?? "3000"),
  host: process.env.HOST || "127.0.0.1",
  authMode: (process.env.AUTH_MODE === "entra" ? "entra" : "local") as
    | "local"
    | "entra",
  localUserId: process.env.LOCAL_USER_ID || "local:dennis",
  entraTenantId: process.env.ENTRA_TENANT_ID || undefined,
  entraClientId: process.env.ENTRA_CLIENT_ID || undefined,
  entraRequiredScope: process.env.ENTRA_REQUIRED_SCOPE || "access_as_user",
  entraAllowedClientIds: (process.env.ENTRA_ALLOWED_CLIENT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(
    /\/+$/,
    "",
  ),
  authLinkSecret:
    process.env.AUTH_LINK_SECRET || randomBytes(32).toString("base64url"),
  tokenStorePath: process.env.TOKEN_STORE_PATH || ".local/connections.json",
  allowedHosts: (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};

const states = new Map<string, { expiresAt: number; userId: string }>();
const articlePreviews = new Map<
  string,
  {
    userId: string;
    spec: ArticleSpec;
    style: ResolvedStyleGuide;
    svg: string;
    expiresAt: number;
  }
>();
const mcpAgentInstructions = [
  "Prüfe vor der Artikelarbeit mit get_confluence_connection, ob der aktuelle Benutzer mit Confluence verbunden ist.",
  "Rufe get_article_styleguide ab und wende den gelieferten Styleguide auf jeden Artikel an.",
  "Leite Rollen, Prozessschritte, Entscheidungen, Ausnahmen und insbesondere die Anzahl der Schritte selbst aus dem Benutzertext ab. Frage niemals nach einer gewünschten Schrittzahl oder nach technischen Schemafeldern.",
  "Stelle nur fachliche Rückfragen, wenn eine fehlende Information für eine korrekte Dokumentation zwingend benötigt wird und nicht aus dem Benutzertext abgeleitet werden kann. Erfinde keine Fakten.",
  "Erzeuge mit preview_process_article immer zuerst eine Vorschau und zeige dem Benutzer die wesentlichen Inhalte und die Diagrammrichtung.",
  "Rufe publish_process_article ausschließlich auf, nachdem der Benutzer die konkrete aktuelle Vorschau ausdrücklich bestätigt hat. Eine allgemeine Bitte, einen Artikel zu erstellen, ist noch keine Veröffentlichungsbestätigung.",
].join("\n");
const tokenEncryptionKey = loadOrCreateEncryptionKey({
  encodedKey: process.env.TOKEN_ENCRYPTION_KEY || undefined,
  localKeyPath: ".local/token-encryption.key",
  allowLocalKeyFile: config.authMode === "local",
});
const connections = new EncryptedJsonStore<AtlassianConnection>(
  config.tokenStorePath,
  tokenEncryptionKey,
);

function localConnection(): AtlassianConnection | undefined {
  return connections.get(config.localUserId);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Confluence OAuth PoC</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; max-width: 760px; margin: 48px auto; padding: 0 20px; color: #172b4d; }
      h1 { line-height: 1.15; }
      a, button { color: #0c66e4; }
      .button { display: inline-block; border: 0; border-radius: 6px; padding: 10px 16px; background: #0c66e4; color: white; text-decoration: none; cursor: pointer; font: inherit; }
      .ok { padding: 12px; border-left: 4px solid #22a06b; background: #dcfff1; }
      .error { padding: 12px; border-left: 4px solid #c9372c; background: #ffeceb; white-space: pre-wrap; }
      code { background: #f1f2f4; padding: 2px 5px; border-radius: 3px; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; }
      th, td { border: 1px solid #dcdfe4; padding: 9px; text-align: left; vertical-align: top; }
      th { background: #f1f2f4; }
      select { min-width: 320px; max-width: 100%; padding: 8px; }
      svg { max-width: 100%; height: auto; }
      dt { font-weight: 650; margin-top: 8px; }
      dd { margin-left: 0; }
    </style>
  </head>
  <body>${body}</body>
</html>`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}\n${text}`);
  }
  return JSON.parse(text) as T;
}

async function getValidConnection(
  userId: string,
): Promise<AtlassianConnection | undefined> {
  const connection = connections.get(userId);
  if (!connection) return undefined;
  if (connection.tokenExpiresAt > Date.now() + 60_000) return connection;
  if (!connection.token.refresh_token) {
    connections.delete(userId);
    return undefined;
  }

  const refreshedToken = await fetchJson<TokenResponse>(
    "https://auth.atlassian.com/oauth/token",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: connection.token.refresh_token,
      }),
    },
  );
  const refreshedConnection: AtlassianConnection = {
    ...connection,
    token: {
      ...refreshedToken,
      refresh_token:
        refreshedToken.refresh_token ?? connection.token.refresh_token,
    },
    tokenExpiresAt: Date.now() + refreshedToken.expires_in * 1000,
  };
  connections.set(userId, refreshedConnection);
  return refreshedConnection;
}

function createAccountLinkToken(userId: string): string {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      userId,
      expiresAt: Date.now() + 10 * 60 * 1000,
      nonce: randomBytes(12).toString("base64url"),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", config.authLinkSecret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyAccountLinkToken(token: string): string {
  const [encodedPayload, suppliedSignature] = token.split(".");
  if (!encodedPayload || !suppliedSignature) {
    throw new Error("Der Kontoverknüpfungs-Link ist ungültig.");
  }
  const expectedSignature = createHmac("sha256", config.authLinkSecret)
    .update(encodedPayload)
    .digest();
  const actualSignature = Buffer.from(suppliedSignature, "base64url");
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error("Die Signatur des Kontoverknüpfungs-Links ist ungültig.");
  }
  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as { userId?: unknown; expiresAt?: unknown };
  if (
    typeof payload.userId !== "string" ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt < Date.now()
  ) {
    throw new Error("Der Kontoverknüpfungs-Link ist abgelaufen.");
  }
  return payload.userId;
}

function authorizationUrl(userId: string): string {
  const state = randomBytes(32).toString("base64url");
  states.set(state, {
    expiresAt: Date.now() + 10 * 60 * 1000,
    userId,
  });

  const url = new URL("https://auth.atlassian.com/authorize");
  url.search = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: config.clientId,
    scope: [
      "read:me",
      "read:space:confluence",
      "read:page:confluence",
      "write:page:confluence",
      "read:content-details:confluence",
      "read:attachment:confluence",
      "write:attachment:confluence",
      "offline_access",
    ].join(" "),
    redirect_uri: config.redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  }).toString();
  return url.toString();
}

async function handleCallback(url: URL, response: ServerResponse): Promise<void> {
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const pendingState = state ? states.get(state) : undefined;

  if (error) {
    throw new Error(`Atlassian hat die Autorisierung abgebrochen: ${error}`);
  }
  if (
    !code ||
    !state ||
    !pendingState ||
    pendingState.expiresAt < Date.now()
  ) {
    throw new Error("OAuth-State oder Autorisierungscode ist ungültig beziehungsweise abgelaufen.");
  }
  states.delete(state);

  const token = await fetchJson<TokenResponse>("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  const authHeaders = {
    authorization: `Bearer ${token.access_token}`,
    accept: "application/json",
  };
  const [resources, profile] = await Promise.all([
    fetchJson<AccessibleResource[]>(
      "https://api.atlassian.com/oauth/token/accessible-resources",
      { headers: authHeaders },
    ),
    fetchJson<AtlassianProfile>("https://api.atlassian.com/me", {
      headers: authHeaders,
    }),
  ]);

  const expectedOrigin = new URL(config.siteUrl).origin;
  const resource = resources.find(
    (item) => new URL(item.url).origin === expectedOrigin,
  );
  if (!resource) {
    throw new Error(
      `Die erwartete Site ${expectedOrigin} wurde nicht freigegeben. Verfügbar: ${resources
        .map((item) => item.url)
        .join(", ") || "keine"}`,
    );
  }

  const spaceList = await fetchJson<SpaceListResponse>(
    `https://api.atlassian.com/ex/confluence/${encodeURIComponent(resource.id)}/wiki/api/v2/spaces?limit=100`,
    { headers: authHeaders },
  );
  connections.set(pendingState.userId, {
    token,
    tokenExpiresAt: Date.now() + token.expires_in * 1000,
    cloudId: resource.id,
    profile,
    spaces: spaceList.results,
  });
  const configuredSpaceExists = spaceList.results.some(
    (space) => space.id === config.spaceId,
  );
  const spaceOptions = spaceList.results
    .map(
      (space) =>
        `<option value="${escapeHtml(space.id)}" ${space.id === config.spaceId ? "selected" : ""}>${escapeHtml(space.name)} (${escapeHtml(space.key)}, ID ${escapeHtml(space.id)})</option>`,
    )
    .join("");
  const localTestControls =
    pendingState.userId === config.localUserId
      ? `${
          configuredSpaceExists
            ? ""
            : `<p class="error">Die konfigurierte ID <code>${escapeHtml(config.spaceId)}</code> ist keine der für diesen Benutzer sichtbaren Space-IDs. Bitte wähle unten den Ziel-Space aus.</p>`
        }
         <form method="post" action="/create-test-page">
           <p><label for="spaceId"><strong>Ziel-Space</strong></label><br />
           <select id="spaceId" name="spaceId" required>${spaceOptions}</select></p>
           <button class="button" type="submit">Testseite veröffentlichen</button>
           <button class="button" type="submit" formaction="/create-diagram-page">Testseite mit SVG veröffentlichen</button>
         </form>
         <hr style="margin:32px 0;border:0;border-top:1px solid #dcdfe4" />
         <p><a class="button" href="/article-preview">Echten Prozessartikel als Vorschau öffnen</a></p>`
      : "<p class=\"ok\">Die Kontoverknüpfung ist abgeschlossen. Du kannst zu Copilot zurückkehren.</p>";
  sendHtml(
    response,
    200,
    `<h1>OAuth-Verbindung erfolgreich</h1>
     <p class="ok">Atlassian hat den Benutzer und die Ziel-Site erfolgreich autorisiert.</p>
     <dl>
       <dt>Benutzer</dt><dd>${escapeHtml(profile.name)}</dd>
       <dt>Account ID</dt><dd><code>${escapeHtml(profile.account_id)}</code></dd>
       <dt>Site</dt><dd>${escapeHtml(resource.name)} – ${escapeHtml(resource.url)}</dd>
       <dt>Cloud ID</dt><dd><code>${escapeHtml(resource.id)}</code></dd>
       <dt>Scopes</dt><dd>${escapeHtml(token.scope)}</dd>
       <dt>Refresh Token</dt><dd>${token.refresh_token ? "vorhanden" : "nicht zurückgegeben"}</dd>
       <dt>Verknüpfte Benutzer-ID</dt><dd><code>${escapeHtml(pendingState.userId)}</code></dd>
     </dl>
     ${localTestControls}`,
  );
}

function renderSpaceOptions(spaces: ConfluenceSpace[]): string {
  return spaces
    .map(
      (space) =>
        `<option value="${escapeHtml(space.id)}" ${space.id === config.spaceId ? "selected" : ""}>${escapeHtml(space.name)} (${escapeHtml(space.key)}, ID ${escapeHtml(space.id)})</option>`,
    )
    .join("");
}

function storeArticlePreview(spec: ArticleSpec, userId: string): {
  previewId: string;
  style: ResolvedStyleGuide;
  svg: string;
  expiresAt: number;
} {
  const style = resolveStyleGuide(spec.style);
  const svg = generateProcessSvg(spec, style);
  const previewId = randomBytes(18).toString("base64url");
  const expiresAt = Date.now() + 30 * 60 * 1000;
  articlePreviews.set(previewId, { userId, spec, style, svg, expiresAt });
  return { previewId, style, svg, expiresAt };
}

function showArticlePreview(response: ServerResponse): void {
  const activeSession = localConnection();
  if (!activeSession) {
    response.writeHead(303, { location: "/" });
    response.end();
    return;
  }

  const spec = onboardingSampleSpec();
  const { style, svg, previewId } = storeArticlePreview(
    spec,
    config.localUserId,
  );

  const roles = spec.roles
    .map(
      (role) =>
        `<tr><td>${escapeHtml(role.name)}</td><td>${escapeHtml(role.responsibility)}</td></tr>`,
    )
    .join("");
  const steps = spec.steps
    .map(
      (step) =>
        `<tr><td>${step.number}</td><td>${escapeHtml(step.actor)}</td><td>${escapeHtml(step.action)}</td><td>${escapeHtml(step.result)}</td></tr>`,
    )
    .join("");
  const exceptions = spec.exceptions
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.condition)}</strong> ${escapeHtml(item.handling)}</li>`,
    )
    .join("");

  sendHtml(
    response,
    200,
    `<h1>${escapeHtml(spec.title)}</h1>
     <p class="ok">ArticleSpec und Style-Overrides wurden erfolgreich validiert.</p>
     <h2>Kurzbeschreibung</h2><p>${escapeHtml(spec.summary)}</p>
     <h2>Zweck</h2><p>${escapeHtml(spec.purpose)}</p>
     <h2>Geltungsbereich</h2><p>${escapeHtml(spec.scope)}</p>
     <h2>Rollen und Verantwortlichkeiten</h2>
     <table><thead><tr><th>Rolle</th><th>Verantwortung</th></tr></thead><tbody>${roles}</tbody></table>
     <h2>Prozessablauf</h2>
     <table><thead><tr><th>Nr.</th><th>Rolle</th><th>Aktivität</th><th>Ergebnis</th></tr></thead><tbody>${steps}</tbody></table>
     <h2>Ausnahmen</h2><ul>${exceptions}</ul>
     <h2>Style</h2>
     <p>Ton: <code>${escapeHtml(style.tone)}</code>, Zielgruppe: <code>${escapeHtml(style.audience)}</code>, Detailgrad: <code>${escapeHtml(style.detailLevel)}</code>, Diagramm: <code>${escapeHtml(style.diagramDirection)}</code></p>
     <h2>Prozessdiagramm</h2>
     <div style="overflow:auto;border:1px solid #dcdfe4;border-radius:10px;padding:12px;background:#fff">${svg}</div>
     <h2>Veröffentlichen</h2>
     <form method="post" action="/publish-article">
       <input type="hidden" name="previewId" value="${escapeHtml(previewId)}" />
       <p><label for="spaceId"><strong>Ziel-Space</strong></label><br />
       <select id="spaceId" name="spaceId" required>${renderSpaceOptions(activeSession.spaces)}</select></p>
       <button class="button" type="submit">Vorschau bestätigen und veröffentlichen</button>
     </form>
     <p><a href="/">Abbrechen</a></p>`,
  );
}

type PublishedArticle = {
  pageId: string;
  pageUrl: string;
  title: string;
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  styleGuideVersion: string;
  diagramDirection: string;
  attributionConfirmed: boolean;
};

async function publishStoredPreview(
  previewId: string,
  userId: string,
  requestedSpaceId?: string,
): Promise<PublishedArticle> {
  const activeSession = await getValidConnection(userId);
  if (!activeSession) {
    throw new Error(
      `Keine Atlassian-Verbindung vorhanden. Öffne zuerst ${new URL(config.redirectUri).origin} und verbinde das Atlassian-Konto.`,
    );
  }
  const preview = previewId ? articlePreviews.get(previewId) : undefined;
  if (!preview || preview.expiresAt < Date.now()) {
    if (previewId) articlePreviews.delete(previewId);
    throw new Error("Die Artikelvorschau ist ungültig oder abgelaufen. Bitte erzeuge eine neue Vorschau.");
  }
  if (preview.userId !== userId) {
    throw new Error("Die Artikelvorschau gehört zu einem anderen Benutzer.");
  }

  const effectiveSpaceId = requestedSpaceId ?? config.spaceId;
  const targetSpace = activeSession.spaces.find(
    (space) => space.id === effectiveSpaceId,
  );
  if (!targetSpace) {
    throw new Error("Der gewählte Space gehört nicht zu den für diesen Benutzer geladenen Spaces.");
  }
  articlePreviews.delete(previewId);

  const title = preview.spec.title;
  const attachmentName = `process-diagram-${Date.now()}.svg`;
  const apiBase = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(activeSession.cloudId)}`;
  const headers = {
    authorization: `Bearer ${activeSession.token.access_token}`,
    accept: "application/json",
  };
  const initialBody = renderConfluenceStorage(
    preview.spec,
    preview.style,
  );
  const page = await fetchJson<PageResponse>(`${apiBase}/wiki/api/v2/pages`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      spaceId: targetSpace.id,
      status: "current",
      title,
      body: { representation: "storage", value: initialBody },
    }),
  });

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([preview.svg], { type: "image/svg+xml" }),
    attachmentName,
  );
  formData.append("comment", `Prozessdiagramm für ${preview.spec.title}`);
  await fetchJson<AttachmentResponse>(
    `${apiBase}/wiki/rest/api/content/${encodeURIComponent(page.id)}/child/attachment`,
    {
      method: "POST",
      headers: { ...headers, "X-Atlassian-Token": "nocheck" },
      body: formData,
    },
  );

  const finalBody = renderConfluenceStorage(
    preview.spec,
    preview.style,
    attachmentName,
  );
  const updatedPage = await fetchJson<PageResponse>(
    `${apiBase}/wiki/api/v2/pages/${encodeURIComponent(page.id)}`,
    {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        id: page.id,
        status: "current",
        title,
        body: { representation: "storage", value: finalBody },
        version: {
          number: (page.version?.number ?? 1) + 1,
          message: `Veröffentlicht mit Styleguide ${preview.style.version}`,
        },
      }),
    },
  );

  const pageUrl = `${config.siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(page.id)}`;
  const attributionMatches =
    updatedPage.version?.authorId === activeSession.profile.account_id;
  return {
    pageId: page.id,
    pageUrl,
    title,
    spaceId: targetSpace.id,
    spaceKey: targetSpace.key,
    spaceName: targetSpace.name,
    styleGuideVersion: preview.style.version,
    diagramDirection: preview.style.diagramDirection,
    attributionConfirmed: attributionMatches,
  };
}

async function publishArticle(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!localConnection()) {
    response.writeHead(303, { location: "/" });
    response.end();
    return;
  }

  const form = await readFormBody(request);
  const previewId = form.get("previewId");
  if (!previewId) {
    throw new Error("Die Preview-ID fehlt.");
  }
  const result = await publishStoredPreview(
    previewId,
    config.localUserId,
    form.get("spaceId") ?? undefined,
  );
  sendHtml(
    response,
    200,
    `<h1>Prozessartikel veröffentlicht</h1>
     <p class="ok">ArticleSpec, Styleguide, Diagramm und Confluence-Publishing wurden erfolgreich als eine Pipeline ausgeführt.</p>
     <dl>
       <dt>Artikel</dt><dd><a href="${escapeHtml(result.pageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(result.title)}</a></dd>
       <dt>Space</dt><dd>${escapeHtml(result.spaceName)} (<code>${escapeHtml(result.spaceKey)}</code>)</dd>
       <dt>Styleguide</dt><dd><code>${escapeHtml(result.styleGuideVersion)}</code></dd>
       <dt>Diagrammrichtung</dt><dd><code>${escapeHtml(result.diagramDirection)}</code></dd>
       <dt>Attribution</dt><dd>${result.attributionConfirmed ? "bestätigt" : "bitte in der Seitenhistorie prüfen"}</dd>
     </dl>`,
  );
}

function createPublicationMcpServer(identity: McpIdentity): McpServer {
  const mcp = new McpServer(
    {
      name: "autodocbot-v2",
      version: "0.1.2",
    },
    { instructions: mcpAgentInstructions },
  );

  mcp.registerTool(
    "get_confluence_connection",
    {
      title: "Confluence-Verbindung prüfen",
      description:
        "Prüft vor einer Vorschau oder Veröffentlichung, ob der Benutzer mit Atlassian verbunden ist, und liefert die erlaubten Confluence-Spaces. Dieses Tool verändert keine Daten.",
      inputSchema: {},
    },
    async () => {
      const activeSession = connections.get(identity.userId);
      const output = activeSession
        ? {
            connected: true,
            user: activeSession.profile.name,
            siteUrl: config.siteUrl,
            defaultSpaceId: config.spaceId,
            spaces: activeSession.spaces.map((space) => ({
              id: space.id,
              key: space.key,
              name: space.name,
            })),
          }
        : {
            connected: false,
            authorizationUrl: `${config.publicBaseUrl}/oauth/start?link_token=${encodeURIComponent(createAccountLinkToken(identity.userId))}`,
            message:
              "Der Benutzer muss AutoDocBot zunächst im Browser mit Atlassian verbinden.",
          };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  mcp.registerTool(
    "get_article_styleguide",
    {
      title: "Styleguide für Prozessartikel abrufen",
      description:
        "Liefert den verbindlichen Styleguide und die erlaubten benutzerspezifischen Anpassungen. Dieses Tool verändert keine Daten.",
      inputSchema: {},
    },
    async () => {
      const output = {
        version: baseStyleGuide.version,
        defaults: {
          language: baseStyleGuide.language,
          tone: baseStyleGuide.tone,
          audience: baseStyleGuide.audience,
          detailLevel: baseStyleGuide.detailLevel,
          addressForm: baseStyleGuide.addressForm,
          diagramDirection: baseStyleGuide.diagramDirection,
          headingLabels: baseStyleGuide.headingLabels,
        },
        allowedOverrides: {
          tone: ["formal", "neutral", "concise", "friendly"],
          audience: ["general", "expert", "management", "operations"],
          detailLevel: ["compact", "standard", "detailed"],
          addressForm: ["neutral", "du", "sie"],
          diagramDirection: ["top-down", "left-right"],
          optionalSections: [
            "definitions",
            "systems",
            "risksAndControls",
            "metrics",
            "changeHistory",
          ],
        },
        enforcedRules: baseStyleGuide.enforcedRules,
        agentInstructions: buildAgentStyleInstructions(baseStyleGuide),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  mcp.registerTool(
    "preview_process_article",
    {
      title: "Prozessartikel als Vorschau erzeugen",
      description:
        "Validiert einen als JSON-String übergebenen Prozessartikel, wendet den Styleguide an und erzeugt eine 30 Minuten gültige Vorschau-ID samt Diagramm-Metadaten. Dieses Tool veröffentlicht niemals in Confluence. Leite Rollen und die Anzahl der Schritte selbst aus den beschriebenen Aktionen ab. Frage den Benutzer niemals nach einer gewünschten Schrittzahl oder nach technischen Schemafeldern. Frage nur nach fachlichen Informationen, die für eine korrekte Dokumentation tatsächlich fehlen und nicht aus dem Eingangstext abgeleitet werden können.",
      inputSchema: {
        articleJson: z.string().min(2).max(100_000).describe(
          "Vollständiges ArticleSpec als JSON-kodierter String. Extrahiere die Prozessschritte selbst aus dem Benutzertext und nummeriere sie lückenlos ab 1. Erfinde keine Fakten. Frage nicht nach der Anzahl der Schritte.",
        ),
      },
    },
    async ({ articleJson }) => {
      try {
        let article: unknown;
        try {
          article = JSON.parse(articleJson);
        } catch {
          throw new Error("articleJson muss ein gültiger JSON-String sein.");
        }
        const spec = validateArticleSpec(article);
        const { previewId, style, expiresAt } = storeArticlePreview(
          spec,
          identity.userId,
        );
        const output = {
          previewId,
          expiresAt: new Date(expiresAt).toISOString(),
          title: spec.title,
          summary: spec.summary,
          roles: spec.roles,
          steps: spec.steps,
          exceptions: spec.exceptions,
          style: {
            version: style.version,
            tone: style.tone,
            audience: style.audience,
            detailLevel: style.detailLevel,
            diagramDirection: style.diagramDirection,
          },
          diagram: {
            generated: true,
            direction: style.diagramDirection,
            processStepCount: spec.steps.length,
          },
          publicationStatus: "not_published",
          nextAction:
            "Zeige dem Benutzer diese Vorschau. Rufe publish_process_article erst nach einer ausdrücklichen Veröffentlichungsbestätigung auf.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `ArticleSpec ungültig: ${message}` }],
        };
      }
    },
  );

  mcp.registerTool(
    "publish_process_article",
    {
      title: "Bestätigten Prozessartikel veröffentlichen",
      description:
        "Veröffentlicht eine zuvor erzeugte Vorschau inklusive SVG-Diagramm in Confluence. Darf ausschließlich nach ausdrücklicher Bestätigung des Benutzers aufgerufen werden. Eine Vorschau-ID kann nur einmal veröffentlicht werden.",
      inputSchema: {
        previewId: z.string().min(10).describe("ID aus preview_process_article"),
        confirmed: z
          .literal(true)
          .describe("Muss true sein und eine ausdrückliche Benutzerbestätigung abbilden"),
        spaceId: z
          .string()
          .optional()
          .describe("Erlaubte Confluence-Space-ID; ohne Wert wird der konfigurierte Standard verwendet"),
      },
    },
    async ({ previewId, spaceId }) => {
      try {
        const output = await publishStoredPreview(
          previewId,
          identity.userId,
          spaceId,
        );
        return {
          content: [
            {
              type: "text",
              text: `Prozessartikel veröffentlicht: ${output.pageUrl}`,
            },
          ],
          structuredContent: {
            status: "published",
            ...output,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Veröffentlichung fehlgeschlagen: ${message}` }],
        };
      }
    },
  );

  return mcp;
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const host = request.headers.host;
  const allowedHosts = new Set([
    `localhost:${config.port}`,
    `127.0.0.1:${config.port}`,
    new URL(config.publicBaseUrl).host,
    ...config.allowedHosts,
  ]);
  if (!host || !allowedHosts.has(host)) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid Host header" },
        id: null,
      }),
    );
    return;
  }

  let identity: McpIdentity;
  try {
    identity = await resolveMcpIdentity(request, {
      mode: config.authMode,
      localUserId: config.localUserId,
      entraTenantId: config.entraTenantId,
      entraClientId: config.entraClientId,
      requiredScope: config.entraRequiredScope,
      allowedClientIds: config.entraAllowedClientIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const resourceMetadataUrl = `${config.publicBaseUrl}/.well-known/oauth-protected-resource`;
    response.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl}", scope="${config.entraRequiredScope}", error="invalid_token"`,
    });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message },
        id: null,
      }),
    );
    return;
  }

  const mcp = createPublicationMcpServer(identity);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await mcp.connect(transport);
  response.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  await transport.handleRequest(request, response);
}

function processDiagramSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320" role="img" aria-labelledby="title desc">
  <title id="title">OAuth-Prozessdiagramm</title>
  <desc id="desc">Vom Benutzerinput über den Copilot und MCP-Server bis zur veröffentlichten Confluence-Seite.</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#0c66e4"/>
    </marker>
    <filter id="shadow" x="-10%" y="-20%" width="120%" height="150%">
      <feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#091e42" flood-opacity="0.14"/>
    </filter>
  </defs>
  <rect width="1200" height="320" rx="24" fill="#f7f8f9"/>
  <g font-family="Arial, Helvetica, sans-serif" text-anchor="middle">
    <text x="600" y="50" font-size="28" font-weight="700" fill="#172b4d">Prozess zur Artikelerstellung</text>
    <g filter="url(#shadow)">
      <rect x="55" y="115" width="220" height="105" rx="14" fill="#ffffff" stroke="#b3b9c4"/>
      <rect x="350" y="115" width="220" height="105" rx="14" fill="#e9f2ff" stroke="#0c66e4"/>
      <rect x="645" y="115" width="220" height="105" rx="14" fill="#e9f2ff" stroke="#0c66e4"/>
      <rect x="940" y="115" width="220" height="105" rx="14" fill="#dcfff1" stroke="#22a06b"/>
    </g>
    <g fill="#172b4d" font-size="20" font-weight="700">
      <text x="165" y="160">Benutzerinput</text>
      <text x="460" y="160">Copilot Agent</text>
      <text x="755" y="160">MCP-Server</text>
      <text x="1050" y="160">Confluence</text>
    </g>
    <g fill="#44546f" font-size="15">
      <text x="165" y="190">Prozessbeschreibung</text>
      <text x="460" y="190">Strukturierung</text>
      <text x="755" y="190">Rendering &amp; Publishing</text>
      <text x="1050" y="190">Veröffentlichter Artikel</text>
    </g>
  </g>
  <g stroke="#0c66e4" stroke-width="4" fill="none" marker-end="url(#arrow)">
    <path d="M 285 168 L 335 168"/>
    <path d="M 580 168 L 630 168"/>
    <path d="M 875 168 L 925 168"/>
  </g>
</svg>`;
}

async function createDiagramPage(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const activeSession = localConnection();
  if (!activeSession) {
    response.writeHead(303, { location: "/" });
    response.end();
    return;
  }

  const form = await readFormBody(request);
  const requestedSpaceId = form.get("spaceId");
  const targetSpace = activeSession.spaces.find(
    (space) => space.id === requestedSpaceId,
  );
  if (!targetSpace) {
    throw new Error("Der gewählte Space gehört nicht zu den für diesen Benutzer geladenen Spaces.");
  }

  const now = new Date();
  const title = `SVG PoC – ${now.toISOString().replace(/[.:]/g, "-")}`;
  const attachmentName = `process-diagram-${Date.now()}.svg`;
  const apiBase = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(activeSession.cloudId)}`;
  const headers = {
    authorization: `Bearer ${activeSession.token.access_token}`,
    accept: "application/json",
  };

  const initialBody =
    "<h1>SVG-Attachment-Test</h1>" +
    "<p>Diese Seite prüft das serverseitige Erzeugen, Hochladen und Einbetten eines Prozessdiagramms.</p>" +
    "<h2>Prozessdiagramm</h2>" +
    "<p>Das Diagramm wird gerade als Attachment ergänzt.</p>";

  const page = await fetchJson<PageResponse>(`${apiBase}/wiki/api/v2/pages`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      spaceId: targetSpace.id,
      status: "current",
      title,
      body: { representation: "storage", value: initialBody },
    }),
  });

  const uploadData = new FormData();
  uploadData.append(
    "file",
    new Blob([processDiagramSvg()], { type: "image/svg+xml" }),
    attachmentName,
  );
  uploadData.append("comment", "Serverseitig erzeugtes Prozessdiagramm");

  const attachment = await fetchJson<AttachmentResponse>(
    `${apiBase}/wiki/rest/api/content/${encodeURIComponent(page.id)}/child/attachment`,
    {
      method: "POST",
      headers: {
        ...headers,
        "X-Atlassian-Token": "nocheck",
      },
      body: uploadData,
    },
  );

  const finalBody =
    "<h1>SVG-Attachment-Test</h1>" +
    "<p>Diese Seite wurde im Kontext des angemeldeten Benutzers erstellt. Das Diagramm wurde serverseitig als SVG generiert und als Confluence-Attachment eingebettet.</p>" +
    "<h2>Prozessdiagramm</h2>" +
    `<ac:image ac:align="center" ac:alt="Prozess zur Artikelerstellung"><ri:attachment ri:filename="${attachmentName}" /></ac:image>`;

  const updatedPage = await fetchJson<PageResponse>(
    `${apiBase}/wiki/api/v2/pages/${encodeURIComponent(page.id)}`,
    {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        id: page.id,
        status: "current",
        title,
        body: { representation: "storage", value: finalBody },
        version: {
          number: (page.version?.number ?? 1) + 1,
          message: "SVG-Prozessdiagramm eingebettet",
        },
      }),
    },
  );

  const authorId = updatedPage.version?.authorId;
  const attributionMatches = authorId === activeSession.profile.account_id;
  const uploadedName = attachment.results?.[0]?.title ?? attachmentName;
  const pageUrl = `${config.siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(page.id)}`;

  sendHtml(
    response,
    200,
    `<h1>SVG-Testseite erstellt</h1>
     <p class="ok">Seite, Attachment und Einbettung wurden erfolgreich über die APIs verarbeitet.</p>
     <dl>
       <dt>Seite</dt><dd><a href="${escapeHtml(pageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></dd>
       <dt>Space</dt><dd>${escapeHtml(targetSpace.name)} (<code>${escapeHtml(targetSpace.key)}</code>)</dd>
       <dt>Attachment</dt><dd><code>${escapeHtml(uploadedName)}</code></dd>
       <dt>Attribution</dt><dd>${attributionMatches ? "bestätigt" : "bitte in der Seitenhistorie prüfen"}</dd>
     </dl>
     <p>Öffne die Seite und kontrolliere, ob das Diagramm am Artikelende sichtbar ist.</p>
     <p><a href="/">Zurück</a></p>`,
  );
}

async function readFormBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) {
      throw new Error("Formulardaten sind zu groß.");
    }
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

async function createTestPage(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const activeSession = localConnection();
  if (!activeSession) {
    response.writeHead(303, { location: "/" });
    response.end();
    return;
  }

  const form = await readFormBody(request);
  const requestedSpaceId = form.get("spaceId");
  const targetSpace = activeSession.spaces.find(
    (space) => space.id === requestedSpaceId,
  );
  if (!targetSpace) {
    throw new Error("Der gewählte Space gehört nicht zu den für diesen Benutzer geladenen Spaces.");
  }

  const now = new Date();
  const title = `OAuth PoC – ${now.toISOString().replace(/[.:]/g, "-")}`;
  const apiBase = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(activeSession.cloudId)}`;
  const page = await fetchJson<PageResponse>(`${apiBase}/wiki/api/v2/pages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${activeSession.token.access_token}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      spaceId: targetSpace.id,
      status: "current",
      title,
      body: {
        representation: "storage",
        value:
          "<h1>OAuth-Attributionstest</h1>" +
          "<p>Diese Seite wurde über die Confluence REST API v2 mit einem OAuth-2.0-3LO-Token erstellt.</p>" +
          `<p>Testzeitpunkt: ${escapeHtml(now.toISOString())}</p>`,
      },
    }),
  });

  const pageWithVersion = page.version?.authorId
    ? page
    : await fetchJson<PageResponse>(
        `${apiBase}/wiki/api/v2/pages/${encodeURIComponent(page.id)}?include-version=true`,
        {
          headers: {
            authorization: `Bearer ${activeSession.token.access_token}`,
            accept: "application/json",
          },
        },
      );

  const authorId = pageWithVersion.version?.authorId;
  const matches = authorId === activeSession.profile.account_id;
  const pageUrl = `${config.siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(page.id)}`;

  sendHtml(
    response,
    200,
    `<h1>Testseite erstellt</h1>
     <p class="${matches ? "ok" : "error"}">
       ${matches
         ? "Attribution bestätigt: Der Autor der Seitenversion entspricht dem angemeldeten Atlassian-Benutzer."
         : "Attribution konnte über die API-Antwort nicht eindeutig bestätigt werden. Prüfe zusätzlich die Seitenhistorie."}
     </p>
     <dl>
       <dt>Seite</dt><dd><a href="${escapeHtml(pageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></dd>
       <dt>Space</dt><dd>${escapeHtml(targetSpace.name)} (<code>${escapeHtml(targetSpace.key)}</code>, ID <code>${escapeHtml(targetSpace.id)}</code>)</dd>
       <dt>Angemeldete Account ID</dt><dd><code>${escapeHtml(activeSession.profile.account_id)}</code></dd>
       <dt>Author ID der Version</dt><dd><code>${escapeHtml(authorId ?? "nicht geliefert")}</code></dd>
     </dl>
     <p><a href="/">Zurück</a></p>`,
  );
}

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  try {
    const url = new URL(request.url ?? "/", `http://localhost:${config.port}`);

    if (request.method === "GET" && url.pathname === "/healthz") {
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(
        JSON.stringify({
          status: "ok",
          service: "autodocbot-v2",
          version: "0.1.2",
          authMode: config.authMode,
        }),
      );
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/oauth-protected-resource"
    ) {
      if (
        config.authMode !== "entra" ||
        !config.entraTenantId ||
        !config.entraClientId
      ) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "OAuth discovery is disabled" }));
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "public, max-age=3600",
      });
      response.end(
        JSON.stringify({
          resource: `${config.publicBaseUrl}/mcp`,
          authorization_servers: [
            `https://login.microsoftonline.com/${config.entraTenantId}/v2.0`,
          ],
          scopes_supported: [
            `api://${config.entraClientId}/${config.entraRequiredScope}`,
          ],
          bearer_methods_supported: ["header"],
        }),
      );
      return;
    }

    if (url.pathname === "/mcp") {
      if (request.method === "POST") {
        await handleMcpRequest(request, response);
      } else {
        response.writeHead(405, {
          "content-type": "application/json",
          allow: "POST",
        });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed" },
            id: null,
          }),
        );
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      sendHtml(
        response,
        200,
        `<h1>Confluence OAuth PoC</h1>
         <p>Ziel-Site: <code>${escapeHtml(config.siteUrl)}</code></p>
         <p>Ziel-Space-ID: <code>${escapeHtml(config.spaceId)}</code></p>
         <p><a class="button" href="/oauth/start">Mit Atlassian verbinden</a></p>`,
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/oauth/start") {
      const linkToken = url.searchParams.get("link_token");
      const userId = linkToken
        ? verifyAccountLinkToken(linkToken)
        : config.authMode === "local"
          ? config.localUserId
          : undefined;
      if (!userId) {
        throw new Error(
          "Im Entra-Modus muss die Kontoverknüpfung über den vom MCP-Tool ausgegebenen Link gestartet werden.",
        );
      }
      response.writeHead(302, {
        location: authorizationUrl(userId),
        "cache-control": "no-store",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/oauth/callback") {
      await handleCallback(url, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/create-test-page") {
      await createTestPage(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/create-diagram-page") {
      await createDiagramPage(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/article-preview") {
      showArticlePreview(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/publish-article") {
      await publishArticle(request, response);
      return;
    }

    sendHtml(response, 404, "<h1>Nicht gefunden</h1>");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Request fehlgeschlagen:", message);
    sendHtml(
      response,
      500,
      `<h1>Test fehlgeschlagen</h1><div class="error">${escapeHtml(message)}</div><p><a href="/">Erneut versuchen</a></p>`,
    );
  }
});

server.listen(config.port, config.host, () => {
  console.log(
    `AutoDocBot V2 läuft auf ${config.host}:${config.port} (${config.authMode})`,
  );
});
