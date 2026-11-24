import { z } from "zod";
import { styleOverridesSchema } from "./styleguide.js";

export const articleSpecSchema = z.object({
  title: z.string().trim().min(5).max(140),
  summary: z.string().trim().min(10).max(600),
  purpose: z.string().trim().min(10).max(2_000),
  scope: z.string().trim().min(5).max(2_000),
  roles: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(100),
        responsibility: z.string().trim().min(5).max(500),
      }),
    )
    .min(1)
    .max(30),
  prerequisites: z.array(z.string().trim().min(2).max(500)).max(30).default([]),
  steps: z
    .array(
      z.object({
        number: z.number().int().min(1),
        actor: z.string().trim().min(2).max(100),
        action: z.string().trim().min(5).max(1_000),
        result: z.string().trim().min(2).max(1_000),
        decision: z.string().trim().min(2).max(500).optional(),
        decisionBranches: z.array(z.object({
          label: z.string().trim().min(1).max(150),
          target: z.discriminatedUnion("type", [
            z.object({ type: z.literal("step"), number: z.number().int().min(1) }),
            z.object({ type: z.literal("exception"), number: z.number().int().min(1) }),
            z.object({ type: z.literal("end") }),
          ]),
        })).min(1).max(12).optional(),
        nextStep: z.number().int().min(1).optional(),
        endsProcess: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(50),
  exceptions: z
    .array(
      z.object({
        condition: z.string().trim().min(3).max(500),
        handling: z.string().trim().min(3).max(1_000),
        stepNumber: z.number().int().min(1).optional(),
        nextStep: z.number().int().min(1).optional(),
        endsProcess: z.boolean().optional(),
      }),
    )
    .max(30)
    .default([]),
  relatedLinks: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(150),
        url: z.url(),
      }),
    )
    .max(30)
    .default([]),
  metadata: z
    .object({
      owner: z.string().trim().min(2).max(150).optional(),
      department: z.string().trim().min(2).max(150).optional(),
      reviewDate: z.iso.date().optional(),
    })
    .default({}),
  optionalContent: z
    .object({
      definitions: z
        .array(
          z.object({
            term: z.string().trim().min(1).max(150),
            definition: z.string().trim().min(3).max(1_000),
          }),
        )
        .max(30)
        .optional(),
      systems: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(150),
            purpose: z.string().trim().min(3).max(1_000),
          }),
        )
        .max(30)
        .optional(),
      risksAndControls: z
        .array(
          z.object({
            risk: z.string().trim().min(3).max(1_000),
            control: z.string().trim().min(3).max(1_000),
          }),
        )
        .max(30)
        .optional(),
      metrics: z
        .array(
          z.object({
            name: z.string().trim().min(2).max(150),
            target: z.string().trim().min(1).max(500),
          }),
        )
        .max(30)
        .optional(),
      changeHistory: z
        .array(
          z.object({
            date: z.iso.date(),
            change: z.string().trim().min(3).max(1_000),
            author: z.string().trim().min(2).max(150),
          }),
        )
        .max(30)
        .optional(),
    })
    .default({}),
  style: styleOverridesSchema.optional(),
});

export type ArticleSpec = z.infer<typeof articleSpecSchema>;

export function validateArticleSpec(input: unknown): ArticleSpec {
  const spec = articleSpecSchema.parse(input);
  const expectedNumbers = spec.steps.map((_, index) => index + 1);
  const actualNumbers = spec.steps.map((step) => step.number);

  if (actualNumbers.some((number, index) => number !== expectedNumbers[index])) {
    throw new Error("Prozessschritte müssen lückenlos bei 1 beginnen.");
  }

  const checkStep = (number: number | undefined, context: string) => {
    if (number !== undefined && !actualNumbers.includes(number)) {
      throw new Error(`${context}: Schritt ${number} existiert nicht.`);
    }
  };
  for (const step of spec.steps) {
    checkStep(step.nextStep, `Schritt ${step.number}`);
    if (step.nextStep !== undefined && step.endsProcess) {
      throw new Error(`Schritt ${step.number}: Fortsetzung und Prozessende widersprechen sich.`);
    }
    if (step.decision && (step.nextStep !== undefined || step.endsProcess)) {
      throw new Error(`Schritt ${step.number}: Ziele einer Entscheidung gehören in decisionBranches.`);
    }
    if (step.decisionBranches && !step.decision) {
      throw new Error(`Schritt ${step.number}: Entscheidungszweige benötigen eine Entscheidung.`);
    }
    const labels = new Set<string>();
    for (const branch of step.decisionBranches ?? []) {
      const label = branch.label.toLocaleLowerCase("de-DE");
      if (labels.has(label)) throw new Error(`Schritt ${step.number}: Zweigbeschriftungen müssen eindeutig sein.`);
      labels.add(label);
      if (branch.target.type === "step") checkStep(branch.target.number, `Zweig ${branch.label}`);
      if (branch.target.type === "exception" && !spec.exceptions[branch.target.number - 1]) {
        throw new Error(`Zweig ${branch.label}: Ausnahme ${branch.target.number} existiert nicht.`);
      }
    }
  }
  for (const [index, exception] of spec.exceptions.entries()) {
    checkStep(exception.stepNumber, `Ausnahme ${index + 1}`);
    checkStep(exception.nextStep, `Ausnahme ${index + 1}`);
    if (exception.nextStep !== undefined && exception.endsProcess) {
      throw new Error(`Ausnahme ${index + 1}: Fortsetzung und Prozessende widersprechen sich.`);
    }
  }

  return spec;
}
