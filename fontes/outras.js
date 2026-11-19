// Codex CLI e Gemini CLI. Neste PC eles ainda não têm sessões, então a leitura é
// pelo formato documentado e conservadora: se não entender, mostra só "trabalhando"
// pela data do arquivo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { jsonl, recentes, stat, detalheDaFerramenta, curto, pastaCurta } from './util.js';
import { origens } from './origens.js';

const MIN = 60_000;
const JANELA = 15 * MIN;
const OCIOSO_SOME = 10 * MIN;
const PARADO = 3 * MIN;

function agenteBase(plataforma, id, mtime, criado) {
  return {
    id: `${plataforma}:${id}`, plataforma, nome: plataforma, titulo: null, projeto: null,
    papel: 'principal', paiId: null, estado: 'ocioso', ferramenta: null, detalhe: null,
    modelo: null, desde: mtime, ultimaAtividade: mtime, iniciadoEm: criado || mtime,
  };
}

function fechar(a, mtime, agora) {
  if (a.estado !== 'ocioso' && agora - mtime > PARADO) { a.estado = 'ocioso'; a.ferramenta = null; a.detalhe = null; }
  return a.estado === 'ocioso' && agora - mtime > OCIOSO_SOME ? null : a;
}

// ~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl (Codex CLI / extensão VS Code ≥ 0.16x).
// O session_meta (cwd) fica no COMEÇO do arquivo e o turn_context (model) logo em
// seguida; mas as sessões reais passam de MB com folga e a cauda (512 KB) nunca os
// alcança. Por isso aqui o arquivo é lido por inteiro (com cache por tamanho+mtime)
// e resumido: estado atual + projeto, modelo e título. O título real vem da primeira
// mensagem de usuário (role:user) — não existe "event_msg/user_message" no formato.

function textoConteudo(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b.text || '')).filter(Boolean).join('\n');
  return c.text || '';
}

function limparInicio(t) {
  return String(t || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
    .replace(/<user_instructions>[\s\S]*?<\/user_instructions>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resume os registros de uma sessão Codex: estado, ferramenta, projeto, modelo, título. */
export function resumirCodex(registros) {
  let estado = 'pensando', ferramenta = null, detalhe = null;
  let projeto = null, modelo = null, titulo = null;
  for (const r of registros) {
    const p = r.payload || {};
    if (r.type === 'session_meta') {
      if (p.cwd) projeto = pastaCurta(p.cwd);
    } else if (r.type === 'turn_context') {
      if (p.cwd && !projeto) projeto = pastaCurta(p.cwd);
      if (p.model) modelo = p.model;
    } else if (r.type === 'response_item') {
      if (p.type === 'message') {
        const t = limparInicio(textoConteudo(p.content));
        if (p.role === 'user' && t && !titulo) titulo = t;
      } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
        let args = p.arguments ?? p.input ?? p.action;
        try { if (typeof args === 'string') args = JSON.parse(args); } catch {}
        estado = 'trabalhando';
        ferramenta = p.name || p.type;
        detalhe = detalheDaFerramenta(p.name, args) || curto(Array.isArray(args?.command) ? args.command.join(' ') : null);
      } else if (/_output$/.test(p.type || '')) {
        estado = 'pensando'; ferramenta = null; detalhe = null;
      }
    } else if (r.type === 'event_msg') {
      if (p.type === 'user_message') { estado = 'pensando'; if (p.message && !titulo) titulo = limparInicio(p.message); }
      else if (p.type === 'task_started') estado = 'pensando';
      else if (p.type === 'task_complete' || p.type === 'turn_aborted') { estado = 'ocioso'; ferramenta = null; detalhe = null; }
    }
  }
  return { estado, ferramenta, detalhe, nome: projeto || 'Codex', projeto, modelo, titulo: curto(titulo, 80) };
}

const cacheCodex = new Map(); // arquivo → { chave, resumo }
function resumoCodexComCache(arquivo, s) {
  const chave = `${s.mtimeMs}:${s.size}`;
  const c = cacheCodex.get(arquivo);
  if (c && c.chave === chave) return c.resumo;
  let resumo;
  try { resumo = resumirCodex(jsonl(fs.readFileSync(arquivo, 'utf8').split('\n'))); }
  catch { resumo = { estado: 'pensando', ferramenta: null, detalhe: null, nome: 'Codex', projeto: null, modelo: null, titulo: null }; }
  cacheCodex.set(arquivo, { chave, resumo });
  return resumo;
}

export function criarFonteCodex({ raiz = path.join(os.homedir(), '.codex', 'sessions') } = {}) {
  return {
    id: 'codex',
    conectada: () => !!stat(raiz),
    ler() {
      const agora = Date.now();
      const out = [];
      const vistos = new Set();
      for (const { arquivo, mtime, criado } of recentes(raiz, (n) => n.endsWith('.jsonl'), JANELA, 4)) {
        vistos.add(arquivo);
        const s = stat(arquivo);
        if (!s) continue;
        const r = resumoCodexComCache(arquivo, s);
        const a = agenteBase('codex', path.basename(arquivo, '.jsonl'), mtime, criado);
        a.nome = r.nome; a.projeto = r.projeto; a.modelo = r.modelo; a.titulo = r.titulo;
        a.estado = r.estado; a.ferramenta = r.ferramenta; a.detalhe = r.detalhe;
        origens.set(a.id, { tipo: 'codex', arquivo });
        const f = fechar(a, mtime, agora);
        if (f) out.push(f);
      }
      for (const k of cacheCodex.keys()) if (!vistos.has(k)) cacheCodex.delete(k);
      return out;
    },
  };
}

// ~/.gemini/tmp/<hash>/chats/session-*.json
export function criarFonteGemini({ raiz = path.join(os.homedir(), '.gemini', 'tmp') } = {}) {
  return {
    id: 'gemini',
    conectada: () => !!stat(raiz),
    ler() {
      const agora = Date.now();
      const out = [];
      for (const { arquivo, mtime, criado } of recentes(raiz, (n, p) => n.endsWith('.json') && p.includes('chats'), JANELA, 3)) {
        const a = agenteBase('gemini', path.basename(arquivo, '.json'), mtime, criado);
        origens.set(a.id, { tipo: 'gemini', arquivo });
        a.nome = 'Gemini';
        a.estado = 'pensando';
        try {
          const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
          const msgs = dados.messages || [];
          const ultima = msgs[msgs.length - 1];
          const user = [...msgs].reverse().find((m) => m.type === 'user');
          if (user) a.titulo = curto(typeof user.content === 'string' ? user.content : JSON.stringify(user.content), 80);
          if (ultima?.model) a.modelo = ultima.model;
          const chamadas = ultima?.toolCalls || [];
          const pendente = chamadas.find((c) => c.status && !/success|error|cancelled/.test(c.status));
          if (pendente) { a.estado = 'trabalhando'; a.ferramenta = pendente.name; a.detalhe = detalheDaFerramenta(pendente.name, pendente.args); }
          else if (ultima?.type === 'gemini' && !chamadas.length) a.estado = 'ocioso';
        } catch {}
        const f = fechar(a, mtime, agora);
        if (f) out.push(f);
      }
      return out;
    },
  };
}

// Agentes que se registram pelo POST /api/agente (bots, assistentes, scripts, outros LLMs…)
export function criarFonteExterna() {
  const agentes = new Map();
  const VIDA = 2 * MIN;
  return {
    id: 'externa',
    conectada: () => true,
    receber(dados) {
      if (!dados || typeof dados.id !== 'string' || !dados.id.trim()) throw new Error('falta o id');
      const id = `ext:${dados.id.slice(0, 80)}`;
      if (dados.estado === 'encerrado') { agentes.delete(id); return; }
      const estados = ['trabalhando', 'pensando', 'esperando', 'ocioso', 'saindo'];
      if (!estados.includes(dados.estado)) throw new Error(`estado inválido: ${dados.estado}`);
      const agora = Date.now();
      const antigo = agentes.get(id);
      const plataformas = ['claude', 'cursor', 'codex', 'gemini', 'deepseek', 'alibaba', 'telegram', 'outro'];
      agentes.set(id, {
        id,
        plataforma: plataformas.includes(dados.plataforma) ? dados.plataforma : 'outro',
        nome: curto(dados.nome || dados.id, 30),
        titulo: curto(dados.titulo, 80),
        projeto: curto(dados.projeto, 40),
        papel: dados.paiId ? (dados.papel === 'chamado' ? 'chamado' : 'subagente') : 'principal',
        paiId: dados.paiId ? String(dados.paiId) : null,
        estado: dados.estado,
        ferramenta: curto(dados.ferramenta, 30),
        detalhe: curto(dados.detalhe),
        modelo: curto(dados.modelo, 40),
        desde: antigo && antigo.estado === dados.estado ? antigo.desde : agora,
        ultimaAtividade: agora,
        iniciadoEm: antigo?.iniciadoEm || agora,
      });
    },
    ler() {
      const agora = Date.now();
      for (const [id, a] of agentes) if (agora - a.ultimaAtividade > VIDA) agentes.delete(id);
      return [...agentes.values()];
    },
  };
}
