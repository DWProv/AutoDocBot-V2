# AutoDocBot V2

Dieser lokale Test weist nach, dass eine Confluence-Seite mit Atlassian OAuth 2.0 (3LO) im Namen des angemeldeten Benutzers erstellt wird.

## Einrichtung

1. In `.env` die `ATLASSIAN_CLIENT_ID` und das `ATLASSIAN_CLIENT_SECRET` aus der Atlassian Developer Console eintragen.
2. In der Developer Console muss als Callback exakt `http://localhost:3000/oauth/callback` hinterlegt sein.
3. Benötigte Scopes: `read:me`, `read:space:confluence`, `read:page:confluence`, `write:page:confluence`, `read:content-details:confluence`, `read:attachment:confluence`, `write:attachment:confluence` und `offline_access`.
4. Abhängigkeiten installieren und Server starten:

   ```bash
   npm install
   npm run dev
   ```

5. `http://localhost:3000` öffnen und den Schritten im Browser folgen.

Tokens werden für diesen Spike ausschließlich im Arbeitsspeicher gehalten und gehen beim Neustart verloren.

## Lokaler MCP-Endpunkt

Der Streamable-HTTP-Endpunkt läuft unter `http://localhost:3000/mcp` und bietet:

- `get_confluence_connection`
- `get_article_styleguide`
- `preview_process_article`
- `publish_process_article`

Der lokale Protokolltest erzeugt nur eine Vorschau und veröffentlicht nichts:

```bash
npm run test:mcp
```

## MCP-Authentifizierung

`AUTH_MODE=local` verwendet für lokale Tests die ID aus `LOCAL_USER_ID`. Mit `AUTH_MODE=entra` validiert der MCP-Endpunkt Entra-v2-Access-Tokens einschließlich Signatur, Issuer, Audience, Tenant, Benutzerobjekt, delegiertem Scope und aufrufender Client-Anwendung (`azp`). Erlaubte Client-IDs werden kommasepariert über `ENTRA_ALLOWED_CLIENT_IDS` konfiguriert.

Im Entra-Modus stellt `/.well-known/oauth-protected-resource` die MCP-OAuth-Metadaten nach RFC 9728 bereit. Nicht autorisierte MCP-Aufrufe verweisen über `WWW-Authenticate` auf dieses Dokument.

Atlassian-Verbindungen werden pro MCP-Benutzer AES-256-GCM-verschlüsselt gespeichert. Im lokalen Modus erzeugt der Server dafür einen ignorierten Schlüssel unter `.local/`. Im Entra-Modus muss `TOKEN_ENCRYPTION_KEY` als Base64-kodierter 32-Byte-Schlüssel gesetzt werden.

Der Token Store lässt sich unabhängig prüfen:

```bash
npm run check:token-store
```

## Container

Das Multi-Stage-Dockerfile kompiliert TypeScript und startet nur die Produktionsabhängigkeiten. Der Container lauscht auf Port 3000 und stellt `GET /healthz` bereit. `.env`, lokale Tokens und Git-Daten werden nicht in das Image kopiert.
