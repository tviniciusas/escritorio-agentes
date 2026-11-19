# Escritório dos agentes

Um escritório em pixel art que roda no navegador e mostra, ao vivo, os agentes de IA desta máquina trabalhando. Cada agente é um bonequinho com nome de gente (Ana, Brad, Duda, Megan…) sentado de costas na cadeira, na frente da mesa da sala da plataforma dele, como no Gather. Ao lado do nome, um emoji diz o que ele está fazendo (💻 trabalhando, 💭 pensando, ⏳ esperando, ☕ na pausa); passando o mouse, um balão mostra a ferramenta e o detalhe. Quando termina a vez, levanta e vai para o sofá. Subagente senta ao lado de quem o abriu, e um modelo chamado por ferramenta (DeepSeek, imagem na Alibaba) aparece ligado a quem chamou.

**Qualquer LLM entra.** Claude Code, Codex, Cursor e Gemini CLI são lidos direto das transcrições. DeepSeek e Alibaba (Qwen) aparecem quando um agente os chama pelo MCP. GLM, MiMo, Llama, Mistral ou o modelo que for entram com [um `POST`](#pôr-qualquer-coisa-no-escritório): o seu bot, o seu script ou o seu agente caseiro ganha uma mesa na sala.

<p align="center">
  <img src="docs/imagens/escritorio.gif" alt="O escritório em movimento: agentes digitando nas mesas, balões com a ferramenta em uso e linhas ligando subagentes a quem os chamou" width="760">
</p>

- **Sem dependências.** Só Node 20 ou mais novo: nada de `npm install`.
- **Sem hooks.** Ele só lê as transcrições que cada agente já grava em disco.
- **Responsivo.** Celular, Full HD, 2K e 4K: a sala se encaixa na tela no maior zoom inteiro que couber, a interface cresce nas telas grandes a 100% e, no celular, o detalhe abre como uma folha embaixo com o agente à vista em cima.
- **Ao vivo.** O servidor varre as transcrições a cada 1,5 s e empurra o estado para a página por [SSE](https://developer.mozilla.org/pt-BR/docs/Web/API/Server-sent_events).
- **Tudo desenhado em código.** Pessoas, móveis, piso, tapetes, plantas e os textos (nomes, balões e nomes das áreas) são gerados num `<canvas>`, sem nenhuma imagem. A arte tem 32 pixels por tile e contorno escuro em tudo, no estilo do Gather.

## Começar

```bash
git clone https://github.com/tviniciusas/escritorio-agentes.git
cd escritorio-agentes
npm start                       # http://127.0.0.1:5210
```

Abra [http://127.0.0.1:5210](http://127.0.0.1:5210). Sem nenhum agente rodando, a sala fica vazia. Para ver como ela fica cheia, abra a [demonstração com agentes de mentira](http://127.0.0.1:5210/?demo=1).

```bash
npm run teste                   # testes das fontes e do histórico (node --test)
PORT=5300 npm start             # outra porta
INTERVALO_MS=800 npm start      # varre as transcrições com mais frequência
PASTAS_GRUPO=Empresa npm start  # "projetos/Empresa/loja" aparece só como "loja" nos nomes do Cursor
```

## Como é

| A sala, de perto | Celular |
|---|---|
| <img src="docs/imagens/zoom.png" alt="Zonas do Claude Code, Cursor, DeepSeek e Alibaba com os agentes nas mesas e balões de ferramenta" width="560"> | <img src="docs/imagens/celular.png" alt="O escritório numa tela de celular, com a lista de agentes recolhida embaixo" width="220"> |

Cada plataforma ganha uma zona de tapete cinza trançado, com bancadas brancas de três postos. Nenhum posto é igual ao vizinho: gabinete com monitor em pé, dois monitores, ultrawide, notebook com luminária ou impressora, e por cima caneca, patinho de borracha, post-its, mochila no chão, frigobar embaixo da mesa. A tela principal de cada posto mostra o estado de quem senta ali (código sendo digitado, três pontinhos de quem pensa, pausa de quem espera). A cor da plataforma aparece em detalhes: a bolinha do nome da área, as ventoinhas do gabinete, a faixa da cadeira e a plaquinha da mesa. A parede dos fundos tem janelas, quadros, estante e o elevador, por onde os agentes chegam e vão embora. O lounge, com carpete lilás em ziguezague, sofás e divisórias baixas de madeira, é para quem está ocioso.

**Visão geral, com a lista de agentes**

<img src="docs/imagens/cena.png" alt="A sala inteira à esquerda e, à direita, a lista de agentes agrupada por plataforma, com estado e o que cada um está fazendo">

**O detalhe de um agente**

Clicando num agente (na sala ou na lista) abre uma barra lateral, e a sala encolhe ao lado dela para nada ficar coberto. Ali está tudo o que a transcrição tem: pedidos, respostas, pensamentos, cada ferramenta com entrada, saída e duração, arquivos mexidos, tokens, contexto e custo.

<img src="docs/imagens/detalhe.png" alt="Painel de detalhe do agente root: estado Trabalhando, ferramenta em execução, últimos eventos com Edit, WebSearch e Grep, e a última resposta do agente">

### Atalhos

| Ação | Como |
|---|---|
| Zoom | botões `+` e `−`, ou a roda do mouse |
| Voltar ao enquadramento | botão `⛶` |
| Ver o que o agente está fazendo | passe o mouse por cima dele |
| Abrir o detalhe (barra lateral) | clique no agente: a câmera aproxima e acompanha ele, sem rearrumar a sala; ao fechar, volta a vista inteira. O endereço vira `#agente=<id>` e dá para compartilhar o link. O botão **Agentes** volta para a lista |
| Fechar o detalhe e tirar a seleção | `Esc` |
| Esconder uma plataforma | clique no chip dela na lista |
| Ligar ou desligar as animações | botão `★` (a escolha fica guardada no navegador) |

### Animações

A sala reage ao que acontece com os agentes. Tudo sai das transcrições, sem hook nenhum.

| Chicote: abriu um subagente | Bronca: o subagente errou |
|---|---|
| <img src="docs/imagens/animacoes/chicote.gif" alt="O agente vai até a mesa do subagente novo e estala o chicote três vezes; o subagente pula e responde Sim, senhor!" width="400"> | <img src="docs/imagens/animacoes/bronca.gif" alt="O agente que chamou vem de punho erguido e veia saltando reclamar com o subagente que errou, que responde Não foi culpa minha!" width="400"> |
| **O Chefe: o agente principal errou** | **Fliperama: esperando os subagentes** |
| <img src="docs/imagens/animacoes/chefe.gif" alt="O Chefe, de terno e gravata vermelha, dá bronca no agente principal: De novo?! e Presta atenção!" width="400"> | <img src="docs/imagens/animacoes/fliperama.gif" alt="O agente joga luta no fliperama do saguão, com K.O. no fim do round" width="400"> |
| **Teclado pegando fogo e bug fugindo** | **Pausa: café e soneca** |
| <img src="docs/imagens/animacoes/fogo-e-bug.gif" alt="Chamas e fumaça no teclado de quem roda muitas ferramentas seguidas, e um bug sai do monitor correndo" width="400"> | <img src="docs/imagens/animacoes/pausa.gif" alt="O agente serve um café na cafeteira e depois cochila deitado no sofá, com cobertor e zz" width="400"> |
| **Subagente terminou** | |
| <img src="docs/imagens/animacoes/comemora.gif" alt="O subagente levanta com os braços para cima, solta confete e diz Entregue!" width="400"> | |

| Quando | O que acontece |
|---|---|
| Um agente principal só está esperando os subagentes (ferramenta `Agent`/`Task`, ou terminou a vez com subagentes ainda trabalhando) | Vai ao saguão jogar luta num dos dois fliperamas ao lado do elevador. Com os dois ocupados, o próximo fica atrás, assistindo. Volta para a mesa quando volta a trabalhar. |
| Um agente abre um subagente ou chama o DeepSeek ou a Alibaba | Vai até a mesa do novato, espera ele sentar e estala o chicote três vezes (`CRACK!`). O novato pula a cada estalo e responde "Sim, senhor!". |
| Uma ferramenta dá erro | Quem chamou o agente que errou vem reclamar, de punho erguido e veia saltando, e o agente pede desculpa. Agente principal não tem chefe na sala, então o **Chefe** (terno, gravata vermelha e bigode) sobe pelo elevador, dá a bronca e vai embora. |
| O usuário interrompe ou recusa uma ferramenta | Susto: pulo na cadeira, gota de suor e "Ué?!". |
| O contexto é compactado | Estrelinhas girando em volta da cabeça e "Quem sou eu?". |
| Um subagente termina | Levanta com os braços para cima, solta confete e vai embora pelo elevador. |
| O agente pergunta algo ao usuário (`AskUserQuestion`, `ask` do Telegram) | Levanta a mão acenando: "Ô humano!" e a pergunta no balão. |
| Uma ferramenta dá erro | Além da bronca, um **bug** sai do monitor e foge correndo pelo chão. |
| Muitas ferramentas seguidas (8 em 40 s) | O teclado pega fogo, com fumaça, e o agente sua. |
| A mesma ferramenta rodando há mais de 90 s (build, testes, deploy) | Cochila na mesa: cabeça baixa, olhos fechados, bolha no nariz. |
| O agente termina a vez | Espreguiça na mesa ("Ufa!") antes de ir para a pausa. |
| Pausa (ocioso) | No caminho do lounge, passa na cafeteira e serve um café. Em pé, toma golinhos (com vapor na caneca) ou fica no celular rindo ("kkkk"). Dois em pé, um perto do outro, batem papo ("E o deploy?" / "Subiu liso"). No sofá, tira uma soneca com "zz" e bolha no nariz; se o sofá estiver vazio, deita nos dois lugares, com cobertor. |

Cada animação tem um intervalo mínimo por agente (a bronca, por exemplo, no máximo uma a cada 45 s), para a sala não virar bagunça numa sessão que erra muito. Para ver uma na hora, abra o console do navegador:

```js
__escritorio.office.testar('chicote')   // ou: bronca, chefe, fliperama, susto, tonto, comemora, espreguica, soneca, bug, fogo
```

Sem argumento, ele escolhe o agente selecionado (ou um qualquer). O [`?demo=1`](http://127.0.0.1:5210/?demo=1) dispara todas de tempos em tempos.

## O que ele enxerga

| Plataforma | De onde lê | Observações |
|---|---|---|
| [Claude Code](https://github.com/anthropics/claude-code) | `~/.claude/projects/<pasta>/<sessão>.jsonl` | Sessões do VS Code, do terminal e as abertas por outros programas. |
| Subagentes do Claude | `<sessão>/subagents/agent-<id>.jsonl` e `.meta.json` | Sentam ao lado do agente que os abriu. |
| [DeepSeek](https://api-docs.deepseek.com), [Alibaba](https://www.alibabacloud.com/product/modelstudio) e Telegram | chamadas `mcp__deepseek__*`, `mcp__alibaba__*` e `mcp__telegram__*` dentro das sessões do Claude | Viram personagens "chamados", ligados a quem chamou, enquanto a chamada está aberta. |
| [Cursor](https://cursor.com/cli) | `~/.cursor/projects/<pasta>/agent-transcripts/<id>/<id>.jsonl` | O Cursor CLI e o agente da janela. As transcrições não têm horário: o tempo vem da data do arquivo. |
| [Codex CLI](https://github.com/openai/codex) | `~/.codex/sessions/**/rollout-*.jsonl` | Pelo formato documentado. Ainda não testado com uma sessão real. |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `~/.gemini/tmp/<hash>/chats/*.json` | Idem. |
| Qualquer outro LLM ou programa | `POST /api/agente` | GLM, MiMo, Llama, Mistral, bots, assistentes de voz, scripts. Ver abaixo. |

O histórico lê a transcrição de forma incremental (guarda até onde leu), então até as sessões de 40 MB respondem em menos de 0,1 s depois da primeira leitura.

## Pôr qualquer coisa no escritório

Qualquer programa entra na sala com um `POST /api/agente`. Só `id` e `estado` são obrigatórios. O agente some depois de 2 minutos sem atualização, ou na hora com `"estado": "encerrado"`. Os estados são `trabalhando`, `pensando`, `esperando`, `ocioso` e `encerrado`.

**curl**

```bash
curl -s -X POST http://127.0.0.1:5210/api/agente -H "Content-Type: application/json" \
  -d '{"id":"bot:1","plataforma":"outro","nome":"Meu bot","estado":"trabalhando","ferramenta":"busca","detalhe":"previsão do tempo"}'
```

Mande também o `modelo` (`"glm"`, `"mimo"`, `"llama-4"`…) e ele aparece no painel de detalhe. Com `"erro": true` (ou `"erro": "nome da ferramenta"`), o Chefe sobe para dar bronca no seu bot.

**Node**

```js
async function avisar(estado, ferramenta = null, detalhe = null) {
  await fetch('http://127.0.0.1:5210/api/agente', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'bot:1', plataforma: 'outro', nome: 'Meu bot', modelo: 'glm', estado, ferramenta, detalhe }),
  }).catch(() => {});   // escritório fechado não pode derrubar o bot
}

await avisar('trabalhando', 'http', 'GET /api/clima');
// ...
await avisar('encerrado');
```

**Python**

```python
import json, urllib.request

def avisar(estado, ferramenta=None, detalhe=None):
    corpo = json.dumps({"id": "script:backup", "plataforma": "outro", "nome": "Backup",
                        "estado": estado, "ferramenta": ferramenta, "detalhe": detalhe}).encode()
    req = urllib.request.Request("http://127.0.0.1:5210/api/agente", corpo,
                                 {"Content-Type": "application/json"})
    try: urllib.request.urlopen(req, timeout=2)
    except OSError: pass

avisar("trabalhando", "pg_dump", "banco de produção")
```

**Um comando longo do terminal**

```bash
# põe um bonequinho trabalhando enquanto o comando roda
na-sala() {
  local id="sh:$$" cmd="${*//\"/}" corpo
  corpo=$(printf '{"id":"%s","plataforma":"outro","nome":"terminal","estado":"trabalhando","ferramenta":"Bash","detalhe":"%s"}' "$id" "${cmd:0:60}")
  curl -s -X POST localhost:5210/api/agente -H "Content-Type: application/json" -d "$corpo" >/dev/null
  "$@"; local r=$?
  curl -s -X POST localhost:5210/api/agente -H "Content-Type: application/json" -d "{\"id\":\"$id\",\"estado\":\"encerrado\"}" >/dev/null
  return $r
}

na-sala npm run build
```

## Ler o estado de outro programa

```bash
curl -s http://127.0.0.1:5210/api/estado | jq '.agentes[] | {nome, estado, ferramenta, detalhe}'
curl -N http://127.0.0.1:5210/api/eventos                       # SSE: o estado inteiro a cada mudança
curl -s "http://127.0.0.1:5210/api/historico?id=claude:<sessão>" # o histórico de um agente
```

As rotas, os campos do estado e o formato do histórico estão em [CONTRATO.md](CONTRATO.md).

## Subir junto com o VS Code

Uma tarefa com `runOn: folderOpen` no `.vscode/tasks.json` da pasta que você mais abre sobe o servidor quando o VS Code abre, e ele fecha junto com o VS Code. Ative `"task.allowAutomaticTasks": "on"` nas configurações.

```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "escritorio-agentes",
      "type": "shell",
      "command": "node",
      "args": ["/caminho/para/escritorio-agentes/server.js"],
      "isBackground": true,
      "runOptions": { "runOn": "folderOpen" },
      "presentation": { "reveal": "never", "panel": "dedicated" },
      "problemMatcher": []
    }
  ]
}
```

Se a porta já estiver em uso, o servidor avisa e sai: o escritório já está aberto em outra janela.

## Como funciona

```
transcrições em disco ──► fontes/*.js ──► server.js ──SSE──► public/app.js ──► public/render.js (canvas)
POST /api/agente ───────────────────────────┘                    └──► public/detalhe.js (painel)
```

| Arquivo | O que faz |
|---|---|
| [`server.js`](server.js) | Servidor HTTP: junta as fontes, serve `public/` e as rotas `/api/*`. |
| [`fontes/claude.js`](fontes/claude.js) | Sessões e subagentes do Claude Code, e os personagens "chamados" pelo MCP. |
| [`fontes/cursor.js`](fontes/cursor.js) | Agentes do Cursor. |
| [`fontes/outras.js`](fontes/outras.js) | Codex e Gemini. |
| [`fontes/historico.js`](fontes/historico.js) | Leitura incremental do histórico completo de um agente. |
| [`public/render.js`](public/render.js) | A cena: tiles, zonas, piso e paredes, caminhos (BFS), câmera, nomes e balões. |
| [`public/pixel.js`](public/pixel.js) | A base da arte: medidas, cores, primitivas de pixel e o contorno automático dos sprites. |
| [`public/pessoa.js`](public/pessoa.js) | O boneco: 8 cabelos, 4 roupas e todas as poses (em pé, andando, sentado, comemorando...). |
| [`public/moveis.js`](public/moveis.js) | A mobília: bancadas e o que vai em cima delas, cadeiras, plantas, sofás, cafeteira, bebedouro e estante. |
| [`public/apelidos.js`](public/apelidos.js) | Os nomes curtos dos agentes (brasileiros e americanos), sem repetir na sala. |
| [`public/gags.js`](public/gags.js) | As animações: fliperama, chicote, bronca e o Chefe, bug, fogo no teclado, susto, tonto, comemoração, mão levantada e a pausa (café, celular, papo e soneca). |
| [`public/app.js`](public/app.js) | Lista, filtros, zoom, seleção e a ligação com o SSE. |
| [`public/detalhe.js`](public/detalhe.js) | O painel de detalhe (Agora, Histórico, Ferramentas, Contexto). |
| [`public/demo.js`](public/demo.js) | Os agentes de mentira do `?demo=1`. |

O mundo é medido em pixels lógicos (16 por tile) e a arte é desenhada com o dobro da resolução (32 pixels por tile), em retângulos de meio pixel. Cada sprite ganha um contorno automático: todo pixel vazio encostado num pixel cheio vira um tom escuro da cor vizinha. O zoom é inteiro. Nos zooms pares, cada pixel da arte vira um quadrado exato na tela; nos ímpares, a cena é desenhada no zoom par de cima e reduzida com suavização, para nenhum pixel sair maior que o vizinho. Os textos (nomes e balões) são desenhados depois, em resolução de tela, com a fonte do sistema. A profundidade sai do y dos pés: quem está mais embaixo na tela é desenhado na frente.

## Privacidade

O servidor só lê arquivos e só escuta em `127.0.0.1`. Na sala aparece só o nome da ferramenta e um resumo curto, mas o painel de detalhe mostra a transcrição inteira, inclusive saídas de comandos, que podem ter caminhos, trechos de código e segredos. **Não abra a porta para a rede** (`HOST=0.0.0.0`) sem pôr autenticação na frente.

## Sem hooks

Ele não instala hook nem plugin em nenhum agente: só lê as transcrições que cada um já grava. Assim não interfere no Claude Code, no Cursor nem nos outros, e desligar o escritório não muda nada neles.
