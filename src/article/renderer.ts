import type { ArticleSpec } from "./article-spec.js";
import type { ResolvedStyleGuide } from "./styleguide.js";
import { describeStepFlow, describeExceptionFlow } from "./process-flow.js";

function xml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function applyTerminology(
  value: string,
  terminology: Record<string, string>,
): string {
  return Object.entries(terminology)
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [source, target]) => {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return result.replace(new RegExp(`\\b${escaped}\\b`, "gu"), target);
    }, value);
}

function text(value: string, style: ResolvedStyleGuide): string {
  return xml(applyTerminology(value, style.terminology));
}

function list(items: string[], style: ResolvedStyleGuide, emptyLabel: string): string {
  if (items.length === 0) {
    return `<p><em>${xml(emptyLabel)}</em></p>`;
  }
  return `<ul>${items.map((item) => `<li>${text(item, style)}</li>`).join("")}</ul>`;
}

function twoColumnTable(
  heading: string,
  leftLabel: string,
  rightLabel: string,
  rows: Array<[string, string]>,
  style: ResolvedStyleGuide,
): string {
  const body = rows.length
    ? `<table><thead><tr><th>${xml(leftLabel)}</th><th>${xml(rightLabel)}</th></tr></thead><tbody>${rows
        .map(
          ([left, right]) =>
            `<tr><td>${text(left, style)}</td><td>${text(right, style)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "<p><em>Für diesen optionalen Abschnitt wurden keine Angaben bereitgestellt.</em></p>";
  return `<h2>${xml(heading)}</h2>${body}`;
}

export function renderConfluenceStorage(
  spec: ArticleSpec,
  style: ResolvedStyleGuide,
  diagramAttachmentName?: string,
): string {
  const h = style.headingLabels;
  const roles = spec.roles
    .map(
      (role) =>
        `<tr><td>${text(role.name, style)}</td><td>${text(role.responsibility, style)}</td></tr>`,
    )
    .join("");
  const steps = spec.steps
    .map(
      (step) => `<tr>
        <td>${step.number}</td>
        <td>${text(step.actor, style)}</td>
        <td>${text(step.action, style)}</td>
        <td>${text(step.result, style)}</td>
        <td>${text(describeStepFlow(step), style) || "–"}</td>
      </tr>`,
    )
    .join("");
  const exceptions = spec.exceptions.length
    ? `<table><thead><tr><th>Bedingung</th><th>Vorgehen</th></tr></thead><tbody>${spec.exceptions
        .map(
          (item, index) =>
            `<tr><td>${text(`Ausnahme ${index + 1}: ${item.condition}`, style)}</td><td>${text(item.handling, style)}<br />${text(describeExceptionFlow(item), style)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "<p><em>Im Eingangstext wurden keine Ausnahmen oder Eskalationen angegeben.</em></p>";
  const links = spec.relatedLinks.length
    ? `<ul>${spec.relatedLinks
        .map(
          (link) =>
            `<li><a href="${xml(link.url)}">${text(link.title, style)}</a></li>`,
        )
        .join("")}</ul>`
    : "<p><em>Im Eingangstext wurden keine mitgeltenden Dokumente angegeben.</em></p>";
  const metadata = [
    ["Dokumentverantwortung", spec.metadata.owner],
    ["Organisationseinheit", spec.metadata.department],
    ["Nächste Überprüfung", spec.metadata.reviewDate],
    ["Styleguide-Version", style.version],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) => `<tr><th>${xml(label)}</th><td>${text(value, style)}</td></tr>`)
    .join("");

  const diagram = diagramAttachmentName
    ? `<ac:image ac:align="center" ac:alt="Prozessdiagramm"><ri:attachment ri:filename="${xml(diagramAttachmentName)}" /></ac:image>`
    : "<p><em>Das Prozessdiagramm wird bei der Veröffentlichung erzeugt.</em></p>";
  const optionalSections = style.includeOptionalSections.map((section) => {
    switch (section) {
      case "definitions":
        return twoColumnTable(
          "Begriffe und Definitionen",
          "Begriff",
          "Definition",
          (spec.optionalContent.definitions ?? []).map((item) => [
            item.term,
            item.definition,
          ]),
          style,
        );
      case "systems":
        return twoColumnTable(
          "Beteiligte Systeme",
          "System",
          "Verwendung",
          (spec.optionalContent.systems ?? []).map((item) => [
            item.name,
            item.purpose,
          ]),
          style,
        );
      case "risksAndControls":
        return twoColumnTable(
          "Risiken und Kontrollen",
          "Risiko",
          "Kontrolle",
          (spec.optionalContent.risksAndControls ?? []).map((item) => [
            item.risk,
            item.control,
          ]),
          style,
        );
      case "metrics":
        return twoColumnTable(
          "Kennzahlen",
          "Kennzahl",
          "Zielwert",
          (spec.optionalContent.metrics ?? []).map((item) => [
            item.name,
            item.target,
          ]),
          style,
        );
      case "changeHistory":
        return `<h2>Änderungshistorie</h2>${
          (spec.optionalContent.changeHistory ?? []).length
            ? `<table><thead><tr><th>Datum</th><th>Änderung</th><th>Autor</th></tr></thead><tbody>${(
                spec.optionalContent.changeHistory ?? []
              )
                .map(
                  (item) =>
                    `<tr><td>${xml(item.date)}</td><td>${text(item.change, style)}</td><td>${text(item.author, style)}</td></tr>`,
                )
                .join("")}</tbody></table>`
            : "<p><em>Für diesen optionalen Abschnitt wurden keine Angaben bereitgestellt.</em></p>"
        }`;
    }
  });

  return [
    `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>${text(spec.summary, style)}</p></ac:rich-text-body></ac:structured-macro>`,
    `<h2>${xml(h.purpose)}</h2><p>${text(spec.purpose, style)}</p>`,
    `<h2>${xml(h.scope)}</h2><p>${text(spec.scope, style)}</p>`,
    `<h2>${xml(h.roles)}</h2><table><thead><tr><th>Rolle</th><th>Verantwortung</th></tr></thead><tbody>${roles}</tbody></table>`,
    `<h2>${xml(h.prerequisites)}</h2>${list(spec.prerequisites, style, "Im Eingangstext wurden keine Voraussetzungen angegeben.")}`,
    `<h2>${xml(h.process)}</h2><table><thead><tr><th>Nr.</th><th>Rolle</th><th>Aktivität</th><th>Ergebnis</th><th>Entscheidung / Fortsetzung</th></tr></thead><tbody>${steps}</tbody></table>`,
    `<h2>${xml(h.exceptions)}</h2>${exceptions}`,
    `<h2>${xml(h.relatedLinks)}</h2>${links}`,
    metadata ? `<h2>Dokumentinformationen</h2><table><tbody>${metadata}</tbody></table>` : "",
    ...optionalSections,
    `<h2>${xml(h.diagram)}</h2>${diagram}`,
  ].join("");
}
