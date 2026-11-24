import assert from "node:assert/strict";
import { validateArticleSpec } from "../article/article-spec.js";
import { onboardingSampleSpec } from "../article/sample-process.js";
import { renderConfluenceStorage } from "../article/renderer.js";
import { resolveStyleGuide } from "../article/styleguide.js";
import { buildProcessGraph } from "./process-graph.js";
import { generateProcessSvg, wrapDiagramText } from "./process-svg.js";

const input = onboardingSampleSpec();
input.steps[1]!.decision = "Ist das Konto korrekt eingerichtet?";
input.steps[1]!.decisionBranches = [
  { label: "Freigegeben", target: { type: "step", number: 3 } },
  { label: "Korrektur", target: { type: "exception", number: 2 } },
  { label: "Abbruch", target: { type: "end" } },
];
input.exceptions.push({ condition: "Das Benutzerkonto enthält Fehler.", handling: "Die IT korrigiert die Kontodaten.", nextStep: 2 });
input.exceptions.push({ condition: "Der Laptop ist defekt.", handling: "Die IT bestellt ein Ersatzgerät.", stepNumber: 3, nextStep: 3 });
const spec = validateArticleSpec(input);
const process = buildProcessGraph(spec);
assert.equal(process.warnings.length, 0);
assert.equal(process.nodes.filter(n => n.kind === "decision").length, 2);
assert.equal(process.nodes.filter(n => n.kind === "exception").length, 3);
for (const [from, to, label] of [
  ["decision-1", "step-2", "Ja"], ["decision-1", "exception-1", "Nein"],
  ["decision-2", "step-3", "Freigegeben"], ["decision-2", "exception-2", "Korrektur"],
  ["decision-2", "end", "Abbruch"], ["exception-1", "step-1", "Weiter zu 1"],
  ["exception-2", "step-2", "Weiter zu 2"], ["step-3", "exception-3", "Ausnahme"],
]) assert(process.edges.some(e => e.from === from && e.to === to && e.label === label), `${from} → ${to}`);
assert(!process.edges.some(e => e.from === "decision-2" && e.to === "exception-1"));

for (const direction of ["top-down", "left-right"] as const) {
  const style = resolveStyleGuide({ diagramDirection: direction });
  const svg = generateProcessSvg(spec, style);
  for (const node of process.nodes) assert(svg.includes(`data-node="${node.id}"`));
  for (const edge of process.edges) assert(svg.includes(`data-from="${edge.from}" data-to="${edge.to}"`));
  assert(!svg.includes("NaN") && !svg.includes("Infinity"));
  assert.equal(svg, generateProcessSvg(spec, style), "Layout muss deterministisch sein");
  console.log(`OK: ${direction}: zwei Entscheidungen, drei Ausnahmen, Rücksprünge und Prozessende`);
}

const legacy = structuredClone(spec);
delete legacy.steps[0]!.decisionBranches;
legacy.exceptions.push({ condition: "Allgemeine Störung ohne Schrittzuordnung.", handling: "Der Bereitschaftsdienst prüft die Meldung." });
const fallback = buildProcessGraph(validateArticleSpec(legacy));
assert(fallback.warnings.length >= 3);
assert(!fallback.edges.some(e => e.from === "decision-1" && e.to === "step-2"));
assert(!fallback.edges.some(e => e.from === "decision-1" && e.to === "exception-1"));
for (const direction of ["top-down", "left-right"] as const) {
  const svg = generateProcessSvg(legacy, resolveStyleGuide({ diagramDirection: direction }));
  assert(svg.includes('data-node="exception-4"'));
  assert(svg.includes("Ohne Schrittzuordnung"));
  assert(svg.includes('data-node="unknown-1"'));
}
console.log("OK: Altdaten bleiben sichtbar; fehlende Zuordnungen erzeugen keine erfundenen Zweige");

for (const mutate of [
  (s: typeof spec) => { s.steps[0]!.decisionBranches![0]!.target = { type: "step", number: 999 }; },
  (s: typeof spec) => { s.steps[0]!.decisionBranches![0]!.target = { type: "exception", number: 999 }; },
  (s: typeof spec) => { s.exceptions[0]!.nextStep = 999; },
  (s: typeof spec) => { s.exceptions[0]!.stepNumber = 999; },
  (s: typeof spec) => { s.exceptions[0]!.endsProcess = true; },
  (s: typeof spec) => { delete s.steps[0]!.decision; },
  (s: typeof spec) => { s.steps[0]!.nextStep = 2; },
  (s: typeof spec) => { s.steps[0]!.decisionBranches![1]!.label = "Ja"; },
]) {
  const invalid = structuredClone(spec); mutate(invalid);
  assert.throws(() => validateArticleSpec(invalid));
}
console.log("OK: ungültige Referenzen, widersprüchliche Ziele und doppelte Zweiglabels abgelehnt");

const long = `${"LangesWort".repeat(15)} ${"Vollständige Beschreibung mit Umlauten äöü. ".repeat(15)} ENDMARKE`;
assert(wrapDiagramText(long).length > 3);
assert(wrapDiagramText(long).every(line => Array.from(line).length <= 34));
assert(wrapDiagramText(long).join("").replace(/\s/gu, "").endsWith("ENDMARKE"));
const escaped = structuredClone(spec);
escaped.steps[0]!.action = '<script>alert("x")</script> & Sonderzeichen ' + long.slice(0, 900);
for (const direction of ["top-down", "left-right"] as const) {
  const svg = generateProcessSvg(validateArticleSpec(escaped), resolveStyleGuide({ diagramDirection: direction }));
  assert(!svg.includes("<script>")); assert(svg.includes("&lt;script&gt;"));
}
const body = renderConfluenceStorage(spec, resolveStyleGuide({}), "diagram.svg");
assert(body.includes("Freigegeben → Schritt 3"));
assert(body.includes("Korrektur → Ausnahme 2"));
assert(body.includes("Weiter zu Schritt 2"));
assert(body.endsWith("</ac:image>"));
console.log("OK: vollständiger Text, Escaping und identische Verzweigungen im Artikel");

const self = onboardingSampleSpec(); self.steps[1]!.nextStep = 2;
const many = onboardingSampleSpec();
many.steps = Array.from({ length: 50 }, (_, i) => ({
  number: i + 1, actor: "IT", action: `Die IT bearbeitet Vorgang Nummer ${i + 1}.`, result: "Der Vorgang ist bearbeitet.",
  ...(i % 5 === 0 ? { decision: `Prüfung Nummer ${i + 1} bestanden?`, decisionBranches: [
    { label: "Ja", target: { type: "step" as const, number: i + 2 } },
    { label: "Nein", target: { type: "exception" as const, number: Math.floor(i / 5) + 1 } },
  ] } : {}),
}));
many.exceptions = Array.from({ length: 30 }, (_, i) => ({ condition: `Ausnahme Nummer ${i + 1} ist eingetreten.`, handling: "Die IT prüft und korrigiert den Vorgang.", stepNumber: Math.min(i + 1, 50), nextStep: Math.min(i + 1, 50) }));
for (const item of [self, many]) for (const direction of ["top-down", "left-right"] as const) {
  const svg = generateProcessSvg(validateArticleSpec(item), resolveStyleGuide({ diagramDirection: direction }));
  assert(!svg.includes("NaN"));
  assert.equal((svg.match(/data-kind="step"/gu) ?? []).length, item.steps.length);
  assert.equal((svg.match(/data-kind="exception"/gu) ?? []).length, item.exceptions.length);
}
console.log("OK: Selbstschleifen sowie 50 Schritte und 30 Ausnahmen in beiden Richtungen");
