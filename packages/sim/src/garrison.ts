import { sendPercent } from "./rules";
import { PRODUCTION_SITE_KINDS, siteUnitKind } from "./types";
import type { CityState, Ruleset, SiteKind, UnitKind } from "./types";

/** 据点驻军按兵种分别记账；total 始终等于 CityState.pop。 */
export type Garrison = Record<UnitKind, number>;

export interface DispatchPart {
  kind: UnitKind;
  count: number;
}

export function emptyGarrison(): Garrison {
  const garrison = {} as Garrison;
  for (const kind of PRODUCTION_SITE_KINDS) garrison[kind] = 0;
  return garrison;
}

/** 不存在兵种记录时，据点按自身产兵兵种或默认步兵初始化。 */
export function defaultUnitKind(kind: SiteKind): UnitKind {
  return siteUnitKind(kind) ?? "barbarian";
}

export function initialGarrison(kind: SiteKind, pop: number): Garrison {
  const garrison = emptyGarrison();
  if (pop > 0) garrison[defaultUnitKind(kind)] = pop;
  return garrison;
}

export function garrisonTotal(garrison: Garrison | undefined): number {
  if (!garrison) return 0;
  let total = 0;
  for (const kind of PRODUCTION_SITE_KINDS) total += garrison[kind] ?? 0;
  return total;
}

/** 据点当前的非零兵种，顺序固定，便于哈希与 UI 展示。 */
export function garrisonEntries(city: CityState): Array<{ kind: UnitKind; count: number }> {
  const entries: Array<{ kind: UnitKind; count: number }> = [];
  for (const kind of PRODUCTION_SITE_KINDS) {
    const count = city.garrison?.[kind] ?? 0;
    if (count > 0) entries.push({ kind, count });
  }
  return entries;
}

export function addGarrison(city: CityState, kind: UnitKind, count: number): void {
  if (count <= 0) return;
  if (!city.garrison) city.garrison = emptyGarrison();
  city.garrison[kind] = (city.garrison[kind] ?? 0) + count;
  city.pop += count;
}

export function removeGarrisonKind(city: CityState, kind: UnitKind, count: number): number {
  const available = city.garrison[kind] ?? 0;
  const taken = Math.min(available, Math.max(0, Math.floor(count)));
  if (taken <= 0) return 0;
  city.garrison[kind] = available - taken;
  city.pop -= taken;
  return taken;
}

/** 清零后只保留一种兵，用于城破后的新驻军。 */
export function setGarrisonKind(city: CityState, kind: UnitKind, count: number): void {
  const next = emptyGarrison();
  const amount = Math.max(0, Math.floor(count));
  next[kind] = amount;
  city.garrison = next;
  city.pop = amount;
}

/**
 * 把总驻军调整到 target，按现有兵种比例分摊损失，余数按兵种固定顺序补齐。
 * 增兵时并入据点自身的产兵兵种。
 */
export function resizeGarrison(city: CityState, target: number): void {
  const total = garrisonTotal(city.garrison);
  const desired = Math.max(0, Math.floor(target));
  if (desired === total) {
    city.pop = desired;
    return;
  }
  if (desired > total) {
    const kind = defaultUnitKind(city.kind);
    const next = { ...city.garrison };
    next[kind] = (next[kind] ?? 0) + (desired - total);
    city.garrison = next;
    city.pop = desired;
    return;
  }
  if (desired === 0 || total === 0) {
    city.garrison = emptyGarrison();
    city.pop = desired;
    return;
  }

  const next = emptyGarrison();
  const remainders: Array<{ kind: UnitKind; remainder: number; order: number; count: number }> = [];
  let assigned = 0;
  PRODUCTION_SITE_KINDS.forEach((kind, order) => {
    const count = city.garrison[kind] ?? 0;
    const base = Math.floor((count * desired) / total);
    next[kind] = base;
    assigned += base;
    remainders.push({
      kind,
      remainder: count * desired - base * total,
      order,
      count,
    });
  });
  remainders.sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  let left = desired - assigned;
  for (const entry of remainders) {
    if (left <= 0) break;
    if (next[entry.kind] < entry.count) {
      next[entry.kind] += 1;
      left -= 1;
    }
  }
  city.garrison = next;
  city.pop = desired;
}

/** 把手工改过的 pop 与兵种账本对齐；旧存档或测试直接改 pop 时兜底。 */
export function reconcileGarrison(city: CityState): void {
  if (!city.garrison) city.garrison = initialGarrison(city.kind, city.pop);
  const total = garrisonTotal(city.garrison);
  if (total === city.pop) return;
  if (total > city.pop) {
    resizeGarrison(city, city.pop);
    return;
  }
  // 只补账本，不动 pop：pop 已经是权威总数。
  const kind = defaultUnitKind(city.kind);
  if (!city.garrison) city.garrison = emptyGarrison();
  city.garrison[kind] = (city.garrison[kind] ?? 0) + (city.pop - total);
}

function allocateParts(garrison: Garrison, total: number, target: number): DispatchPart[] {
  if (target <= 0 || total <= 0) return [];
  const wanted = Math.min(total, Math.floor(target));
  if (wanted >= total) {
    return garrisonEntriesFrom(garrison);
  }
  const counts = new Map<UnitKind, number>();
  const remainders: Array<{ kind: UnitKind; remainder: number; order: number; available: number }> = [];
  let assigned = 0;
  PRODUCTION_SITE_KINDS.forEach((kind, order) => {
    const available = garrison[kind] ?? 0;
    const base = Math.floor((available * wanted) / total);
    counts.set(kind, base);
    assigned += base;
    remainders.push({
      kind,
      remainder: available * wanted - base * total,
      order,
      available,
    });
  });
  remainders.sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  let left = wanted - assigned;
  for (const entry of remainders) {
    if (left <= 0) break;
    if ((counts.get(entry.kind) ?? 0) < entry.available) {
      counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
      left -= 1;
    }
  }
  const parts: DispatchPart[] = [];
  for (const kind of PRODUCTION_SITE_KINDS) {
    const count = counts.get(kind) ?? 0;
    if (count > 0) parts.push({ kind, count });
  }
  return parts;
}

function garrisonEntriesFrom(garrison: Garrison): DispatchPart[] {
  const parts: DispatchPart[] = [];
  for (const kind of PRODUCTION_SITE_KINDS) {
    const count = garrison[kind] ?? 0;
    if (count > 0) parts.push({ kind, count });
  }
  return parts;
}

/**
 * 不出兵数量时沿用旧规则：每种兵各派 50%，各自最少 1。
 * 指定 count 时按总兵数比例分摊，保证各兵种之和正好等于该数量。
 */
export function dispatchParts(city: CityState, rules: Ruleset, count?: number): DispatchPart[] {
  if (count !== undefined) {
    const total = garrisonTotal(city.garrison);
    if (!Number.isFinite(count) || count <= 0) return [];
    return allocateParts(city.garrison, total, Math.floor(count));
  }
  const percent = sendPercent(rules);
  const parts: DispatchPart[] = [];
  for (const kind of PRODUCTION_SITE_KINDS) {
    const available = city.garrison?.[kind] ?? 0;
    if (available <= 0) continue;
    const amount = Math.min(available, Math.max(1, Math.floor((available * percent) / 100)));
    if (amount > 0) parts.push({ kind, count: amount });
  }
  return parts;
}
