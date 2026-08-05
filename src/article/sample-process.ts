import { validateArticleSpec, type ArticleSpec } from "./article-spec.js";

export function onboardingSampleSpec(): ArticleSpec {
  return validateArticleSpec({
    title: "IT-Onboarding neuer Mitarbeitender",
    summary:
      "Dieser Prozess beschreibt die rechtzeitige Einrichtung und Übergabe von Benutzerkonto und Laptop für neue Mitarbeitende.",
    purpose:
      "Neue Mitarbeitende erhalten spätestens am ersten Arbeitstag ein aktives Benutzerkonto und einen vorbereiteten, gereinigten Laptop.",
    scope:
      "Der Prozess gilt für alle Neueinstellungen, für die HR Benutzerkonto und Arbeitsmittel bei Dennis anfordert.",
    roles: [
      {
        name: "HR",
        responsibility:
          "Meldet den Eintritt rechtzeitig und liefert alle erforderlichen Pflichtangaben.",
      },
      {
        name: "Dennis",
        responsibility:
          "Erstellt das Benutzerkonto und bereitet einen gereinigten Laptop vor.",
      },
      {
        name: "Führungskraft",
        responsibility:
          "Übergibt dem neuen Mitarbeitenden am ersten Arbeitstag die Arbeitsmittel.",
      },
    ],
    prerequisites: [
      "Die Einstellung ist bestätigt.",
      "Der geplante erste Arbeitstag ist bekannt.",
    ],
    steps: [
      {
        number: 1,
        actor: "HR",
        action:
          "HR meldet den Eintritt mindestens fünf Arbeitstage vor dem ersten Arbeitstag an Dennis.",
        result: "Dennis hat die Onboarding-Anfrage erhalten.",
        decision: "Sind alle Pflichtangaben vollständig?",
      },
      {
        number: 2,
        actor: "Dennis",
        action: "Dennis erstellt das Benutzerkonto.",
        result: "Das Benutzerkonto ist für den ersten Arbeitstag vorbereitet.",
      },
      {
        number: 3,
        actor: "Dennis",
        action: "Dennis bereitet den Laptop vor und reinigt ihn gründlich.",
        result: "Der Laptop ist eingerichtet, sauber und übergabebereit.",
      },
      {
        number: 4,
        actor: "Führungskraft",
        action:
          "Die Führungskraft übergibt dem neuen Mitarbeitenden am ersten Arbeitstag die Arbeitsmittel.",
        result: "Benutzerkonto und Laptop wurden bereitgestellt.",
      },
    ],
    exceptions: [
      {
        condition: "Pflichtangaben in der Onboarding-Anfrage fehlen.",
        handling:
          "Dennis gibt die Anfrage zur Vervollständigung an HR zurück. Nach der Ergänzung wird die Vollständigkeit erneut geprüft.",
      },
    ],
    relatedLinks: [],
    metadata: {
      owner: "Dennis",
      department: "IT",
    },
    style: {
      tone: "neutral",
      audience: "operations",
      detailLevel: "standard",
      addressForm: "neutral",
      diagramDirection: "top-down",
    },
  });
}
