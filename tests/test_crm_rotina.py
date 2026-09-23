"""Regressões com dados fictícios. Não importa app.py nem conecta ao Postgres."""
import ast
import sqlite3
import sys
import unittest
import uuid
from datetime import date
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import carteira

TODAY = '2026-09-23'


class Cursor:
    def __init__(self, db, named=False):
        self.cursor = db.cursor()
        self.named = named
    def execute(self, sql, args=()):
        self.cursor.execute(sql.replace('%s', '?').replace(' FOR UPDATE', ''), args)
        return self
    def executemany(self, sql, args):
        self.cursor.executemany(sql.replace('%s', '?'), args)
    def fetchone(self):
        r = self.cursor.fetchone()
        return (dict(r) if self.named else tuple(r)) if r is not None else None
    def fetchall(self):
        return [dict(r) if self.named else tuple(r) for r in self.cursor.fetchall()]
    @property
    def rowcount(self):
        return self.cursor.rowcount
    def close(self):
        self.cursor.close()


class Connection:
    def __init__(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          CREATE TABLE carteira_interacao(id TEXT PRIMARY KEY, cliente_id TEXT, data TEXT, tipo TEXT,
            resumo TEXT, resultado TEXT DEFAULT '', responsavel TEXT DEFAULT '',
            usuario_id TEXT DEFAULT '', criado_em TEXT);
          CREATE TABLE carteira_tarefa(id TEXT PRIMARY KEY, cliente_id TEXT, titulo TEXT, prazo TEXT,
            feita BOOL DEFAULT 0, responsavel TEXT DEFAULT '', concluido_em TEXT, criado_em TEXT);
          CREATE TABLE carteira_lead(id TEXT PRIMARY KEY, nome TEXT, proximo TEXT, proximo_em TEXT,
            etapa TEXT, cliente_id TEXT, atualizado_em TEXT, contato TEXT, telefone TEXT, cidade TEXT,
            uf TEXT, email TEXT, motivo TEXT, obs TEXT, segmento TEXT, instagram TEXT,
            revenda BOOL, revenda_de TEXT, responsavel_usuario TEXT DEFAULT '');
          CREATE TABLE carteira_vendas(data TEXT, cliente TEXT, valor REAL);
          CREATE TABLE special_orders(cliente TEXT, produto TEXT, quantidade INT,
            urgente BOOL, concluido BOOL, criado_em TEXT, data_entrega TEXT);
          CREATE TABLE carteira_alias(apelido TEXT PRIMARY KEY, canonico TEXT);
          CREATE TABLE carteira_ficha(cliente_id TEXT PRIMARY KEY, cliente_nome TEXT, cidade TEXT,
            estado TEXT,situacao TEXT,motivo TEXT,atuacao TEXT,obs TEXT,dispensa BOOL,cadencia INT,
            tipo TEXT,classe_manual TEXT,prioridade BOOL,atualizado_em TEXT,
            contato TEXT DEFAULT '', telefone TEXT DEFAULT '', email TEXT DEFAULT '',
            responsavel TEXT DEFAULT '', responsavel_usuario TEXT DEFAULT '');
        ''')
    def cursor(self, cursor_factory=None):
        return Cursor(self.db, bool(cursor_factory))
    def commit(self):
        self.db.commit()
    def rollback(self):
        self.db.rollback()
    def close(self):
        pass  # each test owns the in-memory database


class RotinaTests(unittest.TestCase):
    def test_sem_registro_nao_tem_atraso_infinito(self):
        c = {'classe': 'A'}
        carteira._rotina(c, {}, None, date.fromisoformat(TODAY))
        self.assertEqual(c['contato_atraso'], 0)
        self.assertEqual(c['contato_rotulo'], 'Sem contato registrado')

    def test_compromisso_prevalece_sobre_cadencia(self):
        c = {'classe': 'A'}
        carteira._rotina(c, {}, date(2026, 1, 1), date(2026, 9, 23), date(2026, 9, 25))
        self.assertFalse(c['contato_urgente'])
        self.assertIn('25/09/2026', c['contato_rotulo'])
        carteira._rotina(c, {}, date(2026, 9, 23), date(2026, 9, 23), date(2026, 9, 22))
        self.assertTrue(c['contato_urgente'])
        self.assertIn('1 dia', c['contato_rotulo'])

    def test_tarefa_concluida_nao_define_retorno(self):
        ts = [dict(cliente='a', prazo='2026-09-01', feita=True),
              dict(cliente='a', prazo='2026-09-26', feita=False),
              dict(cliente='lead', prazo='2026-09-25', feita=False)]
        self.assertEqual(carteira.retornos_pendentes(ts, [dict(id='lead', cliente_id='a')]),
                         {'a': date(2026, 9, 25)})

    def test_sem_resposta_exige_proxima_tentativa(self):
        with self.assertRaises(ValueError):
            carteira.validar_atividade(dict(resultado='sem_resposta', resumo='Tentativa fictícia'), TODAY)
        a = carteira.validar_atividade(dict(resultado='sem_resposta', resumo='Tentativa fictícia',
            proximo='Ligar novamente', proximo_em='2026-09-24'), TODAY)
        self.assertEqual(a['resultado'], 'sem_resposta')

    def test_datas_invalidas_e_parciais_sao_rejeitadas(self):
        for extra in [dict(proximo='Ligar'), dict(proximo_em='2026-09-24'),
                      dict(data='2026-09-24'), dict(proximo='Ligar', proximo_em='2026-09-22'),
                      dict(resultado='inexistente'), dict(data='não é data')]:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                carteira.validar_atividade(dict(resumo='Exemplo', **extra), TODAY)

    def test_retorno_nao_altera_receita(self):
        n = 'CLIENTE FICTÍCIO'; cid = carteira.id_cliente(n)
        linhas = [(date(2025, 1, 15), n, 1000), (date(2026, 9, 12), n, 2000)]
        a = carteira.calcular(linhas, hoje=date.fromisoformat(TODAY))
        b = carteira.calcular(linhas, hoje=date.fromisoformat(TODAY), retornos={cid: date(2026,9,25)})
        self.assertEqual(a['meta']['receita'], b['meta']['receita'])
        self.assertFalse(b['clientes'][0]['contato_urgente'])
        self.assertEqual(b['clientes'][0]['dias_desde_compra_hoje'], 11)

    def test_personal_agenda_is_selected_on_server_by_owner(self):
        dados={'clientes':[dict(id='a',responsavel_usuario='flavia'),
                           dict(id='b',responsavel_usuario='tiago'),
                           dict(id='c',responsavel_usuario='')]}
        leads=[dict(id='la',cliente_id='a',responsavel_usuario='tiago'),
               dict(id='lb',cliente_id='',responsavel_usuario='flavia')]
        tarefas=[dict(id='ta',cliente='a'),dict(id='tb',cliente='b'),
                 dict(id='tc',cliente='c'),dict(id='tla',cliente='la'),dict(id='tlb',cliente='lb')]
        inter=[dict(data=TODAY,tipo='contato',usuario_id='flavia'),
               dict(data=TODAY,tipo='contato',usuario_id='tiago')]
        pessoal=carteira.visao_pessoal(dados,leads,tarefas,inter,'flavia',TODAY)
        self.assertEqual(pessoal['clientes'],['a'])
        self.assertEqual(pessoal['leads'],['la','lb'])
        self.assertEqual(pessoal['tarefas'],['ta','tla','tlb'])
        self.assertEqual(pessoal['contatos_hoje'],1)

    def test_purchase_history_groups_same_day_without_losing_entries(self):
        rows=[(date(2026,9,20), 100.25),(date(2026,9,20), 200.50),
              (date(2025,1,2), 50)]
        history=carteira.historico_pedidos(rows)
        self.assertEqual(len(history),2)
        self.assertEqual(history[0],dict(data='2026-09-20',valor=300.75,
                                          registros=2,valores=[100.25,200.5]))
        self.assertEqual(history[1]['data'],'2025-01-02')


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.conn = Connection()
        self.body = {}
        env = dict(carteira=carteira, uuid=uuid, _date=date,
                   request=SimpleNamespace(get_json=lambda **kw: self.body),
                   jsonify=lambda value: value, get_db=lambda: self.conn,
                   today_sp=lambda: TODAY, now_sp_str=lambda: TODAY+' 09:00:00',
                   session={'usuario_id':'fernando'}, sessao_valida=lambda s:'fernando',
                   USUARIOS={'flavia':'Flávia','tiago':'Tiago','fernando':'Fernando'})
        functions = ['admin_carteira_contato', 'admin_carteira_tarefa_add',
                     'admin_carteira_tarefa_toggle', 'admin_lead_concluir_retorno',
                     'admin_lead_salvar', 'admin_carteira_ficha', 'admin_carteira_atribuir',
                     'admin_carteira_pedidos']
        tree = ast.parse((ROOT/'app.py').read_text())
        nodes = []
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in functions:
                node.decorator_list = []
                nodes.append(node)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT/'app.py'), 'exec'), env)
        self.env = env

    def call(self, name, body, *args):
        self.body = body
        return self.env[name](*args)

    def rows(self, table):
        return [dict(r) for r in self.conn.db.execute('SELECT * FROM '+table)]

    def test_contact_and_followup_are_saved_together(self):
        result = self.call('admin_carteira_contato', dict(cliente_id='a', resumo='Sem resposta fictícia',
            resultado='sem_resposta', proximo='Tentar novamente', proximo_em='2026-09-25', responsavel='Nome falsificado'))
        self.assertTrue(result['success'])
        self.assertEqual(self.rows('carteira_interacao')[0]['resultado'], 'sem_resposta')
        self.assertEqual(self.rows('carteira_interacao')[0]['responsavel'], 'Fernando')
        self.assertEqual(self.rows('carteira_interacao')[0]['usuario_id'], 'fernando')
        self.assertEqual(self.rows('carteira_tarefa')[0]['prazo'], '2026-09-25')
        last = self.conn.db.execute("SELECT MAX(data) FROM carteira_interacao WHERE COALESCE(resultado,'') <> 'sem_resposta'").fetchone()[0]
        self.assertIsNone(last)

    def test_invalid_contact_writes_nothing(self):
        result = self.call('admin_carteira_contato', dict(cliente_id='a', resumo='Teste', resultado='retorno'))
        self.assertEqual(result[1], 400)
        self.assertEqual(self.rows('carteira_interacao'), [])

    def test_contact_can_complete_own_task_atomically(self):
        self.conn.db.execute("INSERT INTO carteira_tarefa(id,cliente_id,titulo,feita) VALUES ('t','a','Teste',0)")
        self.conn.commit()
        result = self.call('admin_carteira_contato', dict(cliente_id='a', resumo='Conversa de exemplo', tarefa_id='t'))
        self.assertTrue(result['success'])
        self.assertEqual(self.rows('carteira_tarefa')[0]['concluido_em'], TODAY)
        # A stale retry cannot create a second contact and complete the same task twice.
        self.assertEqual(self.call('admin_carteira_contato', dict(cliente_id='a', resumo='Teste', tarefa_id='t'))[1], 409)
        self.assertEqual(len(self.rows('carteira_interacao')), 1)

    def test_lead_contact_replaces_old_return_without_duplicate_pending_task(self):
        self.conn.db.execute("INSERT INTO carteira_lead(id,proximo,proximo_em) VALUES ('l','Retorno antigo',?)", (TODAY,))
        self.conn.commit()
        result = self.call('admin_carteira_contato', dict(cliente_id='l', resumo='Conversa fictícia',
            resultado='retorno', proximo='Enviar proposta', proximo_em='2026-09-25'))
        self.assertTrue(result['success'])
        lead = self.rows('carteira_lead')[0]
        self.assertEqual((lead['proximo'], lead['proximo_em']), ('Enviar proposta', '2026-09-25'))
        tasks = self.rows('carteira_tarefa')
        self.assertEqual(len(tasks), 1)
        self.assertEqual((tasks[0]['titulo'], tasks[0]['feita']), ('Retorno antigo', 1))

    def test_transaction_rolls_back_if_task_insert_fails(self):
        self.conn.db.execute("CREATE TRIGGER fail_task BEFORE INSERT ON carteira_tarefa BEGIN SELECT RAISE(ABORT,'test failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.call('admin_carteira_contato', dict(cliente_id='a', resumo='Teste', proximo='Ligar', proximo_em='2026-09-24'))
        self.assertEqual(self.rows('carteira_interacao'), [])

    def test_task_completion_and_reopen(self):
        result = self.call('admin_carteira_tarefa_add', dict(cliente_id='a', titulo='Tarefa exemplo', prazo=TODAY, responsavel='Equipe'))
        tid = result['id']
        self.call('admin_carteira_tarefa_toggle', dict(feita=True), tid)
        self.assertEqual(self.rows('carteira_tarefa')[0]['concluido_em'], TODAY)
        self.call('admin_carteira_tarefa_toggle', dict(feita=False), tid)
        self.assertIsNone(self.rows('carteira_tarefa')[0]['concluido_em'])

    def test_lead_followup_completion_rejects_stale_page(self):
        self.conn.db.execute("INSERT INTO carteira_lead(id,proximo,proximo_em) VALUES ('l','Retornar',?)",(TODAY,))
        self.conn.commit()
        result=self.call('admin_lead_concluir_retorno', dict(id='l',proximo='Outra tarefa',proximo_em=TODAY))
        self.assertEqual(result[1],409)
        result=self.call('admin_lead_concluir_retorno', dict(id='l',proximo='Retornar',proximo_em=TODAY))
        self.assertTrue(result['success'])
        self.assertEqual(self.rows('carteira_lead')[0]['proximo'],'')
        self.assertEqual(self.rows('carteira_tarefa')[0]['concluido_em'],TODAY)
        self.assertEqual(self.rows('carteira_interacao')[0]['tipo'],'tarefa')

    def test_link_only_existing_customer_without_fabricating_sales(self):
        self.conn.db.execute("INSERT INTO carteira_lead(id,etapa) VALUES ('l','contato')")
        self.conn.db.execute("INSERT INTO carteira_vendas(data,cliente,valor) VALUES (?, 'CLIENTE EXEMPLO',1000)",(TODAY,))
        self.conn.commit()
        bad=self.call('admin_lead_salvar',dict(id='l',cliente_id='inexistente',etapa='ganho'))
        self.assertEqual(bad[1],400)
        cid=carteira.id_cliente('CLIENTE EXEMPLO')
        result=self.call('admin_lead_salvar',dict(id='l',cliente_id=cid,etapa='ganho'))
        self.assertTrue(result['success'])
        self.assertEqual(self.rows('carteira_lead')[0]['cliente_id'],cid)
        self.assertEqual(len(self.rows('carteira_vendas')),1)

    def test_legacy_ficha_update_preserves_new_contact_fields(self):
        self.call('admin_carteira_ficha',dict(cliente_id='a',cliente_nome='EXEMPLO',telefone='123',contato='Exemplo'))
        self.call('admin_carteira_ficha',dict(cliente_id='a',cliente_nome='EXEMPLO',cidade='Cidade'))
        self.assertEqual(self.rows('carteira_ficha')[0]['telefone'],'123')
        self.assertEqual(self.rows('carteira_ficha')[0]['contato'],'Exemplo')

    def test_assignment_queue_accepts_only_existing_customers_and_valid_users(self):
        nome='CLIENTE FICTÍCIO'; cid=carteira.id_cliente(nome)
        self.conn.db.execute('INSERT INTO carteira_vendas(data,cliente,valor) VALUES (?,?,100)',(TODAY,nome))
        self.conn.commit()
        self.assertEqual(self.call('admin_carteira_atribuir',dict(ids=['inexistente'],responsavel_usuario='flavia'))[1],400)
        self.assertEqual(self.call('admin_carteira_atribuir',dict(ids=[cid],responsavel_usuario='admin'))[1],400)
        result=self.call('admin_carteira_atribuir',dict(ids=[cid],responsavel_usuario='tiago'))
        self.assertTrue(result['success'])
        self.assertEqual(self.rows('carteira_ficha')[0]['responsavel_usuario'],'tiago')
        result=self.call('admin_carteira_atribuir',dict(ids=[cid],responsavel_usuario=''))
        self.assertTrue(result['success'])
        self.assertEqual(self.rows('carteira_ficha')[0]['responsavel_usuario'],'')

    def test_all_purchases_include_unified_aliases(self):
        canonical='CLIENTE MODELO'; alias='NOME ANTIGO'
        self.conn.db.execute('INSERT INTO carteira_alias(apelido,canonico) VALUES (?,?)',(alias,canonical))
        self.conn.db.executemany('INSERT INTO carteira_vendas(data,cliente,valor) VALUES (?,?,?)',
            [(TODAY,canonical,100.25),(TODAY,alias,200.50),('2025-01-02',alias,50)])
        self.conn.db.execute('INSERT INTO special_orders VALUES (?,?,?,?,?,?,?)',
                             (alias,'Produto de exemplo',12,1,0,'23/09/2026 09:00','30/09/2026'))
        self.conn.commit()
        result=self.call('admin_carteira_pedidos',{},carteira.id_cliente(canonical))
        self.assertTrue(result['success'])
        self.assertEqual(result['total_pedidos'],2)
        self.assertEqual(result['total_lancamentos'],3)
        self.assertEqual(result['pedidos'][0]['valor'],300.75)
        self.assertEqual(len(result['pedidos_especiais']),1)
        self.assertEqual(result['pedidos_especiais'][0]['produto'],'Produto de exemplo')
        missing=self.call('admin_carteira_pedidos',{},'desconhecido')
        self.assertEqual(missing[1],404)


if __name__ == '__main__':
    unittest.main()
