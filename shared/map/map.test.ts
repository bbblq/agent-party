import { describe, expect, it } from 'vitest';
import { FURNITURE, type FloorKind, type FurnitureKind } from '../../client/src/art/api';
import {
  FLOOR_CATALOG,
  FULL_ASSET_CATALOG,
  FURNITURE_CATALOG,
  FloorGridBuffer,
  MAX_MAP_SIZE,
  compileCustomMap,
  copyRectToClipboard,
  copySelectionToClipboard,
  createBlankCustomMap,
  createBlankGrassMap,
  createStarterOfficeMap,
  decodeFloorRows,
  encodeFloorRows,
  parseCustomMapJson,
  pasteClipboardIntoDoc,
  renderAsciiRegion,
  resizeCustomMap,
  serializeCustomMapJson,
  transformSelectionInDoc,
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

  it('preserves zone tint and accent color in the compiled layout', () => {
    const doc = createBlankCustomMap('颜色测试', 32, 24, 'color-test');
    doc.zones.push({ id: 'zone-color', name: '颜色区域', kind: 'room', rect: { x: 2, y: 2, w: 8, h: 6 }, floorTint: '#112233', accentColor: '#2680EB' });
    const layout = compileCustomMap(doc);
    expect([...layout.core, ...layout.rooms].find((area) => area.id === 'zone-color')).toMatchObject({ floorTint: '#112233', accentColor: '#2680EB' });
  });

  it('renders ASCII inspection output for a bounded sub-region', () => {
    const doc = createBlankCustomMap('ASCII 测试', 48, 36, 'ascii-test');
    const inspected = renderAsciiRegion(doc, { x: 10, y: 8, w: 28, h: 20 });
    expect(inspected.ascii).toContain('E');
    expect(inspected.ascii).toContain('D');
    expect(inspected.furniture.length).toBeGreaterThan(0);
    expect(inspected.walls.length).toBeGreaterThan(0);
  });

  it('persists layer groups, rot/flipX/flipY transforms, and compiles group transforms cleanly', () => {
    const doc = createBlankGrassMap(36, 28, '分组与旋转测试');
    doc.groups = [{ id: 'grp-1', name: '打印机组合', rot: 90, flipX: true }];
    doc.furniture.push(
      { id: 'prn-1', kind: 'printer', tx: 10, ty: 10, groupId: 'grp-1' },
      { id: 'desk-1', kind: 'desk', tx: 14, ty: 10 },
    );

    const parsed = parseCustomMapJson(serializeCustomMapJson(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.groups).toHaveLength(1);
    expect(parsed.doc.furniture[0].groupId).toBe('grp-1');

    // Compile inherits group transform (rot 90 + flipX) onto furniture placement
    const compiled = compileCustomMap(parsed.doc);
    const prnPlacement = compiled.core.flatMap((a) => a.furniture).find((f) => f.id === 'prn-1');
    expect(prnPlacement?.rot).toBe(90);
    expect(prnPlacement?.flipX).toBe(true);

    // Non-directional items attach sprite rot; 4-way desks map natively on transform
    const rotated = transformSelectionInDoc(
      parsed.doc,
      [
        { layer: 'furniture', id: 'prn-1' },
        { layer: 'furniture', id: 'desk-1' },
      ],
      'rot90',
    );
    const rotatedPrinter = rotated.furniture.find((f) => f.id === 'prn-1');
    const rotatedDesk = rotated.furniture.find((f) => f.id === 'desk-1');
    expect(rotatedPrinter?.rot).toBe(90);
    expect(rotatedDesk?.kind).toBe('desk_east');
  });

  it('copies a room region (floors + walls + furniture) and pastes across maps cleanly', () => {
    const roomDoc = createBlankCustomMap('小房间源图', 32, 24, 'src-room');
    const clip = copyRectToClipboard(roomDoc, { x: 8, y: 6, w: 18, h: 14 }, true);
    expect(clip).not.toBeNull();
    expect(clip!.hasFloor).toBe(true);
    expect(clip!.furniture.length).toBeGreaterThan(0);

    const target = createBlankGrassMap(64, 48, '主园区目标图');
    const pasted = pasteClipboardIntoDoc(target, clip!, 20, 12, { pasteFloor: true, wrapInGroupName: '粘贴小房间' });
    expect(pasted.insertedRefs.length).toBeGreaterThan(0);
    expect(pasted.insertedGroupIds).toHaveLength(1);

    // Selection-based copy preserves groups as well
    const selClip = copySelectionToClipboard(pasted.doc, [], pasted.insertedGroupIds);
    expect(selClip).not.toBeNull();
    expect(selClip!.groups).toHaveLength(1);
  });

  it('covers 100% of FURNITURE and FloorKind entries in FULL_ASSET_CATALOG', () => {
    const allFurnitureKinds = Object.keys(FURNITURE) as FurnitureKind[];
    const catalogFurnitureIds = new Set(FURNITURE_CATALOG.map((e) => e.id));
    for (const k of allFurnitureKinds) {
      expect(catalogFurnitureIds.has(k)).toBe(true);
    }
    const expectedFloors: FloorKind[] = [
      'carpet',
      'wood',
      'tile_check',
      'tile_white',
      'concrete',
      'marble',
      'grass',
      'sidewalk',
      'street',
    ];
    const catalogFloorIds = new Set(FLOOR_CATALOG.map((e) => e.id));
    for (const fl of expectedFloors) {
      expect(catalogFloorIds.has(fl)).toBe(true);
    }
    expect(FULL_ASSET_CATALOG.length).toBeGreaterThanOrEqual(allFurnitureKinds.length + expectedFloors.length);
  });
});
