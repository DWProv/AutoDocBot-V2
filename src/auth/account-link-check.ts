import { OneTimeAccountLinkStore } from "./account-link.js";

const links = new OneTimeAccountLinkStore("test-secret");
const link = links.create("tenant:user");
if (links.consume(link) !== "tenant:user") {
  throw new Error("Der Link wurde nicht der erwarteten Identität zugeordnet.");
}

let replayBlocked = false;
try {
  links.consume(link);
} catch {
  replayBlocked = true;
}
if (!replayBlocked) {
  throw new Error("Ein bereits verwendeter Link konnte erneut verwendet werden.");
}

const freshLink = links.create("tenant:user");
const [freshPayload, freshSignature] = freshLink.split(".");
if (!freshPayload || !freshSignature) {
  throw new Error("Der Test-Link besitzt kein gültiges Format.");
}
const tamperedSignature = `${freshSignature.startsWith("a") ? "b" : "a"}${freshSignature.slice(1)}`;
const tampered = `${freshPayload}.${tamperedSignature}`;
let tamperingBlocked = false;
try {
  links.consume(tampered);
} catch {
  tamperingBlocked = true;
}
if (!tamperingBlocked) {
  throw new Error("Ein manipulierter Link wurde akzeptiert.");
}

const superseded = links.create("tenant:second-user");
const current = links.create("tenant:second-user");
let supersededBlocked = false;
try {
  links.consume(superseded);
} catch {
  supersededBlocked = true;
}
if (!supersededBlocked || links.consume(current) !== "tenant:second-user") {
  throw new Error("Ein ersetzter Link blieb weiterhin aktiv.");
}

const expiredLinks = new OneTimeAccountLinkStore("test-secret", -1);
const expired = expiredLinks.create("tenant:user");
let expirationBlocked = false;
try {
  expiredLinks.consume(expired);
} catch {
  expirationBlocked = true;
}
if (!expirationBlocked) {
  throw new Error("Ein abgelaufener Link wurde akzeptiert.");
}

console.log("Einmalige Kontoverknüpfungslinks erfolgreich geprüft.");
