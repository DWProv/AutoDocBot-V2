# Onboarding eines neuen AutoDocBot-Testusers

## Zweck und Geltungsbereich

Diese Anleitung beschreibt das Onboarding **für den aktuell veröffentlichten
PoC**. Sie gilt, solange:

- der Copilot-Agent im Provectus-Standard-Tenant liegt,
- MCP-Server und Entra-App-Registrierungen in der Provectus-Lab-Umgebung
  betrieben werden,
- der veröffentlichte Agent die funktionierende benutzerbezogene
  Power-Platform-Verbindung verwendet,
- der vorbereitete SSO-/OBO-Custom-Connector noch nicht produktiv eingebunden
  ist,
- genau eine Atlassian-Site und ein Confluence-Ziel-Space serverseitig
  konfiguriert sind.

Ein Testuser wird nicht im AutoDocBot-Code und nicht direkt im Token Store
angelegt. Das Onboarding besteht aus Zugriffsfreigaben in Microsoft, einer
persönlichen MCP-Verbindung und einer persönlichen Atlassian-Autorisierung.

## Beteiligte Rollen

| Rolle | Aufgabe |
|---|---|
| AutoDocBot-Verantwortlicher | koordiniert das Onboarding und führt den Abnahmetest durch |
| Copilot-Studio-Owner | gibt den veröffentlichten Agenten für den Testuser frei |
| Standard-Tenant-/M365-Admin | stellt Konto, Lizenz, Teams und gegebenenfalls App-Freigabe bereit |
| Lab-Tenant-/Entra-Admin | stellt sicher, dass der Benutzer die Lab-geschützte MCP-API verwenden darf |
| Atlassian-/Space-Admin | stellt Atlassian-Konto und Rechte im Ziel-Space bereit |
| Testuser | richtet persönliche Verbindungen ein und führt den Funktionstest durch |

Eine Person kann mehrere dieser Rollen übernehmen.

## Benötigte Angaben vor dem Start

Die folgenden Werte werden außerhalb des öffentlichen Repositorys sicher an
den Verantwortlichen übergeben:

| Angabe | Beispiel/Quelle |
|---|---|
| E-Mail/UPN des Testusers im Standard-Tenant | Microsoft-Entra-Benutzerverwaltung |
| Lab-Identität oder Lab-Gastkonto des Testusers | Lab-Entra-Benutzerverwaltung |
| Name des Copilot-Agenten | Copilot Studio |
| Installationslink des veröffentlichten Agenten | Copilot Studio, Kanal Teams/Microsoft 365 Copilot |
| Name der MCP-/Power-Platform-Verbindung | Verbindungsmanager des Agenten |
| Atlassian-Benutzerkonto | Ziel-Site |
| Name und URL des festgelegten Confluence-Spaces | Projektkonfiguration |

Client Secrets, OAuth-Tokens, der Token-Verschlüsselungsschlüssel und
Einmal-Links dürfen nicht in Tickets, diese Datei oder das Repository kopiert
werden.

## Übersicht

| Phase | Verantwortlich | Ergebnis |
|---|---|---|
| 1. Voraussetzungen prüfen | Projektverantwortlicher/Admins | Benutzer kann alle drei beteiligten Plattformen verwenden |
| 2. Microsoft-Zugriff vorbereiten | Standard- und Lab-Admin | Agent und MCP-API sind für den Benutzer erreichbar |
| 3. Agent freigeben | Copilot-Studio-Owner | Installationslink kann vom Benutzer geöffnet werden |
| 4. MCP-Verbindung herstellen | Testuser | Agent kann die vier AutoDocBot-Tools laden |
| 5. Atlassian verbinden | Testuser | persönliche Atlassian-Verbindung ist serverseitig gespeichert |
| 6. Abnahmetest durchführen | Testuser/Projektverantwortlicher | Vorschau, Abbruch und Veröffentlichung sind nachgewiesen |
| 7. Ergebnis dokumentieren | Projektverantwortlicher | Testprotokoll ohne sensible Daten liegt vor |

## Phase 1 – Voraussetzungen prüfen

### 1.1 Standard-Tenant-Konto anlegen oder auswählen

Für einen internen Mitarbeiter soll nach Möglichkeit dessen vorhandenes,
personenbezogenes Geschäftskonto verwendet werden. Wird ausdrücklich ein
separates Testkonto benötigt, legt der Standard-Tenant-Admin es in Microsoft
Entra an:

1. **Microsoft Entra Admin Center → Identity → Users → All users → New user**
   öffnen.
2. **Create new user** auswählen und einen eindeutig als Testkonto erkennbaren
   Anzeigenamen sowie UPN vergeben.
3. Ein temporäres Kennwort sicher an den Testuser übergeben und eine Änderung
   bei der ersten Anmeldung verlangen.
4. Die organisationsüblichen MFA- und Conditional-Access-Regeln anwenden.
5. Im Microsoft 365 Admin Center die für Teams/Copilot benötigte Lizenz
   zuweisen.
6. Erste Anmeldung durchführen und bestätigen, dass Teams beziehungsweise
   Microsoft 365 Copilot geöffnet werden kann.

Kein gemeinsam verwendetes Sammelkonto anlegen: Die spätere Zuordnung zur
Atlassian-Verbindung und die Autorenkennung sollen personenbezogen testbar
bleiben.

### 1.2 Lab-Tenant-Identität bereitstellen

Da die MCP-API aktuell im Lab-Tenant geschützt wird, muss derselbe Tester dort
eine nutzbare Identität besitzen. Für einen Benutzer aus dem Standard-Tenant
ist ein Gastkonto normalerweise die sparsamere PoC-Variante:

1. Im **Entra Admin Center des Lab-Tenants → Identity → Users → All users → New
   user → Invite external user** öffnen.
2. Die Geschäftskonto-Adresse des Testusers einladen.
3. Einladung vom Testuser annehmen lassen und eine erfolgreiche Anmeldung im
   Lab-Tenant prüfen.
4. Falls die AutoDocBot Enterprise Application eine Zuweisung verlangt, den
   Gast oder eine Pilotgruppe zuweisen.
5. Falls die Power-Platform-Umgebung über eine Sicherheitsgruppe begrenzt ist,
   den Benutzer auch dieser Gruppe hinzufügen.

Alternativ kann ein separates Lab-Mitgliedskonto verwendet werden. Dann muss
beim Herstellen der MCP-Verbindung genau dieses Konto ausgewählt werden. Die
gewählte Variante wird im Testprotokoll als „Gastkonto“ oder „Lab-Mitglied“
festgehalten – ohne Kennwort oder Token.

### 1.3 Atlassian-Konto und Space-Rechte bereitstellen

1. In der Atlassian-Administration prüfen, ob die geschäftliche E-Mail-Adresse
   bereits als Benutzer der Ziel-Site existiert.
2. Falls nicht, den Benutzer über die Benutzerverwaltung der Organisation
   einladen und die Einladung annehmen lassen.
3. Confluence-Produktzugriff gewähren, sofern dies in der Organisation
   erforderlich ist.
4. Im festgelegten Ziel-Space mindestens das Lesen des Spaces sowie das
   Erstellen von Seiten und Attachments erlauben.
5. Eine normale Anmeldung an der Ziel-Site und den sichtbaren Ziel-Space vor
   dem Bot-Test prüfen.

Die OAuth-Scopes der App erweitern keine fachlichen Confluence-Rechte. Der Bot
kann nur das tun, was das verbundene Atlassian-Konto im Ziel-Space ebenfalls
darf.

### 1.4 Gemeinsame Abschlussprüfung

Vor der Freigabe müssen alle Punkte mit **Ja** beantwortet werden:

- [ ] Der Testuser besitzt ein aktives Konto im Provectus-Standard-Tenant.
- [ ] Der Testuser kann sich in Microsoft Teams oder Microsoft 365 Copilot
      anmelden.
- [ ] Die für die Nutzung des Agenten erforderliche Microsoft-/Copilot-Lizenz
      ist zugewiesen.
- [ ] Der Testuser besitzt eine nutzbare Identität im Lab-Tenant, beispielsweise
      als Mitglied oder eingeladener Gast.
- [ ] Der Testuser kann den Lab-Tenant bei einer Microsoft-Anmeldung auswählen
      und die Anmeldung einschließlich MFA abschließen.
- [ ] Der Testuser besitzt ein Atlassian-Konto auf der konfigurierten Ziel-Site.
- [ ] Dieses Atlassian-Konto darf den Ziel-Space lesen, Seiten erstellen und
      Attachments hinzufügen.
- [ ] Der Agent ist veröffentlicht und der Kanal **Teams und Microsoft 365
      Copilot** ist weiterhin aktiv.
- [ ] Der MCP-Server ist erreichbar und `/healthz` meldet den erwarteten
      Entra-Modus.

Fehlt eine Voraussetzung, wird das Onboarding an dieser Stelle gestoppt. Es
sollen keine fremden Konten oder gemeinsam genutzten Benutzerverbindungen als
Workaround verwendet werden.

## Phase 2 – Microsoft-Zugriff vorbereiten

### 2.1 Standard-Tenant

Der Standard-Tenant-/M365-Admin prüft:

1. Benutzerkonto ist aktiv und nicht durch eine Conditional-Access-Regel vom
   vorgesehenen Teams-/Copilot-Zugriff ausgeschlossen.
2. Benötigte Lizenz ist zugewiesen.
3. Teams beziehungsweise Microsoft 365 Copilot ist für den Benutzer verfügbar.
4. Falls der Agent über den organisationsinternen App-/Agent-Store verteilt
   wird, ist er für den Testuser oder seine Pilotgruppe zugelassen.

### 2.2 Lab-Tenant

Der Lab-Tenant-/Entra-Admin prüft:

1. Der Benutzer existiert im Lab-Tenant als Mitglied oder Gast und kann sich
   dort anmelden.
2. Falls bei der Enterprise Application **User assignment required** aktiviert
   ist, wird der Testuser oder eine passende Pilotgruppe zugewiesen.
3. Der delegierte API-Scope `access_as_user` ist für die AutoDocBot-API
   vorhanden.
4. Erforderlicher Admin Consent wurde erteilt. Admin Consent ersetzt nicht die
   spätere persönliche Anmeldung des Benutzers.
5. Conditional Access erlaubt den vorgesehenen Zugriff. MFA soll nicht
   deaktiviert werden.

Die aktuelle Cross-Tenant-Konstellation ist eine PoC-Ausnahme. Ein Benutzer,
der ausschließlich im Standard-Tenant existiert und sich nicht gegenüber dem
Lab-Tenant ausweisen darf, kann die gegenwärtige MCP-Verbindung nicht
erfolgreich herstellen.

## Phase 3 – Agent für den Testuser freigeben

Diese Schritte führt der Copilot-Studio-Owner in der Umgebung des
veröffentlichten Agenten aus:

1. Copilot Studio öffnen und in die **Standard-Umgebung** wechseln.
2. Den veröffentlichten AutoDocBot-Agenten öffnen.
3. Über das Menü **… → Share/Freigeben** die Freigabeverwaltung öffnen.
4. Den Testuser oder vorzugsweise die Pilot-Sicherheitsgruppe hinzufügen.
5. Nur die Berechtigung **User – can use the agent** beziehungsweise
   **Kann den Agenten verwenden** vergeben. Keine Maker-/Bearbeitungsrechte
   erteilen.
6. Speichern und prüfen, dass der Benutzer in der Freigabeliste erscheint.
7. Unter **Channels/Kanäle → Teams and Microsoft 365 Copilot** kontrollieren,
   dass der Kanal aktiv ist.
8. Unter den Verfügbarkeitsoptionen den Installationslink kopieren und dem
   Testuser über einen kontrollierten Kommunikationsweg senden.

Danach die verwendete Verbindung kontrollieren:

1. Im Agenten **Settings/Einstellungen → Connection Settings/Verbindungen**
   öffnen.
2. Prüfen, dass das AutoDocBot-V2-MCP-Tool dem Agenten zugeordnet und nicht als
   fehlerhaft angezeigt wird.
3. Wenn der zugrunde liegende Connector eine eigene **Share/Freigeben**-Option
   anbietet, dem Testuser oder der Pilotgruppe **Can view/Kann anzeigen** geben.
   **Can edit** ist für reine Testuser nicht erforderlich.
4. Wenn der per MCP-Onboarding erzeugte Connector keine separate
   Freigabeoption zeigt, wird dieser Schritt übersprungen; die persönliche
   Verbindung wird dann beim ersten Toolaufruf erstellt.

Der Installationslink allein erteilt keine Berechtigung. Der Benutzer muss
zusätzlich explizit oder über seine Sicherheitsgruppe für den Agenten
freigegeben sein.

## Phase 4 – Persönliche MCP-Verbindung herstellen

Diese Schritte führt der Testuser aus:

1. In Teams Desktop/Web oder Microsoft 365 Copilot mit dem
   Standard-Tenant-Konto anmelden.
2. Den erhaltenen Installationslink öffnen und AutoDocBot hinzufügen.
3. Einen persönlichen 1:1-Chat mit AutoDocBot öffnen. Für den PoC nicht mit
   einem Kanal- oder Gruppenchat beginnen.
4. Folgende Nachricht senden:

   > Prüfe meine Confluence-Verbindung und nenne mir den aktuellen
   > Verbindungsstatus. Veröffentliche nichts.

5. Beim ersten Toolaufruf öffnet Copilot Studio derzeit den
   Verbindungsmanager beziehungsweise zeigt eine Verbindungskarte. Das ist im
   aktuellen PoC erwartetes Verhalten.
6. **Verbindung herstellen** beziehungsweise **Neue Verbindung** auswählen.
7. Bei der Microsoft-Anmeldung ausdrücklich die für den Lab-Tenant
   freigeschaltete Identität verwenden und gegebenenfalls in den Lab-Tenant
   wechseln.
8. Angezeigte Berechtigungen prüfen und zustimmen. Keine Zugangsdaten an den
   Projektverantwortlichen weitergeben.
9. Zum Chat zurückkehren und die Nachricht aus Schritt 4 erneut senden, falls
   der Agent nicht automatisch fortfährt.

Erwartetes Ergebnis: Der Agent kann den MCP-Server erreichen. Ist Atlassian
noch nicht verbunden, liefert `get_confluence_connection` anschließend einen
persönlichen Autorisierungslink.

## Phase 5 – Persönliches Atlassian-Konto verbinden

1. Den vom Agenten ausgegebenen Atlassian-Link nur im eigenen Browser öffnen.
2. Den Link nicht weiterleiten. Er ist zeitlich begrenzt, einmal verwendbar und
   bis zur Nutzung wie ein kurzfristiges Passwort zu behandeln.
3. Mit dem eigenen Atlassian-Konto anmelden.
4. Prüfen, dass die erwartete Atlassian-Site angezeigt wird.
5. Die angeforderten Confluence-Berechtigungen prüfen und autorisieren.
6. Nach dem erfolgreichen Callback zum AutoDocBot-Chat zurückkehren.
7. Erneut senden:

   > Prüfe meine Confluence-Verbindung. Veröffentliche nichts.

Erwartetes Ergebnis:

- `connected` ist wahr,
- der eigene Atlassian-Benutzer wird erkannt,
- die erwartete Site wird angezeigt,
- der serverseitig konfigurierte Ziel-Space wird erkannt.

Der Server speichert danach die Atlassian-Verbindung verschlüsselt unter der
Microsoft-Benutzeridentität. Es wird kein Atlassian-Passwort gespeichert.

## Phase 6 – Funktionaler Abnahmetest

### Test A: Vorschau und Abbruch

Folgenden Text senden:

> Erstelle aus der folgenden Beschreibung eine Vorschau für einen
> Confluence-Prozessartikel. Verwende den AutoDocBot-Styleguide und ein
> Diagramm von oben nach unten. Veröffentliche noch nichts. Wenn ein neuer
> Mitarbeiter eingestellt wird, meldet HR den Eintritt mindestens fünf
> Arbeitstage vorher an Dennis. Dennis erstellt das Benutzerkonto und bereitet
> einen gereinigten Laptop vor. Fehlen Pflichtangaben, geht die Anfrage zurück
> an HR. Am ersten Arbeitstag übergibt die Führungskraft die Arbeitsmittel.

Prüfen:

- [ ] Der Bot fragt nicht nach der gewünschten Anzahl der Prozessschritte.
- [ ] Es erscheinen keine technischen Fragen nach JSON- oder Schemafeldern.
- [ ] Rollen, Schritte und Ausnahmeweg werden sinnvoll abgeleitet.
- [ ] Die Adaptive Card zeigt Titel, Zusammenfassung, Rollen, Schritte,
      Ausnahme und Diagrammrichtung.
- [ ] Die Karte weist darauf hin, dass noch nichts veröffentlicht wurde.

Nun **Ändern / abbrechen** wählen.

- [ ] Der Agent bestätigt den Abbruch.
- [ ] Im Ziel-Space wurde keine neue Seite erstellt.

### Test B: Bestätigte Veröffentlichung

Den Testtext erneut senden und eine neue Vorschau erzeugen lassen. Anschließend
**Bestätigen und veröffentlichen** wählen.

Prüfen:

- [ ] `publish_process_article` wird erst nach dem Button-Klick ausgeführt.
- [ ] Der Agent gibt den Link zur neuen Confluence-Seite zurück.
- [ ] Der Link öffnet eine Seite im festgelegten Ziel-Space.
- [ ] Titel und Inhalt entsprechen der bestätigten Vorschau.
- [ ] Das SVG-Prozessdiagramm ist der letzte fachliche Abschnitt.
- [ ] Das Diagramm verläuft von oben nach unten.
- [ ] In der Confluence-Seitenhistorie entspricht der Autor dem Atlassian-Konto
      des Testusers.
- [ ] Es wurde genau eine neue Seite angelegt.

### Test C: Keine ungewollte Wiederverwendung

Optional den bereits verwendeten Bestätigungsbutton erneut auslösen.

- [ ] Es entsteht keine zweite Seite aus derselben Vorschau.
- [ ] Der Agent verlangt bei Bedarf eine neue Vorschau.

## Phase 7 – Test protokollieren

Folgende Informationen dürfen im Testprotokoll festgehalten werden:

```text
Datum/Uhrzeit:
Testuser (geschäftliche Kennung, keine Tokens):
Teams oder Microsoft 365 Copilot:
MCP-Verbindung erfolgreich: ja/nein
Atlassian-Verbindung erfolgreich: ja/nein
Vorschau erfolgreich: ja/nein
Abbruch ohne Veröffentlichung: ja/nein
Bestätigte Veröffentlichung erfolgreich: ja/nein
Autor korrekt: ja/nein
Diagramm korrekt: ja/nein
Confluence-Seiten-ID oder interner Link:
Fehlermeldung, falls vorhanden:
```

Nicht protokollieren:

- Access- oder Refresh-Tokens,
- Client Secrets,
- vollständige Authorization Codes,
- Einmal-Links,
- Browser-Cookies,
- Screenshots mit sensiblen Token- oder Verbindungsdaten.

## Häufige Fehler

### Der Agent kann installiert werden, aber Tools funktionieren nicht

1. Im persönlichen Chat testen, nicht zuerst im Gruppenchat.
2. Verbindungsmanager öffnen und Status der AutoDocBot-MCP-Verbindung prüfen.
3. Sicherstellen, dass die Verbindung mit der Lab-berechtigten Identität
   erstellt wurde.
4. Verbindung bei Bedarf neu authentifizieren und den Agenten-Chat neu öffnen.

### `AADSTS50011` oder `redirect URI does not match`

Die in der Fehlermeldung ausgegebene Redirect-URI muss **zeichengetreu** als
Web-Redirect-URI an der richtigen Connector-/Client-App-Registrierung im
Lab-Tenant hinterlegt sein. Danach die fehlerhafte Power-Platform-Verbindung
löschen beziehungsweise neu erstellen. Eine ähnlich aussehende ältere
Redirect-URI reicht nicht aus.

### `unexpected "iss" claim value`

Prüfen, dass die AutoDocBot-API v2-Access-Tokens ausstellt und
`api.requestedAccessTokenVersion` auf `2` steht. Anschließend die
Power-Platform-Verbindung neu authentifizieren.

### Der Agent zeigt kurz Aktivität und bricht dann ab

Das deutet im aktuellen Aufbau häufig auf eine abgelaufene oder fehlerhafte
Power-Platform-Verbindung hin. Zuerst den Verbindungsstatus und danach
Redirect-URI, Lab-Anmeldung und Consent prüfen.

### Atlassian-Link ist ungültig

Der Link ist nur einmal verwendbar und zehn Minuten gültig. Im Chat eine neue
Verbindungsprüfung auslösen und ausschließlich den neu ausgegebenen Link
verwenden.

### Ziel-Space wird nicht gefunden

Prüfen, ob das Atlassian-Konto auf der richtigen Site angemeldet ist und den
festgelegten Space sehen sowie dort Seiten und Attachments erstellen darf. Die
PoC-Implementierung prüft nur die ersten 100 von Atlassian gelieferten Spaces.

### Vorschau ist abgelaufen

Eine Vorschau gilt 30 Minuten. Danach muss aus dem aktuellen Prozessstand eine
neue Vorschau erzeugt und erneut bestätigt werden.

## Offboarding eines Testusers

Nach Ende des Tests führt der Verantwortliche – abhängig vom vereinbarten
Testumfang – folgende Schritte durch:

1. Agentenfreigabe für den Benutzer beziehungsweise Mitgliedschaft in der
   Pilotgruppe entfernen.
2. Persönliche Power-Platform-/MCP-Verbindung des Benutzers widerrufen oder
   löschen.
3. Nicht mehr benötigte Lab-Gastmitgliedschaft oder Enterprise-App-Zuweisung
   entfernen.
4. Atlassian-App-Zugriff durch den Benutzer oder Atlassian-Admin widerrufen.
5. Die verschlüsselt gespeicherte AutoDocBot-Verknüpfung über den abgesicherten
   betrieblichen Wartungsprozess entfernen.
6. Vom Test erzeugte Confluence-Seiten nach der vereinbarten Regel behalten,
   kennzeichnen oder löschen.

Der aktuelle PoC besitzt noch keine Self-Service-Oberfläche für Schritt 5.
Dieser Punkt muss deshalb vom AutoDocBot-Verantwortlichen kontrolliert
durchgeführt und dokumentiert werden.

## Abschlusskriterium

Das Onboarding ist abgeschlossen, wenn:

- der Benutzer den Agenten im persönlichen Chat öffnen kann,
- die persönliche MCP- und Atlassian-Verbindung funktioniert,
- Abbruch sicher keine Seite erzeugt,
- eine bestätigte Vorschau genau eine korrekte Seite mit Diagramm erzeugt,
- der Testuser als Autor ausgewiesen wird,
- das Ergebnis ohne Geheimnisse im Testprotokoll dokumentiert ist.

## Offizielle Referenzen

- [Copilot-Studio-Agenten für Benutzer freigeben](https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-share-bots)
- [Agent mit Teams und Microsoft 365 Copilot verbinden](https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-add-bot-to-microsoft-teams)
- [Verbindungen in Copilot Studio verwalten](https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-connections)
- [Benutzerauthentifizierung für Tools konfigurieren](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-enduser-authentication)
- [Atlassian OAuth 2.0 (3LO)](https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/)
- [Confluence OAuth-Scopes](https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/)
