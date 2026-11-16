import type { Gate } from "./api";
import { gateLabel } from "./labels";

export type GateGroup = { key: string; name: string; members: Gate[]; primary: Gate; km: number };

export function physicalGateKey(gate: Gate): string {
  // Legacy cached locations have no topology evidence and must stay separate.
  return gate.group_id ? `road:${gate.group_id}` : `gate:${gate.id}`;
}

export function groupGates(gates: Gate[]): GateGroup[] {
  const grouped = new Map<string, Gate[]>();
  for (const gate of gates) {
    const key = physicalGateKey(gate);
    grouped.set(key, [...(grouped.get(key) ?? []), gate]);
  }
  return [...grouped].map(([key, members]) => {
    const ordered = [...members].sort((a, b) => a.km - b.km || a.id.localeCompare(b.id, undefined, { numeric: true }));
    const primary = ordered[0];
    return { key, name: primary.group_name || primary.road || primary.name || "Level crossing", members: ordered, primary, km: primary.km };
  });
}

export function gateCheckLabel(gate: Gate): string {
  if (gate.status === "uncertain") return "Position update needed";
  if (gate.eta != null) return `Est. ${gateLabel(gate.eta, gate.closesIn, gate.status)}`;
  if (gate.groupEstimate) return "Train near this group · open for gate timing";
  return "Gate position unknown";
}

export function groupCheckLabel(group: GateGroup): string {
  const estimated = group.members.filter((gate) => gate.eta != null).sort((a, b) => a.eta! - b.eta!);
  if (group.members.some((gate) => gate.status === "uncertain")) return `Position update needed${estimated.length ? " · other track estimates below" : ""}`;
  if (estimated.length) {
    const unknown = group.members.filter((gate) => gate.eta == null).length;
    return `${group.members.length > 1 ? "First track · " : ""}${gateCheckLabel(estimated[0])}${unknown ? ` · ${unknown} track timing${unknown > 1 ? "s" : ""} unknown` : ""}`;
  }
  return group.members.some((gate) => gate.groupEstimate) ? "Train near this group · open for gate timing" : "";
}

export function gateHoverLines(gate: Gate, gates: Gate[]): string[] {
  const group = groupGates(gates).find((item) => item.members.some((member) => member.id === gate.id))!;
  const size = Math.max(group.members.length, gate.group_size ?? 1);
  const index = [...group.members].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).findIndex((member) => member.id === gate.id);
  return [group.name, ...(gate.road && gate.road !== group.name ? [gate.road] : []),
    ...(gate.name && gate.name !== group.name && gate.name !== gate.road ? [gate.name] : []),
    `Gate ${gate.id} · ${gate.km.toFixed(1)} km away`,
    ...(size > 1 ? [group.members.length === size ? `Track crossing ${index + 1} of ${size}` : `Part of ${size} track crossings`] : []),
    gateCheckLabel(gate)];
}

export type CrossingTiming = { key: string; label: string; eta?: number; closesIn?: number; status: string };
export type CrossingTimingGroup = { key: string; label: string; members: CrossingTiming[]; first: CrossingTiming };

/** Call separately for each journey: the timings and original point IDs remain independent. */
export function groupCrossingTimings(timings: CrossingTiming[], gates: Gate[]): CrossingTimingGroup[] {
  const byId = new Map(gates.map((gate) => [gate.id, gate]));
  const groups = new Map<string, CrossingTimingGroup>();
  for (const row of [...timings].sort((a, b) => (a.eta ?? Infinity) - (b.eta ?? Infinity))) {
    const gate = byId.get(row.key);
    const key = gate ? physicalGateKey(gate) : `gate:${row.key}`;
    const group = groups.get(key);
    if (group) group.members.push(row);
    else groups.set(key, { key, label: gate?.group_name || gate?.road || row.label, members: [row], first: row });
  }
  return [...groups.values()];
}
