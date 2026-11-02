import type { CityId, Level, Owner, SiteKind } from "@marchlands/sim";
import { cloneDocument } from "./document";
import type {
  MapDocument,
  PropDraft,
  RoadDraft,
  RoadVisualDraft,
  SiteDraft,
  TerrainDraft,
} from "./types";
import { cloneVisual } from "./visual";

export function clampPosition(document: MapDocument, pos: [number, number]): [number, number] {
  const halfW = Math.floor(document.size[0] / 2);
  const halfH = Math.floor(document.size[1] / 2);
  const x = Math.max(-halfW, Math.min(halfW, Math.round(pos[0])));
  const z = Math.max(-halfH, Math.min(halfH, Math.round(pos[1])));
  return [Object.is(x, -0) ? 0 : x, Object.is(z, -0) ? 0 : z];
}

export function nextSiteId(document: MapDocument, kind: SiteKind): CityId {
  const prefix = kind === "town" ? "c" : kind === "granary" ? "g" : "o";
  let next = 1;
  const used = new Set(document.sites.map((site) => site.id));
  while (used.has(prefix + String(next))) next += 1;
  return prefix + String(next);
}

export function nextPropId(document: MapDocument): string {
  const used = new Set(document.visual.props.map((prop) => prop.id));
  let next = 1;
  while (used.has(`p${next}`)) next += 1;
  return `p${next}`;
}

export function addSite(
  document: MapDocument,
  kind: SiteKind,
  pos: [number, number],
  owner: Owner = 0,
): { document: MapDocument; site: SiteDraft } {
  const next = cloneDocument(document);
  const site: SiteDraft = {
    id: nextSiteId(next, kind),
    kind,
    owner,
    level: 1,
    pop: kind === "town" ? 10 : 0,
    pos: clampPosition(next, pos),
    ...(kind === "outpost" ? { stance: "evade" as const } : {}),
  };
  next.sites.push(site);
  return { document: next, site };
}

export function moveSite(document: MapDocument, id: CityId, pos: [number, number]): MapDocument {
  const next = cloneDocument(document);
  const site = next.sites.find((entry) => entry.id === id);
  if (!site) return next;
  site.pos = clampPosition(next, pos);
  return next;
}

export function removeSite(document: MapDocument, id: CityId): MapDocument {
  const next = cloneDocument(document);
  next.sites = next.sites.filter((site) => site.id !== id);
  next.roads = next.roads.filter((road) => road.from !== id && road.to !== id);
  for (const site of next.sites) {
    if (site.watch && (site.watch[0] === id || site.watch[1] === id)) {
      delete site.watch;
    }
  }
  return next;
}

export function updateSite(
  document: MapDocument,
  id: CityId,
  patch: Partial<Omit<SiteDraft, "id">>,
): MapDocument {
  const next = cloneDocument(document);
  const site = next.sites.find((entry) => entry.id === id);
  if (!site) return next;
  Object.assign(site, patch);
  if (patch.kind) {
    site.kind = patch.kind;
    site.level = site.kind === "town" ? (site.level as Level) : 1;
    if (site.kind === "town") {
      site.pop = Math.max(0, Math.round(site.pop));
    } else {
      site.pop = 0;
      delete site.stance;
      delete site.watch;
      if (site.kind === "outpost") site.stance = "evade";
    }
  }
  if (site.kind !== "outpost") {
    delete site.stance;
    delete site.watch;
  } else {
    site.level = 1;
    site.pop = Math.max(0, Math.round(site.pop));
    site.stance = site.stance === "engage" ? "engage" : "evade";
  }
  if (site.kind === "town") {
    site.level = site.level === 3 ? 3 : site.level === 2 ? 2 : 1;
    site.pop = Math.max(0, Math.round(site.pop));
  }
  site.owner = site.owner === 1 || site.owner === 2 ? site.owner : 0;
  site.pos = clampPosition(next, site.pos);
  return next;
}

export function watchCandidates(document: MapDocument, siteId: CityId): RoadDraft[] {
  const site = document.sites.find((entry) => entry.id === siteId);
  if (!site || site.kind !== "outpost") return [];
  const incident = document.roads.filter((road) => road.from === siteId || road.to === siteId);
  const spurNeighbor =
    incident.length === 1 ? (incident[0].from === siteId ? incident[0].to : incident[0].from) : null;
  return document.roads.filter((road) => {
    if (road.from === siteId || road.to === siteId) return false;
    if (!spurNeighbor) return true;
    return road.from === spurNeighbor || road.to === spurNeighbor;
  });
}

export function connect(document: MapDocument, from: CityId, to: CityId): MapDocument {
  const next = cloneDocument(document);
  if (from === to) return next;
  if (!next.sites.some((site) => site.id === from) || !next.sites.some((site) => site.id === to)) {
    return next;
  }
  if (next.roads.some((road) => (road.from === from && road.to === to) || (road.from === to && road.to === from))) {
    return next;
  }
  next.roads.push({ from, to });
  for (const id of [from, to]) {
    const site = next.sites.find((entry) => entry.id === id);
    if (site?.kind !== "outpost" || site.watch) continue;
    const candidate = watchCandidates(next, id)[0];
    if (candidate) site.watch = [candidate.from, candidate.to];
  }
  return next;
}

export function disconnect(document: MapDocument, from: CityId, to: CityId): MapDocument {
  const next = cloneDocument(document);
  next.roads = next.roads.filter(
    (road) => !((road.from === from && road.to === to) || (road.from === to && road.to === from)),
  );
  for (const site of next.sites) {
    if (site.kind !== "outpost") continue;
    const degree = next.roads.filter((road) => road.from === site.id || road.to === site.id).length;
    if (degree === 0) {
      delete site.watch;
      continue;
    }
    if (!site.watch) continue;
    const watchExists = next.roads.some(
      (road) =>
        (road.from === site.watch?.[0] && road.to === site.watch?.[1]) ||
        (road.from === site.watch?.[1] && road.to === site.watch?.[0]),
    );
    if (!watchExists) {
      const candidate = watchCandidates(next, site.id)[0];
      if (candidate) site.watch = [candidate.from, candidate.to];
      else delete site.watch;
    }
  }
  return next;
}

export function addProp(
  document: MapDocument,
  assetId: string,
  pos: [number, number],
  rotation = 0,
  scale = 1,
): { document: MapDocument; prop: PropDraft } {
  const next = cloneDocument(document);
  const prop: PropDraft = {
    id: nextPropId(next),
    assetId,
    pos: clampPosition(next, pos),
    rotation: ((rotation % 360) + 360) % 360,
    scale: Math.min(10, Math.max(0.1, scale)),
  };
  next.visual.props.push(prop);
  return { document: next, prop };
}

export function moveProp(document: MapDocument, id: string, pos: [number, number]): MapDocument {
  const next = cloneDocument(document);
  const prop = next.visual.props.find((entry) => entry.id === id);
  if (!prop) return next;
  prop.pos = clampPosition(next, pos);
  return next;
}

export function updateProp(
  document: MapDocument,
  id: string,
  patch: Partial<Omit<PropDraft, "id">>,
): MapDocument {
  const next = cloneDocument(document);
  const prop = next.visual.props.find((entry) => entry.id === id);
  if (!prop) return next;
  Object.assign(prop, patch);
  prop.pos = clampPosition(next, prop.pos);
  prop.rotation = ((prop.rotation % 360) + 360) % 360;
  prop.scale = Math.min(10, Math.max(0.1, prop.scale));
  return next;
}

export function removeProp(document: MapDocument, id: string): MapDocument {
  const next = cloneDocument(document);
  next.visual.props = next.visual.props.filter((prop) => prop.id !== id);
  return next;
}

export function updateTerrain(document: MapDocument, patch: Partial<TerrainDraft>): MapDocument {
  const next = cloneDocument(document);
  next.visual.terrain = { ...next.visual.terrain, ...patch };
  return next;
}

export function updateRoadVisual(document: MapDocument, patch: Partial<RoadVisualDraft>): MapDocument {
  const next = cloneDocument(document);
  next.visual.roads = { ...next.visual.roads, ...patch };
  return next;
}

export function updateUnitVisual(
  document: MapDocument,
  player: "player1" | "player2",
  assetId: string | undefined,
): MapDocument {
  const next = cloneDocument(document);
  if (!assetId) delete next.visual.units[player];
  else next.visual.units[player] = assetId;
  return next;
}

export function updateScatter(document: MapDocument, scatter: boolean): MapDocument {
  const next = cloneDocument(document);
  next.visual.scatter = scatter;
  return next;
}

export function updateDocument(
  document: MapDocument,
  patch: Partial<Omit<MapDocument, "sites" | "roads">>,
): MapDocument {
  const next = cloneDocument(document);
  return {
    ...next,
    ...patch,
    size: patch.size ? [patch.size[0], patch.size[1]] : [document.size[0], document.size[1]],
    players: patch.players
      ? patch.players.map((player) => ({ ...player }))
      : document.players.map((player) => ({ ...player })),
    visual: patch.visual ? cloneVisual(patch.visual) : next.visual,
  };
}