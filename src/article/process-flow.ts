import type { ArticleSpec } from "./article-spec.js";

export function describeStepFlow(step: ArticleSpec["steps"][number]): string {
  const branches = (step.decisionBranches ?? []).map(({ label, target }) =>
    `${label} → ${target.type === "end" ? "Prozessende" : `${target.type === "step" ? "Schritt" : "Ausnahme"} ${target.number}`}`);
  return [step.decision, ...branches,
    step.decision && !branches.length ? "Ausgänge nicht angegeben" : "",
    step.nextStep !== undefined ? `Weiter zu Schritt ${step.nextStep}` : "",
    step.endsProcess ? "Prozessende" : ""].filter(Boolean).join("; ");
}

export function describeExceptionFlow(exception: ArticleSpec["exceptions"][number]): string {
  return [exception.stepNumber !== undefined ? `Bei Schritt ${exception.stepNumber}` : "",
    exception.nextStep !== undefined ? `Weiter zu Schritt ${exception.nextStep}` : exception.endsProcess
      ? "Prozessende" : "Fortsetzung nicht angegeben"].filter(Boolean).join("; ");
}
