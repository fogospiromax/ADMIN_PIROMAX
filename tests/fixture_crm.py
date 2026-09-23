"""Dados inventados para verificar a interface. Nenhuma conexão externa."""
import json
import sys
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import carteira
hoje = date(2026, 9, 23)
nomes = ['CLIENTE DEMONSTRAÇÃO ALFA', 'CLIENTE DEMONSTRAÇÃO BETA', 'CLIENTE DEMONSTRAÇÃO GAMA']
linhas = [(date(ano, mes, 12), nome, float((i + 1) * 500 * (1 if ano < 2026 else (0.5, 1.4, 1)[i])))
          for ano in (2024, 2025, 2026)
          for mes in range(1, 13 if ano < 2026 else 10)
          for i, nome in enumerate(nomes)]
ids = [carteira.id_cliente(nome) for nome in nomes]
fichas = {ids[0]: dict(cidade='Cidade exemplo', estado='SP', contato='Contato de demonstração',
                       telefone='', responsavel='Equipe exemplo', responsavel_usuario='fernando'),
          ids[1]: dict(responsavel_usuario='fernando'),
          ids[2]: dict(responsavel_usuario='flavia')}
inter = [dict(id='i1', cliente=ids[0], data='2026-08-01', tipo='contato',
              resumo='Histórico fictício para teste.', resultado='conversou',
              responsavel='Equipe exemplo', usuario_id='fernando')]
tarefas = [dict(id='t1', cliente=ids[0], titulo='Retornar sobre orçamento de demonstração',
                prazo='2026-09-22', feita=False, responsavel='Equipe exemplo', concluido_em=''),
           dict(id='t2', cliente=ids[1], titulo='Enviar proposta de exemplo', prazo='2026-09-23',
                feita=False, responsavel='', concluido_em=''),
           dict(id='t3', cliente=ids[2], titulo='Tarefa exclusiva de Flávia', prazo='2026-09-23',
                feita=False, responsavel='', concluido_em='')]
leads = [dict(id='lead-exemplo', nome='LEAD DEMONSTRAÇÃO', cidade='Cidade fictícia', uf='MG',
              contato='', telefone='', instagram='', segmento='Lojista', etapa='contato',
              proximo='Conferir interesse na proposta', proximo_em='2026-09-23',
              motivo='', obs='', cliente_id='', responsavel_usuario='fernando'),
         dict(id='lead-sem-acao', nome='LEAD SEM AÇÃO', cidade='Cidade fictícia', uf='SP',
              contato='', telefone='', instagram='', segmento='', etapa='novo',
              proximo='', proximo_em='', motivo='', obs='', cliente_id='', responsavel_usuario='tiago')]
dados = carteira.calcular(linhas, {}, fichas, {ids[0]: date(2026, 8, 1)}, hoje,
                          carteira.retornos_pendentes(tarefas, leads))
dados['meta']['ultima_importacao'] = '2026-09-23 09:00:00'
print(json.dumps(dict(success=True, dados=dados, fichas=fichas, inter=inter, tarefas=tarefas,
                      aliases={}, candidatos=[], prospec=carteira.analisar_leads(leads, dados, hoje),
                      pessoal=carteira.visao_pessoal(dados, leads, tarefas, inter, 'fernando', hoje.isoformat()),
                      regioes=[[k, v[0], v[1]] for k, v in carteira.REGIOES.items()],
                      etapas=carteira.ETAPAS, hoje=hoje.isoformat()), default=str))
