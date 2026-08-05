# Styleguide für Prozessartikel

Version: 1.0.0

## Ziel

Der Styleguide erzeugt konsistente, verständliche und handlungsorientierte Prozessartikel. Er besteht aus einem verbindlichen Kern und erlaubten Benutzeranpassungen.

## Verbindlicher Kern

- Sprache ist Deutsch (`de-DE`).
- Inhalte werden nicht erfunden. Fehlende fachliche Angaben führen zu einer Rückfrage.
- Rollen und Verantwortlichkeiten werden explizit genannt.
- Jeder Prozessschritt enthält genau eine Hauptaktion und ein erwartetes Ergebnis.
- Aktive Formulierungen werden bevorzugt.
- Der Prozessablauf wird tabellarisch dargestellt.
- Das Prozessdiagramm ist immer der letzte fachliche Abschnitt.
- Benutzerinput darf kein HTML, Confluence Storage Markup oder Mermaid-Direktiven einschleusen.
- Styleguide und erzeugte Artikel tragen eine Versionsangabe.

## Standardstruktur

1. Kurzbeschreibung
2. Zweck
3. Geltungsbereich
4. Rollen und Verantwortlichkeiten
5. Voraussetzungen
6. Prozessablauf
7. Ausnahmen und Eskalationen
8. Mitgeltende Dokumente
9. Dokumentinformationen
10. Prozessdiagramm

## Schreibregeln

- Standardton: sachlich, klar und professionell.
- Kurze Absätze und eindeutige Überschriften verwenden.
- Fachbegriffe konsistent einsetzen.
- Unklare Pronomen wie „man“ vermeiden.
- Bedingungen als überprüfbare Fragen formulieren.
- Keine werblichen Formulierungen und keine unnötigen Einleitungen verwenden.
- Abkürzungen beim ersten Auftreten erklären, sofern sie nicht allgemein bekannt sind.

## Erlaubte Benutzeranpassungen

Ein Benutzer darf pro Artikel Folgendes anpassen:

- Ton: `formal`, `neutral`, `concise` oder `friendly`
- Zielgruppe: `general`, `expert`, `management` oder `operations`
- Detailgrad: `compact`, `standard` oder `detailed`
- Anrede: `neutral`, `du` oder `sie`
- Diagrammrichtung: `top-down` oder `left-right`
- optionale Abschnitte: Definitionen, Systeme, Risiken und Kontrollen, Kennzahlen oder Änderungshistorie
- bis zu 25 Terminologie-Ersetzungen
- Bezeichnungen der Standardüberschriften

Pflichtabschnitte, Diagrammposition, Faktentreue und Sicherheitsregeln können nicht überschrieben werden.

## Beispiel für Benutzerinput

```json
{
  "tone": "concise",
  "audience": "operations",
  "detailLevel": "detailed",
  "addressForm": "neutral",
  "diagramDirection": "left-right",
  "includeOptionalSections": ["systems", "risksAndControls"],
  "terminology": {
    "Ticket": "Service Request",
    "Teamleiter": "Teamleitung"
  },
  "headingLabels": {
    "process": "Arbeitsablauf",
    "diagram": "Ablaufdiagramm"
  }
}
```

Der MCP-Server validiert diese Werte gegen eine Allowlist. Nicht bekannte Felder werden abgelehnt.
