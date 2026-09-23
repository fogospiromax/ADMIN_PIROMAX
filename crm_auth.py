"""Contas nominais do painel; os hashes das senhas ficam só no ambiente."""

import base64
import binascii
import hashlib
import hmac
import os
import secrets
import unicodedata


USUARIOS = {
    'flavia': 'Flávia',
    'tiago': 'Tiago',
    'fernando': 'Fernando',
}


def normalizar_usuario(valor):
    texto = unicodedata.normalize('NFKD', str(valor or '').strip().lower())
    return ''.join(c for c in texto if not unicodedata.combining(c))


def variavel_hash(usuario):
    return 'PIROMAX_PASSWORD_HASH_' + usuario.upper()


def criar_hash(senha):
    if len(senha) < 16:
        raise ValueError('A senha precisa ter ao menos 16 caracteres.')
    sal = secrets.token_bytes(16)
    derivada = hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), sal, 600000, dklen=32)
    return 'pbkdf2_sha256$600000$' + base64.urlsafe_b64encode(sal).decode('ascii') + '$' \
        + base64.urlsafe_b64encode(derivada).decode('ascii')


def verificar_hash(senha, registro):
    try:
        algoritmo, iteracoes, sal, esperado = registro.split('$')
        if algoritmo != 'pbkdf2_sha256' or iteracoes != '600000':
            return False
        sal = base64.b64decode(sal, altchars=b'-_', validate=True)
        esperado = base64.b64decode(esperado, altchars=b'-_', validate=True)
        if len(sal) != 16 or len(esperado) != 32:
            return False
        derivada = hashlib.pbkdf2_hmac('sha256', str(senha).encode('utf-8'), sal, 600000, dklen=32)
        return hmac.compare_digest(derivada, esperado)
    except (AttributeError, ValueError, TypeError, binascii.Error):
        return False


def versao_credencial(registro):
    return hashlib.sha256(registro.encode('utf-8')).hexdigest()[:24]


def autenticar(usuario, senha, ambiente=None):
    usuario = normalizar_usuario(usuario)
    if usuario not in USUARIOS:
        return None
    registro = (ambiente if ambiente is not None else os.environ).get(variavel_hash(usuario), '')
    return usuario if registro and verificar_hash(senha, registro) else None


def sessao_valida(sessao, ambiente=None):
    usuario = sessao.get('usuario_id')
    if usuario not in USUARIOS:
        return None
    registro = (ambiente if ambiente is not None else os.environ).get(variavel_hash(usuario), '')
    return usuario if registro and sessao.get('credencial_versao') == versao_credencial(registro) else None
