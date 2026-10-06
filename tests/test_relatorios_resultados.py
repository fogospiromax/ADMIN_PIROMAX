"""Relatórios de resultados verificados somente com vendas inventadas."""

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import carteira
import relatorios_resultados


class RelatoriosResultadosTests(unittest.TestCase):
    def dados(self, incluir_outubro=False):
        vendas = [
            (date(2024, 10, 12), 'CLIENTE FICTÍCIO A', 100),
            (date(2025, 10, 12), 'CLIENTE FICTÍCIO A', 300),
            (date(2024, 11, 12), 'CLIENTE FICTÍCIO A', 200),
            (date(2025, 11, 12), 'CLIENTE FICTÍCIO A', 400),
            (date(2026, 9, 20), 'CLIENTE FICTÍCIO A', 50),
            (date(2024, 10, 12), 'CLIENTE FICTÍCIO B', 500),
            (date(2025, 10, 12), 'CLIENTE FICTÍCIO B', 500),
        ]
        if incluir_outubro:
            vendas.append((date(2026, 10, 5), 'CLIENTE FICTÍCIO B', 75))
            vendas.append((date(2026, 10, 5), 'CLIENTE NOVO FICTÍCIO', 25))
        return carteira.calcular(vendas, hoje=date(2026, 10, 6))

    def test_months_follow_calendar_and_stale_import_is_not_zero_sale(self):
        rel = relatorios_resultados.preparar_ligacoes(
            self.dados(), [], date(2026, 10, 6))
        self.assertEqual([(s['ano'], s['mes']) for s in rel['secoes']],
                         [(2026, 10), (2026, 11)])
        self.assertFalse(rel['mes_atual_importado'])
        atual = next(x for x in rel['secoes'][0]['linhas']
                     if x['cliente'] == 'CLIENTE FICTÍCIO A')
        self.assertIsNone(atual['realizado'])
        self.assertEqual(atual['media'], 200)
        proximo = next(x for x in rel['secoes'][1]['linhas']
                       if x['cliente'] == 'CLIENTE FICTÍCIO A')
        self.assertEqual(proximo['media'], 300)

    def test_realized_sale_is_separate_from_historical_average(self):
        rel = relatorios_resultados.preparar_ligacoes(
            self.dados(incluir_outubro=True), [], date(2026, 10, 6))
        self.assertTrue(rel['mes_atual_importado'])
        linhas = rel['secoes'][0]['linhas']
        self.assertEqual(linhas[0]['cliente'], 'CLIENTE FICTÍCIO A')
        self.assertEqual(linhas[0]['realizado'], 0)
        cliente_b = next(x for x in linhas if x['cliente'] == 'CLIENTE FICTÍCIO B')
        self.assertEqual(cliente_b['realizado'], 75)
        self.assertEqual(cliente_b['media'], 500)
        novo = next(x for x in linhas if x['cliente'] == 'CLIENTE NOVO FICTÍCIO')
        self.assertEqual(novo['realizado'], 25)
        self.assertIsNone(novo['media'])

    def test_december_rolls_to_january_and_both_pdfs_open(self):
        dados = self.dados(incluir_outubro=True)
        rel = relatorios_resultados.preparar_ligacoes(
            dados, [], date(2026, 12, 2))
        self.assertEqual([(s['ano'], s['mes']) for s in rel['secoes']],
                         [(2026, 12), (2027, 1)])
        self.assertTrue(relatorios_resultados.pdf_analitico(
            dados, date(2026, 10, 6)).startswith(b'%PDF-'))
        self.assertTrue(relatorios_resultados.pdf_ligacoes(
            dados, [], date(2026, 10, 6)).startswith(b'%PDF-'))


if __name__ == '__main__':
    unittest.main()
