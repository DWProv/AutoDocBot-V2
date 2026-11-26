import assert from "node:assert/strict";
import { createConfluencePublicationApi, ConfluenceApiError, type PublicationPage } from "./confluence-api.js";

const calls: Array<{ url: URL; init: RequestInit }> = [];
const draft: PublicationPage = { id: "1", title: "Entwurf", status: "draft", spaceId: "space", ownerId: "account", version: { number: 1 } };
let published = false;
const fake: typeof fetch = async (input, init = {}) => {
  const url = new URL(String(input)); calls.push({ url, init });
  assert.equal((init.headers as Record<string, string>).authorization, "Bearer synthetic-token");
  assert.equal(init.redirect, "error"); assert(init.signal);
  if (url.pathname.endsWith("/pages") && !init.method) {
    if (!url.searchParams.has("cursor")) {
      assert.deepEqual(url.searchParams.getAll("status"), ["current"]);
      return Response.json({ results: [], _links: { next: "/wiki/api/v2/pages?cursor=next" } });
    }
    return Response.json({ results: [{ ...draft, title: "Zielseite" }, { ...draft, title: "Zielseite", spaceId: "other" }] });
  }
  if (url.pathname.endsWith("/rest/api/content")) {
    assert.equal(url.searchParams.get("status"), "draft");
    return Response.json({ results: [{ id: "1", title: "Entwurf", status: "draft", space: { id: "space" },
      version: { number: 1 }, history: { createdBy: { accountId: "account" } } }] });
  }
  if (url.pathname.endsWith("/pages") && init.method === "POST") {
    const body = JSON.parse(String(init.body)); assert.equal(body.status, "draft");
    assert.equal(body.spaceId, "space"); assert.equal(body.body.value, "<p>Inhalt</p>");
    return Response.json(draft);
  }
  if (url.pathname.endsWith("/child/attachment")) {
    assert.equal(init.method, "PUT"); assert.equal(url.searchParams.get("status"), "draft");
    const form = init.body as FormData;
    assert.equal((form.get("file") as File).name, "stable.svg");
    assert.equal(await (form.get("file") as File).text(), "<svg/>");
    return Response.json({ results: [{ id: "att1", title: "stable.svg" }] });
  }
  if (url.pathname.endsWith("/attachments")) return Response.json({ results: [{ id: "att1", title: "stable.svg" }] });
  if (init.method === "PUT") {
    const body = JSON.parse(String(init.body));
    assert.equal(body.id, "1"); assert.equal(body.status, "current"); assert.equal(body.version.number, 1, "Die erste Veröffentlichung eines Entwurfs muss Version 1 verwenden");
    assert.equal(body.version.message, "marker");
    published = true;
    return Response.json({ ...draft, status: "current" });
  }
  assert.equal(url.searchParams.get("body-format"), "storage");
  if (!url.searchParams.has("get-draft")) {
    return published ? Response.json({ ...draft, status: "current" }) : new Response(null, { status: 404 });
  }
  assert.equal(url.searchParams.get("get-draft"), "true");
  assert.equal(url.searchParams.get("status"), "draft");
  return published ? new Response(null, { status: 404 }) : Response.json(draft);
};
const api = createConfluencePublicationApi({ cloudId: "cloud", spaceId: "space", accessToken: "synthetic-token", fetch: fake });
assert.equal((await api.findPages("Zielseite")).length, 1);
assert.equal((await api.findDrafts("Entwurf"))[0]?.authorId, "account");
await api.createDraft("Entwurf", "<p>Inhalt</p>");
assert.equal((await api.getPage("1")).status, "draft");
await api.putDiagram("1", "stable.svg", "<svg/>");
assert.equal((await api.attachments("1")).length, 1);
await api.publish(draft, "Titel", "body", "marker");
assert.equal((await api.getPage("1")).status, "current", "Erfolgskontrolle fragt nach dem Publishing die veröffentlichte Seite ab");
assert(!calls.at(-1)!.url.searchParams.has("get-draft"));
assert.equal(calls.filter(c => c.init.method === "POST").length, 1);

let legacyCalls = 0;
const legacy = createConfluencePublicationApi({ cloudId: "cloud", spaceId: "42", accessToken: "synthetic-token",
  fetch: async (input) => {
    legacyCalls++;
    const url = new URL(String(input));
    if (!url.searchParams.has("cursor")) return Response.json({ results: [], _links: { next: "/rest/api/content?cursor=next" } });
    assert(url.pathname.startsWith("/ex/confluence/cloud/wiki/rest/"));
    return Response.json({ results: [{ id: "1", status: "draft", title: "Titel", space: { id: 42 }, version: { number: 1 }, history: { createdBy: { accountId: "account" } } }] });
  } });
assert.equal((await legacy.findDrafts("Titel"))[0]?.spaceId, "42"); assert.equal(legacyCalls, 2);

let unsafeCalls = 0;
const unsafe = createConfluencePublicationApi({ cloudId: "cloud", spaceId: "space", accessToken: "synthetic-token",
  fetch: async () => { unsafeCalls++; return Response.json({ results: [], _links: { next: "https://attacker.invalid/steal-token" } }); } });
await assert.rejects(unsafe.findPages("Titel")); assert.equal(unsafeCalls, 1);
const failed = createConfluencePublicationApi({ cloudId: "cloud", spaceId: "space", accessToken: "synthetic-token",
  fetch: async () => new Response("sensitive-response-content", { status: 403 }) });
await assert.rejects(failed.getPage("1"), (error: unknown) => error instanceof ConfluenceApiError && error.status === 403 && !error.message.includes("sensitive"));
const updateCalls: Array<{ url: URL; init: RequestInit }> = [];
const updater = createConfluencePublicationApi({ cloudId: "cloud", spaceId: "space", accessToken: "synthetic-token", fetch: async (input, init = {}) => {
  const url = new URL(String(input)); updateCalls.push({ url, init });
  if (init.method === "PUT" && url.pathname.endsWith("/child/attachment")) {
    assert.equal(url.searchParams.get("status"), "current"); return Response.json({});
  }
  if (init.method === "PUT") {
    const body = JSON.parse(String(init.body));
    assert.equal(body.version.number, 8); assert.equal(body.id, "42"); assert.equal(body.status, "current");
    assert.equal(body.ownerId, undefined); assert.equal(body.parentId, undefined); assert.equal(body.spaceId, undefined);
    return Response.json({});
  }
  assert.equal(url.searchParams.get("get-draft"), "true"); assert.equal(url.searchParams.get("status"), "draft");
  return new Response(null, { status: 404 });
} });
assert.equal(await updater.getDraft("42"), undefined);
await updater.putDiagram("42", "new.svg", "<svg/>", "current");
await updater.update({ ...draft, id: "42", status: "current", version: { number: 7 } }, "Titel", "body", "marker");
assert.equal(updateCalls.filter(c => c.init.method === "POST").length, 0);
await assert.rejects(updater.update(draft, "Titel", "body", "marker"));
const inaccessibleDraft = createConfluencePublicationApi({ cloudId: "cloud", spaceId: "space", accessToken: "synthetic-token", fetch: async () => new Response(null, { status: 403 }) });
await assert.rejects(inaccessibleDraft.getDraft("42"), (error: unknown) => error instanceof ConfluenceApiError && error.status === 403);
console.log("Confluence-Adapter geprüft: Entwurf, paginierter Abgleich, stabiler Attachment-PUT, Versionsnummer, Zeitlimit und keine Weitergabe von Tokens an fremde Hosts.");
