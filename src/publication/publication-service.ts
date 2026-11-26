import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import type { ArticleSpec } from "../article/article-spec.js";
import type { ResolvedStyleGuide } from "../article/styleguide.js";
import { resolveStyleGuide } from "../article/styleguide.js";
import { renderConfluenceStorage } from "../article/renderer.js";
import { generateProcessSvg } from "../diagram/process-svg.js";
import { EncryptedJsonStore } from "../auth/encrypted-json-store.js";
import { INITIAL_PUBLISHED_VERSION, ConfluenceApiError, type PublicationApi, type PublicationPage } from "./confluence-api.js";

import { isUnchangedDraft } from "./draft-comparison.js";

const attachmentPlaceholder = "AUTODOCBOT_ATTACHMENT_PLACEHOLDER";
type Snapshot = { spec: ArticleSpec; style: ResolvedStyleGuide; svg: string; bodyTemplate: string };
type UpdateTarget = { pageId: string; title: string; version: number; bodyHash: string; accountId: string; cloudId: string };
type UpdateSource = { kind: "update_source"; userId: string; siteUrl: string; spaceId: string; expiresAt: number; target: UpdateTarget };
export type UpdatePreviewInfo = { pageId: string; pageUrl: string; previousTitle: string; baseVersion: number; nextVersion: number; replacementNotice: string };
type Preview = { update?: UpdateTarget; kind: "preview"; userId: string; siteUrl: string; spaceId: string; expiresAt: number; jobId?: string; snapshot?: Snapshot };
export type JobStage = "prepared" | "creating_draft" | "draft_ready" | "uploading_diagram" | "diagram_ready" | "publishing" | "published";
export type PublishedArticle = {
  pageId: string; pageUrl: string; title: string; spaceId: string; spaceKey: string; spaceName: string;
  styleGuideVersion: string; diagramDirection: string; attributionConfirmed: boolean; operation?: "create" | "update"; version?: number;
};
type Job = {
  kind: "job"; id: string; userId: string; accountId: string; cloudId: string; spaceId: string;
  previewId: string; title: string; draftTitle: string; attachmentName: string;
  createdAt: number; updatedAt: number; stage: JobStage; pageId?: string; draftVersion?: number; draftBodyHash?: string;
  update?: UpdateTarget; snapshot?: Snapshot; result?: PublishedArticle; lastProblem?: string; problemStatus?: PublicationProblem["status"];
};
type Stored = Preview | Job | UpdateSource;
export type PublicationContext = {
  userId: string; accountId: string; cloudId: string;
  spaceId: string; spaceKey: string; spaceName: string; siteUrl: string;
};
export class PublicationProblem extends Error {
  constructor(readonly status: "publication_retry_required" | "publication_review_required" | "publication_conflict" | "publication_busy" | "publication_authorization_required" | "publication_revision_conflict", message: string,
    readonly previewId: string, readonly jobId?: string, readonly stage?: JobStage) { super(message); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}`;
  return JSON.stringify(value);
}

const hashBody = (value: string) => createHash("sha256").update(value.trim()).digest("hex");
const revisionMessage = "Die Seite oder ihr Entwurf wurde verändert. Bitte die aktuelle Seite neu einlesen, die Änderungen abstimmen und eine neue Vorschau ausdrücklich bestätigen. Der alte Auftrag überschreibt nichts.";

export class PublicationService {
  constructor(readonly path: string, readonly key: Buffer, readonly target: { siteUrl: string; spaceId: string }) {}

  private async locked<T>(previewId: string, operation: (store: EncryptedJsonStore<Stored>, guard: () => void) => Promise<T>): Promise<T> {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    let compromised = false;
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(this.path, { realpath: false, stale: 60_000, update: 10_000, retries: 0,
        onCompromised: () => { compromised = true; } });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
      throw new PublicationProblem("publication_busy", "Eine Veröffentlichung läuft bereits. Bitte denselben Vorgang später erneut aufrufen.", previewId);
    }
    const guard = () => { if (compromised) throw new PublicationProblem("publication_review_required", "Die Veröffentlichungssperre wurde unterbrochen. Bitte zunächst den Auftragsstatus prüfen.", previewId); };
    try { return await operation(new EncryptedJsonStore<Stored>(this.path, this.key), guard); }
    finally { await release().catch(() => undefined); }
  }

  private assertContext(context: PublicationContext) {
    if (context.siteUrl !== this.target.siteUrl || context.spaceId !== this.target.spaceId) throw new Error("Der Veröffentlichungsbereich hat sich geändert.");
  }

  private async readUpdatePage(pageId: string, context: PublicationContext, api: PublicationApi, previewId = ""): Promise<PublicationPage> {
    this.assertContext(context);
    if (!/^[0-9]{1,30}$/u.test(pageId)) throw new Error("Ungültige Confluence-Seiten-ID.");
    const page = await api.getPage(pageId);
    if (page.id !== pageId || page.status !== "current" || page.spaceId !== context.spaceId ||
      !Number.isSafeInteger(page.version?.number) || page.version.number < 1 || page.body?.storage?.value === undefined) {
      throw new PublicationProblem("publication_review_required", "Nur lesbare veröffentlichte Seiten im konfigurierten Ziel-Space können aktualisiert werden.", previewId);
    }
    // A residual draft may be identical except for a generated built-in info
    // macro UUID. Anything else (including unreadable or mismatched drafts)
    // still blocks. Repeated here for reading, preview and pre-write checks.
    const draft = await api.getDraft(pageId);
    if (draft && !isUnchangedDraft(page, draft)) throw new PublicationProblem("publication_revision_conflict", "Auf dieser Seite liegen unveröffentlichte Änderungen vor. Diese müssen zuerst in Confluence geklärt werden. " + revisionMessage, previewId);
    return page;
  }

  async readForUpdate(pageId: string, context: PublicationContext, api: PublicationApi) {
    const sourceId = randomBytes(18).toString("base64url"), expiresAt = Date.now() + 30 * 60_000;
    return this.locked(sourceId, async (store, guard) => {
      guard(); const page = await this.readUpdatePage(pageId, context, api);
      const body = page.body!.storage!.value!;
      if (Buffer.byteLength(body) > 100_000) throw new Error("Die Seite ist für eine vollständige Aktualisierungsvorschau zu groß.");
      guard(); this.cleanupExpired(store);
      store.set(`update_source:${sourceId}`, { kind: "update_source", userId: context.userId, ...this.target, expiresAt,
        target: { pageId, title: page.title, version: page.version.number, bodyHash: hashBody(body), accountId: context.accountId, cloudId: context.cloudId } });
      return { sourceId, pageId, title: page.title, version: page.version.number, bodyStorage: body,
        pageUrl: `${context.siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`, expiresAt: new Date(expiresAt).toISOString() };
    });
  }

  private cleanupExpired(store: EncryptedJsonStore<Stored>) {
    for (const [id, item] of store.entries()) {
      if ((item.kind === "update_source" || (item.kind === "preview" && !item.jobId)) && item.expiresAt <= Date.now()) store.delete(id);
    }
  }

  async createPreview(spec: ArticleSpec, userId: string, update?: { sourceId: string; context: PublicationContext; api: PublicationApi }) {
    const style = resolveStyleGuide(spec.style), svg = generateProcessSvg(spec, style);
    const bodyTemplate = renderConfluenceStorage(spec, style, attachmentPlaceholder);
    const previewId = randomBytes(18).toString("base64url"), expiresAt = Date.now() + 30 * 60_000;
    let target: UpdateTarget | undefined;
    await this.locked(previewId, async (store, guard) => {
      if (update) {
        const source = store.get(`update_source:${update.sourceId}`), context = update.context;
        this.assertContext(context);
        if (!source || source.kind !== "update_source" || source.expiresAt <= Date.now() || source.userId !== userId || context.userId !== userId ||
          source.siteUrl !== context.siteUrl || source.spaceId !== context.spaceId || source.target.accountId !== context.accountId || source.target.cloudId !== context.cloudId) {
          throw new PublicationProblem("publication_review_required", "Der eingelesene Seitenstand ist abgelaufen oder gehört zu einer anderen Verbindung. Bitte die Seite neu einlesen.", previewId);
        }
        guard(); const page = await this.readUpdatePage(source.target.pageId, context, update.api, previewId);
        if (page.title !== source.target.title || page.version.number !== source.target.version || hashBody(page.body!.storage!.value!) !== source.target.bodyHash) {
          throw new PublicationProblem("publication_revision_conflict", revisionMessage, previewId);
        }
        target = source.target;
      }
      guard(); this.cleanupExpired(store);
      store.set(`preview:${previewId}`, { kind: "preview", userId, ...this.target, expiresAt,
        ...(target ? { update: target } : {}), snapshot: { spec, style, svg, bodyTemplate } });
    });
    const updateTarget: UpdatePreviewInfo | undefined = target ? {
      pageId: target.pageId, pageUrl: `${this.target.siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(target.pageId)}`,
      previousTitle: target.title, baseVersion: target.version, nextVersion: target.version + 1,
      replacementNotice: "Der vollständige Seiteninhalt einschließlich Prozessdiagramm wird durch diese Vorschau ersetzt. Seiten-ID und bestehende Anhänge bleiben erhalten. Nur die ausdrückliche Bestätigung dieser Aktualisierungsvorschau erlaubt das Schreiben.",
    } : undefined;
    return { previewId, expiresAt, style, svg, operation: target ? "update" as const : "create" as const, updateTarget };
  }

  status(userId: string, previewId?: string) {
    const store = new EncryptedJsonStore<Stored>(this.path, this.key);
    const preview = previewId ? store.get(`preview:${previewId}`) : undefined;
    if (previewId && (!preview || preview.kind !== "preview" || preview.userId !== userId)) throw new Error("Vorgang nicht gefunden.");
    return [...store.entries()].map(([, item]) => item).filter((item): item is Job => item.kind === "job" && item.userId === userId && (!preview || preview.kind !== "preview" || item.id === preview.jobId))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20).map(job => ({
        jobId: job.id, previewId: job.previewId, title: job.title, stage: job.stage, operation: job.update ? "update" : "create",
        ...(job.update ? { targetPageId: job.update.pageId, baseVersion: job.update.version } : {}),
        updatedAt: new Date(job.updatedAt).toISOString(), problem: job.lastProblem, status: job.problemStatus ?? (job.stage === "published" ? "published" : "publication_pending"),
        ...(!job.pageId && job.stage === "creating_draft" ? { expectedDraftTitle: job.draftTitle } : {}),
        ...(job.result ? { result: job.result } : {}),
      }));
  }

  async publish(previewId: string, context: PublicationContext, api: PublicationApi, recoveryPageId?: string): Promise<PublishedArticle> {
    if (context.siteUrl !== this.target.siteUrl || context.spaceId !== this.target.spaceId) throw new Error("Der Veröffentlichungsbereich hat sich geändert.");
    return this.locked(previewId, async (store, guard) => {
      const preview = store.get(`preview:${previewId}`);
      if (!preview || preview.kind !== "preview" || preview.userId !== context.userId) throw new Error("Die Vorschau ist ungültig oder gehört zu einem anderen Benutzer.");
      if (preview.siteUrl !== context.siteUrl || preview.spaceId !== context.spaceId) throw new Error("Der Zielbereich der Vorschau hat sich geändert. Bitte eine neue Vorschau bestätigen.");
      if (preview.update && (preview.update.accountId !== context.accountId || preview.update.cloudId !== context.cloudId)) {
        throw new Error("Die Aktualisierungsvorschau gehört zu einer anderen Atlassian-Verbindung. Bitte die Seite neu einlesen.");
      }
      let storedJob = preview.jobId ? store.get(`job:${preview.jobId}`) : undefined;
      if (!storedJob) {
        if (!preview.snapshot || preview.expiresAt <= Date.now()) throw new Error("Die Vorschau ist abgelaufen. Bitte eine neue Vorschau erzeugen und bestätigen.");
        const id = createHash("sha256").update(canonical({ userId: context.userId, accountId: context.accountId,
          cloudId: context.cloudId, spaceId: context.spaceId, snapshot: preview.snapshot, ...(preview.update ? { update: preview.update } : {}) })).digest("hex");
        storedJob = store.get(`job:${id}`);
        if (!storedJob) {
          const now = Date.now();
          storedJob = { kind: "job", id, userId: context.userId, accountId: context.accountId,
            cloudId: context.cloudId, spaceId: context.spaceId, previewId, title: preview.snapshot.spec.title,
            draftTitle: `Entwurf: ${preview.snapshot.spec.title.slice(0, 55)} [${id}]`, attachmentName: `process-diagram-${id}.svg`,
            createdAt: now, updatedAt: now, stage: "prepared", snapshot: preview.snapshot,
            ...(preview.update ? { update: preview.update, pageId: preview.update.pageId } : {}) };
          guard(); store.set(`job:${id}`, storedJob);
        }
        guard(); store.set(`preview:${previewId}`, { kind: "preview", userId: context.userId, ...this.target, expiresAt: preview.expiresAt, jobId: id, ...(preview.update ? { update: preview.update } : {}) });
      }
      if (storedJob.kind !== "job" || storedJob.userId !== context.userId || storedJob.accountId !== context.accountId ||
        storedJob.cloudId !== context.cloudId || storedJob.spaceId !== context.spaceId) throw new Error("Der Auftrag gehört zu einer anderen Benutzerverbindung oder einem anderen Zielbereich.");
      let job: Job = structuredClone(storedJob);
      if (recoveryPageId && job.update) throw new Error("Eine Aktualisierung darf keiner anderen Seite zugeordnet werden.");
      if (recoveryPageId && (job.stage === "prepared" || (job.pageId && job.pageId !== recoveryPageId))) throw new Error("Eine Entwurfszuordnung ist für diesen Auftrag nicht zulässig.");
      if (job.result) return job.result;
      if (job.problemStatus === "publication_revision_conflict") throw new PublicationProblem("publication_revision_conflict", revisionMessage, previewId, job.id, job.stage);
      const save = (patch: Partial<Job>) => {
        guard();
        const next = { ...job, ...patch, updatedAt: Date.now() };
        store.set(`job:${job.id}`, next); job = next;
      };
      const problem = (status: PublicationProblem["status"], message: string): never => {
        save({ lastProblem: message, problemStatus: status });
        throw new PublicationProblem(status, message, job.previewId, job.id, job.stage);
      };
      const conflictCheck = async () => {
        guard(); const matches = await api.findPages(job.title);
        if (matches.some(p => p.id !== job.pageId)) problem("publication_conflict", "Im Ziel-Space existiert bereits eine sichtbare veröffentlichte Seite mit diesem Titel. Es wird nichts überschrieben oder zusätzlich veröffentlicht.");
      };
      const snapshot = job.snapshot;
      if (!snapshot) throw new Error("Der gespeicherte Auftragsinhalt fehlt.");
      const body = snapshot.bodyTemplate.replace(`ri:filename="${attachmentPlaceholder}"`, `ri:filename="${job.attachmentName}"`);
      const bodyHash = (value: string) => createHash("sha256").update(value.trim()).digest("hex");
      const marker = `AutoDocBot:${job.id}`;
      const finish = (page: PublicationPage) => {
        const result: PublishedArticle = {
          pageId: page.id, pageUrl: `${context.siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(page.id)}`,
          title: job.title, spaceId: context.spaceId, spaceKey: context.spaceKey, spaceName: context.spaceName,
          styleGuideVersion: snapshot.style.version, diagramDirection: snapshot.style.diagramDirection,
          attributionConfirmed: page.version.authorId === context.accountId, operation: job.update ? "update" : "create", version: page.version.number,
        };
        save({ stage: "published", result, snapshot: undefined, lastProblem: undefined, problemStatus: undefined });
        return result;
      };
      try {
        if (job.update) {
          const target = job.update;
          const checkBase = async () => {
            guard(); const page = await this.readUpdatePage(target.pageId, context, api, previewId);
            if (page.version.number !== target.version || page.title !== target.title || hashBody(page.body!.storage!.value!) !== target.bodyHash) {
              return problem("publication_revision_conflict", revisionMessage);
            }
            return page;
          };
          // A lost PUT response is recovered before checking the old base. Never
          // increment again merely because the response was lost.
          guard(); const current = await api.getPage(target.pageId);
          if (current.spaceId !== context.spaceId || current.id !== target.pageId) problem("publication_revision_conflict", revisionMessage);
          if (job.stage === "publishing" && current.status === "current" && current.version.number === target.version + 1 &&
            current.title === job.title && current.version.message === marker && current.version.authorId === context.accountId &&
            current.body?.storage?.value?.includes(job.attachmentName)) {
            guard(); const files = await api.attachments(current.id);
            if (files.some(a => a.title === job.attachmentName)) return finish(current);
            return problem("publication_review_required", "Die Aktualisierung ist sichtbar, ihr Diagrammanhang kann jedoch nicht bestätigt werden. Keine erneute Aktualisierung ausführen.");
          }
          await checkBase();
          await conflictCheck();
          guard(); let files = await api.attachments(target.pageId);
          const file = files.find(a => a.title === job.attachmentName);
          if (file && file.fileSize !== undefined && file.fileSize !== Buffer.byteLength(snapshot.svg)) {
            return problem("publication_review_required", "Der auftragsspezifische Diagrammanhang wurde verändert. Er wird nicht überschrieben.");
          }
          if (!file) {
            save({ stage: "uploading_diagram" });
            guard(); await api.putDiagram(target.pageId, job.attachmentName, snapshot.svg, "current");
          }
          guard(); files = await api.attachments(target.pageId);
          if (!files.some(a => a.title === job.attachmentName && (a.fileSize === undefined || a.fileSize === Buffer.byteLength(snapshot.svg)))) {
            return problem("publication_retry_required", "Das neue Diagramm ist noch nicht vollständig verfügbar. Die bestehende Seite wird noch nicht aktualisiert.");
          }
          save({ stage: "diagram_ready" });
          await conflictCheck();
          const base = await checkBase();
          save({ stage: "publishing", lastProblem: undefined, problemStatus: undefined });
          guard(); await api.update(base, job.title, body, marker);
          guard(); const updated = await api.getPage(target.pageId);
          if (updated.id !== target.pageId || updated.spaceId !== context.spaceId || updated.status !== "current" || updated.title !== job.title ||
            updated.version.number !== target.version + 1 || updated.version.message !== marker || updated.version.authorId !== context.accountId ||
            !updated.body?.storage?.value?.includes(job.attachmentName)) {
            return problem("publication_review_required", "Die Aktualisierung konnte nicht sicher bestätigt werden. Bitte denselben Auftrag prüfen, keine neue Version blind schreiben.");
          }
          return finish(updated);
        }
        if (job.stage === "prepared") {
          await conflictCheck();
          save({ stage: "creating_draft", lastProblem: undefined, problemStatus: undefined });
          {
            let draft: PublicationPage;
            try { guard(); draft = await api.createDraft(job.draftTitle, body); }
            catch (error) {
              if (error instanceof ConfluenceApiError && [400, 401, 403, 409, 422, 429].includes(error.status)) save({ stage: "prepared" });
              throw error;
            }
            save({ pageId: draft.id, draftVersion: draft.version?.number,
              draftBodyHash: draft.body?.storage?.value !== undefined ? bodyHash(draft.body.storage.value) : undefined, stage: "draft_ready" });
          }
        }
        if (!job.pageId) {
          guard(); let drafts: PublicationPage[];
          try { drafts = recoveryPageId ? [await api.getPage(recoveryPageId)] : await api.findDrafts(job.draftTitle); }
          catch (error) {
            if (error instanceof ConfluenceApiError && error.status === 401) throw error;
            return problem("publication_review_required", "Der Entwurf lässt sich über die API nicht sicher finden. Prüfe den erwarteten Entwurfstitel im Auftragsstatus. Ein Benutzer kann die tatsächliche Seiten-ID seines Entwurfs als recoveryPageId zuordnen; keine ID erfinden und keine zweite Seite anlegen.");
          }
          if (drafts.length !== 1) problem("publication_review_required", "Die Antwort auf die Entwurfsanlage fehlt und der Entwurf lässt sich nicht eindeutig finden. Es wird keine weitere Seite angelegt. Bitte später denselben Auftrag erneut prüfen.");
          guard(); const draft = await api.getPage(drafts[0]!.id);
          if (draft.status !== "draft" || draft.title !== job.draftTitle || draft.spaceId !== context.spaceId ||
            (draft.ownerId ?? draft.authorId) !== context.accountId || draft.version.number > 1) {
            problem("publication_review_required", "Der gefundene Entwurf lässt sich nicht sicher dem unveränderten Auftrag zuordnen.");
          }
          save({ pageId: draft.id, draftVersion: draft.version.number, stage: "draft_ready" });
        }
        guard(); let page = await api.getPage(job.pageId!);
        if (page.spaceId !== context.spaceId) problem("publication_review_required", "Der Entwurf befindet sich nicht mehr im vorgesehenen Space.");
        if (page.status === "current") {
          guard(); const attachments = await api.attachments(page.id);
          if (page.title === job.title && page.version.message === marker && page.version.number === INITIAL_PUBLISHED_VERSION &&
            page.version.authorId === context.accountId && page.body?.storage?.value?.includes(job.attachmentName) && attachments.some(a => a.title === job.attachmentName)) return finish(page);
          problem("publication_review_required", "Die Seite wurde außerhalb des erwarteten Ablaufs veröffentlicht oder verändert. Es wird keine neue Seite angelegt.");
        }
        if (page.status !== "draft" || page.title !== job.draftTitle ||
          (page.ownerId ?? page.authorId) !== context.accountId ||
          !Number.isInteger(page.version.number) ||
          (job.draftVersion !== undefined && page.version.number !== job.draftVersion)) {
          problem("publication_review_required", "Der gespeicherte Entwurf wurde verändert oder ist nicht mehr verfügbar. Der Bot überschreibt ihn nicht.");
        }
        const draftBody = page.body?.storage?.value;
        if (draftBody === undefined || bodyHash(draftBody) !== (job.draftBodyHash ?? bodyHash(body))) {
          return problem("publication_review_required", "Der Entwurfsinhalt wurde verändert oder konnte nicht eindeutig abgeglichen werden. Er wird nicht überschrieben.");
        }
        if (!job.draftBodyHash || job.draftVersion === undefined) save({ draftBodyHash: bodyHash(draftBody), draftVersion: page.version.number });
        if (job.stage !== "diagram_ready" && job.stage !== "publishing") {
          save({ stage: "uploading_diagram" });
          guard(); await api.putDiagram(page.id, job.attachmentName, snapshot.svg);
          save({ stage: "diagram_ready" });
        }
        guard(); const attachments = await api.attachments(page.id);
        if (!attachments.some(a => a.title === job.attachmentName && (a.fileSize === undefined || a.fileSize === Buffer.byteLength(snapshot.svg)))) {
          save({ stage: "draft_ready" });
          problem("publication_retry_required", "Das Diagramm ist noch nicht vollständig am Entwurf verfügbar. Bitte denselben Auftrag erneut fortsetzen.");
        }
        await conflictCheck();
        guard(); page = await api.getPage(page.id);
        if (page.status !== "draft" || page.title !== job.draftTitle || page.version.number !== job.draftVersion ||
          page.body?.storage?.value === undefined || bodyHash(page.body.storage.value) !== job.draftBodyHash) {
          problem("publication_review_required", "Der Entwurf wurde während der Verarbeitung geändert. Die Veröffentlichung wurde angehalten.");
        }
        save({ stage: "publishing", lastProblem: undefined, problemStatus: undefined });
        guard(); await api.publish(page, job.title, body, marker);
        guard(); const published = await api.getPage(page.id);
        if (published.status !== "current" || published.title !== job.title || published.version.message !== marker ||
          published.version.number !== INITIAL_PUBLISHED_VERSION || published.version.authorId !== context.accountId || !published.body?.storage?.value?.includes(job.attachmentName)) {
          problem("publication_review_required", "Die vollständige Veröffentlichung konnte noch nicht bestätigt werden. Bitte den gleichen Auftrag erneut prüfen.");
        }
        return finish(published);
      } catch (error) {
        if (error instanceof PublicationProblem) {
          // readUpdatePage may detect a collaborative draft after confirmation.
          if (job.update) {
            save({ lastProblem: error.message, problemStatus: error.status });
            throw new PublicationProblem(error.status, error.message, previewId, job.id, job.stage);
          }
          throw error;
        }
        const message = error instanceof ConfluenceApiError ? error.message : "Die Veröffentlichung wurde unterbrochen. Bereits erreichte Schritte bleiben gespeichert.";
        const status = job.update && error instanceof ConfluenceApiError && [404, 409].includes(error.status) ? "publication_revision_conflict"
          : error instanceof ConfluenceApiError && error.status === 401 ? "publication_authorization_required"
          : error instanceof ConfluenceApiError && [400, 403, 422].includes(error.status)
            ? "publication_review_required" : "publication_retry_required";
        save({ lastProblem: message, problemStatus: status });
        throw new PublicationProblem(status, message, job.previewId, job.id, job.stage);
      }
    });
  }
}
