// Funções comuns às fontes: ler o fim de um arquivo, listar arquivos recentes e
// resumir a entrada de uma ferramenta numa linha curta.
import fs from 'node:fs';
import path from 'node:path';

const TAMANHO_CAUDA = 512 * 1024;

/** Lê os últimos bytes de um arquivo e devolve as linhas inteiras. */
export function lerCauda(arquivo, bytes = TAMANHO_CAUDA) {
  let fd;
  try {
    fd = fs.openSync(arquivo, 'r');
    const { size } = fs.fstatSync(fd);
    const inicio = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - inicio);
    fs.readSync(fd, buf, 0, buf.length, inicio);
    const linhas = buf.toString('utf8').split('\n');
    if (inicio > 0) linhas.shift(); // a primeira pode estar cortada
    return linhas.filter((l) => l.trim());
  } catch {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/** Faz o parse de cada linha JSON e ignora as quebradas. */
export function jsonl(linhas) {
  const out = [];
  for (const l of linhas) {
    try { out.push(JSON.parse(l)); } catch {}
  }
  return out;
}

export function stat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

export function listar(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

/** Arquivos dentro de `dir` (recursivo até `fundo`) que batem no filtro e mudaram há menos de `janelaMs`. */
export function recentes(dir, filtro, janelaMs, fundo = 3) {
  const agora = Date.now();
  const achados = [];
  const andar = (d, nivel) => {
    for (const e of listar(d)) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (nivel < fundo) andar(p, nivel + 1);
      } else if (filtro(e.name, p)) {
        const s = stat(p);
        if (s && agora - s.mtimeMs < janelaMs) achados.push({ arquivo: p, mtime: s.mtimeMs, criado: s.birthtimeMs || s.ctimeMs });
      }
    }
  };
  andar(dir, 0);
  return achados;
}

export function curto(texto, max = 60) {
  if (texto == null) return null;
  const s = String(texto).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function nomeArquivo(p) {
  if (!p) return null;
  return String(p).split(/[\\/]/).filter(Boolean).pop() || null;
}

function host(url) {
  try { return new URL(url).host; } catch { return url; }
}

/** Resume a entrada de uma ferramenta: o arquivo, o comando, o padrão buscado… */
export function detalheDaFerramenta(nome, entrada) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const n = String(nome || '');
  if (/^(Read|Edit|Write|MultiEdit|NotebookEdit|read_file|edit_file|write_file|StrReplace|Delete)$/i.test(n)) {
    return curto(nomeArquivo(e.file_path || e.path || e.target_file || e.notebook_path));
  }
  if (/^(Bash|PowerShell|Shell|run_terminal_cmd|shell|exec_command)$/i.test(n)) {
    return curto(e.description || e.command || e.cmd);
  }
  if (/^(Grep|Glob|grep|glob|codebase_search)$/i.test(n)) return curto(e.pattern || e.glob_pattern || e.query);
  if (/^WebSearch$/i.test(n)) return curto(e.query);
  if (/^WebFetch$/i.test(n)) return curto(host(e.url));
  if (/^(Agent|Task)$/i.test(n)) return curto(e.description || e.subagent_type);
  if (/^Skill$/i.test(n)) return curto(e.skill);
  if (/^AskUserQuestion$/i.test(n)) return curto(e.questions?.[0]?.question);
  if (/^TodoWrite$/i.test(n)) return 'lista de tarefas';
  // MCP e o resto: o primeiro texto curto da entrada
  for (const chave of ['description', 'prompt', 'query', 'text', 'path', 'model', 'url']) {
    if (typeof e[chave] === 'string') return curto(e[chave]);
  }
  for (const v of Object.values(e)) if (typeof v === 'string') return curto(v);
  return null;
}

/** "D:\projetos\Empresa\loja" → "loja". */
export function pastaCurta(cwd) {
  if (!cwd) return null;
  return nomeArquivo(String(cwd).replace(/[\\/]+$/, ''));
}
