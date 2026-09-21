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


MOTIVOS = [
    ('faleceu', 'Dono faleceu'),
    ('fechou', 'Fechou as portas'),
    ('concorrente', 'Foi para um concorrente'),
    ('preco', 'Questão de preço'),
    ('inadimplencia', 'Inadimplência, venda bloqueada'),
    ('licenca', 'Licença do Exército vencida'),
    ('sucessao', 'Mudou de dono ou de comprador'),
    ('sazonal', 'Comportamento sazonal, volta na época'),
    ('estoque', 'Comprou demais, ainda tem estoque'),
    ('mudanca', 'Mudou de ramo ou de região'),
    ('outro', 'Outro motivo'),
]
# Situacoes que tiram o cliente da lista de acao e da projecao: nao adianta
# cobrar meta de quem fechou, e manter isso na fila so faz o time perder tempo.
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

    # ── RFM ──
    _pontuar(C, nomes, 'recencia', 'R', invertido=True)
    _pontuar(C, nomes, 'compras', 'F')
    _pontuar(C, nomes, 'receita', 'M')
    for n in nomes:
        C[n]['segmento'] = _segmento(C[n]['R'], C[n]['F'], C[n]['M'])

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
        C[n]['var_ytd_abs'] = C[n]['ytd%d' % REF.year] - C[n]['ytd_base']
        C[n]['var_ytd_pct'] = ((C[n]['var_ytd_abs'] / C[n]['ytd_base'] * 100)
                               if C[n]['ytd_base'] > 0 else None)
        C[n]['inativo12m'] = C[n]['recencia'] > 365
        C[n]['coorte'] = C[n]['primeira'].year
        C[n]['receita_12m_ant'] = soma(REF - 2 * ano, REF - ano, n)
        C[n]['hist'] = [[d.isoformat(), v] for d, v in por_cliente[n]]

    # ── situacao declarada pelo gestor ──
    for n in nomes:
        f = fichas.get(C[n]['id'], {})
        C[n]['situacao'] = (f.get('situacao') or 'ativo')
        C[n]['motivo_tipo'] = f.get('motivo_tipo') or ''
        C[n]['motivo'] = f.get('motivo') or ''
        C[n]['encerrado'] = C[n]['situacao'] in SITUACOES_ENCERRADAS
    encerrados = {n for n in nomes if C[n]['encerrado']}

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


def _pontuar(C, nomes, campo, destino, invertido=False):
    """Quintis sobre o campo, com desempate estavel pela ordem do nome."""
    ordenado = sorted(nomes, key=lambda n: (C[n][campo], n))
    total = len(ordenado)
    for pos, n in enumerate(ordenado):
        import math
        q = min(5, max(1, math.ceil((pos + 1) / total * 5)))
        C[n][destino] = (6 - q) if invertido else q


def _segmento(R, F, M):
    fm = (F + M) / 2
    if R >= 4 and fm >= 4: return 'Campeoes'
    if R >= 3 and fm >= 3: return 'Fieis'
    if R >= 4 and fm < 3: return 'Promissores'
    if R == 3 and fm < 3: return 'Atencao'
    if R <= 2 and fm >= 4: return 'Em risco'
    if R <= 2 and fm == 3: return 'Hibernando'
    return 'Perdidos'


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
    for k in ('R', 'F', 'M'):
        d[k] = int(d[k])
    return d


# ── projecao ──────────────────────────────────────────────────────────────────

def _projetar(nomes, mat, emp, C, faixa, REF, encerrados=()):
    """Media do mesmo mes nos dois anos anteriores, somada cliente a cliente.
    Foi o metodo que melhor se saiu no backtest; ver _backtestar."""
    mref = _mes(REF)
    alvos = [mref] + [m for m in range(mref + 1, (REF.year * 12) + 12)]
    alvos = alvos[:4]  # o mes corrente e o resto do ano civil

    reg = _regularidade(nomes, mat, mref)
    prev_cli, prev_emp = {}, {}
    for a in alvos:
        p = {}
        for n in nomes:
            anteriores = [mat[n].get(a - 12, 0.0), mat[n].get(a - 24, 0.0)]
            anteriores = [x for x, mm in zip(anteriores, (a - 12, a - 24)) if mm >= faixa[0]]
            v = sum(anteriores) / len(anteriores) if anteriores else 0.0
            if _mes(C[n]['primeira']) >= a or n in encerrados:
                v = 0.0
            p[n] = max(0.0, v)
        prev_cli[a] = p
        prev_emp[a] = sum(p.values())

    ja_mes = emp[mref]
    resto_mes = {n: max(0.0, prev_cli[mref][n] - mat[n].get(mref, 0.0)) for n in nomes}
    futuros = alvos[1:]
    bloco = {n: sum(prev_cli[a][n] for a in futuros) for n in nomes}

    def faixa_hist(n):
        lo = sum(min(mat[n].get(a - 12, 0.0), mat[n].get(a - 24, 0.0)) for a in futuros)
        hi = sum(max(mat[n].get(a - 12, 0.0), mat[n].get(a - 24, 0.0)) for a in futuros)
        return lo, hi

    clientes = []
    for n in sorted(nomes, key=lambda x: -bloco[x]):
        r = reg[n]
        conf = 'boa' if r >= 10 else ('razoavel' if r >= 7 else None)
        if not conf or n in encerrados:
            continue
        lo, hi = faixa_hist(n)
        clientes.append({'nome': n, 'id': C[n]['id'], 'conf': conf, 'reg': r,
                         'prev': bloco[n], 'min': lo, 'max': hi,
                         'set_resto': resto_mes[n],
                         'meses': {_rotulo(a): prev_cli[a][n] for a in futuros}})

    return {
        'empresa': {
            'resto_mes': sum(resto_mes.values()), 'ja_mes': ja_mes,
            'mes_corrente': _rotulo(mref),
            'meses': {_rotulo(a): {'previsto': prev_emp[a],
                                   'h1': sum(mat[n].get(a - 24, 0.0) for n in nomes),
                                   'h2': sum(mat[n].get(a - 12, 0.0) for n in nomes)}
                      for a in futuros},
            'bloco': sum(prev_emp[a] for a in futuros),
            'h1': sum(emp[a - 24] for a in futuros),
            'h2': sum(emp[a - 12] for a in futuros),
        },
        'clientes': clientes,
        'sem_meta': len(nomes) - len(clientes),
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
