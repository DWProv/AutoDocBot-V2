import assert from "node:assert/strict";
import { prepareMeetingSummary } from "./meeting-summary.js";

const summary = "Beschlossen: HR meldet den Eintritt fünf Tage vorher an die IT. Die IT erstellt das Konto. Vorschlag: Ein Roboter übernimmt die Übergabe. Offen ist die Verantwortung für die Laptop-Prüfung.";
const agreed = { id: "onboarding", title: "Onboarding neuer Mitarbeitender", status: "agreed", statements: [
  { kind: "agreed", evidence: "HR meldet den Eintritt fünf Tage vorher an die IT." },
  { kind: "agreed", evidence: "Die IT erstellt das Konto." },
] };
const run = (processes: unknown[], selected?: string) => prepareMeetingSummary(summary, JSON.stringify({ processes }), selected);
const ready = run([agreed]);
assert.equal(ready.status, "meeting_process_ready");
assert(ready.sourceText?.includes("HR meldet"));
assert(!ready.sourceText?.includes("Roboter"));
assert.equal(ready.previewCreated, false);
assert.equal(ready.publicationStatus, "not_published");
const proposal = { ...agreed, status: "proposal" };
assert.equal(run([proposal]).status, "meeting_clarification_required");
const unresolved = { ...agreed, statements: [...agreed.statements,
  { kind: "proposal", evidence: "Ein Roboter übernimmt die Übergabe." },
  { kind: "open_question", evidence: "Offen ist die Verantwortung für die Laptop-Prüfung." },
] };
const questions = run([unresolved]);
assert.equal(questions.status, "meeting_clarification_required");
assert.equal(questions.questions?.length, 2);
assert.equal(run([agreed, { ...agreed, id: "another", title: "Ein weiterer Prozess" }]).status, "process_selection_required");
assert.equal(run([agreed, { ...agreed, id: "another", status: "proposal" }], "onboarding").status, "meeting_process_ready");
assert.throws(() => run([agreed], "missing"));
assert.throws(() => run([agreed, agreed]));
assert.throws(() => run([{ ...agreed, statements: [{ kind: "agreed", evidence: "Die IT bezahlt jedem Mitarbeitenden 500 Euro." }] }]));
assert.throws(() => prepareMeetingSummary(summary, "invalid-json"));
console.log("Meeting-Prüfungen erfolgreich: beschlossene Aussagen, Belege, Vorschläge, offene Fragen, Prozessauswahl und kein automatisches Publishing.");
