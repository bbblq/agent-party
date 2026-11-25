import { FURNITURE, type Dir } from '../../client/src/art/api';
import { FloorGridBuffer, isWalkableFloorKind } from './codec';
import { compileCustomMap } from './compiler';
import type { CustomMapDocument, MapValidationReport } from './types';

export function validateMapPlayability(doc: CustomMapDocument): MapValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const layout = compileCustomMap(doc, 0);
  const { grid, spots } = layout;

  // Check overlapping blocking furniture
  const occupied = new Map<string, string>();
  for (const f of doc.furniture) {
    const def = FURNITURE[f.kind];
    if (!def || !def.blocks) continue;
    for (let y = f.ty; y < f.ty + def.footprint.h; y++) {
      for (let x = f.tx; x < f.tx + def.footprint.w; x++) {
        const k = `${x},${y}`;
        const prev = occupied.get(k);
        if (prev) {
          warnings.push(`Blocking furniture "${f.id}" (${f.kind}) overlaps "${prev}" at (${x}, ${y}).`);
        } else {
          occupied.set(k, f.id);
        }
      }
    }
  }

  const entrySpots = spots.filter((s) => s.kind === 'elevator' || s.kind === 'spawn');
  if (entrySpots.length === 0) {
    warnings.push('No elevator or entrance/spawn point placed; agents will spawn on fallback walkable tiles.');
  }

  // Build combined reachability mask from all valid entry points (or first walkable tile as fallback)
  const reachable = new Uint8Array(grid.w * grid.h);
  const seedPoints = entrySpots.filter((s) => grid.walkable(s.tx, s.ty));
  if (seedPoints.length === 0) {
    outer: for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (grid.walkable(x, y)) {
          const r = grid.reachableFrom(x, y);
          reachable.set(r);
          break outer;
        }
      }
    }
  } else {
    for (const sp of seedPoints) {
      const r = grid.reachableFrom(sp.tx, sp.ty);
      for (let i = 0; i < r.length; i++) {
        if (r[i]) reachable[i] = 1;
      }
    }
  }

  const unreachableSpots: MapValidationReport['stats']['unreachableSpots'] = [];
  for (const s of spots) {
    const idx = s.ty * grid.w + s.tx;
    if (!grid.walkable(s.tx, s.ty) || reachable[idx] !== 1) {
      unreachableSpots.push({ id: s.id, kind: s.kind, tx: s.tx, ty: s.ty });
    }
  }

  if (unreachableSpots.length > 0) {
    warnings.push(`${unreachableSpots.length} spot(s) are unreachable from map entrances (first: ${unreachableSpots[0].kind} at (${unreachableSpots[0].tx}, ${unreachableSpots[0].ty})).`);
  }

  const desks = spots.filter((s) => s.kind === 'desk');
  const desksByDir: Record<Dir, number> = { up: 0, down: 0, left: 0, right: 0 };
  for (const d of desks) desksByDir[d.dir]++;
  const noBackViewSeats = spots.filter((s) => (s.kind === 'desk' || s.kind === 'stool' || s.kind === 'nook') && s.dir !== 'up').length;
  const leisureSpots = spots.filter(
    (s) => s.kind === 'coffee' || s.kind === 'water' || s.kind === 'snack' || s.kind === 'sofa' || s.kind === 'armchair' || s.kind === 'beanbag' || s.kind === 'arcade' || s.kind === 'pingpong' || s.kind === 'cafe_seat',
  ).length;
  const spawns = spots.filter((s) => s.kind === 'spawn').length;
  const elevators = spots.filter((s) => s.kind === 'elevator').length;
  const hasArena = spots.filter((s) => s.kind === 'arena_fight').length >= 2;

  if (desks.length === 0) {
    warnings.push('No workstations (desk/chair spots) found on the map.');
  }
  if (noBackViewSeats === 0 && desks.length > 0) {
    warnings.push('All seats face UP; 2D pets without back sprites will need down/left/right facing seats.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      width: doc.width,
      height: doc.height,
      zones: doc.zones.length,
      desksTotal: desks.length,
      desksByDir,
      noBackViewSeats,
      leisureSpots,
      spawns,
      elevators,
      hasArena,
      unreachableSpots,
    },
  };
}

/**
 * Renders a compact ASCII snapshot of a rectangular region (capped at 64×64)
 * so AI agents via MCP can inspect large 512×512 maps cleanly without context bloat.
 */
export function renderAsciiRegion(
  doc: CustomMapDocument,
  region: { x: number; y: number; w: number; h: number },
): {
  rect: { x: number; y: number; w: number; h: number };
  legend: string;
  ascii: string;
  zones: CustomMapDocument['zones'];
  walls: CustomMapDocument['walls'];
  wallItems: CustomMapDocument['wallItems'];
  furniture: CustomMapDocument['furniture'];
  spawns: CustomMapDocument['spawns'];
} {
  const x0 = Math.max(0, Math.min(doc.width - 1, Math.floor(region.x)));
  const y0 = Math.max(0, Math.min(doc.height - 1, Math.floor(region.y)));
  const w = Math.max(1, Math.min(64, doc.width - x0, Math.floor(region.w)));
  const h = Math.max(1, Math.min(64, doc.height - y0, Math.floor(region.h)));

  const buf = FloorGridBuffer.fromDocument(doc);
  const layout = compileCustomMap(doc, 0);
  const { grid } = layout;

  const charGrid: string[][] = Array.from({ length: h }, (_, dy) =>
    Array.from({ length: w }, (_, dx) => {
      const tx = x0 + dx;
      const ty = y0 + dy;
      const fl = buf.getEntry(tx, ty).kind;
      if (!grid.walkable(tx, ty)) return isWalkableFloorKind(fl) ? '#' : '~';
      return '.';
    }),
  );

  const setChar = (tx: number, ty: number, ch: string) => {
    const dx = tx - x0;
    const dy = ty - y0;
    if (dx >= 0 && dy >= 0 && dx < w && dy < h) charGrid[dy][dx] = ch;
  };

  for (const wall of doc.walls) {
    const wh = wall.kind === 'face' ? 2 : wall.kind === 'south' ? 1 : wall.h;
    for (let y = Math.floor(wall.ty); y < Math.ceil(wall.ty + wh); y++) {
      for (let x = Math.floor(wall.tx); x < Math.ceil(wall.tx + wall.w); x++) {
        setChar(x, y, wall.kind === 'face' ? '=' : wall.kind === 'south' ? '-' : '#');
      }
    }
    if (wall.doorways) {
      for (const d of wall.doorways) {
        for (let y = Math.floor(wall.ty); y < Math.ceil(wall.ty + wh); y++) {
          for (let x = Math.floor(wall.tx + d.offset); x < Math.ceil(wall.tx + d.offset + d.w); x++) {
            setChar(x, y, '+');
          }
        }
      }
    }
  }

  for (const f of doc.furniture) {
    const def = FURNITURE[f.kind];
    if (!def) continue;
    let ch = 'F';
    if (f.kind === 'desk' || f.kind === 'desk_back' || f.kind === 'desk_east' || f.kind === 'desk_west') ch = 'D';
    else if (f.kind === 'office_chair') ch = '^';
    else if (f.kind === 'office_chair_front') ch = 'v';
    else if (f.kind === 'office_chair_left') ch = '<';
    else if (f.kind === 'office_chair_right') ch = '>';
    else if (def.seat) ch = 'c';
    else if (f.kind === 'coffee_machine' || f.kind === 'water_cooler' || f.kind === 'vending_machine') ch = 'K';
    else if (f.kind === 'entrance_mat') ch = 'E';
    for (let yy = f.ty; yy < f.ty + def.footprint.h; yy++) {
      for (let xx = f.tx; xx < f.tx + def.footprint.w; xx++) setChar(xx, yy, ch);
    }
  }

  for (const sp of doc.spawns) setChar(sp.tx, sp.ty, 'S');

  const lines = charGrid.map((row, dy) => `${String(y0 + dy).padStart(3, ' ')}|${row.join('')}`);
  const header = `    ${Array.from({ length: w }, (_, dx) => ((x0 + dx) % 10 === 0 ? String(Math.floor(((x0 + dx) / 10) % 10)) : ' ')).join('')}`;
  const header2 = `    ${Array.from({ length: w }, (_, dx) => String((x0 + dx) % 10)).join('')}`;

  const overlaps = (ax: number, ay: number, aw: number, ah: number) =>
    ax + aw > x0 && ay + ah > y0 && ax < x0 + w && ay < y0 + h;

  return {
    rect: { x: x0, y: y0, w, h },
    legend: '~=grass/void .=walkable ==north_wall -=south_wall #=wall/block +=door D=desk ^v<>=chair c=seat K=cafe E/S=spawn F=furniture',
    ascii: [header, header2, ...lines].join('\n'),
    zones: doc.zones.filter((z) => overlaps(z.rect.x, z.rect.y, z.rect.w, z.rect.h)),
    walls: doc.walls.filter((wl) => overlaps(wl.tx, wl.ty, wl.w, wl.kind === 'face' ? 2 : wl.h)),
    wallItems: doc.wallItems.filter((wi) => overlaps(wi.tx - 1, wi.ty - 2, 2, 3)),
    furniture: doc.furniture.filter((f) => {
      const fp = FURNITURE[f.kind]?.footprint ?? { w: 1, h: 1 };
      return overlaps(f.tx, f.ty, fp.w, fp.h);
    }),
    spawns: doc.spawns.filter((s) => overlaps(s.tx, s.ty, 1, 1)),
  };
}
