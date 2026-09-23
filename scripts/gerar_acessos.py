"""Gera senhas iniciais opcionais para digitar no Render fora do repositório.

Uso: python3 scripts/gerar_acessos.py /caminho/privado/para/saida
"""

import os
import secrets
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
from crm_auth import USUARIOS, variavel_senha


def gravar_privado(caminho, conteudo):
    descritor = os.open(str(caminho), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descritor, 'w', encoding='utf-8') as arquivo:
        arquivo.write(conteudo)


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Informe uma pasta privada fora da APP para os dois arquivos.')
    destino = Path(sys.argv[1]).expanduser().resolve()
    if destino == APP or APP in destino.parents:
        raise SystemExit('A pasta de saída precisa ficar fora da APP para não subir as senhas ao GitHub.')
    destino.mkdir(parents=True, exist_ok=True, mode=0o700)
    senhas = {usuario: secrets.token_urlsafe(20) for usuario in USUARIOS}
    texto_senhas = 'Acessos Piromax — guardar em local privado; não enviar ao GitHub.\n\n'
    texto_senhas += ''.join(f'{USUARIOS[u]}\nUsuário: {u}\nSenha: {senhas[u]}\n\n' for u in USUARIOS)
    texto_ambiente = '# Senhas para configurar no Render; mantenha a SECRET_KEY existente.\n'
    texto_ambiente += ''.join(variavel_senha(u) + '=' + senhas[u] + '\n' for u in USUARIOS)
    arquivo_senhas = destino / 'piromax-senhas.txt'
    arquivo_ambiente = destino / 'piromax-render.env'
    if arquivo_senhas.exists() or arquivo_ambiente.exists():
        raise SystemExit('Arquivos de acesso já existem nessa pasta. Escolha outra pasta para evitar sobrescrever.')
    gravar_privado(arquivo_senhas, texto_senhas)
    gravar_privado(arquivo_ambiente, texto_ambiente)
    print('Arquivos privados criados em:', destino)


if __name__ == '__main__':
    main()
