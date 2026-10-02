# Piromax — auditoria de UX/UI e guia de design

**Versão:** 1.2 · **Data:** 02/10/2026 · **Âmbito:** acesso da equipe, painel, produção, pedidos, solicitações, melhorias, CRM e relatório individual.

Este é o padrão para as próximas alterações de interface. Os achados abaixo registram o estado anterior à implementação e os critérios de correção. O estado atual fica registrado a seguir. Não é uma declaração de conformidade em acessibilidade nem de que o produto já está pronto para venda externa.

## Estado da implementação local

- `static/design-system.css` reúne cores, tipografia de tela, foco, controles e cartões; os 12 templates ativos o carregam. Textos informativos antes muito claros foram escurecidos e os controles principais ganharam área de interação de 44 px.
- O CRM ganhou filtros de altura uniforme, tabela compacta com colunas de decisão e rolagem sinalizada para os detalhes, gaveta mais estreita, quadro limitado a oito cartões por etapa e acesso à lista filtrada. No celular, Prospecção abre primeiro na lista; o quadro continua disponível.
- Uma revisão da ficha corrigiu alturas inconsistentes que apareceram em uso real: campos de texto, data e seleção têm 44 px explícitos; só áreas de texto podem ser redimensionadas. A ficha de lead usa até 820 px, a troca de etapa ocupa a largura disponível, e o destino das pendências ocupa a linha inteira. Essas medidas foram conferidas em prévia renderizada com dados fictícios no desktop e no celular.
- A revisão visual com dados fictícios confirmou Clientes e Prospecção em 1280 px, a carteira em 360, 390, 768 e 1600 px, e a lista de leads em 390 px. Pré-visualizações estáticas a 390 px também verificaram login, painel principal, produção, pedidos, solicitações e melhorias; os controles densos e cabeçalhos foram ajustados onde necessário. Os testes automatizados cobrem o fluxo de lista do quadro. Ainda falta a rodada interativa completa dos módulos operacionais com dados e estados reais, além de erro, zoom, impressão e Safari/Chrome, antes de considerar o sistema finalizado para venda externa.

## Como a revisão foi feita

- Inspeção visual do CRM publicado no Safari em tela grande, incluindo navegação, filtros e quadro de prospecção.
- Leitura dos templates ativos, do JavaScript e do CSS local de todos os módulos. Arquivos de backup não foram avaliados.
- Conferência de dimensões e cores declaradas no código. As proporções de contraste indicadas abaixo foram calculadas para as cores do código, não medidas por captura de tela.
- Os demais módulos, estados de erro e telas móveis **ainda exigem uma rodada visual interativa** em Safari e Chrome antes de receber o selo interno de versão final. Esta auditoria não alterou registros de produção nem reproduziu dados de clientes no guia.

## Veredito de produto

O sistema tem uma identidade reconhecível e um fluxo comercial útil: o CRM separa Hoje, Clientes, Prospecção, Resultados e Dados; a ficha traz ações e contexto; o relatório individual diferencia realizado de estimado. A navegação do CRM, o foco visível e o tratamento de teclado da gaveta são bons pontos de partida.

A camada visual compartilhada agora cobre os templates ativos, mas parte das regras antigas continua dentro de cada template. A consolidação de componentes e comportamentos ainda é trabalho futuro. Para uma demonstração de produto maduro, a prioridade é validar legibilidade, estados e fluxos completos antes de acrescentar efeitos visuais.

### Achados da auditoria inicial e critérios para produto final

| Prioridade | Observação verificável | Efeito no uso | Critério de correção |
| --- | --- | --- | --- |
| P0 | `#9ca3af` é usado como texto informativo sobre branco em vários módulos; contraste calculado de **2,54:1**. | Datas, legendas, placeholders que carregam contexto e metadados ficam difíceis de ler. | Texto normal com pelo menos 4,5:1; informação secundária em `#526071` ou cor validada. Placeholder nunca será o único rótulo. |
| P0 | Há rótulos e metadados de `0.62rem` a `0.72rem` no CRM e textos de 10–12 px em produção e relatório. | Leitura lenta em telas grandes, zoom necessário, hierarquia invertida quando o detalhe é importante. | Texto operacional: 14 px no mínimo; texto principal: 16 px; 12 px apenas para legenda não essencial e impressão. |
| P0 | Ações de 30–34 px aparecem em pedidos e produção; alguns ícones têm apenas `title`. | Alvos difíceis de clicar e pouco claros para toque e tecnologia assistiva. | Área clicável de 44×44 px para ações usuais; nome acessível explícito para ícones. |
| P0 | No Safari publicado, a segunda linha dos filtros de Prospecção parece visivelmente menor que a primeira, apesar de regras locais de altura mínima. | Filtros têm peso visual desigual e exigem mais precisão para usar. | Medir altura renderizada em Safari e Chrome; todos os campos da barra devem ter 44 px e alinhamento comum. |
| P1 | CRM, painel, produção, pedidos e solicitações repetem CSS próprio; o relatório usa outro roxo (`#6844bb`), enquanto o restante usa `#7c3aed`. | O usuário sente que mudou de produto; correções precisam ser repetidas e divergem. | Uma folha de tokens e componentes compartilhados; variações por módulo apenas quando o contexto exigir. |
| P1 | O quadro de Prospecção tenta mostrar uma carteira grande dentro de colunas com rolagem interna. | Muito conteúdo compete pela atenção; encontrar a próxima ação é mais difícil que ver o estágio. | Quadro como visão de andamento; limitar a amostra inicial por etapa, mostrar prioridades e abrir lista filtrada para trabalho em massa. |
| P1 | A ficha do CRM pode ocupar até 94% da tela e 1.180 px, com cabeçalho e indicadores fixos. | A gaveta se aproxima de uma segunda página; sobra pouco contexto lateral e há rolagens aninhadas. | Definir largura por tarefa: edição rápida em até 720 px; ficha analítica em até 960 px ou página própria. Uma área principal de rolagem. |
| P1 | Telas de operação têm padrões diferentes para salvar, confirmar, excluir e exibir retorno. | O usuário precisa reaprender uma ação familiar em cada módulo. | Botões, mensagens, estados de carregamento e confirmações devem seguir os mesmos componentes. |
| P1 | Produção e parte de pedidos têm poucos ajustes explícitos para telas estreitas; os formulários de pedidos usam colunas fixas. | Há risco de compressão/rolagem lateral e de controles pequenos no celular. | Revisar em 360, 390 e 768 px com conteúdo longo; nenhuma ação essencial cortada. |
| P2 | O relatório individual tem uma linguagem visual mais sóbria, porém usa vários rótulos de 10–11 px na tela. | Boa peça para impressão, leitura fraca na tela. | Separar estilos de tela e impressão; tela com escala legível, impressão compacta. |

## Revisão por área

| Área | O que funciona | O que mudar antes da versão final |
| --- | --- | --- |
| Login | Formulário simples, poucos passos e rótulos explícitos. | Aproximar aparência do painel; melhorar texto de erro e estado de envio; conferir foco e zoom. |
| Painel da equipe e painel principal | Cartões de módulo fáceis de reconhecer. | Unificar cabeçalho, largura, tipografia e navegação; clima/mensagem não devem competir com a tarefa principal. |
| Hoje | Boa separação entre agenda e sugestões; prioridade operacional clara. | Mostrar primeiro os atrasos e próximas ações; reduzir explicação repetida; ampliar metadados de data e responsável. |
| Clientes | Filtros e seleção em lote úteis; dados comerciais ligados à ficha. | Fazer uma tabela de prioridades de coluna. Nome, saúde, valor, responsável e próxima ação precisam sobreviver a larguras menores; detalhes complementares ficam em expansão. Cabeçalho e valores numéricos precisam de alinhamento consistente. |
| Prospecção | Estágio visível, relação indireta explícita, quadro e lista. | A lista deve ser o modo de trabalho para volumes altos; o quadro deve destacar vencidos, sem ação e responsáveis. Uniformizar os filtros renderizados e reduzir ruído em cada cartão. |
| Ficha de cliente/lead | Ações próximas do contexto, histórico, atalhos de teclado e foco tratado. | Reorganizar em resumo, próxima ação, histórico e dados; reduzir largura quando for edição breve; manter uma ação primária por bloco e erros junto ao campo. |
| Resultados | Comparações e notas metodológicas ajudam a interpretação. | Colocar decisão e período antes dos gráficos; manter escalas, unidades e legendas próximas dos dados; validar leitura em zoom e tela pequena. |
| Dados/importação | Prévia antes de gravar é um bom mecanismo de confiança. | Distinguir com clareza “prévia”, “pronto para importar”, “importado” e “precisa de revisão”; evitar texto denso como única orientação. |
| Produção semanal | Estrutura por semana e pessoa é direta. | Aumentar datas e controles de 11–13 px; padronizar salvar/erro; validar lista longa e teclado. |
| Pedidos | Agrupamento por cliente e separação pendente/concluído são úteis. | Rever formulário com cinco colunas fixas, ícones de 30 px e rótulos implícitos; simplificar ações por linha e revisar responsividade. |
| Solicitações e melhorias | Cartões e categorias ajudam a varredura. | Padronizar cores de status, seleção de categoria, confirmação, toasts e alvos; deixar o estado selecionado perceptível além da cor. |
| Relatório individual | Resumo, sinais, histórico e estimativa formam uma narrativa forte. | Aumentar texto na tela e alinhar tokens ao produto; manter versão A4 compacta como variante de impressão. |

## Princípios de experiência

1. **A próxima ação vem primeiro.** Cada tela deve responder “o que preciso fazer agora?” antes de mostrar análise histórica.
2. **O detalhe aparece quando ajuda a decidir.** Resumo e filtros primeiro; histórico completo, cadastros e metodologia em expansão ou ficha.
3. **O mesmo gesto produz o mesmo resultado.** Salvar, cancelar, excluir, filtrar e abrir ficha precisam ter apresentação e comportamento consistentes.
4. **Cor reforça significado; não o carrega sozinha.** Toda condição tem texto, ícone ou posição além da cor.
5. **Números precisam de origem e período.** Realizado, estimado, atrasado e pendente nunca devem parecer equivalentes.
6. **Sem surpresa ao editar.** Mudanças rápidas exibem confirmação, preservam rascunho e mostram erro perto da ação.
7. **Densidade controlada.** Há modo compacto para varrer listas, mas leitura operacional nunca depende de letras minúsculas.

## Fundamentos visuais obrigatórios

### Cores

Usar tokens semânticos em um arquivo compartilhado. Valores abaixo são a proposta inicial para preservar a identidade atual; verificar combinações reais de texto/fundo após implementar.

| Token | Valor inicial | Uso |
| --- | --- | --- |
| `--brand` | `#7c3aed` | Ação primária, seleção e foco. |
| `--brand-hover` | `#6d28d9` | Hover de ação primária. |
| `--brand-subtle` | `#f5f3ff` | Seleção leve e fundo contextual. |
| `--ink` | `#1e1b4b` | Títulos e valores de destaque. |
| `--text` | `#2d3748` | Texto comum. |
| `--text-secondary` | `#526071` | Contexto, datas, metadados e legenda operacional. |
| `--surface` | `#ffffff` | Cartões, campos, gavetas. |
| `--canvas` | `#f7f8fb` | Fundo geral menos lilás, para que o roxo apareça onde importa. |
| `--border` | `#dfe3eb` | Limites de campos e cartões. |
| `--success` | `#166b4a` | Concluído ou melhora, sempre com texto. |
| `--warning` | `#8d6008` | Atenção ou prazo próximo, sempre com texto. |
| `--danger` | `#b03027` | Erro ou ação destrutiva, sempre com texto. |

Não usar `#9ca3af`, `#c4b5fd`, `#a78bfa` ou `#d8b4fe` para texto informativo em fundo branco. O primeiro tem contraste de 2,54:1 no branco; os demais também ficam abaixo de 4,5:1. Eles podem continuar em bordas, superfícies ou decoração, após verificar o contraste do componente.

### Tipografia e espaçamento

Fonte de tela: `system-ui, -apple-system, "Segoe UI", sans-serif`. Monoespaçada só para códigos, números tabulares e datas quando isso melhorar comparação. Evitar texto todo em caixa alta exceto rótulos curtos.

| Papel | Tamanho / entrelinha | Peso |
| --- | --- | --- |
| Título da página | 28 px / 34 px | 700 |
| Título de seção | 20 px / 28 px | 700 |
| Título de cartão | 16 px / 24 px | 650–700 |
| Texto e campos | 16 px / 24 px | 400–600 |
| Metadado e ajuda operacional | 14 px / 20 px | 400–600 |
| Legenda não essencial | 12 px / 16 px | 600 |
| Indicador principal | 32–40 px / 1,1 | 650–700 |

Espaçamento: escala de **4, 8, 12, 16, 24, 32 e 48 px**. Cartão: 16–24 px internos; seções: 24–32 px; campos relacionados: 8–12 px. Raios: controles 8 px, cartões 12 px, gavetas 16 px, chips arredondados. Sombra leve apenas para separar superfícies; estado ativo deve depender de borda, fundo ou texto, não de sombra.

### Dimensões dos componentes

| Componente | Regra |
| --- | --- |
| Campo, seleção, busca | Altura **44 px** em tela; rótulo sempre visível ou acessível; `width:100%` dentro da célula do grid; `min-width:0`. Confirmar altura **renderizada** no Safari. |
| Área de texto | Altura inicial coerente com a tarefa, ao menos 96 px na ficha comercial; `resize` permitido apenas nela. Inputs de data e seletores nunca recebem alça de redimensionamento. |
| Botão primário e secundário | Altura mínima **44 px**, 14–16 px de texto, 12–16 px de padding horizontal. Uma ação primária por bloco de trabalho. |
| Botão só com ícone | Caixa de **44×44 px**; `aria-label` descritivo; tooltip opcional. |
| Chip/filtro compacto | Altura mínima **36 px** quando não é ação principal; área de toque de 44 px no celular. |
| Linha de tabela | 52–60 px no modo padrão; 44 px só no modo compacto explícito. Números à direita com algarismos tabulares. |
| Cartão de lead | Nome, estágio, responsável e próxima ação como hierarquia fixa; no máximo dois metadados extras no quadro. Conteúdo completo na ficha. |
| Gaveta | Até 720 px para edição rápida; até 960 px para ficha com duas colunas. Acima disso, usar página de detalhe. |
| Mensagem de retorno | Aparece ao lado da ação e em região anunciável (`aria-live`) quando apropriado; não desaparece antes de ser compreendida. |

**Referência de tokens e componentes para futuras iterações.** A implementação atual está em `static/design-system.css`, com nomes de token prefixados por `--ui-`:

```css
:root {
  --brand: #7c3aed;
  --ink: #1e1b4b;
  --text: #2d3748;
  --text-secondary: #526071;
  --surface: #fff;
  --canvas: #f7f8fb;
  --border: #dfe3eb;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --radius-control: 8px;
  --radius-card: 12px;
}
.ui-control { box-sizing: border-box; width: 100%; height: 44px; min-width: 0; }
.ui-button { min-height: 44px; padding: 10px 16px; }
.ui-icon-button { width: 44px; height: 44px; }
```

## Padrões de tela e interação

### Navegação e cabeçalho

- Um cabeçalho compartilhado entre painel, CRM e módulos operacionais: marca, título da área, usuário e caminho de volta. No desktop, a navegação lateral do CRM pode continuar; no celular vira navegação horizontal ou menu, sem esconder a área ativa.
- Cada tela tem **um** `h1`, um subtítulo curto e uma ação primária no canto superior direito quando existir. Evitar repetir o mesmo dado no cabeçalho, hero e cartão inicial.
- Ao voltar de ficha ou relatório, preservar tela, filtros, ordenação e posição de leitura.

### Filtros, listas e quadro

- Busca primeiro; 2–4 filtros frequentes visíveis; filtros avançados em expansão. Todos os filtros têm rótulo e opção de limpar. A contagem deve dizer “X de Y” e atualizar imediatamente.
- Lista = modo de operação para muitos registros. Quadro = modo de acompanhar distribuição por estágio. No quadro, mostrar no máximo 8–12 cartões iniciais por etapa e um acesso à lista filtrada para o restante; não encolher cartões para caber.
- Nas tabelas, preservar as colunas de decisão em largura estreita. Colunas adicionais podem ir para “Detalhes”. Evitar tabela inteira minúscula ou scroll horizontal sem indicação. Cabeçalho visível quando a lista rolar.
- Ordenação, filtro e busca precisam continuar após abrir e fechar uma ficha. Estado vazio deve explicar por que não há resultado e oferecer limpar filtros ou criar registro, conforme o caso.

### Fichas, formulários e ações destrutivas

- Na ficha: **resumo → próxima ação → histórico → cadastro → análise**. Contato e retorno próximos do topo. O nome e a etapa continuam visíveis durante a rolagem, sem ocupar uma faixa excessiva.
- Rótulos acima dos campos; obrigatório e opcional explícitos; exemplos em texto de ajuda, nunca apenas em placeholder. Campos relacionados compartilham linha e altura. Erro específico perto do campo e preservação integral do rascunho.
- Salvar mostra estados: pronto, salvando, salvo e erro. Não repetir envio por clique duplo. Confirmar descarte de rascunho; confirmar exclusão com objeto e consequência. Botão de exclusão visualmente separado do botão principal.
- Qualquer ação de ícone precisa de texto acessível. Modais e gavetas recebem foco ao abrir, prendem o foco enquanto abertos, fecham com Escape e devolvem o foco ao controle de origem.

### Estados, dados e gráficos

- Criar estados explícitos para carregando, vazio sem cadastro, vazio por filtro, erro de rede, erro de validação, sem permissão e sucesso. Não usar traços (`—`) para misturar significados diferentes.
- Dados realizados, tarefas registradas e estimativas precisam de nome, período, unidade e explicação breve. Tendência sempre exibe valor, sentido e comparação; cor é apoio.
- Gráficos com eixos, legenda e alternativa textual. No relatório, separar o estilo de tela do estilo A4 e não usar fonte de impressão de 10–11 px na tela.

## Acessibilidade e qualidade mínima

Adotar **WCAG 2.2 AA como meta de verificação**, sem declarar conformidade antes de auditoria. A norma exige 4,5:1 para texto normal, 3:1 para texto grande e componentes gráficos relevantes, e estabelece 24×24 px como mínimo de alvo de ponteiro com exceções. Este guia escolhe **44×44 px** como padrão interno de conforto, acima do mínimo normativo. Fontes de 14–16 px são uma decisão de legibilidade do produto, não um requisito textual específico da WCAG.

Referências oficiais: [WCAG 2.2 — W3C](https://www.w3.org/TR/WCAG22/), [visões de tabela e quadro no CRM da HubSpot](https://knowledge.hubspot.com/records/manage-index-page-types-and-tabs?product=crm). A HubSpot é referência de organização de registros e vistas; os tokens e fluxos deste guia são escolhas para a Piromax, não cópia do produto.

## Instruções para as próximas alterações de código

1. Antes de alterar uma tela, identificar o componente existente mais próximo. Reutilizar; não criar outro botão, chip, modal ou toast apenas porque o HTML do módulo é separado.
2. Manter `static/design-system.css` como base de tokens e componentes compartilhados; migrar gradualmente as regras ainda repetidas nos templates, validando cada módulo antes de avançar.
3. Remover valores visuais repetidos dos templates e dos estilos inline gerados pelo JavaScript. Variações devem ser classes semânticas (`.is-danger`, `.is-selected`), não cores e dimensões soltas.
4. Preservar a semântica do produto: cliente direto, lead, cliente indireto, tarefa, venda realizada e previsão não são a mesma coisa. Nenhum retoque visual pode esconder essa distinção.
5. Testar com conteúdo fictício curto, longo, ausente e com números grandes. Nunca salvar dados reais de clientes em fixtures, capturas de revisão ou documentação.
6. Toda mudança de componente deve verificar mouse, teclado, toque, zoom e ao menos Safari e Chrome. Um teste de HTML sem navegador não substitui inspeção do tamanho renderizado.
7. Não introduzir nova fonte externa, biblioteca visual ou animação sem demonstrar uma melhoria concreta para a rotina da equipe.

### Critério de aceite visual para cada entrega

- Capturas revisadas em 360, 390, 768, 1280 e 1600 px; zoom de 100% e 200%.
- Sem texto operacional menor que 14 px, botão principal menor que 44 px, campo cortado, rolagem lateral inesperada ou conteúdo sobreposto.
- Contraste verificado nos estados normal, hover, foco, desabilitado, erro e selecionado.
- Fluxos de criar, editar, filtrar, salvar com sucesso, salvar com erro, cancelar e excluir percorridos por teclado.
- Estados vazio, carregando, erro e conteúdo longo revisados; tabela e quadro com carteira volumosa.
- Testes de regressão existentes passam; a revisão visual é registrada separadamente. Impressão/A4 verificada quando a tela for relatório ou programação.

## Ordem recomendada de execução

1. **Legibilidade e acessibilidade:** corrigir cor de texto secundário, escala tipográfica e áreas clicáveis em todas as telas; medir filtros no Safari.
2. **Componentes compartilhados:** tokens, cabeçalho, botões, campos, chips, cartão, toast e confirmação. Migrar login e painel, depois módulos operacionais, por último CRM e relatório.
3. **Telas de maior frequência:** Hoje, lista de Clientes, Prospecção e fichas. Reduzir densidade do quadro e esclarecer ações de cada registro.
4. **Responsividade e estados:** concluir QA em celular e zoom, conteúdo longo, falha de rede e impressão.
5. **Validação com a equipe:** observar os usuários comerciais executando tarefas reais do dia a dia; medir tempo até a próxima ação, erros de clique e dúvidas recorrentes. Ajustar o guia com evidências dessa rodada.

O produto deve ser considerado **visualmente pronto** somente quando os itens P0 estiverem corrigidos, os fluxos críticos passarem no critério de aceite e a revisão interativa dos módulos restantes estiver concluída.
