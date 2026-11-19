/* moveis.js — a mobília: mesas (bancada de 3 tiles com monitores, gabinete, impressora...), cadeiras, plantas,
 * sofás, cafeteira, bebedouro e estante. Tudo desenhado com retângulos de meio pixel e contorno automático
 * (pixel.js), no estilo do Gather. Cada peça em cima da mesa é feita num sprite próprio, para também ganhar contorno.
 */
import { U, rh, rect, blob, softShadow, makeSprite, sprite, putS, mulberry32, hashStr, dk, lt } from './pixel.js';

export const OL = 0.58;            // quanto o contorno escurece a cor vizinha
const SOMBRA = 'rgba(50,42,72,0.22)';

// cria (ou pega do cache) um sprite; o desenho recebe R(x, y, w, h, cor) em coordenadas da âncora
function spr(key, x0, y0, x1, y1, fn, ol = OL) {
  return sprite(key, () => makeSprite(x0, y0, x1, y1, (g, ax, ay) => fn((x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c), g, ax, ay), ol));
}
// desenha uma peça num sprite próprio (com contorno) e cola no canvas de outro sprite; a caixa é em coordenadas do sprite de destino
function peca(g, ax, ay, x0, y0, x1, y1, fn) {
  const s = makeSprite(x0 - 1, y0 - 1, x1 + 1, y1 + 1, (gg, bx, by) => fn((x, y, w, h, c) => rect(gg, bx + x, by + y, w, h, c), gg, bx, by), OL);
  putS(g, s, ax, ay);
}

// =====================================================================
// TELAS
// =====================================================================
// tela parada de um monitor secundário (área interna x,y,w,h); 'kind' escolhe o conteúdo
function staticScreen(R, x, y, w, h, kind, pal, rnd) {
  if (kind === 0) {                                         // papel de parede: pôr do sol com grade (synthwave)
    const sky = ['#2a1b5e', '#4a2384', '#7b2a9a', '#c23a9a', '#f0608a'], hh = Math.max(2, h - 3), cx = x + rh(w / 2);
    for (let i = 0; i < hh; i += U) R(x, y + i, w, U, sky[Math.min(4, Math.floor(i * 5 / hh))]);
    R(cx - 2, y + hh - 2.5, 4, 2.5, '#ffd36b'); R(cx - 1.5, y + hh - 3, 3, U, '#ffd36b'); R(cx - 2, y + hh - 1.5, 4, U, '#ff8f6b'); R(cx - 2, y + hh - U, 4, U, '#f0608a');
    R(x, y + hh, w, h - hh, '#1c1447');
    for (let i = 1; i < w; i += 2) R(x + i, y + hh, U, h - hh, '#5a4ad0');
    R(x, y + hh, w, U, '#ff7ad9'); if (h - hh > 1.5) R(x, y + hh + 1.5, w, U, '#5a4ad0');
  } else if (kind === 1) {                                  // editor de código, tema escuro
    R(x, y, w, h, '#1a2032'); R(x, y, 2, h, '#232b42'); R(x, y, w, 1, '#2a3350'); R(x + U, y + U, U, U, '#ff6b6b'); R(x + 1.5, y + U, U, U, '#ffd36b');
    const cc = ['#7ddfb6', '#ffcf6b', '#8ab4ff', '#ff8fa3', pal.glow];
    for (let yy = y + 2; yy < y + h - U; yy += 1) {
      let xx = x + 3 + ((rnd() * 3) | 0);
      for (let n = 1 + ((rnd() * 3) | 0); n > 0 && xx < x + w - 1; n--) { const ww = Math.min(x + w - 1 - xx, 1 + ((rnd() * 4) | 0)); R(xx, yy, ww, U, cc[(rnd() * cc.length) | 0]); xx += ww + U; }
    }
  } else if (kind === 2) {                                  // aplicativo, tema claro
    R(x, y, w, h, '#eef2fa'); R(x, y, w, 1, pal.accent); R(x + U, y, 1, U, 'rgba(255,255,255,0.7)');
    R(x, y + 1, 3, h - 1, '#d5deef'); for (let yy = y + 2; yy < y + h - U; yy += 1.5) R(x + U, yy, 2, U, '#a9b7d4');
    R(x + 4, y + 2, w - 5, 2.5, '#ffffff'); R(x + 4.5, y + 2.5, 3, U, pal.soft); R(x + 4.5, y + 3.5, w - 7, U, '#c9d3e6');
    if (h > 7) { R(x + 4, y + 5.5, w - 5, h - 6.5, '#ffffff'); for (let yy = y + 6; yy < y + h - 1.5; yy += 1) R(x + 4.5, yy, 2 + ((rnd() * (w - 8)) | 0), U, '#c9d3e6'); }
  } else if (kind === 3) {                                  // painel: gráfico de linha e barras, tema escuro
    R(x, y, w, h, '#151d2c'); R(x, y, w, 1, '#1f2a40'); R(x + U, y + U, 3, U, '#7ddfb6');
    for (let yy = y + 3; yy < y + h; yy += 2) R(x, yy, w, U, '#1d2739');
    let v = rh(h * 0.55);
    for (let i = 1; i < w - 1; i += U) { v = Math.min(h - 1.5, Math.max(2, v + ((rnd() * 3) | 0) * U - U)); R(x + i, y + v, U, U, pal.glow); R(x + i, y + v + U, U, h - v - U, 'rgba(255,255,255,0.06)'); }
  } else if (kind === 4) {                                  // montanhas ao entardecer
    const sky = ['#2b2370', '#5b2f9a', '#a8369f', '#e8556f', '#ffa05c', '#ffd07a'];
    for (let i = 0; i < h; i += U) R(x, y + i, w, U, sky[Math.min(5, Math.floor(i * 6 / h))]);
    R(x + rh(w * 0.62), y + rh(h * 0.3), 2.5, 2.5, '#fff1b8');
    for (let i = 0; i < w; i += U) { const m = rh(Math.abs(((i * 1.3) % 9) - 4.5) * 0.7 + 1); R(x + i, y + h - m, U, m, '#3a2a6a'); const m2 = rh(Math.abs(((i * 0.9 + 3) % 7) - 3.5) * 0.5 + U); R(x + i, y + h - m2, U, m2, '#241a4a'); }
  } else {                                                  // terminal
    R(x, y, w, h, '#0e1512'); R(x, y, w, 1, '#1d2b25');
    for (let yy = y + 2; yy < y + h - U; yy += 1) { R(x + 1, yy, U, U, '#58e08c'); R(x + 2, yy, 1 + ((rnd() * (w - 5)) | 0), U, rnd() < 0.2 ? '#ffcf6b' : '#7fbf9a'); }
  }
  R(x, y, U, U, 'rgba(255,255,255,0.35)');                  // brilho no canto
}

// A tela do monitor principal da mesa (a área s = [x,y,w,h] em px lógicos do mundo), animada pelo estado de quem senta ali:
// mode 0 apagado, 1 trabalhando (código sendo digitado), 2 pensando, 3 esperando, 4 ocioso.
export function drawScreen(g, s, mode, now, pal, seed) {
  const X = s[0], Y = s[1], W = s[2], H = s[3];
  if (mode === 0) return;                                    // apagada: já está pintada no sprite da mesa
  rect(g, X, Y, W, H, mode === 1 ? '#0f2731' : mode === 2 ? '#1f1840' : mode === 3 ? '#33290f' : '#141d36');
  const cx = X + rh(W / 2), cy = Y + rh(H / 2);
  if (mode === 1) {
    rect(g, X, Y, W, 1, pal.accent); rect(g, X + U, Y, 1, U, 'rgba(255,255,255,0.6)'); rect(g, X, Y + 1, 2, H - 1, '#143540');
    const step = (now / 140) | 0, n = Math.max(1, Math.floor(H - 2)), rola = (step / 6) | 0, COR = ['#7ddfb6', pal.glow, '#ffcf6b', '#8ab4ff', '#ff9eb0'];
    for (let i = 0; i < n; i++) {
      const hsh = hashStr(seed + ':' + (i + rola)), ind = hsh % 3, ult = i === n - 1;
      const full = 2 + ((hsh >>> 4) % Math.max(1, W - 7 - ind)), w = ult ? Math.max(U, rh(full * ((step % 6) + 1) / 6)) : full, yy = Y + 1.5 + i;
      rect(g, X + U, yy, 1, U, '#2c6272');
      rect(g, X + 3 + ind, yy, w, U, COR[(hsh >>> 9) % COR.length]);
      if (ult && (step & 1)) rect(g, X + 3 + ind + w + U, yy - U, U, 1, '#ffffff');
    }
  } else if (mode === 2) {                                   // três pontos pulsando
    const ph = ((now / 260) | 0) % 3;
    for (let i = 0; i < 3; i++) rect(g, cx - 4 + i * 3, cy - 1 - (i === ph ? U : 0), 2, 2, i === ph ? '#e3d9ff' : '#5b4a99');
  } else if (mode === 3) {                                   // pausa piscando
    rect(g, X, Y, W, 1, '#57441a');
    if (((now / 500) | 0) & 1) { rect(g, cx - 2, cy - 1.5, 1.5, 4, '#ffcf5a'); rect(g, cx + U, cy - 1.5, 1.5, 4, '#ffcf5a'); }
    else { rect(g, cx - 2, cy - 1.5, 1.5, 4, '#7a6224'); rect(g, cx + U, cy - 1.5, 1.5, 4, '#7a6224'); }
  } else {                                                   // descanso de tela: um quadradinho passeando
    const t = now / 900, px = rh((Math.sin(t) * 0.5 + 0.5) * (W - 3)), py = rh((Math.sin(t * 1.7 + 1) * 0.5 + 0.5) * (H - 3));
    rect(g, X + px, Y + py, 2.5, 2, '#3d5a8c'); rect(g, X + px, Y + py, 2.5, U, '#5f82bd');
  }
  rect(g, X, Y, U, U, 'rgba(255,255,255,0.3)');
}

// =====================================================================
// PEÇAS DA MESA
// =====================================================================
// monitor de frente: moldura (x,y,w,h), haste e base logo abaixo (mais 3 px). Devolve a área da tela [x,y,w,h]
function monitor(R, x, y, w, h) {
  R(x, y, w, h, '#232838'); R(x, y, w, U, '#4b556e'); R(x, y, U, h, '#353d52'); R(x + w - U, y, U, h, '#191d2a');
  R(x + 1, y + h - 1.5, w - 2, U, '#2e3548'); R(x + rh(w / 2) - U, y + h - 1, 1, U, '#58e08c');
  const nx = x + rh(w / 2) - 1.5;
  R(nx, y + h, 3, 2, '#3a4257'); R(nx, y + h, U, 2, '#58627c'); R(nx + 2.5, y + h, U, 2, '#2a3042');
  R(nx - 2, y + h + 2, 7, 1, '#3a4257'); R(nx - 2, y + h + 2, 7, U, '#5b6680');
  // tela apagada: vidro azul-escuro com reflexo em diagonal
  const sx = x + 1, sy = y + 1, sw = w - 2, sh = h - 3;
  R(sx, sy, sw, sh, '#172036'); R(sx, sy + rh(sh * 0.6), sw, sh - rh(sh * 0.6), '#131a2d');
  for (let i = 0; i < sh; i += U) { const dx = rh(sw * 0.3 - i * 0.6); if (dx >= 0 && dx + 2.5 <= sw) R(sx + dx, sy + i, 2.5, U, 'rgba(150,180,240,0.1)'); if (dx + 4 >= 0 && dx + 5 <= sw) R(sx + dx + 4, sy + i, 1, U, 'rgba(150,180,240,0.1)'); }
  R(sx, sy, sw, U, 'rgba(0,0,0,0.25)');
  return [sx, sy, sw, sh];
}
// gabinete 6 x 17, com lateral de vidro e ventoinhas acesas na cor da plataforma
function torre(R, x, y, pal) {
  R(x, y, 6, 17, '#232838'); R(x, y, 6, U, '#4b556e'); R(x, y, U, 17, '#353d52'); R(x + 5.5, y, U, 17, '#171b27');
  R(x + 1, y + 1.5, 4, 9.5, '#0f121a');
  R(x + 1.5, y + 2, 3, 3, pal.accent); R(x + 2, y + 2.5, 2, 2, pal.glow); R(x + 2.5, y + 3, 1, 1, '#ffffff');
  R(x + 1.5, y + 6.5, 3, 3, pal.dark); R(x + 2, y + 7, 2, 2, pal.accent); R(x + 2.5, y + 7.5, 1, 1, pal.glow);
  R(x + 1, y + 12, 4, U, '#3a4257'); R(x + 1, y + 13.5, 4, U, '#3a4257'); R(x + 1, y + 15, 1.5, U, '#58e08c'); R(x + 4, y + 15, 1, U, '#ff6b6b');
}
function teclado(R, x, y, pal) {                          // 14 x 5
  R(x, y, 14, 5, '#2b3144'); R(x, y, 14, U, '#4d5772'); R(x, y + 4.5, 14, U, '#1d2231');
  for (let r = 0; r < 3; r++) for (let i = 0; i < 12; i++) R(x + 1 + i, y + 1 + r, U, U, (i * 3 + r * 5) % 7 === 0 ? pal.glow : '#8d97b2');
  R(x + 4, y + 3, 5.5, U, '#b3bcd0');
}
function mouse(R, x, y) {                                  // mousepad 6 x 5,5 com o mouse
  R(x, y, 6, 5.5, '#566389'); R(x, y, 6, U, '#7684ab'); R(x, y + 5, 6, U, '#44507a');
  R(x + 2, y + 1.5, 2.5, 3, '#f1f3f8'); R(x + 2, y + 1.5, 2.5, U, '#ffffff'); R(x + 3, y + 2, U, 1, '#9aa3b8'); R(x + 2, y + 4, 2.5, U, '#c5cbd8');
}
function vasinho(R, x, y, h, c1 = '#3f9a58', c2 = '#6fd08a') {   // x,y = meio da boca do vaso
  for (const [dx, hh, c] of [[-2, h - 2.5, c1], [1.5, h - 3, c1], [-0.5, h, c2], [-1.5, h - 1, c2], [0.5, h - 1.5, c2]]) { R(x + dx, y - hh, 1, hh, c); R(x + dx + (dx < 0 ? 0 : U), y - hh - U, U, U, c); }
  R(x - 3, y - 3.5, 1, 2, c1); R(x + 2.5, y - 4.5, 1, 2, c1); R(x - 0.5, y - h + 1, U, h - 2, '#b6f0c0');
  R(x - 2.5, y, 5, 1, '#f58a50'); R(x - 2.5, y, 5, U, '#ffb382'); R(x - 2, y + 1, 4, 3, '#e37840'); R(x + 1, y + 1, 1, 3, '#c9622e'); R(x - 1.5, y + 4, 3, U, '#b55426');
}
function caneca(R, x, y, cor) {
  R(x, y, 3, 3.5, '#ffffff'); R(x + U, y, 2, U, '#7a4b2a'); R(x, y + 1.5, 3, 1, cor); R(x + 3, y + 1, U, 1.5, '#d5dae4'); R(x + 2.5, y + U, U, 3, '#e3e7ef');
}
function mochila(R, x, y, c) {                             // 9 x 13, em pé
  const d = dk(c, 0.28), l = lt(c, 0.3), e = '#2b3141';
  R(x + 3, y - 1.5, 3, 2, e); R(x + 3.5, y - 1, 2, 1, 'rgba(0,0,0,0)');
  R(x + 1, y, 7, 1, c); R(x + U, y + U, 8, 1, c); R(x, y + 1.5, 9, 11.5, c);
  R(x + 1, y, 7, U, l); R(x, y + 1.5, U, 11, l); R(x + 7.5, y + 1.5, 1.5, 11.5, d); R(x, y + 12, 9, 1, d);
  R(x + 1, y + 3.5, 7, U, d); R(x + 5, y + 3.5, 1, 1.5, '#d9dee8');                                     // zíper
  R(x + 1.5, y + 6.5, 6, 5, d); R(x + 2, y + 7, 5, 4, c); R(x + 2, y + 7, 5, U, l); R(x + 4, y + 8.5, 1, 1, '#f1e9d8');
  R(x + 1, y + 1.5, U, 2, e); R(x + 7.5, y + 1.5, U, 2, e);
}
function frigobar(R, x, y) {                               // 11 x 16, porta de vidro com latinhas
  R(x, y, 11, 16, '#f1f3f8'); R(x, y, 11, U, '#ffffff'); R(x + 9.5, y, 1.5, 16, '#d5dae5'); R(x, y, U, 16, '#fbfcfe');
  R(x + 1, y + 1, 5, U, '#c3cad6');
  R(x + 1, y + 2.5, 8, 12, '#8fc4ea'); R(x + 1, y + 2.5, 8, U, '#c9e8fb'); R(x + 1, y + 2.5, U, 12, '#c9e8fb');
  for (const sy of [6.5, 10.5]) R(x + 1.5, y + sy, 7.5, U, '#6aa6d4');
  for (const [cx, cy, c] of [[2, 4, '#e8556f'], [4, 4, '#ffd36b'], [6.5, 4, '#7ddfb6'], [2.5, 8, '#8ab4ff'], [5, 8, '#e8556f'], [3, 12, '#ffd36b'], [6, 12, '#7ddfb6']]) { R(x + cx, y + cy, 1.5, 2.5, c); R(x + cx, y + cy, 1.5, U, '#ffffff'); }
  R(x + 2, y + 3.5, U, 3, 'rgba(255,255,255,0.7)'); R(x + 9.5, y + 5, U, 4, '#8b94a7');
  R(x + 1, y + 16, 2.5, 1, '#6f798c'); R(x + 7.5, y + 16, 2.5, 1, '#6f798c');
}
function lixeira(R, x, y) {                                // 7 x 10
  R(x, y, 7, 1, '#b8c0ce'); R(x + U, y + 1, 6, 9, '#8f99ab'); R(x + U, y + 1, U, 9, '#aab3c2'); R(x + 5, y + 1, 1.5, 9, '#737d90');
  for (const dx of [2, 3.5]) R(x + dx, y + 2, U, 7, '#7d8799');
  R(x + 1.5, y - 1.5, 2.5, 2, '#ffffff'); R(x + 3.5, y - 1, 2, 1.5, '#e8ecf3');
}

// =====================================================================
// MESA
// =====================================================================
// Posto de 3 tiles de largura (as mesas ficam coladas, em bancada, como no Gather). Âncora = (x do 1º tile, linha da mesa);
// o tampo vai de x = -8 a 40 e de y = -7 a 9; quem senta fica no meio (x = 16), na frente da mesa.
// 'seed' varia o posto: 5 arranjos de monitores e mais os objetos soltos. s.scr = área da tela principal (animada por drawScreen).
export function sprDesk(pal, seed) {
  return sprite(`desk|${pal.cor}|${seed}`, () => {
    let scr = null;
    const s = makeSprite(-11, -27, 43, 28, (g, ax, ay) => {
      const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
      const P = (x0, y0, x1, y1, fn) => peca(g, ax, ay, x0, y0, x1, y1, fn);
      let h = seed;                                                   // embaralha o hash para postos vizinhos não saírem parecidos
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h = (h ^ (h >>> 16)) >>> 0;
      const rnd = mulberry32(h), pick = (a) => a[(rnd() * a.length) | 0];
      const v = (rnd() * 5) | 0, k2 = (rnd() * 6) | 0, fl = (rnd() * 6) | 0, fr = (rnd() * 6) | 0, under = (rnd() * 9) | 0;
      const MOCH = ['#6fbf73', '#6a8fe0', '#ef8f7a', '#f2c14e'];
      // embaixo da mesa, no chão (pintado antes do tampo)
      if (under === 2) P(-7, 6, 4, 26, (r) => frigobar(r, -7, 8));
      else if (under === 5) P(-6, 12, 1, 26, (r) => lixeira(r, -6, 14));
      // tampo branco, quina da frente, saia cinza-clara e pés
      R(-8, -7, 48, 16, '#f2f3f7'); R(-8, -7, 48, U, '#ffffff'); R(-8, -6.5, 48, U, '#fafbfd'); R(-8, 8, 48, 1, '#e0e4eb');
      R(-8, 9, 48, 5.5, '#cbd1dc'); R(-8, 9, 48, U, '#adb5c4'); R(-8, 14, 48, U, '#b3bac8');
      R(-8, 14.5, 1.5, 3, '#b7becb'); R(38.5, 14.5, 1.5, 3, '#a3abba');
      R(-8, -7, U, 16, '#d8dce5'); R(39.5, -7, U, 16, '#d8dce5');                                           // emendas da bancada
      R(31.5, 10.5, 5, 2.5, pal.accent); R(31.5, 10.5, 5, U, pal.glow); R(32.5, 11.5, 3, U, 'rgba(255,255,255,0.6)');   // plaquinha na cor da plataforma
      const sombra = (x, y, w) => R(x, y, w, U, 'rgba(60,56,90,0.16)');
      // arranjo dos monitores
      if (v === 0) {                                                                                      // gabinete, monitor grande e monitor em pé
        sombra(-6.5, -2.5, 6.5); P(-7, -20, 0, -2, (r) => torre(r, -6.5, -19.5, pal));
        sombra(11, -0.5, 8); P(3, -18, 25, 0, (r) => { scr = monitor(r, 3, -17.5, 22, 14); });
        sombra(30, -1.5, 8); P(28, -22, 38, -1, (r) => { const q = monitor(r, 28.5, -21.5, 9, 17); staticScreen(r, q[0], q[1], q[2], q[3], k2 === 0 ? 1 : k2 === 4 ? 5 : k2, pal, rnd); });
      } else if (v === 1) {                                                                               // dois monitores lado a lado
        sombra(2, -0.5, 8); P(-5, -17, 15, 0, (r) => { scr = monitor(r, -5, -16.5, 20, 13); });
        sombra(24, -0.5, 8); P(17, -17, 37, 0, (r) => { const q = monitor(r, 17, -16.5, 20, 13); staticScreen(r, q[0], q[1], q[2], q[3], k2, pal, rnd); });
        R(13.5, -15.5, 3, 3, '#ffe66b'); R(13.5, -15.5, 3, U, '#fff3a6'); R(14, -14, 2, U, '#d4b83c');   // post-it na moldura
      } else if (v === 2) {                                                                               // ultrawide e gabinete à direita
        sombra(9.5, 0.5, 8); P(-3, -16, 29, 1, (r) => { scr = monitor(r, -3, -15.5, 32, 12); });
        sombra(32.5, -2.5, 6.5); P(32, -20, 39, -2, (r) => torre(r, 32.5, -19.5, pal));
      } else if (v === 3) {                                                                               // notebook, monitor e luminária
        sombra(13, -0.5, 8); P(6, -18, 27, 0, (r) => { scr = monitor(r, 6, -17.5, 21, 14); });
        P(-7, -10, 5, 2, (r) => {
          r(-6.5, -9.5, 10, 7.5, '#3a4257'); r(-6.5, -9.5, 10, U, '#5b6680'); staticScreen(r, -5.5, -8.5, 8, 5.5, k2 === 0 ? 2 : k2, pal, rnd);
          r(-7, -2, 11, 3, '#c5cbd8'); r(-7, -2, 11, U, '#e6e9f0'); for (let i = 0; i < 9; i++) r(-6 + i, -1, U, U, '#8d97b2'); r(-3.5, 0, 4, U, '#aab3c5');
        });
        P(30, -17, 38, 0, (r) => { r(31.5, -1.5, 5, 1.5, '#454c5e'); r(31.5, -1.5, 5, U, '#6a748c'); r(33.5, -13, 1, 11.5, '#59617a'); r(30.5, -16, 7, 3, '#f2c14e'); r(30.5, -16, 7, U, '#ffe08a'); r(30.5, -13.5, 7, U, '#c99a2e'); });
        R(28.5, -12.5, 10, 9, 'rgba(255,230,150,0.14)');
      } else {                                                                                            // monitor, impressora e vasinho
        sombra(8, -0.5, 8); P(1, -18, 23, 0, (r) => { scr = monitor(r, 1, -17.5, 22, 14); });
        P(26, -13, 39, 1, (r) => {
          r(28.5, -12, 9, 4.5, '#ffffff'); r(29.5, -11, 6, U, '#b4bccb'); r(29.5, -10, 7, U, '#c9d0dc'); r(29.5, -9, 5, U, '#b4bccb');
          r(26.5, -8, 12.5, 8, '#eceff5'); r(26.5, -8, 12.5, U, '#ffffff'); r(37.5, -8, 1.5, 8, '#d3d9e4'); r(26.5, -0.5, 12.5, U, '#c5ccd9');
          r(28.5, -4.5, 8.5, 1, '#59617a'); r(28.5, -3.5, 8.5, 2, '#ffffff'); r(28.5, -2, 8.5, U, '#dfe4ee'); r(36, -7, 1, U, '#58e08c'); r(28, -7, 3, U, pal.accent);
        });
        P(-7, -13, 0, 2, (r) => vasinho(r, -3.5, -3.5, 9));
      }
      // teclado, mouse e objetos soltos na frente
      P(9, 2, 23, 8, (r) => teclado(r, 9, 2.5, pal));
      P(24, 1, 31, 8, (r) => mouse(r, 24.5, 2));
      if (fl === 0) P(0, 1, 5, 6, (r) => caneca(r, 1, 2, pal.accent));
      else if (fl === 1) P(-6, 1, 6, 8, (r) => { r(-5, 2, 6, 5, '#fff6c2'); r(-5, 2, 6, 1, '#f0d86a'); r(-4, 4, 4, U, '#cfbf6e'); r(-4, 5, 3, U, '#cfbf6e'); r(2, 3, U, 4, '#4a7fe0'); r(2, 2.5, U, U, '#2b3141'); });
      else if (fl === 2 && v !== 4) P(-7, -8, 0, 8, (r) => vasinho(r, -3, 2, 7, '#3a8f6a', '#63c79a'));
      else if (fl === 3) P(-6, 2, 4, 8, (r) => { r(-5, 3.5, 8, 3, '#3a4257'); r(-5.5, 4, 9, 2.5, '#3a4257'); r(-5, 3.5, 8, U, '#5b6680'); r(-4, 4.5, 1.5, U, '#aab3c5'); r(-3.5, 4, U, 1.5, '#aab3c5'); r(1, 4, 1, U, '#ff6b6b'); r(2, 5, 1, U, '#7ddfb6'); });   // controle de videogame
      else if (fl === 4) P(1, 2, 5, 8, (r) => { r(1.5, 2.5, 3, 5, '#1d2231'); r(2, 3, 2, 3.5, '#8ab4ff'); r(2, 3, 2, U, '#c5dbff'); });   // celular
      else P(-6, 0, 3, 8, (r) => { r(-5.5, 4.5, 8, 2, '#e8837f'); r(-5.5, 4.5, 8, U, '#f6b1ae'); r(-5, 2.5, 7, 2, '#7fa6e0'); r(-5, 2.5, 7, U, '#b3cdf2'); r(-4.5, 1, 6.5, 1.5, '#f2c14e'); r(-4.5, 1, 6.5, U, '#ffe08a'); });   // livros empilhados
      if (v !== 3) {
        if (fr === 1) P(33, 0, 37, 7, (r) => { r(33.5, 1, 2.5, 5, '#e8556f'); r(33.5, 1, 2.5, U, '#d9dee8'); r(33.5, 3, 2.5, 1, '#ffffff'); });        // latinha
        else if (fr === 2) P(32, 2, 38, 7, (r) => { r(32.5, 3, 3.5, 3.5, '#ffe66b'); r(32.5, 3, 3.5, U, '#fff3a6'); r(34.5, 2.5, 3.5, 3.5, '#ff9fb2'); r(34.5, 2.5, 3.5, U, '#ffc7d3'); });   // post-its
        else if (fr === 3) P(32, -1, 38, 7, (r) => { r(33.5, 0, 3, 2.5, '#ffd23f'); r(33, 2.5, 4.5, 3.5, '#ffd23f'); r(36.5, 1, 1, U, '#ff8a3a'); r(35.5, 0.5, U, U, '#2a2540'); r(33, 5, 4.5, 1, '#e8b53a'); });   // patinho de borracha
        else if (fr === 4) P(32, 0, 38, 7, (r) => caneca(r, 33.5, 2, '#6aa6ff'));
      }
      // no chão, do lado da cadeira
      if (under === 1) P(30, 9, 40, 25, (r) => mochila(r, 30.5, 11, pick(MOCH)));
      else if (under === 4) P(-8, 9, 2, 25, (r) => mochila(r, -7.5, 11, pick(MOCH)));
    }, OL);
    s.scr = scr || [4, -16.5, 20, 11];
    return s;
  });
}

// =====================================================================
// CADEIRA de escritório, vista de costas (como no Gather). Âncora = pés de quem senta.
// O assento e a base ficam atrás da pessoa; o encosto e os braços, na frente (cobrem o tronco de quem senta, menos os ombros).
// =====================================================================
export function sprChairSeat(pal) {
  return spr('chairS|' + pal.cor, -11, -7, 11, 10, (R, g, ax, ay) => {
    softShadow(g, ax, ay + 6.5, 9, 2);
    R(-6, -3, 12, 5, '#3a4158'); R(-6, -3, 12, U, '#56617f');                                            // assento
    R(-1, 2, 2, 3, '#232838'); R(-0.5, 2, U, 3, '#3d465c');                                              // haste
    R(-7, 5, 14, 1, '#2a3043'); R(-1, 5, 2, 2.5, '#2a3043'); R(-7, 5, 14, U, '#454e66');                 // estrela da base
    for (const x of [-8, -1, 6]) { R(x, 6, 2, 1.5, '#161a26'); R(x, 6, 2, U, '#3a4257'); }               // rodinhas
  });
}
export function sprChairBack(pal) {
  return spr('chairB|' + pal.cor, -11, -7, 11, 5, (R) => {
    for (const x of [-8.5, 6.5]) { R(x, -2.5, 2, 4, '#232838'); R(x, -2.5, 2, U, '#56617f'); R(x + U, 1, 1, 1.5, '#232838'); }   // braços
    R(-5.5, -5, 11, 7.5, '#2d3347'); R(-6.5, -4, 13, 6, '#2d3347'); R(-6, -4.5, 12, 7, '#2d3347');       // encosto arredondado
    R(-5, -4, 10, 5, '#394058'); R(-5, -4.5, 10, U, '#5a6585'); R(-5.5, -4, U, 4, '#454e69');
    R(-4, -2.5, 8, U, pal.accent); R(-4, -2, 8, U, pal.dark);                                            // vivo na cor da plataforma
    R(-4, 0, 8, U, '#2d3347'); R(4.5, -3.5, 1, 5, '#2a3043');
  });
}

// =====================================================================
// PLANTAS, LOUNGE E SAGUÃO
// =====================================================================
// folha lanceolada saindo de (x0,y0) (relativo à âncora); ang em graus (0 = para cima); sway = deslocamento da ponta.
function leaf(g, ax, ay, x0, y0, ang, len, wmax, sway, cols) {
  const a = (ang * Math.PI) / 180, sx = Math.sin(a), cy = Math.cos(a), sg = ang >= 0 ? 1 : -1, pts = [];
  for (let i = 0; i <= len; i += U) {
    const t = i / len;
    pts.push([rh(x0 + sx * i + sg * t * t * len * 0.22 + sway * t * t * 2), rh(y0 - cy * i + t * t * len * 0.16), Math.max(U, rh(wmax * Math.sin(Math.PI * Math.min(1, 0.22 + t * 0.8))))]);
  }
  for (const [x, y, w] of pts) rect(g, ax + x - rh(w / 2), ay + y - rh(w / 2), w, w, cols[0]);
  for (const [x, y, w] of pts) if (w >= 1) rect(g, ax + x - rh(w / 2), ay + y - rh(w / 2), w - U, w - U, cols[1]);
  for (const [x, y, w] of pts) if (w >= 2) rect(g, ax + x - rh(w / 2) + U, ay + y - rh(w / 2) + U, U, U, cols[2]);
}
// Planta de vaso de barro. Âncora = meio da base do tile. v = 0 folhas pontudas, 1 folhas largas; s = 0..2 (balanço das folhas)
export function sprPlant(v, s) {
  return spr(`plant|${v}|${s}`, -19, -45, 19, 4, (R, g, ax, ay) => {
    softShadow(g, ax, ay - 0.5, 9, 2);
    const G = v ? ['#2a7a4a', '#4fb36d', '#8fe0a0'] : ['#2b7545', '#47a862', '#86d58f'], sw = s - 1;
    const set = v
      ? [[-66, 11, 6], [66, 11, 6], [-44, 16, 7], [44, 16, 7], [-22, 21, 7], [22, 21, 7], [0, 25, 7]]
      : [[-54, 14, 4], [54, 14, 4], [-34, 20, 5], [34, 20, 5], [-14, 25, 5], [14, 25, 5], [0, 28, 5]];
    for (const [ang, len, wm] of set) leaf(g, ax, ay, rh(ang * 0.02), -11, ang, len, wm, sw, G);
    // vaso de barro com boca larga e terra
    R(-5.5, -12, 11, 1, '#4a3320');
    R(-6.5, -11.5, 13, 3, '#f58a50'); R(-6.5, -11.5, 13, U, '#ffb882'); R(-6.5, -9, 13, U, '#cd6a32'); R(4.5, -11.5, 2, 3, '#e07338');
    R(-5.5, -8.5, 11, 5, '#e8793e'); R(-5.5, -8.5, 1, 5, '#ff9a62'); R(2.5, -8.5, 3, 5, '#c85f2a');
    R(-5, -3.5, 10, 1.5, '#e8793e'); R(-5, -3.5, 1, 1.5, '#ff9a62'); R(2.5, -3.5, 2.5, 1.5, '#c85f2a');
    R(-4.5, -2, 9, 1.5, '#de7038'); R(2, -2, 2.5, 1.5, '#b85526'); R(-4.5, -1, 9, U, '#a94d22');
  });
}
// cafeteira de pé: painel, bico e caneca. Âncora = meio da base do tile
export function sprCoffee() {
  return spr('coffee', -12, -37, 12, 4, (R, g, ax, ay) => {
    softShadow(g, ax, ay - 0.5, 9, 2);
    R(-7.5, -31, 15, 31, '#7b87a3'); R(-7.5, -31, U, 31, '#9aa5be'); R(5.5, -31, 2, 31, '#606c88');
    R(-8, -33.5, 16, 3, '#d3dae8'); R(-8, -33.5, 16, U, '#f2f5fb'); R(-8, -31, 16, U, '#aab3c6');
    R(-5.5, -27.5, 11, 8.5, '#1b2133'); R(-5.5, -27.5, 11, U, '#363f58');
    R(-4.5, -26.5, 4, 2.5, '#4ade80'); R(-4.5, -26.5, 4, U, '#a5f3c0'); R(1, -26.5, 1.5, 1.5, '#ff6b5c'); R(3, -26.5, 1.5, 1.5, '#f5b94a'); R(-4.5, -22.5, 9, U, '#4a5470'); R(-4.5, -21, 6, U, '#4a5470');
    R(-5.5, -15, 11, 10, '#141926'); R(-5.5, -15, 11, U, '#363f58'); R(-1, -17.5, 2, 3.5, '#505a74'); R(-1.5, -14.5, 3, 1, '#3a4257');
    R(-2, -10.5, 4, 5, '#ffffff'); R(-2, -10.5, 4, U, '#8a5a36'); R(2, -9.5, 1, 3, '#dfe4ee'); R(-2, -6, 4, U, '#d5dae4');
    R(-6.5, -4, 13, 4, '#4a5470'); R(-6.5, -4, 13, U, '#6c7894'); for (let x = -5; x < 5; x += 1.5) R(x, -2.5, 1, U, '#2f384f');
  });
}
// Sofá visto de frente, 2 tiles. Âncora = canto de baixo à esquerda da linha do sofá.
export function sprSofa(v) {
  const C = v
    ? { back: '#e58f78', backT: '#f4ad98', arm: '#d6806a', armT: '#f6b9a5', cu: '#f09f88', cuT: '#f9bba9', cuS: '#dc8169', lip: '#b96651', pip: '#fcd0c2', pil: '#7fc4d8', pilT: '#a7dcec' }
    : { back: '#63bfae', backT: '#8bd6c8', arm: '#52ab9a', armT: '#84d3c3', cu: '#78cdbc', cuT: '#9ae0d3', cuS: '#58b3a2', lip: '#418a7c', pip: '#bdeee5', pil: '#f2a38c', pilT: '#fbc4b2' };
  return spr('sofa|' + v, -3, -25, 37, 6, (R) => {
    R(0, 1.5, 32, 2, 'rgba(50,42,72,0.18)');
    R(1.5, 0, 3, 2, '#6b5a4a'); R(27.5, 0, 3, 2, '#6b5a4a');
    R(0.5, -19, 31, 14, C.back); R(1.5, -19.5, 29, U, C.back); R(1, -19, 30, 1.5, C.backT); R(2, -18.5, 8, U, '#ffffff55');
    for (const x of [10.5, 21]) { R(x, -17, U, 11, C.cuS); R(x + U, -17, U, 11, C.backT); }
    R(1, -6, 30, 1, C.lip);
    R(4, -9.5, 24, 8.5, C.cu); R(4, -9.5, 24, 1, C.cuT); R(15.5, -9.5, 1, 8.5, C.cuS); R(4, -2, 24, 1, C.pip); R(4, -1, 24, 1.5, C.lip);
    for (const x of [0, 28]) { R(x, -14, 4, 14.5, C.arm); R(x + U, -14.5, 3, U, C.arm); R(x + U, -14, 3, 1.5, C.armT); }
    R(3.5, -12, U, 12, C.lip); R(28, -12, U, 12, C.lip);
    R(5, -14.5, 6, 6, C.pil); R(5.5, -15, 5, U, C.pil); R(5, -14.5, 6, 1, C.pilT); R(6, -13, 1, 3.5, C.pilT); R(5, -9, 6, U, C.cuS);
  });
}
// mesinha redonda do lounge, com caneca e livro
export function sprTable() {
  return spr('table', -13, -23, 13, 6, (R, g, ax, ay) => {
    softShadow(g, ax, ay + 0.5, 9, 2);
    R(-1, -9, 2, 8, '#c9a56c'); R(-1, -9, U, 8, '#e4c690'); R(-5.5, -2, 11, 2, '#bd9a62'); R(-5.5, -2, 11, U, '#dcc08c');
    blob(g, ax, ay - 11.5, 10.5, 4, '#5f93cf'); blob(g, ax, ay - 13, 10.5, 4, '#8ec1f2'); blob(g, ax - 3, ay - 14.5, 4.5, 1, '#c3e2fb');
    R(-6.5, -16, 4, 3.5, '#ffffff'); R(-6, -16, 3, U, '#8a5a36'); R(-2.5, -15, U, 1.5, '#dfe4ee'); R(-6.5, -13, 4, U, '#d5dae4');
    R(2, -14.5, 5.5, 3, '#ef8f7a'); R(2, -14.5, 5.5, U, '#f9b7a8'); R(2.5, -12, 4.5, U, '#ffffff');
  });
}
export function sprCooler() {
  return spr('cooler', -11, -43, 11, 4, (R, g, ax, ay) => {
    softShadow(g, ax, ay - 0.5, 8, 2);
    R(-6.5, -20.5, 13, 20.5, '#e9eef6'); R(-6.5, -20.5, 1, 20.5, '#ffffff'); R(4.5, -20.5, 2, 20.5, '#c3cddc'); R(-6.5, -20.5, 13, U, '#ffffff');
    R(-4.5, -38, 9, 17, '#8ecaf2'); R(-5, -37, 10, 15.5, '#8ecaf2'); R(-4.5, -38, 2, 17, '#c8e9fb'); R(3, -37, 2, 15.5, '#67aadc'); R(-3.5, -36, U, 6, '#f2faff');
    R(-5, -30, 10, U, '#a9d8f6'); R(-3, -40.5, 6, 2.5, '#c3cddc'); R(-3, -40.5, 6, U, '#e9eef6');
    R(-4.5, -17, 9, 5.5, '#a8b5c9'); R(-4.5, -17, 9, U, '#c5cfdf'); R(-3.5, -16, 2.5, 2.5, '#ef6f6f'); R(1, -16, 2.5, 2.5, '#6fa8ef'); R(-3.5, -16, 2.5, U, '#f7a3a3'); R(1, -16, 2.5, U, '#a8caf7');
    R(-3, -13.5, 1.5, 1.5, '#7d8aa0'); R(1.5, -13.5, 1.5, 1.5, '#7d8aa0');
    R(-5.5, -9.5, 11, 2, '#7d8aa0'); R(-5.5, -9.5, 11, U, '#9ba7bb'); R(-5.5, -1, 11, 1, '#c3cddc');
  });
}
// Estante de 2 tiles com livros, quadrinho e vasinho. Âncora = canto de baixo à esquerda.
export function sprBookshelf() {
  return spr('shelf', -3, -41, 37, 6, (R, g, ax, ay) => {
    const rnd = mulberry32(4242);
    R(0, 1.5, 32, 2, 'rgba(50,42,72,0.2)');
    R(0, -35, 32, 35, '#d9b983'); R(0, -35, 32, 1.5, '#f2dcae'); R(0, -35, U, 35, '#e9cf9c'); R(31, -35, 1, 35, '#b89560'); R(0, -1, 32, 1, '#b89560');
    R(2, -32.5, 28, 31, '#94713f');
    const cols = ['#e8837f', '#7fa6e0', '#a9cf7a', '#f2c14e', '#a78bd0', '#f1ecde', '#6fcad8', '#f0a584'];
    for (let sh = 0; sh < 3; sh++) {
      const bot = -32.5 + sh * 10.5 + 9.5;
      R(2, bot - 9.5, 28, 1, '#7d5d31');
      let x = 2.5;
      while (x < 28.5) {
        const w = 1.5 + ((rnd() * 3) | 0) * U, h = 5 + ((rnd() * 7) | 0) * U;
        if (sh === 0 && x > 17 && x < 25) { x += 2.5; continue; }
        if (sh === 2 && x > 6 && x < 13) { x += 2.5; continue; }
        const c = cols[(rnd() * cols.length) | 0];
        R(x, bot - h, w, h, c); R(x, bot - h, w, U, 'rgba(255,255,255,0.4)'); R(x + w - U, bot - h, U, h, 'rgba(40,30,60,0.22)'); if (w >= 2) R(x + U, bot - h + 1.5, w - 1, U, 'rgba(255,255,255,0.5)');
        x += w;
      }
      R(2, bot, 28, 1, '#caa56d'); R(2, bot, 28, U, '#e3c592');
    }
    R(19.5, -30, 6.5, 6, '#f1ecde'); R(20.5, -29, 4.5, 4, '#8fb6e6'); R(20.5, -27, 4.5, 2, '#6fb27c'); R(23, -28.5, 1, 1, '#fff1b8');   // quadrinho
    R(8, -5.5, 4.5, 3.5, '#e8793e'); R(8, -5.5, 4.5, U, '#ffb382'); blob(g, ax + 10, ay - 8, 2.5, 2.5, '#4fb36d'); R(9, -9.5, 1, 1, '#8fe0a0');   // vasinho
  });
}
// mancha de luz do sol que cai de cada janela no chão (desenhada com opacidade que oscila)
export function sprLight() {
  return sprite('light', () => makeSprite(0, 0, 70, 44, (g) => {
    for (const [w, a, ins] of [[30, 0.05, 0], [26, 0.055, 2], [20, 0.06, 5], [12, 0.06, 9]]) {
      g.fillStyle = `rgba(255,246,214,${a})`;
      for (let y = 0; y < 44; y += U) {
        const fade = 1 - y / 52, x0 = rh(y * 0.55 + ins * (1 - y / 90)), ww = Math.max(2, rh((w - y * 0.1) * fade + 4));
        g.fillRect(x0, y, ww, U);
      }
    }
  }));
}
