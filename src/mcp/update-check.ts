import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EncryptedJsonStore } from "../auth/encrypted-json-store.js";
import { onboardingSampleSpec } from "../article/sample-process.js";

const directory = mkdtempSync(join(tmpdir(), "autodocbot-update-mcp-")), key = randomBytes(32), userId = "test-user";
Object.assign(process.env, {
  ATLASSIAN_CLIENT_ID: "synthetic", ATLASSIAN_CLIENT_SECRET: "synthetic", ATLASSIAN_SITE_URL: "https://test.invalid",
  ATLASSIAN_SPACE_ID: "space", ATLASSIAN_REDIRECT_URI: "https://test.invalid/callback", PUBLIC_BASE_URL: "https://test.invalid",
  AUTH_MODE: "entra", AUTH_LINK_SECRET: "synthetic-test-secret", TOKEN_ENCRYPTION_KEY: key.toString("base64"),
  TOKEN_STORE_PATH: join(directory, "connections.json"), PUBLICATION_STORE_PATH: join(directory, "publications.json"),
});
new EncryptedJsonStore(process.env.TOKEN_STORE_PATH!, key).set(userId, {
  token: { access_token: "synthetic-token", expires_in: 3600, scope: "test" }, tokenExpiresAt: Date.now() + 3_600_000,
  cloudId: "cloud", profile: { account_id: "account", name: "Test" }, spaces: [{ id: "space", key: "SP", name: "Space" }],
});
let current = { id: "42", title: "Alter Artikel", status: "current", spaceId: "space", ownerId: "owner",
  version: { number: 7, message: "", authorId: "other" }, body: { storage: { value: '<ac:structured-macro ac:name="info" ac:macro-id="ab0972ba-2b48-4120-82b0-a7e0f38df940"><ac:rich-text-body><p>Bestehender Artikel</p></ac:rich-text-body></ac:structured-macro>' } } };
const files: Array<{ id: string; title: string; fileSize: number }> = [];
let uploads = 0, updates = 0, authExpired = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api.atlassian.com");
  assert.equal((init.headers as Record<string, string>).authorization, "Bearer synthetic-token");
  if (authExpired) return new Response(null, { status: 401 });
  if (url.pathname.endsWith("/child/attachment")) {
    uploads++; assert.equal(url.searchParams.get("status"), "current");
    const file = (init.body as FormData).get("file") as File;
    files.push({ id: String(files.length), title: file.name, fileSize: file.size });
    return Response.json({});
  }
  if (url.pathname.endsWith("/attachments")) return Response.json({ results: files });
  if (url.pathname.endsWith("/pages")) {
    assert.equal(init.method, undefined, "Keine Neuanlage bei Aktualisierung");
    return Response.json({ results: current.title === url.searchParams.get("title") ? [current] : [] });
  }
  assert(url.pathname.endsWith("/pages/42"));
  if (init.method === "PUT") {
    const body = JSON.parse(String(init.body)); assert.equal(body.version.number, current.version.number + 1);
    current = { ...current, title: body.title, version: { ...body.version, authorId: "account" }, body: { storage: { value: body.body.value } } };
    updates++; return Response.json(current);
  }
  if (url.searchParams.has("get-draft")) return Response.json({ ...current, status: "draft", version: { number: 1 },
    body: { storage: { value: current.body.storage.value.replace("ab0972ba-2b48-4120-82b0-a7e0f38df940", "36bde395-5085-4786-a59e-134e954d0c0f") } } });
  return Response.json(current);
};
const { createPublicationMcpServer } = await import("../server.js");
const server = createPublicationMcpServer({ userId, mode: "entra" });
const client = new Client({ name: "update-mcp-check", version: "1.0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(b); await client.connect(a);
const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  return { result, output: result.structuredContent as Record<string, any> | undefined };
};
const previewArguments = {
  sourceText: "HR meldet den Eintritt fünf Arbeitstage vorher. Dennis erstellt das Benutzerkonto und bereitet den Laptop vor. Die Führungskraft übergibt die Arbeitsmittel am ersten Arbeitstag.",
  articleJson: JSON.stringify(onboardingSampleSpec()), qualityReviewJson: JSON.stringify({ contradictions: [], missingResponsibilities: [], openQuestions: [], assumptions: [] }),
};
try {
  const toolNames = (await client.listTools()).tools.map(t => t.name);
  assert.equal(toolNames.length, 7); assert(toolNames.includes("read_process_article"));
  assert(client.getInstructions()!.includes("publication_revision_conflict"));
  const read = await call("read_process_article", { pageId: "42" });
  assert.equal(read.output!.version, 7); assert(read.output!.updateSourceId); assert.equal(uploads + updates, 0);
  const preview = await call("preview_process_article", { ...previewArguments, updateSourceId: read.output!.updateSourceId });
  assert.equal(preview.output!.operation, "update"); assert.equal(preview.output!.updateTarget.pageId, "42");
  assert.equal(preview.output!.updateTarget.baseVersion, 7);
  assert(preview.output!.confirmationCardData.summary.includes("AKTUALISIERUNG: Seite 42"));
  assert(preview.output!.confirmationCardData.summary.includes("7 → 8"));
  assert.equal(uploads + updates, 0);
  const rejected = await call("publish_process_article", { previewId: preview.output!.previewId, confirmed: false });
  assert(rejected.result.isError); assert.equal(uploads + updates, 0);
  const published = await call("publish_process_article", { previewId: preview.output!.previewId, confirmed: true });
  assert.equal(published.output!.status, "published"); assert.equal(published.output!.operation, "update");
  assert.equal(published.output!.pageId, "42"); assert.equal(published.output!.version, 8);
  await call("publish_process_article", { previewId: preview.output!.previewId, confirmed: true });
  assert.equal(updates, 1); assert.equal(uploads, 1);
  console.log("OK: MCP read mit unverändertem Restentwurf → versionsgebundene Aktualisierungskarte → false abgelehnt → true schreibt dieselbe Seite einmal.");
  const read2 = await call("read_process_article", { pageId: "42" });
  const preview2 = await call("preview_process_article", { ...previewArguments, updateSourceId: read2.output!.updateSourceId });
  current = { ...current, version: { ...current.version, number: 9, authorId: "other" }, body: { storage: { value: "Fremde Änderung" } } };
  const conflict = await call("publish_process_article", { previewId: preview2.output!.previewId, confirmed: true });
  assert.equal(conflict.output!.status, "publication_revision_conflict");
  assert(conflict.output!.nextAction.includes("neue Aktualisierungsvorschau"));
  assert.equal(updates, 1); assert.equal(current.body.storage.value, "Fremde Änderung");
  const status = await call("get_publication_status", { previewId: preview2.output!.previewId });
  assert.equal(status.output!.jobs[0].operation, "update"); assert.equal(status.output!.jobs[0].targetPageId, "42");
  console.log("OK: Fremde Änderung blockiert MCP-Update, Status nennt Ziel und erneute Vorschau/Bestätigung.");
  authExpired = true;
  const auth = await call("read_process_article", { pageId: "42" });
  assert.equal(auth.output!.status, "authorization_required"); assert(auth.output!.authorizationUrl);
  assert.equal(updates, 1);
  console.log("OK: API-401 beim Einlesen liefert persönlichen Wiederanmeldelink statt eines Artikelstrukturfehlers.");
} finally {
  await client.close(); await server.close(); globalThis.fetch = originalFetch;
  rmSync(directory, { recursive: true, force: true });
}
