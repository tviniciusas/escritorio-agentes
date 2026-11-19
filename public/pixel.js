/* pixel.js — a base da arte: medidas, cores e primitivas de pixel.
 *
 * O mundo é medido em "pixels lógicos" (16 por tile), mas a arte é desenhada com o dobro da resolução
 * (HD = 2: 32 pixels de arte por tile, como no Gather). Todo canvas de sprite já vem com scale(HD), então
 * as coordenadas continuam em pixels lógicos e o meio pixel (U = 0,5) é um pixel da arte.
 * Regra: só múltiplos de U nas coordenadas, para nada sair borrado.
 */
export const T = 16;                 // lado de um tile, em px lógicos
export const HD = 2;                 // pixels de arte por pixel lógico
export const U = 1 / HD;             // um pixel de arte, em px lógicos
export const rh = (v) => Math.round(v * HD) / HD;   // arredonda para um pixel de arte

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function hashStr(s) { // FNV-1a
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// cores: [r,g,b] <-> 'rgb(...)'
export function parseColor(c) {
  if (typeof c !== 'string') return [139, 147, 161];
  let s = c.trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  const n = parseInt(s, 16);
  if (s.length !== 6 || Number.isNaN(n)) return [139, 147, 161];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (a) => `rgb(${Math.round(a[0])},${Math.round(a[1])},${Math.round(a[2])})`;
export const shade = (a, t) => (t < 0 ? mix(a, [0, 0, 0], -t) : mix(a, [255, 255, 255], t));

// paleta derivada da cor da plataforma (em cache)
const PAL = new Map();
export function platPal(cor) {
  let p = PAL.get(cor);
  if (p) return p;
  const c = parseColor(cor);
  p = {
    cor, c,
    shirt: css(c), shirtD: css(mix(c, [40, 20, 60], 0.3)), shirtL: css(shade(c, 0.3)), shirtO: css(mix(c, [24, 14, 34], 0.66)),
    accent: css(shade(c, 0.12)), glow: css(shade(c, 0.6)), soft: css(shade(c, 0.5)), dark: css(mix(c, [20, 16, 34], 0.55)),
  };
  PAL.set(cor, p);
  return p;
}
export const dk = (hex, t) => css(mix(parseColor(hex), [24, 16, 32], t));        // tom escuro de uma cor (contornos, sombras)
export const lt = (hex, t) => css(mix(parseColor(hex), [255, 244, 224], t));     // tom claro (luzes)

// ---------- primitivas (nada de antialias nos sprites: só fillRect) ----------
export function rect(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
// contorno de elipse achatada (anel de seleção no chão)
export function ringEllipse(g, cx, cy, rx, ry, c) {
  g.fillStyle = c;
  for (let dy = -ry; dy <= ry; dy += U) {
    const half = rh(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + 0.01))));
    if (dy === -ry || dy === ry) g.fillRect(cx - half + 1, cy + dy, half * 2 - 2, U);
    else { g.fillRect(cx - half, cy + dy, 1, U); g.fillRect(cx + half - 1, cy + dy, 1, U); }
  }
}
// cantos de um retângulo (marcação da estação de quem está sentado)
export function brackets(g, x0, y0, x1, y1, c) {
  g.fillStyle = c;
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    g.fillRect(sx > 0 ? x : x - 5, y, 6, 1); g.fillRect(x, sy > 0 ? y : y - 5, 1, 6);
  }
}
export function blob(g, cx, cy, rx, ry, c) { // elipse pixelada, linha a linha de arte
  g.fillStyle = c;
  for (let dy = -ry; dy <= ry; dy += U) { const half = rh(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + 0.01)))); g.fillRect(cx - half, cy + dy, half * 2 + U, U); }
}
// sombra suave em duas camadas (elipse achatada no chão)
export function softShadow(g, cx, cy, rx, ry, a = 1) {
  blob(g, cx, cy, rx, ry, `rgba(50,42,72,${0.09 * a})`);
  blob(g, cx, cy, Math.max(1, rx - 1.5), Math.max(U, ry - 1), `rgba(50,42,72,${0.13 * a})`);
}

// canvas de sprite: w x h em px lógicos, com HD px de arte por px lógico (o contexto já vem escalado)
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * HD)); c.height = Math.max(1, Math.ceil(h * HD));
  c.lw = c.width / HD; c.lh = c.height / HD;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.scale(HD, HD);
  return [c, g];
}
// canvas cru, em px do dispositivo (textos)
export function rawCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const g = c.getContext('2d');
  return [c, g];
}
// desenha um canvas de sprite no mundo (x, y em px lógicos)
export function put(g, c, x, y) { g.drawImage(c, x, y, c.lw, c.lh); }
// idem, para um sprite com âncora
export function putS(g, s, x, y) { g.drawImage(s.c, x - s.ax, y - s.ay, s.c.lw, s.c.lh); }

// Contorno automático, como no Gather: todo pixel vazio (ou de sombra) encostado num pixel cheio vira um
// tom escuro da cor vizinha. f = quanto escurece (0..1).
export function contorno(c, f = 0.58) {
  const g = c.getContext('2d'), w = c.width, h = c.height;
  const im = g.getImageData(0, 0, w, h), d = im.data, src = new Uint8ClampedArray(d);
  const TR = 30, TG = 26, TB = 52;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] >= 200) continue;
      let r = 0, gg = 0, b = 0, n = 0, j;
      if (x > 0 && src[(j = i - 4) + 3] >= 200) { r += src[j]; gg += src[j + 1]; b += src[j + 2]; n++; }
      if (x < w - 1 && src[(j = i + 4) + 3] >= 200) { r += src[j]; gg += src[j + 1]; b += src[j + 2]; n++; }
      if (y > 0 && src[(j = i - w * 4) + 3] >= 200) { r += src[j]; gg += src[j + 1]; b += src[j + 2]; n++; }
      if (y < h - 1 && src[(j = i + w * 4) + 3] >= 200) { r += src[j]; gg += src[j + 1]; b += src[j + 2]; n++; }
      if (!n) continue;
      d[i] = (r / n) * (1 - f) + TR * f; d[i + 1] = (gg / n) * (1 - f) + TG * f; d[i + 2] = (b / n) * (1 - f) + TB * f; d[i + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
}
// sprite com âncora: cobre [x0,x1) x [y0,y1) em coordenadas da âncora. ol > 0 = contorno automático
export function makeSprite(x0, y0, x1, y1, fn, ol = 0) {
  const [c, g] = makeCanvas(x1 - x0, y1 - y0);
  fn(g, -x0, -y0);
  if (ol) contorno(c, ol);
  return { c, ax: -x0, ay: -y0 };
}
const SPR = new Map();
export function sprite(key, build) { let s = SPR.get(key); if (!s) { s = build(); SPR.set(key, s); } return s; }
