# CRM Piromax — implantação e uso

## Antes de subir ao GitHub

Envie os arquivos de código da pasta `APP`, mantendo as subpastas. Os arquivos necessários incluem `crm_auth.py`, `relatorio_cliente.py`, `static/carteira-ux.css`, `templates/admin_relatorio_cliente.html` e `scripts/gerar_acessos.py`; os arquivos alterados incluem `app.py`, `carteira.py`, `static/carteira.js`, `templates/admin_carteira.html` e este guia. `requirements.txt` e `render.yaml` não exigem mudança para o relatório. Revise o que vai no commit: arquivos de dados, backups, caches e credenciais locais não fazem parte desta mudança. O `.gitignore` ajuda a evitar novos commits desses arquivos, mas não remove arquivos já enviados ou incluídos manualmente pelo site do GitHub.

**Não envie as credenciais geradas fora da pasta `APP` ao GitHub.** Cada pessoa pode escolher uma senha própria, digitada diretamente no Render, ou usar as senhas fortes geradas no arquivo privado de acessos. Entregue as senhas por um meio privado.

## Configurar o Render

Se o serviço já possui `DATABASE_URL` e `SECRET_KEY`, **mantenha os valores atuais**. Em **Environment**, adicione estas três variáveis. O valor de cada uma é a senha comum que aquela pessoa usará no login:

- `PIROMAX_PASSWORD_FLAVIA`
- `PIROMAX_PASSWORD_TIAGO`
- `PIROMAX_PASSWORD_FERNANDO`

As três variáveis antigas `PIROMAX_PASSWORD_HASH_...` não serão usadas pelo código novo. O arquivo privado `piromax-render.env` foi atualizado para conter somente as três senhas comuns geradas anteriormente, caso prefira usá-las. Você também pode escolher outras senhas e digitá-las diretamente no Render. Não faça upload do arquivo de credenciais.

Salve as três novas variáveis com **Save only** e depois suba este código atualizado ao GitHub. O deploy do novo código passará a usar as senhas digitadas no Render. A versão que exige hashes continuará recusando essas senhas até o novo código ser implantado.

Depois de verificar os três novos logins, remova `ADMIN_PASSWORD`, `ADMIN_USERNAME` e as três variáveis `PIROMAX_PASSWORD_HASH_...`, que o código atualizado ignora. `DATABASE_URL` e `SECRET_KEY` continuam configuradas. O login `admin` e sessões antigas são recusados pelo código novo.

Se preferir gerar senhas novas no futuro, execute `python3 scripts/gerar_acessos.py /pasta/privada/fora/da/APP`. O script não sobrescreve arquivos existentes. Mudar uma senha no Render invalida a sessão daquele usuário.

## O que muda no uso

- Flávia, Tiago e Fernando entram com seu nome de usuário e senha individual. Todos acessam o painel inteiro e veem a carteira completa.
- Clientes existentes começam sem responsável na **Fila de distribuição** em Clientes. É possível atribuir um por vez na tabela ou selecionar vários e atribuir em lote. Um cliente só aparece na agenda pessoal após receber responsável.
- **Hoje** mostra compromissos, sugestões e contagem de contatos de acordo com o usuário autenticado. Cada lead tem responsável próprio, independente do cliente que o abastece por revenda; leads criados manualmente começam com o responsável que os criou.
- Ao registrar contato, o servidor grava automaticamente o usuário autenticado no histórico. O formulário mostra o nome, sem campo editável para essa autoria.
- Se um contato efetivo for salvo sem próxima data, ele reinicia a cadência de rotina do cliente. Tentativas **sem resposta** e **retornos combinados** exigem próximo passo com data.
- Na ficha do cliente, **Histórico de compras** mostra todas as vendas importadas, inclusive nomes unificados. Como a origem contém apenas data, cliente e valor, lançamentos do mesmo dia são agrupados como uma compra; os lançamentos individuais podem ser abertos.
- **Ver relatório individual** abre uma página interna com resumo, evolução mensal, comparação com anos anteriores, estimativa de três meses, tarefas, contatos e compras. **Imprimir / salvar PDF** usa a impressão do navegador. O PDF traz as oito compras mais recentes; o histórico completo continua na página. A data de referência e a última importação deixam claro até quando há dados.

## Interface

O CRM mantém cinco áreas: Hoje, Clientes, Prospecção, Resultados e Dados. Em telas largas, elas ficam em uma navegação lateral fixa; em telas menores, continuam em abas horizontais. O fundo ficou mais neutro, cartões e tabelas têm bordas discretas, e o roxo aparece principalmente na seleção e nas ações principais. A agenda destaca vencidos, hoje e próximos; a lista de clientes mostra primeiro as informações úteis para agir, deixando colunas analíticas sob **Mostrar detalhes**. A ficha separa trabalho diário de cadastro e números, e o histórico de compras é carregado apenas quando a ficha é aberta.

Em **Clientes**, busca, estado e cidade agora dividem a linha em proporções equilibradas e têm a mesma altura. A edição em lote separa distribuição, campos do cadastro e ações em linhas próprias; os seletores de dados têm larguras iguais e se reorganizam em telas estreitas.
Na tabela principal, **Valor total comprado** mostra a soma em reais das compras de cada cliente. A quantidade e a data da última compra ficam em **Mostrar detalhes e editar localização**. As colunas continuam ordenáveis.

Ao fechar uma ficha com o mouse, a linha anterior não conserva o contorno roxo. Ao navegar por teclado, o foco volta ao elemento anterior para manter a acessibilidade. O antigo símbolo `?` antes de seções expansíveis foi substituído por um discreto indicador de abertura.

## Funil de prospecção

O funil principal agora mostra somente as etapas abertas: **A qualificar**, **Pronto para contato**, **Tentando contato** e **Em conversa**. Os desfechos ficam em **Encerrados**: **Venda direta ganha**, **Venda direta perdida** e **Fora do funil direto**. A compra por revenda continua sendo uma informação independente da etapa. Por exemplo, um cliente indireto sem oportunidade de venda direta pode ficar em **Fora do funil direto** sem contar como venda perdida.

A etapa pode ser mudada no topo da ficha, na lista ou no cartão do funil. Ao registrar um contato, o usuário também pode escolher a etapa seguinte no mesmo formulário. Para encerrar, a ficha pede motivo quando o desfecho for **Perdida** ou **Fora do funil direto** e exige escolher se compromissos pendentes continuam na agenda ou são cancelados. Tarefas canceladas saem da agenda, mas permanecem no histórico da ficha. Não feche um lead como ganho apenas por ter recebido interesse: use **Venda direta ganha** para uma venda direta confirmada.

Na prévia de importação, rótulos ambíguos de etapa, como `cliente`, aparecem para revisão e entram em **A qualificar**. O rótulo original fica na ficha; use o filtro **Etapas da importação a revisar** para encontrá-los e confirme ou altere a classificação. O aplicativo não presume que “cliente” signifique venda direta ganha. Registros antigos não são reclassificados automaticamente; revise especialmente leads já marcados como **Ganhou** ou **Perdido** que compram por revenda. A taxa exibida no funil continua baseada nas marcações de ganhos e perdas diretas, não em pedidos confirmados.

## Banco de dados e conferência

Na inicialização, o aplicativo acrescenta campos de responsável em clientes e leads e de autoria nos contatos. A migração é aditiva: não apaga vendas, contatos, tarefas ou clientes. Vendas existentes não são redistribuídas automaticamente.

Para o novo funil, a inicialização acrescenta campos de cancelamento às tarefas e um campo para lembrar rótulos ambíguos de importação. Nenhuma tarefa antiga é cancelada e nenhum lead existente muda de etapa automaticamente.

Após o deploy, confirme: os três logins entram; `admin` não entra; a fila mostra clientes sem dono; atribuir um cliente altera a agenda da pessoa correta; o histórico de compras abre na ficha; um contato novo mostra o usuário que o registrou. Os testes locais usam somente dados fictícios e não verificam o banco de produção ou a implantação no Render.
