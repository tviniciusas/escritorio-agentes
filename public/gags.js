/* gags.js — animações de situação: o que a sala faz quando algo acontece com os agentes.
 *
 *  - Fliperama: o agente principal que só está esperando os subagentes vai jogar luta no fliperama do
 *    saguão (ao lado do elevador). Quando volta a trabalhar, volta para a mesa.
 *  - Chicote: quem abre um subagente (ou chama o DeepSeek ou a Alibaba) vai até a mesa dele e estala o
 *    chicote três vezes. O novato pula a cada estalo.
 *  - Bronca: quando uma ferramenta dá erro, o chefe de quem errou (o agente que o chamou) vem reclamar,
 *    de punho erguido. O agente principal não tem chefe na sala, então o Chefe sobe pelo elevador.
 *  - Susto: o usuário interrompeu ou recusou uma ferramenta.
 *  - Tonto: o contexto foi compactado (estrelinhas girando e "quem sou eu?").
 *  - Comemoração: o subagente terminou; pula com os braços para cima e solta confete antes de ir embora.
 *  - Mão levantada: o agente espera a resposta de uma pergunta ao usuário (AskUserQuestion, telegram ask).
 *  - Pausa (quem fica ocioso): espreguiça na mesa; a caminho do lounge, passa na cafeteira e serve um café;
 *    em pé, toma golinhos (com vapor) ou fica no celular rindo; dois em pé, lado a lado, batem papo; no
 *    sofá, tira uma soneca (deita com cobertor se o outro lugar estiver livre) com bolha no nariz e "zz".
 *  - Bug: todo erro solta um bichinho do monitor, que sai correndo pelo chão.
 *  - Teclado pegando fogo: muitas ferramentas seguidas em pouco tempo (8 em 40 s).
 *  - Cochilo no build: a mesma ferramenta rodando há mais de 90 s (build, testes, deploy): cabeça baixa e "zz".
 *
 * Os gatilhos são os campos erroEm, interrompidoEm e compactadoEm do estado (CONTRATO.md) e as mudanças de
 * estado. Nada aqui muda o estado: só a cena. Quem está numa animação tem `a.gag` (quem age) ou `a.reac`
 * (quem reage); `a.preso` segura o alvo na mesa até a animação acabar.
 */
import { DOOR_X, cached, textW, Actor, FONT_STACK } from './render.js';
import { T, U, rect, blob, makeSprite, sprite, makeCanvas, rawCanvas, put, putS, platPal, dk, lt, hashStr } from './pixel.js';
import { buildPerson, CORPO } from './pessoa.js';
import { OL } from './moveis.js';

const CD = { chicote: 15000, bronca: 45000, susto: 6000, tonto: 15000, espreguica: 30000 };   // intervalo mínimo entre duas iguais no mesmo agente
const RECENTE = 30000;                 // evento mais velho que isso (quando o estado chegou atrasado) não anima
const ARCADE_ESPERA = 1800;            // ms esperando os subagentes antes de ir ao fliperama
const COM_CHICOTE = new Set(['deepseek', 'alibaba']);
const PERGUNTA = /^AskUserQuestion$|·ask$/;
const DUR = { chicote: 2600, bronca: 4200, susto: 2200, tonto: 5000, comemora: 2600, apanha: 3000, levaBronca: 4200, espreguica: 1700 };
const CAFE_MS = 3200;                  // servindo o café na cafeteira
const SONECA_SOFA = 6000;              // ms sentado no sofá até cochilar
const SONECA_EM_PE = 45000;            // ms em pé no lounge até cochilar ali mesmo
const PAPO = [['E o deploy?', 'Subiu liso'], ['Quem quebrou o build?', 'Não fui eu!'], ['Café tá fraco hoje', 'Reclama com o Chefe'],
  ['Viu o PR novo?', '2 mil linhas…'], ['Bora almoçar?', 'Só depois do merge'], ['Já leu o README?', 'Tem README?'], ['Sexta tem deploy?', 'Nem pensar']];
const COBERTOR = ['#8ec1f2', '#f2a38c', '#a9cf7a', '#c9b3f0', '#f2d06b'];
const FOGO_JANELA = 40000, FOGO_TROCAS = 8, FOGO_MS = 7000;   // ferramentas seguidas que põem fogo no teclado
const BUILD_LONGO = 90000;             // ms na mesma ferramenta até cochilar na mesa
const FALAS = {
  chicote: ['Trabalha!', 'Anda logo!', 'É pra ontem!', 'Sem moleza!', 'Bora, bora!'],
  chamando: ['Vem cá!', 'Cadê você?', 'Chega logo!'],
  apanha: ['Ai!', 'Sim, senhor!', 'Já tô indo!', 'Tá bom, tá bom!'],
  bronca: ['De novo?!', 'Que vergonha!', '#@$%&!', 'Quem fez isso?!'],
  bronca2: ['Conserta isso!', 'Presta atenção!', 'Assim não dá!'],
  desculpa: ['Foi mal…', 'Vou corrigir!', 'Não foi culpa minha!', 'Era o cache…'],
  chefeChega: ['Quem errou aí?!', 'Cadê o culpado?!'],
  susto: ['Ué?!', 'Parei, parei!', 'Opa!'],
  tonto: ['Quem sou eu?', 'Onde eu tava?', 'Esqueci tudo…'],
  comemora: ['Feito! ✓', 'Missão cumprida!', 'Entregue!'],
  arcade: ['Toma!', 'Combo!', 'Mais uma ficha', 'Pera, tô ganhando'],
  espreguica: ['Ufa!', 'Aaaah…', 'Pronto!'],
  cafe: ['Cafezinho…', 'Um expresso', 'Sem açúcar'],
  celular: ['kkkk', 'kkkkkk', 'rsrs', 'olha isso kkk'],
  estalo: ['CRACK!', 'PLAFT!', 'TCHÁ!'],
};
const um = (lista, n) => lista[(n >>> 0) % lista.length];
// topo da cabeça (y do mundo) de quem está em pé ou sentado (sentado, o boneco desce CORPO.sentado px)
const sentadoEm = (a) => a.arrived && (a.kind === 'desk' || (a.kind === 'lounge' && a.spot && a.spot.seat));
const topo = (a, fy = a.fy) => fy - CORPO.altura + (sentadoEm(a) ? CORPO.sentado : 0);
const lerp = (a, b, t) => a + (b - a) * t;
const CONFETE = ['#ff6b6b', '#ffd23f', '#4dd2ff', '#7ee08a', '#c08bff', '#ff9ad5', '#ffffff'];

// o Chefe: cabelo grisalho, óculos, bigode, terno escuro e gravata vermelha
function vestirChefe(cl) {
  const hair = '#cfc8b8', pants = '#2e3446', shoe = '#1e1a22';
  Object.assign(cl, {
    hair, hairS: dk(hair, 0.25), hairH: lt(hair, 0.4), hairO: dk(hair, 0.72), style: 2,
    pants, pantsS: dk(pants, 0.3), pantsO: dk(pants, 0.66), shoe, shoeO: dk(shoe, 0.7),
    glasses: true, beard: false, badge: false, stripe: false, outfit: 1, tie: '#d93a3a', bigode: true, bravo: true,
  });
}

export class Diretor {
  constructor(of) {
    this.of = of;
    this.on = true;
    this.npcs = new Map();   // o Chefe (não vem do servidor)
    this.fila = [];          // agentes que o Chefe ainda vai visitar
    this.parts = [];         // partículas no mundo (confete, faíscas)
    this.textos = [];        // onomatopeias (CRACK!, K.O.!), desenhadas em espaço de tela
    this.bugs = [];          // bichinhos que fogem do monitor quando dá erro
    this.seq = 1;
  }

  ligar(on, now) {
    this.on = !!on;
    if (this.on) return;
    for (const a of this.of.actors.values()) { if (a.gag) this.fim(a, now); a.reac = null; a.preso = 0; }
    for (const n of this.npcs.values()) { n.gag = null; this.sair(n); }
    this.fila.length = 0;
  }

  // ---------- eventos que chegam com o estado ----------
  aoEstado(criados, primeira, now) {
    const agora = Date.now(), novos = new Set(criados);
    for (const a of this.of.actors.values()) {
      const d = a.d;
      const s = a.gs;
      if (!s) {                                     // primeira vez que vê o agente: só guarda a referência
        a.gs = { erro: d.erroEm || 0, interr: d.interrompidoEm || 0, compact: d.compactadoEm || 0, estado: d.estado, ferr: d.ferramenta, det: d.detalhe, trocas: [] };
        if (!primeira && novos.has(a)) this.nasceu(a, now);
        continue;
      }
      if ((d.erroEm || 0) > s.erro) { s.erro = d.erroEm; if (agora - d.erroEm < RECENTE) { this.soltarBug(a, now); this.bronca(a, now); } }
      // ritmo: cada ferramenta nova conta; muitas em pouco tempo põem fogo no teclado
      if (d.ferramenta && (d.ferramenta !== s.ferr || d.detalhe !== s.det)) {
        s.trocas.push(now);
        while (s.trocas.length && now - s.trocas[0] > FOGO_JANELA) s.trocas.shift();
        if (this.on && s.trocas.length >= FOGO_TROCAS && !(a.fogoAte > now)) { a.fogoAte = now + FOGO_MS; s.trocas.length = 0; }
      }
      s.ferr = d.ferramenta; s.det = d.detalhe;
      if ((d.interrompidoEm || 0) > s.interr) { s.interr = d.interrompidoEm; if (agora - d.interrompidoEm < RECENTE) this.reagir(a, 'susto', now); }
      if ((d.compactadoEm || 0) > s.compact) { s.compact = d.compactadoEm; if (agora - d.compactadoEm < RECENTE) this.reagir(a, 'tonto', now); }
      if (d.estado === 'saindo' && s.estado !== 'saindo' && d.papel === 'subagente' && !a.gag) this.reagir(a, 'comemora', now);
      if (d.estado === 'ocioso' && (s.estado === 'trabalhando' || s.estado === 'pensando') && d.papel === 'principal' && !a.gag && !a.reac) this.reagir(a, 'espreguica', now);
      s.estado = d.estado;
    }
  }
  // subagente novo ou modelo chamado: quem chamou vai lá com o chicote
  nasceu(a, now) {
    const d = a.d;
    if (!this.on || !d.paiId) return;
    if (d.papel !== 'subagente' && !(d.papel === 'chamado' && COM_CHICOTE.has(d.plataforma))) return;
    const pai = this.of.actors.get(d.paiId);
    if (pai) this.mandar(pai, 'chicote', a, now);
  }
  bronca(alvo, now) {
    if (!this.on || alvo.gag || this.esfriando(alvo, 'bronca', now)) return;
    (alvo.cd ||= {}).bronca = now;
    const pai = alvo.d.paiId && this.of.actors.get(alvo.d.paiId);
    if (pai && this.livre(pai)) this.iniciar(pai, { tipo: 'bronca', alvo: alvo.id, ferr: alvo.d.erroFerramenta || null }, now);
    else this.chamarChefe(alvo, now);
  }
  mandar(ex, tipo, alvo, now) {
    if (!alvo || alvo === ex || !this.livre(ex) || this.esfriando(ex, tipo, now)) return false;
    (ex.cd ||= {})[tipo] = now;
    return this.iniciar(ex, { tipo, alvo: alvo.id, ferr: alvo.d.erroFerramenta || null }, now);
  }
  esfriando(a, tipo, now) { return !!(a.cd && a.cd[tipo] && now - a.cd[tipo] < (CD[tipo] || 0)); }
  livre(a) { return !a.gag && !a.leaving && !a.entering && a.d.estado !== 'saindo' && a.alpha > 0.5; }

  // ---------- o Chefe ----------
  chamarChefe(alvo, now) {
    for (const n of this.npcs.values()) {
      if (n.gag) {                                 // ocupado: entra na fila dele
        if (n.gag.alvo !== alvo.id && !this.fila.includes(alvo.id) && this.fila.length < 3) this.fila.push(alvo.id);
        return;
      }
      n.entering = n.alpha < 1;                    // estava indo embora: volta
      this.iniciar(n, { tipo: 'bronca', alvo: alvo.id, ferr: alvo.d.erroFerramenta || null }, now);
      return;
    }
    const id = 'npc:chefe:' + this.seq++;
    const n = new Actor({ id, plataforma: 'outro', nome: 'Chefe', papel: 'npc', estado: 'bravo', ferramenta: null, detalhe: null }, platPal('#3a4258'), now);
    n.npc = true; n.fresh = false;
    vestirChefe(n.cl);
    n.x = DOOR_X; n.y = 0.12; n.face = 1; n.entering = true; n.alpha = 0;
    this.npcs.set(id, n);
    this.iniciar(n, { tipo: 'bronca', alvo: alvo.id, ferr: alvo.d.erroFerramenta || null }, now);
  }
  sair(n) {
    n.kind = 'exit'; n.arrived = false;
    this.of.planPath(n, Math.floor(DOOR_X), 0, DOOR_X, 0.1);
  }

  // ---------- quem age: vai até o alvo, espera ele sentar e faz a cena ----------
  iniciar(ex, gag, now) {
    const alvo = this.of.actors.get(gag.alvo);
    if (!alvo) return false;
    if (ex.kind === 'lounge' || ex.kind === 'arcade') this.of.freeSpot(ex);
    Object.assign(gag, { fase: 'ir', t: now, inicio: now, golpes: 0, n: this.seq++ });
    ex.gag = gag; ex.kind = 'gag';
    alvo.preso = Math.max(alvo.preso || 0, now + 18000);
    this.rota(ex, alvo, now);
    return true;
  }
  rota(ex, alvo, now) {
    const L = this.lado(alvo, ex);
    if (!L) { this.fim(ex, now); return; }
    ex.gag.lado = L;
    ex.arrived = false;
    this.of.planPath(ex, L.gx, L.gy, L.fx, L.fy);
  }
  // um lugar livre ao lado do alvo: na quina da frente da mesa dele, do lado de quem vem
  lado(alvo, ex) {
    const of = this.of, w = of.world, X = w.X, Y = w.Y;
    const livre = (x, y) => x >= 0 && y >= 0 && x < X && y < Y && !w.blocked[y * X + x];
    const s = alvo.kind === 'desk' ? of.seatTile(alvo) : null;
    let cands;
    // na mesa: de preferência no corredor da frente (assim fica na frente dos objetos das mesas vizinhas)
    if (s) cands = [[s.cx - 1, s.cy + 1, s.cx - 0.35, s.cy + 1.4], [s.cx + 2, s.cy + 1, s.cx + 2.35, s.cy + 1.4], [s.cx, s.cy + 2, s.cx + 0.4, s.cy + 2.4, 1], [s.cx + 1, s.cy + 2, s.cx + 1.6, s.cy + 2.4, 1]];
    else {
      const px = alvo.spot ? alvo.spot.px : alvo.x, py = alvo.spot ? alvo.spot.py : alvo.y, gx = Math.floor(px), gy = Math.floor(py);
      cands = [[gx - 1, gy, gx - 0.3, py], [gx + 1, gy, gx + 1.3, py], [gx - 1, gy + 1, gx - 0.3, gy + 1.3], [gx + 1, gy + 1, gx + 1.3, gy + 1.3], [gx, gy + 1, px + 0.6, gy + 1.5]];
    }
    let best = null, bd = Infinity;
    for (const [gx, gy, fx, fy, reserva] of cands) {
      if (!livre(gx, gy)) continue;
      const dd = Math.hypot(fx - ex.x, fy - ex.y) + (reserva ? 100 : 0);
      if (dd < bd) { bd = dd; best = { gx, gy, fx, fy }; }
    }
    return best;
  }
  passo(a, now) {
    const g = a.gag, alvo = this.of.actors.get(g.alvo);
    if (!alvo || now - g.inicio > 24000) { this.fim(a, now); return; }
    if (g.fase === 'ir') { if (a.arrived) { g.fase = 'esperar'; g.t = now; } return; }
    a.face = alvo.fx >= a.fx ? 0 : 2;                // de frente para o alvo
    if (g.fase === 'esperar') {
      if ((alvo.arrived && alvo.kind !== 'exit') || now - g.t > 6000) {
        g.fase = 'agir'; g.t = now;
        alvo.reac = { tipo: g.tipo === 'chicote' ? 'apanha' : 'levaBronca', t0: now, ate: now + DUR[g.tipo === 'chicote' ? 'apanha' : 'levaBronca'], n: g.n };
      }
      return;
    }
    const t = now - g.t;
    if (g.tipo === 'chicote') {
      if (g.golpes < 3 && t >= 400 + 800 * g.golpes) { g.golpes++; this.estalo(a, alvo, now); }
      if (t > DUR.chicote) this.fim(a, now);
    } else if (t > DUR.bronca) this.fim(a, now);
  }
  fim(a, now) {
    const g = a.gag;
    a.gag = null;
    const alvo = g && this.of.actors.get(g.alvo);
    if (alvo) alvo.preso = Math.min(alvo.preso || 0, now + 1200);
    a.kind = 'none'; a.arrived = true; a.path.length = 0; a.pi = 0;
    if (!a.npc) return;                              // o agente volta sozinho (think, no próximo quadro)
    while (this.fila.length) {
      const id = this.fila.shift(), t = this.of.actors.get(id);
      if (t && this.iniciar(a, { tipo: 'bronca', alvo: id, ferr: t.d.erroFerramenta || null }, now)) return;
    }
    this.sair(a);
  }
  // reação de um agente sozinho (susto, tonto, comemoração)
  reagir(a, tipo, now) {
    if (!this.on || this.esfriando(a, tipo, now)) return;
    (a.cd ||= {})[tipo] = now;
    a.reac = { tipo, t0: now, ate: now + DUR[tipo], n: this.seq++ };
    if (tipo === 'comemora') { a.preso = Math.max(a.preso || 0, now + DUR.comemora); this.confete(a.fx, topo(a)); }
  }
  reac(a, now) { const r = a.reac; if (r && now < r.ate) return r; if (r) a.reac = null; return null; }

  // ---------- ganchos chamados pela cena ----------
  segura(a, now) { return !!a.gag || (a.preso > now); }
  querArcade(a, now) {
    const d = a.d;
    if (a.forcaArcade > now) return true;
    if (!this.on || a.npc || d.papel !== 'principal' || PERGUNTA.test(d.ferramenta || '')) { a.arcT = 0; return false; }
    const cond = (d.estado === 'esperando' && /^(Agent|Task)$/.test(d.ferramenta || ''))
      || ((d.estado === 'esperando' || d.estado === 'ocioso') && this.temFilhoAtivo(a));
    if (!cond) { a.arcT = 0; return false; }
    if (a.kind === 'arcade') return true;
    if (!a.arcT) a.arcT = now;
    return now - a.arcT > ARCADE_ESPERA;
  }
  // ---------- pausa ----------
  // a caminho do lounge: decide o que fazer (café ou celular) e, se for café, passa antes na cafeteira
  pausa(a, now, want) {
    if (a.d.estado !== 'ocioso') { a.atividade = null; a.cafeFeito = false; }
    if (want !== 'lounge' || !this.on || a.npc || a.kind === 'lounge') return want;
    if (!a.atividade) { a.pausas = (a.pausas || 0) + 1; a.atividade = hashStr(a.id + ':' + a.pausas) % 10 < 6 ? 'cafe' : 'celular'; }
    if (a.atividade !== 'cafe' || a.cafeFeito) return want;
    if (a.kind === 'cafe' && a.arrived && now - a.arrivedAt > CAFE_MS) { a.cafeFeito = true; return want; }
    return 'cafe';
  }
  lugarCafe(a) {
    const lx = this.of.world.lx;
    return { gx: lx + 1, gy: 1, px: lx + 1.5 + ((hashStr(a.id) % 3) - 1) * 0.15, py: 1.55 };
  }
  dormindo(a, now) {
    if (this.buildLongo(a, now)) return true;
    if (!a.arrived || a.kind !== 'lounge' || !a.spot || a.parceiro || a.gag) return false;
    const t = now - a.arrivedAt;
    return a.spot.seat ? t > SONECA_SOFA : t > SONECA_EM_PE;
  }
  // dois em pé, perto um do outro, no lounge: viram dupla de papo
  parear(now) {
    const of = this.of, livres = [];
    for (const a of of.actors.values()) {
      if (this.on && a.arrived && a.kind === 'lounge' && a.spot && !a.spot.seat && !a.gag && !this.reac(a, now) && now - a.arrivedAt < SONECA_EM_PE) livres.push(a);
    }
    const ok = new Set(livres.map((a) => a.id));
    for (const a of of.actors.values()) if (a.parceiro && (!ok.has(a.id) || !ok.has(a.parceiro))) a.parceiro = null;
    for (const a of livres) {
      if (a.parceiro) continue;
      let best = null, bd = 2.6;
      for (const b of livres) {
        if (b === a || b.parceiro) continue;
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (dd < bd) { bd = dd; best = b; }
      }
      if (best) { a.parceiro = best.id; best.parceiro = a.id; }
    }
  }
  cafeteira(g, it, now) {
    let servindo = false;
    for (const a of this.of.actors.values()) if (a.kind === 'cafe' && a.arrived) { servindo = true; break; }
    if (!servindo) return;
    const p = ((now / 120) | 0) & 1;
    rect(g, it.x - (p ? U : 0), it.y - 13.5, U, 3, '#5a3418');                 // café caindo na caneca
    if (((now / 250) | 0) & 1) rect(g, it.x - 4.5, it.y - 23, 9, 1, '#ffcf5a');  // luz de "servindo"
  }
  // soneca deitado no sofá: a pessoa de frente, girada 90° (cabeça na almofada da esquerda), e o cobertor
  deitado(g, a, now) {
    const x0 = a.spot.sofa * T;
    let s = a.sprs.deitado;
    if (!s) {
      const p = buildPerson(a, { pose: 'stand', dir: 0, frame: 0, bob: 0, blink: 1, cup: false, semSombra: true });
      const [c, cg] = makeCanvas(42, 32);
      cg.translate(0, 32); cg.rotate(-Math.PI / 2); put(cg, p, 0, 0);
      s = a.sprs.deitado = c;
    }
    put(g, s, x0 - 13, -7);
    const resp = (((now + a.phase) / 1300) | 0) & 1, cor = COBERTOR[hashStr(a.id) % COBERTOR.length];
    rect(g, x0 + 14, 4 + resp, 13, 10 - resp, cor); rect(g, x0 + 14, 4 + resp, 13, 1, lt(cor, 0.45)); rect(g, x0 + 14, 4 + resp, 2, 10 - resp, lt(cor, 0.2));
    for (let x = 18; x < 27; x += 4) rect(g, x0 + x, 5 + resp, 1, 8 - resp, dk(cor, 0.14));
    rect(g, x0 + 14, 13, 13, 1, dk(cor, 0.3));
    a.ovx = x0 + 8; a.ovy = 3;                     // nome e "zz" em cima da cabeça
  }
  bolhaNariz(g, a, fx, fy, now) {
    const ph = ((now + a.phase * 3) % 2800) / 2800, r = Math.round(1 + ph * 3);
    let cx, cy;
    if (a.deitado) { cx = a.spot.sofa * T + 11; cy = 6 - r; }
    else if (a.kind === 'desk') { cx = fx + 5 + r; cy = fy + CORPO.boca + CORPO.sentado; }      // de costas: a bolha aparece do lado
    else { cx = fx + 1 + r; cy = fy + CORPO.boca + (sentadoEm(a) ? CORPO.sentado : 0); }
    if (ph < 0.92) {
      blob(g, cx, cy, r, r, 'rgba(170,220,255,0.7)');
      rect(g, cx - r + 1, cy - r + 1, 1, 1, '#ffffff');
    } else for (const [dx, dy] of [[-3, -2], [3, -2], [-2, 2], [2, 2], [0, -4]]) rect(g, cx + dx, cy + dy, 1, 1, 'rgba(170,220,255,0.8)');
  }
  vaporCaneca(g, fx, fy, now) {
    for (let i = 0; i < 2; i++) {
      const p = (now / 1300 + i / 2) % 1;
      g.globalAlpha = (1 - p) * 0.7;
      rect(g, fx + 6 + Math.round(Math.sin(p * 6 + i * 2)), fy - 10 - Math.round(p * 6), 1, 1, '#ffffff');
    }
    g.globalAlpha = 1;
  }
  celular(g, fx, fy, now) {
    rect(g, fx - 1, fy - 8, 3, 3, '#1b2133'); rect(g, fx - 1, fy - 8, 3, 1, '#3a4259');
    rect(g, fx, fy - 7, 1, 1, ((now / 450) | 0) % 3 ? '#8ef0ff' : '#d8fbff');
    g.globalAlpha = 0.13; rect(g, fx - 3, fy - 15, 6, 4, '#8ef0ff'); g.globalAlpha = 1;   // a tela ilumina o rosto
  }
  // ---------- bug, fogo no teclado, cochilo no build ----------
  soltarBug(a, now) {
    if (!this.on || this.bugs.length > 8) return;
    const s = a.kind === 'desk' ? this.of.seatTile(a) : null;
    const x = s ? s.cx * T + 4 : a.fx, y = s ? s.base - 4 : a.fy - 4, dir = Math.random() < 0.5 ? -1 : 1;
    this.bugs.push({ x, y, vx: dir * (26 + Math.random() * 14), vy: 10 + Math.random() * 14, t0: now, vida: 4.5, fase: Math.random() * 6 });
    this.texto(x, y - 6, 'bug!', now, 700);
  }
  pegandoFogo(a, now) { return this.on && a.fogoAte > now && a.arrived && a.kind === 'desk' && a.d.estado === 'trabalhando'; }
  buildLongo(a, now) {
    const d = a.d;
    return this.on && a.arrived && a.kind === 'desk' && d.estado === 'trabalhando' && !!d.ferramenta && !!d.desde && Date.now() - d.desde > BUILD_LONGO;
  }
  fogo(g, a, now) {
    const s = this.of.seatTile(a);
    if (!s) return;
    const x0 = s.cx * T + 9, y0 = s.base + 7;            // teclado da mesa (as chamas passam por cima do nome)
    for (let i = 0; i < 5; i++) {
      const h = 6 + ((hashStr('f' + i + ':' + ((now / 90) | 0)) % 6)) - (i === 0 || i === 4 ? 2 : 0);
      const x = x0 + 1 + i * 3;
      rect(g, x - U, y0 - h + 1, 3, h - 1, '#e8421a'); rect(g, x, y0 - h, 2, h, '#ff5a1f'); rect(g, x + U, y0 - h - 1, 1, 1, '#ff5a1f');
      rect(g, x, y0 - h + 2, 2, Math.max(1, h - 4), '#ffb020'); rect(g, x + U, y0 - h + 1.5, 1, U, '#ffb020'); rect(g, x + U, y0 - 2.5, 1, 2.5, '#fff0a0');
      rect(g, x + (i & 1), y0 - h - 2.5, U, U, '#ff8a3a');
    }
    if (Math.random() < 0.15) this.parts.push({ x: x0 + 2 + Math.random() * 12, y: y0 - 6, vx: (Math.random() - 0.5) * 6, vy: -14 - Math.random() * 8, gr: 0, vida: 0.9, cor: 'rgba(120,120,130,0.6)', w: 2, h: 2 });
  }
  drawBugs(g, now) {
    for (const b of this.bugs) {
      const x = Math.round(b.x), y = Math.round(b.y), p = ((now / 70) | 0) & 1;
      g.globalAlpha = Math.min(1, b.vida * 2);
      rect(g, x - 1, y, 4, 2, '#2a2433'); rect(g, x - U, y - U, 3, U, '#2a2433'); rect(g, x, y, 2, U, '#5a4f72');
      rect(g, b.vx > 0 ? x + 3 : x - 2, y, 1, 1, '#e5484d');                      // cabeça vermelha
      for (const lx of [x - 1, x + 1]) { rect(g, lx + p, y - 1 + (p ? 0 : 3), 1, 1, '#2a2433'); rect(g, lx + 1 - p, y + 2, 1, 1, '#2a2433'); }
    }
    g.globalAlpha = 1;
  }
  temFilhoAtivo(a) {
    for (const c of this.of.actors.values()) {
      if (c.d.paiId === a.id && c.d.papel === 'subagente' && !c.leaving && c.d.estado !== 'saindo' && c.d.estado !== 'ocioso') return true;
    }
    return false;
  }
  vagaArcade(a) {
    for (const sp of this.of.world.arcadeSpots) if (!sp.owner || sp.owner === a.id) { sp.owner = a.id; return sp; }
    return null;
  }
  aoRemover(a) {
    this.fila = this.fila.filter((id) => id !== a.id);
  }
  aoRelayout(now) {
    const w = this.of.world;
    for (const a of [...this.of.actors.values(), ...this.npcs.values()]) {
      a.x = Math.max(0.3, Math.min(w.X - 0.3, a.x)); a.y = Math.max(0.12, Math.min(w.Y - 0.3, a.y));
      if (a.gag) {
        const alvo = this.of.actors.get(a.gag.alvo);
        if (!alvo) { this.fim(a, now); continue; }
        if (a.gag.fase === 'ir') this.rota(a, alvo, now);
        else { const L = this.lado(alvo, a); if (L) { a.x = L.fx; a.y = L.fy; a.gag.lado = L; } }
      } else if (a.npc) this.sair(a);
    }
  }
  update(dt, now) {
    const of = this.of;
    for (const a of of.actors.values()) if (a.gag) this.passo(a, now);
    for (const n of [...this.npcs.values()]) {
      if (n.gag) this.passo(n, now);
      else if (n.kind !== 'exit') this.sair(n);
      of.mover(n, dt, now);
      if (n.gone) this.npcs.delete(n.id);
    }
    if (this.on) {
      for (const a of of.actors.values()) {   // quem cochila no sofá deita se o outro lugar estiver livre
        if (a.deitado || !a.spot || !a.spot.seat || !this.dormindo(a, now)) continue;
        const viz = of.world.spots.find((sp) => sp.seat && sp.sofa === a.spot.sofa && sp !== a.spot);
        if (viz && !viz.owner) { viz.owner = a.id; a.deitado = viz; }
      }
      if (now - (this._papoT || 0) > 700) { this._papoT = now; this.parear(now); }
    }
    for (const b of this.bugs) {             // o bug corre em zigue-zague e some
      b.fase += dt * 9; b.x += b.vx * dt; b.y += (b.vy + Math.sin(b.fase) * 30) * dt; b.vida -= dt;
    }
    if (this.bugs.length) this.bugs = this.bugs.filter((b) => b.vida > 0);
    let k = 0;
    for (const p of this.parts) {
      p.vy += p.gr * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vida -= dt;
      if (p.vida > 0) this.parts[k++] = p;
    }
    this.parts.length = k;
    if (this.textos.length) this.textos = this.textos.filter((t) => now - t.t0 < t.dur);
  }

  // pose e deslocamento do sprite: { pidx (4 fliperama, 5 braço erguido, 6 comemorando), dir, frame, ox, oy, semMaos }
  pose(a, now) {
    const g = a.gag;
    if (g && g.fase !== 'ir') {
      const dir = a.face === 2 ? 3 : 1;
      if (g.tipo === 'chicote') return { pidx: 5, dir, frame: this.uChicote(g, now) >= 0.44 ? 1 : 0 };
      const f = ((now / 170) | 0) & 1;                // sacode o punho
      return { pidx: 5, dir, frame: f, oy: f ? -1 : 0 };
    }
    if (a.arrived && a.kind === 'arcade' && a.spot) {
      if (a.spot.play) return { pidx: 4, dir: 2, frame: (((now + a.phase) / 130) | 0) & 1 };
      return { pidx: 0, dir: 2 };                   // na fila, assistindo
    }
    const r = this.reac(a, now);
    if (!r) return this.posePausa(a, now);
    const t = now - r.t0;
    switch (r.tipo) {
      case 'espreguica': return { pidx: 6, dir: 0, semMaos: true, olhosFechados: t > 300 && t < 1300 };
      case 'comemora': return { pidx: 6, dir: 0, oy: -Math.round(Math.abs(Math.sin(t / 300 * Math.PI)) * 4), semMaos: true };
      case 'susto': { const k = t < 520 ? Math.round(Math.sin(t / 520 * Math.PI) * 5) : 0; return { oy: -k, semMaos: k > 0 }; }
      case 'apanha': { const j = a.jolt && now - a.jolt < 180; return { oy: j ? -3 : 0, ox: j ? 1 : 0, semMaos: j }; }
      case 'levaBronca': return { oy: ((now / 380) | 0) & 1 };
      case 'tonto': return { ox: Math.round(Math.sin(now / 280) * 1.4) };
      default: return null;
    }
  }
  posePausa(a, now) {
    if (!this.on) return null;
    if (this.buildLongo(a, now)) return { oy: -1 - ((((now + a.phase) / 1500) | 0) & 1) };   // debruçado na mesa
    if (a.kind === 'cafe' && a.arrived) return { pidx: 0, dir: 2 };                          // de costas, servindo
    if (!a.arrived && a.kind === 'lounge' && a.atividade === 'cafe' && a.cafeFeito) return { cup: 1 };   // andando com a caneca
    if (!a.arrived || a.kind !== 'lounge' || !a.spot) return null;
    const dorme = this.dormindo(a, now);
    if (a.spot.seat) {
      if (!dorme) return null;
      if (a.deitado) return { deitado: true };
      return { olhosFechados: true, oy: (((now + a.phase) / 1400) | 0) & 1 };               // cochila sentado, cabeceando
    }
    const cafe = a.atividade !== 'celular' ? 1 : 0;
    if (dorme) return { olhosFechados: true, cup: cafe };
    const par = a.parceiro && this.of.actors.get(a.parceiro);
    if (par) return { pidx: 0, dir: par.x >= a.x ? 1 : 3, cup: cafe };                       // de frente para quem conversa
    if (!cafe) return { cup: 0 };
    return { cup: 1, frame: (now + a.phase * 5) % 5200 < 900 ? 1 : 0 };                       // golinho a cada ~5 s
  }
  // fala de uma animação: { head, det, estilo }
  fala(a, now) {
    const g = a.gag;
    if (g) {
      const t = now - g.t;
      if (g.tipo === 'chicote') {
        if (g.fase === 'esperar') return { head: um(FALAS.chamando, g.n) };
        if (g.fase === 'agir' && t < 1500) return { head: um(FALAS.chicote, g.n), estilo: 'bravo' };
        return null;
      }
      if (g.fase === 'ir' && a.npc && t < 2400) return { head: um(FALAS.chefeChega, g.n), estilo: 'bravo' };
      if (g.fase === 'agir') {
        if (t < 1600) return { head: g.ferr && g.n & 1 ? `Erro no ${g.ferr}?!` : um(FALAS.bronca, g.n), estilo: 'bravo' };
        if (t > 3000 && t < 4100) return { head: um(FALAS.bronca2, g.n), estilo: 'bravo' };
      }
      return null;
    }
    const r = this.reac(a, now);
    if (r) {
      const t = now - r.t0;
      switch (r.tipo) {
        case 'apanha': return t > 450 ? { head: um(FALAS.apanha, r.n) } : null;
        case 'levaBronca': return t > 1700 && t < 2900 ? { head: um(FALAS.desculpa, r.n) } : null;
        case 'susto': return { head: um(FALAS.susto, r.n) };
        case 'tonto': return { head: um(FALAS.tonto, r.n) };
        case 'comemora': return { head: um(FALAS.comemora, r.n) };
        case 'espreguica': return t > 400 ? { head: um(FALAS.espreguica, r.n) } : null;
        default: return null;
      }
    }
    if (this.on && a.kind === 'cafe' && a.arrived && now - a.arrivedAt < 1800) return { head: um(FALAS.cafe, hashStr(a.id) + (a.pausas || 0)) };
    if (this.on && a.arrived && a.kind === 'lounge' && a.spot && !a.spot.seat && !this.dormindo(a, now)) {
      const par = a.parceiro && this.of.actors.get(a.parceiro);
      if (par) {
        const [A, B] = a.id < par.id ? [a, par] : [par, a], seed = hashStr(A.id + B.id) % 9000;
        const t = (now + seed) % 9000, linhas = um(PAPO, Math.floor((now + seed) / 9000) + seed);
        if (a === A && t < 2000) return { head: linhas[0] };
        if (a === B && t > 2200 && t < 4200) return { head: linhas[1] };
        return null;
      }
      if (a.atividade === 'celular' && (now + a.phase * 11) % 9000 < 1300) return { head: um(FALAS.celular, Math.floor((now + a.phase * 11) / 9000)) };
    }
    if (a.arrived && a.kind === 'arcade' && a.spot && a.spot.play) {
      const c = (now + a.phase * 7) / 8000, i = Math.floor(c);
      if (c - i < 0.2) return { head: um(FALAS.arcade, hashStr(a.id) + i) };
    }
    if (this.on && a.arrived && a.kind === 'desk' && a.d.estado === 'esperando' && PERGUNTA.test(a.d.ferramenta || '')) return { head: 'Ô humano!', det: a.d.detalhe || '' };
    return null;
  }

  // ---------- desenho no mundo (depois do sprite do agente) ----------
  depois(g, a, now, ox, oy) {
    const fx = a.fx + ox, fy = a.fy + oy, G = a.gag;
    if (G) {
      const s = a.face === 2 ? -1 : 1;
      if (G.fase !== 'ir' && G.tipo === 'chicote') this.chicote(g, a, fx, fy, s, now);
      else if (G.tipo === 'bronca' && (G.fase !== 'ir' || a.npc)) this.veia(g, fx + s * 4, topo(a, fy) - 3, now);
    }
    const r = this.reac(a, now);
    if (r) {
      if (r.tipo === 'apanha' || r.tipo === 'levaBronca' || r.tipo === 'susto') this.suor(g, fx, topo(a, fy), now - r.t0);
      else if (r.tipo === 'tonto') this.estrelas(g, fx, topo(a, fy), now);
    }
    if (this.on && a.arrived && a.kind === 'desk' && !G && !r && a.d.estado === 'esperando' && PERGUNTA.test(a.d.ferramenta || '')) this.mao(g, a, fx, fy, now);
    if (this.pegandoFogo(a, now)) { this.fogo(g, a, now); this.suor(g, fx, topo(a, fy), now - a.fogoAte); }
    else if (!G && !r && this.buildLongo(a, now)) this.bolhaNariz(g, a, fx, fy, now);
    if (this.on && a.arrived && a.kind === 'lounge' && a.spot && !G && !r) {
      if (this.dormindo(a, now)) this.bolhaNariz(g, a, fx, fy, now);
      else if (!a.spot.seat && a.atividade === 'celular') this.celular(g, fx, fy, now);
      else if (!a.spot.seat && !a.parceiro && (now + a.phase * 5) % 5200 >= 900) this.vaporCaneca(g, fx, fy, now);
    }
  }
  // 0..1 dentro de cada estalo (o golpe acontece em 0,5); -1 fora da cena
  uChicote(G, now) {
    if (G.fase !== 'agir') return -1;
    const t = now - G.t;
    return t >= 2400 ? 0.99 : (t % 800) / 800;
  }
  chicote(g, a, fx, fy, s, now) {
    const G = a.gag, alvo = this.of.actors.get(G.alvo), u = this.uChicote(G, now), golpe = u >= 0.44;
    const hx = fx + s * (golpe ? 5 : -6), hy = fy + (golpe ? -9 : -16);             // mão (a mesma do sprite)
    const cx = hx + s * (golpe ? 3 : 0), cy = hy + (golpe ? 0 : -3);                 // ponta do cabo
    const ax = alvo ? alvo.fx : fx + s * 20, ay = alvo ? topo(alvo) + 5 : fy - 15;  // cabeça do alvo
    let px, py, mx, my;
    if (u < 0) { px = cx - s * 2; py = cy + 15; mx = cx - s * 5; my = cy + 7; }                       // pendurado, esperando
    else if (!golpe) { px = cx - s * 15; py = cy - 4 + Math.sin(now / 80) * 2; mx = cx - s * 7; my = cy - 10; }   // rodando atrás
    else if (u < 0.5) { const k = (u - 0.44) / 0.06; px = lerp(cx - s * 15, ax, k); py = lerp(cy - 4, ay, k); mx = (cx + px) / 2; my = Math.min(cy, py) - 9; }
    else if (u < 0.66) { px = ax; py = ay; mx = (cx + ax) / 2; my = Math.min(cy, ay) - 6; }
    else { const k = Math.min(1, (u - 0.66) / 0.2); px = ax - s * 4 * k; py = ay + 14 * k; mx = (cx + px) / 2; my = lerp(Math.min(cy, ay) - 6, Math.max(cy, py) + 2, k); }
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const t = i / n, r = 1 - t;
      const x = Math.round(r * r * cx + 2 * r * t * mx + t * t * px), y = Math.round(r * r * cy + 2 * r * t * my + t * t * py);
      const grosso = t < 0.6;
      rect(g, x, y, grosso ? 1.5 : 1, grosso ? 1.5 : 1, grosso ? '#4a2c18' : '#6b4428'); if (grosso) rect(g, x, y, 1, U, '#7a5030');
    }
    // cabo de madeira com a ponta dourada
    if (golpe) { rect(g, Math.min(hx, cx), hy - 1, 4, 2, '#3a2416'); rect(g, cx - (s > 0 ? 0 : 1), hy - 1, 1, 2, '#d8b45a'); }
    else { rect(g, hx - 1, cy, 2, 4, '#3a2416'); rect(g, hx - 1, cy, 2, 1, '#d8b45a'); }
  }
  estalo(a, alvo, now) {
    const ax = alvo.fx, ay = topo(alvo) + 5;
    alvo.jolt = now;
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2, v = 25 + Math.random() * 50;
      this.parts.push({ x: ax, y: ay, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 12, gr: 50, vida: 0.3 + Math.random() * 0.25, cor: i & 1 ? '#fff6c2' : '#ffd23f', w: 1, h: 1 });
    }
    this.texto(ax + (a.face === 2 ? -8 : 8), ay - 10, um(FALAS.estalo, a.gag.n + a.gag.golpes), now, 850);
  }
  confete(x, y) {
    for (let i = 0; i < 34; i++) {
      this.parts.push({ x: x + (Math.random() - 0.5) * 6, y, vx: (Math.random() - 0.5) * 90, vy: -40 - Math.random() * 60, gr: 95, vida: 1.1 + Math.random() * 0.8, cor: CONFETE[i % CONFETE.length], w: i % 3 ? 1 : 2, h: 1 });
    }
  }
  texto(x, y, txt, now, dur = 900) { if (this.textos.length < 12) this.textos.push({ x, y, txt, t0: now, dur }); }
  // 💢 vermelha pulsando no canto da cabeça
  veia(g, x, y, now) {
    const p = ((now / 200) | 0) & 1, c = '#e53935';
    for (const [i, j] of [[1, 0], [3, 0], [0, 1], [1, 1], [3, 1], [4, 1], [0, 3], [1, 3], [3, 3], [4, 3], [1, 4], [3, 4]]) {
      const di = i < 2 ? -p : i > 2 ? p : 0, dj = j < 2 ? -p : j > 2 ? p : 0;
      rect(g, x - 2 + i + di, y - 2 + j + dj, 1, 1, c);
    }
  }
  // gota de suor escorrendo do lado da cabeça
  suor(g, fx, top, t) {
    const cai = ((t / 110) | 0) % 6, x = fx + 5, y = top + 2 + cai;
    g.globalAlpha = 1 - cai / 7;
    rect(g, x + 1, y - U, 1, 1.5, '#2c6aa8'); rect(g, x + U, y + U, 2, 1, '#2c6aa8'); rect(g, x, y + 1, 3, 2, '#2c6aa8'); rect(g, x + U, y + 3, 2, U, '#2c6aa8');
    rect(g, x + 1, y, 1, 1, '#bfe6ff'); rect(g, x + U, y + 1, 2, 2, '#7cc8ff'); rect(g, x + 1, y + 2.5, 1, U, '#5aa8e6'); rect(g, x + U, y + 1, 1, 1, '#ffffff');
    g.globalAlpha = 1;
  }
  estrelas(g, fx, top, now) {
    for (let i = 0; i < 3; i++) {
      const ang = now / 230 + i * 2.094, x = fx + Math.round(Math.cos(ang) * 6), y = top - 1 + Math.round(Math.sin(ang) * 2);
      rect(g, x - U, y - 1.5, 2, 4, '#8a5a12'); rect(g, x - 1.5, y - U, 4, 2, '#8a5a12');
      rect(g, x, y - 1, 1, 3, '#ffd23f'); rect(g, x - 1, y, 3, 1, '#ffd23f'); rect(g, x, y, 1, 1, '#fff7c8');
    }
  }
  // braço erguido acenando, de quem espera a resposta do usuário
  mao(g, a, fx, fy, now) {
    const w = ((now / 260) | 0) & 1, x = fx + 6 + w, pal = a.pal, cl = a.cl;
    rect(g, x - U, fy - 22.5, 3, 15, pal.shirtO);
    rect(g, x, fy - 20, 2, 12.5, pal.shirt); rect(g, x, fy - 20, U, 12.5, pal.shirtL);
    rect(g, x, fy - 22, 2, 2, cl.skin); rect(g, x - U, fy - 21.5, U, 1, cl.skin);
  }
  drawParticulas(g) {
    const now = performance.now();
    this.drawBugs(g, now);
    for (const p of this.parts) {
      g.globalAlpha = Math.min(1, p.vida * 3);
      rect(g, Math.round(p.x), Math.round(p.y), p.w, p.h, p.cor);
    }
    g.globalAlpha = 1;
  }
  // em espaço de tela: sobe, aumenta no começo e some no fim
  drawTextos(g, now) {
    const of = this.of, k = of.k, fs = of.fs;
    for (const t of this.textos) {
      const p = (now - t.t0) / t.dur, c = textoFx(t.txt, fs);
      const sc = p < 0.12 ? 1.4 - (p / 0.12) * 0.4 : 1, w = c.width * sc, h = c.height * sc;
      const x = t.x * k + of.tx, y = t.y * k + of.ty - p * fs * 1.6;
      g.globalAlpha = p < 0.7 ? 1 : Math.max(0, 1 - (p - 0.7) / 0.3);
      g.drawImage(c, Math.round(x - w / 2), Math.round(y - h / 2), Math.round(w), Math.round(h));
    }
    g.globalAlpha = 1;
  }

  // ---------- fliperama ----------
  drawArcade(g, it, now) {
    const s = sprArcade(it.v & 1);
    putS(g, s, it.x, it.y);
    const sp = this.of.world.arcadeSpots.find((p) => p.play && p.cab === it.v);
    const jog = sp && sp.owner ? this.of.actors.get(sp.owner) : null;
    const jogando = !!(jog && jog.arrived && jog.kind === 'arcade' && jog.spot === sp);
    const X = it.x + 3, Y = it.y - 39;
    if (jogando) this.luta(g, X, Y, now / 1000 + it.ph, it, now); else atracao(g, X, Y, now + it.ph * 1000);
    // controle: a bola do joystick mexe e os botões piscam enquanto alguém joga
    const o = jogando ? ((((now + it.ph * 1000) / 110) | 0) % 3) - 1 : 0, bt = jogando ? ((now / 90) | 0) % 4 : -1;
    rect(g, it.x + 3 + o, it.y - 30, 2, 2, '#e8413c'); rect(g, it.x + 3 + o, it.y - 30, 1, 1, '#ff9a8c');
    rect(g, it.x + 9, it.y - 28, 2, 1, bt === 0 ? '#ffffff' : '#ff4d6d'); rect(g, it.x + 12, it.y - 28, 2, 1, bt === 2 ? '#ffffff' : '#4dd2ff');
    if (jogando) { g.globalAlpha = 0.1 + 0.05 * Math.sin(now / 90); rect(g, it.x + 2, it.y - 26, 12, 14, '#8ef0ff'); g.globalAlpha = 1; }
  }
  // uma luta genérica de 10x8 pixels: barras de vida, dois lutadores trocando socos e K.O. no fim do round
  luta(g, X, Y, t, it, now) {
    const RD = 7, round = Math.floor(t / RD), rt = t - round * RD, venc = hashStr('r' + round) & 1, prog = Math.min(1, rt / 5.6), ko = rt > 5.6;
    rect(g, X, Y, 10, 8, '#1b1640'); rect(g, X, Y + 4, 10, 2, '#2b2360'); rect(g, X + 7, Y + 2, 2, 2, '#3a3180');
    rect(g, X, Y + 6, 10, 2, '#6b4a2e'); rect(g, X, Y + 6, 10, 1, '#8a6240');
    const hpL = ko && venc === 1 ? 0 : Math.max(1, 4 - Math.floor(prog * (venc === 1 ? 4 : 2.5)));
    const hpR = ko && venc === 0 ? 0 : Math.max(1, 4 - Math.floor(prog * (venc === 0 ? 4 : 2.5)));
    rect(g, X, Y, 4, 1, '#4a2030'); rect(g, X, Y, hpL, 1, '#ffd23f'); rect(g, X + 6, Y, 4, 1, '#4a2030'); rect(g, X + 10 - hpR, Y, hpR, 1, '#ffd23f');
    if (!ko) {
      const xl = X + 2 + Math.round(Math.sin(rt * 2.3) * 0.5 + 0.5), xr = X + 6 - Math.round(Math.sin(rt * 1.9 + 1) * 0.5 + 0.5);
      const slot = Math.floor(rt / 0.45), ataque = rt - slot * 0.45 < 0.16, quem = hashStr('a' + round + ':' + slot) & 1;
      lutador(g, xl, Y + 2, '#5cc8ff', ataque && quem === 0, 1);
      lutador(g, xr, Y + 2, '#ff6b6b', ataque && quem === 1, -1);
      if (ataque && xr - xl <= 4) rect(g, quem === 0 ? xr : xl + 1, Y + 3, 1, 1, '#ffffff');
      return;
    }
    if (it.ko !== round) { it.ko = round; this.texto(it.x + 8, it.y - 50, 'K.O.!', now, 1200); }
    if (rt - 5.6 < 0.1) { rect(g, X, Y, 10, 8, '#ffffff'); return; }
    const pul = ((rt * 6) | 0) & 1;
    if (venc === 0) { lutador(g, X + 2, Y + 2 - pul, '#5cc8ff', false, 1); rect(g, X + 6, Y + 5, 3, 1, '#ff6b6b'); }
    else { lutador(g, X + 6, Y + 2 - pul, '#ff6b6b', false, -1); rect(g, X + 1, Y + 5, 3, 1, '#5cc8ff'); }
    for (const [i, j] of [[0, 0], [0, 1], [0, 2], [1, 1], [2, 0], [2, 2]]) rect(g, X + 2 + i, Y + 1 + j, 1, 1, '#ffd23f');          // K
    for (const [i, j] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]) rect(g, X + 6 + i, Y + 1 + j, 1, 1, '#ffd23f'); // O
  }

  // ---------- teste na mão (console: __escritorio.office.testar('chicote')) ----------
  testar(tipo, id, now) {
    const lista = [...this.of.actors.values()].filter((a) => a.alpha > 0.5);
    const a = (id && this.of.actors.get(id)) || lista[(Math.random() * lista.length) | 0];
    if (!a) return 'não há agentes na sala';
    const era = this.on;
    this.on = true;
    if (a.cd) a.cd = {};
    if (tipo === 'chicote') {
      const alvo = lista.find((x) => x.d.paiId === a.id) || lista.find((x) => x !== a);
      if (!this.mandar(a, 'chicote', alvo, now)) { this.on = era; return 'sem alvo livre'; }
    } else if (tipo === 'bronca') this.bronca(a, now);
    else if (tipo === 'chefe') this.chamarChefe(a, now);
    else if (tipo === 'arcade' || tipo === 'fliperama') a.forcaArcade = now + 15000;
    else if (tipo === 'bug') this.soltarBug(a, now);
    else if (tipo === 'fogo') a.fogoAte = now + FOGO_MS;
    else if (tipo === 'soneca') { if (a.kind !== 'lounge') { this.on = era; return 'a soneca é no lounge: escolha um agente ocioso'; } a.arrivedAt = now - 60000; a.parceiro = null; }
    else if (DUR[tipo]) this.reagir(a, tipo, now);
    else { this.on = era; return 'tipos: chicote, bronca, chefe, fliperama, susto, tonto, comemora, espreguica, soneca, bug, fogo'; }
    this.on = era;
    return `${tipo}: ${a.d.nome}`;
  }
}

// ---------- sprites ----------
// Fliperama de 1 tile, visto de frente. Âncora = canto de baixo à esquerda do tile (base da fileira 0).
// Tela interna 10x8 em (3, -39); o controle e a tela são desenhados por cima, a cada quadro.
function sprArcade(v) {
  return sprite('arcade|' + v, () => makeSprite(-2, -48, 18, 3, (g, ax, ay) => {
    const R = (x, y, w, h, c) => rect(g, ax + x, ay + y, w, h, c);
    const C = v ? { b: '#2f8f9a', d: '#22707a', l: '#55bcc6', art: '#ffcf5a' } : { b: '#5b40a8', d: '#45308a', l: '#7d60cc', art: '#ff6fb5' };
    R(0, 1, 16, 2, 'rgba(60,48,70,0.22)');
    R(1, -46, 14, 46, C.b); R(1, -46, 1, 46, C.l); R(14, -46, 1, 46, C.d);
    R(1, -46, 14, 6, '#241b46'); R(2, -45, 12, 4, '#ffe08a'); R(2, -45, 12, 1, '#fff4c4');                       // letreiro aceso
    for (const [x, c] of [[3, '#e8413c'], [5, '#e8413c'], [7, '#3f83d0'], [8, '#3f83d0'], [10, '#e8413c'], [12, '#3f83d0']]) R(x, -44, 1, 2, c);
    R(2, -40, 12, 11, '#14101f'); R(2, -40, 12, 1, '#2c2440');                                                   // moldura da tela
    R(0, -29, 16, 3, '#3d3366'); R(0, -29, 16, 1, '#5a4e8a'); R(0, -26, 16, 3, '#2a2348'); R(0, -23, 16, 1, 'rgba(20,16,40,0.4)');  // painel
    R(3, -29, 3, 1, '#1a1426');
    R(1, -22, 1, 20, C.art); R(14, -22, 1, 20, C.art);
    for (let i = 0; i < 5; i++) R(3 + i * 2, -21 + i * 3, 1, 2, 'rgba(255,255,255,0.16)');
    R(5, -17, 6, 9, '#241b46'); R(5, -17, 6, 1, '#3a2f64'); R(6, -15, 1, 2, '#ff9a3c'); R(9, -15, 1, 2, '#ff9a3c'); R(6, -11, 4, 1, '#3a2f64');   // fichas
    R(1, -3, 14, 3, '#241b46'); R(1, -3, 14, 1, '#3a2f64');
  }, OL));
}
// tela parada: título piscando e "insira a ficha"
function atracao(g, X, Y, now) {
  rect(g, X, Y, 10, 8, '#100c22'); rect(g, X + 1, Y + 1, 1, 1, '#3a3470'); rect(g, X + 8, Y + 2, 1, 1, '#3a3470');
  if (((now / 700) | 0) & 1) { rect(g, X + 2, Y + 2, 6, 1, '#ffcf5a'); rect(g, X + 3, Y + 4, 4, 1, '#ff6fb5'); }
  rect(g, X + 2, Y + 6, 6, 1, ((now / 350) | 0) & 1 ? '#8ef0ff' : '#2a6a80');
}
function lutador(g, x, y, cor, soco, dir) {
  rect(g, x, y, 2, 1, '#f2c9a0');                        // cabeça
  rect(g, x, y + 1, 2, 2, cor);                          // tronco
  rect(g, x, y + 3, 1, 1, dk(cor, 0.4)); rect(g, x + 1, y + 3, 1, 1, dk(cor, 0.4));   // pernas
  if (soco) rect(g, dir > 0 ? x + 2 : x - 2, y + 1, 2, 1, '#f2c9a0');
}
// onomatopeia de gibi: amarela com contorno vinho
function textoFx(txt, fs) {
  return cached(`FX|${fs}|${txt}`, () => {
    const f2 = Math.round(fs * 1.45), font = `italic 900 ${f2}px ${FONT_STACK}`;
    const w = Math.ceil(textW(font, txt)) + f2, h = Math.round(f2 * 1.6);
    const [c, g] = rawCanvas(w, h);
    g.imageSmoothingEnabled = true;
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = Math.max(3, Math.round(f2 * 0.3)); g.strokeStyle = '#4a1010'; g.strokeText(txt, w / 2, h / 2);
    g.fillStyle = '#ffd23f'; g.fillText(txt, w / 2, h / 2);
    return c;
  });
}
