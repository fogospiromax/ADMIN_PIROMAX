import ast
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import crm_auth


class AuthTests(unittest.TestCase):
    def test_three_named_users_and_old_admin_disabled(self):
        senha = 'Teste-ficticio-longo-123'
        ambiente = {'PIROMAX_PASSWORD_HASH_FLAVIA': crm_auth.criar_hash(senha)}
        self.assertEqual(crm_auth.autenticar('Flávia', senha, ambiente), 'flavia')
        self.assertIsNone(crm_auth.autenticar('admin', senha, ambiente))
        self.assertIsNone(crm_auth.autenticar('flavia', 'senha errada', ambiente))
        self.assertIsNone(crm_auth.autenticar('tiago', senha, ambiente))

    def test_session_stops_working_after_password_rotation(self):
        senha = 'Teste-ficticio-longo-123'
        anterior = crm_auth.criar_hash(senha)
        sessao = {'usuario_id': 'fernando', 'credencial_versao': crm_auth.versao_credencial(anterior)}
        self.assertEqual(crm_auth.sessao_valida(sessao, {'PIROMAX_PASSWORD_HASH_FERNANDO': anterior}), 'fernando')
        novo = crm_auth.criar_hash(senha)
        self.assertIsNone(crm_auth.sessao_valida(sessao, {'PIROMAX_PASSWORD_HASH_FERNANDO': novo}))
        self.assertIsNone(crm_auth.sessao_valida({'admin_logged_in': True}, {}))

    def test_malformed_hash_and_short_password_are_rejected(self):
        with self.assertRaises(ValueError):
            crm_auth.criar_hash('curta')
        self.assertFalse(crm_auth.verificar_hash('qualquer', 'pbkdf2_sha256$inválido'))

    def test_login_route_creates_named_session_and_rejects_admin(self):
        source = ast.parse((ROOT/'app.py').read_text())
        node = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == 'admin_login')
        node.decorator_list = []
        class Session(dict):
            permanent = False
        sessao = Session()
        formulario = {'username': 'Flávia', 'password': 'Senha-ficticia-segura-123'}
        env = {'request': SimpleNamespace(method='POST', form=formulario), 'session': sessao,
               'sessao_valida': crm_auth.sessao_valida, 'autenticar': crm_auth.autenticar,
               'versao_credencial': crm_auth.versao_credencial,
               'variavel_hash': crm_auth.variavel_hash, 'os': os,
               'url_for': lambda name: name, 'redirect': lambda name: ('redirect', name),
               'render_template': lambda name, **kw: (name, kw)}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(ROOT/'app.py'), 'exec'), env)
        with patch.dict(os.environ, {'PIROMAX_PASSWORD_HASH_FLAVIA':
                      crm_auth.criar_hash(formulario['password'])}):
            self.assertEqual(env['admin_login'](), ('redirect', 'admin_view'))
            self.assertEqual(sessao['usuario_id'], 'flavia')
            self.assertTrue(sessao.permanent)
            sessao.clear()
            formulario.update(username='admin', password='senha-antiga-ficticia')
            page = env['admin_login']()
            self.assertEqual(page[0], 'login.html')
            self.assertNotIn('usuario_id', sessao)


if __name__ == '__main__':
    unittest.main()
