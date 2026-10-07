"""Relatórios gerenciais em PDF, calculados a partir da carteira já carregada."""

from calendar import monthrange
from datetime import date
from html import escape
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (HRFlowable, LongTable, PageBreak, Paragraph,
                                SimpleDocTemplate, Spacer, Table, TableStyle)


ROXO = colors.HexColor('#6042aa')
TEXTO = colors.HexColor('#28243b')
MUTED = colors.HexColor('#58657a')
LINHA = colors.HexColor('#dfe3eb')
FUNDO = colors.HexColor('#f5f3fb')
VERDE = colors.HexColor('#177453')
VERMELHO = colors.HexColor('#ae3b44')
MESES = ('janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
         'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro')
USUARIOS = {'flavia': 'Flávia', 'tiago': 'Tiago', 'fernando': 'Fernando'}


def moeda(valor, casas=0):
    valor = float(valor or 0)
    return 'R$ ' + f'{valor:,.{casas}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def data_br(valor):
    if not valor:
        return 'não informada'
    try:
        return date.fromisoformat(str(valor)[:10]).strftime('%d/%m/%Y')
    except ValueError:
        return str(valor)[:10]


def _mes_mais_um(hoje):
    return (hoje.year + 1, 1) if hoje.month == 12 else (hoje.year, hoje.month + 1)


def _base_mes(cliente, ano, mes):
    """Anos comparáveis em que o cliente já existia, inclusive meses sem compra."""
    primeira = date.fromisoformat(str(cliente['primeira'])[:10])
    historico = cliente.get('hist') or []
    base = []
    for anterior in (ano - 2, ano - 1):
        fim = date(anterior, mes, monthrange(anterior, mes)[1])
        if primeira > fim:
            continue
        valor = sum(float(v) for d, v in historico
                    if str(d).startswith(f'{anterior:04d}-{mes:02d}-'))
        base.append((anterior, valor))
    return base


def preparar_ligacoes(dados, tarefas, hoje):
    """Seleciona compradores históricos e quem já comprou no mês atual.

    Ausência de vendas importadas com data no mês não equivale a venda zero.
    O histórico é um sinal para contato, nunca um pedido ou meta individual.
    """
    referencia = date.fromisoformat(dados['meta']['ref'])
    ano_seguinte, mes_seguinte = _mes_mais_um(hoje)
    mes_atual_importado = (referencia.year, referencia.month) == (hoje.year, hoje.month)
    proximas = {}
    for tarefa in tarefas:
        if tarefa.get('feita') or tarefa.get('cancelada'):
            continue
        cid = tarefa.get('cliente')
        prazo = str(tarefa.get('prazo') or '')
        if cid and (cid not in proximas or (prazo or '9999') < (proximas[cid].get('prazo') or '9999')):
            proximas[cid] = tarefa

    secoes = []
    for ano, mes, atual in ((hoje.year, hoje.month, True),
                            (ano_seguinte, mes_seguinte, False)):
        linhas = []
        for cliente in dados.get('clientes', []):
            base = _base_mes(cliente, ano, mes)
            valor_atual = None
            if atual and mes_atual_importado:
                valor_atual = sum(float(v) for d, v in cliente.get('hist') or []
                                  if str(d).startswith(f'{ano:04d}-{mes:02d}-')
                                  and str(d)[:10] <= referencia.isoformat())
            compra_historica = any(valor > 0 for _, valor in base)
            if not (atual and (valor_atual or 0) > 0) and (
                    cliente.get('encerrado') or not compra_historica):
                continue
            media = sum(valor for _, valor in base) / len(base) if base else None
            retorno = proximas.get(cliente['id'])
            linhas.append({
                'cliente': cliente['nome'],
                'responsavel': USUARIOS.get(cliente.get('responsavel_usuario'), 'Sem responsável'),
                'telefone': cliente.get('telefone') or '',
                'base': dict(base), 'anos_com_compra': sum(v > 0 for _, v in base),
                'anos_comparaveis': len(base), 'media': media, 'realizado': valor_atual,
                'encerrado': bool(cliente.get('encerrado')),
                'ultimo_contato': cliente.get('contato_ultimo'),
                'proxima_acao': (retorno.get('titulo') or '') if retorno else '',
                'proxima_data': (retorno.get('prazo') or '') if retorno else '',
            })
        linhas.sort(key=lambda x: (x['media'] is None, -(x['media'] or 0), x['cliente']))
        secoes.append({'ano': ano, 'mes': mes, 'atual': atual, 'linhas': linhas,
                       'media_total': sum(x['media'] or 0 for x in linhas),
                       'realizado_total': (sum(x['realizado'] or 0 for x in linhas)
                                            if atual and mes_atual_importado else None)})
    return {'hoje': hoje, 'referencia': referencia,
            'ultima_importacao': dados['meta'].get('ultima_importacao'),
            'mes_atual_importado': mes_atual_importado, 'secoes': secoes}


def _estilos():
    base = getSampleStyleSheet()
    return {
        'titulo': ParagraphStyle('tituloPiromax', parent=base['Title'], fontName='Helvetica-Bold',
                                 fontSize=18, leading=22, textColor=TEXTO, spaceAfter=7),
        'sub': ParagraphStyle('subPiromax', parent=base['Normal'], fontSize=9, leading=13,
                              textColor=MUTED, spaceAfter=7),
        'h2': ParagraphStyle('h2Piromax', parent=base['Heading2'], fontName='Helvetica-Bold',
                             fontSize=11, leading=15, textColor=TEXTO, spaceBefore=14,
                             spaceAfter=7, keepWithNext=True),
        'corpo': ParagraphStyle('corpoPiromax', parent=base['Normal'], fontSize=8.5,
                                leading=12, textColor=TEXTO, spaceAfter=6),
        'tabela': ParagraphStyle('tabelaPiromax', parent=base['Normal'], fontSize=7.8,
                                 leading=10.2, textColor=TEXTO),
        'tabela_muted': ParagraphStyle('tabelaMutedPiromax', parent=base['Normal'],
                                       fontSize=7.2, leading=9.2, textColor=MUTED),
        'cab': ParagraphStyle('cabPiromax', parent=base['Normal'], fontName='Helvetica-Bold',
                              fontSize=7.6, leading=9.5, textColor=colors.white),
    }


def _p(valor, estilo):
    return Paragraph(escape(str(valor or '—')).replace('\n', '<br/>'), estilo)


def _pagina(canvas, doc):
    canvas.saveState()
    largura, altura = doc.pagesize
    canvas.setStrokeColor(LINHA)
    canvas.line(doc.leftMargin, 16*mm, largura-doc.rightMargin, 16*mm)
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(doc.leftMargin, 11*mm, 'PIROMAX  ·  COMERCIAL  ·  USO INTERNO')
    canvas.drawRightString(largura-doc.rightMargin, 11*mm, f'Página {doc.page}')
    canvas.restoreState()


def _tabela(cabecalho, linhas, larguras, estilos, alinhar_direita=()):
    dados = [[_p(x, estilos['cab']) for x in cabecalho]] + linhas
    tabela = LongTable(dados, colWidths=larguras, repeatRows=1, hAlign='LEFT')
    comandos = [('BACKGROUND', (0, 0), (-1, 0), ROXO),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('TOPPADDING', (0, 0), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('LEFTPADDING', (0, 0), (-1, -1), 7),
                ('RIGHTPADDING', (0, 0), (-1, -1), 7),
                ('LINEBELOW', (0, 0), (-1, 0), .3, ROXO),
                ('LINEBELOW', (0, 1), (-1, -1), .25, LINHA),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#faf9fd')])]
    for coluna in alinhar_direita:
        comandos.append(('ALIGN', (coluna, 1), (coluna, -1), 'RIGHT'))
    tabela.setStyle(TableStyle(comandos))
    return tabela


def _documento(paginas, paisagem=False):
    buffer = BytesIO()
    largura, altura = landscape(A4) if paisagem else A4
    doc = SimpleDocTemplate(buffer, pagesize=(largura, altura),
                            leftMargin=16*mm, rightMargin=16*mm,
                            topMargin=16*mm, bottomMargin=22*mm,
                            title='Piromax · Relatório comercial', author='Piromax')
    doc.build(paginas, onFirstPage=_pagina, onLaterPages=_pagina)
    return buffer.getvalue()


def pdf_ligacoes(dados, tarefas, hoje):
    rel = preparar_ligacoes(dados, tarefas, hoje)
    s = _estilos()
    story = [_p('Compras do mês e próximo mês', s['titulo']),
             _p(f'Gerado em {data_br(hoje)} · Vendas registradas até {data_br(rel["referencia"])}. '
                'Lista de compras históricas e vendas já registradas no mês atual.', s['sub']),
             HRFlowable(width='100%', color=LINHA, thickness=.6), Spacer(1, 5*mm)]
    if not rel['mes_atual_importado']:
        story.append(_p('Atenção: a última venda importada é anterior ao mês atual. '
                        'O realizado deste mês aparece como “sem dados do mês”; '
                        'confira a importação antes de interpretar ausência de compra.', s['corpo']))
    largura = landscape(A4)[0] - 32*mm
    colunas = [164, 73, 67, 67, 77, 78, largura-526]
    for secao in rel['secoes']:
        titulo = f'{MESES[secao["mes"]-1].capitalize()} de {secao["ano"]}'
        subtitulo = ('Vendido até a última importação e histórico de compra para orientar contato.'
                     if secao['atual'] else
                     'Média dos mesmos meses dos dois anos anteriores; não são pedidos confirmados.')
        story.extend([_p(titulo, s['h2']),
                      _p(subtitulo + ' Ordenado pela média histórica, do maior para o menor.', s['sub'])])
        story.append(_p(f'{len(secao["linhas"])} cliente(s) na lista · '
                        f'média histórica somada: {moeda(secao["media_total"])}'
                        + (f' · vendido por esses clientes neste mês: {moeda(secao["realizado_total"])}'
                           if secao['realizado_total'] is not None else ''), s['corpo']))
        anos = (secao['ano']-2, secao['ano']-1)
        cab = ['Cliente / responsável', 'Telefone', str(anos[0]), str(anos[1]),
               'Média hist.', 'Vendido agora' if secao['atual'] else 'Último contato',
               'Próxima ação']
        linhas = []
        for item in secao['linhas']:
            nome = _p(item['cliente'], s['tabela'])
            historico = (f'compra em {item["anos_com_compra"]}/{item["anos_comparaveis"]} ano(s)'
                         if item['anos_comparaveis'] else 'sem base histórica')
            dono = _p(f'{item["responsavel"]} · {historico}'
                      + (' · encerrado' if item['encerrado'] else ''),
                      s['tabela_muted'])
            cliente = Table([[nome], [dono]], colWidths=[colunas[0]-14],
                            style=TableStyle([('LEFTPADDING',(0,0),(-1,-1),0),
                                              ('RIGHTPADDING',(0,0),(-1,-1),0),
                                              ('TOPPADDING',(0,0),(-1,-1),0),
                                              ('BOTTOMPADDING',(0,0),(-1,-1),1)]))
            realizado = (moeda(item['realizado']) if item['realizado'] is not None
                         else 'Sem dados do mês') if secao['atual'] else data_br(item['ultimo_contato'])
            acao = item['proxima_acao'] or 'Sem ação agendada'
            if item['proxima_data']:
                acao += f' · {data_br(item["proxima_data"])}'
            linhas.append([cliente, _p(item['telefone'] or '—', s['tabela']),
                           _p(moeda(item['base'][anos[0]]) if anos[0] in item['base'] else '—', s['tabela']),
                           _p(moeda(item['base'][anos[1]]) if anos[1] in item['base'] else '—', s['tabela']),
                           _p(moeda(item['media']) if item['media'] is not None else '—', s['tabela']),
                           _p(realizado, s['tabela']), _p(acao, s['tabela'])])
        story.append(_tabela(cab, linhas or [[_p('Nenhum cliente com compra histórica.', s['tabela'])]
                                                 + ['']*6], colunas, s))
        story.append(Spacer(1, 4*mm))
    story.append(_p('Como ler: a média histórica usa o mesmo mês nos dois anos anteriores em que '
                    'o cliente já existia. Uma compra passada indica oportunidade de conversa, '
                    'não obrigação de compra. Valores futuros são estimativas; o histórico de '
                    'cada cliente pode variar muito.', s['sub']))
    return _documento(story, paisagem=True)


def pdf_analitico(dados, hoje):
    s = _estilos()
    meta, clientes = dados['meta'], dados['clientes']
    ref = date.fromisoformat(meta['ref'])
    anos = dados['anos']['anos']
    atual = next((a for a in anos if a['ano'] == ref.year), None)
    anterior = next((a for a in anos if a['ano'] == ref.year-1), None)
    story = [_p('Relatório analítico de resultados', s['titulo']),
             _p(f'Gerado em {data_br(hoje)} · Vendas importadas até {data_br(ref)} · '
                'Comparações: 1º de janeiro até o mesmo dia e mês de cada ano.', s['sub']),
             HRFlowable(width='100%', color=LINHA, thickness=.6), Spacer(1, 5*mm)]
    if not atual:
        story.append(_p('Não há vendas registradas no ano da última importação.', s['corpo']))
    else:
        resumo = [
            ['Receita no ano', 'Pedidos', 'Clientes compradores', 'Pedido médio'],
            [moeda(atual['receita'], 2), str(atual['pedidos']), str(atual['clientes']),
             moeda(atual['ticket'], 2)],
        ]
        tab = Table(resumo, colWidths=[44*mm]*4)
        tab.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),FUNDO),
                                 ('TEXTCOLOR',(0,0),(-1,0),MUTED),
                                 ('TEXTCOLOR',(0,1),(-1,1),TEXTO),
                                 ('FONTNAME',(0,0),(-1,0),'Helvetica-Bold'),
                                 ('FONTNAME',(0,1),(-1,1),'Helvetica-Bold'),
                                 ('FONTSIZE',(0,0),(-1,0),8),
                                 ('FONTSIZE',(0,1),(-1,1),12),
                                 ('TOPPADDING',(0,0),(-1,-1),9),
                                 ('BOTTOMPADDING',(0,0),(-1,-1),9)]))
        story.extend([tab, Spacer(1, 3*mm)])
        if anterior and anterior['receita']:
            delta = (atual['receita']/anterior['receita']-1)*100
            story.append(_p(f'Contra {ref.year-1} no mesmo período: '
                            f'{delta:+.1f}% de receita, '
                            f'{atual["pedidos"]-anterior["pedidos"]:+d} pedidos e '
                            f'{atual["clientes"]-anterior["clientes"]:+d} clientes compradores.', s['corpo']))

    story.extend([_p('Comparação anual', s['h2']),
                  _p('O ano atual é parcial. Todos os anos terminam no mesmo dia e mês da última venda importada.', s['sub'])])
    linhas = [[_p(str(a['ano']), s['tabela']), _p(moeda(a['receita'],2), s['tabela']),
               _p(a['pedidos'], s['tabela']), _p(a['clientes'], s['tabela']),
               _p(moeda(a['ticket'],2), s['tabela']),
               _p(f'{a["top10"]:.0f}%', s['tabela'])] for a in anos]
    story.append(_tabela(['Ano', 'Receita', 'Pedidos', 'Clientes', 'Pedido médio', 'Top 10 / receita'],
                         linhas, [19*mm, 37*mm, 23*mm, 25*mm, 35*mm, 37*mm], s))

    story.extend([_p('Receita mensal', s['h2']),
                  _p('O mês da última importação pode estar incompleto. Os meses anteriores são totais fechados conforme os dados carregados.', s['sub'])])
    serie = dados['anos']['mensal']
    anos_col = [ref.year-2, ref.year-1, ref.year]
    linhas = []
    for mes in range(1,13):
        if mes > ref.month:
            break
        linhas.append([_p(MESES[mes-1].capitalize() + (' *' if mes == ref.month else ''), s['tabela'])]
                     + [_p(moeda((serie.get(str(ano)) or [0]*12)[mes-1]), s['tabela'])
                        for ano in anos_col])
    story.append(_tabela(['Mês']+[str(a) for a in anos_col], linhas,
                         [44*mm]*4, s))
    story.append(_p('* Mês de referência parcial até a última data de venda importada.', s['sub']))

    comparaveis = [c for c in clientes if c.get('ytd_n_anos') and c.get('ytd_base',0)>0
                   and not c.get('encerrado')]
    story.extend([PageBreak(), _p('Clientes que mais mudaram no ano', s['h2']),
                  _p('Diferença em reais contra a média do mesmo período dos anos anteriores em que o cliente já existia. '
                     'Clientes novos e sem base comparável ficam fora desta classificação.', s['sub'])])
    for titulo, lista in (('Maiores aumentos', sorted(comparaveis,
                                                    key=lambda c: c['var_ytd_abs'], reverse=True)[:12]),
                          ('Maiores quedas', sorted(comparaveis,
                                                   key=lambda c: c['var_ytd_abs'])[:12])):
        story.append(_p(titulo, s['h2']))
        linhas = [[_p(c['nome'], s['tabela']), _p(moeda(c['ytd_atual']), s['tabela']),
                   _p(moeda(c['ytd_base']), s['tabela']),
                   _p(f'{c["var_ytd_pct"]:+.0f}%', s['tabela']),
                   _p(moeda(c['var_ytd_abs']), s['tabela'])]
                  for c in lista if (c['var_ytd_abs'] > 0 if titulo == 'Maiores aumentos'
                                     else c['var_ytd_abs'] < 0)]
        if linhas:
            story.append(_tabela(['Cliente', 'Ano atual', 'Média anterior', 'Variação', 'Diferença'],
                                 linhas, [58*mm, 30*mm, 33*mm, 22*mm, 33*mm], s))
        else:
            story.append(_p('Nenhum cliente nesta condição.', s['corpo']))

    rotulos = [('crescendo', 'Crescendo'), ('estavel', 'Estável'),
               ('em queda', 'Em queda'), ('queda forte', 'Queda forte'),
               ('parou', 'Sem compra no ano'), ('novo', 'Sem base comparável'),
               ('encerrado', 'Encerrado')]
    story.extend([_p('Composição da carteira', s['h2']),
                  _p('A tendência compara cada cliente com seu próprio histórico no mesmo período do ano.',
                     s['sub'])])
    linhas = []
    for chave, rotulo in rotulos:
        grupo = [c for c in clientes if c.get('direcao') == chave]
        if grupo:
            linhas.append([_p(rotulo, s['tabela']), _p(len(grupo), s['tabela']),
                           _p(moeda(sum(c.get('ytd_atual') or 0 for c in grupo)), s['tabela'])])
    story.append(_tabela(['Tendência', 'Clientes', 'Vendas no ano'], linhas,
                         [80*mm, 38*mm, 58*mm], s))

    por_uf = {}
    sem_uf = 0
    for c in clientes:
        uf = c.get('uf_base') or ''
        if uf:
            atual_uf = por_uf.setdefault(uf, {'clientes': 0, 'receita': 0.0})
            atual_uf['clientes'] += 1
            atual_uf['receita'] += c.get('ytd_atual') or 0
        else:
            sem_uf += 1
    if por_uf:
        story.extend([_p('Vendas por estado cadastrado', s['h2']),
                      _p(f'{sem_uf} cliente(s) sem estado preenchido ficam fora desta distribuição.',
                         s['sub'])])
        linhas = [[_p(uf, s['tabela']), _p(val['clientes'], s['tabela']),
                   _p(moeda(val['receita']), s['tabela'])]
                  for uf, val in sorted(por_uf.items(),
                                        key=lambda par: -par[1]['receita'])]
        story.append(_tabela(['UF', 'Clientes', 'Vendas no ano'], linhas,
                             [80*mm, 38*mm, 58*mm], s))

    if (ref.year, ref.month) == (hoje.year, hoje.month):
        previsao = dados.get('previsao', {}).get('empresa', {}).get('meses', [])[:3]
        if previsao:
            story.extend([_p('Próximos meses - estimativa histórica', s['h2']),
                          _p('Estimativa agregada pela média do mesmo mês nos dois anos anteriores. '
                             'Ela não representa pedidos confirmados.', s['sub'])])
            linhas = [[_p(f'{MESES[int(m["mes"][5:7])-1].capitalize()} / {m["mes"][:4]}', s['tabela']),
                       _p(moeda(m.get('h1')) if m.get('h1') is not None else '—', s['tabela']),
                       _p(moeda(m.get('h2')) if m.get('h2') is not None else '—', s['tabela']),
                       _p(moeda(m.get('prev')), s['tabela']),
                       _p(moeda(m.get('ja')) if 'ja' in m else '—', s['tabela'])]
                      for m in previsao]
            story.append(_tabela(['Mês', str(ref.year-2), str(ref.year-1),
                                  'Estimativa', 'Já vendido'], linhas,
                                 [42*mm, 30*mm, 30*mm, 38*mm, 36*mm], s))
    else:
        story.append(_p('A estimativa de curto prazo não é apresentada porque a última venda '
                        'importada é anterior ao mês corrente.', s['sub']))

    story.extend([_p('Leitura comercial', s['h2']),
                  _p(f'{sum(c.get("direcao") in ("em queda", "queda forte", "parou") for c in clientes)} '
                     'clientes estão em queda ou sem compras no período comparável. '
                     f'{sum(bool(c.get("contato_urgente")) and not c.get("encerrado") for c in clientes)} '
                     'têm contato pendente segundo a rotina configurada.', s['corpo']),
                  _p('Fonte: vendas importadas no CRM. As comparações e estimativas dependem da qualidade e '
                     'atualização desses dados. Este relatório não inclui pedidos futuros confirmados.', s['sub'])])
    return _documento(story)
