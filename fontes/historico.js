// Histórico completo de um agente (GET /api/historico). Lê a transcrição inteira,
// mas de forma incremental: guarda até onde já leu e só processa o que foi acrescentado.
// As transcrições do Claude passam de 40 MB, então nada de reler tudo a cada 3 s.
import fs from 'node:fs';
import path from 'node:path';
import { origens } from './origens.js';
import { detalheDaFerramenta, stat } from './util.js';

const MAX_EVENTOS_GUARDADOS = 6000;
const MAX_EVENTOS_ENVIADOS = 1500;
const MAX_TEXTO = 12_000;
const MAX_ENTRADA = 4000;
const MAX_SAIDA = 6000;
const ARQUIVOS_DE = /^(Read|Edit|Write|MultiEdit|NotebookEdit|read_file|edit_file|write_file|StrReplace|Delete|search_replace|apply_patch)$/i;

const estados = new Map(); // arquivo → estado do parser

function cortar(s, max) {
  if (s == null) return null;
  s = String(s);
  return s.length > max ? s.slice(0, max) + `\n… (+${s.length - max} caracteres)` : s;
}

function cortarObjeto(v, max = MAX_ENTRADA, fundo = 0) {
  if (v == null) return v;
  if (typeof v === 'string') return cortar(v, max);
  if (typeof v !== 'object') return v;
  if (fundo > 4) return '…';
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => cortarObjeto(x, max, fundo + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = cortarObjeto(x, max, fundo + 1);
  return o;
}

function textoDoConteudo(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((b) => {
      if (typeof b === 'string') return b;
      if (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') return b.text || '';
      if (b.type === 'image') return '[imagem]';
      if (b.type === 'tool_reference') return `[ferramenta ${b.tool_name || ''}]`;
      return '';
    }).filter(Boolean).join('\n');
  }
  if (typeof c === 'object' && c.text) return c.text;
  return JSON.stringify(c);
}

/** Tira os <system-reminder> e outras marcações que o usuário não escreveu. */
function limparPedido(t) {
  return String(t || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '[seleção do editor]')
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
    .replace(/<\/?user_query>/g, '')
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '')
    .trim();
}

function novoEstado(arquivo, tipo) {
  return {
    arquivo, tipo, offset: 0, resto: '', versao: null,
    eventos: [], total: 0, porTool: new Map(), usos: new Map(),
    ferramentas: new Map(), arquivos: new Map(), msgs: { usuario: 0, assistente: 0 },
    modelo: null, cwd: null, branch: null, entrypoint: null, versaoCli: null, sessao: null,
    titulo: null, tituloFixo: null, custo: null, pedidoInicial: null, inicio: null, fim: null,
    ultimoUso: null, tokensCodex: null,
  };
}

function addEvento(st, ev) {
  ev.i = st.total++;
  st.eventos.push(ev);
  if (st.eventos.length > MAX_EVENTOS_GUARDADOS) {
    const fora = st.eventos.splice(0, st.eventos.length - MAX_EVENTOS_GUARDADOS);
    for (const e of fora) if (e.ferramenta?.id) st.porTool.delete(e.ferramenta.id);
  }
  return ev;
}

function marcarTs(st, ts) {
  if (!ts) return;
  if (!st.inicio || ts < st.inicio) st.inicio = ts;
  if (!st.fim || ts > st.fim) st.fim = ts;
}

function contarFerramenta(st, nome, entrada) {
  const f = st.ferramentas.get(nome) || { nome, vezes: 0, erros: 0 };
  f.vezes++;
  st.ferramentas.set(nome, f);
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const caminho = e.file_path || e.notebook_path || e.target_file || (ARQUIVOS_DE.test(nome) ? e.path : null);
  if (caminho && typeof caminho === 'string') {
    const a = st.arquivos.get(caminho) || { caminho, acoes: [], vezes: 0 };
    a.vezes++;
    if (!a.acoes.includes(nome)) a.acoes.push(nome);
    st.arquivos.set(caminho, a);
  }
}

function abrirFerramenta(st, { id, nome, entrada, ts }) {
  contarFerramenta(st, nome, entrada);
  const ev = addEvento(st, {
    tipo: 'ferramenta', ts: ts || null,
    ferramenta: {
      id: id || null, nome, resumo: detalheDaFerramenta(nome, entrada),
      entrada: cortarObjeto(entrada), saida: null, erro: false, pendente: true, fimTs: null, duracaoMs: null,
    },
  });
  if (id) st.porTool.set(id, ev);
  return ev;
}

function fecharFerramenta(st, id, saida, erro, ts) {
  const ev = st.porTool.get(id);
  if (!ev) return;
  const f = ev.ferramenta;
  f.saida = cortar(saida, MAX_SAIDA);
  f.erro = !!erro;
  f.pendente = false;
  f.fimTs = ts || null;
  if (ts && ev.ts) f.duracaoMs = ts - ev.ts;
  if (erro) { const c = st.ferramentas.get(f.nome); if (c) c.erros++; }
}

// ---------- Claude Code ----------
function registroClaude(st, r) {
  const ts = r.timestamp ? Date.parse(r.timestamp) : null;
  if (r.cwd) st.cwd = r.cwd;
  if (r.gitBranch && r.gitBranch !== 'HEAD') st.branch = r.gitBranch;
  if (r.entrypoint) st.entrypoint = r.entrypoint;
  if (r.version) st.versaoCli = r.version;
  if (r.sessionId) st.sessao = r.sessionId;
  if (r.type === 'ai-title') st.titulo = r.aiTitle;
  if (r.type === 'custom-title') st.tituloFixo = r.customTitle;
  if (r.type === 'cost-state' && r.totalCostUSD != null) st.custo = Number(r.totalCostUSD);
  if (r.type === 'system' && (r.content || r.subtype)) {
    marcarTs(st, ts);
    const texto = r.subtype === 'compact_boundary' ? 'contexto compactado' : textoDoConteudo(r.content);
    if (texto && r.level !== 'debug') addEvento(st, { tipo: 'sistema', ts, texto: cortar(texto, 2000) });
    return;
  }
  if (r.type !== 'user' && r.type !== 'assistant') return;
  marcarTs(st, ts);
  const msg = r.message || {};
  const blocos = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];

  if (r.type === 'assistant') {
    if (msg.model && !String(msg.model).startsWith('<')) st.modelo = msg.model;
    if (msg.usage) { st.usos.set(msg.id || r.uuid, msg.usage); st.ultimoUso = msg.usage; }
    for (const b of blocos) {
      if (b.type === 'text' && b.text?.trim()) {
        st.msgs.assistente++;
        addEvento(st, { tipo: 'assistente', ts, texto: cortar(b.text, MAX_TEXTO) });
      } else if ((b.type === 'thinking') && b.thinking?.trim()) {
        addEvento(st, { tipo: 'pensamento', ts, texto: cortar(b.thinking, MAX_TEXTO) });
      } else if (b.type === 'tool_use') {
        abrirFerramenta(st, { id: b.id, nome: b.name, entrada: b.input, ts });
      }
    }
    return;
  }

  // usuário: resultados de ferramenta e pedidos
  const textos = [];
  for (const b of blocos) {
    if (b.type === 'tool_result') fecharFerramenta(st, b.tool_use_id, textoDoConteudo(b.content), b.is_error, ts);
    else if (b.type === 'text') textos.push(b.text || '');
    else if (b.type === 'image') textos.push('[imagem]');
  }
  if (!textos.length) return;
  const bruto = textos.join('\n');
  if (/\[Request interrupted/i.test(bruto)) {
    for (const ev of st.porTool.values()) if (ev.ferramenta.pendente) { ev.ferramenta.pendente = false; ev.ferramenta.erro = true; ev.ferramenta.saida = ev.ferramenta.saida ?? '(interrompido)'; }
    addEvento(st, { tipo: 'sistema', ts, texto: 'interrompido pelo usuário' });
    return;
  }
  const texto = limparPedido(bruto);
  if (!texto) return;
  // aviso automático (subagente/tarefa em segundo plano terminou): não é pedido do usuário
  if (/<task-notification>/.test(texto) || /^\[SYSTEM NOTIFICATION/.test(texto)) {
    const resumo = /<summary>([\s\S]*?)<\/summary>/.exec(texto)?.[1] || /<status>([\s\S]*?)<\/status>/.exec(texto)?.[1] || 'tarefa em segundo plano';
    addEvento(st, { tipo: 'sistema', ts, texto: `aviso automático: ${resumo.trim()}` });
    return;
  }
  if (r.isMeta || /^<(command-|local-command|bash-)/.test(texto)) {
    addEvento(st, { tipo: 'sistema', ts, texto: cortar(texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 2000) });
    return;
  }
  st.msgs.usuario++;
  if (!st.pedidoInicial) st.pedidoInicial = cortar(texto, 2000);
  addEvento(st, { tipo: 'usuario', ts, texto: cortar(texto, MAX_TEXTO) });
}

// ---------- Cursor (sem horários nem resultados) ----------
const MESES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function tsDoCursor(t) {
  // <timestamp>Friday, Nov 13, 2026, 9:27 AM (UTC-3)</timestamp>
  const m = /<timestamp>\w+, (\w{3}) (\d+), (\d{4}), (\d+):(\d+) (AM|PM) \(UTC([+-]\d+)?\)<\/timestamp>/.exec(t || '');
  if (!m) return null;
  let h = Number(m[4]) % 12; if (m[6] === 'PM') h += 12;
  const fuso = Number(m[7] || 0);
  return Date.UTC(Number(m[3]), MESES[m[1].toLowerCase()] ?? 0, Number(m[2]), h - fuso, Number(m[5]));
}
function registroCursor(st, r) {
  if (r.type === 'turn_ended') { addEvento(st, { tipo: 'sistema', ts: null, texto: `vez encerrada (${r.status || 'ok'})` }); return; }
  const blocos = r.message?.content;
  if (!Array.isArray(blocos)) return;
  if (r.role === 'user') {
    const bruto = blocos.map((b) => b.text || '').join('\n');
    const ts = tsDoCursor(bruto);
    marcarTs(st, ts);
    const texto = limparPedido(bruto);
    if (!texto) return;
    st.msgs.usuario++;
    if (!st.pedidoInicial) st.pedidoInicial = cortar(texto, 2000);
    addEvento(st, { tipo: 'usuario', ts, texto: cortar(texto, MAX_TEXTO) });
    return;
  }
  for (const b of blocos) {
    if (b.type === 'text' && b.text?.trim()) { st.msgs.assistente++; addEvento(st, { tipo: 'assistente', ts: null, texto: cortar(b.text, MAX_TEXTO) }); }
    else if (b.type === 'tool_use') {
      const ev = abrirFerramenta(st, { id: null, nome: b.name, entrada: b.input, ts: null });
      ev.ferramenta.pendente = false; // o Cursor não grava o resultado
      ev.ferramenta.saida = null;
      ev.ferramenta.semResultado = true;
    }
  }
}

// ---------- Codex ----------
function registroCodex(st, r) {
  const ts = r.timestamp ? Date.parse(r.timestamp) : null;
  marcarTs(st, ts);
  const p = r.payload || {};
  if (r.type === 'session_meta') { st.cwd = p.cwd || st.cwd; st.sessao = p.id || st.sessao; st.versaoCli = p.cli_version || st.versaoCli; st.branch = p.git?.branch || st.branch; return; }
  if (r.type === 'turn_context' && p.model) { st.modelo = p.model; return; }
  if (r.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) { st.tokensCodex = p.info.total_token_usage; st.janela = p.info.model_context_window ?? null; st.contextoCodex = p.info.last_token_usage?.input_tokens ?? null; return; }
  if (r.type !== 'response_item') return;
  if (p.type === 'message') {
    const texto = textoDoConteudo(p.content);
    if (p.role === 'user') {
      const t = limparPedido(texto);
      if (!t || /^<(environment_context|user_instructions)/.test(t)) return;
      st.msgs.usuario++; if (!st.pedidoInicial) st.pedidoInicial = cortar(t, 2000);
      addEvento(st, { tipo: 'usuario', ts, texto: cortar(t, MAX_TEXTO) });
    } else if (p.role === 'assistant' && texto.trim()) {
      st.msgs.assistente++; addEvento(st, { tipo: 'assistente', ts, texto: cortar(texto, MAX_TEXTO) });
    }
  } else if (p.type === 'reasoning') {
    const t = (p.summary || []).map((s) => s.text || '').join('\n');
    if (t.trim()) addEvento(st, { tipo: 'pensamento', ts, texto: cortar(t, MAX_TEXTO) });
  } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
    let args = p.arguments ?? p.input ?? p.action;
    try { if (typeof args === 'string') args = JSON.parse(args); } catch {}
    abrirFerramenta(st, { id: p.call_id || p.id, nome: p.name || p.type, entrada: args, ts });
  } else if (/_output$/.test(p.type || '')) {
    let out = p.output;
    if (out && typeof out === 'object') out = out.content ?? JSON.stringify(out);
    fecharFerramenta(st, p.call_id, out, false, ts);
  }
}

function processarLinhas(st, linhas) {
  for (const l of linhas) {
    if (!l.trim()) continue;
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (st.tipo === 'cursor') registroCursor(st, r);
    else if (st.tipo === 'codex') registroCodex(st, r);
    else registroClaude(st, r);
  }
}

/** Lê o que foi acrescentado desde a última vez. Se o arquivo encolheu, recomeça. */
function atualizar(arquivo, tipo) {
  const s = stat(arquivo);
  if (!s) return null;
  let st = estados.get(arquivo);
  if (!st || s.size < st.offset) { st = novoEstado(arquivo, tipo); estados.set(arquivo, st); }
  const versao = `${Math.round(s.mtimeMs)}:${s.size}`;
  if (st.versao === versao) return st;
  if (tipo === 'gemini') {
    // JSON inteiro, reescrito a cada mensagem
    st = novoEstado(arquivo, tipo); estados.set(arquivo, st);
    try { lerGemini(st, JSON.parse(fs.readFileSync(arquivo, 'utf8'))); } catch {}
    st.versao = versao;
    return st;
  }
  const fd = fs.openSync(arquivo, 'r');
  try {
    const PEDACO = 4 * 1024 * 1024;
    while (st.offset < s.size) {
      const n = Math.min(PEDACO, s.size - st.offset);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, st.offset);
      st.offset += n;
      const texto = st.resto + buf.toString('utf8');
      const linhas = texto.split('\n');
      st.resto = linhas.pop();
      processarLinhas(st, linhas);
    }
  } finally { fs.closeSync(fd); }
  // a última linha pode estar completa sem o \n final
  if (st.resto && st.resto.trim().endsWith('}')) {
    try { JSON.parse(st.resto); processarLinhas(st, [st.resto]); st.resto = ''; } catch {}
  }
  st.versao = versao;
  return st;
}

function lerGemini(st, dados) {
  st.sessao = dados.sessionId || null;
  for (const m of dados.messages || []) {
    const ts = m.timestamp ? Date.parse(m.timestamp) : null;
    marcarTs(st, ts);
    const texto = textoDoConteudo(m.content);
    if (m.type === 'user') { st.msgs.usuario++; if (!st.pedidoInicial) st.pedidoInicial = cortar(texto, 2000); addEvento(st, { tipo: 'usuario', ts, texto: cortar(texto, MAX_TEXTO) }); continue; }
    if (m.model) st.modelo = m.model;
    for (const t of m.thoughts || []) addEvento(st, { tipo: 'pensamento', ts, texto: cortar(`${t.subject || ''}\n${t.description || ''}`.trim(), MAX_TEXTO) });
    if (texto.trim()) { st.msgs.assistente++; addEvento(st, { tipo: 'assistente', ts, texto: cortar(texto, MAX_TEXTO) }); }
    for (const c of m.toolCalls || []) {
      const ev = abrirFerramenta(st, { id: c.id, nome: c.name, entrada: c.args, ts });
      if (c.status && c.status !== 'executing' && c.status !== 'scheduled') {
        const saida = Array.isArray(c.result) ? c.result.map((x) => JSON.stringify(x.functionResponse?.response ?? x)).join('\n') : c.resultDisplay ?? JSON.stringify(c.result ?? '');
        fecharFerramenta(st, c.id, saida, c.status === 'error', ts);
        if (!c.id) ev.ferramenta.pendente = false;
      }
    }
  }
}

function somarTokens(st) {
  if (st.tokensCodex) {
    const t = st.tokensCodex;
    return { entrada: t.input_tokens ?? 0, saida: t.output_tokens ?? 0, cacheLido: t.cached_input_tokens ?? 0, cacheCriado: 0 };
  }
  if (!st.usos.size) return null;
  const t = { entrada: 0, saida: 0, cacheLido: 0, cacheCriado: 0 };
  for (const u of st.usos.values()) {
    t.entrada += u.input_tokens || 0;
    t.saida += u.output_tokens || 0;
    t.cacheLido += u.cache_read_input_tokens || 0;
    t.cacheCriado += u.cache_creation_input_tokens || 0;
  }
  return t;
}

function subagentesDaSessao(arquivoSessao) {
  // <sessão>.jsonl → <sessão>/subagents/agent-<id>.meta.json (toolUseId → id do agente)
  const dir = path.join(arquivoSessao.replace(/\.jsonl$/, ''), 'subagents');
  const mapa = new Map();
  let nomes = [];
  try { nomes = fs.readdirSync(dir); } catch { return mapa; }
  for (const n of nomes) {
    if (!n.endsWith('.meta.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      if (meta.toolUseId) mapa.set(meta.toolUseId, `claude:sub:${n.replace(/^agent-/, '').replace(/\.meta\.json$/, '')}`);
    } catch {}
  }
  return mapa;
}

/**
 * Monta a resposta do histórico. `agente` é o objeto do estado atual (da tela);
 * `todos` são os agentes da tela (para pai e filhos).
 */
export function historico(agente, todos, versaoPedida) {
  const origem = origens.get(agente.id);
  const pai = agente.paiId ? todos.find((a) => a.id === agente.paiId) : null;
  const filhos = todos.filter((a) => a.paiId === agente.id).map((a) => ({ id: a.id, nome: a.nome, titulo: a.titulo, estado: a.estado, plataforma: a.plataforma }));
  const base = {
    plataforma: agente.plataforma, nome: agente.nome, titulo: agente.titulo, estado: agente.estado,
    ferramenta: agente.ferramenta, detalhe: agente.detalhe, modelo: agente.modelo, projeto: agente.projeto,
    papel: agente.papel, iniciadoEm: agente.iniciadoEm, ultimaAtividade: agente.ultimaAtividade,
    duracaoMs: agente.ultimaAtividade && agente.iniciadoEm ? agente.ultimaAtividade - agente.iniciadoEm : null,
    cwd: null, branch: null, sessao: null, arquivo: null, entrypoint: null, versaoCli: null,
    pedidoInicial: null, contexto: null, tokens: null, custoUSD: null, mensagens: null,
    ferramentas: [], arquivos: [], pai: pai ? { id: pai.id, nome: pai.nome } : null, filhos,
  };

  // sem arquivo: agente externo
  if (!origem || !origem.arquivo) {
    const versao = `ext:${agente.ultimaAtividade}:${agente.estado}:${filhos.length}`;
    if (versaoPedida === versao) return { id: agente.id, versao, mudou: false };
    return { id: agente.id, versao, mudou: true, resumo: base, totalEventos: 0, cortado: false, eventos: [] };
  }

  const tipoParser = origem.tipo === 'cursor' ? 'cursor' : origem.tipo === 'codex' ? 'codex' : origem.tipo === 'gemini' ? 'gemini' : 'claude';
  const st = atualizar(origem.arquivo, tipoParser);
  if (!st) return { id: agente.id, versao: 'sumiu', mudou: true, resumo: base, totalEventos: 0, cortado: false, eventos: [] };

  // chamada MCP (DeepSeek, Alibaba, Telegram): o histórico é só a chamada dentro da sessão de quem chamou
  if (origem.tipo === 'chamado') {
    const ev = st.porTool.get(origem.toolUseId);
    const versao = `${st.versao}:${ev?.ferramenta.pendente ? 'p' : 'f'}:${agente.estado}`;
    if (versaoPedida === versao) return { id: agente.id, versao, mudou: false };
    const eventos = [];
    if (ev) {
      const e = ev.ferramenta.entrada || {};
      const pedido = e.prompt || e.message || e.text || (Array.isArray(e.messages) ? e.messages.map((m) => `${m.role}: ${textoDoConteudo(m.content)}`).join('\n\n') : null) || (Array.isArray(e.requests) ? e.requests.map((q, i) => `#${i + 1} ${q.prompt || JSON.stringify(q)}`).join('\n\n') : null);
      if (pedido) eventos.push({ i: 0, tipo: 'usuario', ts: ev.ts, texto: cortar(pedido, MAX_TEXTO) });
      eventos.push({ ...ev, i: 1 });
      if (ev.ferramenta.saida) eventos.push({ i: 2, tipo: 'assistente', ts: ev.ferramenta.fimTs, texto: ev.ferramenta.saida });
      base.pedidoInicial = pedido ? cortar(pedido, 2000) : null;
      base.ferramentas = [{ nome: ev.ferramenta.nome, vezes: 1, erros: ev.ferramenta.erro ? 1 : 0 }];
      base.mensagens = { usuario: pedido ? 1 : 0, assistente: ev.ferramenta.saida ? 1 : 0 };
      base.duracaoMs = ev.ferramenta.duracaoMs;
    }
    base.arquivo = origem.arquivo;
    base.sessao = st.sessao;
    base.cwd = st.cwd;
    return { id: agente.id, versao, mudou: true, resumo: base, totalEventos: eventos.length, cortado: false, eventos };
  }

  const versao = `${st.versao}:${agente.estado}:${agente.ferramenta || ''}:${filhos.map((f) => f.id + f.estado).join(',')}`;
  if (versaoPedida === versao) return { id: agente.id, versao, mudou: false };

  // liga as chamadas Agent/Task aos subagentes
  if (st.tipo === 'claude') {
    const subs = subagentesDaSessao(origem.tipo === 'claude-sub' ? origem.arquivo.replace(/[\\/]subagents[\\/][^\\/]+$/, '.jsonl') : origem.arquivo);
    for (const [toolId, ev] of st.porTool) {
      if (/^(Agent|Task)$/.test(ev.ferramenta.nome) && subs.has(toolId)) ev.ferramenta.subagenteId = subs.get(toolId);
    }
  }

  const u = st.ultimoUso;
  const contexto = st.contextoCodex != null
    ? { tokens: st.contextoCodex, janela: st.janela ?? null }
    : u ? { tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), janela: null } : null;

  const resumo = {
    ...base,
    titulo: st.tituloFixo || st.titulo || base.titulo,
    modelo: st.modelo || base.modelo,
    cwd: st.cwd, branch: st.branch, sessao: st.sessao, arquivo: origem.arquivo,
    entrypoint: st.entrypoint, versaoCli: st.versaoCli,
    iniciadoEm: st.inicio || base.iniciadoEm,
    ultimaAtividade: Math.max(st.fim || 0, base.ultimaAtividade || 0) || null,
    pedidoInicial: st.pedidoInicial,
    contexto, tokens: somarTokens(st), custoUSD: st.custo,
    mensagens: { ...st.msgs },
    ferramentas: [...st.ferramentas.values()].sort((a, b) => b.vezes - a.vezes),
    arquivos: [...st.arquivos.values()].sort((a, b) => b.vezes - a.vezes).slice(0, 200),
  };
  resumo.duracaoMs = resumo.ultimaAtividade && resumo.iniciadoEm ? resumo.ultimaAtividade - resumo.iniciadoEm : null;
  const eventos = st.eventos.slice(-MAX_EVENTOS_ENVIADOS);
  return { id: agente.id, versao, mudou: true, resumo, totalEventos: st.total, cortado: st.total > eventos.length, eventos };
}

/** Esquece os arquivos que não estão mais na tela (libera memória). */
export function limparHistoricos(arquivosVivos) {
  for (const k of estados.keys()) if (!arquivosVivos.has(k)) estados.delete(k);
}
