/* demo.js — estado falso que muda sozinho (use ?demo=1).
 * Serve para testar a cena sem servidor: ~9 agentes em várias plataformas,
 * estados que alternam, ferramentas com detalhes, subagente, chamados,
 * agentes que entram, saem (estado "saindo") e somem. Também dispara as animações de situação:
 * o root espera os subagentes (fliperama), erros de ferramenta (bronca), interrupção, compactação
 * e pergunta ao usuário.
 */

const PLATAFORMAS = [
  { id: 'claude', nome: 'Claude Code', cor: '#d97757' },
  { id: 'cursor', nome: 'Cursor', cor: '#4f9cf9' },
  { id: 'codex', nome: 'Codex', cor: '#2fb58f' },
  { id: 'gemini', nome: 'Gemini', cor: '#8e75ff' },
  { id: 'deepseek', nome: 'DeepSeek', cor: '#5b7cff' },
  { id: 'alibaba', nome: 'Alibaba', cor: '#ff8a1f' },
  { id: 'telegram', nome: 'Telegram', cor: '#2aabee' },
  { id: 'outro', nome: 'Outros', cor: '#a3acbd' },
];

// ferramentas e detalhes de exemplo por plataforma
const FERRAMENTAS = {
  claude: [
    ['Bash', 'npm test -- --watch=false'], ['Read', 'src/api/campanhas.ts'], ['Edit', 'components/Tabela.tsx'],
    ['Grep', 'useEffect( paiId'], ['Write', 'docs/plano.md'], ['Bash', 'git status --short'], ['WebSearch', 'sse reconnect eventsource'],
  ],
  cursor: [['Edit', 'lib/format.ts'], ['Read', 'package.json'], ['Terminal', 'pnpm lint'], ['Grep', 'TODO']],
  codex: [['shell', 'pytest -q'], ['apply_patch', 'app/main.py'], ['read', 'README.md']],
  deepseek: [['chat', 'resumir 40 mensagens'], ['batch', 'classificar 12 itens']],
  alibaba: [['imagem', 'logo pixel art'], ['raw', 'wan2.7-image-pro']],
  telegram: [['responder', 'mensagem do usuário']],
  outro: [['busca', 'previsão do tempo'], ['http', 'GET /api/estado']],
  gemini: [['search', 'iso tile size']],
};

let ultimoEstado = null, resolverPronto = null;
const pronto = new Promise((r) => { resolverPronto = r; });

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export function iniciarDemo(aoMudar) {
  const t0 = Date.now();
  const agentes = new Map(); // id -> agente
  const prox = new Map();    // id -> quando muda de estado (ms)
  let contador = 0;
  let parado = false;

  // cria um agente já no estado inicial pedido
  function novo(o) {
    const agora = Date.now();
    const a = {
      id: o.id, plataforma: o.plataforma, nome: o.nome, titulo: o.titulo ?? null, projeto: o.projeto ?? null,
      papel: o.papel || 'principal', paiId: o.paiId ?? null, estado: 'ocioso', ferramenta: null, detalhe: null,
      modelo: o.modelo ?? null, desde: agora, ultimaAtividade: agora, iniciadoEm: agora,
      erroEm: null, erroFerramenta: null, interrompidoEm: null, compactadoEm: null,
    };
    agentes.set(a.id, a);
    definirEstado(a, o.estado || 'trabalhando', o.duracao);
    // chamados (DeepSeek/Alibaba) ficam o tempo da chamada e saem
    if (a.papel === 'chamado') prox.set(a.id + ':saida', agora + (o.duracao ?? 10000));
    return a;
  }

  // muda o estado de um agente e agenda a próxima mudança
  function definirEstado(a, estado, duracao) {
    const agora = Date.now();
    a.estado = estado; a.desde = agora; a.ultimaAtividade = agora;
    let espera = 0;
    if (estado === 'trabalhando') {
      const [f, d] = pick(FERRAMENTAS[a.plataforma] || FERRAMENTAS.outro);
      a.ferramenta = f; a.detalhe = d;
    } else if (estado === 'esperando' && a.plataforma === 'claude' && a.papel === 'principal') {
      // com subagente trabalhando, espera por ele (vai ao fliperama); sem, pergunta ao usuário (levanta a mão)
      const filho = [...agentes.values()].some((x) => x.paiId === a.id && x.papel === 'subagente' && x.estado !== 'saindo');
      if (filho) { a.ferramenta = 'Agent'; a.detalhe = 'Revisar o diff do painel'; espera = rnd(12000, 17000); }
      else { a.ferramenta = 'AskUserQuestion'; a.detalhe = 'Posso abrir o PR agora?'; }
    } else { a.ferramenta = null; a.detalhe = null; }
    const dur = duracao ?? (espera || { trabalhando: rnd(3000, 7000), pensando: rnd(2500, 5000), esperando: rnd(3500, 6500), ocioso: rnd(11000, 20000) }[estado] || 3000);
    prox.set(a.id, agora + (dur || 3000));
  }

  // próximo estado de um agente "normal" (principal ou subagente)
  function proximoEstado(a) {
    const r = Math.random();
    switch (a.estado) {
      case 'trabalhando': return r < 0.45 ? 'pensando' : r < 0.75 ? 'trabalhando' : r < 0.9 ? 'esperando' : 'ocioso';
      case 'pensando': return r < 0.6 ? 'trabalhando' : r < 0.8 ? 'esperando' : 'pensando';
      case 'esperando': return r < 0.7 ? 'trabalhando' : 'pensando';
      default: return r < 0.7 ? 'trabalhando' : 'pensando'; // ocioso volta ao trabalho
    }
  }

  // ----- elenco inicial -----
  novo({ id: 'claude:root', plataforma: 'claude', nome: 'root', titulo: 'Repositório de visualização de agentes', projeto: 'root', modelo: 'claude-opus-5-5', estado: 'trabalhando', duracao: 9000 });
  novo({ id: 'claude:loja', plataforma: 'claude', nome: 'loja-web', titulo: 'Revisar o merge do PR #389', projeto: 'loja', modelo: 'claude-opus-5-5', estado: 'pensando', duracao: 2500 });
  novo({ id: 'claude:sub-sonnet', plataforma: 'claude', nome: 'Sonnet revisor', titulo: 'Revisar diff do painel', projeto: 'root', papel: 'subagente', paiId: 'claude:root', modelo: 'claude-sonnet-5-5', estado: 'trabalhando', duracao: 6000 });
  novo({ id: 'deepseek:flash-1', plataforma: 'deepseek', nome: 'DeepSeek flash', titulo: 'resumir conversas', projeto: 'root', papel: 'chamado', paiId: 'claude:root', modelo: 'deepseek-flash', estado: 'trabalhando', duracao: 14000 });
  novo({ id: 'cursor:composer', plataforma: 'cursor', nome: 'composer-2.5', titulo: 'Corrigir paginação da API', projeto: 'api', modelo: 'composer-2.5', estado: 'trabalhando', duracao: 5000 });
  novo({ id: 'codex:cdx1', plataforma: 'codex', nome: 'codex-cli', titulo: 'Migrar testes para pytest', projeto: 'app-fitness', modelo: 'gpt-5.5-codex', estado: 'ocioso', duracao: 16000 });
  novo({ id: 'alibaba:img-1', plataforma: 'alibaba', nome: 'Qwen imagem', titulo: 'gerar logo', projeto: 'root', papel: 'chamado', paiId: 'claude:loja', modelo: 'qwen-image-3.0-pro', estado: 'trabalhando', duracao: 12000 });
  novo({ id: 'outro:glm', plataforma: 'outro', nome: 'GLM', titulo: 'Agente de atendimento', projeto: 'atendimento', modelo: 'glm', estado: 'esperando', duracao: 5000 });
  novo({ id: 'outro:mimo', plataforma: 'outro', nome: 'MiMo', titulo: 'Bot de resumos', projeto: 'meu-bot', modelo: 'mimo', estado: 'trabalhando', duracao: 7000 });

  // ----- eventos de ciclo de vida -----
  let subSeq = 0;
  let cicloDeepseek = 1;
  const marcar = (campo, filtro, ferramenta) => {   // erro, interrupção ou compactação num agente qualquer que passe no filtro
    const vivos = [...agentes.values()].filter((x) => x.estado !== 'saindo' && filtro(x));
    if (!vivos.length) return;
    const a = pick(vivos);
    a[campo] = Date.now();
    if (ferramenta) a.erroFerramenta = ferramenta;
  };
  const repetir = (fn, min, max) => { const vez = () => { fn(); agenda.push([Date.now() - t0 + rnd(min, max), vez]); }; return vez; };
  const agenda = [
    // [quando (ms desde o início), função]
    [11000, () => { // entra um subagente que vai trabalhar e sair
      const id = 'claude:sub-' + (++subSeq);
      novo({ id, plataforma: 'claude', nome: pick(['Haiku busca', 'Explore', 'Opus revisor']), titulo: 'Buscar usos de paiId', projeto: 'root', papel: 'subagente', paiId: 'claude:root', modelo: 'claude-haiku-5', estado: 'trabalhando', duracao: 9000 });
      prox.set(id + ':saida', Date.now() + 13000);
      // outro subagente entra de novo mais tarde
      agenda.push([Date.now() - t0 + 30000, () => agenda[0][1]()]);
    }],
    [19000, () => { // aparece uma plataforma nova (o grid cresce)
      novo({ id: 'telegram:bot', plataforma: 'telegram', nome: 'Bot do Telegram', titulo: 'Conversa no Telegram', projeto: 'meu-bot', modelo: 'claude-sonnet-5-5', estado: 'pensando', duracao: 4000 });
    }],
  ];
  const feitos = new Set();
  // animações: o root espera os subagentes, erros, interrupção e compactação (depois dos eventos acima: agenda[0] é o subagente)
  agenda.push(
    [6000, repetir(() => { const r = agentes.get('claude:root'); if (r && r.estado !== 'saindo') definirEstado(r, 'esperando', 15000); }, 38000, 46000)],
    [9000, repetir(() => marcar('erroEm', (x) => x.papel !== 'principal' || Math.random() < 0.4, pick(['Bash', 'Edit', 'Read', 'chat'])), 10000, 15000)],
    [24000, repetir(() => marcar('interrompidoEm', (x) => x.papel === 'principal'), 35000, 50000)],
    [33000, repetir(() => marcar('compactadoEm', (x) => x.papel === 'principal'), 40000, 55000)],
  );

  // um novo chamado entra alguns segundos depois que o anterior saiu
  function agendarSubstituto(a) {
    const molde = { ...a };
    const novoId = a.plataforma + ':' + (a.plataforma === 'deepseek' ? 'flash-' : 'img-') + (++cicloDeepseek);
    setTimeout(() => {
      if (parado) return;
      novo({ ...molde, id: novoId, estado: 'trabalhando', duracao: rnd(8000, 13000) });
      emitir();
    }, rnd(5000, 9000));
  }

  function emitir() {
    const lista = [...agentes.values()].map((a) => ({ ...a }));
    const ativos = {};
    for (const a of lista) if (a.estado !== 'ocioso') ativos[a.plataforma] = (ativos[a.plataforma] || 0) + 1;
    const presentes = new Set(lista.map((a) => a.plataforma));
    // estas ficam "conectadas" mesmo sem agente (como um MCP configurado)
    const sempre = new Set(['cursor', 'deepseek', 'alibaba']);
    const plataformas = PLATAFORMAS.filter((p) => presentes.has(p.id) || sempre.has(p.id)).map((p) => ({
      ...p, conectada: presentes.has(p.id) || sempre.has(p.id), ativos: ativos[p.id] || 0,
    }));
    const est = { geradoEm: Date.now(), plataformas, agentes: lista };
    ultimoEstado = est; if (resolverPronto) resolverPronto();
    aoMudar(est);
  }

  function tick() {
    if (parado) return;
    const agora = Date.now();
    const dt = agora - t0;
    let mudou = false;

    // eventos agendados
    agenda.forEach(([quando, fn], i) => { if (!feitos.has(i) && dt >= quando) { feitos.add(i); fn(); mudou = true; } });

    for (const [id, a] of [...agentes]) {
      // saída de subagentes e chamados ("saindo" -> some 2,5 s depois)
      const quandoSai = prox.get(id + ':saida');
      if (quandoSai && agora >= quandoSai) {
        prox.delete(id + ':saida');
        a.estado = 'saindo'; a.ferramenta = null; a.detalhe = null; a.desde = agora;
        prox.set(id + ':some', agora + 2500);
        if (a.papel === 'chamado') agendarSubstituto(a);
        mudou = true; continue;
      }
      const quandoSome = prox.get(id + ':some');
      if (quandoSome && agora >= quandoSome) { agentes.delete(id); prox.delete(id); prox.delete(id + ':some'); mudou = true; continue; }
      if (a.estado === 'saindo') continue;

      if (a.papel === 'chamado') continue; // só sai na hora marcada

      if (agora >= (prox.get(id) || 0)) {
        definirEstado(a, proximoEstado(a));
        mudou = true;
      }
    }
    if (mudou) emitir();
  }

  emitir();
  const timer = setInterval(tick, 400);
  // reenvia o estado de vez em quando, como o servidor faria
  const timerPing = setInterval(() => { if (!parado) emitir(); }, 5000);
  return () => { parado = true; clearInterval(timer); clearInterval(timerPing); };
}

// =====================================================================
// Histórico falso (para testar o painel de detalhe sem o servidor): GET /api/historico no formato do CONTRATO.md
// =====================================================================
const HIST = new Map();   // id -> histórico em memória (cresce com o tempo, como o de verdade)

const hashStr = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function semente(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const PEDIDOS = [
  'Faça o painel mostrar o histórico completo do agente quando eu clicar nele.',
  'Rode os testes e me diga o que quebrou.',
  'Agora ajuste o layout para o celular, sem rolagem horizontal.',
  'Por que o SSE reconecta toda hora? Investigue e corrija.',
  'Pode revisar o diff antes de eu abrir o PR?',
  'Troca o texto dos botões para português do Brasil.',
];
const PENSAMENTOS = [
  'O usuário quer ver tudo sobre o agente. Preciso primeiro ler o contrato para saber exatamente quais campos o servidor devolve, depois montar a interface sem quebrar o que já existe. Vale começar pelo mais simples: uma gaveta lateral com abas.',
  'Os testes falharam em um único arquivo. Antes de mexer no código, vou olhar o erro completo e conferir se não é só uma configuração de ambiente (porta ocupada, variável faltando).',
  'Melhor não reescrever o componente inteiro. Uma troca pontual da função que calcula o horário resolve e fica fácil de revisar.',
];
const INTRO = [
  'Vou começar lendo o `CONTRATO.md` e o `server.js` para entender o formato do histórico.',
  'Entendi. Vou dividir em três partes:\n\n1. ler o contrato\n2. montar a aba **Histórico**\n3. testar no celular\n\nComeço pelo contrato.',
  'Achei uma pista: o erro vem do `EventSource`, que reabre a conexão quando o servidor fecha a resposta.',
  'Vou procurar onde isso é usado antes de alterar.',
];
const FINAIS = [
  'Pronto. A mudança está em `public/detalhe.js`:\n\n```js\nexport class Detalhe {\n  abrir(id) {\n    this.id = id;\n    this.carregar();\n  }\n}\n```\n\nVeja também a [documentação do EventSource](https://developer.mozilla.org/pt-BR/docs/Web/API/EventSource).\n\n- o painel abre ao clicar no agente\n- **Esc** fecha\n- o endereço guarda `#agente=`',
  'Os testes passaram. Resumo do que mudou:\n\n## Alterações\n\n- `server.js`: nova rota `/api/historico`\n- `public/app.js`: abre o painel ao clicar\n\n> Falta só conferir o layout no celular.\n\nQuer que eu abra o PR?',
  'Corrigido. O problema era o tempo limite de 15 s do proxy; agora o servidor manda um `: ping` a cada 10 s.',
];
const SAIDA_TESTE = 'TAP version 13\n# Subtest: lista os agentes\nok 1 - lista os agentes\n  ---\n  duration_ms: 12.4\n  ...\n# Subtest: estado inclui plataformas\nok 2 - estado inclui plataformas\n# Subtest: agente externo some depois de 2 min\nok 3 - agente externo some depois de 2 min\n1..3\n# tests 3\n# pass 3\n# fail 0\n# duration_ms 188.2';
const CODIGO = (n) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(4)}\t${i % 7 === 0 ? 'function exemplo' + i + '(estado) {' : i % 7 === 6 ? '}' : '  const valor' + i + ' = estado.agentes.filter((a) => a.estado === "trabalhando").length;'}`).join('\n');
const ARQUIVOS = ['server.js', 'public/app.js', 'public/render.js', 'public/detalhe.js', 'public/style.css', 'CONTRATO.md', 'fontes/claude.js', 'testes/estado.test.js'];
const RAIZ = 'D:\\projetos\\escritorio-agentes\\';

// uma ferramenta de exemplo; devolve o objeto "ferramenta" do contrato (sem pendente/fimTs)
function ferramentaAleatoria(r, plat, filhoId) {
  const arq = RAIZ + ARQUIVOS[(r() * ARQUIVOS.length) | 0].replace(/\//g, '\\');
  const k = r();
  if (plat === 'claude' && filhoId && k < 0.12) {
    return { nome: 'Agent', resumo: 'Explore: achar onde o estado é publicado', entrada: { description: 'Achar onde o estado é publicado', subagent_type: 'Explore', prompt: 'Procure no repositório onde o servidor monta o JSON de estado e me diga o arquivo e a função. Não edite nada.' }, saida: 'O estado é montado em `server.js`, função `montarEstado()`, e enviado por `publicar()`.', subagenteId: filhoId };
  }
  if (k < 0.28) {
    const cmds = [['npm test', SAIDA_TESTE], ['git status --short', ' M public/app.js\n M public/style.css\n?? public/detalhe.js'], ['node --check public/app.js', ''], ['curl -s http://127.0.0.1:5210/api/estado | head -c 200', '{"geradoEm":1795042407171,"plataformas":[{"id":"claude","nome":"Claude Code","cor":"#d97757","conectada":true,"ativos":3}]}'], ['cat naoexiste.txt', 'cat: naoexiste.txt: No such file or directory', true]];
    const [c, saida, erro] = cmds[(r() * cmds.length) | 0];
    return { nome: 'Bash', resumo: c, entrada: { command: c, description: 'Executa o comando' }, saida, erro: !!erro };
  }
  if (k < 0.48) return { nome: 'Read', resumo: arq, entrada: { file_path: arq }, saida: CODIGO(10 + ((r() * 70) | 0)) };
  if (k < 0.66) return { nome: 'Edit', resumo: arq, entrada: { file_path: arq, old_string: "  const total = lista.length;\n  return total;", new_string: "  const total = lista.filter((a) => !a.saindo).length;\n  return total;" }, saida: `The file ${arq} has been updated successfully.` };
  if (k < 0.74) return { nome: 'Write', resumo: arq, entrada: { file_path: arq, content: '// arquivo novo\nexport const versao = 1;\n' }, saida: `File created successfully at: ${arq}` };
  if (k < 0.88) return { nome: 'Grep', resumo: 'useEffect em ' + 'public', entrada: { pattern: 'paiId', path: RAIZ + 'public', output_mode: 'content' }, saida: 'public/app.js:129:    if (a.paiId && ids.has(a.paiId)) {\npublic/render.js:211:      const pai = ag.paiId ? byId.get(ag.paiId) : null;\npublic/demo.js:61:      paiId: o.paiId ?? null,' };
  if (k < 0.94) return { nome: 'Glob', resumo: 'public/*.js', entrada: { pattern: 'public/*.js' }, saida: 'public/app.js\npublic/demo.js\npublic/render.js' };
  return { nome: 'WebSearch', resumo: 'sse eventsource reconexão', entrada: { query: 'sse eventsource reconexão automática' }, saida: 'Resultados:\n1. EventSource - MDN\n2. Server-sent events - WHATWG' };
}

// gera um "turno": pedido -> pensamento -> resposta -> ferramentas -> resposta final. Cada item vira um evento
function gerarTurno(h, completo) {
  const r = h.r, ag = h.ag, itens = [];
  if (h.estiloCursor || h.papel !== 'principal' ? r() < 0.5 : true) itens.push({ tipo: 'usuario', texto: PEDIDOS[(r() * PEDIDOS.length) | 0] });
  if (r() < 0.6) itens.push({ tipo: 'pensamento', texto: PENSAMENTOS[(r() * PENSAMENTOS.length) | 0] });
  itens.push({ tipo: 'assistente', texto: INTRO[(r() * INTRO.length) | 0] });
  const n = 2 + ((r() * 4) | 0);
  for (let i = 0; i < n; i++) itens.push({ tipo: 'ferramenta', f: ferramentaAleatoria(r, ag.plataforma, h.filhoId) });
  if (r() < 0.2) itens.push({ tipo: 'sistema', texto: 'interrompido pelo usuário' });
  itens.push({ tipo: 'assistente', texto: FINAIS[(r() * FINAIS.length) | 0] });
  return itens;
}
// transforma um item em evento (ferramenta nasce pendente quando 'viva')
function criarEvento(h, item, viva) {
  const ev = { i: h.proximoI++, tipo: item.tipo, ts: h.semTempo ? null : h.relogio, texto: item.texto ?? null };
  h.relogio += Math.round(2000 + h.r() * 22000);
  if (item.tipo === 'ferramenta') {
    const f = item.f, dur = Math.round(150 + h.r() * 6000);
    ev.texto = null;
    ev.ferramenta = { id: 'toolu_' + h.proximoI.toString(36) + Math.round(h.r() * 1e6).toString(36), nome: f.nome, resumo: f.resumo, entrada: f.entrada, saida: h.semResultado ? null : (viva ? null : f.saida), erro: !viva && !!f.erro, pendente: !!viva, fimTs: null, duracaoMs: null };
    if (f.subagenteId) ev.ferramenta.subagenteId = f.subagenteId;
    h.pendentes.set(ev.i, { f, dur });
    if (!viva) finalizar(h, ev);
  }
  return ev;
}
function finalizar(h, ev) {
  const p = h.pendentes.get(ev.i); if (!p) return;
  const f = ev.ferramenta;
  f.pendente = false; f.erro = !!p.f.erro; f.saida = h.semResultado ? null : p.f.saida;
  f.duracaoMs = h.semTempo ? null : p.dur; f.fimTs = h.semTempo ? null : (ev.ts || 0) + p.dur;
  h.pendentes.delete(ev.i);
}

function criarHistorico(ag, estado) {
  const r = semente(hashStr(ag.id));
  const pai = ag.paiId ? estado.agentes.find((a) => a.id === ag.paiId) : null;
  const filho = estado.agentes.find((a) => a.paiId === ag.id);
  const h = {
    r, ag, papel: ag.papel, proximoI: ag.id === 'claude:root' ? 1674 : 0, fila: [], pendentes: new Map(), rev: 0, t: Date.now(), eventos: [],
    semTempo: ag.plataforma === 'cursor', semResultado: ag.plataforma === 'cursor', estiloCursor: ag.plataforma === 'cursor',
    externo: ag.plataforma === 'outro', filhoId: filho ? filho.id : null, relogio: 0, iniciadoEm: ag.iniciadoEm - 1000 * 60 * 47,
  };
  h.relogio = Date.now() - 1000 * 60 * 40;
  if (h.externo) return h;                       // agente externo: só o resumo, sem eventos
  const alvo = ag.id === 'claude:root' ? 150 : ag.papel === 'chamado' ? 9 : ag.papel === 'subagente' ? 18 : 40;
  h.eventos.push(criarEvento(h, { tipo: 'usuario', texto: PEDIDOS[hashStr(ag.id) % PEDIDOS.length] }, false));
  while (h.eventos.length < alvo) for (const it of gerarTurno(h, true)) h.eventos.push(criarEvento(h, it, false));
  h.eventos.length = alvo;
  h.total = h.eventos.length + (ag.id === 'claude:root' ? 1674 : 0);
  h.cortado = ag.id === 'claude:root';
  // quem está trabalhando termina com a ferramenta atual pendente
  if (ag.estado === 'trabalhando' && ag.ferramenta) {
    const ev = criarEvento(h, { tipo: 'ferramenta', f: { nome: ag.ferramenta, resumo: ag.detalhe || '', entrada: ag.ferramenta === 'Bash' ? { command: ag.detalhe || '', description: 'Executa o comando' } : { query: ag.detalhe || '' }, saida: 'concluído' } }, true);
    h.eventos.push(ev); h.total++;
  }
  h.pai = pai ? { id: pai.id, nome: pai.nome } : null;
  return h;
}

// o tempo passa: a cada ~4 s o agente que está ativo ganha um evento (ou conclui a ferramenta pendente)
function avancar(h, ag) {
  h.ag = ag;
  if (h.externo || Date.now() - h.t < 4000 || !['trabalhando', 'pensando'].includes(ag.estado)) return;
  h.t = Date.now();
  const pend = h.eventos.find((e) => e.ferramenta && e.ferramenta.pendente);
  if (pend) { finalizar(h, pend); h.rev++; return; }
  if (!h.fila.length) h.fila = gerarTurno(h, false);
  const ev = criarEvento(h, h.fila.shift(), true);
  h.eventos.push(ev); h.total++; h.rev++;
  h.relogio = Date.now();
}

function montarResumo(h, ag, estado) {
  const evs = h.eventos, cont = {}, arqs = new Map();
  let usuario = 0, assistente = 0;
  for (const e of evs) {
    if (e.tipo === 'usuario') usuario++; else if (e.tipo === 'assistente') assistente++;
    if (e.ferramenta) {
      const f = e.ferramenta, c = (cont[f.nome] ||= { nome: f.nome, vezes: 0, erros: 0 });
      c.vezes++; if (f.erro) c.erros++;
      const cam = f.entrada && f.entrada.file_path;
      if (cam) { const a = arqs.get(cam) || { caminho: cam, acoes: [], vezes: 0 }; if (!a.acoes.includes(f.nome)) a.acoes.push(f.nome); a.vezes++; arqs.set(cam, a); }
    }
  }
  const pai = ag.paiId ? estado.agentes.find((a) => a.id === ag.paiId) : null;
  const filhos = estado.agentes.filter((a) => a.paiId === ag.id).map((a) => ({ id: a.id, nome: a.nome, titulo: a.titulo, estado: a.estado }));
  const claude = ag.plataforma === 'claude', total = h.total || evs.length;
  const toks = claude ? { entrada: 1234 + total * 40, saida: 5678 + total * 120, cacheLido: 900000 + total * 5000, cacheCriado: 4000 + total * 90 } : null;
  return {
    plataforma: ag.plataforma, nome: ag.nome, titulo: ag.titulo, estado: ag.estado, ferramenta: ag.ferramenta, detalhe: ag.detalhe,
    modelo: ag.modelo, projeto: ag.projeto, cwd: ag.projeto ? 'D:\\projetos\\' + ag.projeto : null, branch: h.externo ? null : 'develop',
    sessao: h.externo ? null : ag.id.split(':').pop() + '-0000-demo', arquivo: h.externo ? null : 'C:\\Users\\demo\\.claude\\projects\\' + ag.id.replace(/[:]/g, '_') + '.jsonl',
    entrypoint: claude ? 'claude-vscode' : null, versaoCli: claude ? '2.1.325' : null, papel: ag.papel,
    iniciadoEm: ag.iniciadoEm - 47 * 60000, ultimaAtividade: ag.ultimaAtividade, duracaoMs: Date.now() - ag.iniciadoEm + 47 * 60000,
    pedidoInicial: h.externo ? null : PEDIDOS[hashStr(ag.id) % PEDIDOS.length],
    contexto: claude ? { tokens: 90000 + total * 140, janela: ag.id === 'claude:root' ? 1000000 : null } : null,
    tokens: toks, custoUSD: claude ? Math.round((0.4 + total * 0.011) * 100) / 100 : null,
    mensagens: h.externo ? null : { usuario, assistente },
    ferramentas: Object.values(cont).sort((a, b) => b.vezes - a.vezes), arquivos: [...arqs.values()].sort((a, b) => b.vezes - a.vezes).slice(0, 12),
    pai: pai ? { id: pai.id, nome: pai.nome } : null, filhos,
  };
}

// o que a página chama no lugar de fetch('/api/historico'): devolve { status, corpo }
export async function historicoDemo(id, versao) {
  await pronto;
  const estado = ultimoEstado;
  const ag = estado.agentes.find((a) => a.id === id);
  if (!ag) return { status: 404, corpo: { erro: 'este agente não está mais na tela' } };
  let h = HIST.get(id);
  if (!h) { h = criarHistorico(ag, estado); HIST.set(id, h); }
  avancar(h, ag);
  const ver = `${h.eventos.length}:${h.rev}`;
  if (versao === ver) return { status: 200, corpo: { id, versao: ver, mudou: false } };
  const eventos = JSON.parse(JSON.stringify(h.eventos));
  return { status: 200, corpo: { id, versao: ver, mudou: true, resumo: montarResumo(h, ag, estado), totalEventos: h.total || eventos.length, cortado: !!h.cortado, eventos } };
}
