/* render.js — a cena do escritório em VISTA RETA (de frente e de cima, 3/4), canvas 2D, tudo procedural.
 *
 * Ideias principais:
 *  - O mundo é medido em "pixels lógicos" (16 por tile) e a arte tem o dobro da resolução (32 px por tile, como no
 *    Gather; ver pixel.js). O zoom (this.k, px do dispositivo por px lógico) é inteiro: nos zooms pares cada pixel da
 *    arte vira um quadrado exato; nos ímpares a cena é desenhada no par de cima e reduzida com suavização.
 *  - O piso é de tijolinho creme. A parede dos fundos aparece de frente (faixa no alto, com janelas, quadros e a
 *    porta do elevador); as laterais e a da frente aparecem de cima, como topos claros com contorno.
 *  - Cada plataforma presente ganha uma "zona": tapete cinza trançado com as bancadas dela (3 postos colados por
 *    fileira). A cor da plataforma aparece em detalhes (bolinha do nome da área, tela e gabinete, faixa da cadeira,
 *    plaquinha da mesa). Cada agente tem um posto fixo e senta na cadeira, na FRENTE da mesa, de costas para quem
 *    olha; ociosos vão ao lounge; quem sai volta ao elevador. Tudo anda por caminhos (BFS) na grade de tiles
 *    (a bancada fecha a fileira inteira, então o caminho dá a volta pela lateral da zona).
 *  - Profundidade: ordena pelo y dos pés (o que está mais embaixo na tela desenha na frente).
 *  - Arte: contorno escuro em tudo (tom escuro da cor vizinha, automático nos sprites), paleta pastel, sombras suaves
 *    e luz de janela. Pessoas (pessoa.js) e móveis (moveis.js) são sprites em cache; só telas, vapor, plantas e luz
 *    são animados por quadro.
 *  - Textos (nomes, balões e nomes das áreas) usam a fonte sans do sistema, desenhada em resolução de tela (depois
 *    do scale) e guardada em sprites em cache, então ficam nítidos em qualquer zoom; os nomes desviam uns dos outros
 *    e dos nomes das áreas.
 *  - Animações de situação (fliperama, chicote, bronca do chefe, susto, comemoração...) ficam em gags.js, que esta
 *    cena chama em poucos ganchos (think, update, drawActor, overlay).
 */
import { Diretor } from './gags.js';
import { T, HD, U, clamp, hashStr, mulberry32, platPal, rect, ringEllipse, brackets, blob, rawCanvas, put, putS } from './pixel.js';
import { CORPO, personColors, buildPerson } from './pessoa.js';
import { drawScreen, sprDesk, sprChairSeat, sprChairBack, sprPlant, sprCoffee, sprSofa, sprTable, sprCooler, sprBookshelf, sprLight } from './moveis.js';

// =====================================================================
// 1. CONSTANTES (medidas em px lógicos: 16 por tile; a arte tem o dobro da resolução, ver pixel.js)
// =====================================================================
const WALL_H = 48;              // altura da parede dos fundos (faixa vista de frente)
const SIDE = 5;                 // espessura das paredes laterais (vistas de cima)
const SLAB = 6;                 // parede da frente (vista de cima)
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
const SEAT_DY = 20;             // quem senta fica na cadeira, na frente da mesa: pés 20 px abaixo da âncora da mesa
const HEAD_H = 20;              // altura da pessoa em pé (do pé ao topo do cabelo), px lógicos
const T_SPR = 0, T_DESK = 1, T_CSEAT = 2, T_CBACK = 3, T_ACTOR = 4, T_COFFEE = 5, T_PLANT = 6, T_ARCADE = 7;
const ARCADE_TX = [4, 5];        // tiles do saguão (fileira 0) com os fliperamas, entre o elevador e as janelas

// piso de tijolinho creme, tapete cinza trançado, lounge lilás, paredes e madeira clara
const BRICKS = ['#f3e7d2', '#f1e4cd', '#f4e9d6', '#efe1c8'], MORTAR = '#faf3e6';
const RUG = ['#b9c1c8', '#abb4bc'], RUG_FIO = '#c7ced4', RUG_RIM = '#99a3ac', RUG_HI = '#d3d9de';
const WALL_BACK = '#9aa5d8', WALL_LOW = '#8791c8', WALL_BASE = '#e9ecf6', WALL_CAP = '#e3e6f2', LINHA = '#4f598c';
const WOOD = ['#f8e6bd', '#ecd3a2', '#dcbd84', '#c39f68', '#8a6a42'];     // madeira clara: luz, base, veio, frente, contorno
const LILAC = ['#8f97de', '#838bd3', '#aab0ec'];                            // piso do lounge: escuro, médio, claro
const INK = '#1b1d27';
// cores de estado (as mesmas da página, tema escuro)
const ST_COLOR = { trabalhando: '#4ade80', pensando: '#a78bfa', esperando: '#fbbf24', ocioso: '#8b95a8', saindo: '#f87171', bravo: '#ef4444' };
const FONT_STACK = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
const byKey = (a, b) => a.key - b.key;

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
const mkText = (w, h, m) => { const [c, g] = rawCanvas(w + 2 * m, h + 2 * m); g.imageSmoothingEnabled = true; return [c, g, { c, m, pw: w, ph: h }]; };

// Pílula escura com a bolinha do estado e o nome do agente, com um rabinho apontando para a cabeça.
// hl: 0 normal, 1 hover/seleção (borda na cor da plataforma), 2 parente do selecionado.
function namePill(nome, estado, accent, hl, fs, maxW) {
  const dot = ST_COLOR[estado] || ST_COLOR.ocioso;
  return cached(`N|${hl}|${dot}|${accent}|${fs}|${maxW}|${nome}`, () => {
    const font = fontOf(fs), h = Math.round(fs * 1.75), padL = Math.round(fs * 0.5), dd = Math.round(fs * 0.58), gap = Math.round(fs * 0.38), padR = Math.round(fs * 0.7);
    const txt = fitText(nome, font, Math.max(fs * 2, maxW - padL - dd - gap - padR)), tw = Math.ceil(textW(font, txt));
    const w = padL + dd + gap + tw + padR, tail = Math.max(3, Math.round(fs * 0.4)), m = Math.round(fs * 0.45);
    const [, g, out] = mkText(w, h + tail, m), cx = m + w / 2, lw = Math.max(1, Math.round(fs * 0.12));
    const bg = hl === 1 ? '#141722' : 'rgba(32,36,52,0.94)', rr = Math.round(h * 0.34);
    g.shadowColor = 'rgba(20,24,40,0.38)'; g.shadowBlur = Math.round(fs * 0.5); g.shadowOffsetY = Math.round(fs * 0.18);
    g.fillStyle = bg;
    rrPath(g, m, m, w, h, rr); g.fill();
    g.beginPath(); g.moveTo(cx - tail * 1.2, m + h - 1); g.lineTo(cx, m + h + tail); g.lineTo(cx + tail * 1.2, m + h - 1); g.closePath(); g.fill();
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.lineWidth = hl ? lw * 1.6 : lw; g.strokeStyle = hl === 1 ? accent : hl === 2 ? '#7c9cff' : 'rgba(255,255,255,0.13)';
    rrPath(g, m + g.lineWidth / 2, m + g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth, rr); g.stroke();
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
function makeBubble(iw, ih, fs, tailKind, draw, bravo = false) {
  const padX = Math.round(fs * 0.78), padY = Math.round(fs * 0.48), w = Math.ceil(iw) + 2 * padX, h = Math.ceil(ih) + 2 * padY;
  const tail = Math.round(fs * 0.62), m = Math.round(fs * 0.45), lw = Math.max(1, Math.round(fs * (bravo ? 0.2 : 0.13)));
  const [, g, out] = mkText(w, h + tail, m), cx = m + w / 2, ink = bravo ? '#c0392b' : '#2d3350', bg = bravo ? '#fff3f0' : '#ffffff';
  const r = Math.min(h / 2, fs * 0.95);
  g.shadowColor = 'rgba(20,24,40,0.3)'; g.shadowBlur = Math.round(fs * 0.5); g.shadowOffsetY = Math.round(fs * 0.18);
  g.fillStyle = bg; rrPath(g, m, m, w, h, r); g.fill();
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.lineWidth = lw; g.strokeStyle = ink; g.lineJoin = 'round';
  rrPath(g, m + lw / 2, m + lw / 2, w - lw, h - lw, r); g.stroke();
  if (tailKind === 'say') {
    const tw = fs * 0.46;
    g.fillStyle = bg; g.beginPath(); g.moveTo(cx - tw, m + h - lw); g.lineTo(cx, m + h + tail); g.lineTo(cx + tw, m + h - lw); g.closePath(); g.fill();
    g.lineCap = 'butt'; g.lineJoin = 'miter';
    g.beginPath(); g.moveTo(cx - tw, m + h - lw / 2); g.lineTo(cx, m + h + tail - lw * 0.4); g.lineTo(cx + tw, m + h - lw / 2); g.stroke();
    g.fillStyle = bg; g.fillRect(cx - tw + lw * 0.8, m + h - lw * 1.2, 2 * tw - lw * 1.6, lw * 1.6);
  } else {                                                         // balão de pensamento: duas bolinhas
    for (const [dx, dy, rr] of [[-fs * 0.1, fs * 0.28, fs * 0.2], [-fs * 0.42, fs * 0.62, fs * 0.12]]) {
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx + dx, m + h + dy, rr, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
  draw(g, m + padX, m + padY);
  return out;
}
// ferramenta em negrito e o detalhe em cinza: "Read: src/api/campanhas.ts". estilo 'bravo' = borda e texto vermelhos
function bubbleSay(head, detail, fs, maxW, estilo = '') {
  const bravo = estilo === 'bravo';
  return cached(`B|${fs}|${maxW}|${estilo}|${head}|${detail}`, () => {
    const bold = fontOf(fs, 700), reg = fontOf(fs, 500);
    const full = detail ? `${head}: ${detail}` : head;
    const fit = fitText(full, bold, maxW), hh = fit.slice(0, head.length), rest = fit.slice(head.length);
    const w1 = Math.ceil(textW(bold, hh)), w2 = rest ? Math.ceil(textW(reg, rest)) : 0;
    return makeBubble(w1 + w2, fs * 1.25, fs, 'say', (g, x, y) => {
      g.textBaseline = 'alphabetic';
      g.font = bold; g.fillStyle = bravo ? '#b3261e' : '#262b3d'; g.fillText(hh, x, y + fs * 1.0);
      if (rest) { g.font = reg; g.fillStyle = '#5a6178'; g.fillText(rest, x + w1, y + fs * 1.0); }
    }, bravo);
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
    const [c, g] = rawCanvas(w + 4, h + 4); g.imageSmoothingEnabled = true;
    g.font = font; g.textBaseline = 'alphabetic'; g.lineJoin = 'round'; g.lineWidth = Math.max(2, Math.round(f2 * 0.22));
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.strokeText('Z', 4, h - 2); g.fillStyle = '#8a76d6'; g.fillText('Z', 4, h - 2);
    return c;
  });
}

// =====================================================================
// 7. ATOR (um agente na cena) — reaproveitado por id, nunca recriado à toa
// =====================================================================
export class Actor {
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
    this.seguindo = null;            // agente que a câmera acompanha (o do detalhe aberto)
    this.insetBaixo = 0;             // px do canvas cobertos embaixo (a folha do detalhe no celular): o agente fica no meio do que sobra
    this.ui = 1;                     // escala da interface (telas grandes): o texto da sala cresce junto
    this._layoutW = 0; this._layoutH = 0;   // tamanho da tela quando a barra lateral abriu: a grade de zonas não muda enquanto ela estiver aberta
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
    this.dir = new Diretor(this);   // animações de situação (gags.js)
    this._door = 0;
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
  setEscalaUI(v) { v = Number(v) || 1; if (v !== this.ui) { this.ui = v; this.updateTp(); } }
  setInsetBaixo(px) { this.insetBaixo = Math.max(0, Math.round(px || 0)); if (this.seguindo) this.ajustarFoco(); }
  setGags(on) { this.dir.ligar(on, performance.now()); }
  // dispara uma animação na mão (console: __escritorio.office.testar('chicote')); tipos em gags.js
  testar(tipo, id) { return this.dir.testar(tipo, id || this.selectedId, performance.now()); }
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
    const seen = new Set(), criados = [], primeira = this.first;
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
        criados.push(act);
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
    this.dir.aoEstado(criados, primeira, now);
  }

  removeActor(a) {
    if (a.seat >= 0) { const s = this.seats.get(a.d.plataforma); if (s) { s[a.seat] = null; while (s.length && !s[s.length - 1]) s.pop(); } }
    this.freeSpot(a);
    this.actors.delete(a.id);
    this.dir.aoRemover(a);
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
    const w = d.X * T + 2 * SIDE + 2, h = WALL_H + d.Y * T + SLAB + 3;
    const cw = this._layoutW || this.W || 1400, ch = this._layoutH || this.H || 900, pad = 8 * (this.dpr || 1);
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
      X, Y, lx, zones: zl, blocked: new Uint8Array(X * Y), statics: [], signs: [], spots: [], spotByKey: new Map(), arcadeSpots: [],
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
        // mesa na fileira cy (o monitor sobe para a fileira de cima) e a cadeira na frente, na fileira cy + 1
        const gx0 = z.x0 + 1 + 3 * c, cy = z.y0 + TOPM + 3 * r, base = cy * T, fy = base + SEAT_DY;
        tiles.push({ cx: gx0, cy, px: gx0 + 1, py: fy / T, base });
        for (let dx = -1; dx <= 2; dx++) blk(gx0 + dx, cy);          // a bancada ocupa a fileira inteira da zona
        add(T_DESK, sprDesk(z.pal, hashStr(z.id + ':' + s)), gx0 * T, base, base + 16, { pid: z.id, idx: s, pal: z.pal, cx: gx0 * T + 16, base });
        add(T_CSEAT, sprChairSeat(z.pal), (gx0 + 1) * T, fy, fy - 1, { pid: z.id, idx: s });
        add(T_CBACK, sprChairBack(z.pal), (gx0 + 1) * T, fy, fy + 1, { pid: z.id, idx: s });
      }
      w.seatTiles.set(z.id, tiles);
      // plantas nos cantos de cima do tapete (a bancada vai de ponta a ponta, então elas ficam uma fileira acima)
      for (const px of [z.x0, z.x0 + z.W - 1]) { add(T_PLANT, null, px * T + 8, (z.y0 + 1) * T, (z.y0 + 1) * T, { v: px === z.x0 ? 0 : 1, ph: px * 0.37 + z.y0 }); blk(px, z.y0); }
      // nome da área: pílula clara logo acima do carpete (y = centro); os nomes dos agentes desviam dela
      // (11 px acima da borda: o nome e o balão de quem senta na 1ª fileira cabem embaixo dela sem serem empurrados)
      w.signs.push({ x: (z.x0 + 5) * T, y: z.y0 * T - 11, nome: z.nome, cor: z.cor });
    }

    // saguão: elevador na parede dos fundos (à esquerda), dois fliperamas ao lado dele, lounge no canto direito
    // (na frente de cada fliperama, o lugar de quem joga; atrás, o de quem só assiste)
    ARCADE_TX.forEach((tx, i) => {
      if (tx >= lx - 1) return;
      add(T_ARCADE, null, tx * T, T, T, { v: i, ph: i * 3.7 });
      blk(tx, 0);
      w.arcadeSpots.push({ gx: tx, gy: 1, px: tx + 0.5, py: 1.75, seat: false, play: true, cab: i, kid: 'A' + i, owner: null });
    });
    ARCADE_TX.forEach((tx, i) => { if (tx < lx - 1) w.arcadeSpots.push({ gx: tx, gy: 3, px: tx + 0.8, py: 3.3, seat: false, watch: true, kid: 'W' + i, owner: null }); });
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
      for (const dx of [0, 1]) w.spots.push({ gx: u0 + dx, gy: 1, px: u0 + 0.56 + dx * 0.88, py: 18 / T, seat: true, sofa: u0, kid: 'S' + (u0 + dx), owner: null });
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
      if (ARCADE_TX.includes(i)) continue;                            // frente dos fliperamas (jogadores e quem assiste)
      stand.push({ gx: i, gy: j, px: i + 0.5, py: j + 0.5, seat: false, kid: i + ',' + j, owner: null, d: Math.hypot(i - (lx + 1.5), j - 1.5) });
    }
    stand.sort((a, b) => a.d - b.d);
    w.spots.push(...stand);
    for (const sp of w.spots) w.spotByKey.set(sp.kid, sp);
    for (const sp of w.arcadeSpots) w.spotByKey.set(sp.kid, sp);

    // limites do mundo em pixels lógicos
    w.bounds = { minX: -SIDE - 4, maxX: X * T + SIDE + 4, minY: -WALL_H - 6, maxY: Y * T + SLAB + 6 };
    this.world = w;
    this.paintBase();
    if (this._dist.length < X * Y) { this._dist = new Int32Array(X * Y); this._q = new Int32Array(X * Y); }
    if (!this.userMoved) this.fit();
  }

  // pinta o piso, os tapetes, o lounge, as paredes, as janelas e as sombras numa imagem só (refeita só quando o layout muda)
  paintBase() {
    const w = this.world, { X, Y, zones, lx } = w, b = w.bounds;
    const cvs = this.base;
    cvs.lw = b.maxX - b.minX; cvs.lh = b.maxY - b.minY;
    cvs.width = cvs.lw * HD; cvs.height = cvs.lh * HD;
    const g = cvs.getContext('2d'); g.imageSmoothingEnabled = false; g.setTransform(HD, 0, 0, HD, 0, 0);
    const ax = -b.minX, ay = -b.minY;
    w.baseAx = ax; w.baseAy = ay;
    const R = (x, y, wd, h, c) => rect(g, ax + x, ay + y, wd, h, c);      // coordenadas do mundo
    const XW = X * T, YH = Y * T;
    const pool = (cx, cy, rx, ry) => { for (let i = 0; i < 4; i++) blob(g, ax + cx, ay + cy, rx - i * 10, Math.max(2, ry - i * 3), 'rgba(255,244,214,0.04)'); };
    // moldura de meio pixel em volta de um retângulo: o contorno das peças pintadas na base
    const borda = (x, y, wd, h, c = LINHA) => { R(x - U, y - U, wd + 1, U, c); R(x - U, y + h, wd + 1, U, c); R(x - U, y, U, h, c); R(x + wd, y, U, h, c); };
    // trançado em ziguezague (tapetes): faixas de 'band' px que sobem e descem a cada 'per' px, com um fio claro entre elas
    const zig = (x0, y0, wd, ht, per, band, cols, fio) => {
      for (let y = 0; y < ht; y += U) {
        let start = 0, cur = null;
        for (let x = 0; x <= wd; x += U) {
          let c = null;
          if (x < wd) { const t = x % per, v = y + (t < per / 2 ? t : per - t); c = fio && v % band < U ? fio : cols[Math.floor(v / band) & 1]; }
          if (c !== cur) { if (cur) R(x0 + start, y0 + y, x - start, U, cur); start = x; cur = c; }
        }
      }
    };

    // sombra da sala sobre o fundo da página
    R(-SIDE + 1, YH + SLAB + U, XW + 2 * SIDE - 2, 2, 'rgba(10,8,20,0.26)'); R(-SIDE + 3, YH + SLAB + 2.5, XW + 2 * SIDE - 6, 2, 'rgba(10,8,20,0.13)');

    // piso de tijolinho creme: tijolos de 8x4 px em fiadas deslocadas pela metade, com rejunte claro e tons levemente diferentes
    const BW = 8, BH = 4;
    for (let row = 0, y = 0; y < YH; row++, y += BH) {
      const off = row & 1 ? BW / 2 : 0, h = Math.min(BH, YH - y);
      for (let x = -off; x < XW; x += BW) {
        const bx = Math.max(x, 0), bw = Math.min(x + BW, XW) - bx;
        const rr = mulberry32(((row + 1) * 73856093) ^ ((((x + off) / BW | 0) + 5) * 19349663));
        R(bx, y, bw, h, BRICKS[(rr() * BRICKS.length) | 0]);
        R(bx, y + h - U, bw, U, 'rgba(176,146,104,0.13)');
        R(bx, y, bw, U, MORTAR);
        if (x >= 0) R(x, y, U, h, MORTAR);
        if (rr() < 0.08) R(bx + 2, y + 2, 3, U, 'rgba(190,160,110,0.14)');
      }
    }
    // poças de luz das lâmpadas no saguão
    pool(lx * T + 72, 36, 64, 18); pool(40, 30, 44, 14); pool(XW / 2, 40, 70, 16);

    // tapetes cinza trançados (o mesmo em todas as zonas), com filete na borda
    for (const z of zones) {
      const x0 = z.x0 * T, y0 = z.y0 * T, zw = z.W * T, zh = z.D * T;
      R(x0 + 1, y0 + 1.5, zw + 1, zh + 1, 'rgba(90,76,60,0.16)');
      zig(x0, y0, zw, zh, 8, 4, RUG, RUG_FIO);
      R(x0, y0, zw, 1, RUG_RIM); R(x0, y0 + zh - 1, zw, 1, RUG_RIM); R(x0, y0, 1, zh, RUG_RIM); R(x0 + zw - 1, y0, 1, zh, RUG_RIM);
      R(x0 + 1, y0 + 1, zw - 2, U, RUG_HI); R(x0 + 1, y0 + 1, U, zh - 2, RUG_HI);
      borda(x0, y0, zw, zh, '#7a858f');
    }
    // lounge: carpete lilás em ziguezague, com divisórias baixas de madeira clara em volta
    {
      const rx = lx * T, rw = XW - rx, lh = 3 * T;
      R(rx - 1, 2, rw + 1, lh + 2, 'rgba(70,60,100,0.16)');
      zig(rx, 0, rw, lh, 12, 6, [LILAC[1], LILAC[0]], LILAC[2]);
      R(rx, 0, rw, U, 'rgba(50,40,90,0.25)');
      const wood = (x, y, wd, h, vert) => {
        borda(x, y, wd, h, WOOD[4]);
        R(x, y, wd, h, WOOD[1]); R(x, y, wd, U, WOOD[0]); R(x, y + h - 1, wd, 1, WOOD[3]);
        if (vert) { R(x + wd - 1, y, 1, h, WOOD[3]); R(x, y, U, h, WOOD[0]); } else for (let i = 3; i < wd - 1; i += 4) R(x + i, y + 1, U, h - 2, WOOD[2]);
        R(x, y + h + U, wd, 1, 'rgba(70,56,70,0.18)');
      };
      wood(rx - 5, 5, 4, lh - 7, true);
      wood(rx - 1, lh - 4, T + 3, 4, false); wood(rx + 8 * T, lh - 4, rw - 8 * T, 4, false);   // a frente fica aberta no meio (entrada)
      for (const px of [rx - 1, rx + T, rx + 8 * T]) { borda(px, lh - 7, 3, 7, WOOD[4]); R(px, lh - 7, 3, 7, WOOD[2]); R(px, lh - 7, 3, U, WOOD[0]); R(px + 2, lh - 7, 1, 7, WOOD[3]); }
    }
    // capacho do elevador
    R(20, 1, 41, 22.5, 'rgba(60,50,70,0.14)'); borda(20, 0, 40, 22, '#6b7590');
    R(20, 0, 40, 22, '#8e97ad'); R(22, 2, 36, 18, '#a2abbf'); R(22, 2, 36, U, '#c1c8d8');
    for (let xx = 24; xx < 58; xx += 2) R(xx, 4, 1, 14, '#939cb2');

    // sombra das bancadas no tapete
    for (const it of w.statics) {
      if (it.t === T_DESK) { R(it.x - 8, it.base + 14.5, 48, 3.5, 'rgba(50,42,72,0.24)'); R(it.x - 8, it.base + 18, 48, 2, 'rgba(50,42,72,0.12)'); R(it.x - 8, it.base + 20, 48, 1.5, 'rgba(50,42,72,0.05)'); }
    }
    // escurecimento (oclusão ambiente) junto das paredes
    for (let i = 0; i < 4; i++) {
      const a = [0.13, 0.08, 0.045, 0.02][i];
      R(0, i * 2, XW, 2, `rgba(60,52,92,${a})`); R(i * 2, 0, 2, YH, `rgba(60,52,92,${a * 0.8})`); R(XW - 2 - i * 2, 0, 2, YH, `rgba(60,52,92,${a * 0.8})`);
    }

    // parede dos fundos, de frente: painéis, lambri e rodapé claro
    R(0, -WALL_H, XW, WALL_H, WALL_BACK);
    for (let x = 0; x < XW; x += 16) { R(x, -WALL_H + 6, U, WALL_H - 17, 'rgba(255,255,255,0.1)'); R(x + U, -WALL_H + 6, U, WALL_H - 17, 'rgba(40,46,110,0.06)'); }
    R(0, -11, XW, 11, WALL_LOW); R(0, -11.5, XW, U, '#c3caec'); R(0, -11, XW, U, '#6d78ad');
    R(0, -4.5, XW, U, '#6d78ad'); R(0, -4, XW, 4, WALL_BASE); R(0, -4, XW, U, '#ffffff'); R(0, -U, XW, U, '#a9b1cf');
    R(0, -WALL_H + 5, XW, 2, 'rgba(40,46,110,0.16)'); R(0, -WALL_H + 7, XW, 1.5, 'rgba(40,46,110,0.07)');     // sombra do teto

    // janelas: caixilho branco, céu, nuvens, prédios ao longe, reflexo no vidro e peitoril
    const SKY = ['#bfe0f8', '#aed5f5', '#9dc9f0', '#8cbde9', '#7cb0e0'];
    const wins = [];
    for (let x = 6 * T; x + 26 <= XW - 12; x += 5 * T) wins.push(x);
    for (const x of wins) {
      R(x + 1, -39.5, 26, 26.5, 'rgba(40,46,110,0.18)'); borda(x, -41, 26, 26.5);
      R(x, -41, 26, 26.5, '#f4f6fb'); R(x, -41, 26, U, '#ffffff'); R(x + 25, -41, 1, 26.5, '#d3daea');
      for (let i = 0; i < 5; i++) R(x + 2, -39 + i * 4.5, 22, 4.5, SKY[i]);
      R(x + 4, -36.5, 6, 1.5, '#ffffff'); R(x + 5.5, -37.5, 4, 1, '#ffffff'); R(x + 15, -32.5, 5.5, 1.5, 'rgba(255,255,255,0.9)'); R(x + 16.5, -33.5, 3, 1, 'rgba(255,255,255,0.9)');
      for (const [bx, bw, bh] of [[2, 4, 7], [7, 5, 10], [13, 4, 6], [18, 6, 9]]) R(x + bx, -16.5 - bh, bw, bh, '#93acd8');
      for (const [bx, bw, bh] of [[3, 5, 5], [10, 6, 8], [17, 5, 4.5]]) {
        R(x + bx, -16.5 - bh, bw, bh, '#6880b6'); R(x + bx, -16.5 - bh, bw, U, '#8098cc');
        for (let yy = 1; yy < bh - 1; yy += 1.5) for (let xx = 1; xx < bw - 1; xx += 1.5) R(x + bx + xx, -16.5 - bh + yy, U, U, ((xx * 2 + yy * 4 + bx) | 0) % 3 ? '#51699e' : '#ffe9a8');
      }
      for (let yy = 0; yy < 22.5; yy += U) {                                                   // reflexo em diagonal
        const xs = Math.round((15 - yy * 0.5) * HD) / HD;
        R(x + 2 + xs, -39 + yy, 3, U, 'rgba(255,255,255,0.16)'); R(x + 7 + xs, -39 + yy, 1, U, 'rgba(255,255,255,0.16)');
      }
      R(x + 2, -39, 22, U, 'rgba(40,60,120,0.3)'); R(x + 2, -39, U, 22.5, 'rgba(40,60,120,0.2)');
      R(x + 12.5, -39, 1, 22.5, '#f4f6fb'); R(x + 2, -28.5, 22, 1, '#f4f6fb'); R(x + 13.5, -39, U, 22.5, 'rgba(40,60,120,0.2)'); R(x + 2, -27.5, 22, U, 'rgba(40,60,120,0.2)');
      R(x - 1, -12, 28, 1, 'rgba(40,46,110,0.2)'); borda(x - 2, -14.5, 30, 2); R(x - 2, -14.5, 30, 2, '#e9edf6'); R(x - 2, -14.5, 30, U, '#ffffff');
    }
    w.lights = wins;
    // quadros entre as janelas
    for (let i = 0; i + 1 < wins.length; i += 2) {
      const cx = wins[i] + 53, fy = -38, kind = (i / 2) % 3;
      R(cx - 8, fy + 1.5, 18, 22, 'rgba(40,46,110,0.2)'); borda(cx - 9, fy, 18, 22, '#6b5232');
      R(cx - 9, fy, 18, 22, '#c9a878'); R(cx - 9, fy, 18, U, '#ecd4ac'); R(cx - 9, fy, U, 22, '#ecd4ac'); R(cx + 8, fy, 1, 22, '#a98858'); R(cx - 7.5, fy + 1.5, 15, 19, '#fbf7ec');
      if (kind === 0) { R(cx - 6, fy + 3, 12, 16, '#b4d6f2'); R(cx - 6, fy + 11.5, 12, 7.5, '#6fb27c'); R(cx - 6, fy + 14.5, 12, 4.5, '#4f9a62'); R(cx - 3, fy + 9.5, 5, 2, '#8fc79a'); R(cx + 2, fy + 5, 3, 3, '#ffe9a8'); R(cx - 4.5, fy + 5.5, 3, 1, '#ffffff'); }
      else if (kind === 1) { R(cx - 6, fy + 3, 12, 16, '#4a5380'); R(cx - 4, fy + 5, 5, 5, '#f2c14e'); R(cx, fy + 9, 5, 7, '#e8837f'); R(cx - 5, fy + 13, 4, 4, '#6fcad8'); R(cx + 2.5, fy + 4.5, 2, 2, '#f1ecde'); }
      else { R(cx - 6, fy + 3, 12, 16, '#f1ede0'); R(cx - 5, fy + 4.5, 10, 2, '#4a5380'); for (const [yy, ww] of [[8.5, 10], [10, 8], [11.5, 9], [13, 6]]) R(cx - 5, fy + yy, ww, U, '#b4b9cc'); R(cx - 5, fy + 15.5, 4, 2, '#e8837f'); R(cx, fy + 15.5, 4, 2, '#7fa6e0'); }
    }
    // relógio, entre a 2ª e a 3ª janela (do lado do elevador ficam os fliperamas)
    if (wins.length >= 2) {
      const cxk = wins[1] + 53;
      R(cxk - 6.5, -35.5, 15, 15, 'rgba(40,46,110,0.2)'); borda(cxk - 7.5, -37, 15, 15, '#6b5232');
      R(cxk - 7.5, -37, 15, 15, '#c9a878'); R(cxk - 7.5, -37, 15, U, '#ecd4ac'); R(cxk - 6, -35.5, 12, 12, '#fdfdff');
      for (const [dx, dy] of [[0, -5], [5, 0], [0, 5], [-5, 0]]) R(cxk - U + dx, -30 + dy, 1, 1, '#4a5380');
      R(cxk - U, -34, U, 4.5, INK); R(cxk - U, -30, 3.5, U, INK); R(cxk - U, -30, U, U, '#e8837f');
    }
    // moldura do elevador, com bisel e painel do indicador de andar (a porta é desenhada por cima, a cada quadro)
    R(19, -41.5, 45, 41.5, 'rgba(40,46,110,0.2)'); borda(18, -43, 44, 43, '#4a5270');
    R(18, -43, 44, 43, '#98a3ba'); R(20, -43, 40, 43, '#c2cadb');
    R(20, -43, 40, U, '#eef1f7'); R(20, -43, U, 43, '#dde2ee'); R(59.5, -43, U, 43, '#8f9ab2'); R(18, -43, 2, 43, '#8f9ab2'); R(60, -43, 2, 43, '#7e8aa4');
    R(20, -43, 40, 7, '#7a859f'); R(21, -42, 38, U, '#9aa5be'); R(29, -42, 22, 4.5, '#1b2030'); R(29, -42, 22, U, '#383f52');
    R(23.5, -36.5, 33, U, '#4a5270'); R(23.5, -36, U, 36, '#4a5270'); R(56, -36, U, 36, '#4a5270');

    // paredes laterais e da frente, vistas de cima: topo claro com contorno (como as paredes do Gather)
    const yTop = -WALL_H, hTot = WALL_H + YH + SLAB;
    R(-SIDE, yTop, SIDE, hTot, WALL_CAP); R(XW, yTop, SIDE, hTot, WALL_CAP); R(-SIDE, YH, XW + 2 * SIDE, SLAB, WALL_CAP); R(-SIDE, yTop, XW + 2 * SIDE, 5, WALL_CAP);
    R(-SIDE, yTop, XW + 2 * SIDE, 1, '#f6f7fc'); R(-SIDE, yTop, 1, hTot, '#f6f7fc');                          // luz de cima e da esquerda
    R(XW + SIDE - 1, yTop + 1, 1, hTot - 1, '#c3c9df'); R(-SIDE + 1, YH + SLAB - 1, XW + 2 * SIDE - 1, 1, '#c3c9df');   // sombra da direita e de baixo
    borda(-SIDE, yTop, XW + 2 * SIDE, hTot);
    R(-U, yTop + 5, XW + 1, U, LINHA); R(-U, yTop + 5, U, WALL_H - 5 + YH, LINHA); R(XW, yTop + 5, U, WALL_H - 5 + YH, LINHA); R(-U, YH, XW + 1, U, LINHA);
  }

  // ---------- recolocar os atores depois de o layout mudar ----------
  relayoutActors(now) {
    const w = this.world;
    for (const sp of w.spots) sp.owner = null;
    for (const a of this.actors.values()) {
      a.deitado = null;
      if (a.kind === 'lounge' || a.kind === 'arcade') {
        const sp = w.spotByKey.get(a.spotKey);
        if (sp && !sp.owner) { sp.owner = a.id; a.spot = sp; } else { a.spot = null; a.kind = 'none'; }
      }
    }
    for (const a of this.actors.values()) {
      if (a.fresh || a.gag) continue;
      const kind = a.kind;
      if (kind === 'desk' && a.arrived) { const s = this.seatTile(a); if (s) { a.x = s.px; a.y = s.py; } }
      else if ((kind === 'lounge' || kind === 'arcade') && a.arrived && a.spot) { a.x = a.spot.px; a.y = a.spot.py; }
      else {
        // em trânsito: garante que está dentro do mapa e replaneja
        a.x = clamp(a.x, 0.3, w.X - 0.3); a.y = clamp(a.y, 0.3, w.Y - 0.3);
        if (kind !== 'none') { a.kind = 'none'; this.think(a, now, false); }
      }
    }
    this.dir.aoRelayout(now);
  }
  seatTile(a) { const t = this.world.seatTiles.get(a.d.plataforma); return t && t[a.seat]; }

  // ---------- decisão e caminhos ----------
  // decide para onde o ator quer ir pelo estado dele
  think(a, now, direct) {
    if (this.dir.segura(a, now)) return;          // no meio de uma animação (ou esperando o chefe terminar)
    const d = a.d;
    let want;
    if (a.leaving || d.estado === 'saindo') want = 'exit';
    else if (this.dir.querArcade(a, now)) want = 'arcade';   // só esperando os subagentes: vai jogar
    else if (d.estado === 'ocioso') want = (a.kind === 'desk' && now - a.estadoSince < IDLE_DELAY) ? 'desk' : 'lounge';
    else want = 'desk';
    if (want !== 'exit') want = this.dir.pausa(a, now, want);   // a caminho do lounge, passa na cafeteira
    if (want === a.kind) return;
    this.assign(a, want, now, direct);
  }
  assign(a, kind, now, direct) {
    if ((a.kind === 'lounge' || a.kind === 'arcade') && kind !== a.kind) this.freeSpot(a);
    let tx, ty, fx, fy;
    if (kind === 'desk') {
      const s = this.seatTile(a);
      if (!s) { tx = Math.floor(DOOR_X); ty = 0; fx = DOOR_X; fy = 0.5; } else { tx = s.cx; ty = s.cy + 1; fx = s.px; fy = s.py; }
    } else if (kind === 'lounge') {
      const sp = this.allocSpot(a);
      tx = sp.gx; ty = sp.gy; fx = sp.px; fy = sp.py;
    } else if (kind === 'cafe') {                  // na frente da cafeteira
      const c = this.dir.lugarCafe(a);
      tx = c.gx; ty = c.gy; fx = c.px; fy = c.py;
    } else if (kind === 'arcade') {                // fliperama livre; lotado, fica no lounge
      let sp = this.dir.vagaArcade(a);
      if (sp) { a.spot = sp; a.spotKey = sp.kid; } else sp = this.allocSpot(a);
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
    // primeiro um sofá vazio (quem cochilar ali deita nos dois lugares), depois qualquer lugar livre
    for (const s of sp) if (!s.owner && s.seat && !sp.some((o) => o !== s && o.seat && o.sofa === s.sofa && o.owner)) { pick = s; break; }
    if (!pick) for (const s of sp) if (!s.owner) { pick = s; break; }
    if (!pick) pick = sp[hashStr(a.id) % sp.length]; // lotado: divide o lugar
    else pick.owner = a.id;
    a.spot = pick; a.spotKey = pick.kid;
    return pick;
  }
  freeSpot(a) {
    if (a.spot && a.spot.owner === a.id) a.spot.owner = null;
    if (a.deitado && a.deitado.owner === a.id) a.deitado.owner = null;   // o outro lugar do sofá, de quem deitou
    a.spot = null; a.deitado = null;
  }

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
    this._door = 0;
    for (const a of this.actors.values()) {
      this.think(a, now, false);
      this.mover(a, dt, now);
      if (a.gone) { this.left.set(a.id, now); this.removeActor(a); }
    }
    this.dir.update(dt, now);                      // animações e o Chefe (que não vem do servidor)
    this.doorOpen += (this._door - this.doorOpen) * Math.min(1, dt * 6);
    // seguindo um agente (detalhe aberto): a câmera desliza para mantê-lo no centro, mesmo andando
    if (this.seguindo) {
      const a = this.actors.get(this.seguindo);
      if (!a) this.seguindo = null;
      else this.camTarget = { tx: Math.round(this.W / 2 - a.fx * this.k), ty: Math.round((this.H - this.insetBaixo) / 2 - (a.fy - 10) * this.k) };
    }
    // câmera suave quando se pede "centralizar"
    if (this.camTarget) {
      const c = this.camTarget, f = Math.min(1, dt * 9);
      this.tx = Math.round(this.tx + (c.tx - this.tx) * f); this.ty = Math.round(this.ty + (c.ty - this.ty) * f);
      if (Math.abs(c.tx - this.tx) < 1 && Math.abs(c.ty - this.ty) < 1) { this.tx = c.tx; this.ty = c.ty; this.camTarget = null; }
    }
  }
  // anda pelo caminho, aparece/some na porta do elevador e calcula a posição na tela e a profundidade
  mover(a, dt, now) {
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
      if (dd < 2.5) this._door = 1;
    }
    // posição na tela e ordem de profundidade (pelo y dos pés)
    a.fx = Math.round(a.x * T); a.fy = Math.round(a.y * T);
    a.key = a.fy + 0.002;
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
    const k = this.k, w = this.world, tela = this.g;
    // A arte tem HD px por px lógico: fica nítida quando o zoom é múltiplo de HD. Num zoom ímpar, a cena é desenhada no
    // múltiplo de cima, num canvas à parte, e reduzida com suavização (assim nenhum pixel sai maior que o vizinho).
    // No zoom 1 (tela pequena com a sala inteira), cada sprite é reduzido à metade direto, com suavização.
    const ks = k < HD ? k : Math.ceil(k / HD) * HD, direto = ks === k;
    let g = tela, sx = this.tx, sy = this.ty;
    if (!direto) {
      const f = ks / k, cw = Math.ceil(this.W * f), ch = Math.ceil(this.H * f);
      const c = this._cena || (this._cena = document.createElement('canvas'));
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      g = c.getContext('2d', { alpha: false });
      sx = Math.round(this.tx * f); sy = Math.round(this.ty * f);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = k < HD;
    g.fillStyle = this.bg; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.setTransform(ks, 0, 0, ks, sx, sy);
    put(g, this.base, -w.baseAx, -w.baseAy);
    // sol que entra pelas janelas e cai no chão (a intensidade oscila bem devagar)
    const luz = sprLight();
    for (let i = 0; i < w.lights.length; i++) { g.globalAlpha = 0.7 + 0.3 * Math.sin(now / 2600 + i * 1.7); put(g, luz.c, w.lights[i] - 4, 2); }
    g.globalAlpha = 1;
    this.drawDoor(g, now);
    const sel = this.selectedId && this.actors.get(this.selectedId);
    const hov = this.hoverId && this.hoverId !== this.selectedId && this.actors.get(this.hoverId);
    // anéis no chão (seleção, parentes e hover) para quem está em pé ou andando
    const pulse = 0.55 + 0.45 * Math.sin(now / 220);
    if (sel) {
      for (const a of this.actors.values()) if (a !== sel && (a.id === sel.d.paiId || a.d.paiId === sel.id) && !this.isSeated(a)) ringEllipse(g, a.fx, a.fy, 7, 3, 'rgba(255,255,255,0.75)');
      if (!this.isSeated(sel)) { g.globalAlpha = 0.5 + pulse * 0.5; ringEllipse(g, sel.fx, sel.fy, 8, 3, '#ffffff'); g.globalAlpha = 1; }
    }
    if (hov && !this.isSeated(hov)) { g.globalAlpha = 0.8; ringEllipse(g, hov.fx, hov.fy, 7, 3, '#cfd8ea'); g.globalAlpha = 1; }

    // itens estáticos + atores, ordenados pelo y dos pés
    const items = this.items;
    items.length = 0;
    for (const s of w.statics) items.push(s);
    for (const a of this.actors.values()) items.push(a);
    for (const a of this.dir.npcs.values()) items.push(a);
    items.sort(byKey);
    for (let i = 0; i < items.length; i++) this.drawItem(g, items[i], now);
    // extras das animações (chicote, veia de raiva, suor, estrelinhas, mão levantada) por cima dos móveis
    for (let i = 0; i < items.length; i++) { const it = items[i]; if (it.t === T_ACTOR && it.alpha >= 0.03) this.dir.depois(g, it, now, it.dox || 0, it.doy || 0); }
    this.dir.drawParticulas(g);

    // quem está sentado: cantos em volta da estação
    if (sel && this.isSeated(sel)) { g.globalAlpha = 0.5 + pulse * 0.5; this.marker(g, sel, '#ffffff'); g.globalAlpha = 1; }
    if (sel) for (const a of this.actors.values()) if (a !== sel && this.isSeated(a) && (a.id === sel.d.paiId || a.d.paiId === sel.id)) { g.globalAlpha = 0.7; this.marker(g, a, '#ffffff'); g.globalAlpha = 1; }
    if (hov && this.isSeated(hov)) { g.globalAlpha = 0.8; this.marker(g, hov, '#cfd8ea'); g.globalAlpha = 1; }

    this.drawLinks(g, now, sel);
    if (!direto) {
      tela.setTransform(1, 0, 0, 1, 0, 0);
      tela.imageSmoothingEnabled = true; tela.imageSmoothingQuality = 'high';
      tela.drawImage(g.canvas, 0, 0, g.canvas.width * k / ks, g.canvas.height * k / ks);
    }
    this.drawOverlay(now);
  }
  isSeated(a) { return a.arrived && a.kind === 'desk'; }
  marker(g, a, c) {
    const s = this.seatTile(a);
    if (s) brackets(g, s.cx * T - 10, s.base - 23, s.cx * T + 42, s.base + SEAT_DY + 7, c);
  }

  // porta do elevador na parede dos fundos: metal escovado, painéis que deslizam e indicador de andar
  drawDoor(g, now) {
    const o = this.doorOpen, x0 = 24, H = 36, y0 = -H, half = 16, open = Math.round(14 * o * HD) / HD, wp = half - open;
    rect(g, x0, y0, 32, H, '#0e1118'); rect(g, x0 + 2, y0 + 2, 28, H - 2, '#1a2030');
    rect(g, x0 + 4, y0 + 2, 24, 1.5, o > 0.05 ? '#ffe9a8' : '#4a4636');                       // luz do teto da cabine
    rect(g, x0 + 4, y0 + 22, 24, U, '#7d879b'); rect(g, x0 + 4, y0 + 22.5, 24, U, '#454d61'); rect(g, x0 + 14, y0 + 6, 4, H - 6, o > 0.2 ? '#27304a' : '#1a2030');
    const porta = (xs, wd, claro) => {
      rect(g, xs, y0, wd, H, claro ? '#b8c1d0' : '#abb5c5');
      for (let i = 1; i < wd; i += 2) rect(g, xs + i, y0, U, H, claro ? '#c9d1de' : '#bcc5d3');
      rect(g, xs, y0, wd, U, '#e6ebf3'); rect(g, xs, y0 + H - U, wd, U, '#8791a5'); rect(g, xs, y0 + 18, wd, U, 'rgba(70,80,100,0.25)');
    };
    if (wp > 0) {
      porta(x0, wp, true); rect(g, x0 + wp - U, y0, U, H, '#5d6678'); rect(g, x0, y0, U, H, '#8f99ab');
      porta(x0 + 32 - wp, wp, false); rect(g, x0 + 32 - wp, y0, U, H, '#5d6678'); rect(g, x0 + 31.5, y0, U, H, '#8f99ab');
      if (open > 0) rect(g, x0 + wp, y0 + 2, 2, H - 2, 'rgba(10,8,20,0.28)');
    }
    // indicador acima da porta: três lâmpadas que correm e uma seta que acende quando a porta abre
    const aceso = o > 0.05;
    for (let i = 0; i < 3; i++) rect(g, 31 + i * 5, -40.5, 3, 1.5, (aceso && ((now / 220) | 0) % 3 === i) ? '#ffcf5a' : '#3a3f4c');
    rect(g, 46, -40, 3, U, aceso ? '#ffcf5a' : '#3a3f4c'); rect(g, 47, -41, 1, 2.5, aceso ? '#ffcf5a' : '#3a3f4c');
  }

  drawItem(g, it, now) {
    switch (it.t) {
      case T_SPR: case T_CSEAT: case T_CBACK: putS(g, it.spr, it.x, it.y); break;
      case T_PLANT: {                                         // as folhas balançam devagar
        const s = sprPlant(it.v, [0, 1, 2, 1][((now / 700 + it.ph) | 0) & 3]);
        putS(g, s, it.x, it.y);
        break;
      }
      case T_COFFEE: {                                        // vapor subindo da cafeteira
        putS(g, it.spr, it.x, it.y);
        this.dir.cafeteira(g, it, now);                       // café caindo na caneca quando alguém está servindo
        for (let i = 0; i < 3; i++) {
          const p = (now / 1500 + i / 3) % 1, sx = it.x + 3 + Math.round(Math.sin(p * 6 + i * 2) * 1.5), sy = it.y - 34 - Math.round(p * 10);
          g.globalAlpha = (1 - p) * 0.6; rect(g, sx, sy, 1.5, 1.5, '#ffffff'); rect(g, sx + 1, sy - 1, 1, 1, '#ffffff');
        }
        g.globalAlpha = 1;
        break;
      }
      case T_DESK: {
        putS(g, it.spr, it.x, it.y);
        const a = this.seatOwner(it.pid, it.idx);
        let mode = 0;
        if (a && a.kind === 'desk' && a.arrived) { const e = a.d.estado; mode = e === 'trabalhando' ? 1 : e === 'pensando' ? 2 : e === 'esperando' ? 3 : 4; }
        const sc = it.spr.scr, s = this._scr || (this._scr = [0, 0, 0, 0]);
        s[0] = it.x + sc[0]; s[1] = it.base + sc[1]; s[2] = sc[2]; s[3] = sc[3];
        drawScreen(g, s, mode, now, it.pal, hashStr(it.pid) + it.idx);
        if (mode) {                                           // a tela acesa ilumina o tampo
          g.globalAlpha = mode === 1 ? 0.16 : 0.1;
          rect(g, s[0] + 1, it.base - 0.5, s[2] - 2, 2, mode === 1 ? it.pal.glow : mode === 2 ? '#b7a4ff' : mode === 3 ? '#ffd36b' : '#9db8e8');
          g.globalAlpha = 1;
        }
        break;
      }
      case T_ACTOR: this.drawActor(g, it, now); break;
      case T_ARCADE: this.dir.drawArcade(g, it, now); break;
      default: break;
    }
  }
  seatOwner(pid, idx) { const s = this.seats.get(pid); const id = s && s[idx]; return id ? this.actors.get(id) : null; }

  drawActor(g, a, now) {
    if (a.alpha < 0.03) { a.hit.x1 = -1; return; }
    const sitting = a.arrived && a.kind === 'desk', lounging = a.arrived && a.kind === 'lounge';
    const moving = !a.arrived && a.path.length > 0;
    let pidx = 0, dir = 0, cup = 0;                         // 0 em pé, 1 andando, 2 sentado à mesa, 3 sentado no sofá
    if (sitting) { pidx = 2; dir = 2; }
    else if (lounging && a.spot && a.spot.seat) pidx = 3;
    else if (lounging) cup = 1;
    else if (moving) { pidx = 1; dir = a.face === 0 ? 1 : a.face === 1 ? 0 : a.face === 2 ? 3 : 2; }
    let frame = pidx === 1 ? ((a.walkT | 0) & 3) : pidx === 2 && a.d.estado === 'trabalhando' ? ((now / 130) | 0) & 1 : 0, ox = 0, oy = 0;
    // animações: a pose e o deslocamento podem vir do diretor (4 fliperama, 5 braço erguido, 6 comemorando)
    const ov = this.dir.pose(a, now);
    a.semMaos = !!(ov && ov.semMaos);
    a.ovx = null; a.ovy = null;
    if (ov) {
      if (ov.pidx != null) { pidx = ov.pidx; dir = ov.dir || 0; frame = ov.frame || 0; cup = 0; }
      if (ov.cup != null) cup = ov.cup;
      if (ov.frame != null) frame = ov.frame;
      ox = ov.ox || 0; oy = ov.oy || 0;
    }
    // área de clique (pixels do dispositivo)
    const k = this.k;
    a.hit.x0 = (a.fx - 9) * k + this.tx; a.hit.x1 = (a.fx + 9) * k + this.tx;
    a.hit.y0 = (a.fy - HEAD_H - 4) * k + this.ty; a.hit.y1 = (a.fy + 3) * k + this.ty;
    if (ov && ov.deitado) {                                  // soneca deitado no sofá: o diretor desenha
      if (a.alpha < 1) g.globalAlpha = a.alpha;
      this.dir.deitado(g, a, now);
      g.globalAlpha = 1; a.dox = 0; a.doy = 0;
      return;
    }
    const bob = pidx === 0 && ((((now + a.phase) / 700) | 0) & 1) ? 1 : 0;
    const blink = ov && ov.olhosFechados ? 1 : ((now + a.phase * 3) % 4300) < 140 ? 1 : 0;
    const idx = ((((pidx * 4 + dir) * 4 + frame) * 2 + bob) * 2 + blink) * 2 + cup;
    let s = a.sprs[idx];
    if (!s) {
      const o = this._pose;
      o.pose = ['stand', 'walk', 'sitD', 'sitS', 'play', 'arm', 'yay'][pidx]; o.dir = dir; o.frame = frame; o.bob = bob ? -1 : 0; o.blink = blink; o.cup = !!cup;
      s = a.sprs[idx] = buildPerson(a, o);
    }
    if (a.alpha < 1) g.globalAlpha = a.alpha;
    put(g, s, a.fx - 16 + ox, a.fy - 37 + oy);
    a.dox = ox; a.doy = oy;                           // o diretor desenha os extras depois de todos os itens
    g.globalAlpha = 1;
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
    const x0 = p.fx, y0 = p.fy - 10, x1 = c.fx, y1 = c.fy - 10;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 4) return;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - Math.min(40, 10 + len * 0.18);
    const n = Math.max(4, Math.round(len / 7));
    const ph = now < 0 ? 0 : (now / 70) % 1;
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const s = now < 0 ? (i + 0.5) / n : (i + ph) / n, r = 1 - s;
      const x = Math.round(r * r * x0 + 2 * r * s * mx + s * s * x1), y = Math.round(r * r * y0 + 2 * r * s * my + s * s * y1);
      if (now < 0) { if (i & 1) continue; g.globalAlpha = 0.8; g.fillRect(x, y, 1.5, 1.5); g.globalAlpha = 1; }
      else { g.globalAlpha = 0.35 + 0.65 * s; g.fillRect(x, y, 1.5, 1.5); g.globalAlpha = 1; }
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
    this.dir.drawTextos(g, now);                     // onomatopeias por cima de tudo (CRACK!, K.O.!)
  }
  measureOverlay(a, now, hl) {
    if (a.alpha < 0.05) return null;
    const k = this.k, fs = this.fs, d = a.d, gap = Math.max(1, Math.round(this.dpr));
    const sentado = a.arrived && (a.kind === 'desk' || (a.kind === 'lounge' && a.spot && a.spot.seat));
    const hx = Math.round((a.ovx ?? a.fx) * k + this.tx), hy = Math.round((a.ovy ?? a.fy - HEAD_H + (sentado ? CORPO.sentado : 0)) * k + this.ty);
    const mx = 300 * this.dpr;
    if (hx < -mx || hx > this.W + mx || hy < -200 * this.dpr || hy > this.H + 100 * this.dpr) return null;
    const rel = !hl && this.selectedId && (d.paiId === this.selectedId || (this.actors.get(this.selectedId) || {}).d?.paiId === a.id);
    const wide = Math.round(Math.min(this.W * 0.7, 300 * this.dpr));         // quem está em foco mostra o nome (quase) inteiro
    const nome = `${String(d.apelido || d.nome || d.id || '').slice(0, 40)} ${this.emoji(a, now)}`;   // nome curto + o que está fazendo, como no Gather
    const ls = namePill(nome, d.estado, a.pal.accent, hl ? 1 : rel ? 2 : 0, fs, hl ? wide : this.nameW), bf = Math.max(8, Math.round(fs * 0.93));
    const lw = ls.pw, lh = ls.ph, ly = hy - lh - gap;
    let bs = null;
    const fala = this.dir.fala(a, now);              // fala de uma animação (bronca, chicote, susto...) passa na frente
    if (fala) bs = bubbleSay(fala.head, fala.det || '', bf, hl ? wide : this.bubW, fala.estilo);
    else if (hl && !a.npc) {                         // o que está fazendo aparece ao passar o mouse (ou no selecionado)
      if (d.estado === 'trabalhando') bs = bubbleSay(d.ferramenta || d.detalhe || '...', d.ferramenta && d.detalhe ? d.detalhe : '', bf, wide);
      else if (d.estado === 'pensando') bs = bubbleSay('Pensando', d.titulo || '', bf, wide);
      else if (d.estado === 'esperando') bs = bubbleSay(d.ferramenta === 'Agent' || d.ferramenta === 'Task' ? 'Esperando o subagente' : d.ferramenta || 'Esperando', d.detalhe || '', bf, wide);
      else if (d.estado === 'saindo') bs = bubbleSay('Terminou', d.titulo || '', bf, wide);
      else bs = bubbleSay('Na pausa', this.dir.dormindo(a, now) ? 'cochilando' : a.atividade === 'celular' ? 'no celular' : a.kind === 'arcade' ? 'no fliperama' : 'tomando café', bf, wide);
    }
    const bw = bs ? bs.pw : 0, bh = bs ? bs.ph : 0;
    const zz = !bs && (this.dir.on ? this.dir.dormindo(a, now) : a.arrived && a.kind === 'lounge' && now - a.arrivedAt > ZZ_DELAY);
    const lr = { x0: hx - (lw >> 1), x1: hx - (lw >> 1) + lw, y0: ly, y1: ly + lh };
    let br = null;
    if (bs) br = { x0: hx - (bw >> 1), x1: hx - (bw >> 1) + bw, y0: ly - bh - gap, y1: ly - gap };
    else if (zz) br = { x0: hx + Math.round(fs * 0.5), x1: hx + Math.round(fs * 2.2), y0: ly - Math.round(fs * 2.4), y1: ly - gap };
    return { a, hl, hx, hy, ls, lw, lh, ly, bs, bw, bh, zz, dy: 0, dx: 0, lr, br, rs: [lr, br] };
  }
  // emoji do estado ao lado do nome (como no Gather)
  emoji(a, now) {
    if (a.npc) return '😠';
    const d = a.d;
    if (a.gag) return a.gag.tipo === 'chicote' ? '🪢' : '😠';
    if (a.kind === 'arcade' && a.arrived) return '🕹️';
    if (this.dir.on && this.dir.dormindo(a, now)) return '💤';
    switch (d.estado) {
      case 'trabalhando': return a.fogoAte > now ? '🔥' : '💻';
      case 'pensando': return '💭';
      case 'esperando': return /AskUserQuestion|·ask$/.test(d.ferramenta || '') ? '🙋' : '⏳';
      case 'saindo': return '👋';
      default: return a.atividade === 'celular' ? '📱' : '☕';
    }
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
    } else if (this.world && !this.userMoved) this.fit(); else { this.updateTp(); if (this.seguindo) this.ajustarFoco(); }
  }
  // ---------- foco num agente (barra lateral aberta) ----------
  // Trava a grade de zonas no tamanho atual da tela, aproxima até um zoom confortável (uns 14 tiles de largura,
  // sem afastar quem já estava mais perto) e passa a acompanhar o agente. soltar() volta à vista da sala inteira.
  focar(id) {
    if (!this.actors.has(id)) return;
    if (!this._layoutW) { this._layoutW = this.W; this._layoutH = this.H; }
    this.seguindo = id; this.userMoved = true;
    this.ajustarFoco();
  }
  ajustarFoco() {
    const a = this.actors.get(this.seguindo);
    if (!a || !this.W) return;
    const tiles = this.W / this.dpr < 700 ? 12 : 20;   // celular: mais perto; telas largas: a vizinhança toda
    const kf = clamp(Math.floor(Math.min(this.W / (tiles * T), Math.max(this.H - this.insetBaixo, this.H * 0.35) / (10 * T))), this.kMin, this.kMax);
    if (this.k === kf || (this.k > kf && this.k !== this._kFoco)) return;   // não afasta quem o usuário aproximou; o zoom do foco se ajusta à tela
    this._kFoco = kf;
    const sx = a.fx * this.k + this.tx, sy = a.fy * this.k + this.ty;   // aproxima sem tirar o agente do lugar na tela; depois desliza ao centro
    this.k = kf; this.tx = Math.round(sx - a.fx * kf); this.ty = Math.round(sy - a.fy * kf);
    this.updateTp();
  }
  soltar() {
    if (!this.seguindo && !this._layoutW) return;
    this.seguindo = null; this._layoutW = 0; this._layoutH = 0; this._kFoco = 0;
    this.userMoved = false; this.camTarget = null;
    this.fit();
  }
  updateTp() {
    this.k = clamp(this.k, this.kMin, this.kMax);
    const kc = this.k / this.dpr;              // px de CSS por pixel lógico
    this.lowZoom = kc < 1.5;                   // vista toda numa tela pequena: o texto fica grande perto da sala, então só os nomes aparecem
    // texto em px do dispositivo: a fonte cresce devagar com o zoom; o nome cabe no espaço entre duas mesas
    this.fs = Math.round(clamp(8 + kc * 1.5 / this.ui, 9.5, 14.5) * this.dpr * this.ui);
    this.nameW = Math.round(3 * T * this.k * (kc < 1.5 ? 1.4 : 1.2));          // um pouco mais largo quando a vista está toda na tela
    this.bubW = Math.round(3 * T * this.k * 0.98);   // no máximo a distância entre duas mesas: vizinhos não se empurram (o texto inteiro aparece no hover)
    this.onView && this.onView(this);
  }
  // enquadra a sala inteira no maior zoom inteiro que couber (a folga é só o contorno da sala e uns pixels de respiro)
  fit() {
    if (!this.world || !this.W) return;
    const wd = this.world, x0 = -SIDE - 1, y0 = -WALL_H - 1, w = wd.X * T + 2 * SIDE + 2, h = WALL_H + wd.Y * T + SLAB + 3, pad = 4 * this.dpr;
    const k = Math.floor(Math.min((this.W - pad * 2) / w, (this.H - pad * 2) / h));
    this.k = clamp(k, this.kMin, this.kMax);
    this.tx = Math.round((this.W - w * this.k) / 2 - x0 * this.k);
    this.ty = Math.round((this.H - h * this.k) / 2 - y0 * this.k);
    this.camTarget = null;
    this.updateTp();
  }
  resetView() { this.seguindo = null; this.userMoved = false; this.fit(); }
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
      if (it.t !== T_ACTOR || it.alpha < 0.3 || it.npc) continue;
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
        if (!this._drag.moved && Math.hypot(dx, dy) > 5 * this.dpr) { this._drag.moved = true; this.seguindo = null; c.style.cursor = 'grabbing'; this.hoverClear(); }
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

// usados por gags.js (as animações de situação)
export { DOOR_X, cached, textW, FONT_STACK, ST_COLOR };
