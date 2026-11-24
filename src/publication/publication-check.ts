import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicationService, PublicationProblem, type PublicationContext } from "./publication-service.js";
import { ConfluenceApiError, type PublicationApi, type PublicationPage, type PublicationAttachment } from "./confluence-api.js";
import { onboardingSampleSpec } from "../article/sample-process.js";
import { EncryptedJsonStore } from "../auth/encrypted-json-store.js";

type Fault = "create-before" | "create-after" | "upload-before" | "upload-after" | "publish-before" | "publish-after" | "create-rejected" | "none";
class FakeApi implements PublicationApi {
  pages = new Map<string, PublicationPage>();
  files = new Map<string, PublicationAttachment[]>();
  creates = 0; uploads = 0; publishes = 0;
  fault: Fault = "none";
  onCreate?: () => Promise<void> | void;
  onPublish?: () => void;
  async findPages(title: string) { return [...this.pages.values()].filter(p => p.title === title).map(p => structuredClone(p)); }
  async findDrafts(title: string) { return (await this.findPages(title)).filter(p => p.status === "draft"); }
  async createDraft(title: string, body: string) {
    this.creates++;
    if (this.fault === "create-before") throw new Error("synthetic timeout");
    if (this.fault === "create-rejected") throw new ConfluenceApiError(403);
    const page: PublicationPage = { id: String(this.creates), title, status: "draft", spaceId: "space", ownerId: "account",
      version: { number: 1, authorId: "account" }, body: { storage: { value: body } } };
    this.pages.set(page.id, page);
    await this.onCreate?.();
    if (this.fault === "create-after") throw new Error("synthetic lost response");
    return structuredClone(page);
  }
  async getPage(id: string) { const page = this.pages.get(id); if (!page) throw new ConfluenceApiError(404); return structuredClone(page); }
  async putDiagram(pageId: string, title: string, svg: string) {
    this.uploads++;
    if (this.fault === "upload-before") throw new Error("synthetic timeout");
    this.files.set(pageId, [{ id: "attachment", title, fileSize: Buffer.byteLength(svg) }]);
    if (this.fault === "upload-after") throw new Error("synthetic lost response");
  }
  async attachments(id: string) { return structuredClone(this.files.get(id) ?? []); }
  async publish(draft: PublicationPage, title: string, body: string, message: string) {
    this.publishes++;
    if (this.fault === "publish-before") throw new Error("synthetic timeout");
    assert.equal(draft.status, "draft");
    assert.equal(this.files.get(draft.id)?.length, 1, "Niemals ohne Diagramm veröffentlichen");
    const current = this.pages.get(draft.id)!;
    if (current.version.number !== draft.version.number) throw new ConfluenceApiError(409);
    this.pages.set(draft.id, { ...current, title, status: "current", body: { storage: { value: body } },
      version: { number: 1, message, authorId: "account" } });
    this.onPublish?.();
    if (this.fault === "publish-after") throw new Error("synthetic lost response");
  }
}

const context: PublicationContext = { userId: "user", accountId: "account", cloudId: "cloud", spaceId: "space", spaceKey: "SP", spaceName: "Space", siteUrl: "https://test.invalid" };
const root = mkdtempSync(join(tmpdir(), "autodocbot-publishing-"));
let count = 0;
async function check(name: string, run: (s: PublicationService, api: FakeApi, path: string, key: Buffer) => Promise<void>) {
  const directory = join(root, String(++count)); mkdirSync(directory);
  const path = join(directory, "jobs.json"), key = randomBytes(32);
  await run(new PublicationService(path, key, context), new FakeApi(), path, key);
  console.log(`OK: ${name}`);
}
const expectProblem = async (promise: Promise<unknown>, status: PublicationProblem["status"]) => {
  await assert.rejects(promise, (error: unknown) => error instanceof PublicationProblem && error.status === status);
};
try {
  await check("normaler Ablauf, Wiederholung und neue Vorschau desselben Inhalts ergeben dieselbe Seite", async (s, api) => {
    const preview = await s.createPreview(onboardingSampleSpec(), context.userId);
    const a = await s.publish(preview.previewId, context, api);
    assert.deepEqual(await s.publish(preview.previewId, context, api), a);
    const b = await s.createPreview(onboardingSampleSpec(), context.userId);
    assert.deepEqual(await s.publish(b.previewId, context, api), a);
    assert.equal(api.creates, 1); assert.equal(api.publishes, 1);
  });
  for (const fault of ["create-after", "upload-before", "upload-after", "publish-before", "publish-after"] as const) {
    await check(`${fault}: nach Neustart denselben Auftrag ohne neue Seite fortsetzen`, async (s, api, path, key) => {
      const p = await s.createPreview(onboardingSampleSpec(), "user"); api.fault = fault;
      await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required");
      assert(api.pages.size <= 1);
      if (fault !== "publish-after") assert([...api.pages.values()].every(p => p.status === "draft"));
      api.fault = "none";
      const restarted = new PublicationService(path, key, context);
      const result = await restarted.publish(p.previewId, context, api);
      assert.equal(result.pageId, "1"); assert.equal(api.creates, 1); assert.equal(api.pages.size, 1);
      assert.equal(api.pages.get("1")!.status, "current");
      assert.equal(api.pages.get("1")!.version.number, 1, "Erstveröffentlichung und Wiederaufnahme erkennen Version 1");
    });
  }
  await check("unbekannter Ausgang der Entwurfsanlage ohne Fund: niemals blind erneut anlegen", async (s, api) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user"); api.fault = "create-before";
    await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required"); api.fault = "none";
    await expectProblem(s.publish(p.previewId, context, api), "publication_review_required");
    await expectProblem(s.publish(p.previewId, context, api), "publication_review_required");
    assert.equal(api.creates, 1); assert.equal(api.pages.size, 0);
  });
  await check("eindeutig abgelehnte Entwurfsanlage ist nach Korrektur wiederholbar", async (s, api) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user"); api.fault = "create-rejected";
    await expectProblem(s.publish(p.previewId, context, api), "publication_review_required");
    api.fault = "none"; await s.publish(p.previewId, context, api); assert.equal(api.pages.size, 1);
  });
  for (const httpStatus of [400, 422]) {
    await check(`HTTP ${httpStatus} ist Prüfbedarf, keine Aufforderung zu zeitbasiertem Retry`, async (s, api) => {
      const p = await s.createPreview(onboardingSampleSpec(), "user");
      const publish = api.publish.bind(api);
      api.publish = async () => { throw new ConfluenceApiError(httpStatus, "draft_publish"); };
      await expectProblem(s.publish(p.previewId, context, api), "publication_review_required");
      assert.equal(s.status("user")[0]?.status, "publication_review_required");
      assert.equal(s.status("user")[0]?.stage, "publishing");
      api.publish = publish;
      const result = await s.publish(p.previewId, context, api);
      assert.equal(result.pageId, "1");
      assert.equal(api.pages.get("1")!.version.number, 1);
      assert.equal(api.creates, 1);
    });
  }
  await check("nicht verfügbare Draft-Suche: nur passende echte Entwurfs-ID übernehmen", async (s, api) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user"); api.fault = "create-after";
    await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required"); api.fault = "none";
    api.findDrafts = async () => { throw new ConfluenceApiError(404); };
    await expectProblem(s.publish(p.previewId, context, api), "publication_review_required");
    assert(s.status("user")[0]?.expectedDraftTitle);
    api.pages.set("other", { ...structuredClone(api.pages.get("1")!), id: "other", title: "Fremder Entwurf" });
    await expectProblem(s.publish(p.previewId, context, api, "other"), "publication_review_required");
    const result = await s.publish(p.previewId, context, api, "1");
    assert.equal(result.pageId, "1"); assert.equal(api.creates, 1);
  });
  await check("HTTP 401 verlangt Wiederanmeldung und erhält den bestätigten Auftrag", async (s, api) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user");
    const create = api.createDraft.bind(api);
    api.createDraft = async () => { throw new ConfluenceApiError(401); };
    await expectProblem(s.publish(p.previewId, context, api), "publication_authorization_required");
    api.createDraft = create; await s.publish(p.previewId, context, api); assert.equal(api.creates, 1);
  });
  await check("fehlendes Attachment verhindert Veröffentlichung und wird erneut hochgeladen", async (s, api) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user");
    const put = api.putDiagram.bind(api); api.putDiagram = async () => undefined;
    await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required");
    assert.equal(api.publishes, 0); assert.equal(api.pages.get("1")?.status, "draft");
    api.putDiagram = put; await s.publish(p.previewId, context, api); assert.equal(api.creates, 1);
  });
  await check("gleichnamige vorhandene Seite blockiert Neuanlage und Überschreiben", async (s, api) => {
    const spec = onboardingSampleSpec();
    api.pages.set("existing", { id: "existing", status: "current", title: spec.title, spaceId: "space", version: { number: 7 } });
    const p = await s.createPreview(spec, "user");
    await expectProblem(s.publish(p.previewId, context, api), "publication_conflict");
    assert.equal(api.creates, 0); assert.equal(api.pages.get("existing")!.version.number, 7);
  });
  await check("Benutzer, Atlassian-Konto und Zielbereich bleiben gebunden", async (s, api, path, key) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user");
    await assert.rejects(s.publish(p.previewId, { ...context, userId: "other" }, api));
    api.fault = "upload-before";
    await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required"); api.fault = "none";
    await assert.rejects(s.publish(p.previewId, { ...context, accountId: "other" }, api));
    assert.deepEqual(s.status("other"), []);
    assert.throws(() => s.status("other", p.previewId));
    const moved = new PublicationService(path, key, { ...context, spaceId: "other" });
    await assert.rejects(moved.publish(p.previewId, { ...context, spaceId: "other" }, api));
    assert.equal(api.creates, 1);
  });
  await check("parallele Service-Instanzen können denselben Vorgang nicht doppelt starten", async (s, api, path, key) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user");
    let proceed!: () => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    api.onCreate = async () => { entered(); await new Promise<void>(resolve => { proceed = resolve; }); };
    const first = s.publish(p.previewId, context, api); await ready;
    const other = new PublicationService(path, key, context);
    await expectProblem(other.publish(p.previewId, context, api), "publication_busy");
    proceed(); await first; await other.publish(p.previewId, context, api); assert.equal(api.creates, 1);
  });
  for (const phase of ["create", "publish"] as const) {
    await check(`Speicherausfall nach ${phase}: trotz verlorener Quittierung keine zweite Seite`, async (s, api, path, key) => {
      const p = await s.createPreview(onboardingSampleSpec(), "user");
      const temporaryPath = `${path}.${process.pid}.tmp`;
      const fail = () => { mkdirSync(temporaryPath); };
      if (phase === "create") api.onCreate = fail; else api.onPublish = fail;
      await assert.rejects(s.publish(p.previewId, context, api));
      rmSync(temporaryPath, { recursive: true }); api.onCreate = undefined; api.onPublish = undefined;
      await new PublicationService(path, key, context).publish(p.previewId, context, api);
      assert.equal(api.creates, 1); assert.equal(api.pages.size, 1); assert.equal(api.publishes, 1);
    });
  }
  await check("veränderter Entwurfsinhalt wird auch bei unveränderter Versionsnummer nicht überschrieben", async (s, api) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user"); api.fault = "upload-before";
    await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required"); api.fault = "none";
    api.pages.get("1")!.body = { storage: { value: "Manuelle Änderung" } };
    await expectProblem(s.publish(p.previewId, context, api), "publication_review_required"); assert.equal(api.publishes, 0);
  });
  await check("abgelaufene bestätigte Vorgänge bleiben fortsetzbar; unbestätigte verfallen", async (s, api, path, key) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user"); api.fault = "upload-before";
    await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required");
    const fresh = await s.createPreview(onboardingSampleSpec(), "user");
    const store = new EncryptedJsonStore<Record<string, unknown>>(path, key);
    for (const id of [p.previewId, fresh.previewId]) { const item = store.get(`preview:${id}`)!; store.set(`preview:${id}`, { ...item, expiresAt: 0 }); }
    api.fault = "none";
    await assert.rejects(s.publish(fresh.previewId, context, api));
    await s.publish(p.previewId, context, api); assert.equal(api.creates, 1);
  });
  await check("Prozessdaten verschlüsselt; nach Erfolg nur Deduplizierungsmetadaten im Auftrag", async (s, api, path, key) => {
    const p = await s.createPreview(onboardingSampleSpec(), "user");
    assert(!readFileSync(path, "utf8").includes("Onboarding"));
    await s.publish(p.previewId, context, api);
    const store = new EncryptedJsonStore<Record<string, unknown>>(path, key);
    for (const [, item] of store.entries()) assert(!item.snapshot);
    assert.equal(s.status("user")[0]!.stage, "published");
  });
  console.log(`${count} Prüfungen der fortsetzbaren Veröffentlichung erfolgreich.`);
} finally { rmSync(root, { recursive: true, force: true }); }
