import assert from "node:assert/strict";
import { isUnchangedDraft } from "./draft-comparison.js";
import type { PublicationPage } from "./confluence-api.js";

const uuidA = "ab0972ba-2b48-4120-82b0-a7e0f38df940", uuidB = "36bde395-5085-4786-a59e-134e954d0c0f";
const body = `<ac:structured-macro ac:name="info" ac:schema-version="1" ac:macro-id="${uuidA}"><ac:parameter ac:name="title">Titel</ac:parameter><ac:rich-text-body><p>Prozess mit <a href="https://test.invalid">Link</a>.</p><ac:image><ri:attachment ri:filename="diagram.svg"/></ac:image></ac:rich-text-body></ac:structured-macro>`;
const current: PublicationPage = { id: "42", status: "current", spaceId: "space", title: "Testartikel", ownerId: "owner", parentId: "parent", parentType: "page", version: { number: 3 }, body: { storage: { value: body } } };
const draft: PublicationPage = { ...structuredClone(current), status: "draft", version: { number: 1 } };
let count = 0;
const check = (name: string, page: PublicationPage, expected: boolean, base = current) => {
  assert.equal(isUnchangedDraft(base, page), expected, name); count++;
};
const withBody = (value: string): PublicationPage => ({ ...draft, body: { storage: { value } } });
check("Gleicher Inhalt trotz eigenständigem Entwurfszähler", draft, true);
check("Nur generierte Info-Makro-UUID abweichend", withBody(body.replace(uuidA, uuidB)), true);
for (const [name, value] of [
  ["Text", body.replace("Prozess mit", "Anderer Prozess mit")],
  ["Parameter", body.replace(">Titel<", ">Neuer Titel<")],
  ["Link", body.replace("https://test.invalid", "https://other.invalid")],
  ["Anhang", body.replace("diagram.svg", "other.svg")],
  ["Formatierung", body.replace("<p>", "<p style=\"color:red\">")],
  ["Schema-Version", body.replace('ac:schema-version="1"', 'ac:schema-version="2"')],
  ["local-id", body.replace('ac:name="info"', 'ac:name="info" ac:local-id="new"')],
  ["UUID fehlt", body.replace(` ac:macro-id="${uuidA}"`, "")],
  ["Keine UUID", body.replace(uuidA, "manuell")],
  ["Leerraum im Text", body.replace("Prozess mit", "Prozess  mit")],
] as const) check(`Echte Änderung (${name}) trotz zusätzlich veränderter Info-UUID`, withBody(value.replace(uuidA, uuidB)), false);
for (const change of [{ id: "other" }, { spaceId: "other" }, { title: "Anderer Titel" }, { ownerId: "other" }, { parentId: "other" }, { parentType: "folder" }, { status: "current" }, { body: undefined }]) {
  check(`Seitenmetadaten ${Object.keys(change)[0]} geändert`, { ...draft, ...change }, false);
}
const foreign = body.replace('ac:name="info"', 'ac:name="third-party-macro"');
check("UUID fremder Makros bleibt geschützt", withBody(foreign.replace(uuidA, uuidB)), false, { ...current, body: { storage: { value: foreign } } });
for (const [start, end] of [["<![CDATA[", "]]>"], ["<!--", "-->"]] as const) {
  const raw = start + body + end;
  check("Markup in CDATA/Kommentar ist Inhalt", withBody(raw.replace(uuidA, uuidB)), false, { ...current, body: { storage: { value: raw } } });
}
for (const raw of ["<![CDATA[" + body, '<!DOCTYPE root><root>' + body, body.replace('ac:name="info"', 'ac:name="info" ac:name="info"'), body.replace("</ac:rich-text-body>", '<bad attr="')]) {
  check("Nicht sicher parsebarer Vergleich blockiert", withBody(raw.replace(uuidA, uuidB)), false, { ...current, body: { storage: { value: raw } } });
}
const quoted = body.replace('ac:schema-version="1"', 'ac:schema-version="1" data-note="a>b"');
check("Größer-Zeichen in Attributen sicher behandelt", withBody(quoted.replace(uuidA, uuidB)), true, { ...current, body: { storage: { value: quoted } } });
console.log(`${count} Prüfungen zum Restentwurfsvergleich erfolgreich: nur generierte Info-UUID wird ignoriert; echte Änderungen bleiben geschützt.`);
