// Peças da aparência que dá para escolher no editor do personagem: as listas dos estilos, a validação do que chega
// pela API e uma assinatura estável. As paletas e as regras de combinação ficam na arte
// (client/src/art/character/appearance.ts, editorOptions); aqui fica só o formato. Puro: sem Node nem DOM.

export const HAIR_STYLES = [
  'short', 'buzz', 'spiky', 'side_part', 'curly', 'afro', 'bob', 'long', 'ponytail', 'bun', 'pigtails', 'mohawk', 'bald', 'wavy',
] as const;
export const TOP_STYLES = ['tshirt', 'hoodie', 'shirt_tie', 'sweater', 'jacket', 'blouse', 'polo'] as const;
export const ACCESSORIES = ['none', 'glasses', 'sunglasses', 'headphones', 'cap', 'beanie', 'earrings', 'bow'] as const;
export const FACIAL_HAIR = ['none', 'stubble', 'beard', 'mustache', 'goatee'] as const;
export const BOTTOM_STYLES = ['pants', 'shorts', 'skirt'] as const;

/** Peças escolhidas no editor, aplicadas por cima da aparência sorteada pela `seed`. Cores em `#rrggbb`. */
export interface AppearanceParts {
  skin?: string;
  hair?: string;
  hairStyle?: (typeof HAIR_STYLES)[number];
  eyes?: string;
  top?: string;
  topAccent?: string;
  topStyle?: (typeof TOP_STYLES)[number];
  bottom?: string;
  bottomStyle?: (typeof BOTTOM_STYLES)[number];
  shoes?: string;
  accessory?: (typeof ACCESSORIES)[number];
  accessoryColor?: string;
  facialHair?: (typeof FACIAL_HAIR)[number];
}

/**
 * Ordem fixa das peças: a mesma em parseAppearanceParts, partsKey e no editor (changedParts). O timelapse compara
 * por JSON, então a ordem precisa ser estável.
 */
export const PART_KEYS = [
  'skin', 'hair', 'hairStyle', 'eyes', 'top', 'topAccent', 'topStyle', 'bottom', 'bottomStyle', 'shoes', 'accessory',
  'accessoryColor', 'facialHair',
] as const satisfies readonly (keyof AppearanceParts)[];
export type PartKey = (typeof PART_KEYS)[number];

const STYLE_VALUES: Partial<Record<PartKey, readonly string[]>> = {
  hairStyle: HAIR_STYLES,
  topStyle: TOP_STYLES,
  bottomStyle: BOTTOM_STYLES,
  accessory: ACCESSORIES,
  facialHair: FACIAL_HAIR,
};
const COLOR = /^#[0-9a-f]{6}$/i;
// Controle (C0/C1), separadores de linha e parágrafo (U+2028/2029) e marcas de direção do texto (U+200E/200F,
// U+202A–202E, U+2066–2069): dá para disfarçar um nome com elas.
const CONTROL = /[\p{Cc}\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export const NAME_MAX = 24;

/** Peças válidas na ordem de PART_KEYS (cores em minúsculas), ou null se houver algo fora do formato. */
export function parseAppearanceParts(raw: unknown): AppearanceParts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  for (const k of Object.keys(src)) if (!(PART_KEYS as readonly string[]).includes(k)) return null;
  const out: Record<string, string> = {};
  for (const k of PART_KEYS) {
    const v = src[k];
    if (v === undefined) continue;
    if (typeof v !== 'string') return null;
    const allowed = STYLE_VALUES[k];
    if (allowed ? !allowed.includes(v) : !COLOR.test(v)) return null;
    out[k] = allowed ? v : v.toLowerCase();
  }
  return out as AppearanceParts;
}

/** Nome do personagem: NFC, sem espaços sobrando, de 1 a NAME_MAX caracteres e sem caracteres de controle. */
export function parseCharacterName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!name || CONTROL.test(name) || [...name].length > NAME_MAX) return null;
  return name;
}

/** Semente da aparência: inteiro de 32 bits sem sinal. */
export function parseSeed(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 0xffffffff ? raw : null;
}

/** Chave para comparar nomes: "ana" e "Ana" (ou "Júlia" em NFD e em NFC) são o mesmo nome. */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('pt-BR');
}

/** Assinatura estável de `parts` (cache de avatares e detecção de mudança). */
export function partsKey(parts: AppearanceParts | undefined): string {
  return parts ? PART_KEYS.map((k) => parts[k] ?? '').join(',') : '';
}

export interface CustomAppearancePayload {
  v: 1;
  name?: string;
  role?: string;
  look?: 'f' | 'm';
  seed?: number;
  parts?: AppearanceParts;
  companionPokemon?: string;
  companionPetId?: string;
  companionPetName?: string;
}

function utf8ToBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlToUtf8(b64u: string): string | null {
  try {
    let b64 = b64u.replaceAll('-', '+').replaceAll('_', '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function cleanOptionalText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.normalize('NFC').replace(/[\r\n\t]+/g, ' ').trim();
  if (!s || CONTROL.test(s)) return undefined;
  return s.slice(0, max);
}

/** 将捏脸数据编码为跨对话可粘贴的短代码字符串（AP1:...）。 */
export function encodeAppearanceCode(input: Omit<CustomAppearancePayload, 'v'>): string {
  const payload: CustomAppearancePayload = {
    v: 1,
    ...(cleanOptionalText(input.name, 32) ? { name: cleanOptionalText(input.name, 32) } : {}),
    ...(cleanOptionalText(input.role, 32) ? { role: cleanOptionalText(input.role, 32) } : {}),
    ...(input.look === 'f' || input.look === 'm' ? { look: input.look } : {}),
    ...(parseSeed(input.seed) !== null ? { seed: input.seed } : {}),
    ...(input.parts && Object.keys(input.parts).length ? { parts: parseAppearanceParts(input.parts) ?? undefined } : {}),
    ...(cleanOptionalText(input.companionPokemon, 40) ? { companionPokemon: cleanOptionalText(input.companionPokemon, 40) } : {}),
    ...(cleanOptionalText(input.companionPetId, 48) ? { companionPetId: cleanOptionalText(input.companionPetId, 48) } : {}),
    ...(cleanOptionalText(input.companionPetName, 24) ? { companionPetName: cleanOptionalText(input.companionPetName, 24) } : {}),
  };
  return `AP1:${utf8ToBase64Url(JSON.stringify(payload))}`;
}

/** 解析用户从本地 HTML 或网页工坊复制回来的 AP1:... 捏脸代码。 */
export function decodeAppearanceCode(raw: unknown): CustomAppearancePayload | null {
  if (typeof raw !== 'string') return null;
  const m = /\bAP1:([A-Za-z0-9_-]+)/.exec(raw.trim());
  if (!m) return null;
  const jsonText = base64UrlToUtf8(m[1]);
  if (!jsonText) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const src = obj as Record<string, unknown>;
  const parts = src.parts !== undefined ? parseAppearanceParts(src.parts) : undefined;
  if (src.parts !== undefined && !parts) return null;
  const seed = src.seed !== undefined ? parseSeed(src.seed) : undefined;
  if (src.seed !== undefined && seed === null) return null;
  const look = src.look === 'f' || src.look === 'm' ? src.look : undefined;
  return {
    v: 1,
    ...(cleanOptionalText(src.name, 32) ? { name: cleanOptionalText(src.name, 32) } : {}),
    ...(cleanOptionalText(src.role, 32) ? { role: cleanOptionalText(src.role, 32) } : {}),
    ...(look ? { look } : {}),
    ...(typeof seed === 'number' ? { seed } : {}),
    ...(parts ? { parts } : {}),
    ...(cleanOptionalText(src.companionPokemon, 40) ? { companionPokemon: cleanOptionalText(src.companionPokemon, 40) } : {}),
    ...(cleanOptionalText(src.companionPetId, 48) ? { companionPetId: cleanOptionalText(src.companionPetId, 48) } : {}),
    ...(cleanOptionalText(src.companionPetName, 24) ? { companionPetName: cleanOptionalText(src.companionPetName, 24) } : {}),
  };
}
