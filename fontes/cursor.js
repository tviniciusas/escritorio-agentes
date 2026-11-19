// Cursor (agente do Cursor CLI e da janela do Cursor): lê as transcrições em
// ~/.cursor/projects/<pasta>/agent-transcripts/<id>/<id>.jsonl. Elas não têm
// horário, então o tempo vem da data do arquivo. Não usa hook nenhum: só lê os
// arquivos.
import os from 'node:os';
import path from 'node:path';
import { lerCauda, jsonl, recentes, stat, detalheDaFerramenta, curto } from './util.js';
import { origens } from './origens.js';

const MIN = 60_000;
const JANELA = 15 * MIN;
const OCIOSO_SOME = 10 * MIN;
const PARADO = 3 * MIN; // sem escrever há mais que isso e sem "turn_ended": dá como ocioso

export function resumirCursor(registros) {
  let estado = 'ocioso', ferramenta = null, detalhe = null, titulo = null;
  for (const r of registros) {
    if (r.type === 'turn_ended') { estado = 'ocioso'; ferramenta = null; detalhe = null; continue; }
    const conteudo = r.message?.content;
    if (!Array.isArray(conteudo)) continue;
    if (r.role === 'user') {
      const texto = conteudo.map((b) => b.text || '').join(' ');
      const pedido = /<user_query>([\s\S]*?)<\/user_query>/.exec(texto)?.[1] ?? texto;
      titulo = curto(pedido, 80);
      estado = 'pensando'; ferramenta = null; detalhe = null;
    } else if (r.role === 'assistant') {
      const usos = conteudo.filter((b) => b.type === 'tool_use');
      if (usos.length) {
        const u = usos[usos.length - 1];
        estado = 'trabalhando'; ferramenta = u.name; detalhe = detalheDaFerramenta(u.name, u.input);
      } else {
        estado = 'pensando'; ferramenta = null; detalhe = null;
      }
    }
  }
  return { estado, ferramenta, detalhe, titulo };
}

// Pastas-grupo que somem do nome do projeto (ex.: PASTAS_GRUPO=Empresa,clientes).
const GRUPOS = (process.env.PASTAS_GRUPO || '').split(',').map((g) => g.trim()).filter(Boolean);
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "D-projetos-Empresa-loja-wt-checkout" → "loja-wt-checkout" (com "Empresa" em PASTAS_GRUPO). */
export function projetoDoCursor(pasta, grupos = GRUPOS) {
  const grupo = grupos.length ? new RegExp('^(' + grupos.map(escapar).join('|') + ')-') : null;
  if (/AppData-Local-Temp/i.test(pasta)) return 'composer'; // rodado de uma pasta temporária
  if (pasta === 'empty-window') return 'janela do Cursor';   // janela do Cursor sem pasta aberta
  return pasta
    .replace(/^[A-Za-z]-/, '')
    .replace(/^Users-[^-]+-[^-]+-/, '') // Users-<nome>-<sobrenome>-
    .replace(/^OneDrive-.*?Trabalho-?/, '') // OneDrive-rea-de-Trabalho- (o "Á" some no nome da pasta)
    .replace(/^projetos-/, '')
    .replace(grupo || /^(?!)/, '')
    .replace(/^projetos-/, '')
    || pasta;
}

export function criarFonteCursor({ raiz = path.join(os.homedir(), '.cursor', 'projects') } = {}) {
  const cache = new Map();
  return {
    id: 'cursor',
    conectada: () => !!stat(raiz),
    ler() {
      const agora = Date.now();
      const agentes = [];
      const arquivos = recentes(raiz, (n, p) => n.endsWith('.jsonl') && p.includes('agent-transcripts'), JANELA, 4);
      for (const { arquivo, mtime, criado } of arquivos) {
        const s = stat(arquivo);
        if (!s) continue;
        const chave = `${s.mtimeMs}:${s.size}`;
        let r = cache.get(arquivo);
        if (!r || r.chave !== chave) {
          r = { chave, ...resumirCursor(jsonl(lerCauda(arquivo))) };
          cache.set(arquivo, r);
        }
        let estado = r.estado;
        if (estado !== 'ocioso' && agora - mtime > PARADO) estado = 'ocioso';
        if (estado === 'ocioso' && agora - mtime > OCIOSO_SOME) continue;
        const partes = arquivo.split(path.sep);
        const pasta = partes[partes.lastIndexOf('agent-transcripts') - 1] || 'cursor';
        const projeto = projetoDoCursor(pasta);
        origens.set(`cursor:${path.basename(arquivo, '.jsonl')}`, { tipo: 'cursor', arquivo, pasta });
        agentes.push({
          id: `cursor:${path.basename(arquivo, '.jsonl')}`,
          plataforma: 'cursor', nome: projeto, titulo: r.titulo, projeto,
          papel: 'principal', paiId: null, estado,
          ferramenta: estado === 'ocioso' ? null : r.ferramenta,
          detalhe: estado === 'ocioso' ? null : r.detalhe,
          modelo: null, desde: mtime, ultimaAtividade: mtime, iniciadoEm: criado || mtime,
        });
      }
      return agentes;
    },
  };
}
