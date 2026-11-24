export type PublicationPage = {
  id: string; title: string; status: string; spaceId: string;
  ownerId?: string; authorId?: string;
  version: { number: number; message?: string; authorId?: string };
  body?: { storage?: { value?: string } };
};
export type PublicationAttachment = { id: string; title: string; fileSize?: number };
export interface PublicationApi {
  findPages(title: string): Promise<PublicationPage[]>;
  findDrafts(title: string): Promise<PublicationPage[]>;
  createDraft(title: string, body: string): Promise<PublicationPage>;
  getPage(id: string): Promise<PublicationPage>;
  putDiagram(pageId: string, name: string, svg: string): Promise<void>;
  attachments(pageId: string): Promise<PublicationAttachment[]>;
  publish(page: PublicationPage, title: string, body: string, message: string): Promise<void>;
}

export class ConfluenceApiError extends Error {
  constructor(readonly status: number) { super(`Confluence-Anfrage fehlgeschlagen (HTTP ${status}).`); }
}

export function createConfluencePublicationApi(options: {
  cloudId: string; spaceId: string; accessToken: string; fetch?: typeof fetch;
}): PublicationApi {
  const base = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(options.cloudId)}`;
  const headers = { authorization: `Bearer ${options.accessToken}`, accept: "application/json" };
  const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const url = new URL(path, `${base}/`);
    if (url.origin !== "https://api.atlassian.com" || !url.pathname.startsWith(new URL(base).pathname + "/wiki/")) {
      throw new Error("Unerwartete Confluence-Paginierungsadresse.");
    }
    const response = await (options.fetch ?? fetch)(url.toString(), {
      ...init, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { ...headers, ...init.headers },
    });
    if (!response.ok) throw new ConfluenceApiError(response.status);
    return response.status === 204 ? {} : response.json();
  };
  const endpoint = (path: string) => `${base}/wiki/${path}`;
  const list = async <T>(path: string): Promise<T[]> => {
    const result: T[] = [];
    let next: string | undefined = endpoint(path);
    const visited = new Set<string>();
    while (next) {
      if (visited.has(next) || visited.size >= 1000) throw new Error("Confluence-Paginierung konnte nicht abgeschlossen werden.");
      visited.add(next);
      const page = await request(next) as { results?: T[]; _links?: { next?: string } };
      if (!Array.isArray(page.results)) throw new Error("Unerwartete Confluence-Listenantwort.");
      result.push(...page.results);
      const link = page._links?.next;
      next = link?.startsWith("/wiki/") ? `${base}${link}` : link?.startsWith("/rest/") ? `${base}/wiki${link}` : link ? new URL(link, next).toString() : undefined;
    }
    return result;
  };
  const page = async (path: string, init?: RequestInit): Promise<PublicationPage> => {
    const value = await request(endpoint(path), init) as PublicationPage;
    if (!value || typeof value.id !== "string") throw new Error("Unerwartete Confluence-Seitenantwort.");
    return value;
  };
  return {
    findPages: async (title) => {
      const query = new URLSearchParams({ "space-id": options.spaceId, title, "body-format": "storage", limit: "100" });
      query.append("status", "current");
      return (await list<PublicationPage>(`api/v2/pages?${query}`)).filter(p => p.title === title && p.spaceId === options.spaceId);
    },
    findDrafts: async (title) => {
      // The v2 page-list schema excludes draft. Shared drafts are listed via
      // the documented v1 collaborative-editing API, never by an invalid v2
      // status filter. If unavailable, recovery stops for manual reconciliation.
      const query = new URLSearchParams({ type: "page", status: "draft", title, limit: "100", expand: "space" });
      const drafts = await list<{
        id: string; title: string; status: string; space?: { id?: string | number };
        version?: { number: number; message?: string; by?: { accountId?: string } };
        history?: { createdBy?: { accountId?: string } };
        body?: PublicationPage["body"];
      }>(`rest/api/content?${query}`);
      return drafts.filter(p => p.title === title && p.status === "draft" && String(p.space?.id) === options.spaceId).map(p => ({
        id: p.id, title: p.title, status: p.status, spaceId: String(p.space!.id),
        authorId: p.history?.createdBy?.accountId,
        version: { number: p.version?.number ?? 0, message: p.version?.message, authorId: p.version?.by?.accountId },
        body: p.body,
      }));
    },
    createDraft: (title, body) => page("api/v2/pages", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({
        spaceId: options.spaceId, status: "draft", title, body: { representation: "storage", value: body },
      }) }),
    getPage: (id) => page(`api/v2/pages/${encodeURIComponent(id)}?body-format=storage&get-draft=true&status=current&status=draft`),
    putDiagram: async (pageId, name, svg) => {
      const form = new FormData();
      form.append("file", new Blob([svg], { type: "image/svg+xml" }), name);
      form.append("minorEdit", "true");
      form.append("comment", "AutoDocBot-Prozessdiagramm");
      await request(endpoint(`rest/api/content/${encodeURIComponent(pageId)}/child/attachment?status=draft`), {
        method: "PUT", headers: { "X-Atlassian-Token": "nocheck" }, body: form,
      });
    },
    attachments: (id) => list<PublicationAttachment>(`api/v2/pages/${encodeURIComponent(id)}/attachments?limit=100&status=current`),
    publish: async (draft, title, body, message) => {
      await request(endpoint(`api/v2/pages/${encodeURIComponent(draft.id)}`), {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id, spaceId: options.spaceId, status: "current", title,
          body: { representation: "storage", value: body },
          version: { number: draft.version.number + 1, message } }),
      });
    },
  };
}
