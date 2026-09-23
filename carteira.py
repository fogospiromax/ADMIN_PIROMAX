"""
Analise da carteira de clientes da Piromax.

Python puro, sem dependencia externa: o app roda com flask, gunicorn e psycopg2
apenas, e nao faz sentido puxar pandas para somar 2.300 linhas.

Entrada: lista de (date, nome, valor) ja lida do banco ou de um CSV.
Saida: um dicionario pronto para virar JSON dentro do template.
"""

import csv
import hashlib
import io
import re
import unicodedata
from collections import defaultdict
from datetime import date, timedelta
from statistics import median

MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
         'jul', 'ago', 'set', 'out', 'nov', 'dez']


# ── leitura do CSV ────────────────────────────────────────────────────────────

def _valor(txt):
    """'R$ 53.349,40' -> 53349.40"""
    limpo = re.sub(r'[^0-9,.\-]', '', str(txt))
    if not limpo:
        raise ValueError('valor vazio')
    return float(limpo.replace('.', '').replace(',', '.'))


def _data(txt):
    """'18/09/2026' ou '2026-09-18' -> date"""
    t = str(txt).strip()
    for sep, ordem in (('/', (2, 1, 0)), ('-', (0, 1, 2))):
        if sep in t:
            p = t.split(sep)
            if len(p) == 3:
                a, m, d = (int(p[ordem[0]]), int(p[ordem[1]]), int(p[ordem[2]]))
                return date(a, m, d)
    raise ValueError('data invalida: %r' % txt)


def ler_csv(texto):
    """Le o CSV de vendas. Aceita ; ou , como separador e cabecalho
    Data;Nome;Valor em qualquer caixa. Devolve (linhas, erros)."""
    if texto.startswith('﻿'):
        texto = texto[1:]
    amostra = texto[:2000]
    sep = ';' if amostra.count(';') >= amostra.count(',') else ','
    leitor = csv.reader(io.StringIO(texto), delimiter=sep)
    linhas, erros = [], []
    for n, campos in enumerate(leitor, start=1):
        if len(campos) < 3:
            if any(c.strip() for c in campos):
                erros.append('linha %d: menos de 3 colunas' % n)
            continue
        bruto = [c.strip() for c in campos[:3]]
        if n == 1 and _parece_cabecalho(bruto):
            continue
        try:
            linhas.append((_data(bruto[0]), bruto[1].strip().upper(), _valor(bruto[2])))
        except (ValueError, IndexError) as e:
            erros.append('linha %d: %s' % (n, e))
    return linhas, erros


def _parece_cabecalho(campos):
    t = ' '.join(campos).lower()
    return 'data' in t and ('valor' in t or 'nome' in t)


def slug(nome):
    x = unicodedata.normalize('NFD', nome).encode('ascii', 'ignore').decode()
    x = re.sub(r'[^A-Za-z0-9]+', '-', x).strip('-').lower()
    return x[:80] or 'cliente'


def id_cliente(nome):
    """Chave que liga o cliente aos registros do CRM.

    Depende SO do nome, nunca do que mais existe na planilha. O sufixo de hash
    parece redundante mas e o que garante isso: sem ele, dois nomes que viram o
    mesmo slug (um com acento e outro sem) precisariam de desempate por posicao,
    e o id de um cliente mudaria conforme o outro entrasse ou saisse da base,
    desgrudando ficha, tarefas e contatos do dono.
    """
    h = hashlib.sha1(nome.strip().upper().encode('utf-8')).hexdigest()[:6]
    return '%s-%s' % (slug(nome)[:60], h)


def normalizar(s):
    x = unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-zA-Z0-9]+', ' ', x).strip().lower()


# ── nucleo ────────────────────────────────────────────────────────────────────

def _mes(d):
    return d.year * 12 + (d.month - 1)


def _rotulo(m):
    return '%04d-%02d' % (m // 12, m % 12 + 1)


REGIOES = {
    'N':  ('Norte',        ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO']),
    'NE': ('Nordeste',     ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE']),
    'CO': ('Centro-Oeste', ['DF', 'GO', 'MT', 'MS']),
    'SE': ('Sudeste',      ['ES', 'MG', 'RJ', 'SP']),
    'S':  ('Sul',          ['PR', 'RS', 'SC']),
}
UFS = sorted(uf for _, ufs in REGIOES.values() for uf in ufs)
REGIAO_DA_UF = {uf: sigla for sigla, (_, ufs) in REGIOES.items() for uf in ufs}


def rotulo_atuacao(tokens):
    """['NE','SP'] -> 'Nordeste, SP'"""
    saida = []
    for t in tokens or []:
        t = str(t).strip().upper()
        if t in REGIOES:
            saida.append(REGIOES[t][0])
        elif t in REGIAO_DA_UF:
            saida.append(t)
    return ', '.join(saida)


def ufs_cobertas(tokens):
    """Expande a atuacao declarada na lista de UFs que ela cobre."""
    ufs = set()
    for t in tokens or []:
        t = str(t).strip().upper()
        if t in REGIOES:
            ufs.update(REGIOES[t][1])
        elif t in REGIAO_DA_UF:
            ufs.add(t)
    return sorted(ufs)


SITUACOES_ENCERRADAS = ('perdido',)


def calcular(linhas, aliases=None, fichas=None, contatos=None, hoje=None, retornos=None):
    """linhas: [(date, nome, valor)]. aliases: {nome_antigo: nome_canonico}.
    fichas: {id_do_cliente: {'situacao': 'ativo'|'pausado'|'perdido',
                             'motivo': str, 'dispensa': bool, 'cadencia': int, ...}}
    contatos: {id_do_cliente: date do ultimo contato registrado}.
    hoje: data de referencia da rotina de contato. E o dia de hoje de verdade,
          nao a data da ultima venda: um cliente fica sem contato mesmo nos
          meses em que ninguem vende nada."""
    aliases = {k.strip().upper(): v.strip().upper() for k, v in (aliases or {}).items()}
    fichas = fichas or {}
    contatos = contatos or {}
    retornos = retornos or {}
    if not linhas:
        return None

    linhas = [(d, aliases.get(n, n), v) for d, n, v in linhas]
    REF = max(d for d, _, _ in linhas)

    # um pedido = mesmo cliente, mesma data
    pedidos = defaultdict(float)
    for d, n, v in linhas:
        pedidos[(n, d)] += v
    pedidos = [(d, n, v) for (n, d), v in pedidos.items()]

    nomes = sorted({n for _, n, _ in linhas})
    por_cliente = defaultdict(list)
    for d, n, v in pedidos:
        por_cliente[n].append((d, v))
    for n in por_cliente:
        por_cliente[n].sort()

    m_ini, m_fim = _mes(min(d for d, _, _ in linhas)), _mes(REF)
    faixa_meses = list(range(m_ini, m_fim + 1))

    # matriz cliente x mes
    mat = {n: defaultdict(float) for n in nomes}
    for d, n, v in pedidos:
        mat[n][_mes(d)] += v
    emp = defaultdict(float)
    for n in nomes:
        for m, v in mat[n].items():
            emp[m] += v

    receita_total = sum(v for _, _, v in linhas)

    # ── metricas por cliente ──
    C = {}
    for n in nomes:
        h = por_cliente[n]
        datas = [d for d, _ in h]
        vals = [v for _, v in h]
        gaps = [(datas[i] - datas[i - 1]).days for i in range(1, len(datas))]
        C[n] = {
            'nome': n, 'id': None,
            'compras': len(h), 'notas': sum(1 for _, x, _ in linhas if x == n),
            'receita': sum(vals), 'ticket': sum(vals) / len(vals),
            'tmax': max(vals),
            'primeira': datas[0], 'ultima': datas[-1],
            'recencia': (REF - datas[-1]).days,
            'intervalo': median(gaps) if len(gaps) >= 2 else None,
            'gap80': _percentil(gaps, 0.8) if len(gaps) >= 3 else None,
        }
        g = C[n]['gap80']
        C[n]['atraso'] = (C[n]['recencia'] / g) if g else None

    for n in nomes:
        C[n]['id'] = id_cliente(n)

    # ── curva ABC ──
    ordem = sorted(nomes, key=lambda n: -C[n]['receita'])
    acum = 0.0
    for n in ordem:
        acum += C[n]['receita']
        p = acum / receita_total
        C[n]['acum'] = p
        C[n]['classe'] = 'A' if p <= 0.8 else ('B' if p <= 0.95 else 'C')

    # ── sazonalidade do cliente ──
    for n in nomes:
        mm = [0.0] * 12
        for m, v in mat[n].items():
            mm[m % 12] += v
        C[n]['mensal'] = mm
        t = sum(mm) or 1.0
        fim, jun = (mm[10] + mm[11]) / t, (mm[4] + mm[5]) / t
        C[n]['perfil'] = ('Fim de ano' if fim >= .5 else
                          'Junino' if jun >= .35 else
                          'Puxado p/ fim de ano' if fim >= .33 else 'Ano todo')

    # ── janelas ──
    def soma(ini, fim, n):
        return sum(v for d, v in por_cliente[n] if ini < d <= fim)

    ano = timedelta(days=365)
    j180, j180_ly = REF - timedelta(days=180), REF - timedelta(days=180) - ano
    for n in nomes:
        C[n]['t180'] = soma(j180, REF, n)
        C[n]['t180_ly'] = soma(j180_ly, REF - ano, n)
        C[n]['var180_abs'] = C[n]['t180'] - C[n]['t180_ly']
        C[n]['var180_pct'] = ((C[n]['var180_abs'] / C[n]['t180_ly'] * 100)
                              if C[n]['t180_ly'] > 0 else None)
        for a in (REF.year, REF.year - 1, REF.year - 2):
            C[n]['ytd%d' % a] = sum(
                v for d, v in por_cliente[n]
                if date(a, 1, 1) <= d <= date(a, REF.month, REF.day))
        C[n]['var_abs'] = C[n]['ytd%d' % REF.year] - C[n]['ytd%d' % (REF.year - 1)]
        base = C[n]['ytd%d' % (REF.year - 1)]
        C[n]['var_pct'] = (C[n]['var_abs'] / base * 100) if base > 0 else None

        # ── criterio de alerta: mesma janela do calendario nos anos anteriores ──
        # 1 de janeiro ate hoje, comparando o ano corrente com a media dos anos
        # anteriores em que o cliente ja existia. Elimina sazonalidade por
        # construcao, que e o que uma janela movel de 180 dias nao faz.
        anteriores = []
        for a in (REF.year - 1, REF.year - 2):
            if C[n]['primeira'] <= date(a, REF.month, REF.day):
                anteriores.append(C[n]['ytd%d' % a])
        C[n]['ytd_anos'] = {str(a): C[n]['ytd%d' % a]
                            for a in (REF.year - 2, REF.year - 1, REF.year)}
        C[n]['ytd_base'] = (sum(anteriores) / len(anteriores)) if anteriores else 0.0
        C[n]['ytd_n_anos'] = len(anteriores)
        C[n]['ytd_atual'] = C[n]['ytd%d' % REF.year]
        C[n]['var_ytd_abs'] = C[n]['ytd_atual'] - C[n]['ytd_base']
        C[n]['var_ytd_pct'] = ((C[n]['var_ytd_abs'] / C[n]['ytd_base'] * 100)
                               if C[n]['ytd_base'] > 0 else None)
        C[n]['inativo12m'] = C[n]['recencia'] > 365
        C[n]['coorte'] = C[n]['primeira'].year
        C[n]['receita_12m_ant'] = soma(REF - 2 * ano, REF - ano, n)
        C[n]['hist'] = [[d.isoformat(), v] for d, v in por_cliente[n]]

    # ── o que o gestor declarou na ficha ──
    for n in nomes:
        f = fichas.get(C[n]['id'], {})
        C[n]['situacao'] = (f.get('situacao') or 'ativo')
        C[n]['motivo'] = f.get('motivo') or ''
        C[n]['encerrado'] = C[n]['situacao'] in SITUACOES_ENCERRADAS
        for campo in ('contato', 'telefone', 'email', 'responsavel'):
            C[n][campo] = f.get(campo) or ''
        C[n]['cidade'] = f.get('cidade') or ''
        C[n]['uf_base'] = (f.get('estado') or '').upper()
        at = f.get('atuacao') or []
        if isinstance(at, str):
            at = [x for x in re.split(r'[;,\s]+', at) if x]
        C[n]['atuacao'] = [str(x).strip().upper() for x in at]
        C[n]['atuacao_rotulo'] = rotulo_atuacao(C[n]['atuacao'])
        C[n]['atuacao_ufs'] = ufs_cobertas(C[n]['atuacao'])
        C[n]['prioridade'] = bool(f.get('prioridade'))
        C[n]['tipo'] = (f.get('tipo') or 'carteira')
        if C[n]['tipo'] not in TIPOS:
            C[n]['tipo'] = 'carteira'
        C[n]['tipo_rotulo'] = TIPOS[C[n]['tipo']][0]
        C[n]['ocasional'] = (C[n]['tipo'] == 'ocasional')
        cm = (f.get('classe_manual') or '').strip()
        C[n]['classe_manual'] = cm if cm in MOTIVO_ROTULO else ''
    encerrados = {n for n in nomes if C[n]['encerrado']}

    # ── direcao comercial e ritmo de compra ──
    for n in nomes:
        C[n]['direcao'] = _direcao(C[n])
        C[n]['ritmo'], C[n]['ritmo_rel'] = _ritmo(C[n])

    # ── rotina de contato ──
    HOJE = hoje or REF
    for n in nomes:
        C[n]['dias_desde_compra_hoje'] = (HOJE - C[n]['ultima']).days
        _rotina(C[n], fichas.get(C[n]['id'], {}), contatos.get(C[n]['id']), HOJE,
                retornos.get(C[n]['id']))
        auto = _motivo(C[n])
        C[n]['motivo_auto'] = auto[0] if auto else 'rotina'
        C[n]['motivo_auto_rotulo'] = MOTIVO_ROTULO[C[n]['motivo_auto']]

    fila = _fila(nomes, C)

    # ── projecao ──
    prev = _projetar(nomes, mat, emp, C, faixa_meses, REF, encerrados)
    bt = _backtestar(nomes, mat, emp, C, faixa_meses, REF)

    mensal = [{'mes': _rotulo(m), 'receita': emp[m],
               'compras': sum(1 for d, _, _ in pedidos if _mes(d) == m),
               'clientes': len({n for d, n, _ in pedidos if _mes(d) == m})}
              for m in faixa_meses]

    coortes = _coortes(nomes, C, por_cliente, REF)

    saida = {
        'meta': {
            'ref': REF.isoformat(),
            'inicio': min(d for d, _, _ in linhas).isoformat(),
            'notas': len(linhas), 'eventos': len(pedidos), 'clientes': len(nomes),
            'receita': receita_total,
            'ytd%d' % (REF.year - 2): sum(C[n]['ytd%d' % (REF.year - 2)] for n in nomes),
            'ytd%d' % (REF.year - 1): sum(C[n]['ytd%d' % (REF.year - 1)] for n in nomes),
            'ytd%d' % REF.year: sum(C[n]['ytd%d' % REF.year] for n in nomes),
        },
        'mensal': mensal,
        'sazonal': [{'mes': m + 1, 'receita': sum(emp[x] for x in faixa_meses if x % 12 == m)}
                    for m in range(12)],
        'coortes': coortes,
        'clientes': [_limpar(C[n], aliases) for n in ordem],
        'previsao': prev,
        'backtest': bt,
        'fila': fila,
        'anos': _anos(nomes, C, pedidos, REF),
        'rotina': {
            'hoje': HOJE.isoformat(),
            'cadencia': dict(CADENCIA),
            'vencidos': sum(1 for n in nomes if C[n]['contato_urgente']),
            'em_dia': sum(1 for n in nomes
                          if not C[n]['contato_urgente'] and not C[n]['dispensa_rotina']),
            'dispensados': sum(1 for n in nomes
                               if C[n]['dispensa_rotina'] and not C[n]['ocasional']),
            'ocasionais': sum(1 for n in nomes if C[n]['ocasional']),
            'receita_ocasional': sum(C[n]['receita'] for n in nomes if C[n]['ocasional']),
            'manuais': sum(1 for n in nomes if C[n]['classe_manual']),
            'feitos_hoje': sum(1 for n in nomes if C[n]['contato_hoje']),
            'prioridades': sum(1 for n in nomes if C[n]['prioridade']),
            'sem_contato': sum(1 for n in nomes if C[n]['contato_ultimo'] is None),
        },
        'tipos': [[k, v[0], v[1]] for k, v in TIPOS.items()],
        'motivos': [[k, v] for k, v in MOTIVO_ROTULO.items()],
    }
    return saida


# ── rotina de contato ─────────────────────────────────────────────────────────

# Cadencia por classe da curva ABC. A e B sao os clientes que sustentam o
# faturamento e merecem quinzenal; C e cauda longa e a cada trinta dias basta.
# Com 161 clientes, quinzenal para todos dava onze contatos por dia util.
CADENCIA = {'A': 15, 'B': 15, 'C': 30}

# Que tipo de relacao a Piromax tem com este comprador. Nem todo mundo que
# emite nota e carteira: concorrente que compra o que falta no estoque dele,
# compra de balcao e evento avulso movimentam dinheiro de verdade e entram no
# faturamento, mas cobrar rotina e alerta comercial deles enche a fila de
# trabalho que nao existe.
TIPOS = {
    'carteira':  ('Carteira', 'Cliente de verdade: entra na fila e na rotina de contato.'),
    'ocasional': ('Ocasional', 'Compra de vez em quando e nao precisa de rotina nem de alerta. '
                               'Continua contando no faturamento e na analise.'),
}

MOTIVO_ROTULO = {
    'recuperar': 'Recuperar', 'queda': 'Caindo', 'crescer': 'Crescendo',
    'novo': 'Novo', 'ritmo': 'Atrasado', 'rotina': 'Rotina',
}


def _rotina(c, ficha, ultimo, hoje, retorno=None):
    """Estado do contato de um cliente, medido contra a cadencia da classe dele.

    'ultimo' é o último contato efetivo. Um compromisso com data tem
    precedência sobre a cadência; ausência de registro não significa atraso infinito."""
    # Ocasional nao tem rotina por definicao: e o que faz dele ocasional.
    c['dispensa_rotina'] = bool(ficha.get('dispensa')) or c.get('ocasional')
    try:
        cad = int(ficha.get('cadencia') or 0)
    except (TypeError, ValueError):
        cad = 0
    c['cadencia'] = cad if cad > 0 else CADENCIA.get(c['classe'], 30)
    c['cadencia_propria'] = cad > 0
    c['contato_ultimo'] = ultimo.isoformat() if ultimo else None
    c['contato_hoje'] = False

    if c['dispensa_rotina']:
        c.update(contato_dias=None, contato_atraso=-10 ** 9,
                 contato_rotulo=('Ocasional, sem rotina' if c.get('ocasional')
                                 else 'Dispensado da rotina'),
                 contato_urgente=False)
        return
    if retorno:
        dias = (hoje - retorno).days
        c.update(contato_dias=(hoje - ultimo).days if ultimo else None,
                 contato_atraso=dias, contato_urgente=dias >= 0,
                 contato_hoje=bool(ultimo == hoje),
                 contato_rotulo=('Retorno vencido há %d dia%s' % (dias, '' if dias == 1 else 's') if dias > 0
                                 else 'Retorno combinado para hoje' if dias == 0
                                 else 'Retorno combinado para ' + _br_data(retorno)))
        return
    if not ultimo:
        c.update(contato_dias=None, contato_atraso=0,
                 contato_rotulo='Sem contato registrado', contato_urgente=True)
        return

    dias = (hoje - ultimo).days
    c['contato_hoje'] = (dias == 0)
    atraso = dias - c['cadencia']
    if atraso > 0:
        rot = 'Contato vencido há %d dia%s' % (atraso, '' if atraso == 1 else 's')
    elif atraso == 0:
        rot = 'Contato vence hoje'
    else:
        rot = 'Em dia, próximo em %d dia%s' % (-atraso, '' if atraso == -1 else 's')
    c.update(contato_dias=dias, contato_atraso=atraso,
             contato_rotulo=rot, contato_urgente=atraso >= 0)


def _brl(v):
    return ('%.0f' % v).replace(',', '').replace('.', ',')


def _reais(v):
    s = '%d' % round(v)
    saida, i = '', 0
    for ch in reversed(s):
        if i and i % 3 == 0:
            saida = '.' + saida
        saida, i = ch + saida, i + 1
    return saida


def _br_data(d):
    return '%02d/%02d/%d' % (d.day, d.month, d.year)


def _fila(nomes, C):
    """A fila unica de trabalho.

    Regra: a rotina manda na ordem, o dinheiro desempata. Quem esta vencido ha
    mais tempo vem primeiro; entre dois igualmente vencidos, ganha quem tem
    mais dinheiro em jogo. O peso e sempre uma quantia real medida da propria
    base, nunca uma nota inventada de prioridade.

    Um cliente entra uma vez so, com o motivo mais forte. Quem nao tem alerta
    comercial nenhum entra por rotina, com peso zero.
    """
    fila = []
    for n in nomes:
        c = C[n]
        if c['encerrado'] or c['ocasional']:
            continue
        m = _aplicar_manual(c, _motivo(c))
        # Quem foi contactado hoje continua na tela ate o dia virar, marcado
        # como feito. Sumir no clique faz parecer que o clique nao funcionou, e
        # some justamente com a prova do trabalho que a pessoa acabou de fazer.
        if c['dispensa_rotina'] and not m and not c['contato_hoje']:
            continue
        if not c['contato_urgente'] and not m and not c['contato_hoje']:
            continue
        tipo, rotulo, peso, texto = m or (
            'rotina', 'Rotina', 0.0,
            'Sem alerta comercial. Entra pela rotina: %d compras, última em %s.'
            % (c['compras'], _br_data(c['ultima'])))
        marcas = []
        if c['ritmo'] in ('atrasado', 'muito atrasado'):
            marcas.append('%d dias sem comprar, costuma comprar a cada ~%d'
                          % (c['recencia'], c['intervalo'] or 0))
        fila.append({
            'id': c['id'], 'nome': c['nome'], 'tipo': tipo, 'rotulo': rotulo,
            'peso': round(peso, 2), 'texto': texto, 'marcas': marcas,
            'classe': c['classe'], 'direcao': c['direcao'], 'uf': c['uf_base'],
            'receita': c['receita'], 'motivo': c['motivo'],
            'prioridade': c['prioridade'],
            'manual': bool(c['classe_manual']),
            'auto_rotulo': MOTIVO_ROTULO.get(c['motivo_auto'], 'Rotina'),
            'contato_rotulo': c['contato_rotulo'],
            'contato_atraso': c['contato_atraso'],
            'contato_urgente': c['contato_urgente'],
            'contato_hoje': c['contato_hoje'],
            'cadencia': c['cadencia'],
        })
    # Prioridade primeiro, porque e uma decisao do gestor e vale mais que
    # qualquer criterio calculado. Depois a rotina, depois o dinheiro. Feito
    # hoje desce para o fim, sem sair da tela.
    fila.sort(key=lambda x: (x['contato_hoje'], not x['prioridade'],
                             -x['contato_atraso'], -x['peso'], -x['receita']))
    return fila


def _aplicar_manual(c, auto):
    """A classificacao que o gestor escolheu a mao ganha da calculada.

    O numero NAO e inventado junto com o rotulo: o peso continua saindo da
    base. Se o gestor diz que um cliente e de recuperar, o valor em jogo e o
    que ele comprava nesta janela; se diz que esta crescendo, e o quanto ja
    cresceu. Quando a conta escolhida da zero, a linha entra sem valor em vez
    de ganhar um numero de enfeite.
    """
    if not c['classe_manual']:
        return auto
    t = c['classe_manual']
    if auto and auto[0] == t:
        return auto

    pesos = {
        'recuperar': max(0.0, c['ytd_base']),
        'queda': max(0.0, -(c['var_ytd_abs'] or 0)),
        'crescer': max(0.0, c['var_ytd_abs'] or 0),
        'novo': max(0.0, c['ytd_atual']),
        'ritmo': c['ticket'],
        'rotina': 0.0,
    }
    textos = {
        'recuperar': 'Marcado por você como a recuperar. Nesta mesma altura do ano ele comprava R$ %s.'
                     % _reais(c['ytd_base']),
        'queda': 'Marcado por você como em queda. Comprava R$ %s nesta altura do ano e este ano R$ %s.'
                 % (_reais(c['ytd_base']), _reais(c['ytd_atual'])),
        'crescer': 'Marcado por você como em crescimento. Comprava R$ %s nesta altura do ano e este ano R$ %s.'
                   % (_reais(c['ytd_base']), _reais(c['ytd_atual'])),
        'novo': 'Marcado por você como novo. Primeira compra em %s, R$ %s neste ano.'
                % (_br_data(c['primeira']), _reais(c['ytd_atual'])),
        'ritmo': 'Marcado por você como atrasado. Está há %d dias sem comprar e o pedido médio dele é R$ %s.'
                 % (c['recencia'], _reais(c['ticket'])),
        'rotina': 'Marcado por você como caso de rotina apenas, sem alerta comercial.',
    }
    return (t, MOTIVO_ROTULO[t], pesos[t], textos[t])


JANELA = 'nesta mesma altura do ano'


def _motivo(c):
    """O alerta comercial mais forte do cliente, ou None.

    Cada tipo tem um peso que e dinheiro de verdade: o que ele deixou de
    comprar, o que passou a comprar a mais, ou quanto vale um pedido dele.
    Quando a variacao percentual passa de 90% para baixo ou 300% para cima ela
    para de informar (base minuscula), e o texto troca o percentual pelos dois
    valores absolutos.
    """
    v, p, atual = c['var_ytd_abs'], c['var_ytd_pct'], c['ytd_atual']
    if c['direcao'] == 'parou' and c['ytd_base'] > 0:
        return ('recuperar', 'Recuperar', c['ytd_base'],
                'Parou. %s comprava R$ %s, e neste ano não comprou nada.'
                % (JANELA.capitalize(), _reais(c['ytd_base'])))
    if c['direcao'] in ('em queda', 'queda forte') and v is not None and v < 0:
        if p is not None and abs(p) >= 90:
            t = ('Comprava R$ %s %s e este ano só R$ %s. São R$ %s a menos.'
                 % (_reais(c['ytd_base']), JANELA, _reais(atual), _reais(-v)))
        else:
            t = ('Caiu %d%% contra a média dos anos anteriores %s: R$ %s a menos.'
                 % (round(abs(p or 0)), JANELA, _reais(-v)))
        return ('queda', 'Caindo', -v, t)
    if c['direcao'] == 'crescendo' and v is not None and v > 0:
        if p is not None and p >= 300:
            t = ('Comprava R$ %s %s e este ano já R$ %s. São R$ %s a mais.'
                 % (_reais(c['ytd_base']), JANELA, _reais(atual), _reais(v)))
        else:
            t = ('Subiu %d%% contra a média dos anos anteriores %s: R$ %s a mais.'
                 % (round(p or 0), JANELA, _reais(v)))
        return ('crescer', 'Crescendo', v, t)
    if c['direcao'] == 'novo':
        return ('novo', 'Novo', atual,
                'Primeira compra em %s, %d ao todo. Já trouxe R$ %s neste ano e '
                'ainda não tem um ano anterior inteiro para comparar.'
                % (_br_data(c['primeira']), c['compras'], _reais(atual)))
    if c['ritmo'] in ('atrasado', 'muito atrasado'):
        return ('ritmo', 'Atrasado', c['ticket'],
                'Compra a cada ~%d dias e está há %d sem comprar. Um pedido dele '
                'vale em média R$ %s.'
                % (c['intervalo'] or 0, c['recencia'], _reais(c['ticket'])))
    return None


# ── comparativos ano a ano ────────────────────────────────────────────────────

def _anos(nomes, C, pedidos, REF):
    """Tres anos medidos sempre no mesmo pedaco do calendario.

    Nunca um ano inteiro contra um ano pela metade: todo numero aqui e de
    1 de janeiro ate o dia e mes da ultima venda carregada.
    """
    alvos = [REF.year - 2, REF.year - 1, REF.year]
    linhas = []
    for a in alvos:
        ini, fim = date(a, 1, 1), date(a, REF.month, REF.day)
        sel = [(d, n, v) for d, n, v in pedidos if ini <= d <= fim]
        if not sel:
            continue
        rec = sum(v for _, _, v in sel)
        cli = {n for _, n, _ in sel}
        por = defaultdict(float)
        for _, n, v in sel:
            por[n] += v
        top10 = sum(sorted(por.values(), reverse=True)[:10])
        novos = sum(1 for n in cli if ini <= C[n]['primeira'] <= fim)
        ant = {n for d, n, _ in pedidos
               if date(a - 1, 1, 1) <= d <= date(a - 1, REF.month, REF.day)}
        linhas.append({
            'ano': a, 'receita': rec, 'pedidos': len(sel), 'clientes': len(cli),
            'ticket': rec / len(sel), 'novos': novos,
            'top10': (top10 / rec * 100) if rec else 0,
            'base_ant': len(ant) or None,
            'retidos': len(cli & ant) if ant else None,
            'sumiram': len(ant - cli) if ant else None,
        })

    mensal = {str(a): [0.0] * 12 for a in alvos}
    for d, _, v in pedidos:
        if str(d.year) in mensal:
            mensal[str(d.year)][d.month - 1] += v

    fechado = {}
    for a in alvos:
        if a >= REF.year:
            continue
        sel = [(d, n, v) for d, n, v in pedidos if d.year == a]
        if not sel:
            continue
        rec = sum(v for _, _, v in sel)
        fechado[str(a)] = {'receita': rec, 'pedidos': len(sel),
                           'clientes': len({n for _, n, _ in sel}),
                           'ticket': rec / len(sel)}

    mov = []
    for n in nomes:
        y = C[n]['ytd_anos']
        mov.append({'nome': n, 'id': C[n]['id'],
                    'anos': {k: y.get(k, 0.0) for k in map(str, alvos)},
                    'dif': C[n]['var_ytd_abs']})
    mov.sort(key=lambda x: -x['dif'])
    return {'anos': linhas, 'mensal': mensal, 'fechado': fechado,
            'sobe': mov[:8], 'desce': list(reversed(mov[-8:])),
            'corte': '%02d/%02d' % (REF.day, REF.month), 'ultimo_ano': REF.year}


def candidatos_unificacao(dados):
    """Nomes que provavelmente sao o mesmo cliente digitado de formas
    diferentes. So sugere; quem decide e o gestor."""
    if not dados:
        return []
    grupos = defaultdict(list)
    for c in dados['clientes']:
        grupos[normalizar(c['nome'])].append(c)
    saida = []
    for _, g in grupos.items():
        if len(g) > 1:
            saida.append({'motivo': 'Mesmo nome, diferença apenas de acento ou pontuação',
                          'clientes': [{'nome': x['nome'], 'receita': x['receita'],
                                        'compras': x['compras'], 'ultima': x['ultima']}
                                       for x in sorted(g, key=lambda y: -y['receita'])]})
    return sorted(saida, key=lambda s: -sum(c['receita'] for c in s['clientes']))


def _percentil(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def _direcao(c):
    """Para onde o cliente esta indo, comparando o ano corrente com a mesma
    janela dos anos anteriores.

    Substitui a segmentacao RFM de proposito. RFM classifica por posicao
    relativa aos outros clientes, o que rotula de 'perdido' quem compra pouco
    mas cresceu, e obriga uma legenda para cada nome. Aqui cada estado diz o
    que aconteceu com o proprio cliente e o que fazer com ele.
    """
    if c.get('encerrado'):
        return 'encerrado'
    if c['ytd_n_anos'] == 0:
        return 'novo'
    if c['ytd_atual'] == 0:
        return 'parou'
    v = c['var_ytd_pct']
    if v is None:
        return 'novo'
    if v > 10:
        return 'crescendo'
    if v >= -10:
        return 'estavel'
    if v >= -30:
        return 'em queda'
    return 'queda forte'


DIRECOES = ['crescendo', 'estavel', 'em queda', 'queda forte', 'parou', 'novo', 'encerrado']


def _ritmo(c):
    """Atraso medido contra o ritmo do PROPRIO cliente, nunca contra os outros.

    Um cliente que compra tres vezes por ano nao esta atrasado aos 150 dias;
    um que compra toda semana esta. Comparar todo mundo na mesma regua de dias
    e o que fazia a Mussana, que cresceu 67%, aparecer como perdida.
    """
    passo = c['intervalo']
    if not passo or c['compras'] < 3:
        return None, None
    rel = c['recencia'] / passo
    if rel <= 1.3:
        return 'em dia', rel
    if rel <= 2.5:
        return 'atrasado', rel
    return 'muito atrasado', rel


def _coortes(nomes, C, por_cliente, REF):
    anos = sorted({d.year for n in nomes for d, _ in por_cliente[n]})
    rec = defaultdict(lambda: defaultdict(float))
    cli = defaultdict(lambda: defaultdict(set))
    base = defaultdict(int)
    for n in nomes:
        c = C[n]['coorte']
        base[c] += 1
        for d, v in por_cliente[n]:
            rec[c][d.year] += v
            cli[c][d.year].add(n)
    return {'receita': {str(c): {str(a): rec[c][a] for a in anos if rec[c][a]} for c in base},
            'clientes': {str(c): {str(a): len(cli[c][a]) for a in anos if cli[c][a]} for c in base},
            'base': {str(c): base[c] for c in base}}


def _limpar(c, aliases):
    d = dict(c)
    d['primeira'] = c['primeira'].isoformat()
    d['ultima'] = c['ultima'].isoformat()
    d['alias'] = sorted(k for k, v in aliases.items() if v == c['nome'])
    return d


# ── projecao ──────────────────────────────────────────────────────────────────

def _projetar(nomes, mat, emp, C, faixa, REF, encerrados=()):
    """Projecao do mes corrente ate dezembro.

    O metodo e simples de proposito: a projeccao de cada mes E a media do que o
    cliente fez naquele mes em 2024 e 2025. Nada de suavizacao ou de fator de
    ajuste, porque com duas observacoes por mes qualquer sofisticacao seria
    enfeite sobre ruido. Assim o gestor ve os dois anos ao lado do numero e
    julga sozinho se a media faz sentido para aquele cliente.
    """
    mref = _mes(REF)
    ultimo_do_ano = (REF.year * 12) + 11
    alvos = list(range(mref, min(ultimo_do_ano, mref + 11) + 1))
    reg = _regularidade(nomes, mat, mref)

    prev = {}
    for a in alvos:
        p = {}
        for n in nomes:
            anos = [(mm, mat[n].get(mm, 0.0)) for mm in (a - 12, a - 24) if mm >= faixa[0]]
            v = (sum(x for _, x in anos) / len(anos)) if anos else 0.0
            if _mes(C[n]['primeira']) >= a or n in encerrados:
                v = 0.0
            p[n] = max(0.0, v)
        prev[a] = p

    def detalhe(n, a):
        h1 = mat[n].get(a - 24, 0.0) if (a - 24) >= faixa[0] else None
        h2 = mat[n].get(a - 12, 0.0) if (a - 12) >= faixa[0] else None
        d = {'mes': _rotulo(a), 'prev': prev[a][n], 'h1': h1, 'h2': h2}
        if a == mref:                      # mes corrente: descontar o realizado
            d['ja'] = mat[n].get(mref, 0.0)
            d['falta'] = max(0.0, prev[a][n] - d['ja'])
        return d

    futuros = alvos[1:]
    total = {n: sum(prev[a][n] for a in futuros) +
                max(0.0, prev[mref][n] - mat[n].get(mref, 0.0)) for n in nomes}

    clientes = []
    for n in sorted(nomes, key=lambda x: -total[x]):
        if n in encerrados or total[n] <= 0:
            continue
        r = reg[n]
        clientes.append({
            'nome': n, 'id': C[n]['id'], 'reg': r,
            'conf': 'boa' if r >= 10 else ('razoavel' if r >= 7 else 'fraca'),
            'total': total[n],
            'meses': [detalhe(n, a) for a in alvos],
        })

    emp_meses = []
    for a in alvos:
        # Os dois anos ao lado somam SO os clientes que entram na projecao deste
        # mes: quem foi marcado como perdido e quem ainda nao existia ficam de
        # fora dos tres numeros. Sem isso a media mostrada nao fecharia com as
        # duas colunas, e uma conta que nao fecha na tela destroi a confianca no
        # numero inteiro.
        dentro = [n for n in nomes if n not in encerrados and _mes(C[n]['primeira']) < a]
        excluidos = [n for n in nomes if n not in dentro]
        linha = {'mes': _rotulo(a), 'prev': sum(prev[a].values()),
                 'h1': sum(mat[n].get(a - 24, 0.0) for n in dentro) if (a - 24) >= faixa[0] else None,
                 'h2': sum(mat[n].get(a - 12, 0.0) for n in dentro) if (a - 12) >= faixa[0] else None,
                 'fora': sum(mat[n].get(a - 12, 0.0) + mat[n].get(a - 24, 0.0)
                             for n in excluidos) / 2.0,
                 'n_fora': len(excluidos)}
        if a == mref:
            linha['ja'] = emp[mref]
            linha['falta'] = max(0.0, linha['prev'] - emp[mref])
        emp_meses.append(linha)

    return {
        'mes_corrente': _rotulo(mref),
        'empresa': {
            'meses': emp_meses,
            'total': sum(l.get('falta', l['prev']) for l in emp_meses),
            'ja_mes': emp[mref],
        },
        'clientes': clientes,
        'com_meta': sum(1 for c in clientes if c['reg'] >= 7),
    }


def _regularidade(nomes, mat, mref, n_meses=12):
    janela = range(mref - n_meses, mref)
    return {n: sum(1 for m in janela if mat[n].get(m, 0.0) > 0) for n in nomes}


def _backtestar(nomes, mat, emp, C, faixa, REF):
    """Aplica o metodo a trimestres ja ocorridos, usando so o que era conhecido
    na epoca. Sem isso nao ha como afirmar nada sobre o erro."""
    mref = _mes(REF)
    blocos, mensal_erros = [], []

    def prever_mes(a):
        p = {}
        for n in nomes:
            ant = [(mm, mat[n].get(mm, 0.0)) for mm in (a - 12, a - 24) if mm >= faixa[0]]
            v = sum(x for _, x in ant) / len(ant) if ant else 0.0
            if _mes(C[n]['primeira']) >= a:
                v = 0.0
            p[n] = max(0.0, v)
        return p

    # Todas as janelas de 3 meses ja encerradas que tem os dois anos anteriores
    # completos na base. Escolher a dedo quais testar e a forma mais facil de
    # produzir um numero bonito e falso, entao testamos todas.
    testes = []
    a = faixa[0] + 24
    while a + 3 <= mref:
        testes.append(('%s a %s' % (_rotulo(a), _rotulo(a + 2)), [a, a + 1, a + 2]))
        a += 1
    for rot, meses in testes:
        reg = _regularidade(nomes, mat, meses[0])
        sel = [n for n in nomes if reg[n] >= 7]
        P = {n: sum(prever_mes(a)[n] for a in meses) for n in nomes}
        R = {n: sum(mat[n].get(a, 0.0) for a in meses) for n in nomes}
        real, prevs = sum(R.values()), sum(P.values())
        if real <= 0:
            continue
        pe = [abs(P[n] - R[n]) / R[n] * 100 for n in sel if R[n] > 5000]
        rsel, psel = sum(R[n] for n in sel), sum(P[n] for n in sel)
        blocos.append({
            'rot': rot,
            'real': real, 'prev': prevs, 'erro': (prevs / real - 1) * 100,
            'n_sel': len(pe),
            'med_sel': median(pe) if pe else None,
            'd30': (sum(1 for x in pe if x <= 30) / len(pe) * 100) if pe else None,
            'd50': (sum(1 for x in pe if x <= 50) / len(pe) * 100) if pe else None,
            'erro_sel': ((psel / rsel - 1) * 100) if rsel > 0 else None,
        })

    # mes a mes por cliente: a prova de que nao serve como meta individual
    pe = []
    for a in range(mref - 8, mref):
        if a - 24 < faixa[0]:
            continue
        p = prever_mes(a)
        for n in nomes:
            r = mat[n].get(a, 0.0)
            if r > 5000:
                pe.append(abs(p[n] - r) / r * 100)
    mensal = {'med': median(pe) if pe else None,
              'd30': (sum(1 for x in pe if x <= 30) / len(pe) * 100) if pe else None,
              'n': len(pe)}
    erros = [b['erro'] for b in blocos]
    resumo = {
        'n': len(blocos),
        'pior_baixo': min(erros) if erros else None,
        'pior_alto': max(erros) if erros else None,
        'erro_medio_abs': (sum(abs(e) for e in erros) / len(erros)) if erros else None,
        'vies': (sum(erros) / len(erros)) if erros else None,
    }
    return {'blocos': blocos, 'mensal': mensal, 'resumo': resumo}


# ── prospeccao ────────────────────────────────────────────────────────────────

# As etapas seguem o vocabulario que a Piromax ja usa na planilha do Albatros:
# qualificar, qualificado e em conversao. Traduzir para "novo/contato" perderia
# a diferenca entre quem ainda nao foi olhado e quem ja foi aprovado mas ainda
# nao recebeu ligacao, que e justamente onde a fila de prospeccao trabalha.
ETAPAS = [
    ('novo',        'A qualificar', 'Entrou na lista e ninguém olhou ainda.'),
    ('qualificado', 'Qualificado',  'Serve como cliente, mas a conversa ainda não começou.'),
    ('contato',     'Em conversa',  'Alguém já falou, a conversa está viva.'),
    ('ganho',       'Ganhou',       'Negociação fechada. Vincule ao cliente após a primeira venda importada.'),
    ('perdido',     'Perdido',      'Não vai acontecer, com o motivo escrito.'),
]
ETAPAS_ABERTAS = ('novo', 'qualificado', 'contato')
ETAPAS_VALIDAS = tuple(e[0] for e in ETAPAS)

# Como cada rotulo de origem cai nas etapas acima.
ETAPA_SINONIMO = {
    'qualificar': 'novo', 'a qualificar': 'novo', 'novo': 'novo', 'lead': 'novo',
    'prospect': 'novo', 'frio': 'novo',
    'qualificado': 'qualificado', 'qualificada': 'qualificado', 'morno': 'qualificado',
    'em conversao': 'contato', 'em conversa': 'contato', 'conversando': 'contato',
    'contato': 'contato', 'em contato': 'contato', 'negociando': 'contato',
    'negociacao': 'contato', 'quente': 'contato', 'em negociacao': 'contato',
    'ganho': 'ganho', 'ganhou': 'ganho', 'cliente': 'ganho', 'fechado': 'ganho',
    'convertido': 'ganho',
    'perdido': 'perdido', 'perdeu': 'perdido', 'descartado': 'perdido',
    'sem interesse': 'perdido',
}

# Sinonimos aceitos no cabecalho do CSV de leads. O objetivo e que o gestor
# exporte de onde for e o arquivo entre sem precisar renomear coluna.
COLUNAS_LEAD = {
    'nome':      ['nome', 'empresa', 'razao social', 'cliente', 'lead', 'estabelecimento'],
    'cidade':    ['cidade', 'municipio', 'localidade'],
    'uf':        ['uf', 'estado', 'sigla'],
    'contato':   ['contato', 'responsavel', 'pessoa', 'nome do contato', 'comprador'],
    'telefone':  ['telefone', 'fone', 'celular', 'whatsapp', 'whats', 'tel'],
    'email':     ['email', 'e mail', 'e-mail', 'mail'],
    'etapa':     ['etapa', 'tipo de lead', 'status', 'situacao', 'estagio', 'fase', 'funil'],
    'segmento':  ['segmento', 'atuacao', 'area de atuacao', 'tipo', 'perfil', 'ramo'],
    'instagram': ['instagram', 'insta', 'perfil instagram', 'rede social', 'site'],
    'obs':       ['obs', 'observacao', 'observacoes', 'nota', 'notas', 'comentario'],
}

# Estado vem escrito por extenso em quase toda planilha brasileira.
UF_POR_NOME = {
    'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA',
    'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', 'goias': 'GO',
    'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
    'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ',
    'rio grande do norte': 'RN', 'rio grande do sul': 'RS', 'rondonia': 'RO',
    'roraima': 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', 'sergipe': 'SE',
    'tocantins': 'TO',
}


def normalizar_uf(txt):
    """Aceita 'SP', 'São Paulo' ou 'sao paulo' e devolve sempre a sigla."""
    t = (txt or '').strip()
    if not t:
        return ''
    if t.upper() in REGIAO_DA_UF:
        return t.upper()
    por_nome = UF_POR_NOME.get(normalizar(t))
    if por_nome:
        return por_nome
    return t.upper()[:2] if t.upper()[:2] in REGIAO_DA_UF else ''


def normalizar_etapa(txt):
    """Traduz o rotulo da planilha para uma das etapas do funil."""
    t = normalizar(txt or '')
    if not t:
        return 'novo'
    if t in ETAPA_SINONIMO:
        return ETAPA_SINONIMO[t]
    return t if t in ETAPAS_VALIDAS else 'novo'


def id_lead(nome, cidade=''):
    """Chave do lead. Inclui a cidade porque 'Casa dos Fogos' existe em varias,
    e sem isso duas empresas diferentes viram uma so no upload."""
    base = (str(nome).strip().upper() + '|' + str(cidade).strip().upper())
    h = hashlib.sha1(base.encode('utf-8')).hexdigest()[:8]
    return 'lead-%s-%s' % (slug(nome)[:40], h)


def ler_csv_leads(texto):
    """Le o CSV de leads por NOME de coluna, nao por posicao.

    Diferente do CSV de vendas, que tem tres colunas fixas, a lista de leads vem
    de fontes diferentes a cada vez: feira, indicacao, planilha de associacao.
    Casar pelo cabecalho evita que a ordem das colunas quebre a importacao.
    """
    if texto.startswith('\ufeff'):
        texto = texto[1:]
    amostra = texto[:2000]
    sep = ';' if amostra.count(';') >= amostra.count(',') else ','
    linhas = list(csv.reader(io.StringIO(texto), delimiter=sep))
    if not linhas:
        return [], ['arquivo vazio']

    # Planilha de ERP costuma vir com titulo e linhas em branco antes do
    # cabecalho de verdade. Procura a primeira linha que tenha a coluna de nome.
    inicio = 0
    for i, linha in enumerate(linhas[:15]):
        celulas = [normalizar(c) for c in linha]
        if any(c in COLUNAS_LEAD['nome'] for c in celulas):
            inicio = i
            break
    linhas = linhas[inicio:]

    cabecalho = [normalizar(c) for c in linhas[0]]
    mapa = {}
    for campo, nomes in COLUNAS_LEAD.items():
        for i, c in enumerate(cabecalho):
            if c in nomes and campo not in mapa:
                mapa[campo] = i
                break
    if 'nome' not in mapa:
        return [], ['nao encontrei a coluna de nome. O cabecalho precisa ter '
                    'uma coluna chamada Nome (ou Empresa, ou Razao Social)']

    leads, erros = [], []
    for n, campos in enumerate(linhas[1:], start=2):
        def pega(campo, limite=200):
            i = mapa.get(campo)
            return campos[i].strip()[:limite] if i is not None and i < len(campos) else ''
        nome = pega('nome')
        if not nome:
            continue
        leads.append({
            'nome': nome.upper(), 'cidade': pega('cidade', 120),
            'uf': normalizar_uf(pega('uf', 60)),
            'contato': pega('contato', 120), 'telefone': pega('telefone', 40),
            'email': pega('email', 160),
            'etapa': normalizar_etapa(pega('etapa', 60)),
            'segmento': pega('segmento', 60),
            'instagram': pega('instagram', 300),
            'obs': pega('obs', 1000),
        })
    return leads, erros


def analisar_leads(leads, clientes_dados=None, hoje=None):
    """Organiza os leads do funil de prospeccao.

    Nao existe mais cruzamento automatico por nome com a carteira. No ramo de
    fogos o mesmo nome fantasia aparece em cidades diferentes e em donos
    diferentes, entao bater o nome dizia "ja e cliente" para quem nao e, e uma
    marca errada numa lista de prospeccao e pior do que marca nenhuma: tira da
    fila alguem que deveria estar nela.

    O que vale e o que o gestor marca a mao: revenda, quando o lead ja vende
    produto Piromax comprado de um cliente dele.
    """
    saida, por_etapa = [], defaultdict(list)
    for L in leads:
        d = dict(L)
        d['etapa'] = d.get('etapa') or 'novo'
        d['revenda'] = bool(d.get('revenda'))
        d['revenda_de'] = d.get('revenda_de') or ''
        d['uf'] = normalizar_uf(d.get('uf') or '')
        d['regiao'] = REGIAO_DA_UF.get(d['uf'], '')
        d['regiao_nome'] = REGIOES[d['regiao']][0] if d['regiao'] else ''
        por_etapa[d['etapa']].append(d)
        saida.append(d)

    total = len(saida)
    fechados = len(por_etapa['ganho']) + len(por_etapa['perdido'])
    return {
        'leads': saida,
        'etapas': [{'chave': k, 'rotulo': r, 'ajuda': a,
                    'n': len(por_etapa[k])} for k, r, a in ETAPAS],
        'total': total,
        'abertos': sum(len(por_etapa[k]) for k in ETAPAS_ABERTAS),
        'ganhos': len(por_etapa['ganho']),
        'perdidos': len(por_etapa['perdido']),
        # Taxa sobre o que ja foi decidido, nao sobre a lista inteira: enquanto
        # a maior parte esta em aberto, dividir por todos daria um numero
        # artificialmente baixo que so cai conforme se importa mais lead.
        'conversao': (len(por_etapa['ganho']) / fechados * 100) if fechados else None,
        'revendas': sum(1 for d in saida if d['revenda']),
        'por_fornecedor': _contar([d for d in saida if d['revenda']],
                                  lambda d: d['revenda_de'] or 'fornecedor não informado'),
        'por_segmento': _contar(saida, lambda d: d.get('segmento') or 'sem segmento'),
        'por_regiao': _contar(saida, lambda d: d.get('regiao_nome') or 'sem estado'),
        'por_uf': _contar(saida, lambda d: d.get('uf') or '—'),
        'cidades': sorted({d['cidade'] for d in saida if d.get('cidade')}),
        'acompanhar': _acompanhar(saida, hoje),
    }


def _acompanhar(leads, hoje):
    """Os combinados com data marcada, separados por quem ja venceu.

    So entra lead aberto: cobrar follow-up de quem ja foi ganho ou perdido e
    trabalho que nao existe mais.
    """
    if not hoje:
        return {'vencidos': [], 'hoje': [], 'proximos': [], 'sem_data': [], 'total': 0}
    grupos = {'vencidos': [], 'hoje': [], 'proximos': [], 'sem_data': []}
    for d in leads:
        if d['etapa'] not in ETAPAS_ABERTAS or not (d.get('proximo') or d.get('proximo_em')):
            continue
        quando = d.get('proximo_em') or ''
        item = {'id': d['id'], 'nome': d['nome'], 'etapa': d['etapa'],
                'cidade': d.get('cidade', ''), 'uf': d.get('uf', ''),
                'telefone': d.get('telefone', ''),
                'proximo': d.get('proximo', ''), 'proximo_em': quando}
        if not quando:
            grupos['sem_data'].append(item)
            continue
        try:
            dt = date.fromisoformat(str(quando)[:10])
        except ValueError:
            grupos['sem_data'].append(item)
            continue
        item['atraso'] = (hoje - dt).days
        if dt < hoje:
            grupos['vencidos'].append(item)
        elif dt == hoje:
            grupos['hoje'].append(item)
        else:
            grupos['proximos'].append(item)
    grupos['vencidos'].sort(key=lambda x: x['proximo_em'])
    grupos['proximos'].sort(key=lambda x: x['proximo_em'])
    grupos['total'] = sum(len(grupos[k]) for k in ('vencidos', 'hoje', 'proximos', 'sem_data'))
    return grupos


def _contar(itens, chave):
    """Contagem simples, do maior para o menor, para as barras da prospeccao."""
    c = defaultdict(int)
    for x in itens:
        c[chave(x)] += 1
    return sorted(([k, v] for k, v in c.items()), key=lambda p: -p[1])


RESULTADOS_CONTATO = {
    'conversou': 'Conversou', 'sem_resposta': 'Sem resposta',
    'orcamento': 'Pediu orçamento', 'retorno': 'Retorno combinado',
    'sem_interesse': 'Sem interesse',
}


def validar_atividade(d, hoje):
    """Normaliza uma atividade antes de abrir a transação de gravação."""
    resultado = d.get('resultado') or 'conversou'
    if resultado not in RESULTADOS_CONTATO:
        raise ValueError('Escolha um resultado válido para o contato.')
    resumo = str(d.get('resumo') or '').strip()[:1000]
    if not resumo:
        raise ValueError('Escreva um resumo do contato.')
    quando = date.fromisoformat(str(d.get('data') or hoje))
    if quando > date.fromisoformat(str(hoje)):
        raise ValueError('O contato não pode estar no futuro. Agende uma tarefa.')
    proximo = str(d.get('proximo') or '').strip()[:300]
    prazo = str(d.get('proximo_em') or '').strip()
    if bool(proximo) != bool(prazo):
        raise ValueError('Preencha o próximo passo e a data juntos.')
    if resultado in ('sem_resposta', 'retorno') and not proximo:
        raise ValueError('Agende a próxima tentativa ou o retorno combinado.')
    if prazo:
        prazo = date.fromisoformat(prazo).isoformat()
        if prazo < str(hoje):
            raise ValueError('Agende o próximo passo para hoje ou uma data futura.')
    return dict(resultado=resultado, resumo=resumo, data=quando.isoformat(),
                proximo=proximo, proximo_em=prazo or None,
                responsavel=str(d.get('responsavel') or '').strip()[:120])


def retornos_pendentes(tarefas, leads):
    """Menor prazo em aberto por cliente, incluindo tarefas de leads vinculados."""
    vinculos = {l['id']: l.get('cliente_id') for l in leads if l.get('cliente_id')}
    retorno = {}
    for t in tarefas:
        if t.get('feita') or not t.get('prazo'):
            continue
        cid = vinculos.get(t['cliente']) or t['cliente']
        try:
            prazo = date.fromisoformat(str(t['prazo'])[:10])
        except ValueError:
            continue
        if cid not in retorno or prazo < retorno[cid]:
            retorno[cid] = prazo
    return retorno
