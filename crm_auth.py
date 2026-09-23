"""Contas nominais do painel; cada senha é configurada diretamente no Render."""

import hashlib
import hmac
import os
import unicodedata


USUARIOS = {
    'flavia': 'Flávia',
    'tiago': 'Tiago',
    'fernando': 'Fernando',
}


def normalizar_usuario(valor):
    texto = unicodedata.normalize('NFKD', str(valor or '').strip().lower())
    return ''.join(c for c in texto if not unicodedata.combining(c))


def variavel_senha(usuario):
    return 'PIROMAX_PASSWORD_' + usuario.upper()


def versao_credencial(usuario, senha, segredo):
    """Marcador de sessão sem revelar uma derivação verificável da senha."""
    mensagem = (usuario + '\0' + senha).encode('utf-8')
    return hmac.new(str(segredo).encode('utf-8'), mensagem, hashlib.sha256).hexdigest()[:24]


def autenticar(usuario, senha, ambiente=None):
    usuario = normalizar_usuario(usuario)
    if usuario not in USUARIOS:
        return None
    definida = (ambiente if ambiente is not None else os.environ).get(variavel_senha(usuario), '')
    if not definida or not senha:
        return None
    return usuario if hmac.compare_digest(str(senha).encode('utf-8'),
                                          str(definida).encode('utf-8')) else None


def sessao_valida(sessao, segredo, ambiente=None):
    usuario = sessao.get('usuario_id')
    if usuario not in USUARIOS:
        return None
    definida = (ambiente if ambiente is not None else os.environ).get(variavel_senha(usuario), '')
    if not definida:
        return None
    esperada = versao_credencial(usuario, definida, segredo)
    marcador = sessao.get('credencial_versao') or ''
    return usuario if hmac.compare_digest(str(marcador), esperada) else None
