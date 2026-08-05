import { validateArticleSpec } from "./article-spec.js";
import { renderConfluenceStorage } from "./renderer.js";
import { resolveStyleGuide } from "./styleguide.js";

const spec = validateArticleSpec({
  title: "Onboarding neuer Mitarbeitender",
  summary: "Dieser Prozess beschreibt die Vorbereitung eines neuen Arbeitsverhältnisses.",
  purpose: "Alle notwendigen Zugänge und Arbeitsmittel stehen zum Starttermin bereit.",
  scope: "Der Prozess gilt für neue interne Mitarbeiter in Deutschland.",
  roles: [
    { name: "HR", responsibility: "Startet und koordiniert den Prozess." },
    { name: "IT", responsibility: "Richtet Konten und Arbeitsmittel ein." },
  ],
  prerequisites: ["Der Arbeitsvertrag ist unterzeichnet."],
  steps: [
    {
      number: 1,
      actor: "HR",
      action: "HR übermittelt die Stammdaten an die IT.",
      result: "Die IT verfügt über die notwendigen Angaben.",
    },
    {
      number: 2,
      actor: "IT",
      action: "IT richtet das Benutzerkonto ein.",
      result: "Das Benutzerkonto ist aktiv.",
    },
  ],
  style: {
    tone: "concise",
    audience: "operations",
    terminology: { Arbeitsvertrag: "Anstellungsvertrag" },
    headingLabels: { process: "Arbeitsablauf" },
  },
});

const style = resolveStyleGuide(spec.style);
const output = renderConfluenceStorage(spec, style, "process.svg");

if (!output.includes("<h2>Arbeitsablauf</h2>")) {
  throw new Error("Benutzerdefinierte Überschrift wurde nicht angewendet.");
}
if (!output.includes("Anstellungsvertrag")) {
  throw new Error("Terminologie-Anpassung wurde nicht angewendet.");
}
if (!output.endsWith('</ac:image>')) {
  throw new Error("Das Diagramm ist nicht das letzte Element.");
}
if (output.includes("<script")) {
  throw new Error("Unsicherer Inhalt im Rendering erkannt.");
}

console.log("Styleguide, ArticleSpec und Confluence-Renderer erfolgreich geprüft.");
