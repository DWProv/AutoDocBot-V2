# Artikelvorschau direkt im Chat bestätigen

AutoDocBot liefert ab Version 0.1.6 mit jeder erfolgreichen Vorschau zusätzlich
`confirmationCardData`. Diese flachen, präsentationsfertigen Werte sind für eine
Adaptive Card in Copilot Studio vorgesehen. Der MCP-Server erzeugt nicht selbst
den sichtbaren Button: Darstellung, Verzweigung und Toolaufruf werden im
Copilot-Thema verdrahtet.

## Zielablauf

1. Der Agent ruft `preview_process_article` auf.
2. Bei `clarification_required` oder `article_structure_retry_required` läuft
   der bestehende Klärungs- beziehungsweise Reparaturpfad weiter.
3. Nur eine erfolgreiche Vorschau liefert `previewId` und
   `confirmationCardData`.
4. Das Thema **Artikelvorschau bestätigen** zeigt diese Daten in einer Karte.
5. **Bestätigen und veröffentlichen** gibt `PublicationApproved=true` und die
   geprüfte `ApprovedPreviewId` an die generative Orchestrierung zurück.
6. Die Orchestrierung ruft `publish_process_article` mit dieser ID und dem
   Literalwert `true` auf.
7. **Ändern / abbrechen** veröffentlicht nichts. Änderungen führen immer zu
   einer neuen Vorschau und damit einer neuen `previewId`.

## Thema in Copilot Studio anlegen

Lege ein Thema **Artikelvorschau bestätigen** an und beschreibe es so:

> Zeigt ausschließlich eine bereits vom AutoDocBot-MCP-Server validierte
> Artikelvorschau an und gibt die ausdrückliche Veröffentlichungsentscheidung
> als strukturierte Themenausgabe an die generative Orchestrierung zurück.

Lege diese Texteingaben für das Thema an und befülle sie aus
`confirmationCardData`:

| Themenvariable | MCP-Feld |
|---|---|
| `PreviewId` | `previewId` |
| `CardInstanceId` | `cardInstanceId` |
| `PreviewTitle` | `title` |
| `PreviewSummary` | `summary` |
| `PreviewRolesText` | `rolesText` |
| `PreviewStepsText` | `stepsText` |
| `PreviewExceptionsText` | `exceptionsText` |
| `PreviewDiagramDirection` | `diagramDirectionLabel` |
| `PreviewExpiresAt` | `expiresAt` |

Die Eingaben müssen in ihrer Beschreibung als bereits vorhandene
Vorschauwerte gekennzeichnet sein. Der Orchestrator darf den Benutzer nicht
danach fragen. Stelle deshalb **Should prompt user** für jede Eingabe auf aus.
Wenn ein Wert fehlt, darf das Thema nicht veröffentlichen, sondern muss den
Vorschauablauf erneut starten.

Lege außerdem diese Themenausgaben an:

| Themenausgabe | Typ | Bedeutung |
|---|---|---|
| `PublicationApproved` | Boolean | Nur bei einer vollständig passenden Publish-Kartenaktion `true` |
| `ApprovedPreviewId` | String | Serverseitige Vorschau-ID aus der geprüften Kartenaktion |

Füge anschließend den Knoten **Mit adaptiver Karte fragen** ein. Verwende
Schema 1.5, damit die Karte auch in Microsoft Teams funktioniert. Im
Power-Fx-Modus kann folgende Formel verwendet werden:

```powerfx
{
  '$schema': "http://adaptivecards.microsoft.com/schemas/adaptive-card.json",
  type: "AdaptiveCard",
  version: "1.5",
  body: [
    {
      type: "TextBlock",
      text: "Artikelvorschau",
      weight: "Bolder",
      size: "Large",
      wrap: true
    },
    {
      type: "TextBlock",
      text: Topic.PreviewTitle,
      weight: "Bolder",
      size: "Medium",
      wrap: true
    },
    {
      type: "TextBlock",
      text: Topic.PreviewSummary,
      wrap: true
    },
    {
      type: "TextBlock",
      text: "Rollen",
      weight: "Bolder",
      wrap: true
    },
    {
      type: "TextBlock",
      text: Topic.PreviewRolesText,
      wrap: true
    },
    {
      type: "TextBlock",
      text: "Prozessschritte",
      weight: "Bolder",
      wrap: true
    },
    {
      type: "TextBlock",
      text: Topic.PreviewStepsText,
      wrap: true
    },
    {
      type: "TextBlock",
      text: "Ausnahmen",
      weight: "Bolder",
      wrap: true
    },
    {
      type: "TextBlock",
      text: Topic.PreviewExceptionsText,
      wrap: true
    },
    {
      type: "FactSet",
      facts: [
        {
          title: "Diagramm",
          value: Topic.PreviewDiagramDirection
        },
        {
          title: "Gültig bis",
          value: Topic.PreviewExpiresAt
        }
      ]
    },
    {
      type: "TextBlock",
      text: "Es wurde noch nichts veröffentlicht.",
      color: "Attention",
      weight: "Bolder",
      wrap: true
    }
  ],
  actions: [
    {
      type: "Action.Submit",
      title: "Bestätigen und veröffentlichen",
      style: "positive",
      associatedInputs: "none",
      data: {
        previewAction: "publish",
        actionSubmitId: Topic.CardInstanceId & "-publish",
        submittedPreviewId: Topic.PreviewId
      }
    },
    {
      type: "Action.Submit",
      title: "Ändern / abbrechen",
      associatedInputs: "none",
      data: {
        previewAction: "cancel",
        actionSubmitId: Topic.CardInstanceId & "-cancel",
        submittedPreviewId: Topic.PreviewId
      }
    }
  ]
}
```

Copilot Studio sollte daraus die drei Textausgaben `previewAction`,
`actionSubmitId` und `submittedPreviewId` erzeugen. Falls das nicht automatisch
geschieht, verwende unter **Schema bearbeiten** dieses YAML-Schema:

```yaml
kind: Record
properties:
  previewAction: String
  actionSubmitId: String
  submittedPreviewId: String
```

Der Editor erwartet hier YAML und kein JSON.

## Verzweigung nach dem Klick

Lege direkt nach der Karte eine Bedingung an.

### Veröffentlichen

Der Veröffentlichungszweig darf nur ausgeführt werden, wenn alle drei
Bedingungen gelten:

```powerfx
Topic.previewAction = "publish" &&
Topic.submittedPreviewId = Topic.PreviewId &&
Topic.actionSubmitId = Topic.CardInstanceId & "-publish"
```

Setze dort die Themenausgaben:

| Themenausgabe | Wert |
|---|---|
| `PublicationApproved` | `true` als boolescher Literalwert |
| `ApprovedPreviewId` | `Topic.PreviewId` |

Beende danach das aktuelle Thema. Der MCP-Server wird in der getesteten
Copilot-Studio-Oberfläche nicht als einzelnes Unterwerkzeug im Themenknoten
aufgerufen. Stattdessen übernimmt die generative Orchestrierung die Ausgaben
und ruft `publish_process_article` mit `ApprovedPreviewId` sowie dem booleschen
Literalwert `true` auf. Wichtig: `Topic.submittedPreviewId` wird nie ungeprüft
als Toolparameter verwendet.

### Ändern oder abbrechen

Bei `previewAction = "cancel"` setzt das Thema `PublicationApproved=false` und
`ApprovedPreviewId` auf einen leeren String. Es wird kein Publishing-Tool
aufgerufen. Der Agent antwortet beispielsweise:

> Die Vorschau wurde nicht veröffentlicht. Nenne mir die gewünschten
> Änderungen; danach erstelle ich eine neue Vorschau.

Jede Änderung muss erneut durch `preview_process_article` laufen. Eine alte
`previewId` wird nicht für den geänderten Inhalt verwendet.

### Unerwartete oder alte Kartenaktion

Wenn Kennung, Aktion oder Vorschau-ID nicht zusammenpassen, setzt das Thema
dieselben sicheren Ausgabewerte wie beim Abbruch. Der Agent erklärt, dass die
Vorschau nicht mehr aktuell ist, und erzeugt bei Bedarf eine neue.

## Warum diese Absicherung wichtig ist

Adaptive-Card-Buttons können je nach Chatoberfläche mehrfach oder auch auf
einer älteren sichtbaren Karte angeklickt werden. Deshalb enthält jede Aktion
die eindeutige `cardInstanceId`, und das Thema prüft sie. Zusätzlich schützt der
MCP-Server unabhängig davon:

- Vorschauen gehören zum aktuell authentifizierten Benutzer.
- Vorschauen laufen nach 30 Minuten ab.
- Eine Vorschau wird beim ersten Veröffentlichungsversuch verbraucht.
- Der Ziel-Space ist serverseitig festgelegt.

Die Karte verbessert damit Bedienbarkeit und Routing. Sie ersetzt weder die
serverseitige Autorisierung noch die Vorschauvalidierung.

## Abnahmetests

1. **Bestätigen:** Neue Vorschau erzeugen, Button bestätigen, genau eine Seite
   wird veröffentlicht.
2. **Abbrechen:** Neue Vorschau erzeugen, abbrechen, es entsteht keine Seite.
3. **Ändern:** Abbrechen, Text ändern, neue Vorschau erzeugen; nur deren neue ID
   darf veröffentlicht werden.
4. **Doppelklick:** Bestätigungsbutton zweimal auslösen; der zweite Versuch darf
   keine zweite Seite erzeugen.
5. **Alte Karte:** Zwei Vorschauen nacheinander erzeugen und die ältere Karte
   anklicken; die aktuelle Vorschau darf dadurch nicht freigegeben werden.
6. **Ablauf:** Nach mehr als 30 Minuten bestätigen; der Server lehnt ab und eine
   neue Vorschau ist erforderlich.
7. **Fremder Benutzer:** Eine Vorschau-ID in einer anderen Benutzersitzung
   verwenden; der Server lehnt ab.

## Referenzen

- [Mit Adaptive Cards fragen](https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-ask-with-adaptive-card)
- [Adaptive Cards in Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/adaptive-cards-overview)
- [Action.Submit](https://learn.microsoft.com/en-us/adaptive-cards/schema-explorer/action-submit)
