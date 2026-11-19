// Claude Code: lê as transcrições em ~/.claude/projects/<pasta>/<sessão>.jsonl e os
// subagentes em <sessão>/subagents/agent-<id>.jsonl (+ .meta.json).
// Também transforma as chamadas MCP aos outros modelos (DeepSeek, Alibaba) e ao
// Telegram em agentes "chamados", ligados a quem chamou.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { lerCauda, jsonl, recentes, stat, detalheDaFerramenta, curto, pastaCurta } from './util.js';
import { origens } from './origens.js';

const MIN = 60_000;
const JANELA = 15 * MIN;        // arquivo mexido há mais que isso não entra
const OCIOSO_SOME = 10 * MIN;   // ocioso por mais que isso some
const PENSANDO_MAX = 3 * MIN;   // "pensando" sem escrever nada vira ocioso
const FERRAMENTA_MAX = 45 * MIN; // ferramenta pendurada há mais que isso: sessão morta
const SAINDO_MS = 12_000;       // quanto tempo o que terminou fica "saindo"

// Servidores MCP que viram personagem próprio
const CHAMADOS = {
  deepseek: { plataforma: 'deepseek', nome: 'DeepSeek flash' },
  alibaba: { plataforma: 'alibaba', nome: 'Alibaba (imagem)' },
  telegram: { plataforma: 'telegram', nome: 'Telegram' },
};

const cache = new Map(); // arquivo → { chave, resumo }

/** Resume uma transcrição: estado, ferramenta pendente, chamadas MCP… */
export function resumirTranscricao(registros, agora = Date.now()) {
  const pendentes = new Map(); // tool_use_id → { nome, entrada, ts }
  const terminadas = [];       // chamadas MCP que já voltaram: { id, nome, entrada, ts, fim }
  let ultimo = null;           // 'usuario' | 'resultado' | 'pensamento' | 'texto' | 'ferramenta' | 'interrompido'
  let ultimoTs = 0;
  let parada = null;
  let modelo = null, cwd = null, titulo = null, tituloFixo = null, inicio = null;
  let erroEm = null, erroFerramenta = null, interrompidoEm = null, compactadoEm = null;

  for (const r of registros) {
    const ts = r.timestamp ? Date.parse(r.timestamp) : 0;
    if (ts && (!inicio || ts < inicio)) inicio = ts;
    if (r.cwd) cwd = r.cwd;
    if (r.type === 'ai-title' && r.aiTitle) titulo = r.aiTitle;
    if (r.type === 'custom-title' && r.customTitle) tituloFixo = r.customTitle;
    if (r.type === 'system' && r.subtype === 'compact_boundary') { if (ts) compactadoEm = ts; continue; }
    if (r.type !== 'user' && r.type !== 'assistant') continue;
    const msg = r.message || {};
    const conteudo = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content ?? '') }];
    if (r.type === 'assistant') {
      if (msg.model && !String(msg.model).startsWith('<')) modelo = msg.model;
      parada = msg.stop_reason ?? parada;
      for (const b of conteudo) {
        if (b.type === 'tool_use') {
          pendentes.set(b.id, { nome: b.name, entrada: b.input, ts });
          ultimo = 'ferramenta';
        } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          ultimo = 'pensamento';
        } else if (b.type === 'text' && b.text?.trim()) {
          ultimo = 'texto';
        }
      }
    } else {
      let teveResultado = false;
      for (const b of conteudo) {
        if (b.type === 'tool_result') {
          teveResultado = true;
          const p = pendentes.get(b.tool_use_id);
          // erro de ferramenta; a recusa do usuário ("doesn't want to proceed") conta como interrupção
          const recusa = b.is_error && RECUSA.test(textoDoResultado(b));
          if (recusa) interrompidoEm = ts || interrompidoEm;
          else if (b.is_error) { erroEm = ts || erroEm; erroFerramenta = p ? nomeDaFerramenta(p.nome) : erroFerramenta; }
          if (p) {
            pendentes.delete(b.tool_use_id);
            if (String(p.nome).startsWith('mcp__')) terminadas.push({ id: b.tool_use_id, ...p, fim: ts, erro: !!b.is_error && !recusa });
          }
        }
      }
      if (teveResultado) ultimo = 'resultado';
      else {
        const texto = conteudo.map((b) => b.text || '').join(' ');
        if (/\[Request interrupted/i.test(texto)) { ultimo = 'interrompido'; pendentes.clear(); interrompidoEm = ts || interrompidoEm; }
        else if (!r.isMeta) ultimo = 'usuario';
      }
    }
    if (ts) ultimoTs = ts;
  }

  // estado do agente
  let estado = 'ocioso', ferramenta = null, detalhe = null, desde = ultimoTs || agora;
  const lista = [...pendentes.entries()];
  if (lista.length) {
    const [, p] = lista[lista.length - 1];
    ferramenta = nomeDaFerramenta(p.nome);
    detalhe = detalheDaFerramenta(p.nome, p.entrada);
    desde = p.ts || desde;
    if (/^(Agent|Task|AskUserQuestion)$/.test(p.nome) || /__ask$/.test(p.nome)) estado = 'esperando';
    else estado = 'trabalhando';
    if (agora - desde > FERRAMENTA_MAX) estado = 'morto';
  } else if (ultimo === 'usuario' || ultimo === 'resultado' || ultimo === 'pensamento' || (ultimo === 'ferramenta')) {
    estado = agora - ultimoTs > PENSANDO_MAX ? 'ocioso' : 'pensando';
  } else {
    estado = 'ocioso';
  }

  return {
    estado, ferramenta, detalhe, desde, ultimoTs, modelo, cwd,
    titulo: tituloFixo || titulo, inicio,
    pendentes: lista.map(([id, p]) => ({ id, ...p })),
    terminadas,
    erroEm, erroFerramenta, interrompidoEm, compactadoEm,
  };
}

const RECUSA = /doesn't want to proceed|user (rejected|denied|declined)|tool use was rejected/i;
function textoDoResultado(b) {
  const c = b.content;
  if (typeof c === 'string') return c.slice(0, 400);
  if (Array.isArray(c)) return c.map((x) => (typeof x?.text === 'string' ? x.text : '')).join(' ').slice(0, 400);
  return '';
}

function nomeDaFerramenta(nome) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(nome));
  if (m) return `${m[1].replace(/^claude_ai_/, '')}·${m[2]}`;
  return nome;
}

function resumoComCache(arquivo, s) {
  const chave = `${s.mtimeMs}:${s.size}`;
  const c = cache.get(arquivo);
  if (c && c.chave === chave) return c.resumo;
  const resumo = resumirTranscricao(jsonl(lerCauda(arquivo)));
  cache.set(arquivo, { chave, resumo });
  return resumo;
}

function lerMeta(arquivo) {
  try { return JSON.parse(fs.readFileSync(arquivo.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { return {}; }
}

/** Chamadas MCP (DeepSeek, Alibaba, Telegram) viram agentes "chamados". */
function chamadosDe(resumo, paiId, agora) {
  const out = [];
  const add = (c, estado, desde) => {
    const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(String(c.nome));
    if (!m) return;
    const tipo = CHAMADOS[m[1]];
    if (!tipo) return;
    origens.set(`${tipo.plataforma}:${c.id}`, { tipo: 'chamado', arquivo: resumo.arquivo, toolUseId: c.id, paiId });
    out.push({
      id: `${tipo.plataforma}:${c.id}`,
      plataforma: tipo.plataforma,
      nome: tipo.nome,
      titulo: null,
      projeto: null,
      papel: 'chamado',
      paiId,
      estado,
      ferramenta: m[2],
      detalhe: tipo.plataforma === 'telegram' ? null : detalheDaFerramenta(m[2], c.entrada),
      modelo: c.entrada?.model || (tipo.plataforma === 'deepseek' ? 'deepseek-flash' : null),
      desde,
      ultimaAtividade: desde,
      iniciadoEm: c.ts || desde,
      erroEm: c.erro ? c.fim : null,
      erroFerramenta: c.erro ? m[2] : null,
      interrompidoEm: null,
      compactadoEm: null,
    });
  };
  for (const c of resumo.pendentes) add(c, /__ask$/.test(c.nome) ? 'esperando' : 'trabalhando', c.ts || agora);
  for (const c of resumo.terminadas) if (c.fim && agora - c.fim < SAINDO_MS) add(c, 'saindo', c.fim);
  return out;
}

export function criarFonteClaude({ raiz = path.join(os.homedir(), '.claude', 'projects') } = {}) {
  return {
    id: 'claude',
    conectada: () => !!stat(raiz),
    ler() {
      const agora = Date.now();
      const agentes = [];
      const arquivos = recentes(raiz, (n) => n.endsWith('.jsonl'), JANELA, 3);
      const vistos = new Set(arquivos.map((a) => a.arquivo));
      // a sessão que espera um subagente longo pode ficar sem escrever: entra pelo filho
      // e não some por estar "ociosa" enquanto o filho trabalha
      const comFilhoAtivo = new Set();
      for (const a of [...arquivos]) {
        const partes = a.arquivo.split(path.sep);
        const i = partes.lastIndexOf('subagents');
        if (i < 0) continue;
        const pai = partes.slice(0, i).join(path.sep) + '.jsonl';
        if (agora - a.mtime < OCIOSO_SOME) comFilhoAtivo.add(pai);
        if (!vistos.has(pai) && stat(pai)) {
          vistos.add(pai);
          arquivos.push({ arquivo: pai, mtime: a.mtime, criado: stat(pai).birthtimeMs });
        }
      }
      for (const k of cache.keys()) if (!vistos.has(k)) cache.delete(k);

      for (const { arquivo, mtime, criado } of arquivos) {
        const s = stat(arquivo);
        if (!s) continue;
        const partes = arquivo.split(path.sep);
        const ehSub = partes.includes('subagents');
        if (!ehSub && partes.length - partes.lastIndexOf('projects') !== 3) continue; // só <pasta>/<sessão>.jsonl
        const r = resumoComCache(arquivo, s);
        r.arquivo = arquivo;
        if (r.estado === 'morto') continue;

        let id, paiId = null, papel = 'principal', nome, titulo = r.titulo, estado = r.estado;
        if (ehSub) {
          const sessao = partes[partes.indexOf('subagents') - 1];
          const agenteId = path.basename(arquivo, '.jsonl').replace(/^agent-/, '');
          const meta = lerMeta(arquivo);
          id = `claude:sub:${agenteId}`;
          paiId = `claude:${sessao}`;
          papel = 'subagente';
          nome = meta.agentType || 'subagente';
          titulo = meta.description || null;
          if (meta.finished || (estado === 'ocioso')) {
            if (agora - mtime > SAINDO_MS) continue;
            estado = 'saindo';
          }
        } else {
          id = `claude:${path.basename(arquivo, '.jsonl')}`;
          nome = pastaCurta(r.cwd) || 'Claude';
          if (estado === 'ocioso' && agora - mtime > OCIOSO_SOME && !comFilhoAtivo.has(arquivo)) continue;
        }
        origens.set(id, { tipo: ehSub ? 'claude-sub' : 'claude', arquivo });
        agentes.push({
          id, plataforma: 'claude', nome, titulo: curto(titulo, 80), projeto: pastaCurta(r.cwd),
          papel, paiId, estado,
          ferramenta: estado === 'saindo' ? null : r.ferramenta,
          detalhe: estado === 'saindo' ? null : r.detalhe,
          modelo: r.modelo, desde: r.desde || mtime, ultimaAtividade: mtime,
          iniciadoEm: r.inicio || criado || mtime,
          erroEm: r.erroEm, erroFerramenta: r.erroFerramenta, interrompidoEm: r.interrompidoEm, compactadoEm: r.compactadoEm,
        });
        agentes.push(...chamadosDe(r, id, agora));
      }
      // subagente sem o pai na lista (pai ficou fora da janela): vira principal
      const ids = new Set(agentes.map((a) => a.id));
      for (const a of agentes) if (a.paiId && !ids.has(a.paiId)) { a.paiId = null; if (a.papel === 'subagente') a.papel = 'principal'; }
      return agentes;
    },
  };
}
