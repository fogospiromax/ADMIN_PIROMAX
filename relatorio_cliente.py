"""Prepara um relatório individual usando apenas dados já existentes no CRM."""

from collections import defaultdict
from datetime import date


MESES = ('jan', 'fev', 'mar', 'abr', 'mai', 'jun',
         'jul', 'ago', 'set', 'out', 'nov', 'dez')
RESULTADOS = {
    'conversou': 'Conversou',
    'sem_resposta': 'Sem resposta',
    'orcamento': 'Pediu orçamento',
    'retorno': 'Retorno combinado',
    'sem_interesse': 'Sem interesse',
}


def moeda(valor):
    if valor is None:
        return '—'
    texto = '{:,.2f}'.format(float(valor))
    return 'R$ ' + texto.replace(',', '#').replace('.', ',').replace('#', '.')


def data_br(valor):
    if not valor:
        return '—'
    try:
        return date.fromisoformat(str(valor)[:10]).strftime('%d/%m/%Y')
    except ValueError:
        return str(valor)


def mes_br(valor):
    ano, mes = str(valor).split('-')[:2]
    return '{}⁄{}'.format(MESES[int(mes) - 1], ano[-2:])


def preparar(cliente, interacoes, tarefas, meta, hoje):
    """Devolve números e contexto do cliente sem consultar ou alterar o banco."""
    referencia = date.fromisoformat(meta['ref'])
    cliente_id = cliente['id']
    historico = sorted(cliente.get('hist') or [], key=lambda item: item[0], reverse=True)
    por_mes = defaultdict(float)
    for data, valor in historico:
        por_mes[str(data)[:7]] += float(valor)

    mes_atual = referencia.year * 12 + referencia.month - 1
    serie = []
    for deslocamento in range(-11, 1):
        indice = mes_atual + deslocamento
        chave = '{:04d}-{:02d}'.format(indice // 12, indice % 12 + 1)
        serie.append({'mes': chave, 'rotulo': mes_br(chave),
                      'valor': por_mes[chave], 'parcial': deslocamento == 0})
    maior = max((item['valor'] for item in serie), default=0) or 1
    for item in serie:
        item['largura'] = round(item['valor'] / maior * 100, 1)

    contatos = [dict(item, resultado_rotulo=RESULTADOS.get(item.get('resultado'), 'Contato'))
        for item in interacoes if item.get('cliente') == cliente_id and item.get('tipo') != 'tarefa']
    contatos.sort(key=lambda item: (item.get('data') or '', item.get('id') or ''), reverse=True)
    pendentes = [item for item in tarefas
                 if item.get('cliente') == cliente_id and not item.get('feita')]
    pendentes.sort(key=lambda item: (not bool(item.get('prazo')),
                                    item.get('prazo') or '9999-12-31', item.get('titulo') or ''))

    sinais = []
    if cliente.get('encerrado'):
        sinais.append(('neutro', 'Cliente encerrado',
                       'As vendas realizadas permanecem no histórico; não há estimativa futura.'))
    else:
        if not cliente.get('responsavel_usuario'):
            sinais.append(('atencao', 'Sem responsável',
                           'Atribua um responsável para incluir o cliente em uma agenda pessoal.'))
        if pendentes and pendentes[0].get('prazo') and pendentes[0]['prazo'] <= hoje.isoformat():
            sinais.append(('atencao', 'Próximo passo pendente',
                           'Há uma tarefa vencida ou para hoje; confira o combinado antes do contato.'))
        elif cliente.get('contato_urgente'):
            sinais.append(('atencao', 'Contato pendente', cliente.get('contato_rotulo') or
                           'A rotina de contato pede atenção.'))
        if cliente.get('direcao') in ('em queda', 'queda forte', 'parou'):
            sinais.append(('ruim', 'Compras em queda',
                           'A evolução das vendas merece uma conversa com o cliente.'))
        if not sinais:
            sinais.append(('bom', 'Acompanhamento em dia',
                           'Mantenha a rotina de contato e acompanhe a próxima compra.'))

    anos_base = int(cliente.get('ytd_n_anos') or 0)
    return {
        'cliente': cliente,
        'referencia': referencia.isoformat(),
        'gerado_em': hoje.isoformat(),
        'ultima_importacao': meta.get('ultima_importacao'),
        'serie': serie,
        'compras': historico,
        'contatos': contatos,
        'pendentes': pendentes,
        'sinais': sinais,
        'anos_base': anos_base,
        'comparacao_disponivel': anos_base > 0 and (cliente.get('ytd_base') or 0) > 0,
        'horizonte': cliente.get('horizonte') or {},
    }
