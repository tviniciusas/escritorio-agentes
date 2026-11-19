# Contrato entre o servidor e a página

O servidor (`server.js`, Node 22, sem dependências) escuta em `http://127.0.0.1:5210` e serve a pasta `public/`.

## Rotas

| Rota | O que faz |
|---|---|
| `GET /` | `public/index.html` (e os outros arquivos de `public/`) |
| `GET /api/estado` | o estado atual (JSON abaixo) |
| `GET /api/eventos` | SSE: manda `event: estado` com o estado inteiro a cada mudança, e um `: ping` a cada 15 s |
| `POST /api/agente` | outras ferramentas se registram (ver "Agente externo") |

## Estado

```jsonc
{
  "geradoEm": 1795042407171,            // ms
  "plataformas": [
    { "id": "claude", "nome": "Claude Code", "cor": "#d97757", "conectada": true, "ativos": 3 }
    // ids possíveis: claude, cursor, codex, gemini, deepseek, alibaba, telegram, outro
  ],
  "agentes": [
    {
      "id": "claude:a4f42e40-…",         // único e estável enquanto o agente existir
      "plataforma": "claude",
      "nome": "root",                     // curto: projeto, tipo do subagente ou "DeepSeek flash"
      "titulo": "Repositório de visualização de agentes", // pode ser null
      "projeto": "root",                  // pasta curta, pode ser null
      "papel": "principal",               // principal | subagente | chamado
      "paiId": null,                      // id do agente que abriu este (subagente ou chamado)
      "estado": "trabalhando",            // trabalhando | pensando | esperando | ocioso | saindo
      "ferramenta": "Bash",               // null quando não está numa ferramenta
      "detalhe": "npm test",              // até 60 caracteres, pode ser null
      "modelo": "claude-opus-5-5",        // pode ser null
      "desde": 1795042407171,             // ms em que entrou no estado atual
      "ultimaAtividade": 1795042407171,   // ms
      "iniciadoEm": 1795042400000,        // ms
      "erroEm": 1795042405000,            // ms da última ferramenta que voltou com erro; null se não houve (a recusa do usuário não conta)
      "erroFerramenta": "Bash",           // a ferramenta desse erro; pode ser null
      "interrompidoEm": null,             // ms da última interrupção ([Request interrupted]) ou recusa de ferramenta pelo usuário
      "compactadoEm": null                // ms da última compactação do contexto (compact_boundary)
    }
  ]
}
```

- `trabalhando`: está rodando uma ferramenta (`ferramenta` preenchida).
- `pensando`: o modelo está gerando (sem ferramenta).
- `esperando`: parado esperando algo de fora, como um subagente ou uma permissão.
- `ocioso`: terminou a vez e espera o usuário. Some depois de alguns minutos.
- `saindo`: vai sumir no próximo estado (subagente que terminou). A página pode animar a saída.
- `papel: "chamado"`: modelo chamado por ferramenta (DeepSeek pelo MCP, imagem na Alibaba). `paiId` aponta quem chamou.
- `erroEm`, `interrompidoEm` e `compactadoEm` só servem para as animações (`public/gags.js`): a página anima quando o valor aumenta. Saem da cauda da transcrição, então podem voltar a `null` numa sessão longa. Só o Claude Code (e o agente externo, com `"erro"`) preenche; nas outras plataformas vêm `null` ou ausentes.

## Histórico de um agente

`GET /api/historico?id=<id do agente>[&versao=<versao>]`

- `404 { "erro": "..." }` quando o id não está mais na tela.
- Se `versao` for igual à atual: `200 { "id", "versao", "mudou": false }` (a página pergunta a cada 3 s enquanto o painel está aberto).
- Senão: `200` com tudo:

```jsonc
{
  "id": "claude:a4f4…", "versao": "1795…:52311", "mudou": true,
  "resumo": {
    "plataforma": "claude", "nome": "root", "titulo": "…", "estado": "trabalhando",
    "ferramenta": "Bash", "detalhe": "npm test",
    "modelo": "claude-opus-5-5", "projeto": "root", "cwd": "C:\\…\\root", "branch": "develop",
    "sessao": "a4f42e40-…", "arquivo": "C:\\Users\\…\\a4f4….jsonl",
    "entrypoint": "claude-vscode", "versaoCli": "2.1.325", "papel": "principal",
    "iniciadoEm": 1795…, "ultimaAtividade": 1795…, "duracaoMs": 123456,
    "pedidoInicial": "primeiro pedido do usuário (até 2000 caracteres)",
    "contexto": { "tokens": 302784, "janela": null },     // tamanho do contexto na última resposta; null quando não dá para saber
    "tokens": { "entrada": 1234, "saida": 5678, "cacheLido": 900000, "cacheCriado": 4000 }, // somados; null quando não há
    "custoUSD": 1.62,                                       // null quando não há
    "mensagens": { "usuario": 7, "assistente": 32 },
    "ferramentas": [ { "nome": "Bash", "vezes": 12, "erros": 1 } ],        // mais usadas primeiro
    "arquivos": [ { "caminho": "D:\\…\\server.js", "acoes": ["Read", "Edit"], "vezes": 5 } ],
    "pai": { "id": "claude:…", "nome": "root" } ,           // ou null
    "filhos": [ { "id": "claude:sub:…", "nome": "Explore", "titulo": "…", "estado": "saindo" } ]
  },
  "totalEventos": 812, "cortado": false,                     // cortado = só os últimos 1500 eventos vieram
  "eventos": [
    { "i": 0, "tipo": "usuario", "ts": 1795…, "texto": "pedido do usuário" },
    { "i": 1, "tipo": "pensamento", "ts": 1795…, "texto": "…" },
    { "i": 2, "tipo": "assistente", "ts": 1795…, "texto": "resposta em markdown" },
    { "i": 3, "tipo": "ferramenta", "ts": 1795…, "ferramenta": {
        "id": "toolu_…", "nome": "Bash", "resumo": "npm test",
        "entrada": { "command": "npm test" },               // objeto; strings longas cortadas em 4000 caracteres
        "saida": "texto do resultado (cortado em 6000)",     // null enquanto pendente
        "erro": false, "pendente": false, "fimTs": 1795…, "duracaoMs": 812,
        "subagenteId": "claude:sub:a35b…"                    // só na ferramenta Agent/Task, quando se sabe o filho
    } },
    { "i": 4, "tipo": "sistema", "ts": 1795…, "texto": "interrompido pelo usuário" }
  ]
}
```

Tipos de evento: `usuario`, `assistente`, `pensamento`, `ferramenta`, `sistema`. Qualquer campo pode vir `null` quando a plataforma não grava aquilo (o Cursor não grava horários nem resultados de ferramenta; o agente externo só tem o resumo).

## Agente externo

`POST /api/agente` com JSON:

```json
{ "id": "bot:1", "plataforma": "outro", "nome": "GLM", "estado": "trabalhando", "ferramenta": "busca", "detalhe": "previsão do tempo", "projeto": "meu-bot", "modelo": "glm" }
```

Só `id` e `estado` são obrigatórios. O servidor completa o resto e tira o agente depois de 2 minutos sem atualização. `"estado": "encerrado"` tira na hora. `"erro": true` (ou o nome da ferramenta que falhou) marca `erroEm` com a hora do pedido.
