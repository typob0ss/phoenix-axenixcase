import type { Edge, Role, Step } from './types';

type Point = [number, number];
type Node = { step: Step; order: number; lane: number; x: number; y: number };
type Route = { id: string; label: string; points: Point[]; backward: boolean; labelAt: Point };

export const NODE_WIDTH = 174;
export const NODE_HEIGHT = 65;
export const HEADER_HEIGHT = 58;
const LANE_INSET = 18;
const EXIT_GAP = 15;
const ENTRY_GAP = 13;
const OUTGOING_SPACING = 15;
const INCOMING_SPACING = 4;

export function layoutDiagram(roles: Role[], steps: Step[], edges: Edge[]) {
  const lanes = new Map(roles.map((role, index) => [role.id, index]));
  const stepOrders = new Map(steps.map((step, index) => [step.id, index]));
  const occupiedTracks: [number, number][][][] = roles.map(() => []);
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  const routedEdges = edges.flatMap(edge => {
    const from = stepOrders.get(edge.from_step);
    const to = stepOrders.get(edge.to_step);
    if (from === undefined || to === undefined) return [];
    const lane = lanes.get(steps[from].role_id);
    if (lane === undefined) return [];
    const tracks = occupiedTracks[lane];
    const interval: [number, number] = [Math.min(from, to), Math.max(from, to)];
    let track = tracks.findIndex(ranges => ranges.every(([start, end]) => end < interval[0] || start > interval[1]));
    if (track === -1) track = tracks.push([]) - 1;
    tracks[track].push(interval);
    const fromPort = outgoing.get(edge.from_step) ?? 0;
    const toPort = incoming.get(edge.to_step) ?? 0;
    outgoing.set(edge.from_step, fromPort + 1);
    incoming.set(edge.to_step, toPort + 1);
    return [{ edge, from, to, track, fromPort, toPort }];
  });

  const trackCount = Math.max(1, ...occupiedTracks.map(tracks => tracks.length));
  const laneWidth = LANE_INSET * 2 + NODE_WIDTH + Math.max(42, trackCount * 9 + 9);
  const width = Math.max(1, roles.length) * laneWidth;
  const lastExit = EXIT_GAP + (Math.max(1, ...outgoing.values()) - 1) * OUTGOING_SPACING;
  const firstEntry = ENTRY_GAP + (Math.max(1, ...incoming.values()) - 1) * INCOMING_SPACING;
  const rowHeight = NODE_HEIGHT + Math.max(48, lastExit + firstEntry + 8);
  const nodes: Node[] = steps.map((step, order) => {
    const lane = lanes.get(step.role_id) ?? 0;
    return { step, order, lane, x: LANE_INSET + lane * laneWidth, y: HEADER_HEIGHT + firstEntry + 11 + order * rowHeight };
  });

  const routes: Route[] = routedEdges.map(({ edge, from, to, track, fromPort, toPort }) => {
    const start = nodes[from];
    const end = nodes[to];
    const backward = from >= to;
    const spreadPort = (port: number, total: number) => NODE_WIDTH / 2 + (port - (total - 1) / 2) * Math.min(14, 120 / total);
    const startX = start.x + spreadPort(fromPort, outgoing.get(edge.from_step) ?? 1);
    const endX = end.x + spreadPort(toPort, incoming.get(edge.to_step) ?? 1);
    const startY = start.y + NODE_HEIGHT;
    const endY = end.y;
    const exitY = startY + EXIT_GAP + fromPort * OUTGOING_SPACING;
    const entryY = endY - ENTRY_GAP - toPort * INCOMING_SPACING;
    const trackX = start.x + NODE_WIDTH + 13 + track * 9;
    const straight = to === from + 1 && startX === endX;
    const short = to === from + 1;
    const points: Point[] = short
      ? [[startX, startY], [startX, exitY], [endX, exitY], [endX, endY]]
      : [[startX, startY], [startX, exitY], [trackX, exitY], [trackX, entryY], [endX, entryY], [endX, endY]];
    const labelHalf = Math.min(edge.label.length, 26) * 3.6;
    const labelCenter = straight ? startX + labelHalf + 7 : (startX + (short ? endX : trackX)) / 2;
    const labelX = Math.max(labelHalf + 4, Math.min(width - labelHalf - 4, labelCenter));
    return { id: edge.id, label: edge.label, points, backward, labelAt: [labelX, exitY - 4] };
  });

  return {
    width,
    height: HEADER_HEIGHT + firstEntry + 11 + Math.max(0, steps.length - 1) * rowHeight + NODE_HEIGHT + lastExit + 20,
    laneWidth,
    nodes,
    edges: routes,
  };
}

export function wrapLabel(text: string, limit: number, maxLines: number): string[] {
  const lines: string[] = [];
  let remaining = text.trim();
  while (remaining && lines.length < maxLines) {
    if (remaining.length <= limit) {
      lines.push(remaining);
      break;
    }
    if (lines.length === maxLines - 1) {
      lines.push(remaining.slice(0, limit - 1).trimEnd() + '…');
      break;
    }
    const space = remaining.lastIndexOf(' ', limit);
    const end = space > 0 ? space : limit;
    lines.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  return lines;
}
