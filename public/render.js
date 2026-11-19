/* render.js — a cena do escritório em VISTA RETA (de frente e de cima, 3/4), canvas 2D, tudo procedural.
 *
 * Ideias principais:
 *  - O mundo é desenhado em "pixels lógicos" e ampliado por um fator INTEIRO (this.k, em
 *    pixels do dispositivo por pixel lógico), então os pixels ficam nítidos.
 *  - O piso é uma grade de tiles quadrados de 16x16. A parede dos fundos aparece de frente (faixa
 *    no alto, com janelas, quadros e a porta do elevador); as laterais são bordas finas; embaixo, a laje.
 *  - Cada plataforma presente ganha uma "zona" (carpete com a cor dela). Cada agente tem uma mesa
 *    fixa na zona da plataforma, sentado ATRÁS da mesa, de frente para quem olha; ociosos vão ao
 *    lounge; quem sai volta ao elevador. Tudo anda por caminhos (BFS) na grade de tiles.
 *  - Profundidade: ordena pelo y dos pés (o que está mais embaixo na tela desenha na frente).
 *  - Arte: paleta curta e quente, contorno seletivo nas pessoas (tom escuro do próprio preenchimento),
 *    sombras de contato, carpetes tecidos, luz de janela e um leve tom de fim de tarde. Pessoas e
 *    móveis são sprites em cache; só telas, vapor, plantas e luz são animados por quadro.
 *  - Textos (nomes, balões, placas) usam uma fonte bitmap 3x5 própria (maiúsculas, minúsculas e
 *    acentos do português), desenhada em espaço de tela com escala inteira; os nomes desviam uns
 *    dos outros e das placas das zonas.
 */

// =====================================================================
// 1. CONSTANTES
// =====================================================================
const T = 16;                   // lado de um tile (px lógicos)
const WALL_H = 48;              // altura da parede dos fundos (faixa vista de frente)
const SIDE = 4;                 // espessura das paredes laterais
const SLAB = 6;                 // laje do piso (borda da frente)
const COLS = 3;                 // mesas por fileira numa zona
const GAP = 1;                  // espaço entre zonas (tiles)
const HALL_D = 4;               // profundidade do saguão (elevador + lounge)
const HALL_MIN_W = 17;
const LOUNGE_W = 9;             // largura do lounge, encostado no canto direito
const DOOR_X = 2.5;             // centro da porta do elevador (em tiles)
const SPEED = 3.0;              // tiles por segundo
const IDLE_DELAY = 2500;        // ms parado na mesa antes de ir ao lounge
const ZZ_DELAY = 5000;          // ms no lounge até aparecer o "zz"
const TOPM = 2;                 // faixas de cima da zona: a 1ª fica livre, a 2ª é corredor (os nomes não encostam na placa)
const SEAT_DY = 6;              // quanto o quadril de quem senta fica abaixo da borda de cima da mesa
const T_SPR = 0, T_DESK = 1, T_CBACK = 3, T_ACTOR = 4, T_COFFEE = 5, T_PLANT = 6;

const HALL_A = [220, 208, 188], HALL_B = [211, 198, 177], GROUT = '#c4b498';
const WALL_BACK = '#7d89b0', WALL_LOW = '#65729a', WALL_BASE = '#363f5d', WALL_CAP = '#a3b0cf', WALL_SIDE = '#4c5878';
const WOOD = ['#f0cf9b', '#d9ad74', '#c79d66', '#a97d4b', '#8b6a40'];     // madeira: luz, base, veio, frente, sombra

// =====================================================================
// 2. UTILIDADES
// =====================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const byKey = (a, b) => a.key - b.key;

function hashStr(s) { // FNV-1a
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// cores: [r,g,b] <-> 'rgb(...)'
function parseColor(c) {
  if (typeof c !== 'string') return [139, 147, 161];
  let s = c.trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  const n = parseInt(s, 16);
  if (s.length !== 6 || Number.isNaN(n)) return [139, 147, 161];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (a) => `rgb(${Math.round(a[0])},${Math.round(a[1])},${Math.round(a[2])})`;
const shade = (a, t) => (t < 0 ? mix(a, [0, 0, 0], -t) : mix(a, [255, 255, 255], t));


// paleta derivada da cor da plataforma (em cache)
const PAL = new Map();
function platPal(cor) {
  let p = PAL.get(cor);
  if (p) return p;
  const c = parseColor(cor);
  const fundo = [38, 36, 52];
  p = {
    cor, c,
    shirt: css(c), shirtD: css(mix(c, [40, 20, 60], 0.3)), shirtL: css(shade(c, 0.3)), shirtO: css(mix(c, [24, 14, 34], 0.66)),
    carpetA: css(mix(c, fundo, 0.64)), carpetB: css(mix(c, fundo, 0.55)), carpetC: css(mix(c, fundo, 0.72)),
    trim: css(mix(c, [14, 12, 24], 0.74)), braid: css(mix(c, fundo, 0.3)), braidL: css(mix(c, [255, 240, 220], 0.28)),
    accent: css(shade(c, 0.12)), glow: css(shade(c, 0.6)), glowRgb: `${Math.round(shade(c, 0.5)[0])},${Math.round(shade(c, 0.5)[1])},${Math.round(shade(c, 0.5)[2])}`,
    dark: css(mix(c, [20, 16, 34], 0.55)),
  };
  PAL.set(cor, p);
  return p;
}
const dk = (hex, t) => css(mix(parseColor(hex), [24, 16, 32], t));        // tom escuro de uma cor (contornos, sombras)
const lt = (hex, t) => css(mix(parseColor(hex), [255, 244, 224], t));     // tom claro (luzes)

// =====================================================================
// 3. FONTE BITMAP 3x5 com minúsculas e acentos do português
//    Linhas 0..4 = maiúsculas; linha 4 = linha de base; linha 5 = descendentes; acento fica uma linha acima do topo.
// =====================================================================
const FONT_SRC = {
  A: '.#./#.#/###/#.#/#.#', B: '##./#.#/##./#.#/##.', C: '.##/#../#../#../.##', D: '##./#.#/#.#/#.#/##.',
  E: '###/#../##./#../###', F: '###/#../##./#../#..', G: '.##/#../#.#/#.#/.##', H: '#.#/#.#/###/#.#/#.#',
  I: '###/.#./.#./.#./###', J: '..#/..#/..#/#.#/.#.', K: '#.#/#.#/##./#.#/#.#', L: '#../#../#../#../###',
  M: '#...#/##.##/#.#.#/#...#/#...#', N: '###/#.#/#.#/#.#/#.#', O: '.#./#.#/#.#/#.#/.#.', P: '##./#.#/##./#../#..',
  Q: '.#./#.#/#.#/##./.##', R: '##./#.#/##./#.#/#.#', S: '.##/#../.#./..#/##.', T: '###/.#./.#./.#./.#.',
  U: '#.#/#.#/#.#/#.#/###', V: '#.#/#.#/#.#/#.#/.#.', W: '#...#/#...#/#.#.#/#.#.#/.#.#.', X: '#.#/#.#/.#./#.#/#.#',
  Y: '#.#/#.#/.#./.#./.#.', Z: '###/..#/.#./#../###',
  0: '###/#.#/#.#/#.#/###', 1: '.#./##./.#./.#./###', 2: '##./..#/.#./#../###', 3: '##./..#/.#./..#/##.',
  4: '#.#/#.#/###/..#/..#', 5: '###/#../##./..#/##.', 6: '.##/#../###/#.#/###', 7: '###/..#/.#./.#./.#.',
  8: '###/#.#/###/#.#/###', 9: '###/#.#/###/..#/##.',
  ' ': '../../../../..', '.': '././././#', ',': '../../../.#/#.', ':': './#/./#/.', ';': '../.#/../.#/#.',
  '!': '#/#/#/./#', '?': '##./..#/.#./.../.#.', '-': '.../.../###/.../...', _: '.../.../.../.../###',
  '+': '.../.#./###/.#./...', '/': '..#/..#/.#./#../#..', '\\': '#../#../.#./..#/..#', '(': '.#/#./#./#./.#', ')': '#./.#/.#/.#/#.',
  "'": '#/#/././.', '"': '#.#/#.#/.../.../...', '=': '.../###/.../###/...', '*': '.../#.#/.#./#.#/...', '#': '#.#/###/#.#/###/#.#',
  '%': '#.#/..#/.#./#../#.#', '<': '..#/.#./#../.#./..#', '>': '#../.#./..#/.#./#..', '[': '##/#./#./#./##', ']': '##/.#/.#/.#/##',
  '@': '###/#.#/###/#../###', '&': '.#./#.#/.#./#.#/.##', '|': '#/#/#/#/#', '~': '.../.##/##./.../...', '$': '.##/##./.#./.##/##.',
  '…': '...../...../...../...../#.#.#',
};

const LOWER_SRC = {
  a: '.../##./.##/#.#/.##/...', b: '#../#../##./#.#/##./...', c: '.../.##/#../#../.##/...', d: '..#/..#/.##/#.#/.##/...',
  e: '.../.##/#.#/##./.##/...', f: '.##/.#./###/.#./.#./...', g: '.../.##/#.#/.##/..#/##.', h: '#../#../##./#.#/#.#/...',
  i: '.#./.../.#./.#./.#./...', j: '..#/.../..#/..#/..#/##.', k: '#../#.#/##./#.#/#.#/...', l: '##./.#./.#./.#./.##/...',
  m: '...../##.#./#.#.#/#.#.#/#...#/.....', n: '.../##./#.#/#.#/#.#/...', o: '.../.#./#.#/#.#/.#./...', p: '.../##./#.#/##./#../#..',
  q: '.../.##/#.#/.##/..#/..#', r: '.../.##/#../#../#../...', s: '.../.##/#../..#/##./...', t: '.#./###/.#./.#./.##/...',
  u: '.../#.#/#.#/#.#/.##/...', v: '.../#.#/#.#/#.#/.#./...', w: '...../#...#/#.#.#/#.#.#/.#.#./.....', x: '.../#.#/.#./.#./#.#/...',
  y: '.../#.#/#.#/.##/..#/##.', z: '.../###/..#/.#./###/...',
};
function mkGlyph(src) {
  const rows = src.split('/'), w = rows[0].length;
  while (rows.length < 6) rows.push('.'.repeat(w));
  let top = 6, bot = -1;
  rows.forEach((r, i) => { if (r.includes('#')) { if (i < top) top = i; bot = i; } });
  return { w, rows, top: top === 6 ? 0 : top, bot };
}
const FONT = {};
for (const k of Object.keys(FONT_SRC)) FONT[k] = mkGlyph(FONT_SRC[k]);
for (const k of Object.keys(LOWER_SRC)) FONT[k] = mkGlyph(LOWER_SRC[k]);
const glyph = (ch) => FONT[ch] || FONT['?'];
// texto -> lista de {g: glifo, acc: código do acento combinante}
function layout(str) {
  const out = [];
  for (const ch of String(str ?? '').replace(/[\r\n\t]+/g, ' ').normalize('NFD')) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x300 && cp <= 0x36f) { if (out.length) out[out.length - 1].acc = cp; continue; }
    out.push({ g: glyph(ch), acc: 0 });
  }
  return out;
}
// largura e linhas extras (acento acima de uma maiúscula/ascendente, cedilha ou descendente abaixo)
function textBox(str) {
  const L = layout(str);
  let w = 0, up = 0, down = 0;
  for (const it of L) {
    w += it.g.w + 1;
    if (it.acc === 0x327 || it.g.bot >= 5) down = 1;
    if (it.acc && it.acc !== 0x327 && it.g.top === 0) up = 1;
  }
  return { w: Math.max(0, w - 1), up, down };
}
const textW = (str) => textBox(str).w;
// y = linha 0 do texto
function drawText(g, str, x, y, color) {
  g.fillStyle = color;
  let cx = x;
  for (const it of layout(str)) {
    const gl = it.g;
    for (let r = 0; r < 6; r++) { const row = gl.rows[r]; for (let c = 0; c < gl.w; c++) if (row.charCodeAt(c) === 35) g.fillRect(cx + c, y + r, 1, 1); }
    if (it.acc) {
      const ry = y + gl.top - 1;
      if (it.acc === 0x301) g.fillRect(cx + gl.w - 1, ry, 1, 1);                      // agudo
      else if (it.acc === 0x300) g.fillRect(cx, ry, 1, 1);                            // grave
      else if (it.acc === 0x302) g.fillRect(cx + (gl.w >> 1), ry, 1, 1);             // circunflexo
      else if (it.acc === 0x303) { g.fillRect(cx, ry, 1, 1); g.fillRect(cx + gl.w - 1, ry, 1, 1); }   // til
      else if (it.acc === 0x327) g.fillRect(cx + (gl.w >> 1), y + 5, 1, 1);          // cedilha
    }
    cx += gl.w + 1;
  }
}
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };

// =====================================================================
// 4. PRIMITIVAS DE PIXEL (nada de antialias: só fillRect)
// =====================================================================
function rect(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
// paralelogramo de lados verticais: o topo sobe/desce 'slope' px por coluna (monitor virado de lado).
// 'off' = colunas já "gastas" antes, para o recorte interno acompanhar a moldura.
function parQuad(g, x, y, w, h, slope, c, off = 0) {
  g.fillStyle = c;
  for (let i = 0; i < w; i++) g.fillRect(x + i, y + Math.round(slope * (i + off + 0.5)), 1, h);
}
// contorno de elipse achatada (anel de seleção no chão)
function ringEllipse(g, cx, cy, rx, ry, c) {
  g.fillStyle = c;
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry + 0.01)));
    if (dy === -ry || dy === ry) g.fillRect(cx - half + 2, cy + dy, half * 2 - 3, 1);
    else { g.fillRect(cx - half, cy + dy, 2, 1); g.fillRect(cx + half - 1, cy + dy, 2, 1); }
  }
}
// cantos de um retângulo (marcação da estação de quem está sentado)
function brackets(g, x0, y0, x1, y1, c) {
  g.fillStyle = c;
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    g.fillRect(sx > 0 ? x : x - 4, y, 5, 1); g.fillRect(x, sy > 0 ? y : y - 4, 1, 5);
  }
}
function blob(g, cx, cy, rx, ry, c) { // elipse pixelada
  g.fillStyle = c;
  for (let dy = -ry; dy <= ry; dy++) { const half = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry + 0.01))); g.fillRect(cx - half, cy + dy, half * 2 + 1, 1); }
}
// sombra suave em duas camadas (elipse achatada no chão)
function softShadow(g, cx, cy, rx, ry, a = 1) {
  g.fillStyle = `rgba(30,20,40,${0.09 * a})`;
  for (let dy = -ry; dy <= ry; dy++) { const h = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry + 0.01))); g.fillRect(cx - h, cy + dy, h * 2 + 1, 1); }
  g.fillStyle = `rgba(30,20,40,${0.13 * a})`;
  const r2 = Math.max(1, ry - 1), x2 = Math.max(1, rx - 2);
  for (let dy = -r2; dy <= r2; dy++) { const h = Math.round(x2 * Math.sqrt(1 - (dy * dy) / (r2 * r2 + 0.01))); g.fillRect(cx - h, cy + dy, h * 2 + 1, 1); }
}
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; }
// sprite com âncora: cobre [x0,x1)x[y0,y1) em coordenadas da âncora
function makeSprite(x0, y0, x1, y1, fn) {
  const [c, g] = makeCanvas(x1 - x0, y1 - y0);
  fn(g, -x0, -y0);
  return { c, ax: -x0, ay: -y0 };
}
const SPR = new Map();
function sprite(key, build) { let s = SPR.get(key); if (!s) { s = build(); SPR.set(key, s); } return s; }


// =====================================================================
// 5. SPRITES ESTÁTICOS DA MOBÍLIA (vista de frente/de cima)
// =====================================================================
// Mesa de 2 tiles. Âncora = canto de cima à esquerda da linha da mesa (y = "base"). O tampo começa
// 2 px acima da base (a pessoa senta logo atrás dele); a tela do monitor é desenhada por cima.
// 'v' escolhe os objetos em cima: 0 caneca e bloquinho, 1 vasinho, 2 papéis, 3 luminária.
function sprDesk(pal, v) {
  return sprite(`desk|${pal.cor}|${v}`, () => makeSprite(-3, -22, 35, 24, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    const rnd = mulberry32(hashStr(pal.cor) + v * 977);
    // tampo de madeira visto de cima: tábuas, veios e quinas iluminadas
    R(0, -2, 32, 11, WOOD[1]);
    for (const y of [1, 4, 7]) R(0, y, 32, 1, WOOD[2]);
    for (let i = 0; i < 10; i++) R((rnd() * 26) | 0, -1 + ((rnd() * 9) | 0), 2 + ((rnd() * 4) | 0), 1, rnd() < 0.5 ? WOOD[2] : '#e4bd86');
    R(0, -2, 32, 1, WOOD[0]); R(0, -2, 1, 11, '#e6c18a'); R(31, -2, 1, 11, WOOD[2]);
    R(0, 8, 32, 1, '#b58650');
    // frente com gavetas, puxadores, faixa na cor da plataforma e pés
    R(0, 9, 32, 7, WOOD[3]); R(0, 9, 32, 1, WOOD[4]);
    for (const x of [3, 17]) {
      R(x, 10, 12, 4, '#97703f'); R(x, 10, 12, 1, '#bb925e'); R(x, 13, 12, 1, '#7a5a33');
      R(x + 4, 11, 4, 1, '#e8e0c4'); R(x + 4, 12, 4, 1, '#8d8466');
    }
    R(1, 14, 30, 1, pal.shirt); R(0, 15, 32, 1, '#5b4024');
    R(0, 16, 3, 1, '#3d2a17'); R(29, 16, 3, 1, '#3d2a17');
    // teclado (teclas claras) e mouse
    R(10, 3, 12, 5, '#b3bccb'); R(10, 3, 12, 1, '#d8dee9'); R(10, 7, 12, 1, '#8b94a7');
    for (const y of [4, 6]) for (let i = 0; i < 5; i++) R(11 + i * 2, y, 1, 1, '#f1f4f9');
    R(24, 4, 3, 4, '#dfe4ee'); R(24, 4, 3, 1, '#f6f8fb'); R(25, 5, 1, 1, '#aab2c1');
    // objetos da direita (variam por mesa)
    if (v === 0) {
      R(27, -1, 4, 5, '#f1ede4'); R(27, -1, 4, 1, '#5a3a22'); R(31, 0, 1, 3, '#cfc9bd'); R(27, 3, 4, 1, '#cfc9bd');
      R(28, 5, 4, 3, '#f2efe6'); R(28, 5, 4, 1, '#d7d3c6'); R(29, 6, 2, 1, '#9aa0b5');
    } else if (v === 1) {
      R(27, 2, 4, 4, '#c5714f'); R(27, 2, 4, 1, '#dc8a66'); R(30, 3, 1, 3, '#9b5238');
      blob(g, ax + 29, ay + 0, 2, 2, '#4a9a5c'); R(28, -3, 2, 1, '#6cc27c'); R(30, -1, 1, 1, '#8fe09a');
      R(24, 1, 3, 3, '#f1ede4'); R(24, 1, 3, 1, '#5a3a22');
    } else if (v === 2) {
      R(26, 1, 6, 6, '#f2efe6'); R(26, 6, 6, 1, '#cfcbbf'); R(27, 2, 4, 1, '#9aa0b5'); R(27, 4, 3, 1, '#9aa0b5'); R(25, 3, 6, 5, '#e9e5d8'); R(26, 4, 4, 1, '#b4b8c8');
      R(23, 0, 2, 4, '#d85c5c'); R(23, 0, 2, 1, '#f08a8a');
    } else {
      R(27, 5, 4, 2, '#454c5e'); R(29, -2, 1, 7, '#59617a'); R(26, -5, 6, 3, '#e8c15a'); R(26, -5, 6, 1, '#f7e08e'); R(26, -3, 6, 1, '#c79d3a');
      R(24, 0, 9, 2, 'rgba(255,230,150,0.22)'); R(22, 3, 4, 3, '#f6e57a'); R(22, 3, 4, 1, '#fbf2a6');
    }
    // monitor virado para a pessoa: base, haste, moldura inclinada, brilho e luz de energia
    R(1, 4, 10, 2, '#434b5e'); R(1, 4, 10, 1, '#667089'); R(2, 6, 9, 1, 'rgba(30,20,40,0.22)'); R(4, 1, 3, 3, '#394052');
    parQuad(g, ax + 0, ay - 10, 10, 11, -0.3, '#2a2f3b');
    parQuad(g, ax + 0, ay - 10, 10, 1, -0.3, '#5d667f');
    parQuad(g, ax + 0, ay - 1, 10, 1, -0.3, '#1d212b');
    R(10, -13, 2, 11, '#1d212b'); R(10, -13, 1, 11, '#363d4d');
    R(8, -4, 1, 1, '#53e08a');
  }));
}
// Encosto e braços da cadeira, atrás de quem senta. Âncora = ponto dos pés/quadril da pessoa sentada.
function sprChairBack(pal) {
  return sprite('chairK|' + pal.cor, () => makeSprite(-13, -28, 13, 6, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    R(-8, -20, 16, 15, '#3c455d');
    g.clearRect(ax - 8, ay - 20, 1, 1); g.clearRect(ax + 7, ay - 20, 1, 1);
    R(-7, -21, 14, 1, '#5a678b'); R(-8, -19, 1, 13, '#2a3145'); R(7, -19, 1, 13, '#2a3145');
    R(-7, -19, 1, 11, '#4b587a'); R(-6, -20, 12, 1, '#566383');
    R(-5, -19, 10, 2, pal.accent); R(-5, -17, 10, 1, pal.shirtD);           // faixa do apoio de cabeça
    R(-5, -12, 10, 2, '#485473'); R(-5, -10, 10, 1, '#2f374c');            // lombar
    R(-10, -11, 2, 2, '#2d3446'); R(-10, -12, 2, 1, '#5a678b'); R(8, -11, 2, 2, '#2d3446'); R(8, -12, 2, 1, '#5a678b');   // braços
    R(-10, -9, 1, 4, '#262c3c'); R(9, -9, 1, 4, '#262c3c');
  }));
}
// Âncora = meio da base do tile. s = 0..2 (balanço das folhas)
function sprPlant(v, s) {
  return sprite(`plant|${v}|${s}`, () => makeSprite(-12, -36, 12, 3, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    softShadow(g, ax, ay - 1, 8, 2);
    const G = v ? ['#245c3a', '#3a8a55', '#62b97c', '#a5e8ac'] : ['#235c38', '#3b8a4c', '#64b86c', '#a8e6a0'], dx = s - 1;
    R(-4, -9, 8, 8, '#b9694a'); R(2, -9, 2, 8, '#8f4a33'); R(-4, -9, 1, 8, '#d98a62'); R(-5, -10, 10, 2, '#d98a62'); R(-5, -10, 10, 1, '#eeb08a'); R(-3, -10, 6, 1, '#3a2a1c'); R(-4, -2, 8, 1, '#7a3f2c');
    blob(g, ax, ay - 16, 7, 5, G[0]); blob(g, ax - 5, ay - 13, 4, 4, G[0]); blob(g, ax + 5, ay - 14, 4, 4, G[0]);
    blob(g, ax + dx, ay - 19, 6, 4, G[1]); blob(g, ax - 4 + dx, ay - 15, 4, 3, G[1]); blob(g, ax + 4 + dx, ay - 16, 4, 3, G[1]);
    blob(g, ax + dx * 2, ay - 24, 3, 3, G[1]); blob(g, ax - 1 + dx * 2, ay - 27, 2, 2, G[2]);
    blob(g, ax - 2 + dx, ay - 20, 2, 1, G[2]); blob(g, ax + 3 + dx, ay - 17, 2, 1, G[2]); blob(g, ax - 5, ay - 15, 1, 1, G[2]);
    R(-1 + dx * 2, -27, 1, 1, G[3]); R(-3 + dx, -21, 1, 1, G[3]); R(3 + dx, -18, 1, 1, G[3]); R(0 + dx, -22, 1, 1, G[3]);
    R(-6, -12, 1, 1, G[0]); R(6, -13, 1, 1, G[0]);
  }));
}
function sprCoffee() {
  return sprite('coffee', () => makeSprite(-11, -36, 11, 3, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    softShadow(g, ax, ay - 1, 9, 2);
    R(-7, -30, 14, 30, '#4f586d'); R(-7, -32, 14, 3, '#a4adc0'); R(-7, -32, 14, 1, '#c7cedc'); R(5, -29, 2, 29, '#3a4152'); R(-7, -29, 1, 29, '#69738a');
    R(-5, -26, 10, 8, '#10131a'); R(-5, -26, 10, 1, '#272d3b'); R(-4, -25, 3, 2, '#4ade80'); R(1, -24, 3, 1, '#ff6b5c'); R(0, -22, 4, 1, '#f5b94a');
    R(-5, -14, 10, 9, '#0d1016'); R(-5, -14, 10, 1, '#272d3b'); R(-2, -10, 4, 5, '#f4efe6'); R(-2, -10, 4, 1, '#7a4b2a'); R(2, -9, 1, 3, '#d5cfc4');
    R(-6, -3, 12, 3, '#2f3544'); R(-6, -3, 12, 1, '#566077'); R(-1, -17, 2, 3, '#3b4152');
  }));
}
// Sofá visto de frente, 2 tiles. Âncora = canto de baixo à esquerda da linha do sofá.
function sprSofa(v) {
  const C = v
    ? { back: '#b9694a', backT: '#dc8e66', arm: '#a8613f', armT: '#e29873', cu: '#d98a62', cuT: '#ee9f78', cuS: '#b9694a', lip: '#8d4f36', pip: '#f0b48e', pil: '#3f7f93', pilT: '#6bb3c8' }
    : { back: '#3f7f93', backT: '#5eaabf', arm: '#336b7c', armT: '#66adc2', cu: '#4f93a8', cuT: '#70b8cd', cuS: '#3f7f93', lip: '#2a5766', pip: '#8fd0e0', pil: '#d98a62', pilT: '#ee9f78' };
  return sprite('sofa|' + v, () => makeSprite(-2, -24, 36, 5, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    R(0, 1, 32, 2, 'rgba(30,20,40,0.20)');
    R(1, 0, 3, 2, '#2a2020'); R(28, 0, 3, 2, '#2a2020');
    R(0, -18, 32, 13, C.back); R(0, -18, 32, 2, C.backT);
    for (const x of [8, 16, 24]) R(x, -15, 1, 9, C.cuS);
    for (const y of [-12, -8]) R(1, y, 30, 1, C.cuS);
    R(0, -6, 32, 1, C.lip);
    R(4, -9, 12, 8, C.cu); R(16, -9, 12, 8, C.cu); R(4, -9, 12, 1, C.cuT); R(16, -9, 12, 1, C.cuT); R(15, -9, 2, 8, C.cuS);
    R(4, -2, 24, 1, C.pip); R(4, -1, 24, 2, C.lip);
    R(0, -14, 4, 14, C.arm); R(28, -14, 4, 14, C.arm); R(0, -14, 4, 2, C.armT); R(28, -14, 4, 2, C.armT); R(3, -12, 1, 12, C.lip); R(28, -12, 1, 12, C.lip);
    R(5, -14, 6, 6, C.pil); R(5, -14, 6, 1, C.pilT); R(6, -13, 1, 4, C.pilT); R(9, -9, 2, 1, C.cuS);
  }));
}
function sprTable() {
  return sprite('table', () => makeSprite(-11, -20, 11, 5, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    softShadow(g, ax, ay, 8, 2);
    R(-7, -14, 14, 9, '#d8b48a'); R(-7, -14, 14, 1, '#ecd0ac'); R(-7, -14, 1, 9, '#e6c8a2'); R(-7, -6, 14, 1, '#b8946a'); R(-7, -5, 14, 4, '#a3815a'); R(-7, -5, 14, 1, '#8b6a46');
    R(-6, -1, 2, 2, '#6f5337'); R(4, -1, 2, 2, '#6f5337');
    R(-5, -13, 3, 3, '#f0ece4'); R(-5, -13, 3, 1, '#5a3a22'); R(-2, -12, 1, 2, '#cfcbc0'); R(2, -12, 4, 3, '#4c6fb0'); R(2, -12, 4, 1, '#7e9ee0'); R(2, -10, 4, 1, '#f2efe6');
  }));
}
function sprCooler() {
  return sprite('cooler', () => makeSprite(-10, -40, 10, 3, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    softShadow(g, ax, ay - 1, 8, 2);
    R(-6, -20, 12, 20, '#dfe6f0'); R(-6, -20, 1, 20, '#f4f7fb'); R(4, -20, 2, 20, '#b9c4d4'); R(-6, -20, 12, 1, '#f7f9fc');
    R(-5, -38, 10, 18, '#7fc0ec'); R(-5, -38, 2, 18, '#bfe4fa'); R(3, -38, 2, 18, '#5a9fd0'); R(-4, -36, 1, 6, '#e8f6ff');
    R(-3, -40, 6, 2, '#b4c0d2'); R(-3, -40, 6, 1, '#d8e0ec');
    R(-4, -16, 8, 5, '#9aa8bd'); R(-3, -15, 2, 2, '#e35d5d'); R(1, -15, 2, 2, '#5da0e3'); R(-4, -11, 8, 1, '#6e7a90');
    R(-5, -9, 10, 2, '#6e7a90'); R(-5, -9, 10, 1, '#8c98ad');
  }));
}
// Estante de 2 tiles com livros, quadrinho e vasinho. Âncora = canto de baixo à esquerda.
function sprBookshelf() {
  return sprite('shelf', () => makeSprite(-2, -40, 36, 5, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    const rnd = mulberry32(4242);
    R(0, 1, 32, 2, 'rgba(30,20,40,0.22)');
    R(0, -34, 32, 34, '#7e5b38'); R(0, -34, 32, 2, '#b08a5c'); R(0, -34, 1, 34, '#9a7448'); R(31, -34, 1, 34, '#5f4328');
    R(2, -31, 28, 30, '#4a331e');
    const cols = ['#c0504d', '#4f81bd', '#9bbb59', '#e0a21b', '#8064a2', '#e6e0d0', '#4bacc6', '#d98a62'];
    for (let sh = 0; sh < 3; sh++) {
      const y0 = -31 + sh * 10, bot = y0 + 9;
      let x = 3;
      while (x < 28) {
        const w = 2 + ((rnd() * 2) | 0), h = 5 + ((rnd() * 4) | 0);
        if (sh === 0 && x > 18 && x < 25) { x += 3; continue; }
        R(x, bot - h, w, h, cols[(rnd() * cols.length) | 0]); R(x, bot - h, w, 1, 'rgba(255,255,255,0.28)'); x += w;
      }
      R(2, bot, 28, 1, '#8c6a42');
    }
    R(20, -29, 6, 5, '#e6e0d0'); R(21, -28, 4, 3, '#7fa7d8'); R(21, -27, 4, 1, '#c8dcf0');             // quadrinho
    R(10, -25, 5, 3, '#c5714f'); blob(g, ax + 12, ay - 27, 2, 2, '#4a9a5c');                           // vasinho
  }));
}
// mancha de luz do sol que cai de cada janela no chão (desenhada com opacidade que oscila)
function sprLight() {
  return sprite('light', () => makeSprite(0, 0, 70, 44, (g) => {
    for (const [w, a, ins] of [[30, 0.05, 0], [26, 0.055, 2], [20, 0.06, 5], [12, 0.06, 9]]) {
      g.fillStyle = `rgba(255,240,196,${a})`;
      for (let y = 0; y < 44; y++) {
        const fade = 1 - y / 52, x0 = Math.round(y * 0.55 + ins * (1 - y / 90)), ww = Math.max(2, Math.round((w - y * 0.1) * fade + 4));
        g.fillRect(x0, y, ww, 1);
      }
    }
  }));
}

// =====================================================================
// 6. SPRITES DE TEXTO (etiquetas, balões, placas) — em cache e limitados
// =====================================================================
const TXT = new Map();
function cached(key, build) {
  let s = TXT.get(key);
  if (!s) { if (TXT.size > 700) TXT.clear(); s = build(); TXT.set(key, s); }
  return s;
}
const BORDER = '#2f3550';

// pílula fina e translúcida com um pontinho na cor da plataforma (hl: 0 normal, 1 hover/seleção, 2 parente)
function labelSprite(text, accent, hl, light) {
  return cached(`L|${hl}|${light ? 1 : 0}|${accent}|${text}`, () => {
    const bx = textBox(text), rows = 5 + bx.up + bx.down, ph = rows + 2, w = bx.w + 9, h = ph + 1;
    const [c, g] = makeCanvas(w, h);
    const fill = hl === 1 ? (light ? '#1b2133' : '#fbfcff') : hl === 2 ? 'rgba(52,70,128,0.90)' : (light ? 'rgba(255,255,255,0.86)' : 'rgba(13,16,26,0.66)');
    const edge = hl === 1 ? accent : (light ? 'rgba(40,50,80,0.22)' : 'rgba(255,255,255,0.12)');
    const ink = hl === 1 ? (light ? '#ffffff' : '#151a2a') : hl === 2 ? '#ffffff' : (light ? '#1c2232' : '#eef2fb');
    rect(g, 1, 1, w - 2, ph, 'rgba(10,8,20,0.20)');                      // sombra
    rect(g, 1, 0, w - 2, ph, fill); rect(g, 0, 1, w, ph - 2, fill);
    rect(g, 1, 0, w - 2, 1, edge); rect(g, 1, ph - 1, w - 2, 1, edge);
    const dy = (ph - 3) >> 1;
    rect(g, 3, dy, 1, 3, accent); rect(g, 2, dy + 1, 3, 1, accent);       // pontinho da plataforma
    drawText(g, text, 7, 1 + bx.up, ink);
    return c;
  });
}
function makeBubble(innerW, innerH, bg, tail, draw) {
  const w = innerW + 6, h = innerH + 6, cx = w >> 1;
  const [c, g] = makeCanvas(w + 1, h + 4);
  rect(g, 2, 1, w - 2, h - 1, 'rgba(10,8,20,0.17)'); rect(g, 1, 2, w - 1, h - 2, 'rgba(10,8,20,0.17)');      // sombra
  rect(g, 1, 0, w - 2, h, BORDER); rect(g, 0, 1, w, h - 2, BORDER);
  rect(g, 2, 1, w - 4, h - 2, bg); rect(g, 1, 2, w - 2, h - 4, bg);
  rect(g, 2, 1, w - 4, 1, 'rgba(255,255,255,0.7)');                                                          // brilho no topo
  if (tail === 'say') {                                                                                      // rabinho em triângulo
    rect(g, cx - 2, h - 1, 5, 1, bg);
    rect(g, cx - 2, h, 1, 1, BORDER); rect(g, cx - 1, h, 3, 1, bg); rect(g, cx + 2, h, 1, 1, BORDER);
    rect(g, cx - 1, h + 1, 1, 1, BORDER); rect(g, cx, h + 1, 1, 1, bg); rect(g, cx + 1, h + 1, 1, 1, BORDER);
    rect(g, cx, h + 2, 1, 1, BORDER);
  } else {                                                                                                   // balão de pensamento: bolinhas
    rect(g, cx - 1, h, 3, 2, BORDER); rect(g, cx, h, 1, 1, bg); rect(g, cx - 3, h + 2, 2, 2, BORDER);
  }
  draw(g, 3, 3);
  return c;
}
function bubbleSay(text) {
  return cached('B|' + text, () => { const bx = textBox(text); return makeBubble(bx.w, 5 + bx.up + bx.down, '#fffdf7', 'say', (g, x, y) => drawText(g, text, x, y + bx.up, '#262b3d')); });
}
function bubbleThink(n) { // n = 1..3 pontinhos
  return cached('T|' + n, () => makeBubble(11, 5, '#f4efff', 'think', (g, x, y) => {
    g.fillStyle = '#5b4a99';
    for (let i = 0; i < 3; i++) if (i < n) g.fillRect(x + 1 + i * 4, y + 3, 2, 2);
  }));
}
function bubbleWait(stage) { // ampulheta animada (stage 0..4)
  return cached('W|' + stage, () => makeBubble(5, 7, '#fff4d6', 'say', (g, x, y) => {
    g.fillStyle = BORDER;
    g.fillRect(x, y, 5, 1); g.fillRect(x, y + 6, 5, 1);
    g.fillRect(x + 1, y + 1, 1, 2); g.fillRect(x + 3, y + 1, 1, 2); g.fillRect(x + 2, y + 3, 1, 1);
    g.fillRect(x + 1, y + 4, 1, 2); g.fillRect(x + 3, y + 4, 1, 2);
    g.fillStyle = '#e0a21b';
    if (stage < 2) g.fillRect(x + 2, y + 1, 1, 2 - stage);        // areia em cima
    if (stage === 1 || stage === 2) g.fillRect(x + 2, y + 3, 1, 1); // grão caindo
    if (stage >= 1) g.fillRect(x + 2, y + 5, 1, 1);                 // areia embaixo
    if (stage >= 3) g.fillRect(x + 2, y + 4, 1, 1);
  }));
}
// placa pequena, na cor da plataforma, que fica sobre o tapete de entrada da zona
function signSprite(nome, pal) {
  return cached(`S|${pal.cor}|${nome}`, () => {
    const up = String(nome).toLocaleUpperCase('pt-BR'), bx = textBox(up), rows = 5 + bx.up + bx.down, w = bx.w + 12, ph = rows + 4;
    const [c, g] = makeCanvas(w, ph + 1);
    rect(g, 1, 1, w - 2, ph, 'rgba(10,8,20,0.24)');
    rect(g, 1, 0, w - 2, ph, pal.dark); rect(g, 0, 1, w, ph - 2, pal.dark);
    rect(g, 1, 0, w - 2, 1, pal.trim); rect(g, 1, ph - 1, w - 2, 1, pal.trim); rect(g, 0, 1, 1, ph - 2, pal.trim); rect(g, w - 1, 1, 1, ph - 2, pal.trim);
    rect(g, 2, 1, w - 4, 1, 'rgba(255,255,255,0.20)');
    rect(g, 2, ph >> 1, 1, 1, pal.braidL); rect(g, w - 3, ph >> 1, 1, 1, pal.braidL);
    drawText(g, up, 6, 3 + bx.up, 'rgba(10,6,20,0.55)');
    drawText(g, up, 6, 2 + bx.up, '#fff3e0');
    return c;
  });
}
function glyphSprite(ch) {
  return cached('G|' + ch, () => {
    const [c, g] = makeCanvas(5, 8);
    drawText(g, ch, 1, 2, 'rgba(10,8,20,0.6)');
    drawText(g, ch, 0, 1, '#ffffff');
    return c;
  });
}

// =====================================================================
// 7. A PESSOA (pixel art ~12x24, vista reta: frente, costas e de lado)
//    Cada pose vira um sprite em cache com contorno seletivo (tom escuro do próprio preenchimento).
// =====================================================================
const SKINS = ['#f3cba3', '#e2b084', '#c98e5f', '#8f5c3d', '#f8dcc0', '#6e4732'];
const HAIRS = ['#2b1d14', '#4a2c17', '#7a4a22', '#c9a14a', '#1c1c24', '#8c3a2a', '#d8d0c0', '#3c2a4a'];
const PANTS = ['#2f3a52', '#3b3f4c', '#5a4a3a', '#27303f', '#4a3f5c', '#33473f'];
const CAPS = ['#c0392b', '#2c6bb3', '#2f8f5b', '#d9a21b', '#6b4fb3', '#e8e0d0'];
const INK = '#1b1d27';

// cores e traços de uma pessoa, tudo sorteado pelo hash do id (mesmo id, mesma pessoa)
function personColors(r) {
  const skin = SKINS[(r() * SKINS.length) | 0], hair = HAIRS[(r() * HAIRS.length) | 0], pants = PANTS[(r() * PANTS.length) | 0];
  const sk = parseColor(skin), cap = CAPS[(r() * CAPS.length) | 0];
  return {
    skin, skinS: css(mix(sk, [120, 52, 52], 0.24)), skinH: css(mix(sk, [255, 244, 226], 0.34)), skinO: css(mix(sk, [52, 24, 36], 0.62)),
    blush: css(mix(sk, [240, 110, 110], 0.42)),
    hair, hairS: dk(hair, 0.4), hairH: lt(hair, 0.32), hairO: dk(hair, 0.7),
    pants, pantsS: dk(pants, 0.3), pantsO: dk(pants, 0.66),
    shoe: '#2c2433', shoeO: '#14101a', iris: '#2a2540',
    cap, capD: dk(cap, 0.35), capO: dk(cap, 0.7),
    style: (r() * 6) | 0, glasses: r() < 0.22, beard: r() < 0.2, pocket: r() < 0.4, stripe: r() < 0.25,
  };
}

// lista de partes com contorno: P guarda, flush() desenha primeiro os contornos (1 px maiores) e depois os preenchimentos
const MAXP = 64;
const _PX = new Int16Array(MAXP), _PY = new Int16Array(MAXP), _PW = new Int16Array(MAXP), _PH = new Int16Array(MAXP);
const _PC = new Array(MAXP), _PO = new Array(MAXP);
let _n = 0, _g = null, _ox = 0, _oy = 0, _m = false;
function P(x, y, w, h, c, o) { if (_m) x = -x - w; _PX[_n] = x; _PY[_n] = y; _PW[_n] = w; _PH[_n] = h; _PC[_n] = c; _PO[_n] = o; _n++; }
function D(x, y, w, h, c) { if (_m) x = -x - w; _g.fillStyle = c; _g.fillRect(_ox + x, _oy + y, w, h); }   // detalhe sem contorno
function flush() {
  const g = _g;
  for (let i = 0; i < _n; i++) { g.fillStyle = _PO[i]; g.fillRect(_ox + _PX[i] - 1, _oy + _PY[i] - 1, _PW[i] + 2, _PH[i] + 2); }
  for (let i = 0; i < _n; i++) { g.fillStyle = _PC[i]; g.fillRect(_ox + _PX[i], _oy + _PY[i], _PW[i], _PH[i]); }
  _n = 0;
}

// o = { pose:'stand'|'walk'|'sitD'|'sitS', dir:0 frente|1 direita|2 costas|3 esquerda, frame:0..3, bob:0|-1, blink:0|1, cup }
// devolve um canvas 28x36 com os pés em (14,31)
function buildPerson(a, o) {
  const [cv, g] = makeCanvas(28, 36);
  _g = g; _ox = 14; _oy = 31; _m = o.dir === 3; _n = 0;
  const cl = a.cl, pal = a.pal, pose = o.pose, f = o.frame, walk = pose === 'walk';
  const side = o.dir === 1 || o.dir === 3, back = o.dir === 2;
  const sit = pose === 'sitD' || pose === 'sitS';
  const by = walk ? (f & 1 ? -1 : 0) : (pose === 'stand' ? o.bob : 0);
  const hy = -24 + by, st = cl.style;
  if (pose !== 'sitD') softShadow(g, 14, 30, 7, 2);

  // ---- pernas ----
  if (pose === 'sitS') {
    P(-4, -7, 8, 3, cl.pants, cl.pantsO); P(-5, -4, 3, 3, cl.pants, cl.pantsO); P(2, -4, 3, 3, cl.pants, cl.pantsO);
    P(-5, -1, 3, 1, cl.shoe, cl.shoeO); P(2, -1, 3, 1, cl.shoe, cl.shoeO);
  } else if (!sit) {
    if (side) {
      const l1 = walk ? [2, 0, -2, 0][f] : 0, l2 = -l1;
      P(-2 + l2, -7, 3, 6, cl.pants, cl.pantsO); P(-2 + l2, -1, 4, 1, cl.shoe, cl.shoeO);
      P(-1 + l1, -7, 3, 6, cl.pants, cl.pantsO); P(-1 + l1, -1, 4, 1, cl.shoe, cl.shoeO);
    } else {
      const liftL = walk && f === 2 ? 1 : 0, liftR = walk && f === 0 ? 1 : 0;
      P(-4, -7, 3, 6 - liftL, cl.pants, cl.pantsO); P(-4, -1 - liftL, 3, 1, cl.shoe, cl.shoeO);
      P(1, -7, 3, 6 - liftR, cl.pants, cl.pantsO); P(1, -1 - liftR, 3, 1, cl.shoe, cl.shoeO);
    }
  }
  // ---- tronco e braços ----
  if (side) {
    P(-3, -15 + by, 6, 8, pal.shirt, pal.shirtO);
    const sw = walk ? [-2, 0, 2, 0][f] : 0;
    P(-1 + sw, -14 + by, 3, 5, pal.shirtL, pal.shirtO); P(-1 + sw, -9 + by, 3, 2, cl.skin, cl.skinO);
    if (o.cup) P(2 + sw, -11 + by, 3, 3, '#f4efe6', '#6b5a48');
  } else {
    P(-4, -15 + by, 8, 8, pal.shirt, pal.shirtO);
    if (pose === 'sitD') { P(-6, -14, 2, 6, pal.shirt, pal.shirtO); P(4, -14, 2, 6, pal.shirt, pal.shirtO); }
    else {
      const aL = walk ? [1, 0, -1, 0][f] : 0, aR = walk ? [-1, 0, 1, 0][f] : 0;
      P(-6, -14 + by + aL, 2, 5, pal.shirt, pal.shirtO); P(-6, -9 + by + aL, 2, 2, cl.skin, cl.skinO);
      P(4, -14 + by + aR, 2, 5, pal.shirt, pal.shirtO); P(4, -9 + by + aR, 2, 2, cl.skin, cl.skinO);
      if (o.cup) P(5, -11 + by, 3, 3, '#f4efe6', '#6b5a48');
    }
  }
  // ---- cabeça: rosto e cabelo (partes) ----
  if (side) {
    P(-4, hy + 2, 8, 7, cl.skin, cl.skinO);
    P(4, hy + 5, 1, 2, cl.skin, cl.skinO);                                                   // nariz
    if (st === 5) { P(-5, hy, 9, 3, cl.cap, cl.capO); P(4, hy + 2, 3, 1, cl.capD, cl.capO); P(-5, hy + 3, 4, 3, cl.hair, cl.hairO); }
    else if (st === 1) { P(-4, hy, 8, 3, cl.hair, cl.hairO); P(-5, hy + 1, 5, 12, cl.hair, cl.hairO); }
    else if (st === 2) { P(-4, hy + 1, 8, 2, cl.hairS, cl.hairO); P(-4, hy + 3, 3, 2, cl.hairS, cl.hairO); }
    else if (st === 4) { P(-5, hy - 1, 9, 4, cl.hair, cl.hairO); P(-5, hy + 3, 4, 4, cl.hair, cl.hairO); P(-3, hy - 2, 3, 1, cl.hair, cl.hairO); }
    else { P(-4, hy, 8, 3, cl.hair, cl.hairO); P(-4, hy + 3, 4, 4, cl.hair, cl.hairO); if (st === 3) P(-6, hy + 1, 3, 3, cl.hair, cl.hairO); }
  } else if (!back) {
    P(-4, hy + 2, 8, 7, cl.skin, cl.skinO);
    if (st !== 1) { P(-5, hy + 4, 1, 2, cl.skin, cl.skinO); P(4, hy + 4, 1, 2, cl.skin, cl.skinO); }
    if (st === 5) { P(-5, hy, 10, 3, cl.cap, cl.capO); P(-5, hy + 3, 10, 1, cl.capD, cl.capO); }
    else if (st === 1) { P(-4, hy, 8, 3, cl.hair, cl.hairO); P(-5, hy + 1, 1, 10, cl.hair, cl.hairO); P(4, hy + 1, 1, 10, cl.hair, cl.hairO); P(-4, hy + 3, 1, 5, cl.hair, cl.hairO); P(3, hy + 3, 1, 5, cl.hair, cl.hairO); }
    else if (st === 2) P(-4, hy + 1, 8, 2, cl.hairS, cl.hairO);
    else if (st === 4) { P(-5, hy - 1, 10, 4, cl.hair, cl.hairO); P(-3, hy - 2, 2, 1, cl.hair, cl.hairO); P(1, hy - 2, 2, 1, cl.hair, cl.hairO); P(-5, hy + 3, 1, 3, cl.hair, cl.hairO); P(4, hy + 3, 1, 3, cl.hair, cl.hairO); }
    else { P(-4, hy, 8, 3, cl.hair, cl.hairO); P(-4, hy + 3, 1, 2, cl.hair, cl.hairO); P(3, hy + 3, 1, 2, cl.hair, cl.hairO); if (st === 3) P(-2, hy - 3, 4, 3, cl.hair, cl.hairO); }
  } else {
    if (st === 5) { P(-5, hy, 10, 4, cl.cap, cl.capO); P(-4, hy + 4, 8, 4, cl.hair, cl.hairO); }
    else if (st === 1) P(-5, hy, 10, 13, cl.hair, cl.hairO);
    else if (st === 2) P(-4, hy + 1, 8, 7, cl.hairS, cl.hairO);
    else if (st === 4) { P(-5, hy - 1, 10, 9, cl.hair, cl.hairO); P(-3, hy - 2, 2, 1, cl.hair, cl.hairO); P(1, hy - 2, 2, 1, cl.hair, cl.hairO); }
    else { P(-4, hy, 8, 8, cl.hair, cl.hairO); if (st === 3) P(-2, hy - 3, 4, 3, cl.hair, cl.hairO); }
    P(-3, hy + 8, 6, 1, cl.skin, cl.skinO);
  }
  flush();

  // ---- sombreado do tronco, das pernas e dos braços ----
  if (!sit) {
    if (side) { D(-3, -8 + by + 0, 6, 1, pal.shirtD); }
    else { D(-2, -7, 1, 5, cl.pantsS); D(1, -7, 1, 5, cl.pantsS); }
  }
  if (side) {
    D(-3, -15 + by, 1, 8, pal.shirtD); D(-3, -8 + by, 6, 1, pal.shirtD); D(2, -15 + by, 1, 1, pal.shirtL);
    if (!back) D(-1 + (walk ? [-2, 0, 2, 0][f] : 0), -10 + by, 3, 1, pal.shirtD);
  } else {
    D(3, -15 + by, 1, 8, pal.shirtD); D(-4, -8 + by, 8, 1, pal.shirtD); D(-4, -15 + by, 2, 1, pal.shirtL); D(-3, -14 + by, 1, 2, pal.shirtL);
    if (!back) { D(-1, -15 + by, 2, 1, cl.skin); D(-2, -14 + by, 1, 1, pal.shirtL); D(1, -14 + by, 1, 1, pal.shirtD); }
    if (cl.stripe) D(-4, -12 + by, 8, 1, pal.shirtL);
    else if (cl.pocket && !back) { D(1, -12 + by, 2, 2, pal.shirtD); D(1, -12 + by, 2, 1, pal.shirtL); }
    if (pose !== 'sitD') { const aL = walk ? [1, 0, -1, 0][f] : 0, aR = walk ? [-1, 0, 1, 0][f] : 0; D(-5, -14 + by + aL, 1, 5, pal.shirtD); D(5, -14 + by + aR, 1, 5, pal.shirtD); D(-6, -10 + by + aL, 2, 1, pal.shirtD); D(4, -10 + by + aR, 2, 1, pal.shirtD); }
    else { D(-5, -14, 1, 6, pal.shirtD); D(5, -14, 1, 6, pal.shirtD); }
  }
  // ---- rosto: sombras, sobrancelhas, olhos com brilho, boca, bochechas ----
  if (side) {
    D(3, hy + 3, 1, 5, cl.skinS); D(-3, hy + 8, 7, 1, cl.skinS); D(-1, hy + 4, 2, 2, cl.skinS);
    if (cl.glasses) { const fr = '#454b63'; D(2, hy + 4, 2, 2, 'rgba(214,236,255,0.7)'); D(1, hy + 3, 4, 1, fr); D(1, hy + 6, 4, 1, fr); D(1, hy + 3, 1, 4, fr); D(4, hy + 3, 1, 4, fr); D(-2, hy + 4, 3, 1, fr); if (!o.blink) D(3, hy + 5, 1, 1, cl.iris); }
    else if (o.blink) D(2, hy + 5, 2, 1, cl.iris); else { D(2, hy + 4, 2, 2, cl.iris); D(2, hy + 4, 1, 1, '#ffffff'); }
    D(2, hy + 7, 2, 1, '#b25a58'); D(1, hy + 6, 1, 1, cl.blush);
    if (cl.beard) { D(-1, hy + 6, 5, 3, cl.hairS); D(2, hy + 7, 2, 1, '#6a3a3a'); }
    // detalhes do cabelo
    if (st === 5) { D(-3, hy, 4, 1, lt(cl.cap, 0.3)); D(0, hy - 1, 1, 1, cl.capD); }
    else if (st !== 2) D(-2, hy + 1, 3, 1, cl.hairH);
  } else if (!back) {
    D(3, hy + 3, 1, 5, cl.skinS); D(-3, hy + 8, 6, 1, cl.skinS); D(-3, hy + 6, 1, 1, cl.skinH);
    if (cl.glasses) {
      const fr = '#454b63';
      for (const x of [-4, 0]) { D(x + 1, hy + 4, 2, 2, 'rgba(214,236,255,0.7)'); D(x, hy + 3, 4, 1, fr); D(x, hy + 6, 4, 1, fr); D(x, hy + 3, 1, 4, fr); D(x + 3, hy + 3, 1, 4, fr); }
      if (!o.blink) { D(-2, hy + 5, 1, 1, cl.iris); D(1, hy + 5, 1, 1, cl.iris); } else { D(-3, hy + 5, 2, 1, cl.iris); D(1, hy + 5, 2, 1, cl.iris); }
    } else if (o.blink) { D(-3, hy + 5, 2, 1, cl.iris); D(1, hy + 5, 2, 1, cl.iris); }
    else { D(-3, hy + 4, 2, 2, cl.iris); D(1, hy + 4, 2, 2, cl.iris); D(-3, hy + 4, 1, 1, '#ffffff'); D(1, hy + 4, 1, 1, '#ffffff'); }
    D(-4, hy + 6, 1, 1, cl.blush); D(3, hy + 6, 1, 1, cl.blush); D(0, hy + 6, 1, 1, cl.skinS);
    D(-1, hy + 7, 2, 1, '#b25a58');
    if (cl.beard) { D(-3, hy + 6, 6, 3, cl.hairS); D(-1, hy + 7, 2, 1, '#6a3a3a'); D(-3, hy + 6, 1, 1, cl.hair); D(2, hy + 6, 1, 1, cl.hair); }
    if (st === 5) { D(-4, hy, 5, 1, lt(cl.cap, 0.3)); D(0, hy - 1, 1, 1, cl.capD); }
    else if (st === 4) { D(-3, hy - 1, 2, 1, cl.hairH); D(1, hy, 1, 1, cl.hairH); D(-4, hy + 1, 1, 1, cl.hairH); }
    else if (st !== 2) { D(-2, hy + 1, 3, 1, cl.hairH); D(2, hy + 2, 1, 1, cl.hairS); }
  } else {
    if (st === 5) { D(-4, hy, 5, 1, lt(cl.cap, 0.3)); D(-3, hy + 3, 6, 1, cl.capD); D(-1, hy + 5, 2, 1, cl.hairS); }
    else if (st === 2) { D(-3, hy + 2, 3, 1, cl.hairH); }
    else { D(-2, hy + 1, 3, 1, cl.hairH); D(-3, hy + 5, 6, 1, cl.hairS); D(1, hy + 3, 1, 2, cl.hairS); }
    D(-2, hy + 8, 4, 1, cl.skinS);
  }
  if (a.headset) {                                                                  // chamados usam fone
    const hs = '#2b2f3a';
    if (side) { D(-4, hy - 1, 8, 1, hs); D(-2, hy + 3, 3, 4, pal.accent); D(-2, hy + 3, 3, 1, pal.shirtL); D(2, hy + 8, 3, 1, hs); }
    else { D(-4, hy - 1, 8, 1, hs); D(-5, hy + 3, 1, 4, pal.accent); D(4, hy + 3, 1, 4, pal.accent); if (!back) D(2, hy + 8, 3, 1, hs); }
  }
  return cv;
}
// antebraços e mãos de quem digita (desenhados depois da mesa); origem em (12,7) = centro da mesa na linha da base. t alterna as mãos
function buildHands(a, t) {
  const [cv, g] = makeCanvas(24, 16);
  _g = g; _ox = 12; _oy = 7; _m = false; _n = 0;
  const pal = a.pal, cl = a.cl;
  P(-6, -3, 2, 3, pal.shirt, pal.shirtO); P(-5, -1, 2, 3, pal.shirt, pal.shirtO); P(-4, 1 + t, 3, 2, cl.skin, cl.skinO);
  P(4, -3, 2, 3, pal.shirt, pal.shirtO); P(3, -1, 2, 3, pal.shirt, pal.shirtO); P(1, 2 - t, 3, 2, cl.skin, cl.skinO);
  flush();
  D(-4, 1 + t, 3, 1, cl.skinH); D(1, 2 - t, 3, 1, cl.skinH); D(-6, -3, 1, 3, pal.shirtL); D(5, -3, 1, 3, pal.shirtD);
  return cv;
}

// tela do monitor (inclinada): mode 0 apagado, 1 trabalhando, 2 pensando, 3 esperando, 4 ocioso
function drawScreen(g, ax, ay, mode, now, pal, seed) {
  const X = ax + 1, Y = ay - 9, S = -0.3;
  if (mode === 0) { parQuad(g, X, Y, 8, 9, S, '#0b0d12', 1); parQuad(g, X, Y, 3, 4, S, '#161a24', 1); parQuad(g, X + 5, Y + 6, 2, 1, S, '#10131b', 6); return; }
  const bg = mode === 1 ? '#0f2c36' : mode === 2 ? '#1d1636' : mode === 3 ? '#35290f' : '#121a2a';
  parQuad(g, X, Y, 8, 9, S, bg, 1);
  if (mode === 1) {
    const step = (now / 170) | 0;
    for (let i = 0; i < 4; i++) {
      const w = 2 + (hashStr(seed + step * 7 + i * 13) % 5);
      parQuad(g, X + 1, Y + 1 + i * 2, w, 1, S, i === 1 ? pal.glow : '#7ddfb6', 2);
    }
    parQuad(g, X, Y, 8, 1, S, 'rgba(160,255,230,0.14)', 1);
  } else if (mode === 2) {
    const ph = ((now / 260) | 0) % 3;
    for (let i = 0; i < 3; i++) parQuad(g, X + 1 + i * 2, Y + 3, 1, 3, S, i === ph ? '#d7c9ff' : '#5b4a99', 2 + i * 2);
  } else if (mode === 3) {
    if (((now / 500) | 0) & 1) parQuad(g, X + 3, Y + 3, 2, 3, S, '#ffcf5a', 4);
  } else {
    const p = ((now / 900) | 0) % 5;
    parQuad(g, X + p, Y + 3 + (p & 1), 2, 1, S, '#3d5a8c', p + 1);
  }
}

// =====================================================================
// 8. ATOR (um agente na cena) — reaproveitado por id, nunca recriado à toa
// =====================================================================
class Actor {
  constructor(d, pal, now) {
    this.id = d.id; this.d = d; this.pal = pal;
    const r = mulberry32(hashStr(d.id));
    this.cl = personColors(r);
    this.style = this.cl.style; this.glasses = this.cl.glasses;
    this.phase = r() * 1000;
    this.headset = d.papel === 'chamado';
    this.t = T_ACTOR; this.key = 0;
    this.x = 0; this.y = 0; this.fx = 0; this.fy = 0;
    this.path = []; this.pi = 0;
    this.kind = 'none'; this.arrived = false; this.arrivedAt = 0;
    this.seat = -1; this.spot = null; this.spotKey = '';
    this.alpha = 1; this.entering = false; this.leaving = false; this.gone = false; this.leaveWhy = '';
    this.face = 1; this.moving = false; this.walkT = 0;      // face: 0 direita, 1 baixo, 2 esquerda, 3 cima
    this.estadoSince = now; this.fresh = true;
    this.sprs = [];                                           // sprites em cache (pose x direção x quadro x piscada)
    this.hit = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.headH = 26;
  }
}

// =====================================================================
// 9. O ESCRITÓRIO
// =====================================================================
export class Office {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.dpr = 1; this.W = 0; this.H = 0;
    this.k = 2; this.tx = 0; this.ty = 0; this.tp = 2;
    this.kMin = 1; this.kMax = 8;
    this.userMoved = false; this.camTarget = null;
    this.bg = '#10131a'; this.light = false;
    this.actors = new Map();
    this.seats = new Map();      // idPlataforma -> [idAgente|null, ...]
    this.rowsMem = new Map();    // idPlataforma -> fileiras (só cresce enquanto a zona existe)
    this.plats = new Map();      // idPlataforma -> {nome, cor}
    this.hidden = new Set();
    this.left = new Map();       // ids que já saíram pelo elevador (não recriar enquanto o servidor ainda os lista)
    this.zoneList = [];
    this.zcCur = 0;              // colunas de zonas em uso (escolhidas pela proporção da tela)
    this.sig = '';
    this.world = null;
    this.state = null;
    this.first = true;
    this.hoverId = null; this.selectedId = null;
    this.onHover = null; this.onSelect = null; this.onView = null;
    this.items = [];
    this.doorOpen = 0;
    this.base = document.createElement('canvas');
    this._dist = new Int32Array(0); this._q = new Int32Array(0);
    this._last = 0; this._raf = 0; this._wheel = 0;
    this._ptrs = new Map(); this._drag = null; this._pinch = null;
    this.nameMax = 10; this.bubMax = 16; this.lowZoom = false;
    this._frame = (ts) => this.frame(ts);
    this._bind();
    this.resize();
    this.rebuildWorld();            // já mostra o escritório vazio enquanto o primeiro estado não chega
  }

  // ---------- ciclo de vida ----------
  start() { if (!this._raf) { this._last = 0; this._raf = requestAnimationFrame(this._frame); } }
  stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; }
  destroy() {
    this.stop();
    this._ro && this._ro.disconnect();
    window.removeEventListener('resize', this._onResize);
    for (const [t, f] of this._listeners || []) this.canvas.removeEventListener(t, f);
  }
  setBackground(c) { this.bg = c || this.bg; const k = parseColor(this.bg); this.light = k[0] * 0.299 + k[1] * 0.587 + k[2] * 0.114 > 150; }
  setHidden(set) { this.hidden = new Set(set); if (this.state) this.setState(this.state); }

  // ---------- entrada do estado vindo do servidor/demo ----------
  setState(state) {
    this.state = state;
    const now = performance.now();
    const plataformas = state.plataformas || [];
    for (const p of plataformas) this.plats.set(p.id, { nome: p.nome || p.id, cor: p.cor || '#8b93a1' });
    const agentes = (state.agentes || []).filter((a) => a && a.id && !this.hidden.has(a.plataforma));
    const byId = new Map(agentes.map((a) => [a.id, a]));

    // plataformas "escondidas": remove atores e assentos sem animar
    for (const a of [...this.actors.values()]) if (this.hidden.has(a.d.plataforma)) this.removeActor(a);

    // quais plataformas ganham zona (ordem do servidor; extras no fim)
    const want = new Set();
    for (const p of plataformas) if (!this.hidden.has(p.id) && (p.conectada || p.ativos > 0)) want.add(p.id);
    for (const a of agentes) want.add(a.plataforma);
    for (const a of this.actors.values()) want.add(a.d.plataforma); // quem ainda está saindo mantém a zona
    const order = [];
    for (const p of plataformas) if (want.has(p.id)) { order.push(p.id); want.delete(p.id); }
    for (const id of want) order.push(id);

    // atores: cria os novos (pai primeiro), atualiza os existentes
    const seen = new Set();
    const ensure = (ag) => {
      if (seen.has(ag.id)) return;
      seen.add(ag.id);
      let act = this.actors.get(ag.id);
      if (!act) {
        if (this.left.has(ag.id)) { if (ag.estado === 'saindo') return; this.left.delete(ag.id); }
        if (this.first && ag.estado === 'saindo') return;
        const pai = ag.paiId ? byId.get(ag.paiId) : null;
        if (pai && pai.plataforma === ag.plataforma) ensure(pai);
        if (!this.plats.has(ag.plataforma)) this.plats.set(ag.plataforma, { nome: ag.plataforma, cor: '#8b93a1' });
        act = new Actor(ag, platPal(this.plats.get(ag.plataforma).cor), now);
        this.actors.set(ag.id, act);
        this.allocSeat(act);
      } else {
        if (ag.estado !== act.d.estado) act.estadoSince = now;
        act.d = ag;
        act.headset = ag.papel === 'chamado';
        const np = platPal((this.plats.get(ag.plataforma) || { cor: '#8b93a1' }).cor);
        if (np !== act.pal) { act.pal = np; act.sprs = []; }
        if (act.leaving && act.leaveWhy === 'ausente' && ag.estado !== 'saindo') { act.leaving = false; act.kind = 'none'; }
      }
    };
    for (const ag of agentes) ensure(ag);
    for (const id of [...this.left.keys()]) if (!byId.has(id)) this.left.delete(id);
    for (const a of this.actors.values()) {
      if (!seen.has(a.id) && !a.leaving) { a.leaving = true; a.leaveWhy = 'ausente'; }
    }

    // zonas (fileiras crescem conforme os assentos usados)
    const zones = [];
    for (const id of order) {
      const meta = this.plats.get(id) || { nome: id, cor: '#8b93a1' };
      const seats = this.seats.get(id) || [];
      let last = -1;
      for (let i = 0; i < seats.length; i++) if (seats[i]) last = i;
      const rows = Math.max(1, Math.ceil((last + 1) / COLS), this.rowsMem.get(id) || 1);
      this.rowsMem.set(id, rows);
      zones.push({ id, nome: meta.nome, cor: meta.cor, pal: platPal(meta.cor), rows });
    }
    for (const id of [...this.rowsMem.keys()]) if (!order.includes(id)) this.rowsMem.delete(id);
    this.zoneList = zones;
    const sig = zones.map((z) => `${z.id}:${z.rows}:${z.nome}:${z.cor}`).join('|');
    if (sig !== this.sig || !this.world) {
      this.sig = sig;
      this.rebuildWorld();
      this.relayoutActors(now);
    }

    // novos atores: primeira carga = posição direta; depois entram pelo elevador
    for (const a of this.actors.values()) {
      if (!a.fresh) continue;
      a.fresh = false;
      if (this.first) { this.think(a, now, true); }
      else { a.x = DOOR_X; a.y = 0.12; a.face = 1; a.entering = true; a.alpha = 0; this.think(a, now, false); }
    }
    this.first = false;
  }

  removeActor(a) {
    if (a.seat >= 0) { const s = this.seats.get(a.d.plataforma); if (s) { s[a.seat] = null; while (s.length && !s[s.length - 1]) s.pop(); } }
    this.freeSpot(a);
    this.actors.delete(a.id);
    if (this.hoverId === a.id) { this.hoverId = null; this.onHover && this.onHover(null); }
    if (this.selectedId === a.id) { this.selectedId = null; this.onSelect && this.onSelect(null); }
  }

  // escolhe a mesa: subagentes ficam ao lado da mesa do pai; os outros pegam a primeira livre
  allocSeat(a) {
    const pid = a.d.plataforma;
    let seats = this.seats.get(pid);
    if (!seats) { seats = []; this.seats.set(pid, seats); }
    let idx = -1;
    const pai = a.d.paiId ? this.actors.get(a.d.paiId) : null;
    if (pai && pai.d.plataforma === pid && pai.seat >= 0) {
      const pc = pai.seat % COLS, pr = (pai.seat / COLS) | 0;
      let best = Infinity;
      const lim = Math.max(seats.length, pai.seat) + COLS * 2;
      for (let i = 0; i < lim; i++) {
        if (seats[i]) continue;
        const c = i % COLS, r = (i / COLS) | 0;
        const cost = Math.abs(r - pr) * 4 + Math.abs(c - pc) + (c < pc ? 0.4 : 0) + i * 0.001;
        if (cost < best) { best = cost; idx = i; }
      }
    } else {
      // espalha: evita a mesa ao lado de alguém ocupado, mesmo que precise de outra fileira
      let best = Infinity;
      const lim = Math.max(seats.length, COLS) + COLS;
      for (let i = 0; i < lim; i++) {
        if (seats[i]) continue;
        const c = i % COLS;
        const vizinhos = (c > 0 && seats[i - 1] ? 1 : 0) + (c < COLS - 1 && seats[i + 1] ? 1 : 0);
        const cost = vizinhos * 10 + i;
        if (cost < best) { best = cost; idx = i; }
      }
    }
    while (seats.length <= idx) seats.push(null);
    seats[idx] = a.id;
    a.seat = idx;
  }

  // ---------- layout do mundo ----------
  // tamanho do mapa (em tiles) para um certo número de colunas de zonas
  layoutDims(zl, zc) {
    const n = zl.length, zW = 3 * COLS + 1;       // mesas de 2 tiles com 1 de corredor entre elas e nas pontas
    if (!n) return { X: HALL_MIN_W, Y: HALL_D + 3, rowDs: [], totalW: 0, zr: 0 };
    const zr = Math.ceil(n / zc), rowDs = [];
    for (let r = 0; r < zr; r++) { let m = 0; for (let c = 0; c < zc; c++) { const z = zl[r * zc + c]; if (z) m = Math.max(m, TOPM + 3 * z.rows); } rowDs.push(m); }
    const totalW = zc * zW + (zc - 1) * GAP;
    return { X: Math.max(HALL_MIN_W, totalW + 2), Y: HALL_D + rowDs.reduce((s, v) => s + v, 0) + (zr - 1) * GAP, rowDs, totalW, zr };
  }
  // quanto o mapa ocupa da tela com esse nº de colunas: primeiro o zoom inteiro, depois o aproveitamento
  scoreCols(zl, zc) {
    const d = this.layoutDims(zl, zc);
    const w = d.X * T + 2 * SIDE + 8, h = WALL_H + d.Y * T + SLAB + 12;
    const cw = this.W || 1400, ch = this.H || 900, pad = 16 * (this.dpr || 1);
    const s = Math.min((cw - pad) / w, (ch - pad) / h);
    return Math.floor(s) * 100 + s;
  }
  // escolhe as colunas pela proporção do canvas (larga: várias; celular: 1). Só troca se melhorar bastante.
  pickCols(zl) {
    const n = zl.length;
    if (n <= 1) return 1;
    let best = 1, bs = -Infinity;
    for (let zc = 1; zc <= n; zc++) { const s = this.scoreCols(zl, zc); if (s > bs) { bs = s; best = zc; } }
    const cur = this.zcCur;
    if (cur >= 1 && cur <= n && cur !== best && this.scoreCols(zl, cur) >= bs * 0.9) return cur;
    return best;
  }

  rebuildWorld() {
    const zl = this.zoneList, n = zl.length, zW = 3 * COLS + 1;
    for (const z of zl) { z.W = zW; z.D = TOPM + 3 * z.rows; }
    const zc = this.pickCols(zl);
    this.zcCur = zc;
    const { X, Y, rowDs, totalW } = this.layoutDims(zl, zc);
    const ox0 = Math.floor((X - totalW) / 2), lx = X - 1 - LOUNGE_W;   // lx = onde começa o lounge (canto direito)
    const w = {
      X, Y, lx, zones: zl, blocked: new Uint8Array(X * Y), statics: [], signs: [], spots: [], spotByKey: new Map(),
      seatTiles: new Map(), bounds: null, baseAx: 0, baseAy: 0,
    };
    let yAcc = HALL_D;
    for (let r = 0, i = 0; r * zc < n; r++) {
      for (let c = 0; c < zc && i < n; c++, i++) { zl[i].x0 = ox0 + c * (zW + GAP); zl[i].y0 = yAcc; }
      yAcc += rowDs[r] + GAP;
    }
    const blk = (x, y) => { if (x >= 0 && y >= 0 && x < X && y < Y) w.blocked[y * X + x] = 1; };
    const add = (t, spr, x, y, key, extra) => w.statics.push(Object.assign({ t, spr, x, y, key }, extra));

    // zonas: mesas (a pessoa senta atrás), cadeiras, plantas e a placa no poste
    for (const z of zl) {
      const tiles = [];
      for (let s = 0; s < z.rows * COLS; s++) {
        const c = s % COLS, r = (s / COLS) | 0;
        const gx0 = z.x0 + 1 + 3 * c, cy = z.y0 + TOPM + 3 * r, base = (cy + 1) * T;
        tiles.push({ cx: gx0, cy, px: gx0 + 1, py: (base + SEAT_DY) / T, base });
        blk(gx0, cy); blk(gx0 + 1, cy); blk(gx0, cy + 1); blk(gx0 + 1, cy + 1);
        add(T_DESK, sprDesk(z.pal, (hashStr(z.id + ':' + s) >>> 2) & 3), gx0 * T, base, base + 16, { pid: z.id, idx: s, pal: z.pal, cx: gx0 * T + 16, base });
        add(T_CBACK, sprChairBack(z.pal), (gx0 + 1) * T, base + SEAT_DY, base + 4, { pid: z.id, idx: s });
      }
      w.seatTiles.set(z.id, tiles);
      for (const px of [z.x0, z.x0 + z.W - 1]) { add(T_PLANT, null, px * T + 8, (z.y0 + 2) * T, (z.y0 + 2) * T, { v: px === z.x0 ? 0 : 1, ph: px * 0.37 + z.y0 }); blk(px, z.y0 + 1); }
      // placa sobre o tapete de entrada da zona (no corredor logo acima); os nomes dos agentes desviam dela
      w.signs.push({ x: (z.x0 + 5) * T, y: z.y0 * T - 3, nome: z.nome, pal: z.pal });
    }

    // saguão: elevador na parede dos fundos (à esquerda), lounge no canto direito
    for (const [tx, kind, v] of [[lx, 'plant', 0], [lx + 1, 'coffee'], [lx + 5, 'plant', 1], [lx + 8, 'plant', 0]]) {
      if (kind === 'plant') add(T_PLANT, null, tx * T + 8, T, T, { v, ph: tx * 0.7 });
      else add(T_COFFEE, sprCoffee(), tx * T + 8, T, T);
      blk(tx, 0);
    }
    if (lx - 2 >= 6) { add(T_SPR, sprCooler(), (lx - 2) * T + 8, T, T); blk(lx - 2, 0); }                          // bebedouro
    if (lx - 5 >= 6) { add(T_SPR, sprBookshelf(), (lx - 5) * T, T, T); blk(lx - 5, 0); blk(lx - 4, 0); }          // estante
    for (const [u0, v] of [[lx + 3, 0], [lx + 6, 1]]) {
      add(T_SPR, sprSofa(v), u0 * T, T, T);
      blk(u0, 0); blk(u0 + 1, 0);
      for (const dx of [0, 1]) w.spots.push({ gx: u0 + dx, gy: 1, px: u0 + 0.62 + dx * 0.76, py: 18 / T, seat: true, kid: 'S' + (u0 + dx), owner: null });
    }
    add(T_SPR, sprTable(), (lx + 5) * T + 8, 3 * T, 3 * T); blk(lx + 5, 2);
    // lugares em pé (os mais perto do café primeiro), em xadrez para os nomes não se amontoarem;
    // a frente dos sofás fica livre e o resto do saguão serve de sobra quando o lounge enche
    const stand = [];
    for (let j = 1; j < HALL_D; j++) for (let i = 5; i < X - 1; i++) {
      if (w.blocked[j * X + i] || (i + j) % 2) continue;
      if (j === 1 && i >= lx + 3 && i <= lx + 7) continue;
      stand.push({ gx: i, gy: j, px: i + 0.5, py: j + 0.5, seat: false, kid: i + ',' + j, owner: null, d: Math.hypot(i - (lx + 1.5), j - 1.5) });
    }
    stand.sort((a, b) => a.d - b.d);
    w.spots.push(...stand);
    for (const sp of w.spots) w.spotByKey.set(sp.kid, sp);

    // limites do mundo em pixels lógicos
    w.bounds = { minX: -SIDE - 4, maxX: X * T + SIDE + 4, minY: -WALL_H - 6, maxY: Y * T + SLAB + 6 };
    this.world = w;
    this.paintBase();
    if (this._dist.length < X * Y) { this._dist = new Int32Array(X * Y); this._q = new Int32Array(X * Y); }
    if (!this.userMoved) this.fit();
  }

  // pinta o piso, os tapetes, as paredes, as janelas e as sombras numa imagem só (refeita só quando o layout muda)
  paintBase() {
    const w = this.world, { X, Y, zones, lx } = w, b = w.bounds;
    const cvs = this.base;
    cvs.width = b.maxX - b.minX; cvs.height = b.maxY - b.minY;
    const g = cvs.getContext('2d'); g.imageSmoothingEnabled = false;
    const ax = -b.minX, ay = -b.minY;
    w.baseAx = ax; w.baseAy = ay;
    const R = (x, y, wd, h, c) => rect(g, ax + x, ay + y, wd, h, c);      // coordenadas do mundo
    const XW = X * T, YH = Y * T;
    const rgb = (c, d) => `rgb(${Math.round(c[0] + d)},${Math.round(c[1] + d)},${Math.round(c[2] + d)})`;
    const dia = (cx, cy, r, c) => { for (let dy = -r; dy <= r; dy++) R(cx - (r - Math.abs(dy)), cy + dy, 2 * (r - Math.abs(dy)) + 1, 1, c); };
    const pool = (cx, cy, rx, ry) => { for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(255,236,190,0.035)'; blob(g, ax + cx, ay + cy, rx - i * 10, Math.max(2, ry - i * 3), 'rgba(255,236,190,0.035)'); } };

    // sombra da laje sobre o fundo da página
    R(-SIDE + 1, YH + SLAB, XW + 2 * SIDE - 2, 2, 'rgba(10,8,20,0.30)'); R(-SIDE + 3, YH + SLAB + 2, XW + 2 * SIDE - 6, 2, 'rgba(10,8,20,0.16)');
    R(-SIDE - 2, -WALL_H + 4, 2, WALL_H + YH + SLAB - 2, 'rgba(10,8,20,0.14)'); R(XW + SIDE, -WALL_H + 4, 2, WALL_H + YH + SLAB - 2, 'rgba(10,8,20,0.14)');

    // piso de tiles com variação sorteada por tile: quina clara, rejunte, pintinhas e veios
    for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) {
      const rr = mulberry32(((i + 1) * 73856093) ^ ((j + 1) * 19349663)), x = i * T, y = j * T;
      R(x, y, T, T, rgb((i + j) & 1 ? HALL_B : HALL_A, (rr() - 0.5) * 9));
      R(x, y, T - 1, 1, 'rgba(255,248,232,0.34)'); R(x, y, 1, T - 1, 'rgba(255,248,232,0.24)');
      R(x + T - 1, y, 1, T, GROUT); R(x, y + T - 1, T, 1, GROUT);
      for (let n = 0; n < 3; n++) R(x + 2 + ((rr() * 11) | 0), y + 2 + ((rr() * 11) | 0), 1, 1, rr() < 0.5 ? 'rgba(150,126,92,0.24)' : 'rgba(255,255,240,0.3)');
      if (rr() < 0.14) { const sx = x + 3 + ((rr() * 6) | 0), sy = y + 4 + ((rr() * 6) | 0); R(sx, sy, 4, 1, 'rgba(150,126,92,0.18)'); R(sx + 1, sy + 1, 2, 1, 'rgba(150,126,92,0.1)'); }
    }
    // poças de luz das lâmpadas no saguão
    pool(lx * T + 72, 36, 64, 18); pool(40, 30, 44, 14); pool(XW / 2, 40, 70, 16);

    // tapetes de entrada das zonas (com o nome por cima), no corredor logo acima de cada uma
    for (const z of zones) {
      const mx = (z.x0 + 5) * T - 36, my = z.y0 * T - 14, p = z.pal;
      R(mx - 1, my + 2, 74, 12, 'rgba(10,8,20,0.20)');
      R(mx, my, 72, 12, p.dark); R(mx, my, 72, 1, p.braid); R(mx, my + 11, 72, 1, p.trim); R(mx, my, 1, 12, p.trim); R(mx + 71, my, 1, 12, p.trim);
      for (let yy = 2; yy < 10; yy += 2) for (let xx = 3 + (yy & 2); xx < 68; xx += 4) R(mx + xx, my + yy, 2, 1, p.carpetB);
      for (let xx = 2; xx < 70; xx += 3) { R(mx + xx, my + 1, 1, 1, p.braidL); R(mx + xx + 1, my + 10, 1, 1, p.braidL); }
      for (let k = 0; k < 6; k++) { R(mx - 2, my + 1 + k * 2, 2, 1, p.braidL); R(mx + 72, my + 1 + k * 2, 2, 1, p.braidL); }
    }
    // carpetes: trama em traços alternados, fios escuros, borda com trança, filete claro e cantos
    for (const z of zones) {
      const x0 = z.x0 * T, y0 = z.y0 * T, zw = z.W * T, zh = z.D * T, p = z.pal;
      R(x0 - 2, y0 - 1, zw + 4, zh + 4, 'rgba(70,46,34,0.12)');
      R(x0, y0, zw, zh, p.carpetA);
      for (let yy = 3; yy < zh - 3; yy += 2) { const off = ((yy >> 1) & 1) * 2; for (let xx = 3 + off; xx < zw - 6; xx += 4) R(x0 + xx, y0 + yy, 2, 1, p.carpetB); }
      const rr = mulberry32(hashStr(z.id) + 7);
      for (let n = 0; n < zw * zh / 120; n++) R(x0 + 3 + ((rr() * (zw - 8)) | 0), y0 + 3 + ((rr() * (zh - 8)) | 0), 2, 1, p.carpetC);
      R(x0, y0, zw, 2, p.trim); R(x0, y0 + zh - 2, zw, 2, p.trim); R(x0, y0, 2, zh, p.trim); R(x0 + zw - 2, y0, 2, zh, p.trim);
      R(x0 + 2, y0 + 2, zw - 4, 1, 'rgba(255,240,220,0.18)'); R(x0 + 2, y0 + 2, 1, zh - 4, 'rgba(255,240,220,0.10)');
      for (let xx = 5; xx < zw - 5; xx += 3) { R(x0 + xx, y0 + 4, 2, 1, p.braid); R(x0 + xx, y0 + zh - 5, 2, 1, p.braid); }
      for (let yy = 5; yy < zh - 5; yy += 3) { R(x0 + 4, y0 + yy, 1, 2, p.braid); R(x0 + zw - 5, y0 + yy, 1, 2, p.braid); }
      R(x0 + 3, y0 + zh - 4, zw - 6, 1, 'rgba(0,0,0,0.16)'); R(x0 + 3, y0 + 3, zw - 6, 1, 'rgba(0,0,0,0.10)');
      for (const [cx, cy] of [[3, 3], [zw - 6, 3], [3, zh - 6], [zw - 6, zh - 6]]) { R(x0 + cx, y0 + cy, 3, 3, p.braidL); R(x0 + cx + 1, y0 + cy + 1, 1, 1, p.trim); }
    }
    // tapete do lounge: bordas, losangos e franjas
    {
      const rx = (lx + 2) * T, ry = T, rw = 7 * T, rh = 2 * T + 1;
      R(rx - 1, ry + 1, rw + 2, rh + 3, 'rgba(10,8,20,0.16)');
      R(rx, ry, rw, rh, '#6b3f49'); R(rx + 2, ry + 2, rw - 4, rh - 4, '#8b5864'); R(rx + 4, ry + 4, rw - 8, rh - 8, '#7c4c58');
      R(rx + 4, ry + 4, rw - 8, 1, '#d9a8a0'); R(rx + 4, ry + rh - 5, rw - 8, 1, '#d9a8a0'); R(rx + 4, ry + 4, 1, rh - 8, '#d9a8a0'); R(rx + rw - 5, ry + 4, 1, rh - 8, '#d9a8a0');
      for (let px = rx + 14; px < rx + rw - 8; px += 14) for (let py = ry + 12; py < ry + rh - 6; py += 12) { dia(px, py, 4, '#a2707a'); dia(px, py, 2, '#c79097'); R(px, py, 1, 1, '#f0d2c8'); }
      for (let y = 3; y < rh - 2; y += 2) { R(rx - 2, ry + y, 2, 1, '#e6c8b8'); R(rx + rw, ry + y, 2, 1, '#e6c8b8'); }
    }
    // capacho do elevador
    R(19, 1, 42, 23, 'rgba(10,8,20,0.18)'); R(20, 0, 40, 22, '#3d4252'); R(22, 2, 36, 18, '#4a5062'); R(22, 2, 36, 1, '#626a80');
    for (let xx = 24; xx < 58; xx += 4) R(xx, 4, 2, 14, '#424859');
    R(20, 22, 40, 1, '#2e3240');

    // sombras de contato dos móveis
    for (const it of w.statics) {
      if (it.t === T_DESK) { R(it.x - 1, it.base + 16, 34, 2, 'rgba(40,26,34,0.26)'); R(it.x, it.base + 18, 32, 2, 'rgba(40,26,34,0.13)'); R(it.x + 32, it.base + 2, 2, 15, 'rgba(40,26,34,0.12)'); }
    }
    // escurecimento (oclusão ambiente) junto das paredes
    for (let i = 0; i < 4; i++) {
      const a = [0.22, 0.14, 0.08, 0.04][i];
      R(0, i * 2, XW, 2, `rgba(40,28,52,${a})`); R(i * 2, 0, 2, YH, `rgba(40,28,52,${a * 0.8})`); R(XW - 2 - i * 2, 0, 2, YH, `rgba(40,28,52,${a * 0.8})`);
    }

    // laje (frente) e paredes laterais finas
    R(-SIDE, YH, XW + 2 * SIDE, SLAB, '#9c9486'); R(-SIDE, YH, XW + 2 * SIDE, 1, '#bdb4a3'); R(-SIDE, YH + 1, XW + 2 * SIDE, 1, '#aea595'); R(-SIDE, YH + SLAB - 2, XW + 2 * SIDE, 2, '#7a7164');
    R(-SIDE, -WALL_H, SIDE, WALL_H + YH + SLAB, WALL_SIDE); R(XW, -WALL_H, SIDE, WALL_H + YH + SLAB, WALL_SIDE);
    R(-SIDE, -WALL_H, 1, WALL_H + YH + SLAB, '#6b7aa0'); R(XW + SIDE - 1, -WALL_H, 1, WALL_H + YH + SLAB, '#37425c');
    R(-1, 0, 1, YH, 'rgba(20,24,40,0.25)'); R(XW, 0, 1, YH, 'rgba(20,24,40,0.25)');
    R(-SIDE, -WALL_H, SIDE, 4, WALL_CAP); R(XW, -WALL_H, SIDE, 4, WALL_CAP);

    // parede dos fundos: papel de parede com ripado, lambri com painéis, cornija e rodapé
    R(-SIDE, -WALL_H, XW + 2 * SIDE, WALL_H, WALL_BACK);
    for (let x = 0; x < XW; x += 8) { R(x, -WALL_H + 6, 1, WALL_H - 26, 'rgba(255,255,255,0.055)'); R(x + 4, -WALL_H + 6, 1, WALL_H - 26, 'rgba(20,24,60,0.05)'); }
    R(0, -WALL_H + 5, XW, WALL_H - 5, 'rgba(255,230,190,0.0)');
    R(0, -18, XW, 18, WALL_LOW); R(0, -19, XW, 1, '#98a6c8'); R(0, -18, XW, 1, '#4d5a80');
    for (let x = 4; x + 20 <= XW - 4; x += 24) { R(x, -15, 20, 9, 'rgba(0,0,0,0.12)'); R(x, -15, 20, 1, 'rgba(255,255,255,0.14)'); R(x, -15, 1, 9, 'rgba(255,255,255,0.08)'); R(x + 19, -15, 1, 9, 'rgba(0,0,0,0.12)'); }
    R(0, -5, XW, 1, '#8794b8'); R(0, -4, XW, 4, WALL_BASE); R(0, -4, XW, 1, '#2d3652'); R(0, -1, XW, 1, '#262d45');
    R(-SIDE, -WALL_H, XW + 2 * SIDE, 5, WALL_CAP); R(-SIDE, -WALL_H, XW + 2 * SIDE, 1, '#c3cee6'); R(-SIDE, -WALL_H + 5, XW + 2 * SIDE, 1, '#5f6d93'); R(0, -WALL_H + 6, XW, 2, 'rgba(30,36,70,0.16)'); R(0, -WALL_H + 8, XW, 2, 'rgba(30,36,70,0.07)');

    // janelas com cortinas, nuvens, prédios ao longe e peitoril
    const SKY = ['#aad2f2', '#98c3ec', '#85b3e3', '#73a3d9', '#6293cc'];
    const wins = [];
    for (let x = 6 * T; x + 26 <= XW - 12; x += 5 * T) wins.push(x);
    for (const x of wins) {
      R(x - 2, -16, 30, 2, '#d4dbe8'); R(x - 2, -16, 30, 1, '#f1f4fa'); R(x - 1, -14, 28, 1, 'rgba(20,24,60,0.18)');
      R(x, -42, 26, 28, '#eef1f8'); R(x, -42, 26, 1, '#ffffff'); R(x + 25, -42, 1, 28, '#c4ccdd');
      for (let i = 0; i < 5; i++) R(x + 2, -40 + i * 5, 22, 5, SKY[i]);
      R(x + 4, -37, 6, 2, 'rgba(255,255,255,0.85)'); R(x + 6, -39, 5, 2, 'rgba(255,255,255,0.85)'); R(x + 15, -33, 5, 2, 'rgba(255,255,255,0.8)'); R(x + 16, -35, 3, 2, 'rgba(255,255,255,0.8)');
      for (const [bx, bw, bh] of [[2, 4, 8], [7, 5, 11], [13, 4, 7], [18, 6, 10]]) R(x + bx, -16 - bh, bw, bh, '#7a98cb');
      for (const [bx, bw, bh] of [[3, 5, 6], [10, 6, 9], [17, 5, 5]]) { R(x + bx, -16 - bh, bw, bh, '#3b4f86'); R(x + bx + 1, -16 - bh + 2, 1, 1, '#ffe08a'); R(x + bx + 3, -16 - bh + 4, 1, 1, '#ffe08a'); }
      R(x + 19, -39, 2, 2, '#fff6c8');
      R(x + 12, -42, 2, 28, '#eef1f8'); R(x, -29, 26, 2, '#eef1f8');
      R(x - 4, -46, 34, 1, '#6b5538'); R(x - 5, -47, 2, 3, '#8a6e48'); R(x + 28, -47, 2, 3, '#8a6e48');                     // varão
      for (const cx of [x - 3, x + 24]) { R(cx, -45, 5, 31, '#e9dcc6'); R(cx + 1, -45, 1, 31, '#cdbea4'); R(cx + 3, -45, 1, 31, '#f6ecd9'); R(cx, -14, 5, 1, '#cdbea4'); }
    }
    w.lights = wins;
    // quadros entre as janelas
    for (let i = 0; i + 1 < wins.length; i += 1) {
      if (i % 2) continue;
      const cx = wins[i] + 26 + 26, fy = -40, kind = (i / 2) % 3;
      R(cx - 9, fy + 1, 18, 22, 'rgba(20,24,60,0.2)'); R(cx - 9, fy, 18, 22, '#8a6a44'); R(cx - 9, fy, 18, 1, '#b08a5c'); R(cx - 8, fy + 1, 16, 20, '#f2ecdc');
      if (kind === 0) { R(cx - 6, fy + 3, 12, 16, '#9cc3e8'); R(cx - 6, fy + 12, 12, 7, '#4f8f5b'); R(cx - 6, fy + 15, 12, 4, '#3a7a4a'); R(cx + 2, fy + 5, 3, 3, '#ffe08a'); }
      else if (kind === 1) { R(cx - 6, fy + 3, 12, 16, '#2f3550'); R(cx - 4, fy + 5, 5, 5, '#e0a21b'); R(cx, fy + 9, 5, 7, '#c0504d'); R(cx - 5, fy + 13, 4, 4, '#4bacc6'); }
      else { R(cx - 6, fy + 3, 12, 16, '#e9e5d8'); R(cx - 5, fy + 5, 10, 2, '#2f3550'); R(cx - 5, fy + 9, 10, 1, '#9aa0b5'); R(cx - 5, fy + 11, 8, 1, '#9aa0b5'); R(cx - 5, fy + 13, 9, 1, '#9aa0b5'); R(cx - 5, fy + 16, 4, 2, '#c0504d'); }
    }
    // relógio
    {
      const cxk = 5 * T + 6;
      R(cxk - 7, -37, 15, 15, 'rgba(20,24,60,0.2)'); R(cxk - 7, -38, 15, 15, '#6b5538'); R(cxk - 6, -37, 13, 13, '#fbfcff'); R(cxk - 5, -36, 11, 11, '#f0f2f8');
      for (const [dx, dy] of [[0, -5], [5, 0], [0, 5], [-5, 0]]) R(cxk + dx, -31 + dy, 1, 1, '#2f3550');
      R(cxk, -35, 1, 4, INK); R(cxk, -31, 3, 1, INK); R(cxk, -31, 1, 1, '#c0504d');
    }
    // moldura do elevador, com bisel e painel do indicador de andar
    R(17, -47, 46, 47, 'rgba(20,24,40,0.25)'); R(18, -46, 44, 46, '#7a859a'); R(20, -46, 40, 46, '#a6b0c2');
    R(20, -46, 40, 1, '#d6dce8'); R(20, -46, 1, 46, '#c6cedb'); R(59, -46, 1, 46, '#6a758a'); R(18, -46, 2, 46, '#6a758a'); R(60, -46, 2, 46, '#5c667a');
    R(20, -46, 40, 7, '#58627a'); R(21, -45, 38, 1, '#7c88a2'); R(22, -3, 36, 3, '#8a95a8'); R(22, -3, 36, 1, '#b5bece');
    R(29, -45, 22, 5, '#0f1218'); R(29, -45, 22, 1, '#2a303c');
  }

  // ---------- recolocar os atores depois de o layout mudar ----------
  relayoutActors(now) {
    const w = this.world;
    for (const sp of w.spots) sp.owner = null;
    for (const a of this.actors.values()) {
      if (a.kind === 'lounge') {
        const sp = w.spotByKey.get(a.spotKey);
        if (sp && !sp.owner) { sp.owner = a.id; a.spot = sp; } else { a.spot = null; a.kind = 'none'; }
      }
    }
    for (const a of this.actors.values()) {
      if (a.fresh) continue;
      const kind = a.kind;
      if (kind === 'desk' && a.arrived) { const s = this.seatTile(a); if (s) { a.x = s.px; a.y = s.py; } }
      else if (kind === 'lounge' && a.arrived && a.spot) { a.x = a.spot.px; a.y = a.spot.py; }
      else {
        // em trânsito: garante que está dentro do mapa e replaneja
        a.x = clamp(a.x, 0.3, w.X - 0.3); a.y = clamp(a.y, 0.3, w.Y - 0.3);
        if (kind !== 'none') { a.kind = 'none'; this.think(a, now, false); }
      }
    }
  }
  seatTile(a) { const t = this.world.seatTiles.get(a.d.plataforma); return t && t[a.seat]; }

  // ---------- decisão e caminhos ----------
  // decide para onde o ator quer ir pelo estado dele
  think(a, now, direct) {
    const d = a.d;
    let want;
    if (a.leaving || d.estado === 'saindo') want = 'exit';
    else if (d.estado === 'ocioso') want = (a.kind === 'desk' && now - a.estadoSince < IDLE_DELAY) ? 'desk' : 'lounge';
    else want = 'desk';
    if (want === a.kind) return;
    this.assign(a, want, now, direct);
  }
  assign(a, kind, now, direct) {
    if (a.kind === 'lounge' && kind !== 'lounge') this.freeSpot(a);
    let tx, ty, fx, fy;
    if (kind === 'desk') {
      const s = this.seatTile(a);
      if (!s) { tx = Math.floor(DOOR_X); ty = 0; fx = DOOR_X; fy = 0.5; } else { tx = s.cx; ty = s.cy; fx = s.px; fy = s.py; }
    } else if (kind === 'lounge') {
      const sp = this.allocSpot(a);
      tx = sp.gx; ty = sp.gy; fx = sp.px; fy = sp.py;
    } else { tx = Math.floor(DOOR_X); ty = 0; fx = DOOR_X; fy = 0.1; }
    a.kind = kind; a.arrived = false;
    if (direct) { a.x = fx; a.y = fy; a.path.length = 0; a.pi = 0; this.arrive(a, now); return; }
    this.planPath(a, tx, ty, fx, fy);
    if (!a.path.length) { a.x = fx; a.y = fy; this.arrive(a, now); }
  }
  allocSpot(a) {
    const sp = this.world.spots;
    let pick = null;
    for (const s of sp) if (!s.owner) { pick = s; break; }
    if (!pick) pick = sp[hashStr(a.id) % sp.length]; // lotado: divide o lugar
    else pick.owner = a.id;
    a.spot = pick; a.spotKey = pick.kid;
    return pick;
  }
  freeSpot(a) { if (a.spot && a.spot.owner === a.id) a.spot.owner = null; a.spot = null; }

  // BFS a partir do destino; depois anda preferindo seguir em linha reta
  planPath(a, gx, gy, fx, fy) {
    const w = this.world, W = w.X, H = w.Y, blk = w.blocked, dist = this._dist, q = this._q;
    const sx = clamp(Math.floor(a.x), 0, W - 1), sy = clamp(Math.floor(a.y), 0, H - 1);
    a.path.length = 0; a.pi = 0;
    const goal = gy * W + gx, start = sy * W + sx;
    dist.fill(-1, 0, W * H);
    let qh = 0, qt = 0;
    dist[goal] = 0; q[qt++] = goal;
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    while (qh < qt) {
      const c = q[qh++];
      if (c === start) break;
      const cx = c % W, cy = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (dist[ni] !== -1 || (blk[ni] && ni !== start)) continue;
        dist[ni] = dist[c] + 1; q[qt++] = ni;
      }
    }
    if (dist[start] === -1) { a.path.push(fx, fy); return; }       // sem caminho: vai direto
    let cx = sx, cy = sy, dir = -1;
    while (cx !== gx || cy !== gy) {
      const d0 = dist[cy * W + cx];
      let nd = -1;
      if (dir >= 0) { const nx = cx + DX[dir], ny = cy + DY[dir]; if (nx >= 0 && ny >= 0 && nx < W && ny < H && dist[ny * W + nx] === d0 - 1) nd = dir; }
      if (nd < 0) for (let d = 0; d < 4; d++) { const nx = cx + DX[d], ny = cy + DY[d]; if (nx >= 0 && ny >= 0 && nx < W && ny < H && dist[ny * W + nx] === d0 - 1) { nd = d; break; } }
      if (nd < 0) break;
      dir = nd; cx += DX[nd]; cy += DY[nd];
      a.path.push(cx + 0.5, cy + 0.5);
    }
    a.path.push(fx, fy);
  }
  arrive(a, now) {
    a.arrived = true; a.arrivedAt = now; a.moving = false;
    if (a.kind === 'exit') { a.gone = a.alpha <= 0.02 || a.y < 0.3; }
  }

  // ---------- atualização por quadro ----------
  update(dt, now) {
    const w = this.world;
    let doorWant = 0;
    for (const a of this.actors.values()) {
      this.think(a, now, false);
      // movimento
      if (!a.arrived && a.path.length) {
        let step = SPEED * dt;
        a.moving = true;
        while (step > 0 && a.pi < a.path.length) {
          const tx = a.path[a.pi], ty = a.path[a.pi + 1];
          const dx = tx - a.x, dy = ty - a.y, dist = Math.hypot(dx, dy);
          if (dist <= step) { a.x = tx; a.y = ty; step -= dist; a.pi += 2; }
          else {
            a.x += dx / dist * step; a.y += dy / dist * step; step = 0;
            if (Math.abs(dx) > Math.abs(dy)) a.face = dx > 0 ? 0 : 2; else a.face = dy > 0 ? 1 : 3;
          }
        }
        a.walkT += dt * 8;
        if (a.pi >= a.path.length) this.arrive(a, now);
      }
      // aparece/some junto da porta do elevador (a opacidade segue a distância até a porta)
      if (a.entering || a.kind === 'exit') {
        const dd = Math.hypot(a.x - DOOR_X, a.y - 0.1);
        a.alpha = clamp((dd - 0.1) / 0.6, 0, 1);
        if (a.entering && dd > 0.9) { a.entering = false; a.alpha = 1; }
        if (a.kind === 'exit' && (a.arrived || a.alpha <= 0.02)) a.gone = true;
        if (dd < 2.5) doorWant = 1;
      }
      // posição na tela e ordem de profundidade (pelo y dos pés)
      a.fx = Math.round(a.x * T); a.fy = Math.round(a.y * T);
      if (a.kind === 'desk' && a.arrived) { const s = this.seatTile(a); a.key = s ? s.base + 5 : a.fy; }
      else a.key = a.fy + 0.002;
      if (a.gone) { this.left.set(a.id, now); this.removeActor(a); }
    }
    this.doorOpen += (doorWant - this.doorOpen) * Math.min(1, dt * 6);
    // câmera suave quando se pede "centralizar"
    if (this.camTarget) {
      const c = this.camTarget, f = Math.min(1, dt * 9);
      this.tx = Math.round(this.tx + (c.tx - this.tx) * f); this.ty = Math.round(this.ty + (c.ty - this.ty) * f);
      if (Math.abs(c.tx - this.tx) < 1 && Math.abs(c.ty - this.ty) < 1) { this.tx = c.tx; this.ty = c.ty; this.camTarget = null; }
    }
  }

  // ---------- desenho ----------
  frame(ts) {
    this._raf = requestAnimationFrame(this._frame);
    let dt = this._last ? (ts - this._last) / 1000 : 0.016;
    this._last = ts;
    if (dt > 0.1) dt = 0.1;
    if (!this.world) { this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.fillStyle = this.bg; this.g.fillRect(0, 0, this.W, this.H); return; }
    this.update(dt, ts);
    this.draw(ts);
  }

  draw(now) {
    const g = this.g, k = this.k, w = this.world;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = this.bg; g.fillRect(0, 0, this.W, this.H);
    g.setTransform(k, 0, 0, k, this.tx, this.ty);
    g.drawImage(this.base, -w.baseAx, -w.baseAy);
    // sol que entra pelas janelas e cai no chão (a intensidade oscila bem devagar)
    const luz = sprLight();
    for (let i = 0; i < w.lights.length; i++) { g.globalAlpha = 0.7 + 0.3 * Math.sin(now / 2600 + i * 1.7); g.drawImage(luz.c, w.lights[i] - 4, 2); }
    g.globalAlpha = 1;
    this.drawDoor(g, now);
    const sel = this.selectedId && this.actors.get(this.selectedId);
    const hov = this.hoverId && this.hoverId !== this.selectedId && this.actors.get(this.hoverId);
    // anéis no chão (seleção, parentes e hover) para quem está em pé ou andando
    const pulse = 0.55 + 0.45 * Math.sin(now / 220);
    if (sel) {
      for (const a of this.actors.values()) if (a !== sel && (a.id === sel.d.paiId || a.d.paiId === sel.id) && !this.isSeated(a)) ringEllipse(g, a.fx, a.fy, 9, 4, 'rgba(255,255,255,0.75)');
      if (!this.isSeated(sel)) { g.globalAlpha = 0.5 + pulse * 0.5; ringEllipse(g, sel.fx, sel.fy, 10, 4, '#ffffff'); g.globalAlpha = 1; }
    }
    if (hov && !this.isSeated(hov)) { g.globalAlpha = 0.8; ringEllipse(g, hov.fx, hov.fy, 9, 4, '#cfd8ea'); g.globalAlpha = 1; }

    // itens estáticos + atores, ordenados pelo y dos pés
    const items = this.items;
    items.length = 0;
    for (const s of w.statics) items.push(s);
    for (const a of this.actors.values()) items.push(a);
    items.sort(byKey);
    for (let i = 0; i < items.length; i++) this.drawItem(g, items[i], now);

    // leve tom quente de fim de tarde sobre o mapa
    g.fillStyle = 'rgba(255,214,150,0.045)'; g.fillRect(-SIDE, -WALL_H, w.X * T + 2 * SIDE, WALL_H + w.Y * T + SLAB);

    // quem está sentado: cantos em volta da estação
    if (sel && this.isSeated(sel)) { g.globalAlpha = 0.5 + pulse * 0.5; this.marker(g, sel, '#ffffff'); g.globalAlpha = 1; }
    if (sel) for (const a of this.actors.values()) if (a !== sel && this.isSeated(a) && (a.id === sel.d.paiId || a.d.paiId === sel.id)) { g.globalAlpha = 0.7; this.marker(g, a, '#ffffff'); g.globalAlpha = 1; }
    if (hov && this.isSeated(hov)) { g.globalAlpha = 0.8; this.marker(g, hov, '#cfd8ea'); g.globalAlpha = 1; }

    this.drawLinks(g, now, sel);
    this.drawOverlay(now);
  }
  isSeated(a) { return a.arrived && a.kind === 'desk'; }
  marker(g, a, c) {
    const s = this.seatTile(a);
    if (s) brackets(g, s.cx * T - 3, s.base - 26, s.cx * T + 34, s.base + 18, c);
  }

  // porta do elevador na parede dos fundos: metal escovado, painéis que deslizam e indicador de andar
  drawDoor(g, now) {
    const o = this.doorOpen, x0 = 24, y0 = -40, half = 16, open = Math.round(14 * o), wp = half - open;
    rect(g, x0, y0, 32, 40, '#0e1118'); rect(g, x0 + 2, y0 + 2, 28, 38, '#1a2030');
    rect(g, x0 + 4, y0 + 2, 24, 2, o > 0.05 ? '#ffe9a8' : '#4a4636');                       // luz do teto da cabine
    rect(g, x0 + 4, y0 + 24, 24, 1, '#7d879b'); rect(g, x0 + 14, y0 + 6, 4, 34, o > 0.2 ? '#27304a' : '#1a2030');
    const porta = (xs, wd, claro) => {
      rect(g, xs, y0, wd, 40, claro ? '#b8c1d0' : '#abb5c5');
      for (let i = 1; i < wd; i += 3) rect(g, xs + i, y0, 1, 40, claro ? '#c7cfdc' : '#bbc4d2');
      rect(g, xs, y0, wd, 1, '#e0e6ef'); rect(g, xs, y0 + 39, wd, 1, '#8791a5'); rect(g, xs, y0 + 20, wd, 1, 'rgba(70,80,100,0.2)');
    };
    if (wp > 0) {
      porta(x0, wp, true); rect(g, x0 + wp - 1, y0, 1, 40, '#76808f'); rect(g, x0, y0, 1, 40, '#8f99ab');
      porta(x0 + 32 - wp, wp, false); rect(g, x0 + 32 - wp, y0, 1, 40, '#76808f'); rect(g, x0 + 31, y0, 1, 40, '#8f99ab');
      rect(g, x0 + wp, y0 + 2, 2, 38, 'rgba(10,8,20,0.28)');
    }
    // indicador acima da porta: três lâmpadas que correm e uma seta que acende quando a porta abre
    for (let i = 0; i < 3; i++) rect(g, 31 + i * 5, -44, 3, 2, (o > 0.05 && ((now / 220) | 0) % 3 === i) ? '#ffcf5a' : '#3a3f4c');
    rect(g, 46, -44, 3, 1, o > 0.05 ? '#ffcf5a' : '#3a3f4c'); rect(g, 47, -45, 1, 3, o > 0.05 ? '#ffcf5a' : '#3a3f4c');
  }

  drawItem(g, it, now) {
    switch (it.t) {
      case T_SPR: case T_CBACK: g.drawImage(it.spr.c, it.x - it.spr.ax, it.y - it.spr.ay); break;
      case T_PLANT: {                                         // as folhas balançam devagar
        const s = sprPlant(it.v, [0, 1, 2, 1][((now / 700 + it.ph) | 0) & 3]);
        g.drawImage(s.c, it.x - s.ax, it.y - s.ay);
        break;
      }
      case T_COFFEE: {                                        // vapor subindo da cafeteira
        g.drawImage(it.spr.c, it.x - it.spr.ax, it.y - it.spr.ay);
        for (let i = 0; i < 3; i++) {
          const p = (now / 1500 + i / 3) % 1, sx = it.x + 3 + Math.round(Math.sin(p * 6 + i * 2) * 1.5), sy = it.y - 34 - Math.round(p * 10);
          g.globalAlpha = (1 - p) * 0.6; rect(g, sx, sy, 2, 2, '#ffffff'); rect(g, sx + 1, sy - 1, 1, 1, '#ffffff');
        }
        g.globalAlpha = 1;
        break;
      }
      case T_DESK: {
        g.drawImage(it.spr.c, it.x - it.spr.ax, it.y - it.spr.ay);
        const a = this.seatOwner(it.pid, it.idx);
        let mode = 0;
        const seated = a && a.kind === 'desk' && a.arrived;
        if (seated) {
          const e = a.d.estado;
          mode = e === 'trabalhando' ? 1 : e === 'pensando' ? 2 : e === 'esperando' ? 3 : 4;
        }
        drawScreen(g, it.x, it.base, mode, now, it.pal, hashStr(it.pid) + it.idx);
        if (mode === 1) {                                      // a tela acesa ilumina o tampo na cor da plataforma
          g.globalAlpha = 0.13; rect(g, it.x + 1, it.base - 1, 13, 9, it.pal.glow);
          g.globalAlpha = 0.08; rect(g, it.x + 3, it.base + 5, 14, 4, it.pal.glow); rect(g, it.x + 14, it.base + 1, 8, 7, it.pal.glow);
          g.globalAlpha = 1;
        } else if (mode === 2 || mode === 3) { g.globalAlpha = 0.07; rect(g, it.x + 1, it.base - 1, 13, 9, mode === 2 ? '#b7a4ff' : '#ffd36b'); g.globalAlpha = 1; }
        if (seated) {
          const t = mode === 1 ? ((now / 120) | 0) & 1 : 0, key = 600 + t;
          let hs = a.sprs[key]; if (!hs) hs = a.sprs[key] = buildHands(a, t);
          if (a.alpha < 1) g.globalAlpha = a.alpha;
          g.drawImage(hs, it.cx - 12, it.base - 7);
          g.globalAlpha = 1;
        }
        break;
      }
      case T_ACTOR: this.drawActor(g, it, now); break;
      default: break;
    }
  }
  seatOwner(pid, idx) { const s = this.seats.get(pid); const id = s && s[idx]; return id ? this.actors.get(id) : null; }

  drawActor(g, a, now) {
    if (a.alpha < 0.03) { a.hit.x1 = -1; return; }
    const sitting = a.arrived && a.kind === 'desk', lounging = a.arrived && a.kind === 'lounge';
    const moving = !a.arrived && a.path.length > 0;
    let pidx = 0, dir = 0, cup = 0;                         // 0 em pé, 1 andando, 2 sentado à mesa, 3 sentado no sofá
    if (sitting) pidx = 2;
    else if (lounging && a.spot && a.spot.seat) pidx = 3;
    else if (lounging) cup = 1;
    else if (moving) { pidx = 1; dir = a.face === 0 ? 1 : a.face === 1 ? 0 : a.face === 2 ? 3 : 2; }
    const frame = pidx === 1 ? ((a.walkT | 0) & 3) : 0;
    const bob = pidx === 0 && ((((now + a.phase) / 700) | 0) & 1) ? 1 : 0;
    const blink = ((now + a.phase * 3) % 4300) < 140 ? 1 : 0;
    const idx = ((((pidx * 4 + dir) * 4 + frame) * 2 + bob) * 2 + blink) * 2 + cup;
    let s = a.sprs[idx];
    if (!s) {
      const o = this._pose;
      o.pose = pidx === 0 ? 'stand' : pidx === 1 ? 'walk' : pidx === 2 ? 'sitD' : 'sitS'; o.dir = dir; o.frame = frame; o.bob = bob ? -1 : 0; o.blink = blink; o.cup = !!cup;
      s = a.sprs[idx] = buildPerson(a, o);
    }
    a.headH = 26;
    if (a.alpha < 1) g.globalAlpha = a.alpha;
    g.drawImage(s, a.fx - 14, a.fy - 31);
    if (sitting && a.d.estado === 'trabalhando') {         // luz da tela no rosto, vinda da esquerda
      g.globalAlpha = a.alpha * (0.10 + 0.04 * Math.sin(now / 300 + a.phase)); rect(g, a.fx - 4, a.fy - 20, 2, 4, a.pal.glow);
    }
    g.globalAlpha = 1;
    // área de clique (pixels do dispositivo)
    const k = this.k;
    a.hit.x0 = (a.fx - 8) * k + this.tx; a.hit.x1 = (a.fx + 8) * k + this.tx;
    a.hit.y0 = (a.fy - 27) * k + this.ty; a.hit.y1 = (a.fy + (sitting ? -1 : 2)) * k + this.ty;
  }

  // linhas pontilhadas: de quem chamou (paiId) até o chamado que está trabalhando
  drawLinks(g, now, sel) {
    for (const a of this.actors.values()) {
      const d = a.d;
      if (!d.paiId || a.alpha < 0.5) continue;
      const pai = this.actors.get(d.paiId);
      if (!pai) continue;
      const ativo = d.papel === 'chamado' && d.estado === 'trabalhando';
      const rel = sel && (sel === a || sel === pai);
      if (!ativo && !rel) continue;
      this.link(g, pai, a, ativo ? a.pal.glow : '#ffffff', ativo ? now : -1);
    }
  }
  link(g, p, c, color, now) {
    const x0 = p.fx, y0 = p.fy - 14, x1 = c.fx, y1 = c.fy - 14;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 4) return;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - Math.min(40, 10 + len * 0.18);
    const n = Math.max(4, Math.round(len / 7));
    const ph = now < 0 ? 0 : (now / 70) % 1;
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const s = now < 0 ? (i + 0.5) / n : (i + ph) / n, r = 1 - s;
      const x = Math.round(r * r * x0 + 2 * r * s * mx + s * s * x1), y = Math.round(r * r * y0 + 2 * r * s * my + s * s * y1);
      if (now < 0) { if (i & 1) continue; g.globalAlpha = 0.75; g.fillRect(x, y, 2, 2); g.globalAlpha = 1; }
      else { g.globalAlpha = 0.35 + 0.65 * s; g.fillRect(x, y, 2, 2); g.globalAlpha = 1; }
    }
  }

  // placas, nomes e balões em espaço de tela (escala inteira própria)
  drawOverlay(now) {
    const g = this.g, k = this.k, tp = this.tp, tx = this.tx, ty = this.ty;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const placas = [];
    for (const s of this.world.signs) {
      const c = signSprite(s.nome, s.pal), w = c.width * tp, h = c.height * tp;
      const x = Math.round(s.x * k + tx - w / 2), y = Math.round(s.y * k + ty - h);
      g.drawImage(c, x, y, w, h);
      placas.push({ x0: x, x1: x + w, y0: y, y1: y + h });
    }
    const sel = this.selectedId && this.actors.get(this.selectedId);
    const hov = this.hoverId && this.actors.get(this.hoverId);
    // 1) mede o nome e o balão de cada um
    const caixas = [];
    for (const it of this.items) {
      if (it.t !== T_ACTOR) continue;
      const m = this.measureOverlay(it, now, it === sel || it === hov ? 1 : 0);
      if (m) caixas.push(m);
    }
    // 2) quem está mais à frente (mais embaixo na tela) fica no lugar; os de trás sobem até não encostar.
    //    O nome e o balão de cada um são retângulos separados que sobem juntos.
    caixas.sort((a, b) => b.lr.y1 - a.lr.y1);
    const postas = [...placas], folga = tp;
    const bate = (r, p) => r.x0 < p.x1 + folga && r.x1 > p.x0 - folga && r.y0 < p.y1 + folga && r.y1 > p.y0 - folga;
    const limite = Math.round((this.world.bounds.minY + 10) * k + ty);   // não sobe para fora do mapa
    for (const c of caixas) {
      let mudou = true, voltas = 0;
      while (mudou && voltas++ < 40) {
        mudou = false;
        for (const r of c.rs) {
          if (!r) continue;
          for (const p of postas) {
            if (bate(r, p)) {
              const sobe = r.y1 - (p.y0 - folga);
              const topo = Math.min(c.lr.y0, c.br ? c.br.y0 : Infinity) - sobe;
              if (topo < limite) {
                // lotado lá em cima (o sofá do lounge fica colado na parede): desvia para o lado
                const dir = p.x1 + folga - r.x0, esq = (p.x0 - folga) - r.x1;
                const dx = Math.abs(dir) <= Math.abs(esq) ? dir : esq;
                for (const q of c.rs) if (q) { q.x0 += dx; q.x1 += dx; }
                c.dx += dx; mudou = true; break;
              }
              for (const q of c.rs) if (q) { q.y0 -= sobe; q.y1 -= sobe; }
              c.dy -= sobe; mudou = true; break;
            }
          }
          if (mudou) break;
        }
      }
      postas.push(c.lr); if (c.br) postas.push(c.br);
    }
    // 3) desenha; selecionado e hover por último, por cima
    const ordem = caixas.filter((c) => c.a !== sel && c.a !== hov);
    for (const c of caixas) if (c.a === hov && hov !== sel) ordem.push(c);
    for (const c of caixas) if (c.a === sel) ordem.push(c);
    for (const c of ordem) this.drawOverlayBox(c, now);
  }
  measureOverlay(a, now, hl) {
    if (a.alpha < 0.05) return null;
    const k = this.k, tp = this.tp, d = a.d;
    const hx = Math.round(a.fx * k + this.tx), hy = Math.round((a.fy - a.headH) * k + this.ty);
    if (hx < -300 || hx > this.W + 300 || hy < -200 || hy > this.H + 100) return null;
    const rel = !hl && this.selectedId && (d.paiId === this.selectedId || (this.actors.get(this.selectedId) || {}).d?.paiId === a.id);
    const ls = labelSprite(clip(d.nome || d.id, hl ? 26 : this.nameMax), a.pal.accent, hl ? 1 : rel ? 2 : 0, this.light);
    const lw = ls.width * tp, lh = ls.height * tp;
    const ly = hy - lh - tp;
    let bs = null;
    if (a.arrived && a.kind === 'desk' && (hl || !this.lowZoom)) {   // com a vista toda no celular, balões só de quem foi tocado
      if (d.estado === 'trabalhando') {
        const detalhe = hl || k / this.dpr >= 1.5;   // de longe, só o nome da ferramenta
        const txt = d.ferramenta ? (d.detalhe && detalhe ? d.ferramenta + ': ' + d.detalhe : d.ferramenta) : (d.detalhe || '...');
        bs = bubbleSay(clip(txt, hl ? 40 : detalhe ? this.bubMax : 10));
      } else if (d.estado === 'pensando') bs = bubbleThink((((now + a.phase) / 380) | 0) % 3 + 1);
      else if (d.estado === 'esperando') bs = bubbleWait((((now + a.phase) / 450) | 0) % 5);
    }
    const bw = bs ? bs.width * tp : 0, bh = bs ? bs.height * tp : 0;
    const zz = !bs && a.arrived && a.kind === 'lounge' && now - a.arrivedAt > ZZ_DELAY;
    const lr = { x0: hx - (lw >> 1), x1: hx - (lw >> 1) + lw, y0: ly, y1: ly + lh };
    let br = null;
    if (bs) br = { x0: hx - (bw >> 1), x1: hx - (bw >> 1) + bw, y0: ly - bh - tp, y1: ly - tp };
    else if (zz) br = { x0: hx + 6 * tp, x1: hx + 19 * tp, y0: ly - 22 * tp, y1: ly - tp };
    return { a, hl, hx, hy, ls, lw, lh, ly, bs, bw, bh, zz, dy: 0, dx: 0, lr, br, rs: [lr, br] };
  }
  drawOverlayBox(c, now) {
    const g = this.g, tp = this.tp, a = c.a;
    const ly = c.ly + c.dy, lx = c.hx + c.dx;
    g.globalAlpha = a.alpha;
    // empurrado para cima ou para o lado: um fio liga o nome à cabeça
    if (c.dy < -tp || Math.abs(c.dx) > tp) {
      const fio = Math.max(1, tp >> 1);
      g.globalAlpha = a.alpha * 0.5; g.fillStyle = a.pal.accent;
      const yb = ly + c.lh;
      if (yb < c.hy) g.fillRect(c.hx, yb, fio, c.hy - yb);
      if (Math.abs(c.dx) > tp) g.fillRect(Math.min(c.hx, lx), yb - fio, Math.abs(c.dx), fio);
      g.globalAlpha = a.alpha;
    }
    g.drawImage(c.ls, lx - (c.lw >> 1), ly, c.lw, c.lh);
    this.actorBubble(c, a, ly, now);
    g.globalAlpha = 1;
  }
  actorBubble(c, a, ly, now) {
    const g = this.g, tp = this.tp;
    const bs = c.bs, hx = c.hx + c.dx;
    if (bs) {
      const bw = bs.width * tp, bh = bs.height * tp;
      g.drawImage(bs, hx - (bw >> 1), ly - bh - tp, bw, bh);
    } else if (c.zz) {
      const gs = glyphSprite('Z');
      for (let i = 0; i < 3; i++) {
        const ph = ((now + a.phase + i * 700) / 2100) % 1;
        g.globalAlpha = a.alpha * (1 - ph * ph);
        g.drawImage(gs, hx + (6 + i * 4) * tp, Math.round(ly - gs.height * tp - (1 + ph * 14) * tp), gs.width * tp, gs.height * tp);
      }
    }
    g.globalAlpha = 1;
  }

  // ---------- câmera ----------
  resize() {
    const c = this.canvas, par = c.parentElement || c;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(par.clientWidth)), ch = Math.max(1, Math.round(par.clientHeight));
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    this.dpr = dpr;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; c.style.width = cw + 'px'; c.style.height = ch + 'px'; }
    this.W = W; this.H = H;
    this.kMin = Math.max(1, Math.floor(dpr * 0.67));
    this.kMax = Math.max(8, Math.round(dpr * 5));
    this.g.imageSmoothingEnabled = false;
    if (this.world && !this.userMoved && this.zoneList.length > 1 && this.pickCols(this.zoneList) !== this.zcCur) {
      this.rebuildWorld();                 // a proporção da tela mudou bastante: outra grade de zonas aproveita melhor
      this.relayoutActors(performance.now());
    } else if (this.world && !this.userMoved) this.fit(); else this.updateTp();
  }
  updateTp() {
    this.k = clamp(this.k, this.kMin, this.kMax);
    this.tp = Math.max(this.k, Math.round(1.5 * this.dpr));
    this.lowZoom = this.k < this.dpr;          // menos de 1 px de CSS por pixel lógico (celular com a vista toda)
    this.nameMax = this.lowZoom ? 6 : clamp(Math.floor((3 * T * this.k * 0.95) / (4 * this.tp)), 6, 16);
    this.bubMax = clamp(this.nameMax + 6, 12, 26);
    this.onView && this.onView(this);
  }
  fit() {
    if (!this.world || !this.W) return;
    const b = this.world.bounds, w = b.maxX - b.minX, h = b.maxY - b.minY, pad = 8 * this.dpr;
    let k = Math.floor(Math.min((this.W - pad * 2) / w, (this.H - pad * 2) / h));
    this.k = clamp(k, this.kMin, this.kMax);
    this.tx = Math.round((this.W - w * this.k) / 2 - b.minX * this.k);
    this.ty = Math.round((this.H - h * this.k) / 2 - b.minY * this.k);
    this.camTarget = null;
    this.updateTp();
  }
  resetView() { this.userMoved = false; this.fit(); }
  clampPan() {
    if (!this.world) return;
    const b = this.world.bounds, k = this.k, m = Math.min(160, this.W / 3);
    const x0 = this.tx + b.minX * k, x1 = this.tx + b.maxX * k, y0 = this.ty + b.minY * k, y1 = this.ty + b.maxY * k;
    if (x1 < m) this.tx += Math.round(m - x1); else if (x0 > this.W - m) this.tx -= Math.round(x0 - (this.W - m));
    if (y1 < m) this.ty += Math.round(m - y1); else if (y0 > this.H - m) this.ty -= Math.round(y0 - (this.H - m));
  }
  zoomAt(newK, dx, dy) {
    newK = clamp(newK, this.kMin, this.kMax);
    if (newK === this.k) return;
    const wx = (dx - this.tx) / this.k, wy = (dy - this.ty) / this.k;
    this.k = newK;
    this.tx = Math.round(dx - wx * newK); this.ty = Math.round(dy - wy * newK);
    this.userMoved = true; this.camTarget = null;
    this.clampPan(); this.updateTp();
  }
  zoomBy(dir) { this.zoomAt(this.k + dir, this.W / 2, this.H / 2); }
  centerOn(id, insetDireita = 0) {      // insetDireita: pixels do canvas cobertos pela gaveta de detalhe
    const a = this.actors.get(id);
    if (!a) return;
    this.userMoved = true;
    this.camTarget = { tx: Math.round((this.W - insetDireita) / 2 - a.fx * this.k), ty: Math.round(this.H / 2 - (a.fy - 12) * this.k) };
  }
  setSelected(id) { this.selectedId = id && this.actors.has(id) ? id : null; }

  // ---------- ponteiro ----------
  pick(dx, dy) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.t !== T_ACTOR || it.alpha < 0.3) continue;
      const h = it.hit;
      if (dx >= h.x0 && dx <= h.x1 && dy >= h.y0 && dy <= h.y1) return it;
    }
    return null;
  }
  _bind() {
    const c = this.canvas;
    this._pose = { pose: 'stand', dir: 0, frame: 0, bob: 0, blink: 0, cup: false };
    this._listeners = [];
    const on = (t, f, opt) => { c.addEventListener(t, f, opt); this._listeners.push([t, f]); };
    const dev = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (this.W / r.width), (e.clientY - r.top) * (this.H / r.height)]; };
    c.style.touchAction = 'none';

    on('pointerdown', (e) => {
      try { c.setPointerCapture(e.pointerId); } catch { /* ponteiro sintético */ }
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._ptrs.size === 1) this._drag = { x: e.clientX, y: e.clientY, tx0: this.tx, ty0: this.ty, moved: false, type: e.pointerType };
      else if (this._ptrs.size === 2) {
        const [p, q] = [...this._ptrs.values()];
        this._pinch = { d0: Math.hypot(p.x - q.x, p.y - q.y) || 1, k0: this.k };
        if (this._drag) this._drag.moved = true;
      }
    });
    on('pointermove', (e) => {
      const p = this._ptrs.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (this._ptrs.size >= 2 && this._pinch) {
        const [a, b] = [...this._ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const r = c.getBoundingClientRect(), sc = this.W / r.width;
        this.zoomAt(Math.round(this._pinch.k0 * d / this._pinch.d0), ((a.x + b.x) / 2 - r.left) * sc, ((a.y + b.y) / 2 - r.top) * sc);
        return;
      }
      if (this._drag && p) {
        const sc = this.W / c.getBoundingClientRect().width;
        const dx = (e.clientX - this._drag.x) * sc, dy = (e.clientY - this._drag.y) * sc;
        if (!this._drag.moved && Math.hypot(dx, dy) > 5 * this.dpr) { this._drag.moved = true; c.style.cursor = 'grabbing'; this.hoverClear(); }
        if (this._drag.moved) {
          this.tx = Math.round(this._drag.tx0 + dx); this.ty = Math.round(this._drag.ty0 + dy);
          this.userMoved = true; this.camTarget = null; this.clampPan();
        }
        return;
      }
      if (e.pointerType === 'mouse') {
        const [dx, dy] = dev(e), a = this.pick(dx, dy);
        c.style.cursor = a ? 'pointer' : 'grab';
        const id = a ? a.id : null;
        if (id !== this.hoverId) this.hoverId = id;
        this.onHover && this.onHover(a ? a.d : null, e.clientX, e.clientY);
      }
    });
    const up = (e) => {
      const had = this._ptrs.delete(e.pointerId);
      if (this._ptrs.size < 2) this._pinch = null;
      if (this._ptrs.size === 1 && this._drag) { // sobrou um dedo depois do pinch: recomeça o arrasto dali
        const [q] = [...this._ptrs.values()];
        this._drag = { x: q.x, y: q.y, tx0: this.tx, ty0: this.ty, moved: true, type: 'touch' };
      }
      if (had && this._drag && !this._drag.moved && this._ptrs.size === 0 && e.type === 'pointerup') {
        const [dx, dy] = dev(e), a = this.pick(dx, dy);
        this.selectedId = a ? a.id : null;
        this.onSelect && this.onSelect(this.selectedId, a ? { x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' } : null);
      }
      if (this._ptrs.size === 0) { this._drag = null; c.style.cursor = 'grab'; }
    };
    on('pointerup', up); on('pointercancel', up);
    on('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this._drag) this.hoverClear(); });
    on('wheel', (e) => {
      e.preventDefault();
      const [dx, dy] = dev(e);
      this._wheel += e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      if (Math.abs(this._wheel) >= 60) { this.zoomAt(this.k + (this._wheel < 0 ? 1 : -1), dx, dy); this._wheel = 0; }
    }, { passive: false });
    c.style.cursor = 'grab';

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    if (window.ResizeObserver) { this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(c.parentElement || c); }
  }
  hoverClear() { if (this.hoverId) { this.hoverId = null; } this.onHover && this.onHover(null); }
}
