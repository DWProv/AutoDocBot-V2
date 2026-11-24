import assert from "node:assert/strict";
import { createAtlassianConnectionResolver, type AtlassianToken } from "./atlassian-connection.js";

type Connection = { token: AtlassianToken; tokenExpiresAt: number; name: string };
const initial: Connection = {
  name: "test-user",
  token: { access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600, scope: "test" },
  tokenExpiresAt: 0,
};
let checks = 0;

async function check(name: string, test: () => Promise<void>) {
  await test();
  checks++;
  console.log(`OK: ${name}`);
}

function setup(fetchImpl: typeof fetch) {
  const connection = structuredClone(initial);
  const store = new Map<string, Connection>([["user-a", connection], ["user-b", structuredClone(initial)]]);
  let calls = 0;
  const invalidations: string[] = [];
  const resolve = createAtlassianConnectionResolver({
    store, clientId: "test-client", clientSecret: "test-secret",
    fetch: async (...args) => { calls++; return fetchImpl(...args); },
    onConnectionInvalidated: (reason) => invalidations.push(reason),
  });
  return { store, resolve, connection, invalidations, calls: () => calls };
}

await check("missing and valid connections need no token request", async () => {
  const s = setup(async () => { throw new Error("must not fetch"); });
  assert.equal(await s.resolve("absent"), undefined);
  s.connection.tokenExpiresAt = Date.now() + 3600_000;
  assert.equal(await s.resolve("user-a"), s.connection);
  assert.equal(s.calls(), 0);
});

await check("missing refresh token removes only the affected user", async () => {
  const s = setup(async () => { throw new Error("must not fetch"); });
  delete s.connection.token.refresh_token;
  assert.equal(await s.resolve("user-a"), undefined);
  assert(!s.store.has("user-a"));
  assert(s.store.has("user-b"));
  assert.deepEqual(s.invalidations, ["missing_refresh_token"]);
  assert.equal(s.calls(), 0);
});

for (const status of [400, 401, 403]) {
  await check(`invalid_grant HTTP ${status} requests reauthorization`, async () => {
    const s = setup(async () => Response.json({ error: "invalid_grant", error_description: "Unknown or invalid refresh token." }, { status }));
    assert.equal(await s.resolve("user-a"), undefined);
    assert(!s.store.has("user-a"));
    assert(s.store.has("user-b"));
    assert.deepEqual(s.invalidations, ["invalid_refresh_token"]);
    await s.resolve("user-a");
    assert.equal(s.calls(), 1);
  });
}

await check("token-specific unauthorized_client requests reauthorization", async () => {
  const s = setup(async () => Response.json({ error: "unauthorized_client", error_description: "refresh_token is invalid" }, { status: 403 }));
  assert.equal(await s.resolve("user-a"), undefined);
  assert(!s.store.has("user-a"));
});

for (const [status, body] of [
  [429, { error: "rate_limit_exceeded" }],
  [503, { error: "invalid_grant" }],
  [401, { error: "invalid_client", error_description: "test-sensitive-value" }],
  [403, { error: "unauthorized_client", error_description: "Invalid client secret" }],
  [403, { error: "access_denied" }],
] as const) {
  await check(`HTTP ${status} ${body.error} keeps the connection and hides response contents`, async () => {
    const s = setup(async () => Response.json(body, { status }));
    await assert.rejects(s.resolve("user-a"), (error: Error) => {
      assert(!error.message.includes("test-sensitive-value"));
      assert(!error.message.includes("Invalid client secret"));
      return true;
    });
    assert.equal(s.store.get("user-a"), s.connection);
    assert.equal(s.invalidations.length, 0);
  });
}

for (const [name, fetchImpl] of [
  ["network failure", async () => { throw new Error("test-sensitive-value"); }],
  ["timeout", async () => { throw new DOMException("timeout", "TimeoutError"); }],
  ["non-JSON response", async () => new Response("test-sensitive-value", { status: 502 })],
  ["malformed success", async () => Response.json({ access_token: "test-sensitive-value" })],
] as const) {
  await check(`${name} keeps the connection`, async () => {
    const s = setup(fetchImpl);
    await assert.rejects(s.resolve("user-a"), (error: Error) => !error.message.includes("test-sensitive-value"));
    assert.equal(s.store.get("user-a"), s.connection);
  });
}

await check("parallel calls share one refresh and persist token rotation", async () => {
  const s = setup(async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).refresh_token, "test-refresh");
    assert(init?.signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, scope: "new-scope" });
  });
  const [a, b] = await Promise.all([s.resolve("user-a"), s.resolve("user-a")]);
  assert.equal(s.calls(), 1);
  assert.equal(a, b);
  assert.equal(a?.token.refresh_token, "new-refresh");
  assert.equal(s.store.get("user-a"), a);
  assert.equal(s.store.get("user-b")?.token.access_token, "test-access");
});

await check("omitted refresh token and scope retain existing values", async () => {
  const s = setup(async () => Response.json({ access_token: "new-access", expires_in: 3600 }));
  const result = await s.resolve("user-a");
  assert.equal(result?.token.refresh_token, "test-refresh");
  assert.equal(result?.token.scope, "test");
});

await check("a transient failure does not block a later successful refresh", async () => {
  let fail = true;
  const s = setup(async () => {
    if (fail) return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
    return Response.json({ access_token: "new-access", expires_in: 3600 });
  });
  await assert.rejects(s.resolve("user-a"));
  fail = false;
  assert.equal((await s.resolve("user-a"))?.token.access_token, "new-access");
  assert.equal(s.calls(), 2);
});

for (const invalid of [true, false]) {
  await check(`a concurrent browser login survives an old ${invalid ? "failed" : "successful"} refresh`, async () => {
    let release!: (response: Response) => void;
    const s = setup(async () => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = s.resolve("user-a");
    const replacement = { ...structuredClone(initial), tokenExpiresAt: Date.now() + 3600_000, name: "new-browser-login" };
    s.store.set("user-a", replacement);
    release(invalid
      ? Response.json({ error: "invalid_grant" }, { status: 403 })
      : Response.json({ access_token: "old-session-new-token", expires_in: 3600 }));
    assert.equal(await pending, replacement);
    assert.equal(s.store.get("user-a"), replacement);
  });
}

console.log(`${checks} Prüfungen der Atlassian-Verbindung erfolgreich.`);
