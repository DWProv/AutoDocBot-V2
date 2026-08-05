import type { ArticleSpec } from "../article/article-spec.js";
import type { ResolvedStyleGuide } from "../article/styleguide.js";

function svgText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrap(value: string, maxCharacters = 46): string[] {
  const words = value.split(/\s+/u);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharacters && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function multilineText(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
): string {
  return `<text x="${x}" y="${y}" text-anchor="middle">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${svgText(line)}</tspan>`,
    )
    .join("")}</text>`;
}

export function generateProcessSvg(
  spec: ArticleSpec,
  style: ResolvedStyleGuide,
): string {
  return style.diagramDirection === "left-right"
    ? generateLeftRight(spec)
    : generateTopDown(spec);
}

function shell(width: number, height: number, content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="diagram-title diagram-desc">
  <title id="diagram-title">${svgText("Prozessdiagramm")}</title>
  <desc id="diagram-desc">${svgText("Automatisch aus den strukturierten Prozessschritten erzeugtes Ablaufdiagramm.")}</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#0c66e4"/></marker>
    <filter id="shadow" x="-15%" y="-20%" width="130%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#091e42" flood-opacity="0.14"/></filter>
  </defs>
  <rect width="${width}" height="${height}" rx="20" fill="#f7f8f9"/>
  <style>text{font-family:Arial,Helvetica,sans-serif;fill:#172b4d}.role{font-size:14px;font-weight:700;fill:#0c66e4}.action{font-size:16px;font-weight:600}.label{font-size:13px;font-weight:700}</style>
  ${content}
</svg>`;
}

function generateTopDown(spec: ArticleSpec): string {
  const width = 1000;
  const boxWidth = 510;
  const boxHeight = 104;
  const x = (width - boxWidth) / 2;
  const startY = 80;
  const gap = 90;
  const decisionStepIndex = spec.steps.findIndex((step) => step.decision);
  const exception = spec.exceptions[0];
  const extraDecisionHeight = decisionStepIndex >= 0 ? 150 : 0;
  const height = startY + spec.steps.length * (boxHeight + gap) + extraDecisionHeight + 80;
  const parts: string[] = [];
  let y = startY;

  for (const [index, step] of spec.steps.entries()) {
    parts.push(`<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="14" fill="#fff" stroke="#b3b9c4"/></g>`);
    parts.push(`<text class="role" x="${width / 2}" y="${y + 27}" text-anchor="middle">${svgText(`${step.number}. ${step.actor}`)}</text>`);
    parts.push(multilineText(wrap(step.action), width / 2, y + 54, 20).replace("<text ", '<text class="action" '));

    const boxBottom = y + boxHeight;
    if (index === decisionStepIndex && step.decision) {
      const diamondCenterY = boxBottom + 76;
      parts.push(`<path d="M${width / 2} ${boxBottom} V${diamondCenterY - 42}" stroke="#0c66e4" stroke-width="3" marker-end="url(#arrow)"/>`);
      parts.push(`<polygon points="${width / 2},${diamondCenterY - 42} ${width / 2 + 130},${diamondCenterY} ${width / 2},${diamondCenterY + 42} ${width / 2 - 130},${diamondCenterY}" fill="#e9f2ff" stroke="#0c66e4" stroke-width="2"/>`);
      parts.push(multilineText(wrap(step.decision, 31), width / 2, diamondCenterY - 8, 18).replace("<text ", '<text class="label" '));
      if (exception) {
        const exceptionX = 735;
        parts.push(`<path d="M${width / 2 + 130} ${diamondCenterY} H${exceptionX - 20}" stroke="#c9372c" stroke-width="3" marker-end="url(#arrow)"/>`);
        parts.push(`<text class="label" x="${width / 2 + 155}" y="${diamondCenterY - 10}">Nein</text>`);
        parts.push(`<rect x="${exceptionX - 20}" y="${diamondCenterY - 55}" width="240" height="110" rx="12" fill="#ffeceb" stroke="#c9372c"/>`);
        parts.push(multilineText(wrap(exception.handling, 28), exceptionX + 100, diamondCenterY - 22, 18));
      }
      parts.push(`<text class="label" x="${width / 2 + 15}" y="${diamondCenterY + 62}">Ja</text>`);
      y = diamondCenterY + 42 + gap;
      parts.push(`<path d="M${width / 2} ${diamondCenterY + 42} V${y - 14}" stroke="#0c66e4" stroke-width="3" marker-end="url(#arrow)"/>`);
    } else if (index < spec.steps.length - 1) {
      const nextY = y + boxHeight + gap;
      parts.push(`<path d="M${width / 2} ${boxBottom} V${nextY - 14}" stroke="#0c66e4" stroke-width="3" marker-end="url(#arrow)"/>`);
      y = nextY;
    }
  }

  return shell(width, height, parts.join(""));
}

function generateLeftRight(spec: ArticleSpec): string {
  const boxWidth = 280;
  const boxHeight = 125;
  const gap = 80;
  const startX = 50;
  const y = 95;
  const width = startX * 2 + spec.steps.length * boxWidth + (spec.steps.length - 1) * gap;
  const height = 330;
  const parts: string[] = [];

  spec.steps.forEach((step, index) => {
    const x = startX + index * (boxWidth + gap);
    parts.push(`<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="14" fill="#fff" stroke="#b3b9c4"/></g>`);
    parts.push(`<text class="role" x="${x + boxWidth / 2}" y="${y + 28}" text-anchor="middle">${svgText(`${step.number}. ${step.actor}`)}</text>`);
    parts.push(multilineText(wrap(step.action, 31), x + boxWidth / 2, y + 58, 19).replace("<text ", '<text class="action" '));
    if (index < spec.steps.length - 1) {
      parts.push(`<path d="M${x + boxWidth} ${y + boxHeight / 2} H${x + boxWidth + gap - 14}" stroke="#0c66e4" stroke-width="3" marker-end="url(#arrow)"/>`);
    }
  });

  return shell(width, height, parts.join(""));
}
