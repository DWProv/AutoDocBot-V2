import dagre from "@dagrejs/dagre";
import type { ArticleSpec } from "../article/article-spec.js";
import type { ResolvedStyleGuide } from "../article/styleguide.js";
import { buildProcessGraph, type ProcessNode } from "./process-graph.js";

function xml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "�")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/** Preserve every word, including long unbroken identifiers, without clipping. */
export function wrapDiagramText(value: string, columns = 34): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\n/u)) {
    let line = "";
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      const characters = Array.from(word);
      if (line && Array.from(line).length + characters.length + 1 > columns) {
        lines.push(line); line = "";
      }
      while (characters.length > columns) lines.push(characters.splice(0, columns).join(""));
      const remainder = characters.join("");
      if (remainder) line = line ? `${line} ${remainder}` : remainder;
    }
    if (line) lines.push(line);
  }
  return lines;
}

type PositionedNode = ProcessNode & {
  width: number; height: number; x: number; y: number;
  lines: Array<{ text: string; kind: string }>;
};
type Point = { x: number; y: number };

function sizeNode(node: ProcessNode): PositionedNode {
  const lines = [
    ...wrapDiagramText(node.heading).map((text) => ({ text, kind: "heading" })),
    ...wrapDiagramText(node.text).map((text) => ({ text, kind: "body" })),
    ...wrapDiagramText(node.note ?? "").map((text) => ({ text, kind: "note" })),
  ];
  const diamond = node.kind === "decision";
  return { ...node, lines, width: diamond ? 660 : 360,
    height: (lines.length * 20 + 40) * (diamond ? 2 : 1), x: 0, y: 0 };
}

function textLines(node: PositionedNode): string {
  const start = node.y - ((node.lines.length - 1) * 20) / 2 + 5;
  return node.lines.map((line, i) => `<text class="${line.kind}" x="${node.x}" y="${start + i * 20}" text-anchor="middle">${xml(line.text)}</text>`).join("");
}

function diamondIntersection(node: PositionedNode, toward: Point): Point {
  const dx = toward.x - node.x, dy = toward.y - node.y;
  const scale = 1 / (Math.abs(dx) / (node.width / 2) + Math.abs(dy) / (node.height / 2));
  return Number.isFinite(scale) ? { x: node.x + dx * scale, y: node.y + dy * scale } : toward;
}

export function generateProcessSvg(spec: ArticleSpec, style: ResolvedStyleGuide): string {
  const process = buildProcessGraph(spec);
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: style.diagramDirection === "left-right" ? "LR" : "TB",
    nodesep: 85, ranksep: 105, edgesep: 30, marginx: 48, marginy: 48 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of process.nodes) graph.setNode(node.id, sizeNode(node));
  for (const edge of process.edges) {
    const lines = wrapDiagramText(edge.label, 20);
    graph.setEdge(edge.from, edge.to, { ...edge, lines,
      width: lines.length ? 188 : 0, height: lines.length ? lines.length * 18 + 16 : 0,
      labelpos: "c" }, edge.id);
  }
  dagre.layout(graph);
  const bounds = graph.graph();
  const width = Math.ceil(Math.max(900, bounds.width ?? 0));
  const titleLines = wrapDiagramText(spec.title, Math.floor((width - 96) / 11));
  const headerHeight = 58 + titleLines.length * 22;
  const height = Math.ceil((bounds.height ?? 0) + headerHeight + 40);
  const horizontalOffset = (width - (bounds.width ?? width)) / 2;
  const paths: string[] = [], labels: string[] = [];
  const colors = { normal: "#0c66e4", exception: "#c9372c", unknown: "#946200" };
  for (const ref of graph.edges()) {
    const edge = graph.edge(ref);
    const points: Point[] = edge.points.map((p: Point) => ({ ...p }));
    const source = graph.node(ref.v) as PositionedNode, target = graph.node(ref.w) as PositionedNode;
    if (source.kind === "decision" && points[1]) points[0] = diamondIntersection(source, points[1]);
    if (target.kind === "decision" && points[points.length - 2]) points[points.length - 1] = diamondIntersection(target, points[points.length - 2]!);
    const kind = edge.kind as keyof typeof colors;
    paths.push(`<path data-edge="${xml(edge.id)}" data-from="${xml(ref.v)}" data-to="${xml(ref.w)}" d="${points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}" fill="none" stroke="${colors[kind]}" stroke-width="2.5" ${kind === "unknown" ? 'stroke-dasharray="7 5"' : ""} marker-end="url(#arrow-${kind})"/>`);
    if (edge.lines.length) {
      labels.push(`<g><rect x="${edge.x - edge.width / 2}" y="${edge.y - edge.height / 2}" width="${edge.width}" height="${edge.height}" rx="6" fill="#f7f8f9"/>${edge.lines.map((line: string, i: number) => `<text class="edge-label" x="${edge.x}" y="${edge.y - (edge.lines.length - 1) * 9 + i * 18 + 4}" text-anchor="middle">${xml(line)}</text>`).join("")}</g>`);
    }
  }
  const nodes = graph.nodes().map((id: string) => {
    const node = graph.node(id) as PositionedNode;
    const x = node.x, y = node.y, w = node.width, h = node.height;
    const shape = node.kind === "decision"
      ? `<polygon points="${x},${y-h/2} ${x+w/2},${y} ${x},${y+h/2} ${x-w/2},${y}" fill="#e9f2ff" stroke="#0c66e4"/>`
      : `<rect x="${x-w/2}" y="${y-h/2}" width="${w}" height="${h}" rx="${node.kind === "terminal" ? 28 : 12}" fill="${node.kind === "exception" ? "#ffeceb" : node.kind === "unknown" ? "#fff7d6" : "#fff"}" stroke="${node.kind === "exception" ? "#c9372c" : node.kind === "unknown" ? "#946200" : "#8590a2"}"/>`;
    return `<g data-node="${xml(id)}" data-kind="${node.kind}" stroke-width="2"><title>${xml(`${node.heading}: ${node.text}${node.note ? ` (${node.note})` : ""}`)}</title>${shape}${textLines(node)}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="diagram-title diagram-desc">
<title id="diagram-title">${xml(spec.title)}</title><desc id="diagram-desc">${xml(`Prozess mit ${spec.steps.length} Schritten, ${spec.steps.filter(s => s.decision).length} Entscheidungen und ${spec.exceptions.length} Ausnahmen. ${process.warnings.join(" ")}`)}</desc>
<defs>${Object.entries(colors).map(([kind, color]) => `<marker id="arrow-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${color}"/></marker>`).join("")}</defs>
<rect width="${width}" height="${height}" rx="16" fill="#f7f8f9"/>
<style>text{font-family:DejaVu Sans Mono,Consolas,monospace;fill:#172b4d;font-size:14px}.heading{font-weight:bold;fill:#0c66e4}.note{font-size:12px;fill:#946200}.edge-label{font-size:12px;font-weight:bold}.title{font-size:18px;font-weight:bold}</style>
${titleLines.map((line, i) => `<text class="title" x="48" y="${34 + i*22}">${xml(line)}</text>`).join("")}
<text x="48" y="${headerHeight-14}" font-size="12">Rot: Ausnahmen · Gelb/gestrichelt: Angaben ungeklärt</text>
<g transform="translate(${horizontalOffset},${headerHeight})">${paths.join("")}${nodes}${labels.join("")}</g></svg>`;
}
