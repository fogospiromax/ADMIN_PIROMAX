import os
import secrets
import uuid
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, date, timedelta
from functools import wraps
from zoneinfo import ZoneInfo
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import psycopg2
from psycopg2.extras import RealDictCursor
from crm_auth import USUARIOS, autenticar, sessao_valida, variavel_hash, versao_credencial

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
app.permanent_session_lifetime = timedelta(hours=12)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

SAO_PAULO = ZoneInfo('America/Sao_Paulo')

def now_sp():
    """Retorna o datetime atual no fuso de São Paulo."""
    return datetime.now(SAO_PAULO)

def today_sp():
    """Retorna a data de hoje em São Paulo como string ISO (YYYY-MM-DD)."""
    return now_sp().date().isoformat()

def now_sp_str():
    """Retorna datetime atual formatado como string legível."""
    return now_sp().strftime('%d/%m/%Y %H:%M')

def get_db():
    database_url = os.environ.get('DATABASE_URL', '')
    # Render usa "postgres://" mas psycopg2 precisa de "postgresql://"
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    return psycopg2.connect(database_url)

def send_email_notificacao(req):
    """Envia e-mail de notificação para flavia@piromax.com.br quando uma nova
    solicitação é inserida. Falhas silenciosas — nunca interrompem o fluxo."""
    smtp_host = os.environ.get('SMTP_HOST', '')
    smtp_port = int(os.environ.get('SMTP_PORT', 587))
    smtp_user = os.environ.get('SMTP_USER', '')
    smtp_pass = os.environ.get('SMTP_PASSWORD', '')

    if not all([smtp_host, smtp_user, smtp_pass]):
        print("[email] SMTP não configurado — notificação ignorada.")
        return

    urgente_txt = "🔴 URGENTE" if req.get('urgente') else "Normal"
    tipo_map = {
        'manutencao': 'Manutenção',
        'compras': 'Compras',
        'rh': 'RH',
        'ti': 'TI',
        'outro': 'Outro',
    }
    tipo_legivel = tipo_map.get(req.get('tipo', 'outro'), req.get('tipo', 'Outro').capitalize())

    subject = f"[Piromax] Nova Solicitação — {tipo_legivel} ({urgente_txt})"

    body = f"""Nova solicitação registrada no sistema Fogos Piromax.

Tipo:       {tipo_legivel}
Prioridade: {urgente_txt}
Data/hora:  {req.get('created_at', '')}

Descrição:
{req.get('descricao', '')}

---
Acesse o painel do gestor para responder: /admin/requests
"""

    msg = MIMEMultipart()
    msg['From'] = smtp_user
    msg['To'] = 'flavia@piromax.com.br'
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain', 'utf-8'))

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, ['flavia@piromax.com.br'], msg.as_string())
        print(f"[email] Notificação enviada para flavia@piromax.com.br (solicitação {req.get('id', '')})")
    except Exception as e:
        print(f"[email] Falha ao enviar notificação: {e}")


def group_by_cliente(orders):
    """Agrupa lista de pedidos por cliente (já deve estar ordenada por cliente)."""
    from itertools import groupby
    result = []
    for cliente, grp in groupby(orders, key=lambda o: o['cliente']):
        result.append({'cliente': cliente, 'produtos': list(grp)})
    return result

def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            produto TEXT NOT NULL,
            quantidade TEXT NOT NULL,
            concluido BOOLEAN DEFAULT FALSE,
            assinatura TEXT DEFAULT '',
            concluido_em TEXT DEFAULT '',
            urgente BOOLEAN DEFAULT FALSE
        )
    ''')
    cur.execute('''
        ALTER TABLE tasks ADD COLUMN IF NOT EXISTS urgente BOOLEAN DEFAULT FALSE
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS requests (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            tipo TEXT NOT NULL,
            descricao TEXT NOT NULL,
            urgente BOOLEAN DEFAULT FALSE,
            status TEXT DEFAULT 'pendente',
            resposta TEXT DEFAULT '',
            respondido_em TEXT DEFAULT ''
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS production_schedule (
            id TEXT PRIMARY KEY,
            employee_name TEXT NOT NULL,
            week_start DATE NOT NULL,
            mon TEXT DEFAULT '',
            tue TEXT DEFAULT '',
            wed TEXT DEFAULT '',
            thu TEXT DEFAULT '',
            fri TEXT DEFAULT '',
            CONSTRAINT uq_emp_week UNIQUE (employee_name, week_start)
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS special_orders (
            id TEXT PRIMARY KEY,
            produto TEXT NOT NULL,
            cliente TEXT NOT NULL,
            quantidade INTEGER NOT NULL,
            urgente BOOLEAN DEFAULT FALSE,
            concluido BOOLEAN DEFAULT FALSE,
            concluido_por TEXT DEFAULT '',
            concluido_em TEXT DEFAULT '',
            criado_em TEXT NOT NULL,
            data_entrega TEXT DEFAULT '',
            quantidade_produzida INTEGER DEFAULT 0
        )
    ''')
    # Migrações para bancos já existentes
    cur.execute("ALTER TABLE special_orders ADD COLUMN IF NOT EXISTS data_entrega TEXT DEFAULT ''")
    cur.execute("ALTER TABLE special_orders ADD COLUMN IF NOT EXISTS quantidade_produzida INTEGER DEFAULT 0")
    # ── Melhorias e Reclamações ──────────────────────────────────────────────
    cur.execute('''
        CREATE TABLE IF NOT EXISTS melhorias (
            id TEXT PRIMARY KEY,
            tipo TEXT NOT NULL,
            responsavel TEXT NOT NULL,
            descricao TEXT NOT NULL,
            status TEXT DEFAULT 'pendente',
            created_at TEXT NOT NULL,
            concluido_em TEXT DEFAULT ''
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS melhorias_comentarios (
            id TEXT PRIMARY KEY,
            melhoria_id TEXT NOT NULL REFERENCES melhorias(id) ON DELETE CASCADE,
            texto TEXT NOT NULL,
            is_conclusao BOOLEAN DEFAULT FALSE,
            created_at TEXT NOT NULL
        )
    ''')
    conn.commit()
    cur.close()
    conn.close()

# Cria / migra tabelas na primeira vez que o app sobe
try:
    init_db()
except Exception as e:
    print(f"[init_db] Aviso: {e}")

def next_monday_date():
    """Retorna a segunda-feira da semana atual (SP).
    Se hoje já for segunda, retorna hoje mesmo."""
    today = now_sp().date()
    days_since_monday = today.weekday()  # 0=Seg, 6=Dom
    return today - timedelta(days=days_since_monday)

def get_tasks(date_str):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT * FROM tasks WHERE date = %s ORDER BY id', (date_str,))
    tasks = [dict(t) for t in cur.fetchall()]
    cur.close()
    conn.close()
    return tasks

# ── Login ──────────────────────────────────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not sessao_valida(session):
            session.clear()
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'GET' and sessao_valida(session):
        return redirect(url_for('admin_view'))
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '')
        password = request.form.get('password', '')
        usuario = autenticar(username, password)
        if usuario:
            session.clear()
            session['usuario_id'] = usuario
            session['credencial_versao'] = versao_credencial(os.environ[variavel_hash(usuario)])
            session.permanent = True
            return redirect(url_for('admin_view'))
        else:
            error = 'Usuário ou senha incorretos. Tente novamente.'
    return render_template('login.html', error=error)

@app.route('/admin/logout')
def admin_logout():
    session.clear()
    return redirect(url_for('admin_login'))

# ── Trabalhador — Hub ──────────────────────────────────────────────────────────
@app.route('/')
def worker_hub():
    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT COUNT(*) as cnt FROM special_orders WHERE concluido = FALSE")
        pedidos_row = cur.fetchone()
        cur.execute("SELECT COUNT(*) as cnt FROM requests WHERE status = 'pendente'")
        solicitacoes_row = cur.fetchone()
        cur.close()
        conn.close()
        pedidos_pendentes_count = pedidos_row['cnt'] if pedidos_row else 0
        solicitacoes_pendentes_count = solicitacoes_row['cnt'] if solicitacoes_row else 0
    except Exception:
        pedidos_pendentes_count = 0
        solicitacoes_pendentes_count = 0
    return render_template('worker_hub.html',
                           pedidos_pendentes_count=pedidos_pendentes_count,
                           solicitacoes_pendentes_count=solicitacoes_pendentes_count)

# ── Trabalhador — Produção por Semana ─────────────────────────────────────────
@app.route('/producao')
def worker_view():
    default_week = next_monday_date().isoformat()
    return render_template('worker_producaosemanal.html', default_week=default_week)

@app.route('/worker/update', methods=['POST'])
def worker_update():
    data = request.json
    concluido_em = ''
    if data.get('concluido'):
        concluido_em = now_sp().strftime('%H:%M')
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'UPDATE tasks SET concluido=%s, assinatura=%s, concluido_em=%s '
        'WHERE id=%s AND date=%s',
        (data['concluido'], data.get('assinatura', ''), concluido_em,
         data['id'], data['date'])
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'concluido_em': concluido_em})

# ── Trabalhador — Solicitações ─────────────────────────────────────────────────
@app.route('/requests')
def requests_view():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM requests ORDER BY created_at DESC")
    reqs = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    pendentes = [r for r in reqs if r['status'] == 'pendente']
    concluidas = [r for r in reqs if r['status'] == 'concluida']
    return render_template('worker_solicitacoes.html', pendentes=pendentes, concluidas=concluidas)

@app.route('/requests/add', methods=['POST'])
def requests_add():
    data = request.json
    req = {
        'id': str(uuid.uuid4()),
        'created_at': now_sp_str(),
        'tipo': data.get('tipo', 'outro'),
        'descricao': data.get('descricao', '').strip(),
        'urgente': bool(data.get('urgente', False)),
        'status': 'pendente',
        'resposta': '',
        'respondido_em': ''
    }
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO requests (id, created_at, tipo, descricao, urgente, status, resposta, respondido_em) '
        'VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
        (req['id'], req['created_at'], req['tipo'], req['descricao'],
         req['urgente'], req['status'], req['resposta'], req['respondido_em'])
    )
    conn.commit()
    cur.close()
    conn.close()

    # Notificação por e-mail (erro silencioso — não interrompe a resposta)
    try:
        send_email_notificacao(req)
    except Exception as e:
        print(f"[email] Erro inesperado na notificação: {e}")

    return jsonify({'success': True, 'request': req})

@app.route('/requests/<req_id>/editar', methods=['POST'])
def worker_requests_editar(req_id):
    """Permite que o trabalhador edite uma solicitação ainda pendente."""
    data = request.json
    tipo      = data.get('tipo', 'outro')
    descricao = (data.get('descricao') or '').strip()
    urgente   = bool(data.get('urgente', False))
    if not descricao:
        return jsonify({'success': False, 'error': 'Descrição vazia'}), 400
    conn = get_db()
    cur = conn.cursor()
    # Só edita se ainda estiver pendente
    cur.execute(
        "UPDATE requests SET tipo=%s, descricao=%s, urgente=%s WHERE id=%s AND status='pendente'",
        (tipo, descricao, urgente, req_id)
    )
    updated = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    if updated == 0:
        return jsonify({'success': False, 'error': 'Não encontrado ou já concluído'}), 404
    return jsonify({'success': True})

# ── Trabalhador — Pedidos Especiais ───────────────────────────────────────────
@app.route('/pedidos')
def worker_pedidos_view():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM special_orders ORDER BY cliente, criado_em")
    orders = [dict(o) for o in cur.fetchall()]
    cur.close()
    conn.close()

    pendentes = [o for o in orders if not o['concluido']]
    concluidos = sorted([o for o in orders if o['concluido']],
                        key=lambda o: o['concluido_em'], reverse=True)

    # Agrupa por cliente (normalizado), mantendo ordem por nome
    pendentes_sorted = sorted(pendentes, key=lambda o: (o['cliente'].strip().lower(), o.get('criado_em', '')))
    grupos_dict = {}
    for o in pendentes_sorted:
        key = o['cliente'].strip().lower()
        if key not in grupos_dict:
            grupos_dict[key] = {'cliente': o['cliente'].strip(), 'produtos': []}
        grupos_dict[key]['produtos'].append(o)

    # Cliente é urgente se qualquer produto dele for urgente
    urgentes_clientes = sorted(
        [g for g in grupos_dict.values() if any(p['urgente'] for p in g['produtos'])],
        key=lambda g: g['cliente'].lower()
    )
    normais_clientes = sorted(
        [g for g in grupos_dict.values() if not any(p['urgente'] for p in g['produtos'])],
        key=lambda g: g['cliente'].lower()
    )

    return render_template('worker_pedidosespeciais.html',
                           urgentes_clientes=urgentes_clientes,
                           normais_clientes=normais_clientes,
                           concluidos=concluidos,
                           total_pendentes=len(pendentes),
                           total_concluidos=len(concluidos))

@app.route('/pedidos/<order_id>/concluir', methods=['POST'])
def worker_pedidos_concluir(order_id):
    data = request.json
    nome = data.get('nome', '').strip() or 'Trabalhador'
    produzida_agora = int(data.get('quantidade_produzida', 0))

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT * FROM special_orders WHERE id=%s', (order_id,))
    order = cur.fetchone()
    cur.close()

    if not order:
        conn.close()
        return jsonify({'success': False, 'error': 'Pedido não encontrado'}), 404

    total_produzida = (order['quantidade_produzida'] or 0) + produzida_agora
    saldo_restante  = order['quantidade'] - total_produzida
    concluido_em    = now_sp_str()
    fully_done      = saldo_restante <= 0

    cur2 = conn.cursor()
    if fully_done:
        cur2.execute(
            'UPDATE special_orders SET concluido=%s, concluido_por=%s, concluido_em=%s, '
            'quantidade_produzida=%s WHERE id=%s',
            (True, nome, concluido_em, total_produzida, order_id)
        )
    else:
        cur2.execute(
            'UPDATE special_orders SET quantidade_produzida=%s, concluido_por=%s, '
            'concluido_em=%s WHERE id=%s',
            (total_produzida, nome, concluido_em, order_id)
        )
    conn.commit()
    cur2.close()
    conn.close()
    return jsonify({
        'success': True,
        'concluido': fully_done,
        'saldo_restante': max(0, saldo_restante),
        'concluido_em': concluido_em,
        'concluido_por': nome
    })

# ── Gestor / Admin — Hub ───────────────────────────────────────────────────────
@app.route('/admin')
@login_required
def admin_view():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT COUNT(*) as cnt FROM requests WHERE status = 'pendente'")
    row = cur.fetchone()
    pedidos_row = None
    try:
        cur.execute("SELECT COUNT(*) as cnt FROM special_orders WHERE concluido = FALSE")
        pedidos_row = cur.fetchone()
    except Exception:
        pass
    melhorias_count = 0
    try:
        cur.execute("SELECT COUNT(*) as cnt FROM melhorias WHERE status = 'pendente'")
        mel_row = cur.fetchone()
        melhorias_count = mel_row['cnt'] if mel_row else 0
    except Exception:
        pass
    cur.close()
    conn.close()
    pendentes_count = row['cnt'] if row else 0
    pedidos_pendentes_count = pedidos_row['cnt'] if pedidos_row else 0
    return render_template('admin_hub.html',
                           pendentes_count=pendentes_count,
                           pedidos_pendentes_count=pedidos_pendentes_count,
                           melhorias_pendentes_count=melhorias_count,
                           usuario_nome=USUARIOS[sessao_valida(session)])

# ── Gestor / Admin — Produção por Semana ──────────────────────────────────────
@app.route('/admin/producao')
@login_required
def admin_producao_view():
    default_week = next_monday_date().isoformat()
    return render_template('admin_producaosemanal.html', default_week=default_week)

# ── API — Produção: buscar semana ─────────────────────────────────────────────
@app.route('/api/producao-semana')
def api_producao_semana():
    week_start = request.args.get('week_start', '')
    if not week_start:
        week_start = next_monday_date().isoformat()
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(
        'SELECT * FROM production_schedule WHERE week_start=%s ORDER BY employee_name',
        (week_start,)
    )
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    for r in rows:
        if hasattr(r.get('week_start'), 'isoformat'):
            r['week_start'] = r['week_start'].isoformat()
    return jsonify(rows)

# ── Admin — Produção: salvar semana ───────────────────────────────────────────
@app.route('/admin/producao/salvar', methods=['POST'])
@login_required
def admin_producao_salvar():
    data = request.json
    week_start = data.get('week_start', '')
    employees  = data.get('employees', [])
    if not week_start or not employees:
        return jsonify({'success': False, 'error': 'Dados incompletos'}), 400
    conn = get_db()
    cur = conn.cursor()
    for emp in employees:
        name = (emp.get('name') or '').strip()
        if not name:
            continue
        mon = emp.get('mon', '') or ''
        tue = emp.get('tue', '') or ''
        wed = emp.get('wed', '') or ''
        thu = emp.get('thu', '') or ''
        fri = emp.get('fri', '') or ''
        cur.execute('''
            INSERT INTO production_schedule (id, employee_name, week_start, mon, tue, wed, thu, fri)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (employee_name, week_start)
            DO UPDATE SET mon=%s, tue=%s, wed=%s, thu=%s, fri=%s
        ''', (str(uuid.uuid4()), name, week_start, mon, tue, wed, thu, fri,
              mon, tue, wed, thu, fri))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'saved': len(employees)})

# ── Admin — Produção: remover funcionário da semana ──────────────────────────
@app.route('/admin/producao/remover', methods=['POST'])
@login_required
def admin_producao_remover():
    data = request.json
    name       = data.get('name', '').strip()
    week_start = data.get('week_start', '')
    if not name or not week_start:
        return jsonify({'success': False}), 400
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'DELETE FROM production_schedule WHERE employee_name=%s AND week_start=%s',
        (name, week_start)
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/add', methods=['POST'])
@login_required
def admin_add():
    data = request.json
    task = {
        'id': str(uuid.uuid4()),
        'date': data['date'],
        'produto': data['produto'].strip(),
        'quantidade': str(data['quantidade']),
        'concluido': False,
        'assinatura': '',
        'concluido_em': '',
        'urgente': bool(data.get('urgente', False))
    }
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO tasks (id, date, produto, quantidade, concluido, assinatura, concluido_em, urgente) '
        'VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
        (task['id'], task['date'], task['produto'], task['quantidade'],
         task['concluido'], task['assinatura'], task['concluido_em'], task['urgente'])
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'task': task})

@app.route('/admin/delete/<task_id>', methods=['DELETE'])
@login_required
def admin_delete(task_id):
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM tasks WHERE id=%s AND date=%s', (task_id, data['date']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/clear', methods=['POST'])
@login_required
def admin_clear():
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM tasks WHERE date=%s', (data['date'],))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/copy-yesterday', methods=['POST'])
@login_required
def admin_copy_yesterday():
    data = request.json
    today_str = data['date']
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(
        "SELECT DISTINCT date FROM tasks WHERE date < %s ORDER BY date DESC LIMIT 1",
        (today_str,)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        return jsonify({'success': False, 'message': 'Nenhum dia anterior com tarefas encontrado.'})
    last_date = row['date']
    last_tasks = get_tasks(last_date)
    if not last_tasks:
        return jsonify({'success': False, 'message': 'Nenhuma tarefa encontrada no último dia.'})
    conn = get_db()
    cur = conn.cursor()
    for t in last_tasks:
        cur.execute(
            'INSERT INTO tasks (id, date, produto, quantidade, concluido, assinatura, concluido_em, urgente) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
            (str(uuid.uuid4()), today_str, t['produto'], t['quantidade'],
             False, '', '', t.get('urgente', False))
        )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'copied_from': last_date})

# ── Gestor / Admin — Solicitações ─────────────────────────────────────────────
@app.route('/admin/requests')
@login_required
def admin_requests_view():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM requests ORDER BY created_at DESC")
    reqs = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    pendentes = [r for r in reqs if r['status'] == 'pendente']
    concluidas = [r for r in reqs if r['status'] == 'concluida']
    return render_template('admin_solicitacoes.html', pendentes=pendentes, concluidas=concluidas)

@app.route('/admin/requests/update', methods=['POST'])
@login_required
def admin_requests_update():
    data = request.json
    req_id = data['id']
    status = data.get('status', 'concluida')
    resp = data.get('resposta', '').strip()
    resp_em = now_sp_str() if status == 'concluida' else ''
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'UPDATE requests SET status=%s, resposta=%s, respondido_em=%s WHERE id=%s',
        (status, resp, resp_em, req_id)
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/requests/delete/<req_id>', methods=['DELETE'])
@login_required
def admin_requests_delete(req_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM requests WHERE id=%s', (req_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/requests/<req_id>/editar', methods=['POST'])
@login_required
def admin_requests_editar(req_id):
    data = request.json
    tipo     = data.get('tipo', 'outro')
    descricao = (data.get('descricao') or '').strip()
    urgente  = bool(data.get('urgente', False))
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'UPDATE requests SET tipo=%s, descricao=%s, urgente=%s WHERE id=%s',
        (tipo, descricao, urgente, req_id)
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ── Gestor / Admin — Pedidos Especiais ────────────────────────────────────────
@app.route('/admin/pedidos')
@login_required
def admin_pedidos_view():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM special_orders ORDER BY cliente, criado_em")
    orders = [dict(o) for o in cur.fetchall()]
    cur.close()
    conn.close()

    pendentes = [o for o in orders if not o['concluido']]
    concluidos = sorted([o for o in orders if o['concluido']],
                        key=lambda o: o['concluido_em'], reverse=True)

    # Agrupa por cliente (normalizado), mantendo ordem por nome
    pendentes_sorted = sorted(pendentes, key=lambda o: (o['cliente'].strip().lower(), o.get('criado_em', '')))
    grupos_dict = {}
    for o in pendentes_sorted:
        key = o['cliente'].strip().lower()
        if key not in grupos_dict:
            grupos_dict[key] = {'cliente': o['cliente'].strip(), 'produtos': []}
        grupos_dict[key]['produtos'].append(o)

    # Cliente é urgente se qualquer produto dele for urgente
    urgentes_clientes = sorted(
        [g for g in grupos_dict.values() if any(p['urgente'] for p in g['produtos'])],
        key=lambda g: g['cliente'].lower()
    )
    normais_clientes = sorted(
        [g for g in grupos_dict.values() if not any(p['urgente'] for p in g['produtos'])],
        key=lambda g: g['cliente'].lower()
    )

    return render_template('admin_pedidosespeciais.html',
                           urgentes_clientes=urgentes_clientes,
                           normais_clientes=normais_clientes,
                           concluidos=concluidos,
                           total_pendentes=len(pendentes),
                           total_concluidos=len(concluidos))

@app.route('/admin/pedidos/add', methods=['POST'])
@login_required
def admin_pedidos_add():
    data = request.json
    cliente = data.get('cliente', '').strip()
    produtos = data.get('produtos', [])

    if not cliente or not produtos:
        return jsonify({'success': False, 'error': 'Dados incompletos'}), 400

    conn = get_db()
    cur = conn.cursor()
    criado_em = now_sp_str()
    for p in produtos:
        cur.execute(
            'INSERT INTO special_orders '
            '(id, produto, cliente, quantidade, urgente, concluido, concluido_por, '
            'concluido_em, criado_em, data_entrega, quantidade_produzida) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
            (str(uuid.uuid4()), p['produto'].strip(), cliente,
             int(p['quantidade']), bool(p.get('urgente', False)),
             False, '', '', criado_em,
             p.get('data_entrega', '').strip(), 0)
        )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'count': len(produtos)})

@app.route('/admin/pedidos/<order_id>/editar', methods=['POST'])
@login_required
def admin_pedidos_editar(order_id):
    data = request.json
    cliente = (data.get('cliente') or '').strip()
    if not cliente:
        return jsonify({'success': False, 'error': 'Cliente vazio'}), 400
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'UPDATE special_orders SET cliente=%s, produto=%s, quantidade=%s, data_entrega=%s, urgente=%s WHERE id=%s',
        (cliente, data['produto'].strip(), int(data['quantidade']),
         data.get('data_entrega', '').strip(),
         bool(data.get('urgente', False)), order_id)
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/pedidos/<order_id>/concluir', methods=['POST'])
@login_required
def admin_pedidos_concluir(order_id):
    data = request.json or {}
    nome = data.get('nome', 'Gestor').strip() or 'Gestor'
    produzida_agora = int(data.get('quantidade_produzida', 0))

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT * FROM special_orders WHERE id=%s', (order_id,))
    order = cur.fetchone()
    cur.close()

    if not order:
        conn.close()
        return jsonify({'success': False}), 404

    total_produzida = (order['quantidade_produzida'] or 0) + produzida_agora
    saldo_restante  = order['quantidade'] - total_produzida
    concluido_em    = now_sp_str()
    fully_done      = saldo_restante <= 0

    cur2 = conn.cursor()
    if fully_done:
        cur2.execute(
            'UPDATE special_orders SET concluido=%s, concluido_por=%s, concluido_em=%s, '
            'quantidade_produzida=%s WHERE id=%s',
            (True, nome, concluido_em, total_produzida, order_id)
        )
    else:
        cur2.execute(
            'UPDATE special_orders SET quantidade_produzida=%s, concluido_por=%s, '
            'concluido_em=%s WHERE id=%s',
            (total_produzida, nome, concluido_em, order_id)
        )
    conn.commit()
    cur2.close()
    conn.close()
    return jsonify({
        'success': True,
        'concluido': fully_done,
        'saldo_restante': max(0, saldo_restante),
        'concluido_em': concluido_em
    })

@app.route('/admin/pedidos/<order_id>/reabrir', methods=['POST'])
@login_required
def admin_pedidos_reabrir(order_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'UPDATE special_orders SET concluido=%s, concluido_por=%s, '
        'concluido_em=%s, quantidade_produzida=%s WHERE id=%s',
        (False, '', '', 0, order_id)
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/pedidos/<order_id>/excluir', methods=['DELETE'])
@login_required
def admin_pedidos_excluir(order_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM special_orders WHERE id=%s', (order_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ── Gestor / Admin — Melhorias e Reclamações ──────────────────────────────────
def _get_melhorias_com_comentarios(conn, status):
    """Retorna lista de melhorias com status dado, incluindo comentários."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(
        "SELECT * FROM melhorias WHERE status=%s ORDER BY created_at DESC",
        (status,)
    )
    itens = [dict(m) for m in cur.fetchall()]
    cur.close()
    for item in itens:
        cur2 = conn.cursor(cursor_factory=RealDictCursor)
        cur2.execute(
            "SELECT * FROM melhorias_comentarios WHERE melhoria_id=%s ORDER BY created_at",
            (item['id'],)
        )
        item['comentarios'] = [dict(c) for c in cur2.fetchall()]
        cur2.close()
    return itens

@app.route('/admin/melhorias')
@login_required
def admin_melhorias_view():
    conn = get_db()
    pendentes  = _get_melhorias_com_comentarios(conn, 'pendente')
    concluidas = _get_melhorias_com_comentarios(conn, 'concluida')
    conn.close()
    return render_template('admin_melhorias.html',
                           pendentes=pendentes,
                           concluidas=concluidas)

@app.route('/admin/melhorias/add', methods=['POST'])
@login_required
def admin_melhorias_add():
    data = request.json
    responsavel = (data.get('responsavel') or '').strip()
    descricao   = (data.get('descricao') or '').strip()
    tipo        = data.get('tipo', 'melhoria')
    if not responsavel or not descricao:
        return jsonify({'success': False, 'error': 'Campos obrigatórios'}), 400
    item = {
        'id': str(uuid.uuid4()),
        'tipo': tipo,
        'responsavel': responsavel,
        'descricao': descricao,
        'status': 'pendente',
        'created_at': now_sp_str(),
        'concluido_em': ''
    }
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO melhorias (id, tipo, responsavel, descricao, status, created_at, concluido_em) '
        'VALUES (%s, %s, %s, %s, %s, %s, %s)',
        (item['id'], item['tipo'], item['responsavel'], item['descricao'],
         item['status'], item['created_at'], item['concluido_em'])
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'item': item})

@app.route('/admin/melhorias/<item_id>/comentar', methods=['POST'])
@login_required
def admin_melhorias_comentar(item_id):
    data  = request.json
    texto = (data.get('texto') or '').strip()
    if not texto:
        return jsonify({'success': False, 'error': 'Comentário vazio'}), 400
    comentario = {
        'id': str(uuid.uuid4()),
        'melhoria_id': item_id,
        'texto': texto,
        'is_conclusao': False,
        'created_at': now_sp_str()
    }
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO melhorias_comentarios (id, melhoria_id, texto, is_conclusao, created_at) '
        'VALUES (%s, %s, %s, %s, %s)',
        (comentario['id'], comentario['melhoria_id'], comentario['texto'],
         comentario['is_conclusao'], comentario['created_at'])
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'comentario': comentario})

@app.route('/admin/melhorias/<item_id>/concluir', methods=['POST'])
@login_required
def admin_melhorias_concluir(item_id):
    data       = request.json
    comentario = (data.get('comentario') or '').strip()
    if not comentario:
        return jsonify({'success': False, 'error': 'Comentário de conclusão obrigatório'}), 400
    concluido_em = now_sp_str()
    conn = get_db()
    cur  = conn.cursor()
    # Atualiza status da melhoria
    cur.execute(
        "UPDATE melhorias SET status='concluida', concluido_em=%s WHERE id=%s",
        (concluido_em, item_id)
    )
    # Insere comentário de conclusão marcado
    cur.execute(
        'INSERT INTO melhorias_comentarios (id, melhoria_id, texto, is_conclusao, created_at) '
        'VALUES (%s, %s, %s, %s, %s)',
        (str(uuid.uuid4()), item_id, comentario, True, concluido_em)
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/melhorias/delete/<item_id>', methods=['DELETE'])
@login_required
def admin_melhorias_delete(item_id):
    conn = get_db()
    cur  = conn.cursor()
    cur.execute('DELETE FROM melhorias WHERE id=%s', (item_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ── API ────────────────────────────────────────────────────────────────────────
@app.route('/api/tasks')
def api_tasks():
    date_str = request.args.get('date', today_sp())
    return jsonify(get_tasks(date_str))


# ══════════════════════════════════════════════════════════════════════════════
# Carteira de clientes — análise de vendas e CRM
# ══════════════════════════════════════════════════════════════════════════════
import json as _json
from datetime import date as _date
import carteira


def init_carteira_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS carteira_vendas (
            id SERIAL PRIMARY KEY,
            data DATE NOT NULL,
            cliente TEXT NOT NULL,
            valor NUMERIC(14,2) NOT NULL
        )''')
    cur.execute('CREATE INDEX IF NOT EXISTS ix_carteira_vendas_cliente ON carteira_vendas(cliente)')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS carteira_alias (
            apelido  TEXT PRIMARY KEY,
            canonico TEXT NOT NULL
        )''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS carteira_ficha (
            cliente_id   TEXT PRIMARY KEY,
            cliente_nome TEXT,
            cidade       TEXT DEFAULT '',
            estado       TEXT DEFAULT '',
            situacao     TEXT DEFAULT 'ativo',
            motivo       TEXT DEFAULT '',
            atuacao      TEXT DEFAULT '',
            obs          TEXT DEFAULT '',
            dispensa     BOOLEAN DEFAULT FALSE,
            cadencia     INTEGER,
            tipo         TEXT DEFAULT 'carteira',
            classe_manual TEXT DEFAULT '',
            prioridade   BOOLEAN DEFAULT FALSE,
            atualizado_em TEXT
        )''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS carteira_interacao (
            id         TEXT PRIMARY KEY,
            cliente_id TEXT NOT NULL,
            data       DATE NOT NULL,
            tipo       TEXT,
            resumo     TEXT,
            criado_em  TEXT
        )''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS carteira_tarefa (
            id         TEXT PRIMARY KEY,
            cliente_id TEXT NOT NULL,
            titulo     TEXT NOT NULL,
            prazo      DATE,
            feita      BOOLEAN DEFAULT FALSE,
            criado_em  TEXT
        )''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS carteira_lead (
            id          TEXT PRIMARY KEY,
            nome        TEXT NOT NULL,
            cidade      TEXT DEFAULT '',
            uf          TEXT DEFAULT '',
            contato     TEXT DEFAULT '',
            telefone    TEXT DEFAULT '',
            email       TEXT DEFAULT '',
            etapa       TEXT DEFAULT 'novo',
            motivo      TEXT DEFAULT '',
            obs         TEXT DEFAULT '',
            proximo     TEXT DEFAULT '',
            proximo_em  DATE,
            cliente_id  TEXT DEFAULT '',
            segmento    TEXT DEFAULT '',
            instagram   TEXT DEFAULT '',
            revenda     BOOLEAN DEFAULT FALSE,
            revenda_de  TEXT DEFAULT '',
            origem_arq  TEXT DEFAULT '',
            criado_em   TEXT,
            atualizado_em TEXT
        )''')
    cur.execute('CREATE INDEX IF NOT EXISTS ix_carteira_lead_etapa ON carteira_lead(etapa)')
    # Migração aditiva: conserva cadastros e históricos já existentes.
    for coluna in ('contato', 'telefone', 'email', 'responsavel', 'responsavel_usuario'):
        cur.execute("ALTER TABLE carteira_ficha ADD COLUMN IF NOT EXISTS " + coluna + " TEXT DEFAULT ''")
    cur.execute("ALTER TABLE carteira_interacao ADD COLUMN IF NOT EXISTS resultado TEXT DEFAULT ''")
    cur.execute("ALTER TABLE carteira_interacao ADD COLUMN IF NOT EXISTS responsavel TEXT DEFAULT ''")
    cur.execute("ALTER TABLE carteira_interacao ADD COLUMN IF NOT EXISTS usuario_id TEXT DEFAULT ''")
    cur.execute("ALTER TABLE carteira_tarefa ADD COLUMN IF NOT EXISTS responsavel TEXT DEFAULT ''")
    cur.execute("ALTER TABLE carteira_tarefa ADD COLUMN IF NOT EXISTS concluido_em DATE")
    cur.execute("ALTER TABLE carteira_lead ADD COLUMN IF NOT EXISTS responsavel_usuario TEXT DEFAULT ''")

    for coluna, tipo in (('segmento', "TEXT DEFAULT ''"), ('instagram', "TEXT DEFAULT ''"),
                         ('revenda', 'BOOLEAN DEFAULT FALSE'), ('revenda_de', "TEXT DEFAULT ''")):
        cur.execute('ALTER TABLE carteira_lead ADD COLUMN IF NOT EXISTS %s %s' % (coluna, tipo))
    cur.execute('CREATE TABLE IF NOT EXISTS carteira_config (chave TEXT PRIMARY KEY, valor TEXT)')
    # migracao de bancos que nasceram antes destes campos
    for coluna, tipo in (('atuacao', "TEXT DEFAULT ''"), ('motivo', "TEXT DEFAULT ''"),
                         ('dispensa', 'BOOLEAN DEFAULT FALSE'), ('cadencia', 'INTEGER'),
                         ('tipo', "TEXT DEFAULT 'carteira'"),
                         ('classe_manual', "TEXT DEFAULT ''"),
                         ('prioridade', 'BOOLEAN DEFAULT FALSE')):
        cur.execute('ALTER TABLE carteira_ficha ADD COLUMN IF NOT EXISTS %s %s' % (coluna, tipo))
    cur.execute("ALTER TABLE carteira_ficha DROP COLUMN IF EXISTS motivo_tipo")
    # a mesma nota nunca entra duas vezes
    cur.execute('CREATE INDEX IF NOT EXISTS ix_carteira_vendas_nota '
                'ON carteira_vendas(data, cliente, valor)')
    conn.commit()

    # Unificações que o Fernando já decidiu, aplicadas uma única vez. O marcador
    # em carteira_config garante que desfazer uma delas depois não seja
    # revertido pelo próximo deploy.
    cur.execute("SELECT 1 FROM carteira_config WHERE chave = 'seed_aliases_v1'")
    if not cur.fetchone():
        iniciais = [
            ('DISTRIBUIDORA DE FOGOS CIENFUEGOS', 'FOGOS MANIA'),
            ('IL DISTRIBUIÇÃO DE FOGOS LTDA', 'IL DISTRIBUIÇÃO DE FOGOS'),
            ('ARTESANATO DE FOGOS CINCO ESTRELAS LTDA', 'IL DISTRIBUIÇÃO DE FOGOS'),
            ('RICARDO NELSON DALSASSO ME', 'FOGOS DALSASSO'),
            ('REGES GERALDO DE LISBOA', 'FOGOS OURO FINO'),
            ('FOGOS OURO FINO (REGES LISBOA)', 'FOGOS OURO FINO'),
        ]
        cur.executemany('INSERT INTO carteira_alias (apelido, canonico) VALUES (%s,%s) '
                        'ON CONFLICT (apelido) DO NOTHING', iniciais)
        cur.execute("INSERT INTO carteira_config (chave, valor) VALUES ('seed_aliases_v1','1')")
        conn.commit()

    cur.close()
    conn.close()


try:
    init_carteira_db()
except Exception as e:
    print(f"[init_carteira_db] Aviso: {e}")


def _carteira_dados():
    """Monta o payload completo do painel a partir do banco."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute('SELECT data, cliente, valor FROM carteira_vendas ORDER BY data')
    linhas = [(r['data'], r['cliente'], float(r['valor'])) for r in cur.fetchall()]

    cur.execute('SELECT apelido, canonico FROM carteira_alias')
    aliases = {r['apelido']: r['canonico'] for r in cur.fetchall()}

    cur.execute('SELECT * FROM carteira_ficha')
    fichas = {}
    for r in cur.fetchall():
        f = dict(r)
        f['atuacao'] = [x for x in (f.get('atuacao') or '').split(',') if x]
        fichas[f['cliente_id']] = f

    cur.execute('SELECT * FROM carteira_interacao ORDER BY data DESC, criado_em DESC, id DESC')
    inter = [{'id': r['id'], 'cliente': r['cliente_id'], 'data': r['data'].isoformat(),
              'tipo': r['tipo'] or '', 'resumo': r['resumo'] or '',
              'resultado': r['resultado'] or '', 'responsavel': r['responsavel'] or '',
              'usuario_id': r['usuario_id'] or ''}
             for r in cur.fetchall()]

    # ultimo contato de cada cliente: e o que move a rotina de 15/30 dias
    cur.execute("SELECT cliente_id, MAX(data) AS ultimo FROM carteira_interacao "
                "WHERE COALESCE(resultado, '') <> 'sem_resposta' AND COALESCE(tipo, '') <> 'tarefa' "
                "GROUP BY cliente_id")
    contatos = {r['cliente_id']: r['ultimo'] for r in cur.fetchall() if r['ultimo']}

    cur.execute('SELECT * FROM carteira_tarefa')
    tarefas = [{'id': r['id'], 'cliente': r['cliente_id'], 'titulo': r['titulo'],
                'prazo': r['prazo'].isoformat() if r['prazo'] else '',
                'feita': bool(r['feita']), 'responsavel': r['responsavel'] or '',
                'concluido_em': r['concluido_em'].isoformat() if r['concluido_em'] else ''}
               for r in cur.fetchall()]

    cur.execute('SELECT * FROM carteira_lead ORDER BY nome')
    leads = []
    for r in cur.fetchall():
        L = dict(r)
        L['proximo_em'] = L['proximo_em'].isoformat() if L['proximo_em'] else ''
        leads.append(L)

    cur.execute("SELECT valor FROM carteira_config WHERE chave='ultima_importacao'")
    imp = cur.fetchone()
    ultima_importacao = imp['valor'] if imp else None
    cur.close()
    conn.close()

    hoje = _date.fromisoformat(today_sp())
    for lead in leads:
        cid = lead.get('cliente_id')
        ultima = contatos.get(lead['id'])
        if cid and ultima and (cid not in contatos or ultima > contatos[cid]):
            contatos[cid] = ultima
    retornos = carteira.retornos_pendentes(tarefas, leads)
    dados = carteira.calcular(linhas, aliases, fichas, contatos, hoje, retornos)
    if dados:
        dados['meta']['ultima_importacao'] = ultima_importacao
    prospec = carteira.analisar_leads(leads, dados, hoje)
    pessoal = carteira.visao_pessoal(dados, leads, tarefas, inter,
                                     sessao_valida(session), hoje.isoformat())
    return dados, fichas, inter, tarefas, aliases, prospec, pessoal


@app.route('/admin/carteira')
@login_required
def admin_carteira_view():
    dados, fichas, inter, tarefas, aliases, prospec, pessoal = _carteira_dados()
    candidatos = carteira.candidatos_unificacao(dados) if dados else []
    return render_template(
        'admin_carteira.html',
        dados_json=_json.dumps(dados, default=str, ensure_ascii=False) if dados else 'null',
        fichas_json=_json.dumps(fichas, default=str, ensure_ascii=False),
        inter_json=_json.dumps(inter, ensure_ascii=False),
        tarefas_json=_json.dumps(tarefas, ensure_ascii=False),
        aliases_json=_json.dumps(aliases, ensure_ascii=False),
        candidatos_json=_json.dumps(candidatos, ensure_ascii=False),
        prospec_json=_json.dumps(prospec, default=str, ensure_ascii=False),
        pessoal_json=_json.dumps(pessoal, ensure_ascii=False),
        etapas_json=_json.dumps(carteira.ETAPAS, ensure_ascii=False),
        regioes_json=_json.dumps([[k, v[0], v[1]] for k, v in carteira.REGIOES.items()], ensure_ascii=False),
        hoje=today_sp(),
        usuario_id=sessao_valida(session),
        usuario_nome=USUARIOS[sessao_valida(session)],
    )


@app.route('/admin/carteira/dados')
@login_required
def admin_carteira_dados():
    """O mesmo conteudo que o template embute, em JSON.

    Serve para a pagina se atualizar sozinha depois de uma gravacao, em vez de
    recarregar. Recarregar custava a posicao da rolagem, a ficha aberta e a aba
    em que a pessoa estava, tres vezes a cada cliente editado.
    """
    dados, fichas, inter, tarefas, aliases, prospec, pessoal = _carteira_dados()
    return jsonify({
        'success': True,
        'dados': dados,
        'fichas': fichas,
        'inter': inter,
        'tarefas': tarefas,
        'aliases': aliases,
        'prospec': prospec,
        'pessoal': pessoal,
        'candidatos': carteira.candidatos_unificacao(dados) if dados else [],
    })


@app.route('/admin/carteira/cliente/<cliente_id>/pedidos')
@login_required
def admin_carteira_pedidos(cliente_id):
    """Vendas importadas e pedidos especiais ligados a este cliente ou seus apelidos."""
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute('SELECT DISTINCT COALESCE(a.canonico, v.cliente) '
                    'FROM carteira_vendas v LEFT JOIN carteira_alias a ON a.apelido=v.cliente')
        nomes = {carteira.id_cliente(nome): nome for (nome,) in cur.fetchall()}
        nome = nomes.get(cliente_id)
        if not nome:
            return jsonify({'success': False, 'erro': 'Cliente não encontrado.'}), 404
        cur.execute('SELECT v.data, v.valor FROM carteira_vendas v '
                    'LEFT JOIN carteira_alias a ON a.apelido=v.cliente '
                    'WHERE COALESCE(a.canonico, v.cliente)=%s '
                    'ORDER BY v.data DESC, v.valor DESC', (nome,))
        pedidos = carteira.historico_pedidos(cur.fetchall())
        cur.execute('SELECT apelido FROM carteira_alias WHERE canonico=%s', (nome,))
        nomes_cliente = {carteira.normalizar(x) for x in [nome] + [r[0] for r in cur.fetchall()]}
        cur.execute('SELECT cliente, produto, quantidade, urgente, concluido, criado_em, '
                    'data_entrega FROM special_orders ORDER BY criado_em DESC')
        especiais = [dict(cliente=r[0], produto=r[1], quantidade=r[2],
                          urgente=bool(r[3]), concluido=bool(r[4]),
                          criado_em=r[5], data_entrega=r[6] or '')
                     for r in cur.fetchall() if carteira.normalizar(r[0]) in nomes_cliente]
    finally:
        cur.close()
        conn.close()
    return jsonify({'success': True, 'pedidos': pedidos,
                    'total_pedidos': len(pedidos),
                    'total_lancamentos': sum(p['registros'] for p in pedidos),
                    'pedidos_especiais': especiais})


def _ler_upload(arq):
    bruto = arq.read()
    for cod in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            return carteira.ler_csv(bruto.decode(cod))
        except UnicodeDecodeError:
            continue
    return None, ['arquivo ilegivel: salve como CSV UTF-8']


def _diferenca(cur, linhas):
    """O que do arquivo ainda nao esta no banco.

    Conta quantas vezes cada nota (data, cliente, valor) ja existe e so
    considera novo o que passar dessa contagem. Assim reenviar o historico
    inteiro nao duplica nada, e duas vendas legitimamente iguais no mesmo dia
    continuam valendo as duas.
    """
    from collections import Counter
    cur.execute('SELECT data, cliente, valor, COUNT(*) FROM carteira_vendas GROUP BY 1,2,3')
    existe = {(r[0], r[1], round(float(r[2]), 2)): r[3] for r in cur.fetchall()}
    chegando = Counter((d, n, round(v, 2)) for d, n, v in linhas)
    novas = []
    for (d, n, v), qtd in chegando.items():
        faltam = qtd - existe.get((d, n, v), 0)
        novas.extend([(d, n, v)] * max(0, faltam))
    novas.sort()
    return novas


@app.route('/admin/carteira/previa', methods=['POST'])
@login_required
def admin_carteira_previa():
    arq = request.files.get('arquivo')
    if not arq or not arq.filename:
        return jsonify({'success': False, 'erro': 'Nenhum arquivo foi enviado.'}), 400
    linhas, erros = _ler_upload(arq)
    if not linhas:
        return jsonify({'success': False, 'erro': 'Nenhuma linha valida. Esperado: Data;Nome;Valor.',
                        'detalhes': erros[:10]}), 400
    conn = get_db()
    cur = conn.cursor()
    novas = _diferenca(cur, linhas)
    cur.execute('SELECT COUNT(*), MIN(data), MAX(data) FROM carteira_vendas')
    qtd, d0, d1 = cur.fetchone()
    cur.close()
    conn.close()
    nomes_novos = sorted({n for _, n, _ in novas})
    return jsonify({'success': True,
                    'no_arquivo': len(linhas), 'novas': len(novas),
                    'repetidas': len(linhas) - len(novas),
                    'ja_no_banco': qtd,
                    'periodo_banco': [str(d0), str(d1)] if d0 else None,
                    'periodo_novas': [str(novas[0][0]), str(novas[-1][0])] if novas else None,
                    'valor_novas': round(sum(v for _, _, v in novas), 2),
                    'clientes_novos': nomes_novos[:20],
                    'qtd_clientes_novos': len(nomes_novos),
                    'ignoradas': len(erros), 'detalhes': erros[:10]})


@app.route('/admin/carteira/upload', methods=['POST'])
@login_required
def admin_carteira_upload():
    arq = request.files.get('arquivo')
    if not arq or not arq.filename:
        return jsonify({'success': False, 'erro': 'Nenhum arquivo foi enviado.'}), 400
    linhas, erros = _ler_upload(arq)
    if not linhas:
        return jsonify({'success': False, 'erro': 'Nenhuma linha valida. Esperado: Data;Nome;Valor.',
                        'detalhes': erros[:10]}), 400
    conn = get_db()
    cur = conn.cursor()
    novas = _diferenca(cur, linhas)
    if novas:
        cur.executemany('INSERT INTO carteira_vendas (data, cliente, valor) VALUES (%s,%s,%s)', novas)
    cur.execute("INSERT INTO carteira_config (chave, valor) VALUES ('ultima_importacao', %s) "
                "ON CONFLICT (chave) DO UPDATE SET valor=EXCLUDED.valor", (now_sp_str(),))
    conn.commit()
    cur.execute('SELECT COUNT(*) FROM carteira_vendas')
    total = cur.fetchone()[0]
    cur.close()
    conn.close()
    return jsonify({'success': True, 'novas': len(novas),
                    'repetidas': len(linhas) - len(novas), 'total': total,
                    'ignoradas': len(erros), 'detalhes': erros[:10]})


@app.route('/admin/carteira/ficha', methods=['POST'])
@login_required
def admin_carteira_ficha():
    d = request.get_json(silent=True) or {}
    cid = (d.get('cliente_id') or '').strip()
    if not cid:
        return jsonify({'success': False, 'erro': 'cliente_id ausente'}), 400
    dono = str(d.get('responsavel_usuario') or '').strip() if 'responsavel_usuario' in d else None
    if dono is not None and dono not in ('', *USUARIOS):
        return jsonify({'success': False, 'erro': 'Escolha um responsável válido.'}), 400
    situacao = d.get('situacao') or 'ativo'
    if situacao not in ('ativo', 'pausado', 'perdido'):
        situacao = 'ativo'
    conn = get_db()
    cur = conn.cursor()
    at = d.get('atuacao') or []
    if isinstance(at, str):
        at = [x for x in at.replace(';', ',').split(',') if x.strip()]
    at = ','.join(sorted({str(x).strip().upper() for x in at
                          if str(x).strip().upper() in carteira.REGIOES
                          or str(x).strip().upper() in carteira.REGIAO_DA_UF}))
    try:
        cad = int(d.get('cadencia') or 0)
    except (TypeError, ValueError):
        cad = 0
    cad = cad if 1 <= cad <= 365 else None
    tipo = d.get('tipo') or 'carteira'
    if tipo not in carteira.TIPOS:
        tipo = 'carteira'
    # Classificacao a mao: vazio devolve o cliente para o criterio automatico.
    cman = (d.get('classe_manual') or '').strip()
    if cman not in carteira.MOTIVO_ROTULO:
        cman = ''
    cur.execute('''
        INSERT INTO carteira_ficha
            (cliente_id, cliente_nome, cidade, estado, situacao, motivo, atuacao, obs,
             dispensa, cadencia, tipo, classe_manual, prioridade, atualizado_em)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (cliente_id) DO UPDATE SET
            cliente_nome=EXCLUDED.cliente_nome, cidade=EXCLUDED.cidade,
            estado=EXCLUDED.estado, situacao=EXCLUDED.situacao,
            motivo=EXCLUDED.motivo, atuacao=EXCLUDED.atuacao,
            obs=EXCLUDED.obs, dispensa=EXCLUDED.dispensa, cadencia=EXCLUDED.cadencia,
            tipo=EXCLUDED.tipo, classe_manual=EXCLUDED.classe_manual,
            prioridade=EXCLUDED.prioridade, atualizado_em=EXCLUDED.atualizado_em
    ''', (cid, (d.get('cliente_nome') or '')[:200], (d.get('cidade') or '')[:120],
          (d.get('estado') or '')[:2].upper(), situacao,
          (d.get('motivo') or '')[:1000], at,
          (d.get('obs') or '')[:2000], bool(d.get('dispensa')), cad,
          tipo, cman, bool(d.get('prioridade')), now_sp_str()))
    for campo, limite in (('contato', 120), ('telefone', 40), ('email', 160), ('responsavel', 120)):
        if campo in d:
            cur.execute('UPDATE carteira_ficha SET ' + campo + '=%s WHERE cliente_id=%s',
                        (str(d.get(campo) or '').strip()[:limite], cid))
    if dono is not None:
        cur.execute('UPDATE carteira_ficha SET responsavel_usuario=%s WHERE cliente_id=%s', (dono, cid))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})


@app.route('/admin/carteira/atribuir', methods=['POST'])
@login_required
def admin_carteira_atribuir():
    """Distribui clientes existentes; vazios continuam na fila de distribuição."""
    d = request.get_json(silent=True) or {}
    ids = list(dict.fromkeys(str(x).strip() for x in (d.get('ids') or []) if str(x).strip()))
    dono = str(d.get('responsavel_usuario') or '').strip()
    if not ids or len(ids) > 500:
        return jsonify({'success': False, 'erro': 'Selecione de 1 a 500 clientes.'}), 400
    if dono not in ('', *USUARIOS):
        return jsonify({'success': False, 'erro': 'Escolha um responsável válido.'}), 400
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute('SELECT DISTINCT COALESCE(a.canonico, v.cliente) '
                    'FROM carteira_vendas v LEFT JOIN carteira_alias a ON a.apelido=v.cliente')
        clientes = {carteira.id_cliente(nome): nome for (nome,) in cur.fetchall()}
        if any(cid not in clientes for cid in ids):
            return jsonify({'success': False, 'erro': 'A lista contém cliente desconhecido. Atualize a página.'}), 400
        for cid in ids:
            cur.execute('''
                INSERT INTO carteira_ficha (cliente_id, cliente_nome, responsavel_usuario, atualizado_em)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT (cliente_id) DO UPDATE SET
                    responsavel_usuario=EXCLUDED.responsavel_usuario,
                    atualizado_em=EXCLUDED.atualizado_em
            ''', (cid, clientes[cid][:200], dono, now_sp_str()))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
    return jsonify({'success': True, 'gravados': len(ids)})


@app.route('/admin/carteira/fichas-lote', methods=['POST'])
@login_required
def admin_carteira_fichas_lote():
    itens = (request.get_json(silent=True) or {}).get('itens') or []
    if not itens:
        return jsonify({'success': False, 'erro': 'nada para gravar'}), 400
    conn = get_db()
    cur = conn.cursor()
    n = 0
    for it in itens[:1000]:
        cid = (it.get('cliente_id') or '').strip()
        if not cid:
            continue
        cur.execute('''
            INSERT INTO carteira_ficha (cliente_id, cliente_nome, cidade, estado, atualizado_em)
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (cliente_id) DO UPDATE SET
                cidade=EXCLUDED.cidade, estado=EXCLUDED.estado,
                atualizado_em=EXCLUDED.atualizado_em
        ''', (cid, (it.get('cliente_nome') or '')[:200], (it.get('cidade') or '')[:120],
              (it.get('estado') or '')[:2].upper(), now_sp_str()))
        n += 1
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'gravados': n})


@app.route('/admin/carteira/atuacao-lote', methods=['POST'])
@login_required
def admin_carteira_atuacao_lote():
    d = request.get_json(silent=True) or {}
    ids = [str(x).strip() for x in (d.get('ids') or []) if str(x).strip()]
    modo = d.get('modo') or 'substituir'
    validos = sorted({str(x).strip().upper() for x in (d.get('atuacao') or [])
                      if str(x).strip().upper() in carteira.REGIOES
                      or str(x).strip().upper() in carteira.REGIAO_DA_UF})
    if not ids:
        return jsonify({'success': False, 'erro': 'nenhum cliente selecionado'}), 400
    nomes = d.get('nomes') or {}
    conn = get_db()
    cur = conn.cursor()
    n = 0
    for cid in ids[:500]:
        atual = []
        if modo == 'adicionar':
            cur.execute('SELECT atuacao FROM carteira_ficha WHERE cliente_id=%s', (cid,))
            row = cur.fetchone()
            if row and row[0]:
                atual = [x for x in row[0].split(',') if x]
        novo = ','.join(sorted(set(atual) | set(validos))) if modo == 'adicionar' else ','.join(validos)
        cur.execute('''
            INSERT INTO carteira_ficha (cliente_id, cliente_nome, atuacao, atualizado_em)
            VALUES (%s,%s,%s,%s)
            ON CONFLICT (cliente_id) DO UPDATE SET
                atuacao=EXCLUDED.atuacao, atualizado_em=EXCLUDED.atualizado_em
        ''', (cid, (nomes.get(cid) or '')[:200], novo, now_sp_str()))
        n += 1
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'gravados': n, 'atuacao': validos, 'modo': modo})


@app.route('/admin/carteira/interacao', methods=['POST'])
@login_required
def admin_carteira_interacao_add():
    d = request.get_json(silent=True) or {}
    cid, resumo = (d.get('cliente_id') or '').strip(), (d.get('resumo') or '').strip()
    if not cid or not resumo:
        return jsonify({'success': False, 'erro': 'cliente e resumo são obrigatórios'}), 400
    novo = str(uuid.uuid4())
    conn = get_db()
    cur = conn.cursor()
    usuario = sessao_valida(session)
    cur.execute('INSERT INTO carteira_interacao '
                '(id, cliente_id, data, tipo, resumo, responsavel, usuario_id, criado_em) '
                'VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
                (novo, cid, d.get('data') or today_sp(), (d.get('tipo') or '')[:40],
                 resumo[:1000], USUARIOS[usuario], usuario, now_sp_str()))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'id': novo})


@app.route('/admin/carteira/contato', methods=['POST'])
@login_required
def admin_carteira_contato():
    d = request.get_json(silent=True) or {}
    ids = list(dict.fromkeys(str(x).strip() for x in (d.get('ids') or []) if str(x).strip()))
    if not ids and str(d.get('cliente_id') or '').strip():
        ids = [str(d['cliente_id']).strip()]
    if not ids:
        return jsonify({'success': False, 'erro': 'Nenhum cliente informado.'}), 400
    try:
        atividade = carteira.validar_atividade(d, today_sp())
    except ValueError as erro:
        return jsonify({'success': False, 'erro': str(erro)}), 400
    except TypeError:
        return jsonify({'success': False, 'erro': 'Confira os campos e as datas.'}), 400
    usuario = sessao_valida(session)
    atividade['responsavel'] = USUARIOS[usuario]
    conn = get_db()
    cur = conn.cursor()
    try:
        tarefa_id = str(d.get('tarefa_id') or '').strip()
        if tarefa_id:
            cur.execute('SELECT cliente_id, feita FROM carteira_tarefa WHERE id=%s FOR UPDATE', (tarefa_id,))
            tarefa = cur.fetchone()
            if len(ids) != 1 or not tarefa or tarefa[0] != ids[0] or tarefa[1]:
                return jsonify({'success': False, 'erro': 'A tarefa já foi concluída ou não pertence a este cadastro.'}), 409
        for cid in ids[:500]:
            cur.execute('INSERT INTO carteira_interacao '
                        '(id, cliente_id, data, tipo, resumo, resultado, responsavel, usuario_id, criado_em) '
                        'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                        (str(uuid.uuid4()), cid, atividade['data'], 'contato', atividade['resumo'],
                         atividade['resultado'], atividade['responsavel'], usuario, now_sp_str()))
            # Leads já têm um único próximo passo na própria ficha. Ao registrar
            # nova conversa, arquivamos o combinado anterior e o substituímos;
            # criar também uma tarefa aberta mostraria o retorno duas vezes.
            cur.execute('SELECT proximo, proximo_em FROM carteira_lead WHERE id=%s FOR UPDATE', (cid,))
            lead = cur.fetchone()
            if lead:
                anterior, prazo_anterior = lead[0] or '', lead[1]
                if anterior or prazo_anterior:
                    cur.execute('INSERT INTO carteira_tarefa '
                                '(id, cliente_id, titulo, prazo, feita, concluido_em, responsavel, criado_em) '
                                'VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
                                (str(uuid.uuid4()), cid, anterior or 'Retorno anterior', prazo_anterior,
                                 True, today_sp(), atividade['responsavel'], now_sp_str()))
                cur.execute('UPDATE carteira_lead SET proximo=%s, proximo_em=%s, atualizado_em=%s WHERE id=%s',
                            (atividade['proximo'], atividade['proximo_em'], now_sp_str(), cid))
            elif atividade['proximo']:
                cur.execute('INSERT INTO carteira_tarefa '
                            '(id, cliente_id, titulo, prazo, feita, responsavel, criado_em) '
                            'VALUES (%s,%s,%s,%s,%s,%s,%s)',
                            (str(uuid.uuid4()), cid, atividade['proximo'], atividade['proximo_em'],
                             False, atividade['responsavel'], now_sp_str()))
        if tarefa_id:
            cur.execute('UPDATE carteira_tarefa SET feita=TRUE, concluido_em=%s WHERE id=%s',
                        (today_sp(), tarefa_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
    return jsonify({'success': True, 'gravados': len(ids[:500])})


@app.route('/admin/carteira/rotina-lote', methods=['POST'])
@login_required
def admin_carteira_rotina_lote():
    """Dispensar varios clientes da rotina, ou dar cadencia propria a eles."""
    d = request.get_json(silent=True) or {}
    ids = [str(x).strip() for x in (d.get('ids') or []) if str(x).strip()]
    if not ids:
        return jsonify({'success': False, 'erro': 'nenhum cliente selecionado'}), 400
    nomes = d.get('nomes') or {}
    dispensa = bool(d.get('dispensa'))
    try:
        cad = int(d.get('cadencia') or 0)
    except (TypeError, ValueError):
        cad = 0
    cad = cad if 1 <= cad <= 365 else None
    # So mexe no que veio. Um lote de cadencia nao pode apagar a classificacao
    # que o gestor escreveu a mao em outro dia.
    campos = [('dispensa', dispensa), ('cadencia', cad)]
    if 'tipo' in d:
        t = d.get('tipo') or 'carteira'
        campos.append(('tipo', t if t in carteira.TIPOS else 'carteira'))
    if 'classe_manual' in d:
        cm = (d.get('classe_manual') or '').strip()
        campos.append(('classe_manual', cm if cm in carteira.MOTIVO_ROTULO else ''))
    if 'prioridade' in d:
        campos.append(('prioridade', bool(d.get('prioridade'))))
    colunas = ', '.join(k for k, _ in campos)
    marcas = ', '.join(['%s'] * len(campos))
    sets = ', '.join('%s=EXCLUDED.%s' % (k, k) for k, _ in campos)
    conn = get_db()
    cur = conn.cursor()
    for cid in ids[:500]:
        cur.execute(
            'INSERT INTO carteira_ficha (cliente_id, cliente_nome, ' + colunas + ', atualizado_em) '
            'VALUES (%s,%s,' + marcas + ',%s) '
            'ON CONFLICT (cliente_id) DO UPDATE SET ' + sets + ', atualizado_em=EXCLUDED.atualizado_em',
            [cid, (nomes.get(cid) or '')[:200]] + [v for _, v in campos] + [now_sp_str()])
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'gravados': len(ids[:500])})


@app.route('/admin/carteira/interacao/<item_id>', methods=['DELETE'])
@login_required
def admin_carteira_interacao_del(item_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM carteira_interacao WHERE id=%s', (item_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})


@app.route('/admin/carteira/tarefa', methods=['POST'])
@login_required
def admin_carteira_tarefa_add():
    d = request.get_json(silent=True) or {}
    cid, titulo = (d.get('cliente_id') or '').strip(), (d.get('titulo') or '').strip()
    if not cid or not titulo:
        return jsonify({'success': False, 'erro': 'cliente e descrição são obrigatórios'}), 400
    try:
        prazo = _date.fromisoformat(str(d.get('prazo') or '')).isoformat()
    except ValueError:
        return jsonify({'success': False, 'erro': 'Informe uma data válida para a tarefa.'}), 400
    novo = str(uuid.uuid4())
    conn = get_db()
    cur = conn.cursor()
    cur.execute('INSERT INTO carteira_tarefa (id, cliente_id, titulo, prazo, feita, responsavel, criado_em) '
                'VALUES (%s,%s,%s,%s,%s,%s,%s)',
                (novo, cid, titulo[:300], prazo, False,
                 str(d.get('responsavel') or '')[:120], now_sp_str()))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'id': novo})


@app.route('/admin/carteira/tarefa/<item_id>', methods=['POST'])
@login_required
def admin_carteira_tarefa_toggle(item_id):
    feita = bool((request.get_json(silent=True) or {}).get('feita'))
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE carteira_tarefa SET feita=%s, concluido_em=%s WHERE id=%s',
                (feita, today_sp() if feita else None, item_id))
    if not cur.rowcount:
        cur.close()
        conn.close()
        return jsonify({'success': False, 'erro': 'Tarefa não encontrada.'}), 404
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})


@app.route('/admin/carteira/tarefa/<item_id>', methods=['DELETE'])
@login_required
def admin_carteira_tarefa_del(item_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM carteira_tarefa WHERE id=%s', (item_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})


def _ler_leads(arq):
    bruto = arq.read()
    for cod in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            return carteira.ler_csv_leads(bruto.decode(cod))
        except UnicodeDecodeError:
            continue
    return [], ['arquivo ilegivel: salve como CSV UTF-8']


def _leads_novos(cur, leads):
    """Separa o que entra do que ja existe. Reimportar a mesma lista nao cria
    duplicata nem reseta a etapa de quem ja esta em andamento."""
    cur.execute('SELECT id FROM carteira_lead')
    existe = {r[0] for r in cur.fetchall()}
    novos, repetidos, vistos = [], [], set()
    for L in leads:
        lid = carteira.id_lead(L['nome'], L.get('cidade', ''))
        if lid in existe or lid in vistos:
            repetidos.append(L)
            continue
        vistos.add(lid)
        novos.append((lid, L))
    return novos, repetidos


@app.route('/admin/carteira/leads/previa', methods=['POST'])
@login_required
def admin_leads_previa():
    arq = request.files.get('arquivo')
    if not arq or not arq.filename:
        return jsonify({'success': False, 'erro': 'Nenhum arquivo foi enviado.'}), 400
    leads, erros = _ler_leads(arq)
    if not leads:
        return jsonify({'success': False,
                        'erro': (erros[0] if erros else 'Nenhum lead valido no arquivo.'),
                        'detalhes': erros[:10]}), 400
    conn = get_db()
    cur = conn.cursor()
    novos, repetidos = _leads_novos(cur, leads)
    cur.execute('SELECT COUNT(*) FROM carteira_lead')
    total = cur.fetchone()[0]
    cur.close()
    conn.close()
    return jsonify({'success': True, 'no_arquivo': len(leads), 'novos': len(novos),
                    'repetidos': len(repetidos), 'ja_no_banco': total,
                    'sem_uf': sum(1 for _, L in novos if not L.get('uf')),
                    'sem_telefone': sum(1 for _, L in novos if not L.get('telefone')),
                    'amostra': [L for _, L in novos[:10]],
                    'por_etapa': carteira._contar([L for _, L in novos],
                                                  lambda L: L.get('etapa') or 'novo'),
                    'ignoradas': len(erros), 'detalhes': erros[:10]})


@app.route('/admin/carteira/leads/upload', methods=['POST'])
@login_required
def admin_leads_upload():
    arq = request.files.get('arquivo')
    if not arq or not arq.filename:
        return jsonify({'success': False, 'erro': 'Nenhum arquivo foi enviado.'}), 400
    nome_arq = arq.filename[:120]
    leads, erros = _ler_leads(arq)
    if not leads:
        return jsonify({'success': False,
                        'erro': (erros[0] if erros else 'Nenhum lead valido no arquivo.'),
                        'detalhes': erros[:10]}), 400
    conn = get_db()
    cur = conn.cursor()
    novos, repetidos = _leads_novos(cur, leads)
    agora = now_sp_str()
    if novos:
        # A etapa vem do arquivo quando ele traz essa coluna. Chegar tudo como
        # "novo" apagaria o trabalho de qualificacao ja feito na planilha.
        cur.executemany(
            'INSERT INTO carteira_lead (id, nome, cidade, uf, contato, telefone, email, '
            'etapa, segmento, instagram, obs, origem_arq, criado_em, atualizado_em) '
            'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING',
            [(lid, L['nome'], L.get('cidade', ''), L.get('uf', ''), L.get('contato', ''),
              L.get('telefone', ''), L.get('email', ''), L.get('etapa') or 'novo',
              L.get('segmento', ''), L.get('instagram', ''), L.get('obs', ''),
              nome_arq, agora, agora)
             for lid, L in novos])
    conn.commit()
    cur.execute('SELECT COUNT(*) FROM carteira_lead')
    total = cur.fetchone()[0]
    cur.close()
    conn.close()
    return jsonify({'success': True, 'novos': len(novos),
                    'repetidos': len(repetidos), 'total': total,
                    'ignoradas': len(erros), 'detalhes': erros[:10]})


@app.route('/admin/carteira/lead/novo', methods=['POST'])
@login_required
def admin_lead_novo():
    """Lead que chega por telefone ou feira, sem passar por planilha.

    O id sai do nome mais a cidade, igual ao da importacao, entao criar aqui e
    importar depois a mesma empresa nao gera duas fichas.
    """
    d = request.get_json(silent=True) or {}
    nome = (d.get('nome') or '').strip().upper()[:200]
    if not nome:
        return jsonify({'success': False, 'erro': 'o nome da empresa é obrigatório'}), 400
    cidade = (d.get('cidade') or '').strip()[:120]
    lid = carteira.id_lead(nome, cidade)
    etapa = carteira.normalizar_etapa(d.get('etapa') or 'novo')
    agora = now_sp_str()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT nome FROM carteira_lead WHERE id=%s', (lid,))
    ja = cur.fetchone()
    if ja:
        cur.close()
        conn.close()
        return jsonify({'success': False, 'erro': 'esse lead já está na lista', 'id': lid}), 409
    cur.execute('''
        INSERT INTO carteira_lead (id, nome, cidade, uf, contato, telefone, email, etapa,
                                   segmento, instagram, obs, proximo, proximo_em,
                                   revenda, revenda_de, origem_arq, criado_em, atualizado_em,
                                   responsavel_usuario)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ''', (lid, nome, cidade, carteira.normalizar_uf(d.get('uf') or ''),
          (d.get('contato') or '')[:120], (d.get('telefone') or '')[:40],
          (d.get('email') or '')[:160], etapa, (d.get('segmento') or '')[:60],
          (d.get('instagram') or '')[:300], (d.get('obs') or '')[:2000],
          (d.get('proximo') or '')[:300], (d.get('proximo_em') or None),
          bool(d.get('revenda')), (d.get('revenda_de') or '')[:200],
          'cadastrado à mão', agora, agora, sessao_valida(session)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'id': lid})


@app.route('/admin/carteira/lead/retorno', methods=['POST'])
@login_required
def admin_lead_concluir_retorno():
    d = request.get_json(silent=True) or {}
    lid = str(d.get('id') or '').strip()
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute('SELECT proximo, proximo_em FROM carteira_lead WHERE id=%s FOR UPDATE', (lid,))
        anterior = cur.fetchone()
        if not anterior:
            return jsonify({'success': False, 'erro': 'Lead não encontrado.'}), 404
        titulo, prazo = anterior[0] or '', str(anterior[1] or '')
        if not (titulo or prazo) or titulo != (d.get('proximo') or '') or prazo != (d.get('proximo_em') or ''):
            return jsonify({'success': False, 'erro': 'Este retorno já foi alterado. Atualize a página.'}), 409
        cur.execute("UPDATE carteira_lead SET proximo='', proximo_em=NULL, atualizado_em=%s WHERE id=%s",
                    (now_sp_str(), lid))
        usuario = sessao_valida(session)
        cur.execute('INSERT INTO carteira_tarefa (id, cliente_id, titulo, prazo, feita, concluido_em, '
                    'responsavel, criado_em) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
                    (str(uuid.uuid4()), lid, titulo or 'Retorno combinado', prazo or None, True,
                     today_sp(), USUARIOS[usuario], now_sp_str()))
        cur.execute('INSERT INTO carteira_interacao '
                    '(id, cliente_id, data, tipo, resumo, responsavel, usuario_id, criado_em) '
                    'VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
                    (str(uuid.uuid4()), lid, today_sp(), 'tarefa', titulo or 'Retorno combinado concluído',
                     USUARIOS[usuario], usuario, now_sp_str()))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
    return jsonify({'success': True})


@app.route('/admin/carteira/lead', methods=['POST'])
@login_required
def admin_lead_salvar():
    d = request.get_json(silent=True) or {}
    lid = (d.get('id') or '').strip()
    if not lid:
        return jsonify({'success': False, 'erro': 'lead sem identificador'}), 400
    etapa = d.get('etapa') or 'novo'
    if etapa not in [e[0] for e in carteira.ETAPAS]:
        etapa = 'novo'
    dono = str(d.get('responsavel_usuario') or '').strip() if 'responsavel_usuario' in d else None
    if dono is not None and dono not in ('', *USUARIOS):
        return jsonify({'success': False, 'erro': 'Escolha um responsável válido.'}), 400
    conn = get_db()
    cur = conn.cursor()
    # So grava o que veio no corpo. Um UPDATE de todas as colunas com os campos
    # ausentes vazios apagaria cidade, telefone e contato a cada chamada
    # parcial, e o lead perderia dado sem ninguem pedir.
    limites = {'cidade': 120, 'uf': 60, 'contato': 120, 'telefone': 40, 'email': 160,
               'motivo': 1000, 'obs': 2000, 'proximo': 300,
               'segmento': 60, 'instagram': 300, 'revenda_de': 200}
    campos, valores = [], []
    if 'cliente_id' in d:
        cid = str(d.get('cliente_id') or '').strip()
        if cid:
            cur.execute('SELECT DISTINCT COALESCE(a.canonico, v.cliente) '
                        'FROM carteira_vendas v LEFT JOIN carteira_alias a ON a.apelido=v.cliente')
            validos = {carteira.id_cliente(r[0]) for r in cur.fetchall()}
            if cid not in validos:
                cur.close()
                conn.close()
                return jsonify({'success': False, 'erro': 'Escolha um cliente da carteira.'}), 400
            cur.execute('SELECT responsavel_usuario FROM carteira_ficha WHERE cliente_id=%s', (cid,))
            ficha_dono = cur.fetchone()
            dono = (ficha_dono[0] or '') if ficha_dono else ''
        campos.append('cliente_id=%s')
        valores.append(cid)
    if dono is not None:
        campos.append('responsavel_usuario=%s')
        valores.append(dono)

    for k, lim in limites.items():
        if k in d:
            v = (d.get(k) or '')[:lim]
            campos.append(k + '=%s')
            valores.append(carteira.normalizar_uf(v) if k == 'uf' else v)
    if 'etapa' in d:
        campos.append('etapa=%s')
        valores.append(etapa)
    if 'proximo_em' in d:
        campos.append('proximo_em=%s')
        valores.append(d.get('proximo_em') or None)
    if 'revenda' in d:
        campos.append('revenda=%s')
        valores.append(bool(d.get('revenda')))
    campos.append('atualizado_em=%s')
    valores.append(now_sp_str())
    valores.append(lid)
    cur.execute('UPDATE carteira_lead SET ' + ', '.join(campos) + ' WHERE id=%s', valores)
    if cur.rowcount == 0:
        cur.close()
        conn.close()
        return jsonify({'success': False, 'erro': 'lead nao encontrado'}), 404
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})


@app.route('/admin/carteira/unificar', methods=['POST'])
@login_required
def admin_carteira_unificar():
    """Junta dois ou mais cadastros que sao o mesmo cliente.

    Nao basta criar o apelido. O id do cliente sai do nome, entao os contatos,
    as tarefas e a ficha dos nomes absorvidos estao presos a ids que vao deixar
    de existir. Este endpoint move tudo para o id do nome escolhido; sem isso a
    unificacao junta o faturamento e perde o historico de relacionamento, que e
    a metade do CRM que ninguem consegue refazer depois.

    Na ficha, o que o canonico ja tem preenchido manda; campo vazio dele e
    preenchido com o do absorvido, para nao jogar fora cidade ou motivo que so
    estavam escritos num dos dois.
    """
    d = request.get_json(silent=True) or {}
    canonico = (d.get('canonico') or '').strip().upper()
    apelidos = [str(x).strip().upper() for x in (d.get('apelidos') or []) if str(x).strip()]
    apelidos = [a for a in apelidos if a and a != canonico]
    if not canonico or not apelidos:
        return jsonify({'success': False,
                        'erro': 'escolha o nome que fica e pelo menos um para juntar'}), 400

    id_novo = carteira.id_cliente(canonico)
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 1. a ficha do canonico, para saber o que ja esta preenchido
    cur.execute('SELECT * FROM carteira_ficha WHERE cliente_id=%s', (id_novo,))
    base = dict(cur.fetchone() or {})
    TEXTOS = ('cidade', 'estado', 'motivo', 'atuacao', 'obs', 'contato', 'telefone',
              'email', 'responsavel', 'responsavel_usuario')

    movidos = {'contatos': 0, 'tarefas': 0, 'fichas': 0}
    for nome in apelidos:
        id_velho = carteira.id_cliente(nome)
        if id_velho == id_novo:
            continue
        cur.execute('UPDATE carteira_interacao SET cliente_id=%s WHERE cliente_id=%s',
                    (id_novo, id_velho))
        movidos['contatos'] += cur.rowcount
        cur.execute('UPDATE carteira_tarefa SET cliente_id=%s WHERE cliente_id=%s',
                    (id_novo, id_velho))
        movidos['tarefas'] += cur.rowcount

        cur.execute('SELECT * FROM carteira_ficha WHERE cliente_id=%s', (id_velho,))
        velha = cur.fetchone()
        if velha:
            velha = dict(velha)
            for campo in TEXTOS:
                if not (base.get(campo) or '').strip() and (velha.get(campo) or '').strip():
                    base[campo] = velha[campo]
            for campo in ('dispensa', 'prioridade'):
                base[campo] = bool(base.get(campo)) or bool(velha.get(campo))
            if not base.get('cadencia') and velha.get('cadencia'):
                base['cadencia'] = velha['cadencia']
            if (base.get('situacao') or 'ativo') == 'ativo' and velha.get('situacao'):
                base['situacao'] = velha['situacao']
            cur.execute('DELETE FROM carteira_ficha WHERE cliente_id=%s', (id_velho,))
            movidos['fichas'] += 1

        # Apelido que apontava para o nome absorvido passa a apontar para o novo,
        # antes de o proprio nome virar apelido. Sem isso, unificar A em B e
        # depois B em C deixaria A apontando para um nome que nao existe mais.
        cur.execute('UPDATE carteira_alias SET canonico=%s WHERE canonico=%s', (canonico, nome))
        cur.execute('INSERT INTO carteira_alias (apelido, canonico) VALUES (%s,%s) '
                    'ON CONFLICT (apelido) DO UPDATE SET canonico=EXCLUDED.canonico',
                    (nome, canonico))

    if base:
        cur.execute('''
            INSERT INTO carteira_ficha
                (cliente_id, cliente_nome, cidade, estado, situacao, motivo, atuacao, obs,
                 dispensa, cadencia, tipo, classe_manual, prioridade, atualizado_em)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (cliente_id) DO UPDATE SET
                cliente_nome=EXCLUDED.cliente_nome, cidade=EXCLUDED.cidade,
                estado=EXCLUDED.estado, situacao=EXCLUDED.situacao,
                motivo=EXCLUDED.motivo, atuacao=EXCLUDED.atuacao, obs=EXCLUDED.obs,
                dispensa=EXCLUDED.dispensa, cadencia=EXCLUDED.cadencia,
                tipo=EXCLUDED.tipo, classe_manual=EXCLUDED.classe_manual,
                prioridade=EXCLUDED.prioridade, atualizado_em=EXCLUDED.atualizado_em
        ''', (id_novo, canonico[:200], base.get('cidade') or '', base.get('estado') or '',
              base.get('situacao') or 'ativo', base.get('motivo') or '',
              base.get('atuacao') or '', base.get('obs') or '',
              bool(base.get('dispensa')), base.get('cadencia'),
              base.get('tipo') or 'carteira', base.get('classe_manual') or '',
              bool(base.get('prioridade')), now_sp_str()))

    if base:
        for campo in ('contato', 'telefone', 'email', 'responsavel', 'responsavel_usuario'):
            cur.execute('UPDATE carteira_ficha SET ' + campo + '=%s WHERE cliente_id=%s',
                        (base.get(campo) or '', id_novo))
    for nome in apelidos:
        cur.execute('UPDATE carteira_lead SET cliente_id=%s WHERE cliente_id=%s',
                    (id_novo, carteira.id_cliente(nome)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'canonico': canonico, 'juntados': apelidos,
                    'movidos': movidos, 'cliente_id': id_novo})


@app.route('/admin/carteira/lead/revenda-lote', methods=['POST'])
@login_required
def admin_lead_revenda_lote():
    """Marca varios leads como revenda de um cliente da casa."""
    d = request.get_json(silent=True) or {}
    ids = [str(x).strip() for x in (d.get('ids') or []) if str(x).strip()]
    if not ids:
        return jsonify({'success': False, 'erro': 'selecione os leads'}), 400
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE carteira_lead SET revenda=%s, revenda_de=%s, atualizado_em=%s '
                'WHERE id = ANY(%s)',
                (bool(d.get('revenda')), (d.get('revenda_de') or '')[:200],
                 now_sp_str(), ids[:500]))
    n = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'gravados': n})


@app.route('/admin/carteira/lead/etapa-lote', methods=['POST'])
@login_required
def admin_lead_etapa_lote():
    d = request.get_json(silent=True) or {}
    ids = [str(x).strip() for x in (d.get('ids') or []) if str(x).strip()]
    etapa = d.get('etapa')
    if not ids or etapa not in [e[0] for e in carteira.ETAPAS]:
        return jsonify({'success': False, 'erro': 'selecione os leads e a etapa'}), 400
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE carteira_lead SET etapa=%s, atualizado_em=%s WHERE id = ANY(%s)',
                (etapa, now_sp_str(), ids[:500]))
    n = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'gravados': n, 'etapa': etapa})


@app.route('/admin/carteira/lead/<lead_id>', methods=['DELETE'])
@login_required
def admin_lead_excluir(lead_id):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM carteira_lead WHERE id=%s', (lead_id,))
    cur.execute('DELETE FROM carteira_interacao WHERE cliente_id=%s', (lead_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})


@app.route('/admin/carteira/alias', methods=['POST'])
@login_required
def admin_carteira_alias():
    d = request.get_json(silent=True) or {}
    apelido = (d.get('apelido') or '').strip().upper()
    canonico = (d.get('canonico') or '').strip().upper()
    conn = get_db()
    cur = conn.cursor()
    if d.get('remover'):
        cur.execute('DELETE FROM carteira_alias WHERE apelido=%s', (apelido,))
    else:
        if not apelido or not canonico or apelido == canonico:
            cur.close()
            conn.close()
            return jsonify({'success': False, 'erro': 'informe dois nomes diferentes'}), 400
        # evita corrente de apelidos: se o canônico já é apelido de outro,
        # aponta direto para o destino final
        cur.execute('SELECT canonico FROM carteira_alias WHERE apelido=%s', (canonico,))
        row = cur.fetchone()
        if row:
            canonico = row[0]
        cur.execute('INSERT INTO carteira_alias (apelido, canonico) VALUES (%s,%s) '
                    'ON CONFLICT (apelido) DO UPDATE SET canonico=EXCLUDED.canonico',
                    (apelido, canonico))
        cur.execute('UPDATE carteira_alias SET canonico=%s WHERE canonico=%s', (canonico, apelido))

        # O cliente que some leva junto o que já foi registrado sobre ele:
        # sem isso, tarefas e contatos ficariam órfãos de um id que a carteira
        # não gera mais.
        de, para = carteira.id_cliente(apelido), carteira.id_cliente(canonico)
        if de != para:
            cur.execute('UPDATE carteira_interacao SET cliente_id=%s WHERE cliente_id=%s', (para, de))
            cur.execute('UPDATE carteira_tarefa   SET cliente_id=%s WHERE cliente_id=%s', (para, de))
            cur.execute('UPDATE carteira_lead SET cliente_id=%s WHERE cliente_id=%s', (para, de))
            # A ficha só migra se o cliente que fica ainda não tiver uma, para
            # não sobrescrever um cadastro preenchido à mão.
            cur.execute('SELECT 1 FROM carteira_ficha WHERE cliente_id=%s', (para,))
            if cur.fetchone():
                cur.execute('UPDATE carteira_ficha SET responsavel_usuario=COALESCE('
                            "NULLIF(responsavel_usuario, ''), "
                            '(SELECT responsavel_usuario FROM carteira_ficha WHERE cliente_id=%s)) '
                            'WHERE cliente_id=%s', (de, para))
                cur.execute('DELETE FROM carteira_ficha WHERE cliente_id=%s', (de,))
            else:
                cur.execute('UPDATE carteira_ficha SET cliente_id=%s, cliente_nome=%s '
                            'WHERE cliente_id=%s', (para, canonico, de))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
