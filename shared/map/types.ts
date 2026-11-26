import type { Dir, FloorKind, FurnitureKind, WallStyle } from '../../client/src/art/api';
import type { AreaKind, ExteriorProp, SpotKind, TileRect } from '../../client/src/world/layout/types';

export const MAP_FORMAT = 'agent-party-map@1' as const;
export const MIN_MAP_SIZE = 16;
export const MAX_MAP_SIZE = 512;
export const DEFAULT_MAP_W = 96;
export const DEFAULT_MAP_H = 64;
export const MAX_MAP_ITEMS = 8000;

export type SpriteRot = 0 | 90 | 180 | 270;

export interface CustomLayerGroup {
  id: string;
  name: string;
  parentId?: string;
  collapsed?: boolean;
  visible?: boolean;
  locked?: boolean;
  rot?: SpriteRot;
  flipX?: boolean;
  flipY?: boolean;
}

export interface FloorPaletteEntry {
  kind: FloorKind;
  tint?: string;
  tint2?: string;
}

export interface CustomWallDoorway {
  /** Offset in tiles from wall.tx (can be fractional e.g. 7). */
  offset: number;
  /** Width in tiles (usually 2). */
  w: number;
}

export interface CustomWallBlock {
  id: string;
  kind: 'face' | 'south' | 'cap';
  /** Top-left tile coordinates (face is 2 tiles tall, south is 1 tile tall, cap is w×h). */
  tx: number;
  ty: number;
  w: number;
  h: number;
  style: WallStyle;
  doorways?: CustomWallDoorway[];
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface CustomZone {
  id: string;
  name: string;
  kind: AreaKind;
  rect: TileRect;
  accentColor?: string;
  floorTint?: string;
  hasLightSwitch?: boolean;
  tags?: string[];
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface CustomFurnitureItem {
  id: string;
  kind: FurnitureKind;
  tx: number;
  ty: number;
  variant?: string;
  dx?: number;
  dy?: number;
  dir?: Dir;
  seat?: string;
  deskId?: string;
  /** Future extensibility hooks for per-member seat binding. */
  reservedFor?: string;
  tags?: string[];
  groupId?: string;
  rot?: SpriteRot;
  flipX?: boolean;
  flipY?: boolean;
  hidden?: boolean;
  locked?: boolean;
}

export interface CustomWallItem {
  id: string;
  kind: FurnitureKind;
  /** Center X in tiles (supports 0.5 increments). */
  tx: number;
  /** Baseboard Y in tiles (e.g. north wall ty + 2, south wall ty + 1). */
  ty: number;
  on: 'face' | 'south';
  variant?: string;
  zoneId?: string;
  groupId?: string;
  rot?: SpriteRot;
  flipX?: boolean;
  flipY?: boolean;
  hidden?: boolean;
  locked?: boolean;
}

export interface CustomRug {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  seed?: number;
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface CustomSpawnPoint {
  id: string;
  tx: number;
  ty: number;
  dir?: Dir;
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface CustomSpotOverride {
  id: string;
  kind: SpotKind;
  areaId?: string;
  tx: number;
  ty: number;
  dir: Dir;
  seated?: boolean;
  furnitureId?: string;
  deskId?: string;
  group?: string;
  rank?: number;
  reservedFor?: string;
  tags?: string[];
}

export interface CustomMapDocument {
  format: typeof MAP_FORMAT;
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  author?: string;
  updatedAt: number;
  backgroundFloor: FloorKind;
  floorPalette: FloorPaletteEntry[];
  /** RLE compressed rows, length === height, each row encodes `width` palette indices. */
  floorRows: string[];
  rugs: CustomRug[];
  walls: CustomWallBlock[];
  wallItems: CustomWallItem[];
  furniture: CustomFurnitureItem[];
  zones: CustomZone[];
  props: ExteriorProp[];
  spawns: CustomSpawnPoint[];
  spots?: CustomSpotOverride[];
  groups?: CustomLayerGroup[];
}

export interface MapSelection {
  x: number;
  y: number;
  w: number;
  h: number;
  note?: string;
  updatedAt: number;
}

export interface StudioTaskBox {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  note?: string;
}

export type StudioTaskStatus = 'queued' | 'running' | 'review' | 'accepted' | 'reverted' | 'cancelled';

export interface StudioTaskSummary {
  id: string;
  seq: number;
  status: StudioTaskStatus;
  boxes: StudioTaskBox[];
  instruction?: string;
  aiSummary?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  touchedRects: TileRect[];
}

export interface StudioMcpPresence {
  connected: boolean;
  listening: boolean;
  clientName?: string;
  transport?: 'http' | 'stdio';
  lastSeenAt: number;
  activeTaskId: string | null;
}

export interface MapPresetSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
  author?: string;
  deskCount: number;
  zoneCount: number;
}

export interface MapValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    width: number;
    height: number;
    zones: number;
    desksTotal: number;
    desksByDir: Record<Dir, number>;
    noBackViewSeats: number;
    leisureSpots: number;
    spawns: number;
    elevators: number;
    hasArena: boolean;
    unreachableSpots: Array<{ id: string; kind: SpotKind; tx: number; ty: number }>;
  };
}
