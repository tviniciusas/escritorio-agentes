/* detalhe.js — painel com o histórico completo de um agente (abas Agora, Histórico, Ferramentas, Contexto).
 *
 * Dados: GET /api/historico?id=…&versao=… (ver CONTRATO.md). Enquanto o painel está aberto, pergunta a cada
 * 3 s; o servidor só manda tudo quando a versão mudou. A linha do tempo é montada uma vez e depois só recebe
 * os eventos novos (pelo índice `i`); saídas grandes só viram texto quando a ferramenta é aberta.
 * Todo texto vindo do agente entra pelo DOM (createTextNode/textContent), nunca como HTML.
 */

const NUM = new Intl.NumberFormat('pt-BR');
const NUM2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ESTADOS = ['trabalhando', 'pensando', 'esperando', 'ocioso', 'saindo'];
const ROTULO_ESTADO = { trabalhando: 'Trabalhando', pensando: 'Pensando', esperando: 'Esperando', ocioso: 'Ocioso', saindo: 'Saindo' };
const POLL_MS = 3000;

// ---------- utilidades de DOM e de formato ----------
function h(tag, a, ...kids) {
  const el = document.createElement(tag);
  if (a) {
    for (const [k, v] of Object.entries(a)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const corOk = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#8b93a1');
const vazio = (v) => v == null || v === '';
const dash = (v) => (vazio(v) ? '—' : String(v));
const fmtNum = (n) => (typeof n === 'number' ? NUM.format(n) : '—');
const pad = (n) => String(n).padStart(2, '0');
function fmtHora(ts) {
  if (!ts) return '';
  const d = new Date(ts), hoje = new Date(), hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dif = Math.round((dia(hoje) - dia(d)) / 86400000);
  if (dif === 0) return hms;
  if (dif === 1) return 'ontem ' + hms;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hms}`;
}
function fmtDataHora(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function fmtDur(ms) {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1).replace('.', ',') : Math.round(s)} s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  if (m < 60) return `${m} min${r ? ' ' + r + ' s' : ''}`;
  const hh = Math.floor(m / 60);
  return `${hh} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
}
// caminho curto: …\pasta\arquivo.ext (o completo vai no title)
function abreviar(caminho, max = 54) {
  const c = String(caminho ?? '');
  if (c.length <= max) return c;
  const partes = c.split(/[\\/]/).filter(Boolean);
  const sep = c.includes('\\') ? '\\' : '/';
  let s = partes[partes.length - 1] || c;
  for (let i = partes.length - 2; i >= 0 && s.length + partes[i].length + 2 < max; i--) s = partes[i] + sep + s;
  return '…' + sep + s;
}
async function copiarTexto(texto, botao) {
  let ok = false;
  try { await navigator.clipboard.writeText(texto); ok = true; } catch {
    const t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = texto; document.body.append(t); t.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; } t.remove();
  }
  if (botao) { const antes = botao.textContent; botao.textContent = ok ? 'copiado' : 'falhou'; setTimeout(() => { botao.textContent = antes; }, 1300); }
}
const botaoCopiar = (getTexto) => h('button', { type: 'button', class: 'mini', title: 'Copiar para a área de transferência', onclick: (e) => { e.stopPropagation(); copiarTexto(typeof getTexto === 'function' ? getTexto() : getTexto, e.currentTarget); } }, 'copiar');

// ---------- markdown mínimo e seguro (tudo vira nó de texto; links só http/https) ----------
function link(texto, url) { return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: texto }); }
function inline(pai, s) {
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*])|\*([^*\s][^*\n]*?)\*/g;
  let i = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > i) pai.append(s.slice(i, m.index));
    if (m[1] != null) pai.append(h('code', { class: 'md-cod', text: m[1] }));
    else if (m[2] != null) pai.append(h('strong', { text: m[2] }));
    else if (m[4]) pai.append(link(m[3], m[4]));
    else if (m[5]) pai.append(link(m[5], m[5]));
    else if (m[6] != null) pai.append(h('em', { text: m[6] }));
    i = m.index + m[0].length;
  }
  if (i < s.length) pai.append(s.slice(i));
}
function mdDom(texto) {
  const raiz = h('div', { class: 'md' });
  const linhas = String(texto ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    let m;
    if ((m = /^\s*```\s*([\w+-]*)\s*$/.exec(l))) {                                  // bloco de código
      const cod = []; i++;
      while (i < linhas.length && !/^\s*```\s*$/.test(linhas[i])) cod.push(linhas[i++]);
      i++;
      raiz.append(blocoCodigo(cod.join('\n'), m[1]));
    } else if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
      const t = h('div', { class: 'md-h md-h' + m[1].length }); inline(t, m[2]); raiz.append(t); i++;
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {                                  // lista
      const ord = /^\s*\d+[.)]/.test(l), ul = h(ord ? 'ol' : 'ul', { class: 'md-lista' });
      while (i < linhas.length && (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(linhas[i]))) {
        const li = h('li', m[1].length >= 2 ? { class: 'sub' } : null); inline(li, m[3]); ul.append(li); i++;
      }
      raiz.append(ul);
    } else if (/^\s*>/.test(l)) {
      const q = []; while (i < linhas.length && /^\s*>/.test(linhas[i])) q.push(linhas[i++].replace(/^\s*>\s?/, ''));
      const bq = h('blockquote', { class: 'md-cit' }); inline(bq, q.join('\n')); raiz.append(bq);
    } else if (/^\s*\|.*\|\s*$/.test(l)) {                                           // tabela: mostra como veio, em monoespaçado
      const t = []; while (i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i])) t.push(linhas[i++]);
      raiz.append(h('pre', { class: 'md-tabela', text: t.join('\n') }));
    } else if (/^\s*([-*_])\1{2,}\s*$/.test(l)) { raiz.append(h('hr')); i++; }
    else if (l.trim() === '') i++;
    else {
      const p = []; while (i < linhas.length && linhas[i].trim() !== '' && !/^\s*```/.test(linhas[i]) && !/^(#{1,4})\s/.test(linhas[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(linhas[i])) p.push(linhas[i++]);
      const par = h('p'); inline(par, p.join('\n')); raiz.append(par);
    }
  }
  return raiz;
}
// bloco de código com botão copiar; textos grandes ficam recolhidos com "mostrar tudo"
function blocoCodigo(texto, lang, opcoes = {}) {
  const t = String(texto ?? '');
  const longo = t.length > 900 || t.split('\n').length > 14;
  const pre = h('pre', null, h('code', { text: t }));
  const el = h('div', { class: 'cod' + (longo && !opcoes.aberto ? ' longo' : '') },
    h('div', { class: 'cod-topo' }, h('span', { class: 'cod-lang', text: lang || opcoes.rotulo || '' }), botaoCopiar(t)), pre);
  if (longo) {
    el.append(h('button', { type: 'button', class: 'mini mais', text: opcoes.aberto ? 'recolher' : 'mostrar tudo', onclick: (e) => {
      const rec = el.classList.toggle('longo'); e.currentTarget.textContent = rec ? 'mostrar tudo' : 'recolher';
    } }));
  }
  return el;
}

// ---------- como mostrar a entrada de cada ferramenta ----------
function difLinhas(txt, prefixo, classe) {
  const caixa = h('div', { class: 'dif ' + classe });
  for (const l of String(txt ?? '').split('\n')) caixa.append(h('div', { class: 'dif-l' }, h('span', { class: 'dif-p', text: prefixo }), h('span', { text: l })));
  return caixa;
}
function blocoDiff(velho, novo) { return h('div', { class: 'dif-par' }, difLinhas(velho, '−', 'del'), difLinhas(novo, '+', 'add')); }
function linhaChip(rot, valor) { return vazio(valor) ? null : h('div', { class: 'ent-chip' }, h('span', { class: 'ent-rot', text: rot }), h('code', { text: typeof valor === 'object' ? JSON.stringify(valor) : String(valor) })); }
function blocoEntrada(nome, e) {
  if (e == null) return [h('p', { class: 'mudo', text: 'Sem entrada registrada.' })];
  if (typeof e !== 'object') return [blocoCodigo(String(e))];
  const n = String(nome || '').toLowerCase(), out = [];
  if ((n === 'bash' || n === 'powershell') && typeof e.command === 'string') {
    if (e.description) out.push(h('p', { class: 'ent-desc', text: e.description }));
    out.push(blocoCodigo(e.command, 'bash', { aberto: e.command.length < 4000 }));
    out.push(linhaChip('timeout', e.timeout), e.run_in_background ? linhaChip('em segundo plano', 'sim') : null);
  } else if (n === 'edit' && typeof e.old_string === 'string') {
    out.push(linhaChip('arquivo', e.file_path), blocoDiff(e.old_string, e.new_string ?? ''), e.replace_all ? linhaChip('substituir todas', 'sim') : null);
  } else if (n === 'multiedit' && Array.isArray(e.edits)) {
    out.push(linhaChip('arquivo', e.file_path));
    for (const ed of e.edits) out.push(blocoDiff(ed.old_string ?? '', ed.new_string ?? ''));
  } else if (n === 'write' && typeof e.content === 'string') {
    out.push(linhaChip('arquivo', e.file_path), blocoCodigo(e.content, 'conteúdo'));
  } else if (n === 'read') {
    out.push(linhaChip('arquivo', e.file_path), linhaChip('início', e.offset), linhaChip('linhas', e.limit));
  } else if (n === 'grep' || n === 'glob') {
    out.push(linhaChip('padrão', e.pattern), linhaChip('pasta', e.path), linhaChip('glob', e.glob), linhaChip('tipo', e.type), linhaChip('saída', e.output_mode));
  } else if (n === 'websearch') out.push(linhaChip('busca', e.query));
  else if (n === 'webfetch') out.push(linhaChip('endereço', e.url), typeof e.prompt === 'string' ? blocoCodigo(e.prompt, 'pergunta') : null);
  else if ((n === 'agent' || n === 'task') && typeof e.prompt === 'string') {
    out.push(linhaChip('tipo', e.subagent_type), linhaChip('descrição', e.description), blocoCodigo(e.prompt, 'pedido ao subagente'));
  }
  if (!out.filter(Boolean).length) out.push(blocoCodigo(JSON.stringify(e, null, 2), 'json'));
  return out.filter(Boolean);
}

// ---------- o painel ----------
export class Detalhe {
  // opts: { raiz, agente(id), plat(id), tempo(ms), buscar(id, versao)->{status,corpo}, aoFechar(), navegar(id) }
  constructor(opts) {
    this.o = opts;
    this.raiz = opts.raiz;
    this.id = null;
    this.timer = null;
    this.aba = 'agora';
    this.reset();
    this.construir();
    window.addEventListener('hashchange', () => this.doHash());
  }

  reset() {
    this.versao = null; this.resumo = null; this.total = 0; this.cortado = false;
    this.reg = new Map(); this.lista = [];      // i -> {ev, el}; lista na ordem
    this.ultimoI = -1; this.carregou = false; this.saiu = false; this.indisponivel = false;
    this.histMontado = false; this.colado = true; this.naoLidos = 0;
    this.filtro = 'tudo'; this.busca = '';
    this.cont = { tudo: 0, msg: 0, ferr: 0, erro: 0 };
    this.gen = (this.gen || 0) + 1;
    this._sigAgora = null;
  }

  aberto() { return !!this.id; }

  // ---------- abrir / fechar / hash ----------
  abrir(id, { hash = true } = {}) {
    if (!id) return;
    if (this.id === id) { this.raiz.hidden = false; return; }
    this.id = id;
    this.reset();
    this.limparTudo();
    this.raiz.hidden = false;
    this.raiz.classList.remove('entra'); void this.raiz.offsetWidth; this.raiz.classList.add('entra');
    this.trocarAba('agora');
    this.atualizarEstado();
    if (hash) this.gravarHash(id);
    this.carregar();
    this.pararPoll();
    this.iniciarPoll();
  }
  fechar({ hash = true, avisar = true } = {}) {
    if (!this.id) return;
    this.id = null;
    this.pararPoll();
    this.gen++;
    this.raiz.hidden = true;
    if (hash) this.gravarHash(null);
    if (avisar && this.o.aoFechar) this.o.aoFechar();
  }
  gravarHash(id) {
    const novo = id ? '#agente=' + encodeURIComponent(id) : '';
    if (location.hash === novo) return;
    try { history.replaceState(null, '', location.pathname + location.search + novo); } catch { /* sem history */ }
  }
  idDoHash() { const m = /[#&]agente=([^&]+)/.exec(location.hash); try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; } }
  doHash() {
    const id = this.idDoHash();
    if (id && id !== this.id) { this.abrir(id, { hash: false }); if (this.o.aoAbrirDoHash) this.o.aoAbrirDoHash(id); }
    else if (!id && this.id) this.fechar({ hash: false });
  }

  // ---------- esqueleto fixo do painel ----------
  construir() {
    const r = this.raiz;
    r.textContent = '';
    this.el = {};
    this.el.chip = h('span', { class: 'det-chip' });
    this.el.nome = h('h2', { class: 'det-nome' });
    this.el.badge = h('span', { class: 'badge' });
    this.el.ha = h('span', { class: 'det-ha' });
    this.el.titulo = h('p', { class: 'det-titulo' });
    this.el.atividade = h('p', { class: 'det-atividade' });
    this.el.aviso = h('div', { class: 'det-aviso', role: 'status', hidden: true });
    const fechar = h('button', { type: 'button', class: 'det-fechar', 'aria-label': 'Fechar o detalhe', title: 'Fechar (Esc)', onclick: () => this.fechar() }, '×');
    const topo = h('header', { class: 'det-topo' },
      h('div', { class: 'det-l1' }, this.el.chip, this.el.nome, this.el.badge, h('span', { class: 'det-fill' }), this.el.ha, fechar),
      this.el.titulo, this.el.atividade);
    this.el.abas = {};
    const nav = h('nav', { class: 'det-abas', role: 'tablist', 'aria-label': 'Seções do detalhe' });
    for (const [k, rot] of [['agora', 'Agora'], ['hist', 'Histórico'], ['ferr', 'Ferramentas'], ['ctx', 'Contexto']]) {
      const b = h('button', { type: 'button', role: 'tab', class: 'det-aba', 'aria-selected': 'false', dataset: { aba: k }, onclick: () => this.trocarAba(k) }, rot);
      if (k === 'hist') { this.el.nHist = h('span', { class: 'det-n', text: '' }); b.append(this.el.nHist); }
      this.el.abas[k] = b; nav.append(b);
    }
    this.el.p = {
      agora: h('section', { class: 'det-painel', role: 'tabpanel' }),
      hist: h('section', { class: 'det-painel det-hist', role: 'tabpanel' }),
      ferr: h('section', { class: 'det-painel', role: 'tabpanel' }),
      ctx: h('section', { class: 'det-painel', role: 'tabpanel' }),
    };
    // histórico: barra de filtros + linha do tempo + aviso de novos eventos
    this.el.chips = {};
    const barra = h('div', { class: 'hist-barra' });
    const grupo = h('div', { class: 'hist-filtros', role: 'group', 'aria-label': 'Filtrar eventos' });
    for (const [k, rot] of [['tudo', 'Tudo'], ['msg', 'Mensagens'], ['ferr', 'Ferramentas'], ['erro', 'Erros']]) {
      const c = h('button', { type: 'button', class: 'fchip', 'aria-pressed': String(k === 'tudo'), dataset: { f: k }, onclick: () => this.definirFiltro(k) }, rot, h('span', { class: 'fn', text: '0' }));
      this.el.chips[k] = c; grupo.append(c);
    }
    this.el.busca = h('input', { type: 'search', class: 'hist-busca', placeholder: 'Buscar no histórico', 'aria-label': 'Buscar no histórico', oninput: (e) => { clearTimeout(this._tb); this._tb = setTimeout(() => this.definirBusca(e.target.value), 160); } });
    barra.append(grupo, this.el.busca);
    this.el.nota = h('div', { class: 'hist-nota', hidden: true });
    this.el.linha = h('div', { class: 'hist-linha', tabindex: '0', 'aria-label': 'Linha do tempo do agente', onscroll: () => this.aoRolar() });
    this.el.vazio = h('p', { class: 'hist-vazio', hidden: true });
    this.el.pill = h('button', { type: 'button', class: 'hist-pill', hidden: true, onclick: () => this.rolarFim(true) });
    this.el.p.hist.append(barra, this.el.nota, h('div', { class: 'hist-corpo' }, this.el.linha, this.el.vazio, this.el.pill));
    const corpo = h('div', { class: 'det-corpo' }, this.el.p.agora, this.el.p.hist, this.el.p.ferr, this.el.p.ctx);
    r.append(topo, this.el.aviso, nav, corpo);
  }
  limparTudo() {
    this.el.linha.textContent = '';
    for (const k of ['agora', 'ferr', 'ctx']) this.el.p[k].textContent = '';
    this.el.nota.hidden = true; this.el.vazio.hidden = true; this.el.pill.hidden = true;
    this.el.busca.value = '';
    this.el.aviso.hidden = true;
    this.el.nHist.textContent = '';
    this.atualizarChips();
    this.el.p.agora.append(h('p', { class: 'mudo carregando', text: 'Carregando o histórico…' }));
    for (const k of Object.keys(this.el.chips)) this.el.chips[k].setAttribute('aria-pressed', String(k === 'tudo'));
  }
  trocarAba(k) {
    this.aba = k;
    for (const [n, b] of Object.entries(this.el.abas)) { b.setAttribute('aria-selected', String(n === k)); b.tabIndex = n === k ? 0 : -1; this.el.p[n].hidden = n !== k; }
    if (k === 'hist') { this.montarHist(); this.manterFim(); }
  }

  // ---------- cabeçalho vivo (vem do estado em tempo real, não do histórico) ----------
  atualizarEstado() {
    if (!this.id) return;
    const a = this.o.agente(this.id), r = this.resumo || {};
    const plat = this.o.plat((a && a.plataforma) || r.plataforma || (this.id.split(':')[0]));
    this.el.chip.style.setProperty('--c', corOk(plat.cor));
    this.el.chip.title = plat.nome || '';
    this.el.nome.textContent = a && a.apelido ? `${a.apelido} · ${a.nome || r.nome || ''}` : (a && a.nome) || r.nome || this.id;
    this.el.nome.title = this.id;
    const est = (a && a.estado) || r.estado || '';
    this.el.badge.textContent = est || '—';
    this.el.badge.style.setProperty('--c', `var(--e-${ESTADOS.includes(est) ? est : 'ocioso'})`);
    this.el.badge.hidden = !est;
    const ult = (a && a.ultimaAtividade) || r.ultimaAtividade;
    this.el.ha.textContent = '';
    if (ult) this.el.ha.append('atividade ', h('span', { dataset: { desde: ult }, text: this.o.tempo(ult) }));
    const titulo = (a && a.titulo) || r.titulo;
    this.el.titulo.textContent = titulo || ''; this.el.titulo.hidden = !titulo;
    const fer = (a && a.ferramenta) || (a ? null : r.ferramenta), det = (a && a.detalhe) || (a ? null : r.detalhe);
    this.el.atividade.textContent = '';
    this.el.atividade.classList.toggle('ativo', est === 'trabalhando' || est === 'pensando');
    if (fer || det) this.el.atividade.append(h('span', { class: 'spin', 'aria-hidden': 'true' }), h('code', { text: fer ? (det ? `${fer}: ${det}` : fer) : det }));
    else this.el.atividade.append(h('span', { class: 'mudo', text: est === 'pensando' ? 'Gerando uma resposta…' : est === 'ocioso' ? 'Esperando o próximo pedido.' : est === 'esperando' ? 'Esperando uma resposta ou permissão.' : 'Sem ferramenta em uso.' }));
    this.el.atividade.hidden = false;
    // o agente saiu da tela? (some do estado ao vivo)
    if (!a && this.carregou) this.mostrarAviso('Este agente saiu do escritório. O histórico abaixo é o último que foi recebido.', 'saiu');
    else if (a && this.saiu === false && !this.indisponivel) this.el.aviso.hidden = true;
    if (a && this.saiu) { this.saiu = false; this.iniciarPoll(); this.carregar(); }
    this.pintarHero();
  }
  pararPoll() { clearInterval(this.timer); this.timer = null; }
  iniciarPoll() {
    if (this.timer || !this.id) return;
    this.timer = setInterval(() => { if (!document.hidden) this.carregar(); }, POLL_MS);
  }
  mostrarAviso(msg, tipo) { this.el.aviso.textContent = msg; this.el.aviso.dataset.tipo = tipo; this.el.aviso.hidden = false; }

  // ---------- busca de dados ----------
  async carregar() {
    const id = this.id, gen = this.gen;
    if (!id) return;
    if (this._busy === gen) return; this._busy = gen;
    try {
      const r = await this.o.buscar(id, this.versao);
      if (id !== this.id || gen !== this.gen) return;
      if (r.status === 404) {
        if (r.corpo && r.corpo.erro) { this.saiu = true; this.indisponivel = false; this.mostrarAviso('Este agente saiu do escritório. O histórico abaixo é o último que foi recebido.', 'saiu'); this.pararPoll(); }   // sem insistir: volta sozinho se ele reaparecer no estado
        else { this.indisponivel = true; this.mostrarAviso('O histórico deste agente ainda não está disponível no servidor (rota /api/historico).', 'indisponivel'); }
        if (!this.carregou) { this.mostrarVazioAgora(this.saiu ? 'O agente não está mais na tela e não há histórico guardado.' : 'Histórico indisponível no momento.'); this.pintarFerramentas(); this.pintarContexto(); this.mostrarVazioHist(); }
        return;
      }
      if (r.status !== 200 || !r.corpo) throw new Error('HTTP ' + r.status);
      this.saiu = false; this.indisponivel = false;
      if (!this.o.agente(id)) { /* some do estado, mas o servidor ainda tem dados */ } else this.el.aviso.hidden = true;
      const d = r.corpo;
      if (d.mudou === false) return;
      this.aplicar(d);
    } catch (err) {
      if (id === this.id) this.mostrarAviso('Sem conexão com o servidor. Tentando de novo…', 'rede');
    } finally { if (this._busy === gen) this._busy = 0; }
  }
  mostrarVazioAgora(msg) { const p = this.el.p.agora; p.textContent = ''; p.append(h('p', { class: 'mudo', text: msg })); }

  aplicar(d) {
    this.versao = d.versao || null;
    this.resumo = d.resumo || null;
    this.total = d.totalEventos ?? (d.eventos ? d.eventos.length : 0);
    this.cortado = !!d.cortado;
    this.carregou = true;
    if (this.el.aviso.dataset.tipo === 'rede') this.el.aviso.hidden = true;
    const evs = Array.isArray(d.eventos) ? d.eventos : [];
    // histórico recomeçou (índices menores que os que já temos): remonta tudo
    if (evs.length && this.ultimoI >= 0 && evs[evs.length - 1].i < this.ultimoI) {
      this.reg.clear(); this.lista = []; this.ultimoI = -1; this.cont = { tudo: 0, msg: 0, ferr: 0, erro: 0 };
      this.el.linha.textContent = ''; this.histMontado = false;
    }
    const novos = [];
    for (const ev of evs) {
      const reg = this.reg.get(ev.i);
      if (!reg) { if (ev.i > this.ultimoI) novos.push(ev); }
      else if (this.mudouEvento(reg.ev, ev)) this.atualizarEvento(reg, ev);
    }
    // guarda os novos na lista; os nós só existem depois que a aba Histórico foi aberta
    for (const ev of novos) { const reg = { ev, el: null }; this.reg.set(ev.i, reg); this.lista.push(reg); this.ultimoI = ev.i; this.contar(ev, 1); }
    this.nota();
    this.el.nHist.textContent = this.total ? String(this.total) : '';
    if (this.histMontado) this.anexar(novos);
    this.atualizarChips();
    this.pintarAgora();
    this.pintarFerramentas();
    this.pintarContexto();
    this.atualizarEstado();
    if (this.histMontado) this.mostrarVazioHist();
  }
  mudouEvento(a, b) {
    if (a.tipo !== b.tipo) return true;
    if (a.tipo === 'ferramenta') { const x = a.ferramenta || {}, y = b.ferramenta || {}; return x.pendente !== y.pendente || x.erro !== y.erro || (x.saida || '').length !== (y.saida || '').length || x.fimTs !== y.fimTs || x.subagenteId !== y.subagenteId; }
    return (a.texto || '').length !== (b.texto || '').length;
  }
  atualizarEvento(reg, ev) {
    this.contar(reg.ev, -1); reg.ev = ev; this.contar(ev, 1);
    if (reg.el) { const novo = this.criarEvento(ev); this.aplicarVisibilidade(novo, ev); reg.el.replaceWith(novo); reg.el = novo; }
  }

  // ---------- contagens e filtro ----------
  categoria(ev) { return ev.tipo === 'ferramenta' ? 'ferr' : 'msg'; }
  ehErro(ev) { return ev.tipo === 'ferramenta' && !!(ev.ferramenta && ev.ferramenta.erro); }
  contar(ev, delta) {
    this.cont.tudo += delta; this.cont[this.categoria(ev)] += delta;
    if (this.ehErro(ev)) this.cont.erro += delta;
  }
  atualizarChips() { for (const [k, c] of Object.entries(this.el.chips)) c.querySelector('.fn').textContent = String(this.cont[k] || 0); }
  definirFiltro(k) {
    this.filtro = k;
    for (const [n, c] of Object.entries(this.el.chips)) c.setAttribute('aria-pressed', String(n === k));
    this.refiltrar();
  }
  definirBusca(q) { this.busca = q.trim().toLowerCase(); this.refiltrar(); }
  buscaTexto(ev) {
    if (ev._b) return ev._b;
    const f = ev.ferramenta;
    let s = [ev.texto, f && f.nome, f && f.resumo, f && f.saida].filter(Boolean).join('\n');
    if (f && f.entrada != null) { try { s += '\n' + (typeof f.entrada === 'string' ? f.entrada : JSON.stringify(f.entrada)); } catch { /* ignora */ } }
    Object.defineProperty(ev, '_b', { value: s.toLowerCase(), enumerable: false });
    return ev._b;
  }
  visivel(ev) {
    if (this.filtro === 'msg' && ev.tipo === 'ferramenta') return false;
    if (this.filtro === 'ferr' && ev.tipo !== 'ferramenta') return false;
    if (this.filtro === 'erro' && !this.ehErro(ev)) return false;
    if (this.busca && !this.buscaTexto(ev).includes(this.busca)) return false;
    return true;
  }
  aplicarVisibilidade(el, ev) { el.hidden = !this.visivel(ev); }
  refiltrar() {
    for (const reg of this.lista) if (reg.el) reg.el.hidden = !this.visivel(reg.ev);
    this.mostrarVazioHist();
    this.manterFim();
  }
  mostrarVazioHist() {
    const v = this.el.vazio;
    if (!this.lista.length) { v.textContent = this.carregou ? 'Esta plataforma não grava o histórico da conversa (só o resumo, nas outras abas).' : 'Carregando…'; v.hidden = false; return; }
    const algum = this.lista.some((r) => r.el && !r.el.hidden);
    v.textContent = 'Nenhum evento combina com o filtro.'; v.hidden = algum;
  }
  nota() {
    const n = this.el.nota;
    if (this.cortado) { n.textContent = `Mostrando os últimos ${NUM.format(this.lista.length)} de ${NUM.format(this.total)} eventos.`; n.hidden = false; } else n.hidden = true;
  }

  // ---------- linha do tempo (montada uma vez, depois só anexa) ----------
  montarHist() {
    if (this.histMontado) return;
    this.histMontado = true;
    this.el.linha.textContent = '';
    this.anexar(this.lista.filter((r) => !r.el).map((r) => r.ev));
    this.mostrarVazioHist();
  }
  anexar(evs) {
    if (!evs.length) return;
    const frag = document.createDocumentFragment();
    let visiveis = 0;
    for (const ev of evs) {
      const el = this.criarEvento(ev);
      const reg = this.reg.get(ev.i); if (reg) reg.el = el;
      this.aplicarVisibilidade(el, ev);
      if (!el.hidden) visiveis++;
      frag.append(el);
    }
    this.el.linha.append(frag);
    this.mostrarVazioHist();
    if (this.colado) this.rolarFim();
    else if (visiveis) { this.naoLidos += visiveis; this.pintarPill(); }
  }
  aoRolar() {
    const l = this.el.linha;
    this.colado = l.scrollHeight - l.scrollTop - l.clientHeight < 70;
    if (this.colado) { this.naoLidos = 0; this.el.pill.hidden = true; }
  }
  rolarFim(suave) {
    const l = this.el.linha;
    const ir = () => l.scrollTo({ top: l.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
    ir(); if (!suave) requestAnimationFrame(ir);
    this.colado = true; this.naoLidos = 0; this.el.pill.hidden = true;
  }
  manterFim() { if (this.colado) this.rolarFim(); }
  pintarPill() { this.el.pill.textContent = this.naoLidos === 1 ? '1 novo evento ↓' : `${this.naoLidos} novos eventos ↓`; this.el.pill.hidden = false; }

  // ---------- um evento da linha do tempo ----------
  hora(ev) { const t = fmtHora(ev.ts); return t ? h('span', { class: 'ev-hora', text: t }) : null; }
  criarEvento(ev) {
    switch (ev.tipo) {
      case 'usuario': return this.evMensagem(ev, 'usuario', 'Você');
      case 'assistente': return this.evMensagem(ev, 'assistente', 'Agente');
      case 'pensamento': return this.evPensamento(ev);
      case 'ferramenta': return this.evFerramenta(ev);
      default: return h('div', { class: 'ev sistema' }, h('span', { class: 'sis-txt', text: ev.texto || 'evento do sistema' }), this.hora(ev));
    }
  }
  evMensagem(ev, tipo, quem) {
    const texto = String(ev.texto ?? '');
    const LIM = 6000, corte = texto.length > LIM;
    const bolha = h('div', { class: 'bolha' });
    const conteudo = (t) => (tipo === 'assistente' ? mdDom(t) : h('div', { class: 'plano', text: t }));
    bolha.append(conteudo(corte ? texto.slice(0, LIM) : texto));
    if (corte) {
      const mais = h('button', { type: 'button', class: 'mini mais', text: `ver tudo (+${NUM.format(texto.length - LIM)} caracteres)`, onclick: () => { bolha.textContent = ''; bolha.append(conteudo(texto)); } });
      bolha.append(mais);
    }
    return h('div', { class: 'ev ' + tipo }, h('div', { class: 'ev-meta' }, h('span', { class: 'ev-quem', text: quem }), this.hora(ev), tipo === 'assistente' ? botaoCopiar(texto) : null), bolha);
  }
  evPensamento(ev) {
    const texto = String(ev.texto ?? '');
    const prev = texto.replace(/\s+/g, ' ').trim().slice(0, 110);
    let corpo = null;
    const cab = h('div', { class: 'pens-cab', role: 'button', tabindex: '0', 'aria-expanded': 'false' },
      h('span', { class: 'pens-rot', text: 'pensamento' }), h('span', { class: 'pens-prev', text: prev }), this.hora(ev));
    const alt = () => {
      const aberto = cab.getAttribute('aria-expanded') !== 'true';
      cab.setAttribute('aria-expanded', String(aberto));
      if (aberto && !corpo) { corpo = h('div', { class: 'pens-corpo plano', text: texto.length > 12000 ? texto.slice(0, 12000) + '\n… (cortado)' : texto }); el.append(corpo); }
      if (corpo) corpo.hidden = !aberto;
    };
    cab.addEventListener('click', alt);
    cab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alt(); } });
    const el = h('div', { class: 'ev pensamento' }, cab);
    return el;
  }
  evFerramenta(ev) {
    const f = ev.ferramenta || {};
    const st = f.pendente ? 'pend' : f.erro ? 'erro' : 'ok';
    const nome = f.nome || 'ferramenta';
    let hue = 0; for (let i = 0; i < nome.length; i++) hue = (hue * 31 + nome.charCodeAt(i)) % 360;
    const dur = fmtDur(f.duracaoMs);
    let corpo = null;
    const status = f.pendente ? h('span', { class: 'spin', title: 'em execução', 'aria-label': 'em execução' })
      : h('span', { class: 'tool-st st-' + st, title: f.erro ? 'terminou com erro' : 'concluída', text: f.erro ? '✗' : '✓' });
    const cab = h('div', { class: 'tool-cab', role: 'button', tabindex: '0', 'aria-expanded': 'false' },
      h('span', { class: 'tool-icone', style: `--h:${hue}`, text: nome.replace(/[^A-Za-z]/g, '').slice(0, 2) || '·' }),
      h('span', { class: 'tool-nome', text: nome }),
      h('span', { class: 'tool-resumo', text: f.resumo || '' }),
      f.subagenteId ? h('button', { type: 'button', class: 'mini sub', text: 'abrir subagente', onclick: (e) => { e.stopPropagation(); this.o.navegar(f.subagenteId); } }) : null,
      h('span', { class: 'tool-dur', text: dur }), status, this.hora(ev));
    const montar = () => {
      corpo = h('div', { class: 'tool-corpo' });
      corpo.append(h('div', { class: 'tool-sec' }, h('div', { class: 'tool-tit', text: 'entrada' }), blocoEntrada(f.nome, f.entrada)));
      const saida = f.saida;
      const sec = h('div', { class: 'tool-sec' }, h('div', { class: 'tool-tit' }, 'saída', typeof saida === 'string' && saida ? botaoCopiar(saida) : null));
      if (f.pendente) sec.append(h('p', { class: 'mudo', text: 'Ainda executando…' }));
      else if (vazio(saida)) sec.append(h('p', { class: 'mudo', text: f.erro ? 'Terminou com erro, sem texto de saída.' : 'Sem resultado registrado.' }));
      else sec.append(blocoCodigo(typeof saida === 'string' ? saida : JSON.stringify(saida, null, 2), '', { rotulo: f.erro ? 'erro' : 'resultado' }));
      corpo.append(sec);
      el.append(corpo);
    };
    const alt = () => {
      const aberto = cab.getAttribute('aria-expanded') !== 'true';
      cab.setAttribute('aria-expanded', String(aberto));
      if (aberto && !corpo) montar();
      if (corpo) corpo.hidden = !aberto;
    };
    cab.addEventListener('click', alt);
    cab.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === cab) { e.preventDefault(); alt(); } });
    const el = h('div', { class: 'ev ferramenta st-' + st }, cab);
    return el;
  }

  // ---------- aba "Agora" ----------
  pintarHero() {
    const p = this.el.p.agora, hero = p.querySelector('.agora-hero');
    if (!hero) return;
    const a = this.o.agente(this.id), est = (a && a.estado) || (this.resumo && this.resumo.estado) || '';
    hero.dataset.e = ESTADOS.includes(est) ? est : 'ocioso';
    hero.querySelector('.agora-estado').textContent = ROTULO_ESTADO[est] || (est ? est : 'Sem estado');
    const desde = a && a.desde;
    const sub = hero.querySelector('.agora-sub');
    sub.textContent = '';
    if (desde) sub.append('neste estado ', h('span', { dataset: { desde }, text: this.o.tempo(desde) }));
  }
  pintarAgora() {
    const p = this.el.p.agora, r = this.resumo || {};
    const sig = JSON.stringify([this.total, (r.pedidoInicial || '').length, this.lista.slice(-10).map((x) => { const f = x.ev.ferramenta; return [x.ev.i, f ? [f.pendente, f.erro, (f.saida || '').length] : (x.ev.texto || '').length]; })]);
    if (sig === this._sigAgora && p.querySelector('.agora-hero')) { this.pintarHero(); return; }
    this._sigAgora = sig;
    p.textContent = '';
    const hero = h('div', { class: 'agora-hero' }, h('span', { class: 'agora-ponto' }), h('div', null, h('div', { class: 'agora-estado' }), h('div', { class: 'agora-sub' })));
    p.append(hero);
    // ferramenta em execução (a última pendente), com a entrada completa
    let pend = null;
    for (let i = this.lista.length - 1; i >= 0 && i > this.lista.length - 40; i--) { const e = this.lista[i].ev; if (e.tipo === 'ferramenta' && e.ferramenta && e.ferramenta.pendente) { pend = e; break; } }
    const secPend = h('section', { class: 'agora-sec' }, h('h3', { text: 'Ferramenta em execução' }));
    if (pend) {
      const f = pend.ferramenta;
      secPend.append(h('div', { class: 'agora-tool' }, h('span', { class: 'spin' }), h('strong', { text: f.nome || 'ferramenta' }), h('span', { class: 'mudo', text: f.resumo || '' }), this.hora(pend)));
      secPend.append(...blocoEntrada(f.nome, f.entrada));
      if (f.subagenteId) secPend.append(h('button', { type: 'button', class: 'mini sub', text: 'abrir subagente', onclick: () => this.o.navegar(f.subagenteId) }));
    } else secPend.append(h('p', { class: 'mudo', text: this.lista.length ? 'Nenhuma ferramenta em execução neste momento.' : 'Sem eventos registrados para esta sessão.' }));
    p.append(secPend);
    // últimos eventos
    const secUlt = h('section', { class: 'agora-sec' }, h('h3', { text: 'Últimos eventos' }));
    const ult = this.lista.slice(-10);
    if (ult.length) { const caixa = h('div', { class: 'agora-lista' }); for (const reg of ult) caixa.append(this.criarEvento(reg.ev)); secUlt.append(caixa); }
    else secUlt.append(h('p', { class: 'mudo', text: 'Nada por aqui ainda.' }));
    if (this.lista.length > 10) secUlt.append(h('button', { type: 'button', class: 'mini', text: `ver os ${NUM.format(this.total)} eventos`, onclick: () => this.trocarAba('hist') }));
    p.append(secUlt);
    // primeiro pedido
    const secPed = h('section', { class: 'agora-sec' }, h('h3', { text: 'Primeiro pedido' }));
    if (r.pedidoInicial) secPed.append(h('div', { class: 'ev usuario fixo' }, h('div', { class: 'bolha' }, h('div', { class: 'plano', text: r.pedidoInicial }))));
    else secPed.append(h('p', { class: 'mudo', text: 'Não gravado.' }));
    p.append(secPed);
    this.pintarHero();
  }

  // ---------- aba "Ferramentas" ----------
  pintarFerramentas() {
    const p = this.el.p.ferr, r = this.resumo || {};
    p.textContent = '';
    const fs = Array.isArray(r.ferramentas) ? r.ferramentas : [];
    const sec1 = h('section', { class: 'agora-sec' }, h('h3', { text: 'Ferramentas usadas' }));
    if (fs.length) {
      const max = Math.max(1, ...fs.map((f) => f.vezes || 0));
      const tab = h('div', { class: 'ferr-tab', role: 'table' }, h('div', { class: 'ferr-l cab', role: 'row' }, h('span', { text: 'Ferramenta' }), h('span', { text: '' }), h('span', { class: 'num', text: 'Vezes' }), h('span', { class: 'num', text: 'Erros' })));
      for (const f of fs) {
        tab.append(h('div', { class: 'ferr-l', role: 'row' },
          h('span', { class: 'ferr-nome', text: f.nome }),
          h('span', { class: 'ferr-barra' }, h('i', { style: `width:${Math.max(2, Math.round(100 * (f.vezes || 0) / max))}%` }), (f.erros ? h('b', { style: `width:${Math.round(100 * f.erros / max)}%` }) : null)),
          h('span', { class: 'num', text: fmtNum(f.vezes) }),
          h('span', { class: 'num' + (f.erros ? ' erro' : ''), text: f.erros ? fmtNum(f.erros) : '0' })));
      }
      sec1.append(tab);
    } else sec1.append(h('p', { class: 'mudo', text: 'Nenhuma ferramenta registrada.' }));
    p.append(sec1);
    const as = Array.isArray(r.arquivos) ? r.arquivos : [];
    const sec2 = h('section', { class: 'agora-sec' }, h('h3', { text: 'Arquivos tocados' }));
    if (as.length) {
      const lista = h('ul', { class: 'arq-lista' });
      for (const a of as) {
        lista.append(h('li', { class: 'arq' },
          h('span', { class: 'arq-cam', title: a.caminho, text: abreviar(a.caminho) }),
          h('span', { class: 'arq-acoes' }, (a.acoes || []).map((x) => h('span', { class: 'acao a-' + String(x).toLowerCase(), text: x }))),
          h('span', { class: 'num', title: 'vezes', text: a.vezes != null ? `${NUM.format(a.vezes)}×` : '' })));
      }
      sec2.append(lista);
    } else sec2.append(h('p', { class: 'mudo', text: 'Nenhum arquivo registrado.' }));
    p.append(sec2);
  }

  // ---------- aba "Contexto" ----------
  pintarContexto() {
    const p = this.el.p.ctx, r = this.resumo || {}, a = this.o.agente(this.id);
    p.textContent = '';
    const dl = h('dl', { class: 'ctx' });
    const campo = (rot, valor, extra) => {
      const dd = h('dd', null, typeof valor === 'object' && valor && valor.nodeType ? valor : dash(valor));
      if (extra) dd.append(extra);
      dl.append(h('dt', { text: rot }), dd);
    };
    const copia = (v) => (vazio(v) ? null : botaoCopiar(String(v)));
    campo('Modelo', r.modelo ?? (a && a.modelo));
    campo('Projeto', r.projeto ?? (a && a.projeto));
    campo('Diretório', r.cwd, copia(r.cwd));
    campo('Branch', r.branch);
    campo('Sessão', r.sessao, copia(r.sessao));
    campo('Arquivo', r.arquivo, copia(r.arquivo));
    campo('Entrypoint', r.entrypoint);
    campo('Versão', r.versaoCli);
    campo('Papel', (a && a.papel) ?? r.papel);
    // pai e filhos: o servidor manda; se faltar, vale o que o estado ao vivo diz
    const pai = r.pai || (a && a.paiId ? { id: a.paiId, nome: (this.o.agente(a.paiId) || {}).nome || a.paiId } : null);
    const apPai = pai && (this.o.agente(pai.id) || {}).apelido;
    campo('Pai', pai ? h('button', { type: 'button', class: 'ctx-link', text: apPai ? `${apPai} · ${pai.nome || pai.id}` : pai.nome || pai.id, onclick: () => this.o.navegar(pai.id) }) : null);
    const filhos = Array.isArray(r.filhos) && r.filhos.length ? r.filhos : (this.o.filhos ? this.o.filhos(this.id) : []);
    campo('Filhos', filhos.length ? h('div', { class: 'ctx-filhos' }, filhos.map((f) => {
      const vivo = this.o.agente(f.id), est = (vivo && vivo.estado) || f.estado;
      return h('button', { type: 'button', class: 'ctx-filho', title: f.titulo || '', onclick: () => this.o.navegar(f.id) },
        h('span', { text: (this.o.agente(f.id) || {}).apelido || f.nome || f.id }), est ? h('span', { class: 'badge', style: `--c:var(--e-${ESTADOS.includes(est) ? est : 'ocioso'})`, text: est }) : null);
    })) : null);
    campo('Início', fmtDataHora(r.iniciadoEm));
    campo('Duração', r.duracaoMs != null ? fmtDur(r.duracaoMs) : null);
    campo('Mensagens', r.mensagens ? `${fmtNum(r.mensagens.usuario)} do usuário · ${fmtNum(r.mensagens.assistente)} do agente` : null);
    const c = r.contexto;
    if (c && typeof c.tokens === 'number') {
      const pct = typeof c.janela === 'number' && c.janela > 0 ? Math.min(100, Math.round(100 * c.tokens / c.janela)) : null;
      campo('Contexto atual', h('div', { class: 'ctx-uso' },
        h('span', { text: `${NUM.format(c.tokens)} tokens${pct != null ? ` · ${pct}% de ${NUM.format(c.janela)}` : ''}` }),
        pct != null ? h('span', { class: 'barra' + (pct > 85 ? ' alta' : '') }, h('i', { style: `width:${pct}%` })) : null));
    } else campo('Contexto atual', null);
    const t = r.tokens;
    campo('Tokens somados', t ? h('div', { class: 'ctx-tokens' },
      h('span', { text: `entrada ${fmtNum(t.entrada)}` }), h('span', { text: `saída ${fmtNum(t.saida)}` }),
      h('span', { text: `cache lido ${fmtNum(t.cacheLido)}` }), h('span', { text: `cache criado ${fmtNum(t.cacheCriado)}` })) : null);
    campo('Custo', typeof r.custoUSD === 'number' ? `US$ ${NUM2.format(r.custoUSD)}` : null);
    p.append(dl);
  }
}
