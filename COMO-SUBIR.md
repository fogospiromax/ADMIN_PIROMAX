# Carteira de Clientes — o que subir no GitHub

## Os quatro arquivos

Substitua estes quatro, mantendo a mesma estrutura de pastas do repositório:

| Arquivo | O que mudou |
|---|---|
| `app.py` | Ganhou duas rotas novas dentro do bloco da carteira: `/admin/carteira/contato` e `/admin/carteira/rotina-lote`. As **35 rotas originais do app continuam iguais**, palavra por palavra — conferido por comparação antes e depois. |
| `carteira.py` | Rotina de contato (cadência 15/30 dias), a fila única, os comparativos ano a ano e o importador de leads que entende a planilha do Albatros. |
| `templates/admin_carteira.html` | Tela reescrita: de dez abas para cinco. |
| `static/carteira.js` | Toda a lógica da tela nova. |

Não mexa em `requirements.txt` nem em `render.yaml`: nenhuma dependência nova
foi usada. Continua Flask, gunicorn, psycopg2 e tzdata.

## O banco se atualiza sozinho

Na primeira vez que o app subir, `init_carteira_db()` roda estes comandos, que
são idempotentes e não apagam nada:

```sql
ALTER TABLE carteira_ficha ADD COLUMN IF NOT EXISTS dispensa  BOOLEAN DEFAULT FALSE;
ALTER TABLE carteira_ficha ADD COLUMN IF NOT EXISTS cadencia  INTEGER;
ALTER TABLE carteira_lead  ADD COLUMN IF NOT EXISTS segmento  TEXT DEFAULT '';
ALTER TABLE carteira_lead  ADD COLUMN IF NOT EXISTS instagram TEXT DEFAULT '';
```

Você não precisa rodar nada à mão no Render. Vendas, fichas, motivos, contatos,
tarefas, unificações e leads que já estiverem no banco continuam onde estão.

## Depois do deploy, um passo só

Abra **Prospecção › Carregar lista de leads** e envie o arquivo
`leads-piromax.csv` que está aqui junto. Ele é a sua planilha do Albatros
convertida: 248 leads, com o tipo de lead virando etapa do funil.

A tela mostra a prévia antes de gravar. O que ela vai dizer:

- 248 leads no arquivo, todos novos
- 155 entram em "A qualificar", 54 em "Qualificado", 39 em "Em conversa"
- **6 já compram da Piromax** e entram marcados: Fogos Caruaru (aparece duas
  vezes na sua planilha), Palácio dos Fogos, Saçço Comércio de Fogos, Só Fogos
  e Tecnofogos
- nenhum sem estado, 2 sem telefone

Reenviar o mesmo arquivo depois não duplica nada.

## Verificar antes de confiar

Este código rodou contra um Postgres de verdade com a sua base inteira:

- 2.283 notas, 161 clientes, R$ 21.786.516,87 — os mesmos números de sempre
- reenviar o arquivo de vendas inteiro inseriu 0 linhas, como tem que ser
- registrar um contato tira o cliente da fila e ele volta no fim do prazo
- dispensar da rotina e dar cadência própria gravam e persistem
- as cinco abas abrem, a ficha tem endereço próprio, não há erro de JavaScript
- no celular não há rolagem horizontal

O que **não** foi verificado: nada disso rodou no Render ainda. A primeira
subida é o primeiro teste em produção.

## Uma coisa para conferir no Render

Em Environment, confirme que `ADMIN_PASSWORD` e `SECRET_KEY` estão definidos.
Se não estiverem, o `app.py` cai para `fogos2025` e para uma chave de sessão
fixa que está escrita no código-fonte, e agora tem dado de faturamento de
cliente ali dentro.
