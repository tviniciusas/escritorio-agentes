// Codex CLI e Gemini CLI. Neste PC eles ainda não têm sessões, então a leitura é
// pelo formato documentado e conservadora: se não entender, mostra só "trabalhando"
// pela data do arquivo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { lerCauda, jsonl, recentes, stat, detalheDaFerramenta, curto, pastaCurta } from './util.js';
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

// ~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl
export function criarFonteCodex({ raiz = path.join(os.homedir(), '.codex', 'sessions') } = {}) {
  return {
    id: 'codex',
    conectada: () => !!stat(raiz),
    ler() {
      const agora = Date.now();
      const out = [];
      for (const { arquivo, mtime, criado } of recentes(raiz, (n) => n.endsWith('.jsonl'), JANELA, 4)) {
        const a = agenteBase('codex', path.basename(arquivo, '.jsonl'), mtime, criado);
        origens.set(a.id, { tipo: 'codex', arquivo });
        a.estado = 'pensando';
        for (const r of jsonl(lerCauda(arquivo))) {
          const p = r.payload || {};
          if (r.type === 'session_meta' && p.cwd) { a.projeto = pastaCurta(p.cwd); a.nome = a.projeto; }
          if (r.type === 'turn_context' && p.model) a.modelo = p.model;
          if (r.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call')) {
            let args = p.arguments;
            try { if (typeof args === 'string') args = JSON.parse(args); } catch {}
            a.estado = 'trabalhando';
            a.ferramenta = p.name || p.type;
            a.detalhe = detalheDaFerramenta(p.name, args) || curto(Array.isArray(args?.command) ? args.command.join(' ') : null);
          }
          if (r.type === 'response_item' && /_output$/.test(p.type || '')) { a.estado = 'pensando'; a.ferramenta = null; a.detalhe = null; }
          if (r.type === 'event_msg' && p.type === 'user_message') { a.estado = 'pensando'; a.titulo = curto(p.message, 80); }
          if (r.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) { a.estado = 'ocioso'; a.ferramenta = null; a.detalhe = null; }
        }
        const f = fechar(a, mtime, agora);
        if (f) out.push(f);
      }
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
