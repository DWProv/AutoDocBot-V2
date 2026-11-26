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
  creates = 0; uploads = 0; publishes = 0; updates = 0;
  sharedDraft?: PublicationPage;
  onUpload?: () => void;
  onUpdate?: () => void;
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
  async getDraft(_id: string) { return this.sharedDraft ? structuredClone(this.sharedDraft) : undefined; }
  async update(base: PublicationPage, title: string, body: string, message: string) {
    this.updates++;
    if (this.fault === "publish-before") throw new Error("synthetic timeout");
    this.onUpdate?.();
    const current = this.pages.get(base.id)!;
    if (current.version.number !== base.version.number) throw new ConfluenceApiError(409);

    this.pages.set(base.id, { ...current, title, body: { storage: { value: body } }, version: { number: base.version.number + 1, message, authorId: "account" } });
    this.onPublish?.();
    if (this.fault === "publish-after") throw new Error("synthetic lost response");
  }
  async putDiagram(pageId: string, title: string, svg: string) {
    this.uploads++;
    if (this.fault === "upload-before") throw new Error("synthetic timeout");
    this.files.set(pageId, [...(this.files.get(pageId) ?? []).filter(f => f.title !== title), { id: "attachment", title, fileSize: Buffer.byteLength(svg) }]);
    this.onUpload?.();
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
  const seedUpdatePage = (api: FakeApi) => {
    api.pages.set("42", { id: "42", title: "Bisheriger Artikel", status: "current", spaceId: "space", ownerId: "other-owner",
      version: { number: 7, authorId: "other" }, body: { storage: { value: '<p>Bisheriger Inhalt</p><ri:attachment ri:filename="old.svg" />' } } });
    api.files.set("42", [{ id: "old", title: "old.svg", fileSize: 123 }]);
  };
  const prepareUpdate = async (s: PublicationService, api: FakeApi) => {
    if (!api.pages.has("42")) seedUpdatePage(api);
    const source = await s.readForUpdate("42", context, api);
    const preview = await s.createPreview(onboardingSampleSpec(), "user", { sourceId: source.sourceId, context, api });
    return { source, ...preview };
  };
  const editPage = (api: FakeApi) => {
    const current = api.pages.get("42")!;
    api.pages.set("42", { ...current, version: { number: current.version.number + 1, authorId: "other" }, body: { storage: { value: "Fremde Änderung" } } });
  };
  await check("Aktualisierung: Einlesen/Vorschau schreiben nichts, Bestätigung ersetzt dieselbe Seite genau einmal", async (s, api) => {
    const p = await prepareUpdate(s, api);
    assert.equal(api.updates + api.uploads + api.creates, 0);
    assert.equal(p.operation, "update"); assert.equal(p.updateTarget?.pageId, "42");
    assert.equal(p.updateTarget?.baseVersion, 7); assert.equal(p.updateTarget?.nextVersion, 8);
    const result = await s.publish(p.previewId, context, api);
    assert.equal(result.pageId, "42"); assert.equal(result.version, 8); assert.equal(result.operation, "update");
    assert.equal(api.pages.get("42")!.ownerId, "other-owner");
    assert.deepEqual(await s.publish(p.previewId, context, api), result);
    assert.equal(api.updates, 1); assert.equal(api.creates, 0); assert.equal(api.pages.size, 1);
    assert(api.files.get("42")!.some(f => f.title === "old.svg"));
    assert.equal(s.status("user", p.previewId)[0]?.operation, "update");
  });
  for (const fault of ["upload-before", "upload-after", "publish-before", "publish-after"] as const) {
    await check(`Aktualisierung ${fault}: nach Neustart kein zweites Update und kein zweiter Diagrammanhang`, async (s, api, path, key) => {
      const p = await prepareUpdate(s, api); api.fault = fault;
      await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required");
      api.fault = "none";
      const result = await new PublicationService(path, key, context).publish(p.previewId, context, api);
      assert.equal(result.version, 8); assert.equal(result.pageId, "42"); assert.equal(api.creates, 0);
      assert.equal(api.files.get("42")!.length, 2);
      if (fault === "publish-after") assert.equal(api.updates, 1);
    });
  }
  for (const sameVersion of [false, true]) {
    await check(`Änderung zwischen Einlesen und Vorschau (gleiche Version: ${sameVersion}) wird erkannt`, async (s, api) => {
      seedUpdatePage(api); const source = await s.readForUpdate("42", context, api);
      if (sameVersion) api.pages.get("42")!.body!.storage!.value = "Manuell geänderter Inhalt"; else editPage(api);
      await expectProblem(s.createPreview(onboardingSampleSpec(), "user", { sourceId: source.sourceId, context, api }), "publication_revision_conflict");
      assert.equal(api.updates + api.uploads, 0);
    });
  }
  await check("Änderung nach Vorschau: dauerhafte Sperre des alten Auftrags, neue Vorschau erst nach neuem Einlesen", async (s, api, path, key) => {
    const p = await prepareUpdate(s, api); editPage(api);
    await expectProblem(s.publish(p.previewId, context, api), "publication_revision_conflict");
    await expectProblem(new PublicationService(path, key, context).publish(p.previewId, context, api), "publication_revision_conflict");
    assert.equal(api.updates + api.uploads, 0); assert.equal(api.pages.get("42")!.body!.storage!.value, "Fremde Änderung");
    const fresh = await prepareUpdate(s, api); await s.publish(fresh.previewId, context, api);
    assert.equal(api.pages.get("42")!.version.number, 9);
  });
  await check("Änderung während Diagrammübertragung: fremder Seiteninhalt und altes Diagramm bleiben erhalten", async (s, api) => {
    const p = await prepareUpdate(s, api); api.onUpload = () => editPage(api);
    await expectProblem(s.publish(p.previewId, context, api), "publication_revision_conflict");
    assert.equal(api.updates, 0); assert.equal(api.pages.get("42")!.body!.storage!.value, "Fremde Änderung");
    assert(api.files.get("42")!.some(f => f.title === "old.svg"));
  });
  await check("Änderung unmittelbar vor PUT: Confluence-Versionskonflikt blockiert jedes automatische Überschreiben", async (s, api) => {
    const p = await prepareUpdate(s, api); api.onUpdate = () => editPage(api);
    await expectProblem(s.publish(p.previewId, context, api), "publication_revision_conflict");
    api.onUpdate = undefined;
    await expectProblem(s.publish(p.previewId, context, api), "publication_revision_conflict");
    assert.equal(api.updates, 1); assert.equal(api.pages.get("42")!.body!.storage!.value, "Fremde Änderung");
  });
  for (const point of ["read", "preview", "publish", "upload"] as const) {
    await check(`Gemeinsamer unveröffentlichter Entwurf beim ${point} blockiert Aktualisierung`, async (s, api) => {
      seedUpdatePage(api);
      const draft = { ...structuredClone(api.pages.get("42")!), status: "draft", body: { storage: { value: "Unveröffentlichte echte Änderung" } } };
      if (point === "read") {
        api.sharedDraft = draft; await expectProblem(s.readForUpdate("42", context, api), "publication_revision_conflict");
      } else {
        const source = await s.readForUpdate("42", context, api);
        if (point === "preview") {
          api.sharedDraft = draft;
          await expectProblem(s.createPreview(onboardingSampleSpec(), "user", { sourceId: source.sourceId, context, api }), "publication_revision_conflict");
        } else {
          const p = await s.createPreview(onboardingSampleSpec(), "user", { sourceId: source.sourceId, context, api });
          if (point === "publish") api.sharedDraft = draft; else api.onUpload = () => { api.sharedDraft = draft; };
          await expectProblem(s.publish(p.previewId, context, api), "publication_revision_conflict");
        }
      }
      assert.equal(api.updates, 0); assert.equal(api.creates, 0);
    });
  }
  for (const point of ["read", "preview", "publish", "upload"] as const) {
    await check(`Identischer Restentwurf bei ${point}: gleicher Inhalt darf nach Bestätigung aktualisiert werden`, async (s, api) => {
      seedUpdatePage(api);
      const draft = { ...structuredClone(api.pages.get("42")!), status: "draft", version: { number: 1 } };
      if (point === "read") api.sharedDraft = draft;
      const source = await s.readForUpdate("42", context, api);
      if (point === "preview") api.sharedDraft = draft;
      const p = await s.createPreview(onboardingSampleSpec(), "user", { sourceId: source.sourceId, context, api });
      if (point === "publish") api.sharedDraft = draft;
      if (point === "upload") api.onUpload = () => { api.sharedDraft = draft; };
      assert.equal(api.updates + api.uploads, 0);
      const result = await s.publish(p.previewId, context, api);
      assert.equal(result.version, 8); assert.equal(api.updates, 1); assert.equal(api.creates, 0);
    });
  }
  await check("Restentwurf wird vor dem Schreiben echt verändert: kein Update", async (s, api) => {
    seedUpdatePage(api);
    api.sharedDraft = { ...structuredClone(api.pages.get("42")!), status: "draft" };
    const p = await prepareUpdate(s, api);
    api.onUpload = () => { api.sharedDraft!.body!.storage!.value = "Neue unveröffentlichte Änderung"; };
    await expectProblem(s.publish(p.previewId, context, api), "publication_revision_conflict");
    assert.equal(api.updates, 0);
  });
  await check("Unbekannter Entwurfsstatus führt zu Prüfhalt statt unsicherem Update", async (s, api) => {
    const p = await prepareUpdate(s, api); api.getDraft = async () => { throw new ConfluenceApiError(403); };
    await expectProblem(s.publish(p.previewId, context, api), "publication_review_required"); assert.equal(api.updates + api.uploads, 0);
  });
  await check("Aktualisierungsquelle bleibt an Benutzer, Atlassian-Konto, Cloud und Space gebunden", async (s, api) => {
    seedUpdatePage(api); const source = await s.readForUpdate("42", context, api);
    for (const changed of [{ ...context, userId: "other" }, { ...context, accountId: "other" }, { ...context, cloudId: "other" }, { ...context, spaceId: "other" }]) {
      await assert.rejects(s.createPreview(onboardingSampleSpec(), changed.userId, { sourceId: source.sourceId, context: changed, api }));
    }
    const p = await s.createPreview(onboardingSampleSpec(), "user", { sourceId: source.sourceId, context, api });
    await assert.rejects(s.publish(p.previewId, { ...context, accountId: "other" }, api));
    await assert.rejects(s.publish(p.previewId, context, api, "99"));
    assert.equal(api.updates + api.uploads, 0);
  });
  await check("Falscher Space, Entwurf oder fehlender Inhalt sind keine aktualisierbaren Ziele", async (s, api) => {
    for (const change of [{ spaceId: "other" }, { status: "draft" }, { body: undefined }]) {
      seedUpdatePage(api); Object.assign(api.pages.get("42")!, change);
      await expectProblem(s.readForUpdate("42", context, api), "publication_review_required");
    }
  });
  await check("Neuer Titel mit fremder Namensgleichheit führt zu Konflikt ohne Upload", async (s, api) => {
    const p = await prepareUpdate(s, api);
    api.pages.set("99", { ...api.pages.get("42")!, id: "99", title: onboardingSampleSpec().title });
    await expectProblem(s.publish(p.previewId, context, api), "publication_conflict"); assert.equal(api.updates + api.uploads, 0);
  });
  await check("Erneute Anmeldung während Update bewahrt Auftrag und bisherigen Seiteninhalt", async (s, api) => {
    const p = await prepareUpdate(s, api), update = api.update.bind(api);
    api.update = async () => { throw new ConfluenceApiError(401); };
    await expectProblem(s.publish(p.previewId, context, api), "publication_authorization_required");
    assert.equal(api.pages.get("42")!.version.number, 7); api.update = update;
    await s.publish(p.previewId, context, api); assert.equal(api.pages.get("42")!.version.number, 8);
  });
  await check("Fehlender neuer Diagrammanhang verhindert Update des bestehenden Seiteninhalts", async (s, api) => {
    const p = await prepareUpdate(s, api); api.putDiagram = async () => {};
    await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required"); assert.equal(api.updates, 0);
    assert.equal(api.pages.get("42")!.version.number, 7);
  });
  await check("Quell- und Vorschauablauf verhindern unbestätigte späte Aktualisierungen", async (s, api) => {
    const p = await prepareUpdate(s, api), now = Date.now;
    Date.now = () => now() + 31 * 60_000;
    try {
      await assert.rejects(s.createPreview(onboardingSampleSpec(), "user", { sourceId: p.source.sourceId, context, api }));
      await assert.rejects(s.publish(p.previewId, context, api));
    } finally { Date.now = now; }
    assert.equal(api.updates + api.uploads, 0);
  });
  await check("Nach verlorenem Update und fremder Folgeänderung niemals erneut schreiben", async (s, api) => {
    const p = await prepareUpdate(s, api); api.fault = "publish-after";
    await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required"); api.fault = "none"; editPage(api);
    await expectProblem(s.publish(p.previewId, context, api), "publication_revision_conflict");
    assert.equal(api.updates, 1); assert.equal(api.pages.get("42")!.version.number, 9);
  });
  await check("Speicherausfall nach Update: Wiederaufnahme erkennt eigene Version und schreibt kein zweites Mal", async (s, api, path, key) => {
    const p = await prepareUpdate(s, api);
    const originalSet = EncryptedJsonStore.prototype.set;
    let fail = true;
    EncryptedJsonStore.prototype.set = function(id, value: unknown) {
      if (fail && (value as { stage?: string }).stage === "published") { fail = false; throw new Error("synthetic disk failure"); }
      return originalSet.call(this, id, value);
    };
    try { await assert.rejects(s.publish(p.previewId, context, api)); }
    finally { EncryptedJsonStore.prototype.set = originalSet; }
    const result = await new PublicationService(path, key, context).publish(p.previewId, context, api);
    assert.equal(result.version, 8); assert.equal(api.updates, 1);
  });
  await check("Bestätigte Aktualisierung bleibt nach Vorschauablauf fortsetzbar", async (s, api) => {
    const p = await prepareUpdate(s, api), now = Date.now; api.fault = "publish-before";
    await expectProblem(s.publish(p.previewId, context, api), "publication_retry_required"); api.fault = "none";
    Date.now = () => now() + 31 * 60_000;
    try { assert.equal((await s.publish(p.previewId, context, api)).version, 8); }
    finally { Date.now = now; }
  });
  await check("Zwei bestätigte Vorschauen auf derselben Basis: nur eine gewinnt", async (s, api) => {
    const a = await prepareUpdate(s, api);
    const source = await s.readForUpdate("42", context, api), spec = onboardingSampleSpec(); spec.summary += " Neuer Stand.";
    const b = await s.createPreview(spec, "user", { sourceId: source.sourceId, context, api });
    await s.publish(a.previewId, context, api);
    await expectProblem(s.publish(b.previewId, context, api), "publication_revision_conflict");
    assert.equal(api.updates, 1); assert.equal(api.pages.get("42")!.version.number, 8);
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
