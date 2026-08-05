import {
  detectSourceQualityIssues,
  parseQualityReviewJson,
  reviewToIssues,
} from "./quality-review.js";

const onboardingWithConflicts = `
HR sagt Dennis irgendwann Bescheid. Normalerweise geschieht das fünf Tage vorher,
manchmal aber erst am ersten Arbeitstag. Das Benutzerkonto muss spätestens drei
Tage vor dem Eintritt fertig sein. Wer die Pflichtangaben prüft, weiß ich nicht.
Das passt nicht zusammen.
`;

const detected = detectSourceQualityIssues(onboardingWithConflicts);
if (!detected.some((issue) => issue.category === "contradiction")) {
  throw new Error("Der Fristwiderspruch wurde nicht erkannt.");
}
if (!detected.some((issue) => issue.category === "missing_responsibility")) {
  throw new Error("Die fehlende Verantwortung wurde nicht erkannt.");
}
if (!detected.some((issue) => issue.category === "open_question")) {
  throw new Error("Die unbestimmte Frist wurde nicht erkannt.");
}

const review = parseQualityReviewJson(
  JSON.stringify({
    contradictions: [
      {
        finding: "Zwei Fristen widersprechen einander.",
        question: "Welche Frist ist verbindlich?",
      },
    ],
    missingResponsibilities: [],
    openQuestions: [],
    assumptions: [],
  }),
);
if (reviewToIssues(review).length !== 1) {
  throw new Error("Der Agenten-Qualitätsbericht wurde nicht übernommen.");
}

const clean = detectSourceQualityIssues(
  "HR meldet den Eintritt fünf Arbeitstage vorher. Dennis erstellt anschließend das Benutzerkonto.",
);
if (clean.length !== 0) {
  throw new Error("Ein eindeutiger Prozess wurde fälschlich blockiert.");
}

console.log("Semantische Vorprüfung erfolgreich geprüft.");
