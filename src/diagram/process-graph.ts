import type { ArticleSpec } from "../article/article-spec.js";

export type ProcessNode = {
  id: string;
  kind: "step" | "decision" | "exception" | "terminal" | "unknown";
  heading: string;
  text: string;
  note?: string;
};
export type ProcessEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: "normal" | "exception" | "unknown";
};

export function buildProcessGraph(spec: ArticleSpec) {
  const nodes: ProcessNode[] = [{ id: "start", kind: "terminal", heading: "Start", text: "" }];
  const edges: ProcessEdge[] = [];
  const warnings: string[] = [];
  const action = (n: number) => `step-${n}`;
  const decision = (n: number) => `decision-${n}`;
  const exceptionId = (n: number) => `exception-${n}`;
  const edge = (from: string, to: string, label = "", kind: ProcessEdge["kind"] = "normal") => {
    edges.push({ id: `edge-${edges.length + 1}`, from, to, label, kind });
  };
  const end = () => {
    if (!nodes.some((n) => n.id === "end")) nodes.push({ id: "end", kind: "terminal", heading: "Ende", text: "" });
    return "end";
  };
  const referencedExceptions = new Set<number>();
  for (const step of spec.steps) {
    for (const branch of step.decisionBranches ?? []) {
      if (branch.target.type === "exception") referencedExceptions.add(branch.target.number);
    }
  }

  for (const [index, step] of spec.steps.entries()) {
    nodes.push({ id: action(step.number), kind: "step", heading: `${step.number}. ${step.actor}`, text: step.action });
    if (step.decision) {
      nodes.push({ id: decision(step.number), kind: "decision", heading: `Entscheidung ${step.number}`, text: step.decision });
      edge(action(step.number), decision(step.number));
      if (step.decisionBranches?.length) {
        for (const branch of step.decisionBranches) {
          const target = branch.target;
          edge(decision(step.number), target.type === "end" ? end()
            : target.type === "step" ? action(target.number) : exceptionId(target.number),
          branch.label, target.type === "exception" ? "exception" : "normal");
        }
      }
      if (!step.decisionBranches || step.decisionBranches.length < 2) {
        const id = `unknown-${step.number}`;
        nodes.push({ id, kind: "unknown", heading: "Ausgänge ungeklärt", text: "Für diese Entscheidung wurden keine Zweigziele angegeben." });
        edge(decision(step.number), id, "Zu klären", "unknown");
        warnings.push(`Entscheidung in Schritt ${step.number}: Nicht alle Ausgänge und Ziele sind angegeben.`);
      }
    } else {
      const next = step.nextStep ?? spec.steps[index + 1]?.number;
      edge(action(step.number), step.endsProcess || next === undefined ? end() : action(next));
    }
  }
  edge("start", action(spec.steps[0]!.number));

  for (const [index, exception] of spec.exceptions.entries()) {
    const number = index + 1;
    const assigned = exception.stepNumber !== undefined || referencedExceptions.has(number);
    const note = [!assigned ? "Ohne Schrittzuordnung" : "",
      exception.nextStep === undefined && !exception.endsProcess ? "Fortsetzung nicht angegeben" : ""].filter(Boolean).join(" · ");
    nodes.push({ id: exceptionId(number), kind: "exception", heading: `Ausnahme ${number}`, text: `${exception.condition}\n${exception.handling}`, ...(note ? { note } : {}) });
    if (!assigned) warnings.push(`Ausnahme ${number}: Keine Zuordnung zu einem Schritt oder Entscheidungszweig angegeben.`);
    if (exception.stepNumber !== undefined) {
      const sourceStep = spec.steps[exception.stepNumber - 1]!;
      const linkedByBranch = sourceStep.decisionBranches?.some((b) => b.target.type === "exception" && b.target.number === number);
      if (!linkedByBranch) edge(action(exception.stepNumber), exceptionId(number), "Ausnahme", "exception");
    }
    if (exception.nextStep !== undefined) edge(exceptionId(number), action(exception.nextStep), `Weiter zu ${exception.nextStep}`, "exception");
    else if (exception.endsProcess) edge(exceptionId(number), end(), "Prozessende", "exception");
    else warnings.push(`Ausnahme ${number}: Fortsetzung oder Prozessende nicht angegeben.`);
  }
  return { nodes, edges, warnings };
}
