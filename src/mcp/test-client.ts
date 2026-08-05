import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { onboardingSampleSpec } from "../article/sample-process.js";

const client = new Client({
  name: "autodocbot-local-test-client",
  version: "0.1.1",
});

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
);

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  const expectedTools = [
    "get_confluence_connection",
    "get_article_styleguide",
    "preview_process_article",
    "publish_process_article",
  ];
  for (const expected of expectedTools) {
    if (!toolNames.includes(expected)) {
      throw new Error(`MCP-Tool fehlt: ${expected}`);
    }
  }

  const connection = await client.callTool({
    name: "get_confluence_connection",
    arguments: {},
  });
  if (connection.isError) {
    throw new Error("Verbindungsstatus-Tool ist fehlgeschlagen.");
  }
  const connectionStatus = connection.structuredContent as
    | { connected?: boolean; user?: string }
    | undefined;

  const preview = await client.callTool({
    name: "preview_process_article",
    arguments: { articleJson: JSON.stringify(onboardingSampleSpec()) },
  });
  if (preview.isError) {
    throw new Error("Vorschau-Tool ist fehlgeschlagen.");
  }

  console.log(
    `MCP erfolgreich geprüft. Tools: ${toolNames.join(", ")}. Atlassian-Verbindung: ${connectionStatus?.connected ? `verbunden (${connectionStatus.user ?? "Benutzer erkannt"})` : "nicht verbunden"}. Vorschau wurde erzeugt, aber nicht veröffentlicht.`,
  );
} finally {
  await client.close();
}
