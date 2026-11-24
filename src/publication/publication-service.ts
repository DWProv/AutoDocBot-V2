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

const attachmentPlaceholder = "AUTODOCBOT_ATTACHMENT_PLACEHOLDER";
type Snapshot = { spec: ArticleSpec; style: ResolvedStyleGuide; svg: string; bodyTemplate: string };
type Preview = { kind: "preview"; userId: string; siteUrl: string; spaceId: string; expiresAt: number; jobId?: string; snapshot?: Snapshot };
export type JobStage = "prepared" | "creating_draft" | "draft_ready" | "uploading_diagram" | "diagram_ready" | "publishing" | "published";
export type PublishedArticle = {
  pageId: string; pageUrl: string; title: string; spaceId: string; spaceKey: string; spaceName: string;
  styleGuideVersion: string; diagramDirection: string; attributionConfirmed: boolean;
};
type Job = {
  kind: "job"; id: string; userId: string; accountId: string; cloudId: string; spaceId: string;
  previewId: string; title: string; draftTitle: string; attachmentName: string;
  createdAt: number; updatedAt: number; stage: JobStage; pageId?: string; draftVersion?: number; draftBodyHash?: string;
  snapshot?: Snapshot; result?: PublishedArticle; lastProblem?: string; problemStatus?: PublicationProblem["status"];
};
type Stored = Preview | Job;
export type PublicationContext = {
  userId: string; accountId: string; cloudId: string;
  spaceId: string; spaceKey: string; spaceName: string; siteUrl: string;
};
export class PublicationProblem extends Error {
  constructor(readonly status: "publication_retry_required" | "publication_review_required" | "publication_conflict" | "publication_busy" | "publication_authorization_required", message: string,
    readonly previewId: string, readonly jobId?: string, readonly stage?: JobStage) { super(message); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}`;
  return JSON.stringify(value);
}

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

  async createPreview(spec: ArticleSpec, userId: string) {
    const style = resolveStyleGuide(spec.style), svg = generateProcessSvg(spec, style);
    const bodyTemplate = renderConfluenceStorage(spec, style, attachmentPlaceholder);
    const previewId = randomBytes(18).toString("base64url"), expiresAt = Date.now() + 30 * 60_000;
    await this.locked(previewId, async (store, guard) => {
      for (const [id, item] of store.entries()) {
        if (item.kind === "preview" && !item.jobId && item.expiresAt <= Date.now()) { guard(); store.delete(id); }
      }
      guard(); store.set(`preview:${previewId}`, { kind: "preview", userId, ...this.target, expiresAt, snapshot: { spec, style, svg, bodyTemplate } });
    });
    return { previewId, expiresAt, style, svg };
  }

  status(userId: string, previewId?: string) {
    const store = new EncryptedJsonStore<Stored>(this.path, this.key);
    const preview = previewId ? store.get(`preview:${previewId}`) : undefined;
    if (previewId && (!preview || preview.kind !== "preview" || preview.userId !== userId)) throw new Error("Vorgang nicht gefunden.");
    return [...store.entries()].map(([, item]) => item).filter((item): item is Job => item.kind === "job" && item.userId === userId && (!preview || preview.kind !== "preview" || item.id === preview.jobId))
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20).map(job => ({
        jobId: job.id, previewId: job.previewId, title: job.title, stage: job.stage,
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
      let storedJob = preview.jobId ? store.get(`job:${preview.jobId}`) : undefined;
      if (!storedJob) {
        if (!preview.snapshot || preview.expiresAt <= Date.now()) throw new Error("Die Vorschau ist abgelaufen. Bitte eine neue Vorschau erzeugen und bestätigen.");
        const id = createHash("sha256").update(canonical({ userId: context.userId, accountId: context.accountId,
          cloudId: context.cloudId, spaceId: context.spaceId, snapshot: preview.snapshot })).digest("hex");
        storedJob = store.get(`job:${id}`);
        if (!storedJob) {
          const now = Date.now();
          storedJob = { kind: "job", id, userId: context.userId, accountId: context.accountId,
            cloudId: context.cloudId, spaceId: context.spaceId, previewId, title: preview.snapshot.spec.title,
            draftTitle: `Entwurf: ${preview.snapshot.spec.title.slice(0, 55)} [${id}]`, attachmentName: `process-diagram-${id}.svg`,
            createdAt: now, updatedAt: now, stage: "prepared", snapshot: preview.snapshot };
          guard(); store.set(`job:${id}`, storedJob);
        }
        guard(); store.set(`preview:${previewId}`, { kind: "preview", userId: context.userId, ...this.target, expiresAt: preview.expiresAt, jobId: id });
      }
      if (storedJob.kind !== "job" || storedJob.userId !== context.userId || storedJob.accountId !== context.accountId ||
        storedJob.cloudId !== context.cloudId || storedJob.spaceId !== context.spaceId) throw new Error("Der Auftrag gehört zu einer anderen Benutzerverbindung oder einem anderen Zielbereich.");
      let job: Job = structuredClone(storedJob);
      if (recoveryPageId && (job.stage === "prepared" || (job.pageId && job.pageId !== recoveryPageId))) throw new Error("Eine Entwurfszuordnung ist für diesen Auftrag nicht zulässig.");
      if (job.result) return job.result;
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
          attributionConfirmed: page.version.authorId === context.accountId,
        };
        save({ stage: "published", result, snapshot: undefined, lastProblem: undefined, problemStatus: undefined });
        return result;
      };
      try {
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
        if (error instanceof PublicationProblem) throw error;
        const message = error instanceof ConfluenceApiError ? error.message : "Die Veröffentlichung wurde unterbrochen. Bereits erreichte Schritte bleiben gespeichert.";
        const status = error instanceof ConfluenceApiError && error.status === 401 ? "publication_authorization_required"
          : error instanceof ConfluenceApiError && [400, 403, 422].includes(error.status)
            ? "publication_review_required" : "publication_retry_required";
        save({ lastProblem: message, problemStatus: status });
        throw new PublicationProblem(status, message, job.previewId, job.id, job.stage);
      }
    });
  }
}
