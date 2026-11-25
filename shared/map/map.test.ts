import { describe, expect, it } from 'vitest';
import {
  FloorGridBuffer,
  MAX_MAP_SIZE,
  compileCustomMap,
  createBlankCustomMap,
  createStarterOfficeMap,
  decodeFloorRows,
  encodeFloorRows,
  parseCustomMapJson,
  renderAsciiRegion,
  resizeCustomMap,
  serializeCustomMapJson,
  validateMapPlayability,
} from './index';

describe('shared/map RLE, 4-way compile, and 512x512 scale', () => {
  it('encodes and decodes 512x512 floor grids losslessly via RLE', () => {
    const buf = new FloorGridBuffer(MAX_MAP_SIZE, MAX_MAP_SIZE, [{ kind: 'grass' }]);
    buf.fillRect(100, 120, 80, 60, { kind: 'carpet', tint: '#335577' });
    buf.fillRect(480, 480, 20, 20, { kind: 'marble' });

    const rows = buf.toRows();
    expect(rows).toHaveLength(MAX_MAP_SIZE);
    const decoded = decodeFloorRows(rows, MAX_MAP_SIZE, MAX_MAP_SIZE, buf.palette.length);
    expect(decoded.length).toBe(MAX_MAP_SIZE * MAX_MAP_SIZE);
    expect(decoded[125 * MAX_MAP_SIZE + 110]).toBe(1);
    expect(decoded[490 * MAX_MAP_SIZE + 490]).toBe(2);
    expect(decoded[0]).toBe(0);

    const reEncoded = encodeFloorRows(decoded, MAX_MAP_SIZE, MAX_MAP_SIZE);
    expect(reEncoded).toEqual(rows);
  });

  it('compiles 4-way desks and chairs with correct facing directions and monitor deskIds', () => {
    const doc = createBlankCustomMap('四向测试', 40, 30, 'test-4way');
    const layout = compileCustomMap(doc);
    const deskSpots = layout.spots.filter((s) => s.kind === 'desk');
    const dirs = new Set(deskSpots.map((s) => s.dir));
    expect(dirs).toEqual(new Set(['up', 'left', 'right']));

    // Add a south-facing workstation (desk_back + office_chair_front)
    doc.furniture.push(
      { id: 'chair-s', kind: 'office_chair_front', tx: 14, ty: 12, dir: 'down' },
      { id: 'desk-s', kind: 'desk_back', tx: 14, ty: 13 },
    );
    const compiled2 = compileCustomMap(doc);
    const southSpot = compiled2.spots.find((s) => s.furnitureId === 'chair-s');
    expect(southSpot).toBeDefined();
    expect(southSpot?.dir).toBe('down');
    expect(southSpot?.deskId).toBe('desk-s');

    const eastSpot = compiled2.spots.find((s) => s.furnitureId === 'starter-chair-2');
    expect(eastSpot?.dir).toBe('left');
    expect(eastSpot?.deskId).toBe('starter-desk-2');

    const westSpot = compiled2.spots.find((s) => s.furnitureId === 'starter-chair-3');
    expect(westSpot?.dir).toBe('right');
    expect(westSpot?.deskId).toBe('starter-desk-3');

    const report = validateMapPlayability(doc);
    expect(report.valid).toBe(true);
    expect(report.stats.desksTotal).toBeGreaterThanOrEqual(4);
    expect(report.stats.noBackViewSeats).toBeGreaterThanOrEqual(3);
  });

  it('resizes up to 512x512 and round-trips through JSON parser', () => {
    const base = createStarterOfficeMap(2, 96, 64, '大型园区');
    const big = resizeCustomMap(base, 512, 512);
    expect(big.width).toBe(512);
    expect(big.height).toBe(512);

    const parsed = parseCustomMapJson(serializeCustomMapJson(big));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.width).toBe(512);
      expect(parsed.doc.height).toBe(512);
      const report = validateMapPlayability(parsed.doc);
      expect(report.valid).toBe(true);
      expect(report.stats.desksTotal).toBeGreaterThan(0);
    }
  });

  it('renders ASCII inspection output for a bounded sub-region', () => {
    const doc = createBlankCustomMap('ASCII 测试', 48, 36, 'ascii-test');
    const inspected = renderAsciiRegion(doc, { x: 10, y: 8, w: 28, h: 20 });
    expect(inspected.ascii).toContain('E');
    expect(inspected.ascii).toContain('D');
    expect(inspected.furniture.length).toBeGreaterThan(0);
    expect(inspected.walls.length).toBeGreaterThan(0);
  });
});
