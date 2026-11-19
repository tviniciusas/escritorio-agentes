/* pessoa.js — o boneco: chibi de ~21 px lógicos (42 px de arte), cabeça grande, em vista reta (frente, costas e lado).
 *
 * Cada pose vira um canvas em cache. O desenho é feito só com retângulos de meio pixel e, no fim, ganha o
 * contorno automático (tom escuro da cor vizinha), como os avatares do Gather. As medidas de CORPO são as que
 * as animações (gags.js) usam para pôr suor, veia, chicote e balões no lugar certo.
 */
import { makeCanvas, softShadow, contorno, parseColor, mix, css, dk, lt, U } from './pixel.js';

// medidas do boneco (a partir dos pés)
export const CORPO = { altura: 20, sentado: 3, cabeca: -15, boca: -12, mao: -6 };

const SKINS = ['#f6d3b0', '#e8b98e', '#cf966a', '#9a6444', '#fbe2c8', '#74503a'];
const HAIRS = ['#2b1d14', '#4a2c17', '#7a4a22', '#c9a14a', '#1c1c24', '#a24a32', '#dcd4c4', '#4a3566', '#e58fb0', '#4fb3a8'];
const PANTS = ['#3c4a6b', '#4a4f60', '#6b5a48', '#33415c', '#5a4f7a', '#3f6050', '#4a6fa5', '#7b6a8a'];
const CAPS = ['#e0584a', '#3f83d0', '#3fa874', '#e8b53a', '#8a6bd6', '#efe8d8'];
const SHOES = ['#2c2433', '#f4f0e8', '#4a5a9a', '#d96a4a', '#2c2433'];
const BRANCO = '#f4efe6';

// cores e traços de uma pessoa, tudo sorteado pelo hash do id (mesmo id, mesma pessoa)
export function personColors(r) {
  const skin = SKINS[(r() * SKINS.length) | 0], hair = HAIRS[(r() * HAIRS.length) | 0], pants = PANTS[(r() * PANTS.length) | 0];
  const sk = parseColor(skin), cap = CAPS[(r() * CAPS.length) | 0], shoe = SHOES[(r() * SHOES.length) | 0];
  return {
    skin, skinS: css(mix(sk, [120, 52, 52], 0.24)), skinH: css(mix(sk, [255, 244, 226], 0.34)), skinO: css(mix(sk, [52, 24, 36], 0.62)),
    blush: css(mix(sk, [240, 110, 110], 0.45)),
    hair, hairS: dk(hair, 0.4), hairH: lt(hair, 0.34), hairO: dk(hair, 0.7),
    pants, pantsS: dk(pants, 0.3), pantsO: dk(pants, 0.66),
    shoe, shoeH: lt(shoe, 0.3), shoeD: dk(shoe, 0.3), shoeO: dk(shoe, 0.7), iris: '#2a2540',
    cap, capD: dk(cap, 0.35), capL: lt(cap, 0.3), capO: dk(cap, 0.7),
    style: (r() * 8) | 0, outfit: (r() * 4) | 0, glasses: r() < 0.22, beard: r() < 0.18, badge: r() < 0.35, stripe: r() < 0.3,
  };
}

// ---------- cabelos: listas de [x, y, w, h, cor] a partir do topo da cabeça (cor: 0 cabelo, 1 sombra, 2 luz, 3 boné, 4 boné escuro, 5 boné claro)
const DOME = [[-3.5, -1.5, 7, U], [-4.5, -1, 9, U], [-5, -0.5, 10, U], [-5.5, 0, 11, 1], [-6, 1, 12, 1.5]];
const LUZ = [[-3, -1, 3.5, U, 2], [-4.5, -0.5, 1, U, 2], [-5.5, 0.5, U, 1, 2]];
const COSTAS = [[-3.5, -1.5, 7, U], [-4.5, -1, 9, U], [-5, -0.5, 10, U], [-5.5, 0, 11, 1], [-6, 1, 12, 5.5], [-5.5, 6.5, 11, U], [-5, 7, 10, U], [-4, 7.5, 8, U]];
const MECHAS = [[-5.5, 6, 11, U, 1], [-5, 6.5, 10, U, 1], [-4.5, 7, 9, U, 1], [-4, 7.5, 8, U, 1], [-2, 4.5, U, 2, 1], [1.5, 5, U, 1.5, 1], [-3, -1, 4, U, 2], [-4.5, -0.5, 1.5, U, 2], [-5.5, 1, U, 1.5, 2], [2, 0.5, 2, U, 2]];
const LADO = [[-3.5, -1.5, 7.5, U], [-4.5, -1, 9, U], [-5, -0.5, 10, U], [-5.5, 0, 10.5, 1], [-6, 1, 11, 1.5]];
const LUZ_L = [[-3, -1, 3.5, U, 2], [-4.5, -0.5, 1, U, 2]];
const CURTO_L = [...LADO, [-6, 2.5, 4.5, 4.5], [-5.5, 7, 3.5, U], [-5, 7.5, 2.5, U], [1.5, 2.5, 4, 1], [-1.5, 2.5, 1.5, 2.5], [-6, 6, 4.5, 1, 1], [-5.5, 7, 3.5, U, 1], ...LUZ_L];
const CACHOS = [[-5, -3, 1, U, 2], [-2, -3.5, 1, U, 2], [2, -3, 1, U, 2], [4.5, -2, 1, U, 2], [-6, -1, 1, U, 2], [0, -1.5, 1, U, 2], [-3, -0.5, 1, U, 2], [3, 0, 1, U, 2],
  [-4, -2, 1, U, 1], [1, -2.5, 1, U, 1], [-1, 0.5, 1, U, 1], [5, -0.5, 1, U, 1]];
const AFRO = [[-4.5, -4.5, 9, U], [-5.5, -4, 11, U], [-6.5, -3.5, 13, 1], [-7, -2.5, 14, 1]];
const COQUE = [[-2, -4.5, 4, U], [-2.5, -4, 5, 2.5], [-2, -1.5, 4, U], [-1.5, -4, 1.5, U, 2]];
const ESPETOS = [[-4.5, -2, 1.5, 1], [-4, -2.5, 1, U], [-2, -2.5, 2, 1], [-1.5, -3.5, 1, 1], [1, -2, 2, U], [1.5, -3, 1, 1], [3.5, -1.5, 1.5, U], [4, -2, U, U]];
const BONE = [[-3.5, -1.5, 7, U, 3], [-4.5, -1, 9, U, 3], [-5, -0.5, 10, U, 3], [-5.5, 0, 11, 1, 3], [-6, 1, 12, 1, 3], [-3.5, -1, 3, U, 5], [-4.5, -0.5, 1, U, 5]];

const CABELO_F = [   // de frente
  [...DOME, [-6, 2.5, 5, 1], [-6, 3.5, 2.5, U], [-6, 2.5, 1, 3.5], [5, 2.5, 1, 2.5], [1, 2, 5, U, 1], ...LUZ],                                             // 0 curto, franja de lado
  [[-7, 1, 2.5, 10.5], [4.5, 1, 2.5, 10.5], [-6.5, 11.5, 1.5, U], [5, 11.5, 1.5, U], ...DOME, [-6, 2.5, 3.5, 1], [2.5, 2.5, 3.5, 1],
    [-7, 10.5, 2.5, 1, 1], [4.5, 10.5, 2.5, 1, 1], [-5, 3.5, U, 7, 1], [4.5, 3.5, U, 7, 1], ...LUZ],                                                    // 1 comprido
  [[-3.5, -0.5, 7, U, 1], [-4.5, 0, 9, U, 1], [-5, 0.5, 10, U, 1], [-5.5, 1, 11, 1.5, 1], [-5.5, 2.5, 1, 1.5, 1], [4.5, 2.5, 1, 1.5, 1], [-3, 0, 3, U, 0]],   // 2 raspado
  [...COQUE, ...DOME, [-2, -1.5, 4, U, 1], [-6, 2.5, 4, 1], [3, 2.5, 3, U], [-6, 2.5, 1, 3], [5, 2.5, 1, 3], ...LUZ],                                     // 3 coque
  [...AFRO, [-7.5, -1.5, 15, 4], [-7.5, 2.5, 3, 3], [4.5, 2.5, 3, 3], [-7, 5.5, 2, 1], [5, 5.5, 2, 1], ...CACHOS, [-6.5, 2, 1, U, 1], [5.5, 1.5, 1, U, 2], [-4.5, 2, 9, U, 1]],   // 4 black power
  [[-6, 3, 1, 3], [5, 3, 1, 3], ...BONE, [-6.5, 2, 13, 1, 4], [-6.5, 2, 13, U, 5], [-0.5, -2, 1, U, 4]],                                                  // 5 boné
  [...DOME, ...ESPETOS, [-5, 2.5, 1.5, 1.5], [-2.5, 2.5, 1.5, 1], [0, 2.5, 1.5, 1.5], [2.5, 2.5, 1.5, 1], [-6, 2.5, 1, 2.5], [5, 2.5, 1, 2.5], ...LUZ],   // 6 espetado
  [[-7, 1, 2.5, 7], [4.5, 1, 2.5, 7], [-6.5, 8, 2, U], [4.5, 8, 2, U], ...DOME, [-5.5, 2.5, 11, 1], [-7, 7.5, 2.5, U, 1], [4.5, 7.5, 2.5, U, 1], [-4.5, 3.5, 9, U, 1], ...LUZ],   // 7 chanel com franja
];
const CABELO_C = [   // de costas
  [...COSTAS, ...MECHAS],
  [...COSTAS, [-7, 1, 14, 10.5], [-6.5, 11.5, 13, U], [-5.5, 12, 11, U], [-3.5, 3, U, 8, 1], [0, 2, U, 9.5, 1], [3, 3, U, 8, 1], [-7, 10.5, 14, 1, 1], [-6.5, 11.5, 13, U, 1], [-5.5, 12, 11, U, 1],
    [-3, -1, 4, U, 2], [-4.5, -0.5, 1.5, U, 2], [-6, 2, U, 3, 2]],
  [[-3.5, -0.5, 7, U, 1], [-4.5, 0, 9, U, 1], [-5, 0.5, 10, U, 1], [-5.5, 1, 11, 4.5, 1], [-5, 5.5, 10, U, 1], [-4.5, 6, 9, U, 1], [-3, 0, 3, U, 0]],
  [...COQUE, ...COSTAS, [-2, -1.5, 4, U, 1], ...MECHAS],
  [...AFRO, [-7.5, -1.5, 15, 8], [-7, 6.5, 14, 1], [-6, 7.5, 12, U], ...CACHOS, [-5, 3, 1, U, 2], [2, 4, 1, U, 2], [-2, 5, 1, U, 1], [4.5, 3, 1, U, 1], [-7, 6.5, 14, 1, 1], [-6, 7.5, 12, U, 1]],
  [[-6, 3.5, 12, 3], [-5.5, 6.5, 11, U], [-5, 7, 10, U], [-4, 7.5, 8, U], [-5.5, 6, 11, U, 1], [-5, 6.5, 10, U, 1], [-4.5, 7, 9, U, 1], ...BONE, [-6, 2, 12, 1.5, 3], [-6, 3, 12, U, 4], [-1.5, 1.5, 3, 1.5, 0], [-1.5, 1.5, 3, U, 4]],
  [...COSTAS, ...ESPETOS, ...MECHAS],
  [...COSTAS, [-7, 1, 14, 6.5], [-7, 7.5, 14, U, 1], [-3, 2.5, U, 5, 1], [2.5, 2.5, U, 5, 1], [-3, -1, 4, U, 2], [-4.5, -0.5, 1.5, U, 2], [-6, 2, U, 3, 2]],
];
const CABELO_L = [   // de lado, olhando para a direita
  CURTO_L,
  [[-7, 1, 5.5, 10.5], [-6.5, 11.5, 4.5, U], ...LADO, [2, 2.5, 3.5, 1], [-7, 10.5, 5.5, 1, 1], [-4, 3, U, 8, 1], ...LUZ_L],
  [[-3.5, -0.5, 7.5, U, 1], [-4.5, 0, 9, U, 1], [-5.5, 0.5, 10.5, 2, 1], [-5.5, 2.5, 3.5, 3, 1], [-3, 0, 3, U, 0]],
  [[-6.5, -4, 4.5, U], [-7, -3.5, 5.5, 2.5], [-6.5, -1, 4.5, U], [-6, -3.5, 1.5, U, 2], ...CURTO_L],
  [...AFRO, [-7.5, -1.5, 14, 4], [-7.5, 2.5, 6, 4.5], [-7, 7, 4.5, 1], ...CACHOS, [-5.5, 4, 1, U, 2], [-3.5, 5.5, 1, U, 1], [-7, 7, 4.5, 1, 1]],
  [[-6, 2.5, 4, 4.5], [-5.5, 7, 3, U], [-6, 6, 4, 1, 1], [-3.5, -1.5, 7.5, U, 3], [-4.5, -1, 9, U, 3], [-5, -0.5, 10, U, 3], [-5.5, 0, 10.5, 1, 3], [-6, 1, 11, 1, 3], [3, 2, 5.5, 1, 4], [3, 2, 5.5, U, 5], [-3.5, -1, 3, U, 5]],
  [...CURTO_L, [-4, -2.5, 1.5, 1], [-1.5, -3.5, 1.5, 2], [1.5, -2.5, 1.5, 1], [3.5, -2, 1, U], [4, 2.5, 1.5, 1.5]],
  [[-7, 1, 6, 6.5], [-7, 7.5, 6, U, 1], ...LADO, [1, 2.5, 4.5, 1], ...LUZ_L],
];
const SEM_ORELHA = new Set([1, 4, 7]);   // cabelos que cobrem as orelhas

// o = { pose, dir:0 frente|1 direita|2 costas|3 esquerda, frame:0..3, bob:0|-1, blink:0|1, cup, semSombra }
//   poses: stand, walk, sitD (sentado à mesa, de costas, digitando: frame alterna as mãos), sitS (sentado no sofá, de frente),
//   play (de costas, mãos no controle do fliperama), arm (de lado com o braço erguido: frame 0 atrás da cabeça, 1 esticado
//   à frente), yay (de frente, braços para cima). stand de frente com frame 1 e caneca = golinho de café.
// Devolve um canvas de 32x42 px lógicos com os pés em (16,37). Sentado, tudo desce CORPO.sentado.
export function buildPerson(a, o) {
  const [cv, g] = makeCanvas(32, 42);
  const mir = o.dir === 3;
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(16 + (mir ? -x - w : x), 37 + y, w, h); };
  const cl = a.cl, pal = a.pal, pose = o.pose, f = o.frame, walk = pose === 'walk';
  const side = o.dir === 1 || o.dir === 3, back = o.dir === 2;
  const sit = pose === 'sitD' || pose === 'sitS';
  const by = walk ? (f & 1 ? -U : 0) : (sit || !o.bob ? 0 : -U);
  const y0 = (sit ? CORPO.sentado : 0) + by, ty = -11 + y0, hy = -19.5 + y0;
  const st = cl.style % 8, of = cl.outfit, manga = of === 0 || of === 3;      // manga curta: antebraço de pele
  const S = pal.shirt, SD = pal.shirtD, SL = pal.shirtL, K = cl.skin, KS = cl.skinS;
  const gole = pose === 'stand' && f === 1 && o.cup && !side && !back;        // levando a caneca à boca
  const COR = [cl.hair, cl.hairS, cl.hairH, cl.cap, cl.capD, cl.capL];
  const cab = (lista) => { for (const [x, y, w, h, k] of lista) R(x, hy + y, w, h, COR[k || 0]); };
  const sapato = (x, y, w = 3) => { R(x, y, w, 1.5, cl.shoe); R(x, y, w, U, cl.shoeH); };
  const caneca = (x, y) => { R(x, y, 3, 3, BRANCO); R(x, y, 3, U, '#ffffff'); R(x + U, y + U, 2, U, '#7a4b2a'); R(x + 3, y + 1, U, 1.5, '#cfc6b6'); R(x, y + 2.5, 3, U, '#d6cdbd'); };
  // braço para baixo: manga, antebraço (pele, se a manga é curta) e mão
  const braco = (x, y, len = 4.5) => {
    R(x, y, 2, len, S); R(x, y, 2, U, SL);
    if (manga) { R(x, y + 2, 2, len - 2, K); R(x, y + 2, 2, U, SD); }
    R(x, y + len, 2, 1.5, K);
    R(x < 0 ? x + 1.5 : x, y + U, U, manga ? 1.5 : len - U, SD);              // dobra junto do tronco
  };

  // ---- pernas e sapatos ----
  if (pose === 'sitS') {
    R(-3, -2.5, 2.5, 2.5, cl.pants); R(0.5, -2.5, 2.5, 2.5, cl.pants); R(-3, -2.5, 6, U, cl.pantsS);
    sapato(-3.5, 0); sapato(0.5, 0);
  } else if (!sit) {
    if (side) {
      const l = walk ? [1.5, 0, -1.5, 0][f] : 0;
      R(-1.5 - l, -5, 2.5, 3.5, cl.pantsS); R(-1.5 - l, -1.5, 3.5, 1.5, cl.shoeD);
      R(-1 + l, -5, 2.5, 3.5, cl.pants); sapato(-1 + l, -1.5, 3.5);
    } else {
      const eL = walk && f === 2 ? 1 : 0, eR = walk && f === 0 ? 1 : 0;
      R(-3, -5, 2.5, 3.5 - eL, cl.pants); R(-1, -5, U, 3.5 - eL, cl.pantsS); sapato(-3.5, -1.5 - eL);
      R(0.5, -5, 2.5, 3.5 - eR, cl.pants); R(2.5, -5, U, 3.5 - eR, cl.pantsS); sapato(0.5, -1.5 - eR);
    }
  }

  // ---- tronco, roupa e braços ----
  if (side) {
    R(-2.5, ty + U, 5.5, 6, S); R(-2, ty, 4.5, U, S);
    R(-2.5, ty + U, 1, 6, SD); R(-2.5, ty + 6, 5.5, U, SD);
    if (of === 1) R(2, ty + U, 1, 5, BRANCO);
    if (of === 2) R(-3, ty, 2, 2, SD);                                         // capuz
    if (cl.tie) R(2.5, ty + 1, U, 3.5, cl.tie);
    if (pose !== 'arm') {
      const sw = walk ? [-1.5, 0, 1.5, 0][f] : 0;
      R(-1 + sw, ty + 1, 2, 4.5, SL); R(-1.5 + sw, ty + 1, U, 4, SD); R(1 + sw, ty + 1.5, U, 3.5, SD);
      if (manga) R(-1 + sw, ty + 3, 2, 2.5, K);
      R(-1 + sw, ty + 5.5, 2, 1.5, K);
      if (o.cup) caneca(1.5 + sw, ty + 3.5);
    }
  } else {
    R(-4, ty + U, 8, 6, S); R(-3.5, ty, 7, U, S);
    R(3, ty + U, 1, 6, SD); R(-4, ty + 6, 8, U, SD); R(-4, ty + U, U, 3, SL); R(-3.5, ty, 2.5, U, SL);
    if (!back) {
      if (of === 0) { R(-1.5, ty, 3, 1, K); R(-1, ty + 1, 2, U, K); if (cl.stripe) { R(-4, ty + 2.5, 7, 1, SL); R(-4, ty + 4.5, 7, U, SL); } }
      else if (of === 1) { R(-1.5, ty, 3, 6.5, BRANCO); R(-2, ty, U, 3.5, SD); R(1.5, ty, U, 3.5, SD); R(-1.5, ty + 3.5, U, 3, SD); R(1, ty + 3.5, U, 3, SD); R(-0.5, ty + 2, 1, U, '#c9c2b4'); R(-0.5, ty + 4, 1, U, '#c9c2b4'); }
      else if (of === 2) { R(-3, ty, 6, 1, SD); R(-1.5, ty, 3, U, K); R(-1.5, ty + 1, U, 2, '#ffffff'); R(1, ty + 1, U, 2, '#ffffff'); R(-2.5, ty + 4, 5, U, SD); R(-2.5, ty + 4, U, 2, SD); R(2, ty + 4, U, 2, SD); }
      else { R(-1.5, ty, 3, 1, K); R(-2.5, ty + 2, 5, 3, BRANCO); R(-2.5, ty + 2, 5, U, '#ffffff'); R(-1.5, ty + 3, 3, 1, pal.accent); R(-0.5, ty + 3, 1, 1, pal.glow); }
      if (cl.badge && of !== 3 && !cl.tie) { R(1, ty + U, U, 2.5, '#2c3342'); R(0.5, ty + 3, 2, 2.5, '#ffffff'); R(0.5, ty + 3, 2, 1, pal.accent); }
      if (cl.tie) { R(-0.5, ty, 1, 1, dk(cl.tie, 0.3)); R(-0.5, ty + 1, 1, 4, cl.tie); R(-1, ty + 4, 2, 1, cl.tie); }
    } else if (of === 2) { R(-3, ty - U, 6, 2.5, SD); R(-2.5, ty, 5, 1.5, S); }   // capuz nas costas
    else R(-2, ty, 4, U, SD);                                                   // gola
    if (pose === 'sitD') {                              // de costas, mãos subindo até o teclado
      const u = f & 1;
      R(-6.5, ty + 1, 2.5, 3, S); R(4, ty + 1, 2.5, 3, S); R(-6.5, ty + 1, 2.5, U, SL);
      R(-8, ty - 2 + u, 2, 5, manga ? K : S); R(-8, ty - 3.5 + u, 2, 1.5, K); R(-6.5, ty + 1, U, 2, SD);
      R(6, ty - 1 - u, 2, 4, manga ? K : S); R(6, ty - 2.5 - u, 2, 1.5, K); R(6, ty + 1, U, 2, SD);
    } else if (pose === 'yay') {
      for (const x of [-7, 5]) { R(x, ty - 6, 2, 8, S); if (manga) R(x, ty - 6, 2, 4, K); R(x, ty - 8, 2, 2, K); R(x === -7 ? x + 1.5 : x, ty - 1, U, 3, SD); }
    } else if (pose === 'play') {
      const u = f & 1;
      R(-6, ty + 1 + u, 2, 3.5, S); R(4, ty + u, 2, 3.5, S); R(-6, ty + 1 + u, 2, U, SL);
    } else {
      const aL = walk ? [1, 0, -1, 0][f] : 0;
      braco(-6, ty + U + aL);
      if (gole) { R(4, ty + U, 2, 2.5, S); R(4, ty + U, 2, U, SL); }
      else { braco(4, ty + U - aL); if (o.cup) caneca(4.5, ty + 3); }
    }
  }

  // ---- cabeça ----
  if (side) { R(-3.5, hy, 8, 9, K); R(-4.5, hy + U, 9.5, 8, K); R(-5, hy + 1, 10.5, 6.5, K); R(-5.5, hy + 2, 1, 4, K); R(5.5, hy + 5, U, 1, K); R(-3.5, hy + 8.5, 8, U, KS); }
  else {
    R(-4, hy, 8, 9, K); R(-4.5, hy + U, 9, 8, K); R(-5, hy + 1, 10, 7, K); R(-5.5, hy + 1.5, 11, 5.5, K);
    if (!SEM_ORELHA.has(st)) { R(-6, hy + 4, U, 2, K); R(5.5, hy + 4, U, 2, K); }
    if (!back) { R(5, hy + 2, U, 5, KS); R(4.5, hy + 7, U, 1, KS); R(-4, hy + 8.5, 8, U, KS); }
  }
  // ---- cabelo ----
  cab((side ? CABELO_L : back ? CABELO_C : CABELO_F)[st]);
  if (side) R(-1, hy + 4.5, 1.5, 2, KS);                                        // orelha
  if (back && st !== 1 && st !== 4 && st !== 7) R(-2.5, hy + 8.5, 5, U, KS);    // nuca

  // ---- rosto ----
  const fr = '#3d4259', iris = cl.iris;
  if (side) {
    if (o.blink) R(2.5, hy + 5, 1.5, U, iris); else { R(2.5, hy + 4, 1, 2, iris); R(2.5, hy + 4, U, U, '#ffffff'); }
    R(1, hy + 6, 1.5, U, cl.blush);
    if (cl.beard) { R(-0.5, hy + 6.5, 5.5, 2.5, cl.hairS); R(-1.5, hy + 5, 1.5, 3, cl.hairS); }
    R(3.5, hy + 7, 1.5, U, cl.beard ? '#6a3a3a' : '#b25a58');
    if (cl.glasses) { R(1.5, hy + 3.5, 3.5, U, fr); R(1.5, hy + 6, 3.5, U, fr); R(1.5, hy + 3.5, U, 3, fr); R(4.5, hy + 3.5, U, 3, fr); R(-1.5, hy + 4.5, 3, U, fr); }
    if (cl.bigode) R(2.5, hy + 6, 3, 1, cl.hairO);
    if (cl.bravo) { R(1.5, hy + 2.5, 2.5, U, cl.hairO); R(3, hy + 3, 1.5, U, cl.hairO); }
  } else if (!back) {
    if (o.blink) { R(-3.5, hy + 5, 1.5, U, iris); R(2, hy + 5, 1.5, U, iris); }
    else { R(-3, hy + 4, 1, 2, iris); R(2, hy + 4, 1, 2, iris); R(-3, hy + 4, U, U, '#ffffff'); R(2, hy + 4, U, U, '#ffffff'); }
    if (!cl.glasses) { R(-4.5, hy + 6, 1.5, U, cl.blush); R(3, hy + 6, 1.5, U, cl.blush); }
    if (cl.beard) { R(-4.5, hy + 6.5, 9, 2.5, cl.hairS); R(-5.5, hy + 5, 1, 3, cl.hairS); R(4.5, hy + 5, 1, 3, cl.hairS); }
    if (pose === 'yay') R(-1, hy + 6.5, 2, 1.5, '#8a3040'); else R(-1, hy + 7, 2, U, cl.beard ? '#6a3a3a' : '#b25a58');
    if (cl.glasses) {
      for (const x of [-4.5, 1.5]) { R(x + U, hy + 4, 2, 2, 'rgba(200,230,255,0.3)'); R(x, hy + 3.5, 3, U, fr); R(x, hy + 6, 3, U, fr); R(x, hy + 3.5, U, 3, fr); R(x + 2.5, hy + 3.5, U, 3, fr); }
      R(-1.5, hy + 4.5, 3, U, fr); R(-5.5, hy + 4.5, 1, U, fr); R(4.5, hy + 4.5, 1, U, fr);
    }
    if (cl.bigode) R(-2.5, hy + 6, 5, 1, cl.hairO);
    if (cl.bravo) { R(-4, hy + 2.5, 2, U, cl.hairO); R(-2.5, hy + 3, 1.5, U, cl.hairO); R(2, hy + 2.5, 2, U, cl.hairO); R(1, hy + 3, 1.5, U, cl.hairO); }
  }
  if (a.headset) {                                                              // modelos chamados usam fone
    const hs = '#2b2f3a';
    if (side) { R(-4.5, hy - 2, 8, 1, hs); R(-2.5, hy + 3, 2.5, 3.5, pal.accent); R(-2.5, hy + 3, 2.5, U, pal.glow); R(1.5, hy + 7.5, 3, U, hs); }
    else {
      R(-5.5, hy - 2, 11, 1, hs); R(-6.5, hy - 1.5, 1, 4.5, hs);  R(5.5, hy - 1.5, 1, 4.5, hs);
      for (const x of [-7, 5.5]) { R(x, hy + 3, 1.5, 3.5, pal.accent); R(x, hy + 3, 1.5, U, pal.glow); }
      if (!back) R(2.5, hy + 7.5, 3, U, hs);
    }
  }
  // ---- por cima da cabeça: caneca na boca e braço erguido ----
  if (gole) { R(2.5, ty - 1.5, 2, 2, K); caneca(-1.5, hy + 5.5); }
  if (pose === 'arm') {
    if (f === 0) { R(-3.5, ty - 2, 2, 3.5, SL); R(-5.5, ty - 5, 2, 3.5, SL); R(-6.5, ty - 7, 2, 2, K); }
    else { R(0.5, ty + 1, 4, 2, SL); R(0.5, ty + 3, 4, U, SD); R(4.5, ty + 1, 2, 2, K); }
  }

  contorno(cv, 0.68);
  if (!o.semSombra) { g.globalCompositeOperation = 'destination-over'; softShadow(g, 16, 36.5, 6, 2); g.globalCompositeOperation = 'source-over'; }
  return cv;
}
