import { z } from "zod";

const optionalSectionSchema = z.enum([
  "definitions",
  "systems",
  "risksAndControls",
  "metrics",
  "changeHistory",
]);

const headingKeySchema = z.enum([
  "summary",
  "purpose",
  "scope",
  "roles",
  "prerequisites",
  "process",
  "exceptions",
  "relatedLinks",
  "diagram",
]);

export const styleOverridesSchema = z
  .object({
    tone: z.enum(["formal", "neutral", "concise", "friendly"]).optional(),
    audience: z
      .enum(["general", "expert", "management", "operations"])
      .optional(),
    detailLevel: z.enum(["compact", "standard", "detailed"]).optional(),
    addressForm: z.enum(["neutral", "du", "sie"]).optional(),
    diagramDirection: z.enum(["top-down", "left-right"]).optional(),
    includeOptionalSections: z.array(optionalSectionSchema).max(5).optional(),
    terminology: z
      .record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(80))
      .refine((entries) => Object.keys(entries).length <= 25, {
        message: "Maximal 25 Terminologie-Anpassungen sind erlaubt.",
      })
      .optional(),
    headingLabels: z
      .partialRecord(headingKeySchema, z.string().trim().min(2).max(80))
      .optional(),
  })
  .strict();

export type StyleOverrides = z.infer<typeof styleOverridesSchema>;

export type ResolvedStyleGuide = {
  version: string;
  language: "de-DE";
  tone: "formal" | "neutral" | "concise" | "friendly";
  audience: "general" | "expert" | "management" | "operations";
  detailLevel: "compact" | "standard" | "detailed";
  addressForm: "neutral" | "du" | "sie";
  diagramDirection: "top-down" | "left-right";
  includeOptionalSections: Array<z.infer<typeof optionalSectionSchema>>;
  terminology: Record<string, string>;
  headingLabels: Record<z.infer<typeof headingKeySchema>, string>;
  enforcedRules: {
    diagramIsLastSection: true;
    doNotInventFacts: true;
    activeVoice: true;
    oneActionPerStep: true;
    explicitRoles: true;
    userHtmlForbidden: true;
  };
};

export const baseStyleGuide: ResolvedStyleGuide = {
  version: "1.0.0",
  language: "de-DE",
  tone: "neutral",
  audience: "general",
  detailLevel: "standard",
  addressForm: "neutral",
  diagramDirection: "top-down",
  includeOptionalSections: [],
  terminology: {
    Mitarbeiter: "Mitarbeitende",
    Mitarbeiterinnen: "Mitarbeitende",
  },
  headingLabels: {
    summary: "Kurzbeschreibung",
    purpose: "Zweck",
    scope: "Geltungsbereich",
    roles: "Rollen und Verantwortlichkeiten",
    prerequisites: "Voraussetzungen",
    process: "Prozessablauf",
    exceptions: "Ausnahmen und Eskalationen",
    relatedLinks: "Mitgeltende Dokumente",
    diagram: "Prozessdiagramm",
  },
  enforcedRules: {
    diagramIsLastSection: true,
    doNotInventFacts: true,
    activeVoice: true,
    oneActionPerStep: true,
    explicitRoles: true,
    userHtmlForbidden: true,
  },
};

export function resolveStyleGuide(
  overrides: StyleOverrides | undefined,
): ResolvedStyleGuide {
  const parsed = styleOverridesSchema.parse(overrides ?? {});
  return {
    ...baseStyleGuide,
    ...parsed,
    includeOptionalSections:
      parsed.includeOptionalSections ?? baseStyleGuide.includeOptionalSections,
    terminology: {
      ...baseStyleGuide.terminology,
      ...parsed.terminology,
    },
    headingLabels: {
      ...baseStyleGuide.headingLabels,
      ...parsed.headingLabels,
    },
    enforcedRules: baseStyleGuide.enforcedRules,
  };
}

export function buildAgentStyleInstructions(style: ResolvedStyleGuide): string {
  const tones = {
    formal: "formell und präzise",
    neutral: "sachlich, klar und professionell",
    concise: "knapp und handlungsorientiert",
    friendly: "zugänglich und freundlich, aber professionell",
  } as const;
  const audiences = {
    general: "fachlich gemischte Leserschaft",
    expert: "Fachpublikum mit vorhandenem Domänenwissen",
    management: "Management mit Fokus auf Zweck, Verantwortung und Kontrolle",
    operations: "operativ ausführende Personen mit Fokus auf konkrete Schritte",
  } as const;

  return [
    `Schreibe auf Deutsch (${style.language}) und ${tones[style.tone]}.`,
    `Zielgruppe: ${audiences[style.audience]}.`,
    `Detailgrad: ${style.detailLevel}. Anredeform: ${style.addressForm}.`,
    "Verwende aktive Formulierungen, eindeutige Rollen und genau eine Hauptaktion pro Prozessschritt.",
    "Erfinde keine Fakten, Systeme, Verantwortlichkeiten, Fristen oder Ausnahmen. Markiere fehlende Angaben für eine Rückfrage.",
    `Verwende diese Terminologie: ${Object.entries(style.terminology)
      .map(([source, target]) => `${source} → ${target}`)
      .join(", ")}.`,
  ].join("\n");
}
