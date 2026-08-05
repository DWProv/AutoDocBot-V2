import { z } from "zod";

const reviewFindingSchema = z
  .object({
    finding: z.string().trim().min(5).max(1_000),
    question: z.string().trim().min(5).max(1_000),
  })
  .strict();

export const qualityReviewSchema = z
  .object({
    contradictions: z.array(reviewFindingSchema).max(30).default([]),
    missingResponsibilities: z.array(reviewFindingSchema).max(30).default([]),
    openQuestions: z.array(reviewFindingSchema).max(30).default([]),
    assumptions: z.array(reviewFindingSchema).max(30).default([]),
  })
  .strict();

export type QualityReview = z.infer<typeof qualityReviewSchema>;

export type QualityIssue = {
  category:
    | "contradiction"
    | "missing_responsibility"
    | "open_question"
    | "unsupported_assumption";
  finding: string;
  question: string;
  source: "agent_review" | "server_rule";
};

function finding(
  category: QualityIssue["category"],
  text: string,
  question: string,
): QualityIssue {
  return {
    category,
    finding: text,
    question,
    source: "server_rule",
  };
}

function relevantSentences(sourceText: string): string[] {
  return sourceText
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function detectSourceQualityIssues(sourceText: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const normalized = sourceText.replace(/\s+/gu, " ").trim();

  for (const sentence of relevantSentences(sourceText)) {
    const missingResponsibility =
      /\bwer\b.{0,80}\b(prüft|entscheidet|freigibt|genehmigt|verantwortlich)\b.{0,80}\b(weiß|unklar|egal|nicht bekannt)\b/iu.test(
        sentence,
      ) ||
      /\b(wer|verantwortung|zuständigkeit)\b.{0,80}\b(weiß.{0,20}nicht|nicht (bekannt|geklärt|dokumentiert)|unklar)\b/iu.test(
        sentence,
      );
    if (missingResponsibility) {
      issues.push(
        finding(
          "missing_responsibility",
          `Eine Verantwortung ist ausdrücklich ungeklärt: „${sentence}“`,
          "Welche Rolle ist für diese Prüfung, Entscheidung oder Aufgabe verantwortlich?",
        ),
      );
      continue;
    }

    if (
      /\b(weiß|wissen)\b.{0,50}\bnicht\b/iu.test(sentence) ||
      /\b(nicht|noch nicht)\s+(bekannt|festgelegt|definiert|dokumentiert|geklärt)\b/iu.test(
        sentence,
      ) ||
      /\bunklar\b/iu.test(sentence)
    ) {
      issues.push(
        finding(
          "open_question",
          `Der Eingangstext kennzeichnet eine Angabe als offen: „${sentence}“`,
          `Bitte kläre die offene Angabe aus diesem Satz: „${sentence}“`,
        ),
      );
    }

    if (/\birgendwann\b/iu.test(sentence)) {
      issues.push(
        finding(
          "open_question",
          `Eine zeitliche Vorgabe ist unbestimmt: „${sentence}“`,
          "Welche verbindliche Frist oder welcher konkrete Auslöser gilt an dieser Stelle?",
        ),
      );
    }

    if (/\bpasst\b.{0,80}\bnicht zusammen\b/iu.test(sentence)) {
      issues.push(
        finding(
          "contradiction",
          `Der Eingangstext weist selbst auf einen Widerspruch hin: „${sentence}“`,
          "Welche der widersprüchlichen Angaben ist verbindlich?",
        ),
      );
    }
  }

  const firstDayException =
    /\b(manchmal|teilweise|mitunter|gegebenenfalls)\b.{0,100}\b(erst\s+)?am\s+ersten\s+(arbeits)?tag\b/iu.test(
      normalized,
    );
  const priorDeadline =
    /\b(spätestens|mindestens)\b.{0,80}\b(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+)\b.{0,30}\b(arbeits)?tage?\b.{0,30}\bvor\b/iu.test(
      normalized,
    );
  if (firstDayException && priorDeadline) {
    issues.push(
      finding(
        "contradiction",
        "Der Prozess erlaubt eine Meldung erst am ersten Arbeitstag, verlangt zugleich aber eine Fertigstellung oder Meldung mehrere Tage vor diesem Termin.",
        "Welche Frist ist verbindlich und wie soll mit verspäteten Meldungen umgegangen werden?",
      ),
    );
  }

  const requestsLeftRight = /\b(von\s+)?links\s+nach\s+rechts\b/iu.test(normalized);
  const requestsTopDown = /\b(von\s+)?oben\s+nach\s+unten\b/iu.test(normalized);
  if (requestsLeftRight && requestsTopDown) {
    issues.push(
      finding(
        "contradiction",
        "Für das Diagramm wurden sowohl links-nach-rechts als auch oben-nach-unten verlangt.",
        "Welche Diagrammrichtung soll verwendet werden: links nach rechts oder oben nach unten?",
      ),
    );
  }

  if (
    /\boptional\b.{0,100}\b(verpflichtend|pflicht)\b/iu.test(normalized) ||
    /\b(verpflichtend|pflicht)\b.{0,100}\boptional\b/iu.test(normalized)
  ) {
    issues.push(
      finding(
        "contradiction",
        "Eine Anforderung wird gleichzeitig als optional und verpflichtend beschrieben.",
        "Ist diese Anforderung optional oder verpflichtend?",
      ),
    );
  }

  return deduplicateQualityIssues(issues);
}

export function reviewToIssues(review: QualityReview): QualityIssue[] {
  const mappings: Array<
    [keyof QualityReview, QualityIssue["category"]]
  > = [
    ["contradictions", "contradiction"],
    ["missingResponsibilities", "missing_responsibility"],
    ["openQuestions", "open_question"],
    ["assumptions", "unsupported_assumption"],
  ];
  return mappings.flatMap(([key, category]) =>
    review[key].map((item) => ({
      category,
      finding: item.finding,
      question: item.question,
      source: "agent_review" as const,
    })),
  );
}

export function deduplicateQualityIssues(issues: QualityIssue[]): QualityIssue[] {
  const unique = new Map<string, QualityIssue>();
  for (const issue of issues) {
    const key = `${issue.category}:${issue.finding.toLocaleLowerCase("de-DE")}`;
    if (!unique.has(key)) unique.set(key, issue);
  }
  return [...unique.values()];
}

export function parseQualityReviewJson(value: string): QualityReview {
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error("qualityReviewJson muss ein gültiger JSON-String sein.");
  }
  return qualityReviewSchema.parse(input);
}
