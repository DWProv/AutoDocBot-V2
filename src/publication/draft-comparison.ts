import type { PublicationPage } from "./confluence-api.js";

/** Ignore only a generated UUID on the built-in info macro. Keep all content,
 * macro parameters, links, formatting, other attributes and macros byte-exact.
 * In particular, never strip text that merely looks like markup inside CDATA.
 */
function comparableStorage(body: string): string | undefined {
  let offset = 0, result = "";
  while (offset < body.length) {
    const start = body.indexOf("<", offset);
    if (start === -1) return result + body.slice(offset);
    result += body.slice(offset, start);
    const special = body.startsWith("<![CDATA[", start) ? [9, "]]>" ] as const
      : body.startsWith("<!--", start) ? [4, "-->"] as const : undefined;
    if (special) {
      const end = body.indexOf(special[1], start + special[0]);
      if (end === -1) return undefined;
      result += body.slice(start, end + special[1].length);
      offset = end + special[1].length;
      continue;
    }
    if (body.startsWith("<!", start) || body.startsWith("<?", start)) return undefined;
    let quote = "", end = start + 1;
    for (; end < body.length; end++) {
      const char = body[end]!;
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
      else if (char === "<") return undefined;
    }
    if (end === body.length || quote) return undefined;
    let tag = body.slice(start, end + 1);
    if (/^<ac:structured-macro\s/u.test(tag)) {
      const attributes: Array<{ name: string; value: string; valueStart: number; valueEnd: number }> = [];
      const names = new Set<string>();
      let index = "<ac:structured-macro".length;
      while (index < tag.length) {
        const tail = tag.slice(index);
        if (/^\s*\/?>$/u.test(tail)) break;
        const match = /^(\s+)([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\3/su.exec(tail);
        if (!match || names.has(match[2]!)) return undefined;
        names.add(match[2]!);
        const valueStart = index + match[0].indexOf(match[3]!) + 1;
        attributes.push({ name: match[2]!, value: match[4]!, valueStart, valueEnd: valueStart + match[4]!.length });
        index += match[0].length;
      }
      const name = attributes.find(a => a.name === "ac:name");
      const id = attributes.find(a => a.name === "ac:macro-id");
      if (name?.value === "info" && id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id.value)) {
        tag = tag.slice(0, id.valueStart) + "AUTODOCBOT_GENERATED_INFO_UUID" + tag.slice(id.valueEnd);
      }
    }
    result += tag;
    offset = end + 1;
  }
  return result;
}

export function isUnchangedDraft(current: PublicationPage, draft: PublicationPage): boolean {
  if (current.status !== "current" || draft.status !== "draft" || current.id !== draft.id ||
    current.spaceId !== draft.spaceId || current.title !== draft.title || current.ownerId !== draft.ownerId ||
    current.parentId !== draft.parentId || current.parentType !== draft.parentType) return false;
  const a = current.body?.storage?.value, b = draft.body?.storage?.value;
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a === b) return true;
  const left = comparableStorage(a), right = comparableStorage(b);
  return left !== undefined && right !== undefined && left === right;
}
