/* app.js — liga os dados (SSE / polling / demo) à cena e à interface em volta. */
import { Office } from './render.js';
import { Detalhe } from './detalhe.js';

const $ = (id) => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const NARROW = window.matchMedia('(max-width: 699px)');

// ---------- armazenamento local (pode falhar em janela anônima) ----------
const guardar = (k, v) => { try { localStorage.setItem('escritorio.' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
const carregar = (k, padrao) => { try { const v = localStorage.getItem('escritorio.' + k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } };

const ESTADOS = ['trabalhando', 'pensando', 'esperando', 'ocioso', 'saindo'];
const ORDEM = Object.fromEntries(ESTADOS.map((e, i) => [e, i]));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let estado = { plataformas: [], agentes: [] };
let ocultas = new Set(carregar('ocultas', []));
let selecionado = null;      // id do agente selecionado
let hoverDado = null;        // agente sob o mouse
let dicaFixa = null;         // {id, x, y} para toque (não há hover)
let ultimaListaHtml = '';
let ultimoFiltrosHtml = '';

// ---------- a cena ----------
const canvas = $('cena');
const office = new Office(canvas);
window.__escritorio = { office }; // útil para depurar no console (e nos testes)
function aplicarTema() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--cena-bg').trim();
  office.setBackground(bg || '#0b0e14');
}
aplicarTema();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', aplicarTema);
office.setHidden(ocultas);
office.start();

office.onHover = (dado, x, y) => { hoverDado = dado; mostrarDica(dado, x, y); };
office.onSelect = (id, info) => {
  selecionado = id;
  dicaFixa = id && info && info.touch ? { id, x: info.x, y: info.y } : null;
  realcarSelecao();
  if (!(info && info.touch)) mostrarDica(hoverDado, info ? info.x : 0, info ? info.y : 0);
  else atualizarDicaFixa();
  // clicar num agente abre o detalhe; clicar no vazio fecha
  if (id) { detalhe.abrir(id); if (!NARROW.matches) { const a = office.actors.get(id); if (a && coberto(a)) centrar(id); } }
  else detalhe.fechar({ avisar: false });
};

// ---------- botões da câmera e do painel ----------
$('z-mais').addEventListener('click', () => office.zoomBy(1));
$('z-menos').addEventListener('click', () => office.zoomBy(-1));
$('z-reset').addEventListener('click', () => office.resetView());

function definirPainel(aberto) {
  $('app').dataset.painel = aberto ? 'aberto' : 'fechado';
  $('btn-painel').setAttribute('aria-expanded', String(aberto));
  $('alca').setAttribute('aria-expanded', String(aberto));
  guardar(NARROW.matches ? 'painel-estreito' : 'painel', aberto);
}
const painelAberto = () => $('app').dataset.painel === 'aberto';
$('btn-painel').addEventListener('click', () => definirPainel(!painelAberto()));
$('alca').addEventListener('click', () => definirPainel(!painelAberto()));
// estado inicial: aberto no desktop, fechado (só a alça) no celular
definirPainel(carregar(NARROW.matches ? 'painel-estreito' : 'painel', !NARROW.matches));
NARROW.addEventListener('change', () => definirPainel(carregar(NARROW.matches ? 'painel-estreito' : 'painel', !NARROW.matches)));

// ---------- tempo no estado ("há 2 min") ----------
function tempo(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return 'agora';
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
  return `há ${Math.floor(h / 24)} d`;
}
setInterval(() => {
  for (const el of document.querySelectorAll('[data-desde]')) el.textContent = tempo(Number(el.dataset.desde));
}, 1000);

// ---------- dicionários ----------
const platMeta = (id) => estado.plataformas.find((p) => p.id === id) || { id, nome: id, cor: '#8b93a1' };
const visiveis = () => estado.agentes.filter((a) => !ocultas.has(a.plataforma));
const agentePorId = (id) => estado.agentes.find((a) => a.id === id);

// ---------- detalhe de um agente (histórico, ferramentas, contexto) ----------
async function buscarHistorico(id, versao) {
  if (DEMO) { const m = await import('./demo.js'); return m.historicoDemo(id, versao); }
  const url = '/api/historico?id=' + encodeURIComponent(id) + (versao ? '&versao=' + encodeURIComponent(versao) : '');
  const r = await fetch(url, { cache: 'no-store' });
  let corpo = null;
  try { corpo = await r.json(); } catch { /* sem corpo JSON */ }
  return { status: r.status, corpo };
}
function destacar(id) {      // marca na cena (sem abrir nada); se o agente ainda não chegou no estado, marca quando chegar
  const existe = !!agentePorId(id);
  selecionado = existe ? id : null; dicaFixa = null;
  office.setSelected(existe ? id : null);
  realcarSelecao();
}
// a gaveta cobre o lado direito da cena no desktop: o agente fica no meio da parte que sobra
function areaLivre() {
  const wrap = $('cena-wrap'), palco = wrap.parentElement;
  const dw = detalhe.aberto() && !NARROW.matches ? $('detalhe').offsetWidth : 0;
  return { cw: wrap.clientWidth, livre: Math.min(wrap.clientWidth, palco.clientWidth - dw) };
}
function coberto(a) {
  const { livre } = areaLivre();
  return (a.fx * office.k + office.tx) / office.dpr > livre - 40;
}
function centrar(id) {
  const { cw, livre } = areaLivre();
  office.centerOn(id, NARROW.matches ? 0 : (cw - livre) * office.dpr);
}
function selecionarEAbrir(id) {    // pai/filho/subagente: seleciona na cena (se estiver lá) e troca o detalhe
  destacar(id);
  detalhe.abrir(id);
  if (agentePorId(id)) centrar(id);
}
const detalhe = new Detalhe({
  raiz: $('detalhe'),
  agente: (id) => agentePorId(id) || null,
  filhos: (id) => estado.agentes.filter((a) => a.paiId === id),
  plat: (id) => platMeta(id),
  tempo,
  buscar: buscarHistorico,
  aoFechar: () => { selecionado = null; dicaFixa = null; office.setSelected(null); realcarSelecao(); },
  navegar: selecionarEAbrir,
  aoAbrirDoHash: (id) => destacar(id),
});
window.__escritorio.detalhe = detalhe;

// ---------- cabeçalho: contagens ----------
function atualizarContagens() {
  const c = { trabalhando: 0, pensando: 0, esperando: 0, ocioso: 0 };
  for (const a of visiveis()) if (a.estado in c) c[a.estado]++;
  $('c-trabalhando').textContent = c.trabalhando;
  $('c-pensando').textContent = c.pensando;
  $('c-esperando').textContent = c.esperando;
  $('c-ocioso').textContent = c.ocioso;
  $('cont-esperando').hidden = c.esperando === 0;
  $('painel-total').textContent = visiveis().length;
  $('vazio').hidden = visiveis().length > 0;
}

// ---------- painel: filtros por plataforma ----------
function plataformasListadas() {
  const mapa = new Map();
  for (const p of estado.plataformas) if (p.conectada || p.ativos > 0) mapa.set(p.id, p);
  for (const a of estado.agentes) if (!mapa.has(a.plataforma)) mapa.set(a.plataforma, platMeta(a.plataforma));
  return [...mapa.values()];
}
function renderFiltros() {
  const ps = plataformasListadas();
  const html = ps.map((p) => `<button type="button" class="filtro" data-p="${esc(p.id)}" aria-pressed="${!ocultas.has(p.id)}" style="--c:${esc(p.cor || '#8b93a1')}" title="${ocultas.has(p.id) ? 'Mostrar' : 'Ocultar'} ${esc(p.nome)}"><span class="chip"></span><span class="nome">${esc(p.nome)}</span></button>`).join('');
  if (html !== ultimoFiltrosHtml) { ultimoFiltrosHtml = html; $('filtros').innerHTML = html; }
}
$('filtros').addEventListener('click', (e) => {
  const b = e.target.closest('.filtro');
  if (!b) return;
  const id = b.dataset.p;
  if (ocultas.has(id)) ocultas.delete(id); else ocultas.add(id);
  guardar('ocultas', [...ocultas]);
  if (selecionado && ocultas.has((agentePorId(selecionado) || {}).plataforma)) selecionado = null;
  office.setHidden(ocultas);
  office.setSelected(selecionado);
  renderTudo();
});

// ---------- painel: lista agrupada por plataforma ----------
// devolve os agentes de uma plataforma em árvore (subagentes sob o pai), com o nível de recuo
function emArvore(lista) {
  const ids = new Set(lista.map((a) => a.id));
  const filhos = new Map();
  const raizes = [];
  for (const a of lista) {
    if (a.paiId && ids.has(a.paiId)) { if (!filhos.has(a.paiId)) filhos.set(a.paiId, []); filhos.get(a.paiId).push(a); } else raizes.push(a);
  }
  const porInicio = (x, y) => (x.iniciadoEm || 0) - (y.iniciadoEm || 0) || String(x.id).localeCompare(String(y.id));
  const saida = [];
  const visita = (a, nivel, vistos) => {
    if (vistos.has(a.id)) return;
    vistos.add(a.id);
    saida.push({ a, nivel });
    for (const f of (filhos.get(a.id) || []).sort(porInicio)) visita(f, Math.min(nivel + 1, 2), vistos);
  };
  const vistos = new Set();
  for (const r of raizes.sort(porInicio)) visita(r, 0, vistos);
  for (const a of lista) visita(a, 0, vistos); // ciclos esquisitos: nada some da lista
  return saida;
}
function detalheTexto(a) {
  if (a.ferramenta) return a.detalhe ? `${a.ferramenta}: ${a.detalhe}` : a.ferramenta;
  return a.detalhe || '';
}
function renderLista() {
  const grupos = [];
  const usados = new Set();
  for (const p of estado.plataformas) { grupos.push(p); usados.add(p.id); }
  for (const a of estado.agentes) if (!usados.has(a.plataforma)) { grupos.push(platMeta(a.plataforma)); usados.add(a.plataforma); }
  const sel = selecionado && agentePorId(selecionado);
  const rel = new Set();
  if (sel) { if (sel.paiId) rel.add(sel.paiId); for (const a of estado.agentes) if (a.paiId === sel.id) rel.add(a.id); }

  let html = '';
  for (const p of grupos) {
    if (ocultas.has(p.id)) continue;
    const ags = estado.agentes.filter((a) => a.plataforma === p.id);
    if (!ags.length) continue;
    html += `<section class="grupo" data-p="${esc(p.id)}"><div class="grupo-topo" style="--c:${esc(p.cor || '#8b93a1')}"><span class="chip"></span><span>${esc(p.nome)}</span><span class="n">${ags.length}</span></div><ul class="itens">`;
    for (const { a, nivel } of emArvore(ags)) {
      const det = detalheTexto(a);
      const pai = a.paiId && !ags.some((x) => x.id === a.paiId) ? agentePorId(a.paiId) : null;
      const classe = ['item', a.id === selecionado ? 'sel' : '', rel.has(a.id) ? 'rel' : ''].filter(Boolean).join(' ');
      html += `<li class="${classe}" data-id="${esc(a.id)}" data-nivel="${nivel}" style="--nivel:${nivel}"><button type="button" class="item-btn" data-id="${esc(a.id)}" data-e="${esc(a.estado)}">`
        + `<span class="item-nome">${esc(a.nome || a.id)}${pai ? `<small>chamado por ${esc(pai.nome || pai.id)}</small>` : a.papel === 'subagente' && nivel === 0 ? '<small>subagente</small>' : ''}</span>`
        + `<span class="badge" style="--c:var(--e-${esc(ESTADOS.includes(a.estado) ? a.estado : 'ocioso')})">${esc(a.estado)}</span>`
        + `<span class="item-det${det ? '' : ' sem'}">${esc(det || (a.titulo || a.projeto || '—'))}</span>`
        + `<span class="item-tempo" data-desde="${Number(a.desde) || 0}">${esc(tempo(a.desde))}</span></button></li>`;
    }
    html += '</ul></section>';
  }
  if (!html) html = '<p class="lista-vazia">Nenhum agente por aqui. Eles aparecem quando uma sessão abre.</p>';
  if (html === ultimaListaHtml) return;
  ultimaListaHtml = html;
  const lista = $('lista');
  const foco = document.activeElement && document.activeElement.closest && document.activeElement.closest('#lista') ? document.activeElement.dataset.id : null;
  const rolagem = lista.scrollTop;
  lista.innerHTML = html;
  lista.scrollTop = rolagem;
  if (foco) { const el = lista.querySelector(`.item-btn[data-id="${CSS.escape(foco)}"]`); if (el) el.focus({ preventScroll: true }); }
}
$('lista').addEventListener('click', (e) => {
  const b = e.target.closest('.item-btn');
  if (!b) return;
  const id = b.dataset.id;
  selecionado = id; dicaFixa = null;
  office.setSelected(id);
  detalhe.abrir(id);
  centrar(id);
  realcarSelecao();
  if (NARROW.matches) definirPainel(false); // no celular, recolhe a gaveta para ver a cena
});
function realcarSelecao() {
  ultimaListaHtml = '';
  renderLista();
  // rola só a lista (scrollIntoView mexeria também na gaveta recolhida e esconderia o título dela)
  const el = $('lista').querySelector('.item.sel');
  if (el && painelAberto()) {
    const l = $('lista'), r = el.getBoundingClientRect(), lr = l.getBoundingClientRect();
    if (r.top < lr.top) l.scrollTop -= lr.top - r.top + 8; else if (r.bottom > lr.bottom) l.scrollTop += r.bottom - lr.bottom + 8;
  }
  $('painel').scrollTop = 0;
}

// ---------- dica (tooltip) ----------
const dica = $('dica');
function conteudoDica(a) {
  const p = platMeta(a.plataforma);
  const linhas = [];
  const add = (k, v) => { if (v) linhas.push(`<dt>${k}</dt><dd>${esc(v)}</dd>`); };
  add('Plataforma', p.nome);
  add('Projeto', a.projeto);
  add('Título', a.titulo);
  if (a.ferramenta || a.detalhe) add('Ferramenta', detalheTexto(a));
  add('Modelo', a.modelo);
  if (a.papel && a.papel !== 'principal') add('Papel', a.papel === 'chamado' ? 'chamado por ' + ((agentePorId(a.paiId) || {}).nome || 'outro agente') : a.papel);
  linhas.push(`<dt>No estado</dt><dd data-desde="${Number(a.desde) || 0}">${esc(tempo(a.desde))}</dd>`);
  return `<div class="dica-topo"><span class="bolinha" style="--c:${esc(p.cor || '#8b93a1')}"></span><b>${esc(a.nome || a.id)}</b>`
    + `<span class="badge" style="--c:var(--e-${esc(ESTADOS.includes(a.estado) ? a.estado : 'ocioso')})">${esc(a.estado)}</span></div><dl>${linhas.join('')}</dl>`;
}
function posicionarDica(cx, cy) {
  const wrap = $('cena-wrap').getBoundingClientRect();
  let x = cx - wrap.left + 14, y = cy - wrap.top + 16;
  const w = dica.offsetWidth, h = dica.offsetHeight;
  if (x + w > wrap.width - 8) x = cx - wrap.left - w - 14;
  if (y + h > wrap.height - 8) y = cy - wrap.top - h - 14;
  dica.style.left = Math.max(8, x) + 'px';
  dica.style.top = Math.max(8, y) + 'px';
}
let dicaId = null;
function mostrarDica(dado, x, y) {
  if (!dado) { if (dicaFixa) { atualizarDicaFixa(); return; } dica.hidden = true; dicaId = null; return; }
  if (detalhe.aberto() && dado.id === detalhe.id) { dica.hidden = true; dicaId = null; return; }   // o detalhe já mostra tudo desse agente
  const atual = agentePorId(dado.id) || dado;
  const html = conteudoDica(atual);
  if (dicaId !== atual.id || dica.dataset.h !== html) { dica.innerHTML = html; dica.dataset.h = html; dicaId = atual.id; }
  dica.hidden = false;
  posicionarDica(x, y);
}
function atualizarDicaFixa() {
  const a = dicaFixa && agentePorId(dicaFixa.id);
  if (!a) { dicaFixa = null; dica.hidden = true; return; }
  mostrarDica(a, dicaFixa.x, dicaFixa.y);
}
// toque fora de um agente tira a dica fixa
canvas.addEventListener('pointerdown', () => { if (dicaFixa) { dicaFixa = null; if (!hoverDado) dica.hidden = true; } });

// ---------- aplicar um estado novo ----------
function renderTudo() {
  atualizarContagens();
  renderFiltros();
  renderLista();
  if (hoverDado) { const a = agentePorId(hoverDado.id); if (!a) { hoverDado = null; dica.hidden = true; } }
  if (dicaFixa) atualizarDicaFixa();
}
function aplicar(novo) {
  if (!novo || !Array.isArray(novo.agentes)) return;
  estado = { plataformas: Array.isArray(novo.plataformas) ? novo.plataformas : [], agentes: novo.agentes, geradoEm: novo.geradoEm };
  if (selecionado && !agentePorId(selecionado)) { selecionado = null; office.setSelected(null); }
  office.setState(estado);
  renderTudo();
  detalhe.atualizarEstado();
  if (detalhe.aberto() && selecionado !== detalhe.id && agentePorId(detalhe.id)) destacar(detalhe.id);   // aberto pelo endereço (#agente=…)
}

window.__escritorio.aplicar = aplicar;

// ---------- conexão: SSE com plano B por polling ----------
const STATUS = { conectando: 'conectando', aovivo: 'ao vivo', reconectando: 'reconectando', demo: 'demo' };
function status(k) { $('status').dataset.estado = k; $('status-txt').textContent = STATUS[k]; }
let es = null, timerPoll = null, timerRetry = null;

async function buscarEstado() {
  try {
    const r = await fetch('/api/estado', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    aplicar(await r.json());
  } catch { /* o servidor pode estar fora; tenta de novo no próximo ciclo */ }
}
function iniciarPoll() { if (!timerPoll) { buscarEstado(); timerPoll = setInterval(buscarEstado, 2000); } }
function pararPoll() { if (timerPoll) { clearInterval(timerPoll); timerPoll = null; } }
function conectar() {
  clearTimeout(timerRetry);
  try { es = new EventSource('/api/eventos'); } catch { es = null; }
  if (!es) { status('reconectando'); iniciarPoll(); timerRetry = setTimeout(conectar, 3000); return; }
  const fonte = es;
  fonte.onopen = () => { status('aovivo'); pararPoll(); buscarEstado(); }; // pega o estado atual mesmo que o servidor só empurre mudanças
  fonte.addEventListener('estado', (e) => {
    try { aplicar(JSON.parse(e.data)); } catch (err) { console.warn('estado inválido', err); return; }
    status('aovivo'); pararPoll();
  });
  fonte.onerror = () => {
    status('reconectando'); iniciarPoll();
    if (fonte.readyState === 2) { fonte.close(); clearTimeout(timerRetry); timerRetry = setTimeout(conectar, 3000); } // o navegador desistiu: recomeça
  };
}

if (detalhe.idDoHash()) detalhe.doHash();   // reabre o detalhe se o endereço trouxer #agente=…
if (DEMO) {
  status('demo');
  import('./demo.js').then((m) => m.iniciarDemo(aplicar));
} else {
  status('conectando');
  conectar();
}
// Esc tira a seleção
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && detalhe.aberto()) { detalhe.fechar(); return; }    // fecha o detalhe (e tira a seleção, pelo aoFechar)
  if (e.key === 'Escape' && selecionado) { selecionado = null; dicaFixa = null; office.setSelected(null); realcarSelecao(); dica.hidden = !hoverDado; }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !DEMO && !es) conectar(); });
