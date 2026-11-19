// Escritório dos agentes: junta o que cada fonte enxerga e manda para a página
// por SSE. Só escuta nesta máquina (127.0.0.1). Contrato em CONTRATO.md.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarFonteClaude } from './fontes/claude.js';
import { criarFonteCursor } from './fontes/cursor.js';
import { criarFonteCodex, criarFonteGemini, criarFonteExterna } from './fontes/outras.js';
import { historico, limparHistoricos } from './fontes/historico.js';
import { origens } from './fontes/origens.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(AQUI, 'public');
const PORTA = Number(process.env.PORT || 5210);
const HOST = process.env.HOST || '127.0.0.1';
const INTERVALO = Number(process.env.INTERVALO_MS || 1500);

const PLATAFORMAS = [
  { id: 'claude', nome: 'Claude Code', cor: '#d97757' },
  { id: 'cursor', nome: 'Cursor', cor: '#9aa4b8' },
  { id: 'codex', nome: 'Codex', cor: '#10a37f' },
  { id: 'gemini', nome: 'Gemini CLI', cor: '#4285f4' },
  { id: 'deepseek', nome: 'DeepSeek', cor: '#4d6bfe' },
  { id: 'alibaba', nome: 'Alibaba', cor: '#ff6a00' },
  { id: 'telegram', nome: 'Telegram', cor: '#2aabee' },
  { id: 'outro', nome: 'Outros', cor: '#b48ead' },
];

const externa = criarFonteExterna();
const fontes = [criarFonteClaude(), criarFonteCursor(), criarFonteCodex(), criarFonteGemini(), externa];
// fonte → plataformas que ela "conecta"
const CONECTA = { claude: ['claude', 'deepseek', 'alibaba', 'telegram'], cursor: ['cursor'], codex: ['codex'], gemini: ['gemini'], externa: ['outro'] };

let estado = { geradoEm: Date.now(), plataformas: [], agentes: [] };
let assinatura = '';
const clientes = new Set();

function coletar() {
  const agentes = [];
  const conectadas = new Set();
  for (const f of fontes) {
    try {
      if (f.conectada()) for (const p of CONECTA[f.id] || []) conectadas.add(p);
      agentes.push(...f.ler());
    } catch (e) {
      console.error(`[${f.id}]`, e.message);
    }
  }
  agentes.sort((a, b) => a.iniciadoEm - b.iniciadoEm || a.id.localeCompare(b.id));
  // várias sessões no mesmo projeto (o root, quase sempre): o título diferencia
  // (se os títulos também se repetem, como nos composer do Cursor, numera: "composer 2")
  const grupos = new Map();
  for (const a of agentes) if (a.papel === 'principal') {
    const k = `${a.plataforma}:${a.nome}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;
    const titulos = new Set(lista.map((a) => a.titulo || ''));
    const usarTitulo = titulos.size === lista.length && !titulos.has('');
    lista.forEach((a, i) => {
      a.nome = usarTitulo ? (a.titulo.length > 22 ? a.titulo.slice(0, 21) + '…' : a.titulo) : `${a.nome} ${i + 1}`;
    });
  }
  // sala vazia só para as plataformas fixas; as outras aparecem quando têm gente
  const FIXAS = new Set(['claude', 'cursor']);
  const comGente = new Set(agentes.map((a) => a.plataforma));
  const plataformas = PLATAFORMAS.map((p) => ({
    ...p,
    conectada: conectadas.has(p.id) && (FIXAS.has(p.id) || comGente.has(p.id)),
    ativos: agentes.filter((a) => a.plataforma === p.id && a.estado !== 'ocioso' && a.estado !== 'saindo').length,
  }));
  // só manda quando algo mudou (o horário de geração não conta)
  const nova = JSON.stringify({ plataformas, agentes });
  if (nova === assinatura) return;
  assinatura = nova;
  estado = { geradoEm: Date.now(), plataformas, agentes };
  limparHistoricos(new Set(agentes.map((a) => origens.get(a.id)?.arquivo).filter(Boolean)));
  const msg = `event: estado\ndata: ${JSON.stringify(estado)}\n\n`;
  for (const res of clientes) res.write(msg);
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function servirArquivo(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const alvo = path.normalize(path.join(PUBLICO, rel));
  if (!alvo.startsWith(PUBLICO + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(alvo, (err, dados) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('não achei'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(dados);
  });
}

function json(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const servidor = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/api/estado' && req.method === 'GET') return json(res, 200, estado);
  if (pathname === '/api/historico' && req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams;
    const agente = estado.agentes.find((a) => a.id === q.get('id'));
    if (!agente) return json(res, 404, { erro: 'este agente não está mais no escritório' });
    try {
      return json(res, 200, historico(agente, estado.agentes, q.get('versao')));
    } catch (e) {
      console.error('[historico]', e);
      return json(res, 500, { erro: e.message });
    }
  }
  if (pathname === '/api/eventos' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 2000\nevent: estado\ndata: ${JSON.stringify(estado)}\n\n`);
    clientes.add(res);
    req.on('close', () => clientes.delete(res));
    return;
  }
  if (pathname === '/api/agente' && req.method === 'POST') {
    let corpo = '';
    req.on('data', (c) => { corpo += c; if (corpo.length > 16_384) req.destroy(); });
    req.on('end', () => {
      try {
        externa.receber(JSON.parse(corpo || '{}'));
        coletar();
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { ok: false, erro: e.message });
      }
    });
    return;
  }
  if (req.method === 'GET') return servirArquivo(req, res);
  res.writeHead(405).end();
});

setInterval(() => { for (const res of clientes) res.write(': ping\n\n'); }, 15_000).unref();

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`A porta ${PORTA} já está em uso: o escritório provavelmente já está rodando em http://${HOST}:${PORTA}`);
    process.exit(0);
  }
  throw e;
});

servidor.listen(PORTA, HOST, () => {
  coletar();
  setInterval(coletar, INTERVALO);
  console.log(`Escritório dos agentes em http://${HOST}:${PORTA}`);
});
