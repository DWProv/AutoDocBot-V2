import { z } from "zod";

const extractionSchema = z.object({
  processes: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/u),
    title: z.string().trim().min(5).max(140),
    status: z.enum(["agreed", "proposal", "unclear"]),
    statements: z.array(z.object({
      kind: z.enum(["agreed", "proposal", "open_question"]),
      evidence: z.string().min(5).max(2000),
    }).strict()).min(1).max(100),
    questions: z.array(z.string().trim().min(5).max(1000)).max(30).default([]),
  }).strict()).min(1).max(10),
}).strict();

export function prepareMeetingSummary(summary: string, extractionJson: string, selectedProcessId?: string) {
  z.string().min(30).max(30_000).parse(summary);
  z.string().min(2).max(100_000).parse(extractionJson);
  const extraction = extractionSchema.parse(JSON.parse(extractionJson));
  if (new Set(extraction.processes.map(p => p.id)).size !== extraction.processes.length) {
    throw new Error("Die erkannten Prozesse benötigen eindeutige IDs.");
  }
  for (const process of extraction.processes) for (const statement of process.statements) {
    if (!summary.includes(statement.evidence)) throw new Error("Jeder übernommene Beleg muss wörtlich in der Meeting-Zusammenfassung vorkommen.");
  }
  const candidates = extraction.processes.map(({ id, title, status }) => ({ id, title, status }));
  if (!selectedProcessId && candidates.length > 1) return {
    status: "process_selection_required", candidates, previewCreated: false,
    nextAction: "Lass den Benutzer einen dieser Prozesse auswählen. Erstelle getrennte Artikel statt mehrere Abläufe still zusammenzuführen. Rufe das Tool anschließend mit selectedProcessId erneut auf.",
  };
  const selected = selectedProcessId ? extraction.processes.find(p => p.id === selectedProcessId) : extraction.processes[0];
  if (!selected) throw new Error("Der ausgewählte Prozess ist nicht in der Zusammenfassung enthalten.");
  const questions = [...selected.questions];
  if (selected.status !== "agreed") questions.push(`Ist der Ablauf „${selected.title}“ verbindlich beschlossen oder wird er noch diskutiert?`);
  for (const statement of selected.statements) {
    if (statement.kind === "proposal") questions.push(`Ist dieser Vorschlag verbindlich beschlossen und Teil des Prozesses: „${statement.evidence}“?`);
    if (statement.kind === "open_question") questions.push(`Bitte kläre diese offene Prozessangabe: „${statement.evidence}“`);
  }
  if (questions.length) return {
    status: "meeting_clarification_required", selectedProcessId: selected.id,
    questions: [...new Set(questions)], previewCreated: false,
    nextAction: "Stelle diese fachlichen Fragen. Ergänze die tatsächlichen Benutzerantworten in der Zusammenfassung und prüfe erneut. Veröffentliche keinen diskutierten Vorschlag als verbindlichen Prozess.",
  };
  const evidence = [...new Set(selected.statements.filter(s => s.kind === "agreed").map(s => s.evidence))];
  if (!evidence.length) return {
    status: "meeting_clarification_required", selectedProcessId: selected.id,
    questions: ["Welche konkreten Prozessschritte wurden verbindlich beschlossen?"], previewCreated: false,
  };
  const sourceText = evidence.join("\n");
  if (sourceText.length > 30_000) throw new Error("Die Belege überschreiten zusammen die zulässige Quellentextlänge. Überlappende Belege müssen intern bereinigt werden.");
  return {
    status: "meeting_process_ready", selectedProcessId: selected.id, title: selected.title,
    sourceText, evidence,
    previewCreated: false, publicationStatus: "not_published",
    nextAction: "Leite aus diesen belegten Aussagen ein vollständiges ArticleSpec ab. Prüfe Rollen, Fristen, Entscheidungen und Ausnahmen; frage bei Lücken nach. Rufe preview_process_article mit diesem sourceText und einem vollständigen Qualitätsbericht auf. Veröffentliche erst nach der ausdrücklichen Bestätigung der konkreten Artikelvorschau.",
  };
}
