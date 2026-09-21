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


def calcular(linhas, aliases=None, fichas=None):
    """linhas: [(date, nome, valor)]. aliases: {nome_antigo: nome_canonico}.
    fichas: {id_do_cliente: {'situacao': 'ativo'|'pausado'|'perdido',
                             'motivo_tipo': str, 'motivo': str, ...}}"""
    aliases = {k.strip().upper(): v.strip().upper() for k, v in (aliases or {}).items()}
    fichas = fichas or {}
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
        C[n]['cidade'] = f.get('cidade') or ''
        C[n]['uf_base'] = (f.get('estado') or '').upper()
        at = f.get('atuacao') or []
        if isinstance(at, str):
            at = [x for x in re.split(r'[;,\s]+', at) if x]
        C[n]['atuacao'] = [str(x).strip().upper() for x in at]
        C[n]['atuacao_rotulo'] = rotulo_atuacao(C[n]['atuacao'])
        C[n]['atuacao_ufs'] = ufs_cobertas(C[n]['atuacao'])
    encerrados = {n for n in nomes if C[n]['encerrado']}

    # ── direcao comercial e ritmo de compra ──
    for n in nomes:
        C[n]['direcao'] = _direcao(C[n])
        C[n]['ritmo'], C[n]['ritmo_rel'] = _ritmo(C[n])

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
    }
    return saida


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

ETAPAS = [
    ('novo',    'Novo',       'Entrou na lista e ninguem falou com ele ainda.'),
    ('contato', 'Em contato', 'Alguem ja falou, a conversa esta viva.'),
    ('ganho',   'Ganhou',     'Virou cliente. Some da fila e aparece na carteira.'),
    ('perdido', 'Perdido',    'Nao vai acontecer, com o motivo escrito.'),
]
ETAPAS_ABERTAS = ('novo', 'contato')

# Sinonimos aceitos no cabecalho do CSV de leads. O objetivo e que o gestor
# exporte de onde for e o arquivo entre sem precisar renomear coluna.
COLUNAS_LEAD = {
    'nome':     ['nome', 'empresa', 'razao social', 'cliente', 'lead', 'estabelecimento'],
    'cidade':   ['cidade', 'municipio', 'localidade'],
    'uf':       ['uf', 'estado', 'sigla'],
    'contato':  ['contato', 'responsavel', 'pessoa', 'nome do contato', 'comprador'],
    'telefone': ['telefone', 'fone', 'celular', 'whatsapp', 'whats', 'tel'],
    'email':    ['email', 'e mail', 'e-mail', 'mail'],
}


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
        uf = pega('uf', 40).upper()
        if uf not in REGIAO_DA_UF:
            uf = uf[:2] if uf[:2] in REGIAO_DA_UF else ''
        leads.append({
            'nome': nome.upper(), 'cidade': pega('cidade', 120), 'uf': uf,
            'contato': pega('contato', 120), 'telefone': pega('telefone', 40),
            'email': pega('email', 160),
        })
    return leads, erros


def analisar_leads(leads, clientes_dados=None):
    """Organiza os leads e cruza com a carteira.

    O cruzamento e a parte que importa: importar uma lista de feira e sair
    ligando para quem ja compra todo mes e o jeito mais rapido de queimar o
    time. Quem ja e cliente sai da fila e aparece marcado.
    """
    porcarteira = {}
    if clientes_dados:
        for c in clientes_dados['clientes']:
            porcarteira[normalizar(c['nome'])] = c
            for a in c.get('alias', []):
                porcarteira[normalizar(a)] = c

    saida, por_etapa = [], defaultdict(list)
    for L in leads:
        d = dict(L)
        d['etapa'] = d.get('etapa') or 'novo'
        ja = porcarteira.get(normalizar(d['nome']))
        d['ja_cliente'] = bool(ja)
        d['cliente_id'] = ja['id'] if ja else (d.get('cliente_id') or '')
        d['cliente_receita'] = ja['receita'] if ja else 0.0
        d['cliente_direcao'] = ja['direcao'] if ja else ''
        d['regiao'] = REGIAO_DA_UF.get(d.get('uf') or '', '')
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
        'ja_clientes': sum(1 for d in saida if d['ja_cliente']),
    }
