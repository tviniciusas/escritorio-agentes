/* render.js — a cena do escritório em VISTA RETA (de frente e de cima, 3/4), canvas 2D, tudo procedural.
 *
 * Ideias principais:
 *  - O mundo é desenhado em "pixels lógicos" e ampliado por um fator INTEIRO (this.k, em
 *    pixels do dispositivo por pixel lógico), então os pixels ficam nítidos.
 *  - O piso é de tijolinho creme. A parede dos fundos aparece de frente (faixa no alto, com janelas,
 *    quadros e a porta do elevador); as laterais são bordas finas; embaixo, a laje.
 *  - Cada plataforma presente ganha uma "zona": carpete xadrez neutro com as mesas dela. A cor da
 *    plataforma não pinta o carpete, aparece em detalhes (bolinha do nome da área, tela dos monitores,
 *    faixa da cadeira, plaquinha da mesa). Cada agente tem uma mesa fixa na zona, sentado ATRÁS da
 *    mesa, de frente para quem olha; ociosos vão ao lounge; quem sai volta ao elevador. Tudo anda por
 *    caminhos (BFS) na grade de tiles.
 *  - Profundidade: ordena pelo y dos pés (o que está mais embaixo na tela desenha na frente).
 *  - Arte: paleta pastel, contorno seletivo nas pessoas (tom escuro do próprio preenchimento), sombras
 *    suaves sob móveis e pessoas e luz de janela. Pessoas e móveis são sprites em cache; só telas, vapor,
 *    plantas e luz são animados por quadro.
 *  - Textos (nomes, balões e nomes das áreas) usam a fonte sans do sistema, desenhada em resolução de
 *    tela (depois do scale) e guardada em sprites em cache, então ficam nítidos em qualquer zoom; os
 *    nomes desviam uns dos outros e dos nomes das áreas.
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
const TOPM = 2;                 // faixas de cima da zona: a 1ª fica livre (nome da área), a 2ª é corredor
const SEAT_DY = 6;              // quanto o quadril de quem senta fica abaixo da borda de cima da mesa
const HEAD_H = 28;              // altura da pessoa em pé (do pé ao topo do cabelo), px lógicos
const T_SPR = 0, T_DESK = 1, T_CBACK = 3, T_ACTOR = 4, T_COFFEE = 5, T_PLANT = 6;

// piso de tijolinho, carpete xadrez, parede e madeira clara
const BRICKS = ['#f8f0de', '#f5ecd6', '#f7eedb', '#f2e8d0'], MORTAR = '#e7dbbf', BRICK_HI = 'rgba(255,254,246,0.5)';
const CARPET = ['#b0bfb8', '#a3b3ac'], CARPET_RIM = '#8d9e96', CARPET_HI = '#c3d0ca';
const WALL_BACK = '#d0d8f0', WALL_LOW = '#bfc9e8', WALL_BASE = '#93a0c9', WALL_CAP = '#f0f3fc', WALL_SIDE = '#aab6da';
const WOOD = ['#f8e6bd', '#ecd3a2', '#dcbd84', '#c39f68', '#a48050'];     // madeira clara: luz, base, veio, frente, sombra
const LILAC = ['#9aa2e4', '#8b93d9', '#b3b9ee'];                            // piso do lounge: escuro, médio, claro
// cores de estado (as mesmas da página, tema escuro)
const ST_COLOR = { trabalhando: '#4ade80', pensando: '#a78bfa', esperando: '#fbbf24', ocioso: '#8b95a8', saindo: '#f87171' };
const FONT_STACK = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';

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
  p = {
    cor, c,
    shirt: css(c), shirtD: css(mix(c, [40, 20, 60], 0.3)), shirtL: css(shade(c, 0.3)), shirtO: css(mix(c, [24, 14, 34], 0.66)),
    accent: css(shade(c, 0.12)), glow: css(shade(c, 0.6)), soft: css(shade(c, 0.5)), dark: css(mix(c, [20, 16, 34], 0.55)),
  };
  PAL.set(cor, p);
  return p;
}
const dk = (hex, t) => css(mix(parseColor(hex), [24, 16, 32], t));        // tom escuro de uma cor (contornos, sombras)
const lt = (hex, t) => css(mix(parseColor(hex), [255, 244, 224], t));     // tom claro (luzes)

// =====================================================================
// 3. PRIMITIVAS DE PIXEL (nada de antialias nos sprites: só fillRect)
// =====================================================================
function rect(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
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
  g.fillStyle = `rgba(60,48,70,${0.08 * a})`;
  for (let dy = -ry; dy <= ry; dy++) { const h = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry + 0.01))); g.fillRect(cx - h, cy + dy, h * 2 + 1, 1); }
  g.fillStyle = `rgba(60,48,70,${0.12 * a})`;
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
// 4. SPRITES ESTÁTICOS DA MOBÍLIA (vista de frente/de cima)
// =====================================================================
// tela estática de um monitor secundário (área interna x,y,w,h); 'kind' escolhe o conteúdo
function staticScreen(R, x, y, w, h, kind, pal, rnd) {
  if (kind === 0) {                                         // gráfico de barras, tema claro
    R(x, y, w, h, '#eaf2fc'); R(x, y + h - 1, w, 1, '#c3d0e6');
    const cols = [pal.accent, '#6aa6ff', '#ffb35c', '#7ed6a5'];
    for (let bx = x + 1, i = 0; bx < x + w - 1; bx += 3, i++) { const bh = 2 + ((rnd() * (h - 4)) | 0); R(bx, y + h - 1 - bh, 2, bh, cols[i & 3]); }
  } else if (kind === 1) {                                  // código, tema escuro
    R(x, y, w, h, '#1b2133');
    const cc = ['#7ddfb6', '#ffcf6b', '#8ab4ff', '#ff8fa3', pal.glow];
    for (let yy = y + 1; yy < y + h - 1; yy += 2) { const ind = (rnd() * 3) | 0; R(x + 1 + ind, yy, Math.max(1, Math.min(w - 2 - ind, 2 + ((rnd() * (w - 3)) | 0))), 1, cc[(rnd() * cc.length) | 0]); }
  } else if (kind === 2) {                                  // janela de aplicativo, tema claro
    R(x, y, w, h, '#e7edf8'); R(x, y, w, 1, pal.accent);
    R(x + 1, y + 2, 3, h - 3, '#c9d6ee'); R(x + 5, y + 2, w - 6, 2, '#ffffff'); R(x + 5, y + 5, w - 6, Math.max(1, h - 6), '#f7f9fd'); R(x + 5, y + 5, 2, 1, pal.soft);
  } else if (kind === 3) {                                  // painel com linha de gráfico, tema escuro
    R(x, y, w, h, '#17202f');
    let yy = (h / 2) | 0;
    for (let i = 1; i < w - 1; i++) { yy = clamp(yy + ((rnd() * 3) | 0) - 1, 1, h - 2); R(x + i, y + yy, 1, 1, pal.glow); R(x + i, y + h - 2, 1, 1, '#2d3a52'); }
    R(x + 1, y + 1, 3, 1, '#7ddfb6');
  } else {                                                  // céu de pôr do sol
    const sky = ['#2b2370', '#5b2f9a', '#a8369f', '#e8556f', '#ffa05c', '#ffd07a'];
    for (let i = 0; i < h; i++) R(x, y + i, w, 1, sky[Math.min(5, Math.floor(i * 6 / h))]);
    R(x + ((w / 2) | 0) - 1, y + h - 4, 3, 2, '#fff1b8');
  }
}
// monitor de frente: moldura, haste e base. Devolve a área interna [x,y,w,h]
function monitor(R, x, y, w, h) {
  R(x, y, w, h, '#2b3141'); R(x, y, w, 1, '#505a72'); R(x, y, 1, h, '#3d465b'); R(x + w - 1, y, 1, h, '#232837');
  const nx = x + ((w - 4) >> 1), bx = x + ((w - 8) >> 1);
  R(nx, y + h, 4, 2, '#5d667c'); R(nx, y + h, 1, 2, '#78829a'); R(bx, y + h + 2, 8, 1, '#464e62'); R(bx, y + h + 2, 8, 1, '#4c5469'); R(bx + 1, y + h + 3, 6, 1, 'rgba(60,48,70,0.25)');
  R(x + ((w / 2) | 0), y + h - 2, 1, 1, '#53e08a');
  return [x + 1, y + 1, w - 2, h - 3];
}
function miniPlant(R, x, y, h, c1, c2) {                  // vasinho laranja com folhas pontudas (x,y = meio da boca do vaso)
  R(x - 2, y, 5, 1, '#f58a50'); R(x - 2, y + 1, 5, 3, '#e8793e'); R(x + 1, y + 1, 2, 3, '#c85f2a'); R(x - 1, y + 4, 3, 1, '#b04f22');
  R(x - 1, y - 1, 3, 1, '#4a3320');
  for (const [dx, hh, c] of [[-2, h - 2, c1], [2, h - 3, c1], [0, h, c2], [-1, h - 1, c2], [1, h - 2, c2]]) { R(x + dx, y - 1 - hh, 1, hh, c); }
  R(x - 3, y - 4, 1, 2, c1); R(x + 3, y - 5, 1, 2, c1);
}
function backpack(R, x, y, c) {                           // mochila em pé, de frente
  const d = dk(c, 0.28), l = lt(c, 0.3);
  R(x + 1, y, 7, 1, d); R(x, y + 1, 9, 12, c); R(x, y + 1, 9, 2, l); R(x + 7, y + 1, 2, 12, d); R(x, y + 12, 9, 1, d);
  R(x + 1, y + 6, 7, 5, d); R(x + 2, y + 7, 5, 3, c); R(x + 2, y + 7, 5, 1, l); R(x + 4, y + 9, 1, 1, '#f1e9d8');
  R(x + 1, y + 3, 1, 3, '#2b3141'); R(x + 7, y + 3, 1, 3, '#2b3141'); R(x + 3, y - 1, 3, 2, '#2b3141');
  R(x + 1, y + 13, 8, 1, 'rgba(60,48,70,0.28)');
}
function miniFridge(R, x, y) {                            // frigobar branco com porta de vidro azul
  R(x, y, 11, 16, '#f4f6fa'); R(x, y, 11, 1, '#ffffff'); R(x + 9, y, 2, 16, '#d9dfe9'); R(x, y, 1, 16, '#e9edf4');
  R(x + 1, y + 3, 8, 11, '#9fd0f2'); R(x + 1, y + 3, 8, 1, '#c9e8fb'); R(x + 1, y + 3, 1, 11, '#c9e8fb'); R(x + 2, y + 5, 1, 4, '#e6f5ff'); R(x + 5, y + 7, 3, 1, '#78b4e0'); R(x + 3, y + 11, 5, 1, '#78b4e0');
  R(x + 1, y + 1, 4, 1, '#c3cad6'); R(x + 9, y + 5, 1, 4, '#8b94a7');
  R(x + 1, y + 16, 3, 1, '#8b94a7'); R(x + 7, y + 16, 3, 1, '#8b94a7'); R(x, y + 17, 11, 1, 'rgba(60,48,70,0.26)');
}

// Mesa branca de 2 tiles (com 2 px de sobra de cada lado). Âncora = canto de cima à esquerda da linha da
// mesa (y = "base"). A pessoa senta logo atrás do tampo; a tela do monitor da esquerda é animada por cima.
// 'seed' varia o posto (monitores, gabinete, impressora, vasinho, caneca, mochila, frigobar...).
function sprDesk(pal, seed) {
  return sprite(`desk|${pal.cor}|${seed}`, () => makeSprite(-8, -32, 44, 30, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    let h = seed;                                                   // embaralha o hash para postos vizinhos não saírem parecidos
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h = (h ^ (h >>> 16)) >>> 0;
    const rnd = mulberry32(h), pick = (a) => a[(rnd() * a.length) | 0];
    const topR = [0, 4, 0, 1, 2, 3, 5, 0][(rnd() * 8) | 0], front = (rnd() * 6) | 0, under = (rnd() * 8) | 0, kind2 = (rnd() * 5) | 0;
    // tampo branco visto de cima, quina da frente, painel cinza-claro e pés
    R(-2, -3, 36, 12, '#f7f8fb'); R(-2, -3, 36, 1, '#ffffff'); R(-2, -3, 1, 12, '#eef0f5'); R(33, -3, 1, 12, '#e3e7ee');
    R(-2, 8, 36, 1, '#dde2ea');
    R(-1, 9, 34, 5, '#c9d0da'); R(-1, 9, 34, 1, '#b5bdca'); R(-1, 13, 34, 1, '#aab3c1'); R(31, 9, 2, 5, '#b9c1ce');
    R(0, 14, 2, 3, '#8f99a8'); R(30, 14, 2, 3, '#8f99a8');
    R(13, 10, 6, 3, pal.accent); R(13, 10, 6, 1, pal.glow); R(14, 12, 4, 1, 'rgba(255,255,255,0.55)');     // plaquinha na cor da plataforma
    R(22, 0, 3, 1, '#c4cbd8');                                                                             // passa-fios
    // teclado escuro, mousepad e mouse (a mão de quem digita vem por cima)
    R(9, 1, 14, 6, '#3a4259'); R(9, 1, 14, 1, '#59637e'); R(9, 6, 14, 1, '#2a3043');
    for (const y of [2, 4]) for (let i = 0; i < 6; i++) R(10 + i * 2, y, 1, 1, '#76819d');
    R(25, 3, 8, 5, '#8593b3'); R(25, 3, 8, 1, '#a5b1cc'); R(28, 4, 3, 3, '#f1f4f9'); R(28, 4, 3, 1, '#ffffff'); R(29, 5, 1, 1, '#b4bccb');
    // monitor principal à esquerda (a tela é desenhada por drawScreen)
    monitor(R, -2, -12, 12, 10);
    R(-1, -11, 10, 7, '#10131b'); R(-1, -11, 3, 2, '#1a2030');
    // objeto da frente, à esquerda do teclado
    if (front === 0) { R(1, 3, 4, 4, '#ffffff'); R(1, 3, 4, 1, '#dfe4ee'); R(1, 5, 4, 1, pal.accent); R(5, 4, 1, 2, '#dfe4ee'); R(2, 3, 2, 1, '#7a4b2a'); R(1, 7, 5, 1, 'rgba(60,48,70,0.2)'); }
    else if (front === 1) { R(0, 3, 6, 5, '#fff6c2'); R(0, 3, 6, 1, '#f0d86a'); R(1, 5, 4, 1, '#cfbf6e'); R(1, 6, 3, 1, '#cfbf6e'); R(5, 6, 4, 1, '#4a7fe0'); }
    else if (front === 2) miniPlant(R, 3, 3, 6, '#3f9a58', '#62c47c');
    else if (front === 3) { R(0, 2, 7, 6, '#2b3141'); R(0, 2, 7, 1, '#59637e'); staticScreen(R, 1, 3, 5, 4, kind2 === 3 ? 3 : 0, pal, rnd); R(2, 8, 3, 1, '#59637e'); }   // tablet em pé
    else if (front === 4) { R(1, 5, 4, 3, pal.accent); R(1, 5, 4, 1, pal.glow); R(2, 2, 2, 3, pal.soft); R(2, 3, 1, 1, '#2b3141'); R(3, 3, 1, 1, '#2b3141'); R(2, 1, 2, 1, pal.accent); }
    else { R(0, 4, 6, 1, '#3a4156'); R(0, 5, 2, 3, pal.accent); R(4, 5, 2, 3, pal.accent); R(0, 5, 2, 1, pal.glow); R(4, 5, 2, 1, pal.glow); }
    // à direita, em cima da mesa
    if (topR === 0) {                                                                                   // segundo monitor
      const [ix, iy, iw, ih] = monitor(R, 24, -12, 10, 10); staticScreen(R, ix, iy, iw, ih, kind2, pal, rnd);
      R(31, -13, 3, 3, '#ffe66b'); R(31, -13, 3, 1, '#fff3a6'); R(32, -11, 1, 1, '#d4b83c');
    } else if (topR === 1) {                                                                            // gabinete e vasinho
      R(28, -13, 6, 15, '#2b3141'); R(28, -13, 6, 1, '#505a72'); R(28, -13, 1, 15, '#3d465b'); R(33, -13, 1, 15, '#222735');
      for (const y of [-11, -9, -7]) R(30, y, 3, 1, '#161a24'); R(30, -4, 3, 3, '#161a24'); R(31, -3, 1, 1, '#53e08a'); R(29, -1, 4, 1, pal.accent); R(28, 2, 6, 1, 'rgba(60,48,70,0.25)');
      miniPlant(R, 25, -3, 9, '#3f9a58', '#62c47c');
    } else if (topR === 2) {                                                                            // impressora e papéis
      R(23, -9, 9, 3, '#ffffff'); R(23, -9, 9, 1, '#e5e9f1'); R(24, -8, 6, 1, '#b4bccb'); R(24, -6, 7, 1, '#9aa3b6');
      R(22, -5, 12, 7, '#f1f3f8'); R(22, -5, 12, 1, '#ffffff'); R(22, 1, 12, 1, '#cdd3df'); R(22, -5, 1, 7, '#fafbfd'); R(33, -5, 1, 7, '#dde2ec');
      R(24, -1, 8, 1, '#7d879b'); R(24, -2, 8, 1, '#a0a9bb'); R(31, -4, 1, 1, '#53e08a'); R(26, -4, 3, 1, pal.accent); R(22, 2, 12, 1, 'rgba(60,48,70,0.22)');
    } else if (topR === 3) {                                                                            // luminária e caneca
      R(29, 0, 5, 2, '#454c5e'); R(29, 0, 5, 1, '#5d667c'); R(31, -11, 1, 11, '#59617a'); R(29, -14, 8, 3, '#f2c14e'); R(29, -14, 8, 1, '#ffe08a'); R(29, -12, 8, 1, '#c99a2e');
      R(25, -12, 6, 7, 'rgba(255,230,150,0.2)'); R(24, -5, 12, 5, 'rgba(255,230,150,0.12)');
      R(23, -4, 4, 5, '#ffffff'); R(23, -4, 4, 1, '#dfe4ee'); R(23, -2, 4, 1, pal.accent); R(27, -3, 1, 2, '#dfe4ee'); R(24, -4, 2, 1, '#7a4b2a');
    } else if (topR === 4) {                                                                            // monitor vertical e post-its
      const [ix, iy, iw, ih] = monitor(R, 25, -19, 9, 16); staticScreen(R, ix, iy, iw, ih, kind2 === 3 ? 1 : kind2, pal, rnd);
      R(23, -9, 3, 3, '#ffe66b'); R(23, -9, 3, 1, '#fff3a6'); R(23, -5, 3, 3, '#ff9fb2'); R(23, -5, 3, 1, '#ffc7d3');
    } else {                                                                                            // planta grande, de vaso laranja
      miniPlant(R, 28, -2, 13, '#3f9a58', '#6fd08a'); R(24, -14, 1, 3, '#3f9a58'); R(32, -15, 1, 3, '#3f9a58');
      R(23, 0, 4, 2, '#ffffff'); R(23, -1, 3, 1, '#e5e9f1');
    }
    // no chão, junto da mesa
    if (under === 1) backpack(R, 26, 9, pick(['#6fbf73', '#6a8fe0', '#ef8f7a', '#f2c14e']));
    else if (under === 2) miniFridge(R, 22, 9);
    else if (under === 5) { R(-3, 13, 6, 10, '#8f99ab'); R(-3, 13, 6, 1, '#b4bccb'); R(-2, 15, 1, 6, '#a6aebe'); R(2, 13, 1, 10, '#727c8f'); R(-3, 23, 6, 1, 'rgba(60,48,70,0.28)'); }
    else if (under === 4) backpack(R, -4, 9, pick(['#6fbf73', '#6a8fe0', '#ef8f7a', '#f2c14e']));
  }));
}
// Encosto e braços da cadeira escura, atrás de quem senta. Âncora = ponto dos pés/quadril da pessoa sentada.
function sprChairBack(pal) {
  return sprite('chairK|' + pal.cor, () => makeSprite(-16, -34, 16, 8, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    const body = (x, y, w, h, c) => { R(x + 2, y, w - 4, h, c); R(x + 1, y + 1, w - 2, h - 1, c); R(x, y + 2, w, h - 2, c); };   // topo arredondado
    body(-10, -30, 20, 26, '#283042'); body(-9, -29, 18, 24, '#3a4459');
    R(-6, -29, 12, 1, '#586685'); R(-9, -26, 1, 18, '#4a5772'); R(8, -26, 1, 18, '#2c3548');
    R(-6, -12, 12, 3, '#323c50'); R(-6, -12, 12, 1, '#46536c'); R(-6, -9, 12, 1, '#262d3e');
    R(-9, -15, 1, 7, pal.accent); R(8, -15, 1, 7, pal.accent);                       // vivo na cor da plataforma
    for (const x of [-14, 11]) { R(x, -12, 3, 2, '#262d3d'); R(x, -13, 3, 1, '#5b6886'); R(x + 1, -10, 1, 6, '#20263a'); }   // braços
  }));
}
// folha lanceolada saindo de (x0,y0) (relativo à âncora); ang em graus (0 = para cima); sway = deslocamento da ponta.
// Traço grosso que afina na ponta: contorno escuro, miolo claro e um fio de luz do lado esquerdo.
function leaf(g, ax, ay, x0, y0, ang, len, wmax, sway, cols) {
  const a = (ang * Math.PI) / 180, sx = Math.sin(a), cy = Math.cos(a), sg = ang >= 0 ? 1 : -1, pts = [];
  for (let i = 0; i <= len; i++) {
    const t = i / len;
    pts.push([Math.round(x0 + sx * i + sg * t * t * len * 0.22 + sway * t * t * 2), Math.round(y0 - cy * i + t * t * len * 0.16),
      Math.max(1, Math.round(wmax * Math.sin(Math.PI * Math.min(1, 0.22 + t * 0.8))))]);
  }
  for (const [x, y, w] of pts) rect(g, ax + x - (w >> 1), ay + y - (w >> 1), w, w, cols[0]);
  for (const [x, y, w] of pts) if (w >= 2) rect(g, ax + x - (w >> 1), ay + y - (w >> 1), w - 1, w - 1, cols[1]);
  for (const [x, y, w] of pts) if (w >= 3) rect(g, ax + x - (w >> 1), ay + y - (w >> 1), 1, 1, cols[2]);
}
// Planta de vaso laranja. Âncora = meio da base do tile. v = 0 folhas pontudas, 1 folhas largas; s = 0..2 (balanço das folhas)
function sprPlant(v, s) {
  return sprite(`plant|${v}|${s}`, () => makeSprite(-18, -44, 18, 3, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    softShadow(g, ax, ay - 1, 9, 2);
    const G = v ? ['#2a7a4a', '#4fb36d', '#8fe0a0'] : ['#2b7545', '#47a862', '#86d58f'], sw = s - 1;
    const set = v
      ? [[-66, 11, 6], [66, 11, 6], [-44, 16, 7], [44, 16, 7], [-22, 21, 7], [22, 21, 7], [0, 25, 7]]
      : [[-54, 14, 4], [54, 14, 4], [-34, 20, 5], [34, 20, 5], [-14, 25, 5], [14, 25, 5], [0, 28, 5]];
    for (const [ang, len, wm] of set) leaf(g, ax, ay, ang * 0.02, -11, ang, len, wm, sw, G);
    // vaso laranja com boca larga e terra
    R(-6, -12, 12, 1, '#4a3320');
    R(-6, -11, 12, 3, '#f58a50'); R(-6, -11, 12, 1, '#ffb882'); R(-6, -9, 12, 1, '#cd6a32'); R(4, -11, 2, 3, '#e07338');
    R(-5, -8, 10, 5, '#e8793e'); R(-5, -8, 1, 5, '#ff9a62'); R(2, -8, 3, 5, '#c85f2a');
    R(-4, -3, 8, 2, '#e8793e'); R(-4, -3, 1, 2, '#ff9a62'); R(2, -3, 2, 2, '#c85f2a'); R(-4, -1, 8, 1, '#a94d22');
  }));
}
function sprCoffee() {
  return sprite('coffee', () => makeSprite(-11, -36, 11, 3, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    softShadow(g, ax, ay - 1, 9, 2);
    R(-7, -30, 14, 30, '#7b87a3'); R(-7, -32, 14, 3, '#d3dae8'); R(-7, -32, 14, 1, '#eef2f9'); R(5, -29, 2, 29, '#626e8a'); R(-7, -29, 1, 29, '#97a2bb');
    R(-5, -26, 10, 8, '#1b2133'); R(-5, -26, 10, 1, '#363f58'); R(-4, -25, 3, 2, '#4ade80'); R(1, -24, 3, 1, '#ff6b5c'); R(0, -22, 4, 1, '#f5b94a');
    R(-5, -14, 10, 9, '#161b29'); R(-5, -14, 10, 1, '#363f58'); R(-2, -10, 4, 5, '#ffffff'); R(-2, -10, 4, 1, '#8a5a36'); R(2, -9, 1, 3, '#dfe4ee');
    R(-6, -3, 12, 3, '#4a5470'); R(-6, -3, 12, 1, '#6c7894'); R(-1, -17, 2, 3, '#505a74');
  }));
}
// Sofá visto de frente, 2 tiles. Âncora = canto de baixo à esquerda da linha do sofá.
function sprSofa(v) {
  const C = v
    ? { back: '#e58f78', backT: '#f4ad98', arm: '#d6806a', armT: '#f6b9a5', cu: '#f09f88', cuT: '#f9bba9', cuS: '#e58f78', lip: '#b96651', pip: '#fcd0c2', pil: '#7fc4d8', pilT: '#a7dcec' }
    : { back: '#63bfae', backT: '#8bd6c8', arm: '#52ab9a', armT: '#84d3c3', cu: '#78cdbc', cuT: '#9ae0d3', cuS: '#63bfae', lip: '#418a7c', pip: '#bdeee5', pil: '#f2a38c', pilT: '#fbc4b2' };
  return sprite('sofa|' + v, () => makeSprite(-2, -24, 36, 5, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    R(0, 1, 32, 2, 'rgba(60,48,70,0.18)');
    R(1, 0, 3, 2, '#7a6a5a'); R(28, 0, 3, 2, '#7a6a5a');
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
// mesinha redonda do lounge, com caneca e livro
function sprTable() {
  return sprite('table', () => makeSprite(-12, -22, 12, 5, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    softShadow(g, ax, ay, 9, 2);
    R(-1, -9, 2, 8, '#d1ae74'); R(-5, -2, 10, 2, '#bd9a62'); R(-5, -2, 10, 1, '#dcc08c');
    blob(g, ax, ay - 12, 10, 4, '#6a9fdc'); blob(g, ax, ay - 13, 10, 4, '#8ec1f2'); blob(g, ax - 3, ay - 14, 4, 1, '#bfe0fb');
    R(-6, -15, 4, 3, '#ffffff'); R(-6, -15, 4, 1, '#8a5a36'); R(-2, -14, 1, 2, '#dfe4ee');
    R(2, -14, 5, 3, '#ef8f7a'); R(2, -14, 5, 1, '#f9b7a8'); R(3, -12, 3, 1, '#ffffff');
  }));
}
function sprCooler() {
  return sprite('cooler', () => makeSprite(-10, -40, 10, 3, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    softShadow(g, ax, ay - 1, 8, 2);
    R(-6, -20, 12, 20, '#e9eef6'); R(-6, -20, 1, 20, '#ffffff'); R(4, -20, 2, 20, '#c3cddc'); R(-6, -20, 12, 1, '#ffffff');
    R(-5, -38, 10, 18, '#8ecaf2'); R(-5, -38, 2, 18, '#c8e9fb'); R(3, -38, 2, 18, '#67aadc'); R(-4, -36, 1, 6, '#eef8ff');
    R(-3, -40, 6, 2, '#c3cddc'); R(-3, -40, 6, 1, '#e3e9f3');
    R(-4, -16, 8, 5, '#a8b5c9'); R(-3, -15, 2, 2, '#ef6f6f'); R(1, -15, 2, 2, '#6fa8ef'); R(-4, -11, 8, 1, '#7d8aa0');
    R(-5, -9, 10, 2, '#7d8aa0'); R(-5, -9, 10, 1, '#9ba7bb');
  }));
}
// Estante de 2 tiles com livros, quadrinho e vasinho. Âncora = canto de baixo à esquerda.
function sprBookshelf() {
  return sprite('shelf', () => makeSprite(-2, -40, 36, 5, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    const rnd = mulberry32(4242);
    R(0, 1, 32, 2, 'rgba(60,48,70,0.2)');
    R(0, -34, 32, 34, '#d9b983'); R(0, -34, 32, 2, '#f2dcae'); R(0, -34, 1, 34, '#e9cf9c'); R(31, -34, 1, 34, '#b89560');
    R(2, -31, 28, 30, '#9c7a4b');
    const cols = ['#e8837f', '#7fa6e0', '#a9cf7a', '#f2c14e', '#a78bd0', '#f1ecde', '#6fcad8', '#f0a584'];
    for (let sh = 0; sh < 3; sh++) {
      const y0 = -31 + sh * 10, bot = y0 + 9;
      let x = 3;
      while (x < 28) {
        const w = 2 + ((rnd() * 2) | 0), h = 5 + ((rnd() * 4) | 0);
        if (sh === 0 && x > 18 && x < 25) { x += 3; continue; }
        R(x, bot - h, w, h, cols[(rnd() * cols.length) | 0]); R(x, bot - h, w, 1, 'rgba(255,255,255,0.32)'); x += w;
      }
      R(2, bot, 28, 1, '#c8a36c');
    }
    R(20, -29, 6, 5, '#f1ecde'); R(21, -28, 4, 3, '#8fb6e6'); R(21, -27, 4, 1, '#cfe3f6');             // quadrinho
    R(10, -25, 5, 3, '#e8793e'); blob(g, ax + 12, ay - 27, 2, 2, '#4fb36d');                           // vasinho
  }));
}
// mancha de luz do sol que cai de cada janela no chão (desenhada com opacidade que oscila)
function sprLight() {
  return sprite('light', () => makeSprite(0, 0, 70, 44, (g) => {
    for (const [w, a, ins] of [[30, 0.05, 0], [26, 0.055, 2], [20, 0.06, 5], [12, 0.06, 9]]) {
      g.fillStyle = `rgba(255,246,214,${a})`;
      for (let y = 0; y < 44; y++) {
        const fade = 1 - y / 52, x0 = Math.round(y * 0.55 + ins * (1 - y / 90)), ww = Math.max(2, Math.round((w - y * 0.1) * fade + 4));
        g.fillRect(x0, y, ww, 1);
      }
    }
  }));
}

// =====================================================================
// 5. SPRITES DE TEXTO (nomes, balões, nomes das áreas) — em resolução de tela, em cache e limitados
//    Tamanhos em pixels do dispositivo: o texto é desenhado depois do scale, com a fonte sans do sistema.
// =====================================================================
let TXT = new Map(), TXT_OLD = new Map();   // duas gerações: quando a nova enche, a velha é descartada (sem reconstruir tudo num quadro só)
function cached(key, build) {
  let s = TXT.get(key);
  if (!s) { s = TXT_OLD.get(key) || build(); if (TXT.size >= 350) { TXT_OLD = TXT; TXT = new Map(); } TXT.set(key, s); }
  return s;
}
let _mg = null;
function measureCtx() { if (!_mg) _mg = document.createElement('canvas').getContext('2d'); return _mg; }
const fontOf = (fs, weight = 600) => `${weight} ${fs}px ${FONT_STACK}`;
function textW(font, str) { const m = measureCtx(); m.font = font; return m.measureText(str).width; }
// corta o texto com "…" para caber em maxW px
function fitText(str, font, maxW) {
  str = String(str ?? '').replace(/[\r\n\t]+/g, ' ');
  if (textW(font, str) <= maxW) return str;
  const corta = (m) => { const c = str.codePointAt(m - 1) > 0xffff ? m - 1 : m; return str.slice(0, c).trimEnd() + '…'; };   // sem partir um emoji ao meio
  let lo = 1, hi = str.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (textW(font, corta(m)) <= maxW) lo = m; else hi = m - 1; }
  return corta(lo);
}
// caminho de retângulo arredondado
function rrPath(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// sprite de texto: { c, m, pw, ph } = canvas, margem (sombra), largura e altura úteis
const mkText = (w, h, m) => { const [c, g] = makeCanvas(w + 2 * m, h + 2 * m); g.imageSmoothingEnabled = true; return [c, g, { c, m, pw: w, ph: h }]; };

// Pílula escura com a bolinha do estado e o nome do agente, com um rabinho apontando para a cabeça.
// hl: 0 normal, 1 hover/seleção (borda na cor da plataforma), 2 parente do selecionado.
function namePill(nome, estado, accent, hl, fs, maxW) {
  const dot = ST_COLOR[estado] || ST_COLOR.ocioso;
  return cached(`N|${hl}|${dot}|${accent}|${fs}|${maxW}|${nome}`, () => {
    const font = fontOf(fs), h = Math.round(fs * 1.75), padL = Math.round(fs * 0.5), dd = Math.round(fs * 0.58), gap = Math.round(fs * 0.38), padR = Math.round(fs * 0.7);
    const txt = fitText(nome, font, Math.max(fs * 2, maxW - padL - dd - gap - padR)), tw = Math.ceil(textW(font, txt));
    const w = padL + dd + gap + tw + padR, tail = Math.max(3, Math.round(fs * 0.4)), m = Math.round(fs * 0.45);
    const [, g, out] = mkText(w, h + tail, m), cx = m + w / 2, lw = Math.max(1, Math.round(fs * 0.12));
    const bg = hl === 1 ? '#12151f' : '#1f2330';
    g.shadowColor = 'rgba(20,24,40,0.38)'; g.shadowBlur = Math.round(fs * 0.5); g.shadowOffsetY = Math.round(fs * 0.18);
    g.fillStyle = bg;
    rrPath(g, m, m, w, h, h / 2); g.fill();
    g.beginPath(); g.moveTo(cx - tail * 1.2, m + h - 1); g.lineTo(cx, m + h + tail); g.lineTo(cx + tail * 1.2, m + h - 1); g.closePath(); g.fill();
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.lineWidth = hl ? lw * 1.6 : lw; g.strokeStyle = hl === 1 ? accent : hl === 2 ? '#7c9cff' : 'rgba(255,255,255,0.13)';
    rrPath(g, m + g.lineWidth / 2, m + g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth, h / 2); g.stroke();
    g.shadowColor = dot; g.shadowBlur = Math.round(fs * 0.5);
    g.fillStyle = dot; g.beginPath(); g.arc(m + padL + dd / 2, m + h / 2, dd / 2, 0, Math.PI * 2); g.fill();
    g.shadowColor = 'transparent'; g.shadowBlur = 0;
    g.fillStyle = hl === 1 ? '#ffffff' : '#eef1f8'; g.font = font; g.textBaseline = 'alphabetic';
    g.fillText(txt, m + padL + dd + gap, m + h / 2 + fs * 0.36);
    return out;
  });
}
// Nome da área: pílula clara e translúcida, texto cinza e a bolinha da cor da plataforma
function areaPill(nome, cor, fs) {
  return cached(`A|${cor}|${fs}|${nome}`, () => {
    const f2 = Math.round(fs * 1.25), font = fontOf(f2), h = Math.round(f2 * 1.85), dd = Math.round(f2 * 0.55), padL = Math.round(f2 * 0.7), gap = Math.round(f2 * 0.5), padR = Math.round(f2 * 0.95);
    const tw = Math.ceil(textW(font, nome)), w = padL + dd + gap + tw + padR, m = Math.round(f2 * 0.3);
    const [, g, out] = mkText(w, h, m);
    g.shadowColor = 'rgba(70,80,100,0.22)'; g.shadowBlur = Math.round(f2 * 0.5); g.shadowOffsetY = Math.round(f2 * 0.15);
    g.fillStyle = 'rgba(255,255,255,0.78)'; rrPath(g, m, m, w, h, h / 2); g.fill();
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.lineWidth = Math.max(1, Math.round(f2 * 0.07)); g.strokeStyle = 'rgba(120,130,150,0.3)'; rrPath(g, m + 0.5, m + 0.5, w - 1, h - 1, h / 2); g.stroke();
    g.fillStyle = cor; g.beginPath(); g.arc(m + padL + dd / 2, m + h / 2, dd / 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(m + padL + dd * 0.36, m + h / 2 - dd * 0.16, dd * 0.16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6a7388'; g.font = font; g.textBaseline = 'alphabetic';
    g.fillText(nome, m + padL + dd + gap, m + h / 2 + f2 * 0.35);
    return out;
  });
}
// Balão branco e arredondado, com rabinho (say: triângulo, think: bolinhas). draw(g, x, y) desenha o conteúdo, de tamanho iw x ih
function makeBubble(iw, ih, fs, tailKind, draw) {
  const padX = Math.round(fs * 0.78), padY = Math.round(fs * 0.48), w = Math.ceil(iw) + 2 * padX, h = Math.ceil(ih) + 2 * padY;
  const tail = Math.round(fs * 0.62), m = Math.round(fs * 0.45), lw = Math.max(1, Math.round(fs * 0.13));
  const [, g, out] = mkText(w, h + tail, m), cx = m + w / 2, ink = '#2d3350';
  const r = Math.min(h / 2, fs * 0.95);
  g.shadowColor = 'rgba(20,24,40,0.3)'; g.shadowBlur = Math.round(fs * 0.5); g.shadowOffsetY = Math.round(fs * 0.18);
  g.fillStyle = '#ffffff'; rrPath(g, m, m, w, h, r); g.fill();
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.lineWidth = lw; g.strokeStyle = ink; g.lineJoin = 'round';
  rrPath(g, m + lw / 2, m + lw / 2, w - lw, h - lw, r); g.stroke();
  if (tailKind === 'say') {
    const tw = fs * 0.46;
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(cx - tw, m + h - lw); g.lineTo(cx, m + h + tail); g.lineTo(cx + tw, m + h - lw); g.closePath(); g.fill();
    g.lineCap = 'butt'; g.lineJoin = 'miter';
    g.beginPath(); g.moveTo(cx - tw, m + h - lw / 2); g.lineTo(cx, m + h + tail - lw * 0.4); g.lineTo(cx + tw, m + h - lw / 2); g.stroke();
    g.fillStyle = '#ffffff'; g.fillRect(cx - tw + lw * 0.8, m + h - lw * 1.2, 2 * tw - lw * 1.6, lw * 1.6);
  } else {                                                         // balão de pensamento: duas bolinhas
    for (const [dx, dy, rr] of [[-fs * 0.1, fs * 0.28, fs * 0.2], [-fs * 0.42, fs * 0.62, fs * 0.12]]) {
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx + dx, m + h + dy, rr, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
  draw(g, m + padX, m + padY);
  return out;
}
// ferramenta em negrito e o detalhe em cinza: "Read: src/api/campanhas.ts"
function bubbleSay(head, detail, fs, maxW) {
  return cached(`B|${fs}|${maxW}|${head}|${detail}`, () => {
    const bold = fontOf(fs, 700), reg = fontOf(fs, 500);
    const full = detail ? `${head}: ${detail}` : head;
    const fit = fitText(full, bold, maxW), hh = fit.slice(0, head.length), rest = fit.slice(head.length);
    const w1 = Math.ceil(textW(bold, hh)), w2 = rest ? Math.ceil(textW(reg, rest)) : 0;
    return makeBubble(w1 + w2, fs * 1.25, fs, 'say', (g, x, y) => {
      g.textBaseline = 'alphabetic';
      g.font = bold; g.fillStyle = '#262b3d'; g.fillText(hh, x, y + fs * 1.0);
      if (rest) { g.font = reg; g.fillStyle = '#5a6178'; g.fillText(rest, x + w1, y + fs * 1.0); }
    });
  });
}
function bubbleThink(n, fs) { // n = 1..3 pontinhos acesos
  return cached(`T|${n}|${fs}`, () => makeBubble(fs * 2.3, fs * 0.5, fs, 'think', (g, x, y) => {
    for (let i = 0; i < 3; i++) { g.fillStyle = i < n ? '#5b4a99' : '#d8d0ee'; g.beginPath(); g.arc(x + fs * 0.25 + i * fs * 0.9, y + fs * 0.25, fs * 0.25, 0, Math.PI * 2); g.fill(); }
  }));
}
function bubbleWait(stage, fs) { // ampulheta animada (stage 0..4): a areia desce aos poucos
  return cached(`W|${stage}|${fs}`, () => makeBubble(fs * 1.5, fs * 1.3, fs, 'say', (g, x, y) => {
    const w = fs * 0.95, h = fs * 1.3, lw = Math.max(1, Math.round(fs * 0.13)), mx = x + fs * 0.75;
    const l = mx - w * 0.35, r = mx + w * 0.35, t = y + h * 0.08, b = y + h * 0.92, m = y + h * 0.5, half = (r - l) / 2;
    const top = [1, 0.6, 0.25, 0, 0][stage], bot = [0, 0.25, 0.55, 0.8, 1][stage];
    g.fillStyle = '#e0a21b';
    if (top > 0) { const hh = (m - t) * 0.85 * top, hw = half * hh / (m - t); g.beginPath(); g.moveTo(mx - hw, m - hh); g.lineTo(mx + hw, m - hh); g.lineTo(mx, m); g.closePath(); g.fill(); }
    if (bot > 0) { const hh = (b - m) * 0.8 * bot, hw = half * hh / (b - m) * 1.1; g.beginPath(); g.moveTo(mx, b - hh); g.lineTo(mx + hw, b); g.lineTo(mx - hw, b); g.closePath(); g.fill(); }
    if (stage >= 1 && stage <= 3) g.fillRect(mx - lw / 2, m, lw, b - m - (b - m) * 0.8 * bot);        // fio de areia caindo
    g.lineWidth = lw; g.strokeStyle = '#2d3350'; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(l, t); g.lineTo(r, t); g.lineTo(mx + lw * 0.3, m); g.lineTo(r, b); g.lineTo(l, b); g.lineTo(mx - lw * 0.3, m); g.closePath(); g.stroke();
  }));
}
// "z" lilás com contorno branco, para quem cochila no lounge
function zzSprite(fs) {
  return cached(`Z|${fs}`, () => {
    const f2 = Math.round(fs * 1.15), font = `italic 800 ${f2}px ${FONT_STACK}`, w = Math.ceil(textW(font, 'Z')) + 4, h = Math.round(f2 * 1.2);
    const [c, g] = makeCanvas(w + 4, h + 4); g.imageSmoothingEnabled = true;
    g.font = font; g.textBaseline = 'alphabetic'; g.lineJoin = 'round'; g.lineWidth = Math.max(2, Math.round(f2 * 0.22));
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.strokeText('Z', 4, h - 2); g.fillStyle = '#8a76d6'; g.fillText('Z', 4, h - 2);
    return c;
  });
}

// =====================================================================
// 6. A PESSOA (pixel art chibi ~14x28, vista reta: frente, costas e de lado)
//    Cada pose vira um sprite em cache com contorno seletivo (tom escuro do próprio preenchimento).
// =====================================================================
const SKINS = ['#f6d3b0', '#e8b98e', '#cf966a', '#9a6444', '#fbe2c8', '#74503a'];
const HAIRS = ['#2b1d14', '#4a2c17', '#7a4a22', '#c9a14a', '#1c1c24', '#a24a32', '#dcd4c4', '#4a3566', '#e58fb0', '#4fb3a8'];
const PANTS = ['#3c4a6b', '#4a4f60', '#6b5a48', '#33415c', '#5a4f7a', '#3f6050', '#4a6fa5', '#7b6a8a'];
const CAPS = ['#e0584a', '#3f83d0', '#3fa874', '#e8b53a', '#8a6bd6', '#efe8d8'];
const SHOES = ['#2c2433', '#f4f0e8', '#4a5a9a', '#d96a4a', '#2c2433'];
const INK = '#1b1d27';

// cores e traços de uma pessoa, tudo sorteado pelo hash do id (mesmo id, mesma pessoa)
function personColors(r) {
  const skin = SKINS[(r() * SKINS.length) | 0], hair = HAIRS[(r() * HAIRS.length) | 0], pants = PANTS[(r() * PANTS.length) | 0];
  const sk = parseColor(skin), cap = CAPS[(r() * CAPS.length) | 0], shoe = SHOES[(r() * SHOES.length) | 0];
  return {
    skin, skinS: css(mix(sk, [120, 52, 52], 0.24)), skinH: css(mix(sk, [255, 244, 226], 0.34)), skinO: css(mix(sk, [52, 24, 36], 0.62)),
    blush: css(mix(sk, [240, 110, 110], 0.5)),
    hair, hairS: dk(hair, 0.4), hairH: lt(hair, 0.34), hairO: dk(hair, 0.7),
    pants, pantsS: dk(pants, 0.3), pantsO: dk(pants, 0.66),
    shoe, shoeO: dk(shoe, 0.7), iris: '#2a2540',
    cap, capD: dk(cap, 0.35), capL: lt(cap, 0.3), capO: dk(cap, 0.7),
    style: (r() * 6) | 0, outfit: (r() * 4) | 0, glasses: r() < 0.22, beard: r() < 0.18, badge: r() < 0.35, stripe: r() < 0.25,
  };
}

// lista de partes com contorno: P guarda, flush() desenha primeiro os contornos (1 px maiores) e depois os preenchimentos
const MAXP = 80;
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
// devolve um canvas 32x42 com os pés em (16,37); cabeça grande (chibi), cabelo com volume e franja
function buildPerson(a, o) {
  const [cv, g] = makeCanvas(32, 42);
  _g = g; _ox = 16; _oy = 37; _m = o.dir === 3; _n = 0;
  const cl = a.cl, pal = a.pal, pose = o.pose, f = o.frame, walk = pose === 'walk';
  const side = o.dir === 1 || o.dir === 3, back = o.dir === 2;
  const sit = pose === 'sitD' || pose === 'sitS';
  const by = walk ? (f & 1 ? -1 : 0) : (pose === 'stand' ? o.bob : 0);
  const hy = -23 + by, st = cl.style, of = cl.outfit;
  if (pose !== 'sitD') softShadow(g, 16, 36, 8, 2);

  // ---- pernas e sapatos ----
  if (pose === 'sitS') {
    P(-4, -7, 8, 3, cl.pants, cl.pantsO); P(-5, -4, 3, 3, cl.pants, cl.pantsO); P(2, -4, 3, 3, cl.pants, cl.pantsO);
    P(-6, -2, 4, 2, cl.shoe, cl.shoeO); P(2, -2, 4, 2, cl.shoe, cl.shoeO);
  } else if (!sit) {
    if (side) {
      const l1 = walk ? [2, 0, -2, 0][f] : 0, l2 = -l1;
      P(-2 + l2, -7, 3, 5, cl.pants, cl.pantsO); P(-2 + l2, -2, 5, 2, cl.shoe, cl.shoeO);
      P(-1 + l1, -7, 3, 5, cl.pants, cl.pantsO); P(-1 + l1, -2, 5, 2, cl.shoe, cl.shoeO);
    } else {
      const liftL = walk && f === 2 ? 1 : 0, liftR = walk && f === 0 ? 1 : 0;
      P(-4, -7, 3, 5 - liftL, cl.pants, cl.pantsO); P(-5, -2 - liftL, 4, 2, cl.shoe, cl.shoeO);
      P(1, -7, 3, 5 - liftR, cl.pants, cl.pantsO); P(1, -2 - liftR, 4, 2, cl.shoe, cl.shoeO);
    }
  }
  // ---- tronco e braços ----
  if (side) {
    P(-3, -14 + by, 6, 8, pal.shirt, pal.shirtO);
    const sw = walk ? [-2, 0, 2, 0][f] : 0;
    P(-1 + sw, -13 + by, 3, 5, pal.shirtL, pal.shirtO); P(-1 + sw, -8 + by, 3, 2, cl.skin, cl.skinO);
    if (o.cup) P(2 + sw, -11 + by, 3, 3, '#f4efe6', '#6b5a48');
  } else {
    P(-4, -14 + by, 8, 8, pal.shirt, pal.shirtO);
    if (pose === 'sitD') { P(-6, -13, 2, 6, pal.shirt, pal.shirtO); P(4, -13, 2, 6, pal.shirt, pal.shirtO); }
    else {
      const aL = walk ? [1, 0, -1, 0][f] : 0, aR = walk ? [-1, 0, 1, 0][f] : 0;
      P(-6, -13 + by + aL, 2, 5, pal.shirt, pal.shirtO); P(-6, -8 + by + aL, 2, 2, cl.skin, cl.skinO);
      P(4, -13 + by + aR, 2, 5, pal.shirt, pal.shirtO); P(4, -8 + by + aR, 2, 2, cl.skin, cl.skinO);
      if (o.cup) P(5, -11 + by, 3, 3, '#f4efe6', '#6b5a48');
    }
  }
  // ---- cabeça: rosto e cabelo (partes) ----
  if (!back) {
    if (side) { P(-4, hy, 8, 10, cl.skin, cl.skinO); P(-5, hy + 1, 10, 8, cl.skin, cl.skinO); P(5, hy + 6, 1, 2, cl.skin, cl.skinO); }   // nariz à frente
    else { P(-4, hy, 8, 10, cl.skin, cl.skinO); P(-5, hy + 1, 10, 8, cl.skin, cl.skinO); }
  }
  if (side) {
    if (st === 0) { P(-6, hy - 4, 11, 5, cl.hair, cl.hairO); P(-6, hy + 1, 4, 6, cl.hair, cl.hairO); P(1, hy, 4, 2, cl.hair, cl.hairO); P(-4, hy - 5, 8, 1, cl.hair, cl.hairO); }
    else if (st === 1) { P(-7, hy - 1, 5, 15, cl.hair, cl.hairO); P(-6, hy - 4, 11, 5, cl.hair, cl.hairO); P(0, hy, 5, 2, cl.hair, cl.hairO); P(-4, hy - 5, 8, 1, cl.hair, cl.hairO); }
    else if (st === 2) { P(-5, hy - 3, 9, 4, cl.hairS, cl.hairO); P(-5, hy + 1, 3, 3, cl.hairS, cl.hairO); }
    else if (st === 3) { P(-6, hy - 4, 11, 5, cl.hair, cl.hairO); P(-6, hy + 1, 4, 5, cl.hair, cl.hairO); P(1, hy, 4, 2, cl.hair, cl.hairO); P(-6, hy - 7, 4, 3, cl.hair, cl.hairO); }
    else if (st === 4) { P(-7, hy - 5, 13, 9, cl.hair, cl.hairO); P(-8, hy + 2, 3, 6, cl.hair, cl.hairO); P(-5, hy - 6, 8, 1, cl.hair, cl.hairO); P(2, hy - 1, 4, 2, cl.hair, cl.hairO); }
    else { P(-6, hy - 4, 11, 4, cl.cap, cl.capO); P(4, hy, 4, 1, cl.capD, cl.capO); P(-6, hy + 1, 3, 5, cl.hair, cl.hairO); P(-4, hy - 5, 7, 1, cl.cap, cl.capO); }
  } else if (!back) {
    if (st === 0) { P(-6, hy - 4, 12, 5, cl.hair, cl.hairO); P(-4, hy - 5, 8, 1, cl.hair, cl.hairO); P(-6, hy + 1, 2, 4, cl.hair, cl.hairO); P(4, hy + 1, 2, 4, cl.hair, cl.hairO); P(-5, hy, 6, 2, cl.hair, cl.hairO); P(1, hy, 4, 1, cl.hair, cl.hairO); P(-5, hy + 2, 2, 1, cl.hair, cl.hairO); }
    else if (st === 1) { P(-6, hy - 4, 12, 5, cl.hair, cl.hairO); P(-4, hy - 5, 8, 1, cl.hair, cl.hairO); P(-7, hy, 3, 14, cl.hair, cl.hairO); P(4, hy, 3, 14, cl.hair, cl.hairO); P(-5, hy, 10, 2, cl.hair, cl.hairO); }
    else if (st === 2) { P(-5, hy - 3, 10, 4, cl.hairS, cl.hairO); P(-5, hy + 1, 1, 3, cl.hairS, cl.hairO); P(4, hy + 1, 1, 3, cl.hairS, cl.hairO); }
    else if (st === 3) { P(-6, hy - 4, 12, 5, cl.hair, cl.hairO); P(-2, hy - 7, 4, 3, cl.hair, cl.hairO); P(-6, hy + 1, 2, 4, cl.hair, cl.hairO); P(4, hy + 1, 2, 4, cl.hair, cl.hairO); P(-5, hy, 10, 2, cl.hair, cl.hairO); }
    else if (st === 4) { P(-7, hy - 5, 14, 9, cl.hair, cl.hairO); P(-5, hy - 6, 10, 1, cl.hair, cl.hairO); P(-7, hy + 4, 2, 4, cl.hair, cl.hairO); P(5, hy + 4, 2, 4, cl.hair, cl.hairO); P(-4, hy + 4, 3, 1, cl.hair, cl.hairO); P(1, hy + 4, 3, 1, cl.hair, cl.hairO); }
    else { P(-6, hy - 4, 12, 4, cl.cap, cl.capO); P(-1, hy - 5, 2, 1, cl.capD, cl.capO); P(-6, hy, 12, 1, cl.capD, cl.capO); P(-6, hy + 1, 1, 4, cl.hair, cl.hairO); P(5, hy + 1, 1, 4, cl.hair, cl.hairO); }
    if (st !== 1 && st !== 4) { P(-6, hy + 5, 1, 3, cl.skin, cl.skinO); P(5, hy + 5, 1, 3, cl.skin, cl.skinO); }      // orelhas
  } else {
    if (st === 0) { P(-6, hy - 4, 12, 13, cl.hair, cl.hairO); P(-4, hy - 5, 8, 1, cl.hair, cl.hairO); }
    else if (st === 1) { P(-7, hy - 4, 14, 18, cl.hair, cl.hairO); P(-5, hy - 5, 10, 1, cl.hair, cl.hairO); }
    else if (st === 2) P(-5, hy - 3, 10, 11, cl.hairS, cl.hairO);
    else if (st === 3) { P(-6, hy - 4, 12, 13, cl.hair, cl.hairO); P(-2, hy - 7, 4, 3, cl.hair, cl.hairO); }
    else if (st === 4) { P(-7, hy - 5, 14, 14, cl.hair, cl.hairO); P(-5, hy - 6, 10, 1, cl.hair, cl.hairO); }
    else { P(-6, hy - 4, 12, 5, cl.cap, cl.capO); P(-1, hy - 5, 2, 1, cl.capD, cl.capO); P(-5, hy + 1, 10, 8, cl.hair, cl.hairO); }
    P(-3, hy + 9, 6, 1, cl.skin, cl.skinO);                                                              // nuca
  }
  flush();

  // ---- sombreado do tronco, das pernas e dos braços; a roupa ----
  if (!sit) {
    if (side) D(-3, -8 + by, 6, 1, pal.shirtD);
    else { D(-3, -7, 1, 4, cl.pantsS); D(2, -7, 1, 4, cl.pantsS); }
  }
  if (side) {
    D(-3, -14 + by, 1, 8, pal.shirtD); D(-3, -7 + by, 6, 1, pal.shirtD); D(2, -14 + by, 1, 1, pal.shirtL);
    if (!back) D(-1 + (walk ? [-2, 0, 2, 0][f] : 0), -9 + by, 3, 1, pal.shirtD);
    if (of === 1) { D(-3, -13 + by, 3, 1, pal.shirtD); D(1, -9 + by, 2, 1, pal.shirtL); }
    else if (of === 3) { D(1, -13 + by, 1, 5, pal.shirtD); D(2, -12 + by, 1, 3, '#f4efe6'); }
  } else {
    D(3, -14 + by, 1, 8, pal.shirtD); D(-4, -7 + by, 8, 1, pal.shirtD); D(-4, -14 + by, 2, 1, pal.shirtL); D(-3, -13 + by, 1, 2, pal.shirtL);
    if (!back) {
      if (of === 0) { D(-2, -13 + by, 4, 1, pal.shirtL); D(-2, -13 + by, 1, 1, pal.shirtD); if (cl.stripe) D(-4, -10 + by, 8, 1, pal.shirtL); }
      else if (of === 1) { D(-3, -13 + by, 6, 1, pal.shirtD); D(-4, -13 + by, 1, 2, pal.shirtD); D(3, -13 + by, 1, 2, pal.shirtD); D(-1, -12 + by, 1, 3, '#f4efe6'); D(1, -12 + by, 1, 3, '#f4efe6'); D(-3, -9 + by, 6, 2, pal.shirtD); D(-3, -9 + by, 6, 1, pal.shirtL); }
      else if (of === 2) { D(-3, -13 + by, 2, 2, '#ffffff'); D(1, -13 + by, 2, 2, '#ffffff'); D(-1, -13 + by, 2, 1, cl.skin); D(0, -11 + by, 1, 4, pal.shirtL); D(0, -10 + by, 1, 1, '#ffffff'); D(0, -8 + by, 1, 1, '#ffffff'); }
      else { D(-4, -13 + by, 2, 6, pal.shirtD); D(2, -13 + by, 2, 6, pal.shirtD); D(-2, -13 + by, 4, 6, '#f4efe6'); D(-2, -13 + by, 4, 1, '#d6cfc0'); D(-1, -8 + by, 2, 1, pal.shirtL); }
      if (cl.badge && of !== 3) { D(0, -13 + by, 1, 4, '#2c3342'); D(-1, -9 + by, 3, 2, '#ffffff'); D(-1, -9 + by, 3, 1, pal.accent); }
    }
    if (pose !== 'sitD') { const aL = walk ? [1, 0, -1, 0][f] : 0, aR = walk ? [-1, 0, 1, 0][f] : 0; D(-6, -13 + by + aL, 1, 5, pal.shirtD); D(5, -13 + by + aR, 1, 5, pal.shirtD); D(-6, -9 + by + aL, 2, 1, pal.shirtD); D(4, -9 + by + aR, 2, 1, pal.shirtD); }
    else { D(-6, -13, 1, 6, pal.shirtD); D(5, -13, 1, 6, pal.shirtD); }
  }
  // ---- rosto: sombras, sobrancelhas, olhos grandes com brilho, boca, bochechas ----
  if (side) {
    D(4, hy + 1, 1, 8, cl.skinS); D(-3, hy + 9, 7, 1, cl.skinS); D(-2, hy + 5, 2, 3, cl.skinS);
    D(1, hy + 3, 3, 1, cl.hairS);
    if (cl.glasses) { const fr = '#454b63'; D(1, hy + 3, 4, 1, fr); D(1, hy + 6, 4, 1, fr); D(1, hy + 3, 1, 4, fr); D(4, hy + 3, 1, 4, fr); D(2, hy + 4, 2, 2, 'rgba(214,236,255,0.65)'); D(-2, hy + 4, 3, 1, fr); if (!o.blink) D(3, hy + 4, 1, 2, cl.iris); }
    else if (o.blink) D(2, hy + 5, 2, 1, cl.iris); else { D(2, hy + 4, 2, 3, cl.iris); D(2, hy + 4, 1, 1, '#ffffff'); }
    D(3, hy + 8, 2, 1, '#b25a58'); D(1, hy + 7, 2, 1, cl.blush);
    if (cl.beard) { D(-1, hy + 7, 6, 3, cl.hairS); D(3, hy + 8, 2, 1, '#6a3a3a'); }
    if (st === 5) { D(-4, hy - 4, 5, 1, cl.capL); }
    else if (st !== 2) { D(-3, hy - 3, 4, 1, cl.hairH); D(-5, hy + 1, 1, 3, cl.hairS); }
  } else if (!back) {
    D(4, hy + 1, 1, 8, cl.skinS); D(-4, hy + 9, 8, 1, cl.skinS); D(-4, hy + 6, 1, 1, cl.skinH);
    D(-4, hy + 3, 2, 1, cl.hairS); D(2, hy + 3, 2, 1, cl.hairS);
    if (cl.glasses) {
      const fr = '#454b63';
      for (const x of [-5, 1]) { D(x, hy + 3, 4, 1, fr); D(x, hy + 6, 4, 1, fr); D(x, hy + 3, 1, 4, fr); D(x + 3, hy + 3, 1, 4, fr); D(x + 1, hy + 4, 2, 2, 'rgba(214,236,255,0.6)'); }
      D(-1, hy + 4, 2, 1, fr);
      if (!o.blink) { D(-4, hy + 4, 2, 2, cl.iris); D(2, hy + 4, 2, 2, cl.iris); D(-4, hy + 4, 1, 1, '#ffffff'); D(2, hy + 4, 1, 1, '#ffffff'); } else { D(-4, hy + 5, 2, 1, cl.iris); D(2, hy + 5, 2, 1, cl.iris); }
    } else if (o.blink) { D(-4, hy + 5, 2, 1, cl.iris); D(2, hy + 5, 2, 1, cl.iris); D(-4, hy + 4, 2, 1, cl.skinS); D(2, hy + 4, 2, 1, cl.skinS); }
    else { D(-4, hy + 4, 2, 3, cl.iris); D(2, hy + 4, 2, 3, cl.iris); D(-4, hy + 4, 1, 1, '#ffffff'); D(2, hy + 4, 1, 1, '#ffffff'); }
    if (!cl.glasses) { D(-5, hy + 7, 2, 1, cl.blush); D(3, hy + 7, 2, 1, cl.blush); }
    D(-1, hy + 8, 2, 1, '#b25a58');
    if (cl.beard) { D(-4, hy + 7, 8, 3, cl.hairS); D(-1, hy + 8, 2, 1, '#6a3a3a'); D(-4, hy + 7, 1, 1, cl.hair); D(3, hy + 7, 1, 1, cl.hair); }
    if (st === 5) { D(-5, hy - 4, 5, 1, cl.capL); D(-6, hy - 1, 12, 1, cl.capL); }
    else if (st === 4) { D(-4, hy - 5, 3, 1, cl.hairH); D(1, hy - 4, 3, 1, cl.hairH); D(-6, hy - 3, 1, 2, cl.hairH); }
    else if (st !== 2) { D(-4, hy - 3, 4, 1, cl.hairH); D(-5, hy - 2, 1, 1, cl.hairH); D(2, hy + 1, 2, 1, cl.hairS); }
  } else {
    if (st === 5) { D(-5, hy - 4, 5, 1, cl.capL); D(-5, hy, 10, 1, cl.capD); D(-2, hy + 6, 4, 1, cl.hairS); }
    else if (st === 2) { D(-3, hy - 2, 4, 1, cl.hairH); }
    else { D(-4, hy - 3, 4, 1, cl.hairH); D(-4, hy + 4, 8, 1, cl.hairS); D(1, hy + 1, 1, 3, cl.hairS); D(-2, hy - 1, 2, 1, cl.hairH); D(-3, hy + 5, 1, 3, cl.hairS); D(2, hy + 6, 1, 2, cl.hairS); if (st === 1) { D(-5, hy + 7, 1, 7, cl.hairS); D(4, hy + 7, 1, 7, cl.hairS); D(-1, hy + 9, 1, 5, cl.hairS); } }
    D(-2, hy + 9, 4, 1, cl.skinS);
  }
  if (a.headset) {                                                                  // chamados usam fone
    const hs = '#2b2f3a';
    if (side) { D(-5, hy - 3, 10, 1, hs); D(-2, hy + 3, 3, 4, pal.accent); D(-2, hy + 3, 3, 1, pal.shirtL); D(2, hy + 9, 3, 1, hs); }
    else { D(-6, hy - 3, 12, 1, hs); D(-7, hy + 3, 2, 4, pal.accent); D(5, hy + 3, 2, 4, pal.accent); D(-7, hy + 3, 2, 1, pal.shirtL); if (!back) { D(3, hy + 9, 3, 1, hs); D(5, hy + 7, 1, 3, hs); } }
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

// tela do monitor da esquerda: mode 0 apagado, 1 trabalhando, 2 pensando, 3 esperando, 4 ocioso. Área interna 10x7 em (ax-1, ay-11)
function drawScreen(g, ax, ay, mode, now, pal, seed) {
  const X = ax - 1, Y = ay - 11, W = 10, H = 7;
  if (mode === 0) { rect(g, X, Y, W, H, '#10131b'); rect(g, X, Y, 3, 2, '#1a2030'); rect(g, X + 6, Y + 5, 3, 1, '#161b26'); return; }
  const bg = mode === 1 ? '#10303a' : mode === 2 ? '#211a40' : mode === 3 ? '#3a2e12' : '#16203a';
  rect(g, X, Y, W, H, bg);
  if (mode === 1) {
    const step = (now / 170) | 0;
    rect(g, X, Y, W, 1, pal.accent); rect(g, X + W - 2, Y, 1, 1, '#ffffff');
    for (let i = 0; i < 3; i++) {
      const w = 2 + (hashStr(String(seed + step * 7 + i * 13)) % 6);
      rect(g, X + 1 + (i === 1 ? 1 : 0), Y + 2 + i * 2, w, 1, i === 1 ? pal.glow : '#7ddfb6');
    }
    rect(g, X, Y + 1, W, 1, 'rgba(160,255,230,0.12)');
  } else if (mode === 2) {
    const ph = ((now / 260) | 0) % 3;
    for (let i = 0; i < 3; i++) rect(g, X + 2 + i * 3, Y + 2, 2, 3, i === ph ? '#d7c9ff' : '#5b4a99');
  } else if (mode === 3) {
    rect(g, X, Y, W, 1, '#5a4718');
    if (((now / 500) | 0) & 1) rect(g, X + 4, Y + 2, 2, 3, '#ffcf5a');
  } else {
    const p = ((now / 900) | 0) % 6;
    rect(g, X + p + 1, Y + 2 + (p & 1) * 2, 2, 1, '#3d5a8c');
  }
}

// =====================================================================
// 7. ATOR (um agente na cena) — reaproveitado por id, nunca recriado à toa
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
  }
}

// =====================================================================
// 8. O ESCRITÓRIO
// =====================================================================
export class Office {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.dpr = 1; this.W = 0; this.H = 0;
    this.k = 2; this.tx = 0; this.ty = 0;
    this.kMin = 1; this.kMax = 8;
    this.userMoved = false; this.camTarget = null;
    this.bg = '#10131a';
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
    this.fs = 11; this.nameW = 90; this.bubW = 160; this.lowZoom = false;   // texto: tamanho da fonte e larguras máximas, em px do dispositivo
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
  setBackground(c) { this.bg = c || this.bg; }
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

    // zonas: mesas (a pessoa senta atrás; cada posto tem a sua variação), cadeiras, plantas e o nome da área
    for (const z of zl) {
      const tiles = [];
      for (let s = 0; s < z.rows * COLS; s++) {
        const c = s % COLS, r = (s / COLS) | 0;
        const gx0 = z.x0 + 1 + 3 * c, cy = z.y0 + TOPM + 3 * r, base = (cy + 1) * T;
        tiles.push({ cx: gx0, cy, px: gx0 + 1, py: (base + SEAT_DY) / T, base });
        blk(gx0, cy); blk(gx0 + 1, cy); blk(gx0, cy + 1); blk(gx0 + 1, cy + 1);
        add(T_DESK, sprDesk(z.pal, hashStr(z.id + ':' + s)), gx0 * T, base, base + 16, { pid: z.id, idx: s, pal: z.pal, cx: gx0 * T + 16, base });
        add(T_CBACK, sprChairBack(z.pal), (gx0 + 1) * T, base + SEAT_DY, base + 4, { pid: z.id, idx: s });
      }
      w.seatTiles.set(z.id, tiles);
      for (const px of [z.x0, z.x0 + z.W - 1]) { add(T_PLANT, null, px * T + 8, (z.y0 + 2) * T, (z.y0 + 2) * T, { v: px === z.x0 ? 0 : 1, ph: px * 0.37 + z.y0 }); blk(px, z.y0 + 1); }
      // nome da área: pílula clara logo acima do carpete (y = centro); os nomes dos agentes desviam dela
      // (11 px acima da borda: o nome e o balão de quem senta na 1ª fileira cabem embaixo dela sem serem empurrados)
      w.signs.push({ x: (z.x0 + 5) * T, y: z.y0 * T - 11, nome: z.nome, cor: z.cor });
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
    // as divisórias do lounge ficam na borda dos tiles; os tiles encostados nelas ficam fechados para ninguém atravessar a madeira
    for (const [bx, by] of [[lx, 1], [lx, 2], [lx + 8, 2], [lx + 9, 2]]) blk(bx, by);
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

  // pinta o piso, os carpetes, o lounge, as paredes, as janelas e as sombras numa imagem só (refeita só quando o layout muda)
  paintBase() {
    const w = this.world, { X, Y, zones, lx } = w, b = w.bounds;
    const cvs = this.base;
    cvs.width = b.maxX - b.minX; cvs.height = b.maxY - b.minY;
    const g = cvs.getContext('2d'); g.imageSmoothingEnabled = false;
    const ax = -b.minX, ay = -b.minY;
    w.baseAx = ax; w.baseAy = ay;
    const R = (x, y, wd, h, c) => rect(g, ax + x, ay + y, wd, h, c);      // coordenadas do mundo
    const XW = X * T, YH = Y * T;
    const pool = (cx, cy, rx, ry) => { for (let i = 0; i < 4; i++) blob(g, ax + cx, ay + cy, rx - i * 10, Math.max(2, ry - i * 3), 'rgba(255,244,214,0.04)'); };

    // sombra da laje sobre o fundo da página
    R(-SIDE + 1, YH + SLAB, XW + 2 * SIDE - 2, 2, 'rgba(10,8,20,0.26)'); R(-SIDE + 3, YH + SLAB + 2, XW + 2 * SIDE - 6, 2, 'rgba(10,8,20,0.13)');
    R(-SIDE - 2, -WALL_H + 4, 2, WALL_H + YH + SLAB - 2, 'rgba(10,8,20,0.12)'); R(XW + SIDE, -WALL_H + 4, 2, WALL_H + YH + SLAB - 2, 'rgba(10,8,20,0.12)');

    // piso de tijolinho creme: tijolos de 12x6 px em fiadas deslocadas pela metade, quina clara, rejunte sutil e tons levemente diferentes
    const BW = 12, BH = 6;
    for (let row = 0, y = 0; y < YH; row++, y += BH) {
      const off = row & 1 ? BW / 2 : 0, h = Math.min(BH, YH - y);
      for (let x = -off; x < XW; x += BW) {
        const bx = Math.max(x, 0), bw = Math.min(x + BW, XW) - bx;
        const rr = mulberry32(((row + 1) * 73856093) ^ ((((x + off) / BW | 0) + 5) * 19349663));
        R(bx, y, bw, h, BRICKS[(rr() * BRICKS.length) | 0]);
        R(bx, y, bw, 1, BRICK_HI);
        if (h === BH) R(bx, y + BH - 1, bw, 1, MORTAR);
        if (x + BW - 1 < XW && x + BW - 1 >= 0) R(x + BW - 1, y, 1, h, MORTAR);
        if (rr() < 0.07) R(bx + 3, y + 2, 4, 1, 'rgba(190,160,110,0.15)');
      }
    }
    // poças de luz das lâmpadas no saguão
    pool(lx * T + 72, 36, 64, 18); pool(40, 30, 44, 14); pool(XW / 2, 40, 70, 16);

    // carpetes xadrez neutros (o mesmo em todas as zonas): quadrados de 8 px em dois tons, pontinhos de trama e filete na borda
    for (const z of zones) {
      const x0 = z.x0 * T, y0 = z.y0 * T, zw = z.W * T, zh = z.D * T;
      R(x0 + 1, y0 + 2, zw + 2, zh + 3, 'rgba(90,76,60,0.14)'); R(x0 + 2, y0 + 4, zw + 2, zh + 3, 'rgba(90,76,60,0.07)');
      for (let yy = 0; yy < zh; yy += 8) for (let xx = 0; xx < zw; xx += 8) R(x0 + xx, y0 + yy, 8, 8, ((xx + yy) >> 3) & 1 ? CARPET[0] : CARPET[1]);
      const rr = mulberry32(hashStr(z.id) + 7);
      for (let n = 0; n < zw * zh / 48; n++) R(x0 + 1 + ((rr() * (zw - 3)) | 0), y0 + 1 + ((rr() * (zh - 3)) | 0), 1, 1, rr() < 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(60,76,70,0.08)');
      R(x0, y0, zw, 1, CARPET_RIM); R(x0, y0 + zh - 1, zw, 1, CARPET_RIM); R(x0, y0, 1, zh, CARPET_RIM); R(x0 + zw - 1, y0, 1, zh, CARPET_RIM);
      R(x0 + 1, y0 + 1, zw - 2, 1, CARPET_HI); R(x0 + 1, y0 + 1, 1, zh - 2, 'rgba(255,255,255,0.14)');
      R(x0 + 1, y0 + zh - 2, zw - 2, 1, 'rgba(60,76,70,0.14)');
    }
    // lounge: piso de ziguezague azul-lilás, com divisórias baixas de madeira clara em volta
    {
      const rx = lx * T, rw = XW - rx, rh = 3 * T;
      R(rx - 1, 2, rw + 1, rh + 2, 'rgba(70,60,100,0.16)');
      for (let y = 0; y < rh; y++) {
        let start = 0, cur = null;
        for (let x = 0; x <= rw; x++) {
          let c = null;
          if (x < rw) { const t = x % 12, tri = t < 6 ? t : 12 - t, band = ((y + tri) / 6) | 0; c = band & 1 ? ((y + tri) % 6 === 0 ? LILAC[2] : LILAC[0]) : LILAC[1]; }
          if (c !== cur) { if (cur) R(rx + start, y, x - start, 1, cur); start = x; cur = c; }
        }
      }
      const rr = mulberry32(31337);
      for (let n = 0; n < rw * rh / 70; n++) R(rx + ((rr() * rw) | 0), (rr() * rh) | 0, 1, 1, 'rgba(255,255,255,0.12)');
      R(rx, 0, rw, 1, 'rgba(50,40,90,0.2)');
      // divisórias: painel à esquerda e dois trechos na frente, com ripas verticais
      const wood = (x, y, wd, h, vert) => {
        R(x, y, wd, h, WOOD[1]); R(x, y, wd, 1, WOOD[0]); R(x, y + h - 1, wd, 1, WOOD[3]);
        if (vert) { R(x + wd - 1, y, 1, h, WOOD[3]); R(x, y, 1, h, WOOD[0]); } else for (let i = 3; i < wd - 1; i += 4) R(x + i, y + 1, 1, h - 2, WOOD[2]);
        R(x, y + h, wd, 1, 'rgba(70,56,70,0.2)');
      };
      wood(rx - 5, 6, 4, rh - 8, true); R(rx - 5, 4, 4, 3, WOOD[0]); R(rx - 5, 4, 4, 1, '#fff3d6');
      wood(rx - 1, rh - 4, T + 3, 4, false); wood(rx + 8 * T, rh - 4, rw - 8 * T, 4, false);   // a frente fica aberta no meio (entrada)
      for (const px of [rx - 1, rx + T, rx + 8 * T]) { R(px, rh - 7, 3, 7, WOOD[2]); R(px, rh - 7, 3, 1, WOOD[0]); R(px + 2, rh - 7, 1, 7, WOOD[3]); }
    }
    // capacho do elevador
    R(19, 1, 42, 23, 'rgba(60,50,70,0.14)'); R(20, 0, 40, 22, '#8e97ad'); R(22, 2, 36, 18, '#a2abbf'); R(22, 2, 36, 1, '#c1c8d8');
    for (let xx = 24; xx < 58; xx += 4) R(xx, 4, 2, 14, '#939cb2');
    R(20, 22, 40, 1, '#7a839a');

    // sombras de contato das mesas
    for (const it of w.statics) {
      if (it.t === T_DESK) { R(it.x - 2, it.base + 16, 38, 2, 'rgba(70,56,70,0.2)'); R(it.x - 1, it.base + 18, 36, 2, 'rgba(70,56,70,0.1)'); R(it.x + 34, it.base + 1, 2, 16, 'rgba(70,56,70,0.09)'); }
    }
    // escurecimento (oclusão ambiente) junto das paredes
    for (let i = 0; i < 4; i++) {
      const a = [0.13, 0.08, 0.045, 0.02][i];
      R(0, i * 2, XW, 2, `rgba(60,52,92,${a})`); R(i * 2, 0, 2, YH, `rgba(60,52,92,${a * 0.8})`); R(XW - 2 - i * 2, 0, 2, YH, `rgba(60,52,92,${a * 0.8})`);
    }

    // laje (frente) e paredes laterais finas
    R(-SIDE, YH, XW + 2 * SIDE, SLAB, '#cfc5b3'); R(-SIDE, YH, XW + 2 * SIDE, 1, '#ebe4d6'); R(-SIDE, YH + 1, XW + 2 * SIDE, 1, '#ddd4c3'); R(-SIDE, YH + SLAB - 2, XW + 2 * SIDE, 2, '#aca290');
    R(-SIDE, -WALL_H, SIDE, WALL_H + YH + SLAB, WALL_SIDE); R(XW, -WALL_H, SIDE, WALL_H + YH + SLAB, WALL_SIDE);
    R(-SIDE, -WALL_H, 1, WALL_H + YH + SLAB, '#c9d2ee'); R(XW + SIDE - 1, -WALL_H, 1, WALL_H + YH + SLAB, '#8794bd');
    R(-1, 0, 1, YH, 'rgba(60,70,120,0.18)'); R(XW, 0, 1, YH, 'rgba(60,70,120,0.18)');
    R(-SIDE, -WALL_H, SIDE, 4, WALL_CAP); R(XW, -WALL_H, SIDE, 4, WALL_CAP);

    // parede dos fundos: papel de parede com ripado fino, lambri com painéis, cornija e rodapé
    R(-SIDE, -WALL_H, XW + 2 * SIDE, WALL_H, WALL_BACK);
    for (let x = 0; x < XW; x += 8) { R(x, -WALL_H + 6, 1, WALL_H - 26, 'rgba(255,255,255,0.12)'); R(x + 4, -WALL_H + 6, 1, WALL_H - 26, 'rgba(90,100,170,0.05)'); }
    R(0, -18, XW, 18, WALL_LOW); R(0, -19, XW, 1, '#f0f3fc'); R(0, -18, XW, 1, '#a3b0d6');
    for (let x = 4; x + 20 <= XW - 4; x += 24) { R(x, -15, 20, 9, 'rgba(90,104,170,0.12)'); R(x, -15, 20, 1, 'rgba(90,104,170,0.12)'); R(x, -15, 1, 9, 'rgba(90,104,170,0.1)'); R(x + 1, -14, 18, 1, 'rgba(255,255,255,0.22)'); R(x + 19, -15, 1, 9, 'rgba(255,255,255,0.2)'); R(x, -7, 20, 1, 'rgba(255,255,255,0.2)'); }
    R(0, -5, XW, 1, '#b9c3e3'); R(0, -4, XW, 4, WALL_BASE); R(0, -4, XW, 1, '#a9b4d8'); R(0, -1, XW, 1, '#7e8bb5');
    R(-SIDE, -WALL_H, XW + 2 * SIDE, 5, WALL_CAP); R(-SIDE, -WALL_H, XW + 2 * SIDE, 1, '#ffffff'); R(-SIDE, -WALL_H + 5, XW + 2 * SIDE, 1, '#b3bfe0'); R(0, -WALL_H + 6, XW, 2, 'rgba(70,84,150,0.1)'); R(0, -WALL_H + 8, XW, 2, 'rgba(70,84,150,0.045)');

    // janelas com cortinas, nuvens, prédios ao longe e peitoril
    const SKY = ['#b9dcf6', '#a8cff3', '#97c3ee', '#86b7e6', '#76aadd'];
    const wins = [];
    for (let x = 6 * T; x + 26 <= XW - 12; x += 5 * T) wins.push(x);
    for (const x of wins) {
      R(x - 2, -16, 30, 2, '#e1e7f2'); R(x - 2, -16, 30, 1, '#ffffff'); R(x - 1, -14, 28, 1, 'rgba(60,70,130,0.14)');
      R(x, -42, 26, 28, '#f6f8fc'); R(x, -42, 26, 1, '#ffffff'); R(x + 25, -42, 1, 28, '#d0d8e8');
      for (let i = 0; i < 5; i++) R(x + 2, -40 + i * 5, 22, 5, SKY[i]);
      R(x + 4, -37, 6, 2, 'rgba(255,255,255,0.9)'); R(x + 6, -39, 5, 2, 'rgba(255,255,255,0.9)'); R(x + 15, -33, 5, 2, 'rgba(255,255,255,0.85)'); R(x + 16, -35, 3, 2, 'rgba(255,255,255,0.85)');
      for (const [bx, bw, bh] of [[2, 4, 8], [7, 5, 11], [13, 4, 7], [18, 6, 10]]) R(x + bx, -16 - bh, bw, bh, '#8fa9d6');
      for (const [bx, bw, bh] of [[3, 5, 6], [10, 6, 9], [17, 5, 5]]) { R(x + bx, -16 - bh, bw, bh, '#5f78b0'); R(x + bx + 1, -16 - bh + 2, 1, 1, '#ffe9a8'); R(x + bx + 3, -16 - bh + 4, 1, 1, '#ffe9a8'); }
      R(x + 19, -39, 2, 2, '#fff8d6');
      R(x + 12, -42, 2, 28, '#f6f8fc'); R(x, -29, 26, 2, '#f6f8fc');
      R(x - 4, -46, 34, 1, '#bfa07a'); R(x - 5, -47, 2, 3, '#d4b58c'); R(x + 28, -47, 2, 3, '#d4b58c');                     // varão
      for (const cx of [x - 3, x + 24]) { R(cx, -45, 5, 31, '#f4ebdc'); R(cx + 1, -45, 1, 31, '#dccfb8'); R(cx + 3, -45, 1, 31, '#fbf5ea'); R(cx, -14, 5, 1, '#dccfb8'); }
    }
    w.lights = wins;
    // quadros entre as janelas
    for (let i = 0; i + 1 < wins.length; i += 1) {
      if (i % 2) continue;
      const cx = wins[i] + 26 + 26, fy = -40, kind = (i / 2) % 3;
      R(cx - 9, fy + 1, 18, 22, 'rgba(60,70,130,0.16)'); R(cx - 9, fy, 18, 22, '#c9a878'); R(cx - 9, fy, 18, 1, '#e6cba0'); R(cx - 8, fy + 1, 16, 20, '#fbf7ec');
      if (kind === 0) { R(cx - 6, fy + 3, 12, 16, '#b4d6f2'); R(cx - 6, fy + 12, 12, 7, '#6fb27c'); R(cx - 6, fy + 15, 12, 4, '#4f9a62'); R(cx + 2, fy + 5, 3, 3, '#ffe9a8'); }
      else if (kind === 1) { R(cx - 6, fy + 3, 12, 16, '#4a5380'); R(cx - 4, fy + 5, 5, 5, '#f2c14e'); R(cx, fy + 9, 5, 7, '#e8837f'); R(cx - 5, fy + 13, 4, 4, '#6fcad8'); }
      else { R(cx - 6, fy + 3, 12, 16, '#f1ede0'); R(cx - 5, fy + 5, 10, 2, '#4a5380'); R(cx - 5, fy + 9, 10, 1, '#b4b9cc'); R(cx - 5, fy + 11, 8, 1, '#b4b9cc'); R(cx - 5, fy + 13, 9, 1, '#b4b9cc'); R(cx - 5, fy + 16, 4, 2, '#e8837f'); }
    }
    // relógio
    {
      const cxk = 5 * T + 6;
      R(cxk - 7, -37, 15, 15, 'rgba(60,70,130,0.16)'); R(cxk - 7, -38, 15, 15, '#c9a878'); R(cxk - 6, -37, 13, 13, '#fdfdff'); R(cxk - 5, -36, 11, 11, '#f3f5fa');
      for (const [dx, dy] of [[0, -5], [5, 0], [0, 5], [-5, 0]]) R(cxk + dx, -31 + dy, 1, 1, '#4a5380');
      R(cxk, -35, 1, 4, INK); R(cxk, -31, 3, 1, INK); R(cxk, -31, 1, 1, '#e8837f');
    }
    // moldura do elevador, com bisel e painel do indicador de andar
    R(17, -47, 46, 47, 'rgba(60,70,110,0.2)'); R(18, -46, 44, 46, '#98a3ba'); R(20, -46, 40, 46, '#c2cadb');
    R(20, -46, 40, 1, '#eef1f7'); R(20, -46, 1, 46, '#dde2ee'); R(59, -46, 1, 46, '#8f9ab2'); R(18, -46, 2, 46, '#8f9ab2'); R(60, -46, 2, 46, '#7e8aa4');
    R(20, -46, 40, 7, '#7a859f'); R(21, -45, 38, 1, '#9aa5be'); R(22, -3, 36, 3, '#a8b2c6'); R(22, -3, 36, 1, '#ccd3e1');
    R(29, -45, 22, 5, '#1b2030'); R(29, -45, 22, 1, '#383f52');
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

    // véu de luz quente bem leve sobre o mapa (suaviza os contrastes)
    g.fillStyle = 'rgba(255,240,214,0.025)'; g.fillRect(-SIDE, -WALL_H, w.X * T + 2 * SIDE, WALL_H + w.Y * T + SLAB);

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
    if (s) brackets(g, s.cx * T - 4, s.base - 30, s.cx * T + 36, s.base + 18, c);
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
          g.globalAlpha = 0.16; rect(g, it.x - 1, it.base - 1, 12, 7, it.pal.glow);
          g.globalAlpha = 0.1; rect(g, it.x + 1, it.base + 5, 12, 3, it.pal.glow);
          g.globalAlpha = 1;
        } else if (mode === 2 || mode === 3) { g.globalAlpha = 0.1; rect(g, it.x - 1, it.base - 1, 12, 7, mode === 2 ? '#b7a4ff' : '#ffd36b'); g.globalAlpha = 1; }
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
    if (a.alpha < 1) g.globalAlpha = a.alpha;
    g.drawImage(s, a.fx - 16, a.fy - 37);
    if (sitting && a.d.estado === 'trabalhando') {         // luz da tela no rosto, vinda da esquerda
      g.globalAlpha = a.alpha * (0.12 + 0.05 * Math.sin(now / 300 + a.phase)); rect(g, a.fx - 5, a.fy - 19, 2, 5, a.pal.glow);
    }
    g.globalAlpha = 1;
    // área de clique (pixels do dispositivo)
    const k = this.k;
    a.hit.x0 = (a.fx - 9) * k + this.tx; a.hit.x1 = (a.fx + 9) * k + this.tx;
    a.hit.y0 = (a.fy - HEAD_H - 4) * k + this.ty; a.hit.y1 = (a.fy + (sitting ? -1 : 2)) * k + this.ty;
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

  // nomes das áreas, nomes dos agentes e balões, em espaço de tela (sprites de texto em resolução do dispositivo)
  drawOverlay(now) {
    const g = this.g, k = this.k, tx = this.tx, ty = this.ty, fs = this.fs, gap = Math.max(1, Math.round(this.dpr));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    const placas = [];
    for (const s of this.world.signs) {
      const sp = areaPill(s.nome, platPal(s.cor).accent, fs), w = sp.pw, h = sp.ph;
      const x = Math.round(s.x * k + tx - w / 2), y = Math.round(s.y * k + ty - h / 2);
      g.drawImage(sp.c, x - sp.m, y - sp.m);
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
    const postas = [...placas], folga = gap;
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
    // 3) desenha; selecionado e hover por último, por cima (com o nome inteiro)
    const ordem = caixas.filter((c) => c.a !== sel && c.a !== hov);
    for (const c of caixas) if (c.a === hov && hov !== sel) ordem.push(c);
    for (const c of caixas) if (c.a === sel) ordem.push(c);
    for (const c of ordem) this.drawOverlayBox(c, now);
  }
  measureOverlay(a, now, hl) {
    if (a.alpha < 0.05) return null;
    const k = this.k, fs = this.fs, d = a.d, gap = Math.max(1, Math.round(this.dpr));
    const hx = Math.round(a.fx * k + this.tx), hy = Math.round((a.fy - HEAD_H) * k + this.ty);
    const mx = 300 * this.dpr;
    if (hx < -mx || hx > this.W + mx || hy < -200 * this.dpr || hy > this.H + 100 * this.dpr) return null;
    const rel = !hl && this.selectedId && (d.paiId === this.selectedId || (this.actors.get(this.selectedId) || {}).d?.paiId === a.id);
    const wide = Math.round(Math.min(this.W * 0.7, 300 * this.dpr));         // quem está em foco mostra o nome (quase) inteiro
    const nome = String(d.nome || d.id || '').slice(0, 80);
    const ls = namePill(nome, d.estado, a.pal.accent, hl ? 1 : rel ? 2 : 0, fs, hl ? wide : this.nameW), bf = Math.max(8, Math.round(fs * 0.93));
    const lw = ls.pw, lh = ls.ph, ly = hy - lh - gap;
    let bs = null;
    if (a.arrived && a.kind === 'desk' && (hl || !this.lowZoom)) {   // com a vista toda numa tela pequena, balões só de quem foi tocado (a bolinha do nome já diz o estado)
      if (d.estado === 'trabalhando') {
        const detalhe = hl || k / this.dpr >= 1.5;   // de longe, só o nome da ferramenta
        bs = bubbleSay(d.ferramenta || d.detalhe || '...', d.ferramenta && d.detalhe && detalhe ? d.detalhe : '', bf, hl ? wide : detalhe ? this.bubW : this.nameW);
      } else if (d.estado === 'pensando') bs = bubbleThink((((now + a.phase) / 380) | 0) % 3 + 1, bf);
      else if (d.estado === 'esperando') bs = bubbleWait((((now + a.phase) / 450) | 0) % 5, bf);
    }
    const bw = bs ? bs.pw : 0, bh = bs ? bs.ph : 0;
    const zz = !bs && a.arrived && a.kind === 'lounge' && now - a.arrivedAt > ZZ_DELAY;
    const lr = { x0: hx - (lw >> 1), x1: hx - (lw >> 1) + lw, y0: ly, y1: ly + lh };
    let br = null;
    if (bs) br = { x0: hx - (bw >> 1), x1: hx - (bw >> 1) + bw, y0: ly - bh - gap, y1: ly - gap };
    else if (zz) br = { x0: hx + Math.round(fs * 0.5), x1: hx + Math.round(fs * 2.2), y0: ly - Math.round(fs * 2.4), y1: ly - gap };
    return { a, hl, hx, hy, ls, lw, lh, ly, bs, bw, bh, zz, dy: 0, dx: 0, lr, br, rs: [lr, br] };
  }
  drawOverlayBox(c, now) {
    const g = this.g, a = c.a;
    const ly = c.ly + c.dy, lx = c.hx + c.dx;
    g.globalAlpha = a.alpha;
    // empurrado para cima ou para o lado: um fio liga o nome à cabeça
    const gap = Math.max(1, Math.round(this.dpr));
    if (c.dy < -gap || Math.abs(c.dx) > gap) {
      const fio = Math.max(1, Math.round(this.dpr));
      g.globalAlpha = a.alpha * 0.5; g.fillStyle = a.pal.accent;
      const yb = ly + c.lh;
      if (yb < c.hy) g.fillRect(c.hx, yb, fio, c.hy - yb);
      if (Math.abs(c.dx) > gap) g.fillRect(Math.min(c.hx, lx), yb - fio, Math.abs(c.dx), fio);
      g.globalAlpha = a.alpha;
    }
    g.drawImage(c.ls.c, lx - (c.lw >> 1) - c.ls.m, ly - c.ls.m);
    this.actorBubble(c, a, ly, now);
    g.globalAlpha = 1;
  }
  actorBubble(c, a, ly, now) {
    const g = this.g, fs = this.fs, gap = Math.max(1, Math.round(this.dpr));
    const bs = c.bs, hx = c.hx + c.dx;
    if (bs) {
      g.drawImage(bs.c, hx - (c.bw >> 1) - bs.m, ly - c.bh - gap - bs.m);
    } else if (c.zz) {
      const gs = zzSprite(fs);
      for (let i = 0; i < 3; i++) {
        const ph = ((now + a.phase + i * 700) / 2100) % 1;
        g.globalAlpha = a.alpha * (1 - ph * ph);
        g.drawImage(gs, Math.round(hx + (0.5 + i * 0.55) * fs), Math.round(ly - gs.height - (0.3 + ph * 1.5) * fs));
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
    const kc = this.k / this.dpr;              // px de CSS por pixel lógico
    this.lowZoom = kc < 1.5;                   // vista toda numa tela pequena: o texto fica grande perto da sala, então só os nomes aparecem
    // texto em px do dispositivo: a fonte cresce devagar com o zoom; o nome cabe no espaço entre duas mesas
    this.fs = Math.round(clamp(8 + kc * 1.5, 9.5, 14.5) * this.dpr);
    this.nameW = Math.round(3 * T * this.k * (kc < 1.5 ? 1.4 : 1.2));          // um pouco mais largo quando a vista está toda na tela
    this.bubW = Math.round(3 * T * this.k * 0.98);   // no máximo a distância entre duas mesas: vizinhos não se empurram (o texto inteiro aparece no hover)
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
