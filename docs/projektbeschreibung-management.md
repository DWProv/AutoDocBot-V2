# AutoDocBot V2 – Projektbeschreibung für die Vorstellung

## Kurzbeschreibung

AutoDocBot V2 ist ein funktionsfähiger Proof of Concept, der eine frei
formulierte Prozessbeschreibung automatisch in einen strukturierten
Confluence-Artikel umwandelt.

Der Benutzer beschreibt den Prozess in Microsoft Teams oder Microsoft 365
Copilot in normaler Sprache. Der Agent erkennt daraus Rollen,
Verantwortlichkeiten, Prozessschritte, Entscheidungen und Ausnahmen. Er
korrigiert sprachliche Fehler, wendet einen einheitlichen Styleguide an und
erstellt ein Prozessdiagramm. Vor der Veröffentlichung zeigt er eine Vorschau
mit zwei eindeutigen Aktionen: **Bestätigen und veröffentlichen** oder
**Ändern / abbrechen**.

Erst nach der ausdrücklichen Bestätigung veröffentlicht AutoDocBot den Artikel
im festgelegten Confluence-Bereich. Der Artikel wird dabei im Namen des
angemeldeten Atlassian-Benutzers angelegt – nicht über ein gemeinsames
Bot-Konto.

> **Status:** Die vollständige Strecke vom Chat über Vorschau und Freigabe bis
> zum veröffentlichten Confluence-Artikel einschließlich Diagramm wurde im PoC
> praktisch nachgewiesen. Der aktuelle Stand ist noch kein breit
> produktionsreifes, mandantenfähiges Produkt.

## Welches Problem löst der Bot?

Prozessdokumentation entsteht heute häufig aus unstrukturierten Notizen,
E-Mails oder Gesprächen. Daraus ergeben sich typische Probleme:

- Dokumentation kostet Zeit und wird deshalb verspätet oder gar nicht erstellt.
- Aufbau, Sprache und Detailgrad unterscheiden sich je nach Autor.
- Rollen, Ausnahmen oder Verantwortlichkeiten werden leicht übersehen.
- Prozessdiagramme müssen separat erstellt und gepflegt werden.
- Wissen bleibt bei einzelnen Personen, anstatt nachvollziehbar dokumentiert zu
  sein.

AutoDocBot reduziert den redaktionellen Aufwand. Die fachliche Verantwortung
bleibt trotzdem beim Benutzer: Unklare Inhalte werden zurückgefragt und die
Veröffentlichung erfordert eine bewusste Freigabe.

## Ablauf aus Benutzersicht

1. Der Benutzer öffnet AutoDocBot im persönlichen Teams- oder
   Microsoft-365-Copilot-Chat.
2. Beim ersten Einsatz verbindet er sein eigenes Atlassian-Konto.
3. Er beschreibt einen Prozess in normaler Sprache.
4. AutoDocBot erkennt die benötigten Schritte selbstständig und fragt nur bei
   echten fachlichen Unklarheiten nach.
5. Der Bot erstellt einen strukturierten Artikel nach Styleguide und ergänzt
   ein Prozessdiagramm.
6. Eine Adaptive Card zeigt die konkrete Vorschau im Chat.
7. Der Benutzer bestätigt die Vorschau oder fordert Änderungen an.
8. Nach der Bestätigung veröffentlicht AutoDocBot den Artikel im fest
   konfigurierten Confluence-Space und gibt den Link zurück.

## Architektur – einfach erklärt

```text
Benutzer in Teams / Microsoft 365 Copilot
                    │
                    ▼
          Copilot-Studio-Agent
   versteht Anfrage und führt den Dialog
                    │
                    ▼
          AutoDocBot-MCP-Server
 prüft Struktur, Styleguide und Freigabe
                    │
                    ▼
           Confluence Cloud API
 Seite + SVG-Diagramm unter Benutzeridentität
```

Der Copilot-Agent ist die Gesprächsebene. Der MCP-Server ist die kontrollierte
Ausführungsebene: Er stellt nur vier begrenzte Werkzeuge bereit – Verbindung
prüfen, Styleguide laden, Vorschau erzeugen und bestätigte Vorschau
veröffentlichen. Confluence ist das führende Zielsystem für den fertigen
Artikel.

## Warum gibt es zwei Anmeldungen?

AutoDocBot verbindet zwei getrennte Systeme:

1. **Microsoft Entra:** Prüft, welcher Benutzer den MCP-Server über Copilot
   aufruft.
2. **Atlassian OAuth:** Legt fest, auf welche Confluence-Inhalte dieser Benutzer
   zugreifen darf und unter welchem Namen veröffentlicht wird.

Das lässt sich mit zwei Türstehern vergleichen: Microsoft kontrolliert den
Zugang zum AutoDocBot-Werkzeug, Atlassian kontrolliert den Zugang zu
Confluence. Keine der beiden Anmeldungen ersetzt die andere.

## Bereits nachgewiesene Funktionen

| Funktion | Stand im PoC |
|---|---|
| Freitext in strukturierte Prozessdaten überführen | verifiziert |
| Rechtschreibung und Formulierungen verbessern | verifiziert |
| Schrittzahl aus der Beschreibung ableiten | verifiziert |
| Fachliche Unklarheiten erkennen und gezielt nachfragen | verifiziert |
| Flexible Benutzerwünsche innerhalb eines verbindlichen Styleguides | verifiziert |
| Vorschau vor Veröffentlichung | verifiziert |
| Freigabe oder Abbruch per Button im Chat | verifiziert |
| SVG-Prozessdiagramm erzeugen und als letzten Abschnitt einfügen | verifiziert |
| Veröffentlichung im festgelegten Confluence-Space | verifiziert |
| Veröffentlichung unter der Atlassian-Identität des Benutzers | verifiziert |
| Betrieb als authentifizierter MCP-Server in Azure Container Apps | verifiziert |

## Sicherheitsprinzipien

- AutoDocBot besitzt kein globales Confluence-Servicekonto.
- Jeder Benutzer verbindet sein eigenes Atlassian-Konto per OAuth.
- Passwörter werden weder abgefragt noch gespeichert.
- Atlassian-Tokens werden benutzerbezogen mit AES-256-GCM verschlüsselt
  gespeichert.
- Der Ziel-Space ist serverseitig festgelegt und nicht vom Chat aus änderbar.
- Eine Vorschau gehört genau einem Benutzer, ist 30 Minuten gültig und nur für
  einen Veröffentlichungsversuch verwendbar.
- Benutzertext wird nicht als ungeprüftes HTML oder ausführbarer Diagrammcode
  übernommen.
- Die Veröffentlichung benötigt eine separate, konkrete Bestätigung.

## Nutzen für das Unternehmen

- geringerer Zeitaufwand für wiederkehrende Prozessdokumentation
- einheitlicher Aufbau und konsistente Sprache
- frühzeitige Erkennung fehlender Verantwortlichkeiten oder widersprüchlicher
  Angaben
- bessere Nachvollziehbarkeit durch standardisierte Rollen, Schritte und
  Ausnahmen
- Diagramm und Artikel entstehen in einem gemeinsamen Ablauf
- fachliche Kontrolle bleibt durch Vorschau und Benutzerfreigabe erhalten
- MCP trennt den Dialog sauber von sicherheitskritischen Schreiboperationen

Der wirtschaftliche Nutzen sollte in einem nächsten Pilot mit echten
Prozessautoren gemessen werden, beispielsweise über Bearbeitungszeit,
Nachbearbeitungsaufwand, Anzahl notwendiger Rückfragen und Akzeptanz der
erzeugten Artikel.

## Aktuelle Grenzen des PoC

- Der Aufbau ist auf genau einen Microsoft-Tenant, eine Atlassian-Site und
  einen Confluence-Space zugeschnitten.
- Agent und MCP-Identitätskomponenten liegen derzeit in unterschiedlichen
  Provectus-Umgebungen. Für Testbenutzer ist deshalb eine zusätzliche
  benutzerbezogene Verbindung notwendig.
- Die vorbereitete SSO-/OBO-Variante ist noch nicht in den veröffentlichten
  Agenten eingebunden.
- Vorschauen und OAuth-Zustände liegen im Arbeitsspeicher; deshalb läuft der
  Server aktuell mit nur einer Instanz.
- Die Veröffentlichung besteht aus mehreren Confluence-Aufrufen. Bei einem
  Teilfehler kann eine unvollständige Seite zurückbleiben.
- Es gibt noch keine Benutzeroberfläche zum Widerrufen gespeicherter
  Atlassian-Verbindungen.
- Monitoring, Alerting, Backups, CI/CD und mandantenfähige Administration sind
  vor einem breiten Produktivbetrieb zu ergänzen.

## Vorschlag für die nächste Phase

1. Einen begrenzten Pilot mit wenigen, namentlich festgelegten Testbenutzern
   durchführen.
2. Zeitersparnis, Artikelqualität, Rückfragen und technische Fehler erfassen.
3. Agent, Connector und Entra-App in eine gemeinsame produktive
   Power-Platform-/Tenant-Struktur überführen.
4. SSO/OBO, zentralen Statusspeicher, idempotentes Publishing, Monitoring und
   Offboarding ergänzen.
5. Anschließend über organisationsweiten Rollout oder getrennte
   Kundenbereitstellungen entscheiden.

## Kurzer Demoablauf

Für eine Vorstellung eignet sich ein Prozess mit Rollen, Frist und Ausnahme:

> Wenn ein neuer Mitarbeiter eingestellt wird, meldet HR den Eintritt
> mindestens fünf Arbeitstage vorher an Dennis. Dennis erstellt das
> Benutzerkonto und bereitet einen gereinigten Laptop vor. Fehlen Pflichtangaben,
> geht die Anfrage zurück an HR. Am ersten Arbeitstag übergibt die Führungskraft
> die Arbeitsmittel. Stelle das Diagramm von oben nach unten dar.

In der Demo sollten bewusst diese Punkte gezeigt werden:

1. strukturierte Vorschau aus unstrukturiertem Text,
2. automatisch abgeleitete Prozessschritte,
3. Rollen und Ausnahmeweg,
4. Bestätigung per Adaptive Card,
5. veröffentlichter Confluence-Artikel,
6. Diagramm als letzter Abschnitt,
7. Benutzer als Autor in Confluence.

## Weiterführende Unterlagen

- [Technische README](../README.md)
- [Onboarding eines neuen Testusers](testuser-onboarding.md)
- [Copilot-Agentenanweisungen](copilot-agent-instructions.md)
- [Adaptive-Card-Ablauf](copilot-preview-confirmation-card.md)

