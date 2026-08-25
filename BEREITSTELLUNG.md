# AutoDocBot V2 – Bereitstellung und Betrieb

Diese Anleitung bündelt Einrichtung, Konfiguration, Freigabe, Deployment,
Betriebsprüfung und Fehlerbehebung für AutoDocBot V2 in Version `0.1.6`.
Architektur, Funktionsweise, Sicherheitsmodell und bekannte PoC-Grenzen stehen
in der [Projektdokumentation](README.md).

Vor einem Rollout sollten insbesondere der
[verifizierte Projektstand](README.md#verifizierter-end-to-end-stand), das
[Authentifizierungs- und Sicherheitsmodell](README.md#authentifizierung-und-sicherheit)
und die [bekannten PoC-Grenzen](README.md#bekannte-poc-grenzen) gelesen werden.

> Stand: 25. August 2026. Die konkreten Tenant-, Site-, Space- und Secret-Werte
> werden bewusst nicht in diesem Repository dokumentiert.

## Inhaltsverzeichnis

- [Voraussetzungen](#voraussetzungen)
- [Lokale Einrichtung](#lokale-einrichtung)
- [Atlassian-App konfigurieren](#atlassian-app-konfigurieren)
- [Konfiguration](#konfiguration)
- [Copilot Studio anbinden](#copilot-studio-anbinden)
- [Agent bereitstellen und Benutzerzugriff](#agent-bereitstellen-und-benutzerzugriff)
- [Container und Azure-Deployment](#container-und-azure-deployment)
- [Tests und Qualitätsprüfungen](#tests-und-qualitätsprüfungen)
- [HTTP-Endpunkte](#http-endpunkte)
- [Fehlerbehebung](#fehlerbehebung)

## Voraussetzungen

- Node.js 24 oder eine kompatible aktuelle Node.js-Version
- npm
- eine Atlassian-Cloud-Site mit Confluence
- Berechtigung, im fest konfigurierten Confluence-Ziel-Space Seiten und Attachments anzulegen
- eine Atlassian OAuth-2.0-App
- für den produktiven Copilot-Betrieb: Microsoft-Entra-App-Registrierungen
- für Azure: Azure CLI, eine Subscription und Berechtigungen für Container Apps, ACR, Storage und Log Analytics

## Lokale Einrichtung

### 1. Repository klonen

```bash
git clone https://github.com/DWProv/AutoDocBot-V2.git
cd AutoDocBot-V2
npm ci
```

### 2. Konfiguration anlegen

```bash
cp .env.example .env
```

Mindestens diese Werte müssen in `.env` gesetzt werden:

```dotenv
ATLASSIAN_CLIENT_ID=your-atlassian-client-id
ATLASSIAN_CLIENT_SECRET=your-atlassian-client-secret
ATLASSIAN_SITE_URL=https://your-site.atlassian.net
ATLASSIAN_SPACE_ID=your-confluence-space-id
ATLASSIAN_REDIRECT_URI=http://localhost:3000/oauth/callback
AUTH_MODE=local
LOCAL_USER_ID=local:developer
PUBLIC_BASE_URL=http://localhost:3000
```

Die `.env`-Datei wird von Git ignoriert und darf nicht committed werden.
Dasselbe gilt strikt für die lokale Datei beziehungsweise das Verzeichnis
`data`, den Laufzeitpfad `/data`, `.local/`, Token Stores und Logs: Sie können
sensible Verbindungs- oder Betriebsdaten enthalten, sind in `.gitignore` und
`.dockerignore` ausgeschlossen und dürfen niemals erzwungen versioniert werden.

### 3. Entwicklungsserver starten

```bash
npm run dev
```

Danach `http://localhost:3000` öffnen und **Mit Atlassian verbinden** wählen. Nach erfolgreicher Zustimmung zeigt die Seite den Atlassian-Benutzer, die Cloud-ID, verfügbare Spaces und den Refresh-Token-Status an.

Für einen produktionsnahen lokalen Start:

```bash
npm run build
npm run start:prod
```

## Atlassian-App konfigurieren

In der Atlassian Developer Console wird eine OAuth-2.0-(3LO)-App benötigt.

### Callback URL

Lokal muss die Callback URL exakt mit `.env` übereinstimmen:

```text
http://localhost:3000/oauth/callback
```

Für Azure beziehungsweise eine andere öffentliche Umgebung:

```text
https://YOUR_PUBLIC_HOST/oauth/callback
```

Schon ein abweichender Slash oder eine andere Domain führt zu einem OAuth-Fehler.

### Benötigte Scopes

Folgende Scopes müssen in der Atlassian-App tatsächlich aktiviert sein:

```text
read:me
read:space:confluence
read:page:confluence
write:page:confluence
read:content-details:confluence
read:attachment:confluence
write:attachment:confluence
offline_access
```

`offline_access` ist für Refresh Tokens erforderlich. Die Attachment-Scopes werden benötigt, weil das Diagramm als SVG-Datei hochgeladen und anschließend in die Seite eingebettet wird.

### App für weitere Testbenutzer freigeben

Eine neue Atlassian-3LO-App ist zunächst privat. Solange sie in der Developer
Console unter **Distribution** nicht für **Sharing** freigegeben wurde, kann nur
der App-Eigentümer den Autorisierungslink erfolgreich verwenden. Andere
Benutzer erhalten trotz regulärem Confluence-Zugriff die Meldung **You don't
have access to this app**.

Für den kontrollierten PoC-Test:

1. Atlassian Developer Console öffnen und die richtige App auswählen.
2. Unter **Distribution** die Freigabe aktivieren und den Status **Sharing**
   herstellen.
3. Falls Atlassian Angaben wie App-Name, Datenschutzrichtlinie oder
   Nutzungsbedingungen verlangt, diese vollständig hinterlegen.
4. Im Agenten für den Testbenutzer einen neuen Einmal-Link erzeugen lassen und
   die Zustimmung mit dessen eigenem Atlassian-Konto durchführen.

Eine Marketplace-Veröffentlichung ist für diesen direkten Test nicht
erforderlich. Atlassian kann bei einer nicht im Marketplace geprüften App einen
entsprechenden Warnhinweis anzeigen. Zusätzlich können
Organisationsrichtlinien unter **Connected apps** die Installation
benutzerseitiger Apps blockieren. Siehe
[Atlassian: OAuth 2.0 (3LO) apps](https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/)
und
[Atlassian: App-Zugriff installieren und verwalten](https://support.atlassian.com/organization-administration/docs/installing-and-managing-app-access/).

### Ziel-Site und Space

`ATLASSIAN_SITE_URL` enthält nur die Site-URL ohne `/wiki`, zum Beispiel:

```text
https://example.atlassian.net
```

`ATLASSIAN_SPACE_ID` ist die numerische Space-ID, nicht der Space-Key. Beim
OAuth-Callback prüft AutoDocBot, ob die erwartete Site und genau dieser
Ziel-Space für den Benutzer verfügbar sind. Andernfalls wird die Verbindung
nicht gespeichert. Das MCP-Publishing akzeptiert keine abweichende Space-ID und
veröffentlicht ausschließlich in `ATLASSIAN_SPACE_ID`.

Die Einschränkung wird durch AutoDocBot auf Anwendungsebene durchgesetzt. Die
Atlassian-3LO-Scopes selbst sind nicht auf einen einzelnen Space begrenzt und
gelten weiterhin im Rahmen der Confluence-Rechte des Benutzers. Deshalb bleiben
der Schutz des MCP-Servers und seiner Tokens sicherheitsrelevant.

## Konfiguration

| Variable | Erforderlich | Bedeutung |
|---|---:|---|
| `ATLASSIAN_CLIENT_ID` | ja | Client-ID der Atlassian-3LO-App |
| `ATLASSIAN_CLIENT_SECRET` | ja | Secret der Atlassian-3LO-App |
| `ATLASSIAN_SITE_URL` | ja | Ziel-Site ohne abschließendes `/wiki` |
| `ATLASSIAN_SPACE_ID` | ja | einzig zulässige Confluence-Ziel-Space-ID für MCP-Publishing |
| `ATLASSIAN_REDIRECT_URI` | ja | exakt registrierte Atlassian Callback URL |
| `PORT` | nein | HTTP-Port, Standard `3000` |
| `HOST` | nein | Bind-Adresse; lokal `127.0.0.1`, im Container `0.0.0.0` |
| `AUTH_MODE` | nein | `local` oder `entra`; Standard `local` |
| `LOCAL_USER_ID` | lokal | lokale Testidentität |
| `ENTRA_TENANT_ID` | Entra | Tenant-ID, deren Tokens akzeptiert werden |
| `ENTRA_CLIENT_ID` | Entra | Client-ID/Audience der AutoDocBot-API |
| `ENTRA_REQUIRED_SCOPE` | Entra | delegierter Scope, Standard `access_as_user` |
| `ENTRA_ALLOWED_CLIENT_IDS` | Entra | kommaseparierte Allowlist aufrufender Clients, z. B. Copilot-App |
| `PUBLIC_BASE_URL` | produktiv | öffentliche Basis-URL ohne abschließenden Slash |
| `ALLOWED_HOSTS` | nein | zusätzliche, kommaseparierte erlaubte Host-Header |
| `AUTH_LINK_SECRET` | produktiv | Signaturschlüssel für Benutzer-Kontoverknüpfungslinks |
| `TOKEN_ENCRYPTION_KEY` | Entra | Base64-kodierter Schlüssel mit exakt 32 Byte |
| `TOKEN_STORE_PATH` | nein | Pfad zum verschlüsselten Verbindungsspeicher |

Geeignete Produktionsschlüssel lassen sich beispielsweise so erzeugen:

```bash
openssl rand -base64 32  # TOKEN_ENCRYPTION_KEY
openssl rand -base64 48  # AUTH_LINK_SECRET
```

Die Werte gehören in einen Secret Store beziehungsweise in Container-App-Secrets, nicht in YAML oder Git.

## Copilot Studio anbinden

Für den produktiven Zugriff werden typischerweise zwei Entra-App-Registrierungen verwendet.

### 1. API-App für AutoDocBot

1. App-Registrierung für die MCP-API anlegen.
2. Unter **Expose an API** eine Application ID URI konfigurieren, üblicherweise `api://<API-CLIENT-ID>`.
3. Delegierten Scope `access_as_user` anlegen.
4. Im Manifest der API-App `api.requestedAccessTokenVersion` auf `2` setzen. Andernfalls kann Entra bei einer Single-Tenant-App ein v1-Token mit einem abweichenden Issuer ausstellen.
5. Tenant-ID und API-Client-ID als `ENTRA_TENANT_ID` und `ENTRA_CLIENT_ID` konfigurieren.

Alternativ lässt sich die Token-Version mit der Azure CLI setzen:

```bash
az ad app update \
  --id <API-CLIENT-ID> \
  --requested-access-token-version 2
```

Der vollständige Scope lautet dann:

```text
api://<API-CLIENT-ID>/access_as_user
```

### 2. Client-App für Copilot

1. separate App-Registrierung für Copilot anlegen
2. Client Secret erstellen und sicher speichern
3. die delegierte API-Berechtigung `access_as_user` der AutoDocBot-API hinzufügen
4. falls durch die Organisation gefordert, Admin Consent erteilen
5. die Client-ID in `ENTRA_ALLOWED_CLIENT_IDS` aufnehmen
6. die von Copilot Studio angezeigte Redirect URL als Web-Redirect-URI registrieren

### 3. OAuth-Werte in Copilot Studio

```text
Authorization URL:
https://login.microsoftonline.com/<TENANT-ID>/oauth2/v2.0/authorize

Token URL:
https://login.microsoftonline.com/<TENANT-ID>/oauth2/v2.0/token

Scope:
openid profile offline_access api://<API-CLIENT-ID>/access_as_user

MCP endpoint:
https://<PUBLIC-HOST>/mcp
```

Je nach aktueller Copilot-Studio-Oberfläche heißen die Felder leicht anders. Entscheidend sind der delegierte Scope, der richtige Client und die korrekte Redirect URL.

### PoC-Entscheidung zu SSO und Tenant-Grenzen

Der aktuell veröffentlichte PoC verwendet weiterhin die funktionierende,
benutzerbezogene Power-Platform-Verbindung. Der Agent liegt im
Provectus-Standard-Tenant, während Entra-App-Registrierungen und MCP-Server im
Provectus-Lab-Tenant liegen. Power Platform kann diese Cross-Tenant-Verbindung
zulassen, solange passende Lab-Berechtigungen vorhanden sind und keine
Tenant-Isolation sie blockiert. Eine automatische OBO-Anmeldung ist in dieser
Konstellation jedoch nicht als allgemein nutzbar verifiziert.

Der vorbereitete Custom Connector ist deshalb **nicht an den veröffentlichten
Agenten gebunden und nicht produktionsfertig**. Seine importierbare Definition
liegt unter
[`connectors/autodocbot-mcp.swagger.yaml`](connectors/autodocbot-mcp.swagger.yaml).
Sie kann später im Zieltenant als Ausgangspunkt für einen SSO-Connector dienen.

Für den Produktivwechsel sind mindestens folgende Schritte erforderlich:

1. API- und Connector-App im Tenant des produktiven Agenten registrieren oder
   eine bewusst mandantenfähige API-Architektur einführen.
2. `access_as_user`, OBO-Vorautorisierung, Admin Consent und Redirect-URI im
   Zieltenant konfigurieren.
3. Den Custom Connector in der Power-Platform-Umgebung des Agenten importieren,
   testen und für die vorgesehenen Benutzer freigeben.
4. `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` und `ENTRA_ALLOWED_CLIENT_IDS` am
   MCP-Server auf die produktive Identitätskonfiguration umstellen.
5. Mit einem Benutzer ohne Maker-, Admin- oder bestehende Connector-Verbindung
   prüfen, dass die Zustimmung im Chat erfolgt und kein manueller
   Verbindungsmanager benötigt wird.

Der Azure-Container selbst muss dafür nicht zwingend in denselben Tenant
verschoben werden; maßgeblich sind die Tokenaussteller-, Audience- und
Client-Prüfungen.

### Empfohlene Agentenanweisung

Die vollständige kopierfertige Studio-Anweisung steht in
[`docs/copilot-agent-instructions.md`](docs/copilot-agent-instructions.md). Der
MCP-Server liefert die zentralen Regeln zusätzlich als MCP-Serveranweisungen aus.

## Agent bereitstellen und Benutzerzugriff

Das Veröffentlichen in Copilot Studio erzeugt zunächst nur eine veröffentlichte
Version. Damit Benutzer den Agenten tatsächlich öffnen können, muss zusätzlich
ein Kanal aktiviert und eine Zielgruppe freigegeben werden.

### Kontrollierter Pilotbetrieb

1. In Copilot Studio unter **Kanäle** den Kanal **Teams und Microsoft 365
   Copilot** öffnen.
2. Falls gewünscht **Agent in Microsoft 365 Copilot verfügbar machen**
   aktivieren und den Kanal hinzufügen.
3. Den Agenten nach Kanal- oder Authentifizierungsänderungen erneut
   veröffentlichen.
4. In der Freigabeverwaltung einzelne Benutzer oder vorzugsweise eine
   Entra-Sicherheitsgruppe als Chat-/Viewer-Zielgruppe hinzufügen.
5. Unter **Verfügbarkeitsoptionen** den Installationslink kopieren und nur mit
   dieser Zielgruppe teilen.
6. Der Benutzer installiert den Agenten in Teams oder Microsoft 365 Copilot und
   öffnet einen persönlichen Chat.
7. Beim ersten MCP-Toolaufruf stellt der Benutzer im aktuellen PoC seine
   persönliche Power-Platform-Verbindung her. Wegen der Cross-Tenant-Anordnung
   muss er sich dabei mit einer im Lab-Tenant authentifizierbaren Identität
   anmelden. Dieser Schritt entfällt erst nach erfolgreicher Aktivierung einer
   geeigneten produktiven SSO-/OBO-Lösung.
8. Beim ersten Prozessaufruf erhält der Benutzer seinen einmal verwendbaren
   Atlassian-Link und verbindet sein eigenes Konto mit dem fest konfigurierten
   Ziel-Space. Die Atlassian-App muss dafür den Distributionsstatus **Sharing**
   besitzen.

Der Installationslink erteilt allein keine Berechtigung. Der Benutzer muss
zusätzlich für den Agenten freigegeben sein. Installationslinks sind für Teams
Desktop beziehungsweise Web vorgesehen; für eine zuverlässige mobile
Auffindbarkeit sollte der Agent im organisationsinternen App-/Agent-Store
bereitgestellt werden.

### Organisationsweite Bereitstellung

Über **Verfügbarkeitsoptionen → Für alle in meiner Organisation anzeigen** kann
der Agent zur Administratorfreigabe eingereicht werden. Im Microsoft 365 Admin
Center legt ein Administrator anschließend fest:

- **Available to:** Wer den Agenten finden und selbst installieren darf.
- **Deployed to:** Für wen der Agent zentral ausgerollt wird.

Für einen ersten Rollout wird eine kleine Pilotgruppe empfohlen. Erst nach
erfolgreichen Tests von Benutzerzugriff, individueller Atlassian-Autorisierung,
Ziel-Space-Rechten, Vorschau und Publishing sollte die Zielgruppe erweitert
werden.

Aktuelle Microsoft-Dokumentation:

- [Agent mit Teams und Microsoft 365 Copilot verbinden](https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-add-bot-to-microsoft-teams)
- [Verfügbarkeit für Benutzer und Gruppen steuern](https://learn.microsoft.com/en-us/microsoft-365/copilot/agent-essentials/agent-lifecycle/agent-availability)

### Aktuelle Mandantengrenze

Der **Gesamtaufbau ist aktuell Cross-Tenant**: Teams, Copilot und der Agent
liegen im Provectus-Standard-Tenant; die Entra-Apps und der MCP-Server sind dem
Provectus-Lab-Tenant zugeordnet. Der MCP-Server selbst arbeitet dennoch mit
einer **festen Single-Tenant-Vertrauensgrenze**: Er akzeptiert ausschließlich
Entra-Tokens aus `ENTRA_TENANT_ID` und nur von Clients aus
`ENTRA_ALLOWED_CLIENT_IDS`. Zusätzlich ist genau eine Atlassian-Site und ein
Ziel-Space konfiguriert.

Damit funktioniert der PoC für freigegebene Benutzer, die sowohl den Agenten im
Standard-Tenant verwenden als auch die persönliche MCP-Verbindung im Lab-Tenant
herstellen können. Daraus folgt **keine** allgemeine Eignung für beliebige
externe oder reine Kundenidentitäten. Für ein Kundenprodukt wären mindestens
eine Multi-Tenant-Identitätsstrategie oder getrennte Kunden-Deployments,
mandantenspezifische Atlassian-Konfigurationen, isolierte Secrets und Stores
sowie ein administratives On-/Offboarding erforderlich.

## Container und Azure-Deployment

### Docker lokal

```bash
docker build -t autodocbot-v2:0.1.6 .
docker run --rm -p 3000:3000 --env-file .env autodocbot-v2:0.1.6
```

Das Multi-Stage-Dockerfile kompiliert TypeScript im Build-Image und übernimmt nur Produktionsabhängigkeiten sowie `dist/` in das Runtime-Image. Der Prozess läuft als unprivilegierter Benutzer `node`.

### Benötigte Azure-Ressourcen

- Azure Container Registry für das Image
- Azure Container Apps Environment
- Azure Container App mit externer HTTPS-Ingress-Regel auf Port 3000
- Storage Account und Azure File Share für `connections.json`
- Log Analytics Workspace
- verwaltete Identität der Container App mit Pull-Zugriff auf die Registry

Ein beispielhafter Aufbau:

```bash
RG=your-resource-group
LOCATION=westeurope
ACR=youruniqueregistry
STORAGE=youruniquestorage
ENVIRONMENT=cae-autodocbot-v2
APP=autodocbot-v2

az acr create -g "$RG" -n "$ACR" --sku Basic --admin-enabled false
az storage account create -g "$RG" -n "$STORAGE" -l "$LOCATION" --sku Standard_LRS --min-tls-version TLS1_2
az storage share-rm create -g "$RG" --storage-account "$STORAGE" --name autodocbot-tokenstore --quota 1
az containerapp env create -g "$RG" -n "$ENVIRONMENT" -l "$LOCATION"
az acr build -r "$ACR" -t autodocbot-v2:0.1.6 .
```

Danach wird der File Share im Container-Apps-Environment registriert:

```bash
STORAGE_KEY=$(az storage account keys list -g "$RG" -n "$STORAGE" --query '[0].value' -o tsv)

az containerapp env storage set \
  -g "$RG" \
  -n "$ENVIRONMENT" \
  --storage-name tokenstore \
  --access-mode ReadWrite \
  --azure-file-account-name "$STORAGE" \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name autodocbot-tokenstore
```

Die Container App benötigt anschließend:

- Image `<ACR>.azurecr.io/autodocbot-v2:0.1.6`
- externe Ingress-Regel, Zielport `3000`
- `AUTH_MODE=entra`
- alle Entra- und Atlassian-Werte aus der Konfigurationstabelle
- Secrets für `ATLASSIAN_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` und `AUTH_LINK_SECRET`
- `TOKEN_STORE_PATH=/data/connections.json`
- Azure-File-Mount `tokenstore` auf `/data`
- für diesen PoC genau eine Replica, weil Vorschauen und OAuth-State im Arbeitsspeicher liegen

[`azure/containerapp-volume.yaml`](azure/containerapp-volume.yaml) zeigt die erwarteten Environment- und Volume-Strukturen. Vor der Verwendung müssen alle `YOUR_...`-Platzhalter und der Registry-Name ersetzt werden. Geheimniswerte werden als Container-App-Secrets angelegt und nur über `secretRef` referenziert.

Nach dem Deployment müssen `PUBLIC_BASE_URL`, `ALLOWED_HOSTS` und `ATLASSIAN_REDIRECT_URI` den tatsächlichen Container-App-Host enthalten. Anschließend ist dieselbe öffentliche Callback URL auch in der Atlassian Developer Console einzutragen.

### Deployment prüfen

```bash
curl https://<PUBLIC-HOST>/healthz
curl https://<PUBLIC-HOST>/.well-known/oauth-protected-resource
```

Ein nicht authentifizierter `POST` auf `/mcp` muss im Entra-Modus mit `401` und einem `WWW-Authenticate`-Header antworten. Ein öffentlich erreichbares MCP ohne Authentifizierung ist kein erfolgreicher Produktionscheck.

## Tests und Qualitätsprüfungen

```bash
npm run typecheck
npm run build
npm run check:styleguide
npm run check:quality-review
npm run check:account-link
npm run check:token-store
```

Der MCP-Test benötigt einen laufenden lokalen Server auf Port 3000:

```bash
npm run dev
# in einem zweiten Terminal
npm run test:mcp
```

`test:mcp` prüft Tool Discovery, Verbindungsstatus und Vorschauerzeugung. Der Test veröffentlicht keine Confluence-Seite.

| Script | Prüfung |
|---|---|
| `npm run typecheck` | TypeScript ohne Ausgabe kompilierbar |
| `npm run build` | Produktionsartefakte in `dist/` erzeugen |
| `npm run check:styleguide` | ArticleSpec, Overrides, Terminologie, sicheres Rendering und Diagrammposition |
| `npm run check:quality-review` | explizite Widersprüche, unbestimmte Fristen und fehlende Verantwortlichkeiten |
| `npm run check:account-link` | Signatur, Ablauf und Einmalnutzung der Atlassian-Kontoverknüpfungslinks |
| `npm run check:token-store` | Verschlüsselung, erneutes Laden und Löschen des Stores |
| `npm run test:mcp` | MCP-Verbindung, erwartete Tools und nicht publizierende Vorschau |

## HTTP-Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/healthz` | Healthcheck und aktiver Auth-Modus |
| `GET` | `/.well-known/oauth-protected-resource` | OAuth Protected Resource Metadata im Entra-Modus |
| `POST` | `/mcp` | MCP Streamable HTTP |
| `GET` | `/` | lokale PoC-Startseite |
| `GET` | `/oauth/start` | Atlassian-3LO starten |
| `GET` | `/oauth/callback` | Atlassian OAuth Callback |
| `POST` | `/create-test-page` | lokale manuelle Testseite |
| `POST` | `/create-diagram-page` | lokale Diagramm-Testseite |
| `GET` | `/article-preview` | lokale Beispielvorschau |
| `POST` | `/publish-article` | lokale Veröffentlichung der Beispielvorschau |

Die manuellen HTML-Testendpunkte sind PoC-Hilfen und stehen ausschließlich bei
`AUTH_MODE=local` zur Verfügung. Im Entra-Modus antworten sie einschließlich der
Startseite `/` mit `404`. Für die Copilot-Integration ist ausschließlich `/mcp`
vorgesehen; `/oauth/start` und `/oauth/callback` werden nur für die
Atlassian-Kontoverknüpfung benötigt.

## Fehlerbehebung

### Atlassian zeigt `You don't have access to this app`

Wenn der Benutzer Confluence direkt öffnen kann, aber der OAuth-Link diese
Meldung zeigt, ist meist nicht der Space-Zugriff die Ursache. Prüfe in der
Atlassian Developer Console zuerst **Distribution**: Die 3LO-App muss für
weitere Benutzer auf **Sharing** stehen. Danach einen neuen Einmal-Link aus dem
Agenten verwenden. Bleibt der Fehler bestehen, müssen Atlassian-Administratoren
prüfen, ob eine Organisationsrichtlinie unter **Connected apps**
benutzerinstallierte Apps blockiert.

### Persönliche MCP-Verbindung kann nicht hergestellt werden

Im aktuellen Cross-Tenant-PoC muss der Benutzer beim ersten Toolaufruf eine
persönliche Power-Platform-Verbindung mit einer im Lab-Tenant
authentifizierbaren Identität herstellen. Meldungen, nach denen die
Standard-Umgebung in diesem Tenant nicht gefunden wurde, weisen meist auf eine
Vermischung von Standard- und Lab-Tenant hin. Der vorbereitete Custom Connector
löst das im PoC noch nicht automatisch; er bleibt bis zum Produktivwechsel
inaktiv. Redirect-URIs müssen exakt der aktuell von Power Platform angezeigten
URL entsprechen.

### Atlassian meldet nicht aktivierte Scopes

Die Scopes müssen nicht nur im Authorization Request stehen, sondern in der Developer Console bei der richtigen API aktiviert sein. Besonders häufig fehlen `read:page:confluence`, `write:page:confluence` oder `read:space:confluence`. Nach Scope-Änderungen ist eine erneute Zustimmung erforderlich.

### `Could not create content with type page`

AutoDocBot verwendet die Confluence REST API v2 und sendet beim Erstellen `spaceId`, `status`, `title` und `body`. Bei eigenen Erweiterungen darf nicht das alte v1-Format mit einem ungeeigneten Content-Type-Payload vermischt werden.

### OAuth Callback oder State ungültig

- Callback URL in Atlassian und `ATLASSIAN_REDIRECT_URI` exakt vergleichen
- OAuth innerhalb von zehn Minuten abschließen
- Server während des OAuth-Flows nicht neu starten
- im Entra-Modus den Link aus `get_confluence_connection` verwenden

### MCP antwortet mit `401 invalid_token`

Prüfen:

- Access Token statt ID Token gesendet
- Audience entspricht `ENTRA_CLIENT_ID`
- `scp` enthält `ENTRA_REQUIRED_SCOPE`
- `tid` entspricht `ENTRA_TENANT_ID`
- `azp`/`appid` steht in `ENTRA_ALLOWED_CLIENT_IDS`
- Token stammt vom v2.0-Issuer des richtigen Tenants
- bei `unexpected "iss" claim value`: `api.requestedAccessTokenVersion=2` an der API-App setzen und die Copilot-OAuth-Verbindung neu erstellen

### MCP antwortet mit `403 Invalid Host header`

`PUBLIC_BASE_URL` muss dem aufgerufenen Host entsprechen. Zusätzliche Reverse-Proxy-Hosts können kommasepariert über `ALLOWED_HOSTS` freigegeben werden.

### `TOKEN_ENCRYPTION_KEY muss 32 Byte ... enthalten`

Der dekodierte Wert muss exakt 32 Byte lang sein. Einen passenden Wert erzeugt `openssl rand -base64 32`.

### Verbindung verschwindet nach Container-Neustart

Prüfen, ob `TOKEN_STORE_PATH=/data/connections.json` gesetzt und ein beschreibbarer Azure File Share auf `/data` gemountet ist. Außerdem muss nach einem Neustart derselbe `TOKEN_ENCRYPTION_KEY` verwendet werden.

### Seite wird erstellt, Diagramm fehlt

Die Veröffentlichung erfolgt in drei API-Schritten: Seite erstellen, SVG hochladen, Seite aktualisieren. Prüfe Attachment-Scopes, Schreibrechte, Container-Logs und eine mögliche Teilstörung zwischen diesen Schritten.

### Autor ist nicht der erwartete Benutzer

AutoDocBot verwendet das Atlassian-3LO-Token der zugehörigen MCP-Benutzeridentität. Prüfe, welches Atlassian-Konto den Verknüpfungsdialog bestätigt hat. Die Publishing-Antwort enthält zusätzlich `attributionConfirmed`, sofern Confluence die Author-ID der neuen Version liefert.

Zurück zur [Projektdokumentation](README.md).
