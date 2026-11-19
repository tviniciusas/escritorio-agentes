import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumirTranscricao } from '../fontes/claude.js';
import { resumirCursor, projetoDoCursor } from '../fontes/cursor.js';
import { criarFonteExterna, resumirCodex } from '../fontes/outras.js';
import { detalheDaFerramenta } from '../fontes/util.js';

const agora = Date.parse('2026-11-18T23:00:00Z');
const ts = (s) => new Date(agora - s * 1000).toISOString();
const usuario = (texto, s) => ({ type: 'user', timestamp: ts(s), message: { role: 'user', content: [{ type: 'text', text: texto }] } });
const usa = (id, name, input, s) => ({ type: 'assistant', timestamp: ts(s), message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] } });
const volta = (id, s) => ({ type: 'user', timestamp: ts(s), message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
const fala = (texto, s) => ({ type: 'assistant', timestamp: ts(s), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: texto }] } });

test('Claude: ferramenta pendente = trabalhando', () => {
  const r = resumirTranscricao([usuario('oi', 30), usa('t1', 'Bash', { command: 'npm test', description: 'Roda os testes' }, 20)], agora);
  assert.equal(r.estado, 'trabalhando');
  assert.equal(r.ferramenta, 'Bash');
  assert.equal(r.detalhe, 'Roda os testes');
  assert.equal(r.modelo, 'claude-opus-5-5');
});

test('Claude: resultado voltou = pensando; texto final = ocioso', () => {
  const base = [usuario('oi', 30), usa('t1', 'Read', { file_path: 'C:\\a\\b\\server.js' }, 20), volta('t1', 19)];
  assert.equal(resumirTranscricao(base, agora).estado, 'pensando');
  assert.equal(resumirTranscricao([...base, fala('pronto', 10)], agora).estado, 'ocioso');
});

test('Claude: pensando parado há muito tempo vira ocioso', () => {
  assert.equal(resumirTranscricao([usuario('oi', 600)], agora).estado, 'ocioso');
});

test('Claude: subagente e pergunta = esperando; interrupção limpa', () => {
  assert.equal(resumirTranscricao([usa('t1', 'Agent', { description: 'x' }, 5)], agora).estado, 'esperando');
  const r = resumirTranscricao([usa('t1', 'Bash', {}, 50), usuario('[Request interrupted by user]', 40)], agora);
  assert.equal(r.estado, 'ocioso');
  assert.equal(r.pendentes.length, 0);
});

test('Claude: chamada MCP ao DeepSeek fica pendente e depois terminada', () => {
  const a = resumirTranscricao([usa('d1', 'mcp__deepseek__chat', { prompt: 'resuma' }, 5)], agora);
  assert.equal(a.ferramenta, 'deepseek·chat');
  assert.equal(a.pendentes[0].nome, 'mcp__deepseek__chat');
  const b = resumirTranscricao([usa('d1', 'mcp__deepseek__chat', {}, 5), volta('d1', 2)], agora);
  assert.equal(b.terminadas.length, 1);
});

test('Cursor: turn_ended = ocioso, tool_use = trabalhando', () => {
  const u = { role: 'user', message: { content: [{ type: 'text', text: '<user_query>\nfaça X\n</user_query>' }] } };
  const t = { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'Shell', input: { command: 'ls' } }] } };
  assert.deepEqual(resumirCursor([u, t]), { estado: 'trabalhando', ferramenta: 'Shell', detalhe: 'ls', titulo: 'faça X' });
  assert.equal(resumirCursor([u, t, { type: 'turn_ended' }]).estado, 'ocioso');
  assert.equal(projetoDoCursor('D-projetos-Empresa-loja-wt-checkout', ['Empresa']), 'loja-wt-checkout');
  assert.equal(projetoDoCursor('D-projetos-Empresa-loja-wt-checkout', []), 'Empresa-loja-wt-checkout');
  assert.equal(projetoDoCursor('C-Users-Fulano-Silva-loja-wt-develop'), 'loja-wt-develop');
});

test('Externa: valida, guarda e encerra', () => {
  const f = criarFonteExterna();
  assert.throws(() => f.receber({ estado: 'trabalhando' }));
  assert.throws(() => f.receber({ id: 'a', estado: 'voando' }));
  f.receber({ id: 'bot', estado: 'trabalhando', nome: 'Meu bot', plataforma: 'xyz' });
  assert.equal(f.ler()[0].plataforma, 'outro');
  f.receber({ id: 'bot', estado: 'encerrado' });
  assert.equal(f.ler().length, 0);
});

test('detalhe das ferramentas', () => {
  assert.equal(detalheDaFerramenta('Edit', { file_path: 'D:\\x\\y\\z.ts' }), 'z.ts');
  assert.equal(detalheDaFerramenta('WebFetch', { url: 'https://github.com/a/b' }), 'github.com');
  assert.equal(detalheDaFerramenta('Grep', { pattern: 'foo' }), 'foo');
});

// ---- Codex (formato rollout *.jsonl do Codex ≥ 0.16x) ----
const cxMeta = (cwd) => ({ type: 'session_meta', payload: { id: 's1', cwd, cli_version: '0.166.0' } });
const cxTurno = (model, cwd) => ({ type: 'turn_context', payload: { model, cwd } });
const cxUser = (texto) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: texto }] } });
const cxFala = (texto) => ({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: texto }] } });
const cxTool = (name, input) => ({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'c1', name, input } });
const cxOut = () => ({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: 'ok' } });
const cxDone = () => ({ type: 'event_msg', payload: { type: 'task_complete' } });

test('Codex: projeto, modelo e título vêm do início da sessão', () => {
  const r = resumirCodex([
    cxMeta('/Users/x/aspire/guide-106873'),
    cxTurno('gpt-6.1-terra', '/Users/x/aspire/guide-106873'),
    cxUser('Edite o guia QA no lugar'),
  ]);
  assert.equal(r.projeto, 'guide-106873');
  assert.equal(r.nome, 'guide-106873');
  assert.equal(r.modelo, 'gpt-6.1-terra');
  assert.equal(r.titulo, 'Edite o guia QA no lugar');
});

test('Codex: ferramenta chamada = trabalhando; saída volta = pensando', () => {
  const base = [cxMeta('/x/meu-proj'), cxUser('rode os testes')];
  assert.equal(resumirCodex([...base, cxTool('exec', 'ls')]).estado, 'trabalhando');
  assert.equal(resumirCodex([...base, cxTool('exec', 'ls')]).ferramenta, 'exec');
  assert.equal(resumirCodex([...base, cxTool('exec', 'ls'), cxOut()]).estado, 'pensando');
});

test('Codex: task_complete = ocioso; environment_context não vira título', () => {
  const r = resumirCodex([
    cxMeta('/x/meu-proj'),
    cxUser('<environment_context>\n  <cwd>/x</cwd>\n</environment_context>'),
    cxUser('o pedido de verdade'),
    cxTool('exec', 'ls'), cxOut(), cxDone(),
  ]);
  assert.equal(r.estado, 'ocioso');
  assert.equal(r.titulo, 'o pedido de verdade');
});
