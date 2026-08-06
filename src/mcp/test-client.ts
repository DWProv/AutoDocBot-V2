import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { onboardingSampleSpec } from "../article/sample-process.js";

const client = new Client({
  name: "autodocbot-local-test-client",
  version: "0.1.5",
});

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
);

try {
  await client.connect(transport);
  const instructions = client.getInstructions();
  if (!instructions?.includes("Schrittzahl")) {
    throw new Error("Verbindliche MCP-Agentenanweisungen fehlen.");
  }
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
  const publishTool = tools.tools.find(
    (tool) => tool.name === "publish_process_article",
  );
  const publishProperties = (
    publishTool?.inputSchema as { properties?: Record<string, unknown> } | undefined
  )?.properties;
  if (!publishProperties || "spaceId" in publishProperties) {
    throw new Error(
      "Das Publishing-Tool muss ausschließlich den fest konfigurierten Ziel-Space verwenden.",
    );
  }

  const connection = await client.callTool({
    name: "get_confluence_connection",
    arguments: {},
  });
  if (connection.isError) {
    throw new Error("Verbindungsstatus-Tool ist fehlgeschlagen.");
  }
  const connectionStatus = connection.structuredContent as
    | {
        connected?: boolean;
        user?: string;
        targetSpace?: { id?: string };
        spaces?: unknown;
      }
    | undefined;
  if (
    connectionStatus?.connected &&
    (!connectionStatus.targetSpace?.id || connectionStatus.spaces)
  ) {
    throw new Error(
      "Der Verbindungsstatus muss ausschließlich den fest konfigurierten Ziel-Space ausgeben.",
    );
  }

  const preview = await client.callTool({
    name: "preview_process_article",
    arguments: {
      sourceText:
        "HR meldet den Eintritt fünf Arbeitstage vorher. Dennis erstellt das Benutzerkonto und bereitet den Laptop vor. Die Führungskraft übergibt die Arbeitsmittel am ersten Arbeitstag.",
      articleJson: JSON.stringify(onboardingSampleSpec()),
      qualityReviewJson: JSON.stringify({
        contradictions: [],
        missingResponsibilities: [],
        openQuestions: [],
        assumptions: [],
      }),
    },
  });
  if (preview.isError) {
    throw new Error("Vorschau-Tool ist fehlgeschlagen.");
  }

  const structureRetry = await client.callTool({
    name: "preview_process_article",
    arguments: {
      sourceText:
        "HR meldet den Eintritt fünf Arbeitstage vorher. Dennis erstellt anschließend das Benutzerkonto.",
      articleJson: JSON.stringify({ title: "Hardware Onboarding" }),
      qualityReviewJson: JSON.stringify({
        contradictions: [],
        missingResponsibilities: [],
        openQuestions: [],
        assumptions: [],
      }),
    },
  });
  const structureRetryOutput = structureRetry.structuredContent as
    | {
        status?: string;
        previewId?: string;
        validationIssues?: unknown[];
        requiredArticleShape?: unknown;
      }
    | undefined;
  if (
    structureRetry.isError ||
    structureRetryOutput?.status !== "article_structure_retry_required" ||
    structureRetryOutput.previewId ||
    !structureRetryOutput.validationIssues?.length ||
    !structureRetryOutput.requiredArticleShape
  ) {
    throw new Error("Eine unvollständige Artikelstruktur löst keinen internen Reparaturauftrag aus.");
  }

  const clarification = await client.callTool({
    name: "preview_process_article",
    arguments: {
      sourceText:
        "HR sagt Dennis irgendwann Bescheid, manchmal erst am ersten Arbeitstag. Das Konto muss spätestens drei Tage vorher fertig sein. Wer die Pflichtangaben prüft, weiß ich nicht.",
      articleJson: JSON.stringify(onboardingSampleSpec()),
      qualityReviewJson: JSON.stringify({
        contradictions: [],
        missingResponsibilities: [],
        openQuestions: [],
        assumptions: [],
      }),
    },
  });
  const clarificationOutput = clarification.structuredContent as
    | { status?: string; previewId?: string }
    | undefined;
  if (
    clarification.isError ||
    clarificationOutput?.status !== "clarification_required" ||
    clarificationOutput.previewId
  ) {
    throw new Error("Semantische Probleme haben die Vorschau nicht blockiert.");
  }

  console.log(
    `MCP erfolgreich geprüft. Tools: ${toolNames.join(", ")}. Atlassian-Verbindung: ${connectionStatus?.connected ? `verbunden (${connectionStatus.user ?? "Benutzer erkannt"})` : "nicht verbunden"}. Vorschau wurde erzeugt, aber nicht veröffentlicht.`,
  );
} finally {
  await client.close();
}
