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
      }),
    )
    .min(1)
    .max(50),
  exceptions: z
    .array(
      z.object({
        condition: z.string().trim().min(3).max(500),
        handling: z.string().trim().min(3).max(1_000),
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

  return spec;
}
