"""Relatório individual verificado apenas com dados inventados."""

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import carteira
import relatorio_cliente


class RelatorioClienteTests(unittest.TestCase):
    def cliente(self):
        vendas = [
            (date(2024, 9, 12), 'CLIENTE FICTÍCIO', 100),
            (date(2025, 9, 12), 'CLIENTE FICTÍCIO', 200),
            (date(2026, 8, 2), 'CLIENTE FICTÍCIO', 40),
            (date(2026, 9, 10), 'CLIENTE FICTÍCIO', 300),
            (date(2026, 9, 10), 'CLIENTE FICTÍCIO', 50),
            (date(2026, 9, 19), 'OUTRO CLIENTE', 9999),
        ]
        dados = carteira.calcular(vendas, hoje=date(2026, 9, 23))
        cliente = next(c for c in dados['clientes'] if c['nome'] == 'CLIENTE FICTÍCIO')
        return cliente, dados['meta']

    def test_serie_e_historico_usam_apenas_o_cliente_escolhido(self):
        cliente, meta = self.cliente()
        rel = relatorio_cliente.preparar(cliente, [], [], meta, date(2026, 9, 23))
        self.assertEqual(len(rel['serie']), 12)
        self.assertEqual(rel['serie'][-1]['mes'], '2026-09')
        self.assertEqual(rel['serie'][-1]['valor'], 350)
        self.assertEqual(rel['serie'][-2]['valor'], 40)
        self.assertEqual(rel['compras'][0], ['2026-09-10', 350])
        self.assertEqual(sum(v for _, v in rel['compras']), 690)

    def test_contatos_e_tarefas_nao_misturam_outro_cliente(self):
        cliente, meta = self.cliente()
        cid = cliente['id']
        contatos = [
            dict(id='a', cliente=cid, data='2026-09-19', resultado='conversou', resumo='Conversa fictícia'),
            dict(id='b', cliente='outro', data='2026-09-20', resumo='Privado de outro cliente'),
            dict(id='c', cliente=cid, tipo='tarefa', data='2026-09-21', resumo='Tarefa concluída'),
        ]
        tarefas = [
            dict(cliente=cid, titulo='Retornar', prazo='2026-09-23', feita=False),
            dict(cliente='outro', titulo='Privado de outro cliente', prazo='2026-09-22', feita=False),
        ]
        rel = relatorio_cliente.preparar(cliente, contatos, tarefas, meta, date(2026, 9, 23))
        self.assertEqual(len(rel['contatos']), 1)
        self.assertEqual(rel['contatos'][0]['resultado_rotulo'], 'Conversou')
        self.assertEqual([t['titulo'] for t in rel['pendentes']], ['Retornar'])
        self.assertEqual(rel['sinais'][0][1], 'Sem responsável')

    def test_estimativa_e_comparacao_nao_sao_tratadas_como_venda(self):
        cliente, meta = self.cliente()
        rel = relatorio_cliente.preparar(cliente, [], [], meta, date(2026, 9, 23))
        self.assertTrue(rel['comparacao_disponivel'])
        self.assertEqual(rel['horizonte']['meses'][0]['realizado'], 350)
        self.assertGreaterEqual(rel['horizonte']['meses'][0]['estimativa'],
                                rel['horizonte']['meses'][0]['realizado'])
        self.assertEqual(cliente['receita'], 690)
        self.assertEqual(relatorio_cliente.moeda(1234.5), 'R$ 1.234,50')


if __name__ == '__main__':
    unittest.main()
