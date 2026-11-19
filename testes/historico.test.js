import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { historico } from '../fontes/historico.js';
import { origens } from '../fontes/origens.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
const ts = (s) => new Date(Date.parse('2026-11-18T23:00:00Z') + s * 1000).toISOString();
const linha = (o) => JSON.stringify(o) + '\n';

test('Claude: pedido limpo, ferramenta com resultado e duração, tokens, incremental', () => {
  const arq = path.join(dir, 'sessao.jsonl');
  fs.writeFileSync(arq,
    linha({ type: 'user', timestamp: ts(0), cwd: 'D:\\p\\root', sessionId: 's1', message: { content: [{ type: 'text', text: '<system-reminder>x</system-reminder>faça o teste' }] } }) +
    linha({ type: 'assistant', timestamp: ts(1), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'D:\\p\\a.js', old_string: 'a', new_string: 'b' } }] } }) +
    linha({ type: 'user', timestamp: ts(3), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }));
  origens.set('claude:s1', { tipo: 'claude', arquivo: arq });
  const ag = { id: 'claude:s1', plataforma: 'claude', nome: 'root', estado: 'pensando', paiId: null };
  const h = historico(ag, [ag], null);
  assert.equal(h.resumo.pedidoInicial, 'faça o teste');
  assert.equal(h.eventos.length, 2);
  const f = h.eventos[1].ferramenta;
  assert.equal(f.nome, 'Edit'); assert.equal(f.saida, 'ok'); assert.equal(f.duracaoMs, 2000); assert.equal(f.pendente, false);
  assert.deepEqual(h.resumo.tokens, { entrada: 10, saida: 5, cacheLido: 100, cacheCriado: 0 });
  assert.equal(h.resumo.contexto.tokens, 110);
  assert.equal(h.resumo.arquivos[0].caminho, 'D:\\p\\a.js');
  assert.equal(historico(ag, [ag], h.versao).mudou, false);
  // acrescenta: só a parte nova é lida
  fs.appendFileSync(arq, linha({ type: 'assistant', timestamp: ts(4), message: { id: 'm2', content: [{ type: 'text', text: 'pronto' }] } }));
  const h2 = historico(ag, [ag], h.versao);
  assert.equal(h2.mudou, true);
  assert.equal(h2.eventos.at(-1).texto, 'pronto');
});

test('chamado do DeepSeek: pedido, chamada e resposta', () => {
  const arq = path.join(dir, 'pai.jsonl');
  fs.writeFileSync(arq,
    linha({ type: 'assistant', timestamp: ts(0), message: { content: [{ type: 'tool_use', id: 'd1', name: 'mcp__deepseek__chat', input: { prompt: 'resuma isto' } }] } }) +
    linha({ type: 'user', timestamp: ts(2), message: { content: [{ type: 'tool_result', tool_use_id: 'd1', content: [{ type: 'text', text: 'resumo pronto' }] }] } }));
  origens.set('deepseek:d1', { tipo: 'chamado', arquivo: arq, toolUseId: 'd1' });
  const ag = { id: 'deepseek:d1', plataforma: 'deepseek', nome: 'DeepSeek flash', estado: 'saindo', paiId: null };
  const h = historico(ag, [ag], null);
  assert.deepEqual(h.eventos.map((e) => e.tipo), ['usuario', 'ferramenta', 'assistente']);
  assert.equal(h.eventos[2].texto, 'resumo pronto');
});

test('Cursor: horário do <timestamp>, ferramenta sem resultado', () => {
  const arq = path.join(dir, 'cursor.jsonl');
  fs.writeFileSync(arq,
    linha({ role: 'user', message: { content: [{ type: 'text', text: '<timestamp>Friday, Nov 13, 2026, 9:27 AM (UTC-3)</timestamp>\n<user_query>\nverifica\n</user_query>' }] } }) +
    linha({ role: 'assistant', message: { content: [{ type: 'tool_use', name: 'Shell', input: { command: 'ls' } }] } }) +
    linha({ type: 'turn_ended', status: 'success' }));
  origens.set('cursor:c1', { tipo: 'cursor', arquivo: arq });
  const ag = { id: 'cursor:c1', plataforma: 'cursor', nome: 'x', estado: 'ocioso', paiId: null };
  const h = historico(ag, [ag], null);
  assert.equal(h.eventos[0].texto, 'verifica');
  assert.equal(h.eventos[0].ts, Date.UTC(2026, 10, 13, 12, 27));
  assert.equal(h.eventos[1].ferramenta.pendente, false);
  assert.equal(h.eventos[2].tipo, 'sistema');
});
