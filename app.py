import os
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

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'fogospiromax-dev-secret')

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
        if not session.get('admin_logged_in'):
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '')
        password = request.form.get('password', '')
        admin_username = os.environ.get('ADMIN_USERNAME', 'admin')
        admin_password = os.environ.get('ADMIN_PASSWORD', 'fogos2025')
        if username == admin_username and password == admin_password:
            session['admin_logged_in'] = True
            return redirect(url_for('admin_view'))
        else:
            error = 'Usuário ou senha incorretos. Tente novamente.'
    return render_template('login.html', error=error)

@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_logged_in', None)
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
                           melhorias_pendentes_count=melhorias_count)

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
            motivo_tipo  TEXT DEFAULT '',
            motivo       TEXT DEFAULT '',
            obs          TEXT DEFAULT '',
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
    cur.execute('CREATE TABLE IF NOT EXISTS carteira_config (chave TEXT PRIMARY KEY, valor TEXT)')
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
    fichas = {r['cliente_id']: dict(r) for r in cur.fetchall()}

    cur.execute('SELECT * FROM carteira_interacao ORDER BY data DESC')
    inter = [{'id': r['id'], 'cliente': r['cliente_id'], 'data': r['data'].isoformat(),
              'tipo': r['tipo'] or '', 'resumo': r['resumo'] or ''} for r in cur.fetchall()]

    cur.execute('SELECT * FROM carteira_tarefa')
    tarefas = [{'id': r['id'], 'cliente': r['cliente_id'], 'titulo': r['titulo'],
                'prazo': r['prazo'].isoformat() if r['prazo'] else '',
                'feita': bool(r['feita'])} for r in cur.fetchall()]

    cur.close()
    conn.close()

    dados = carteira.calcular(linhas, aliases, fichas)
    if dados is None:
        return None, {}, inter, tarefas, aliases
    return dados, fichas, inter, tarefas, aliases


@app.route('/admin/carteira')
@login_required
def admin_carteira_view():
    dados, fichas, inter, tarefas, aliases = _carteira_dados()
    candidatos = carteira.candidatos_unificacao(dados) if dados else []
    return render_template(
        'admin_carteira.html',
        dados_json=_json.dumps(dados, default=str, ensure_ascii=False) if dados else 'null',
        fichas_json=_json.dumps(fichas, default=str, ensure_ascii=False),
        inter_json=_json.dumps(inter, ensure_ascii=False),
        tarefas_json=_json.dumps(tarefas, ensure_ascii=False),
        aliases_json=_json.dumps(aliases, ensure_ascii=False),
        candidatos_json=_json.dumps(candidatos, ensure_ascii=False),
        motivos_json=_json.dumps(carteira.MOTIVOS, ensure_ascii=False),
        hoje=today_sp(),
    )


@app.route('/admin/carteira/upload', methods=['POST'])
@login_required
def admin_carteira_upload():
    arq = request.files.get('arquivo')
    if not arq or not arq.filename:
        return jsonify({'success': False, 'erro': 'Nenhum arquivo foi enviado.'}), 400
    bruto = arq.read()
    texto = None
    for cod in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            texto = bruto.decode(cod)
            break
        except UnicodeDecodeError:
            continue
    if texto is None:
        return jsonify({'success': False, 'erro': 'Não consegui ler o arquivo. Salve como CSV UTF-8.'}), 400

    linhas, erros = carteira.ler_csv(texto)
    if not linhas:
        return jsonify({'success': False,
                        'erro': 'Nenhuma linha válida encontrada. Esperado: Data;Nome;Valor.',
                        'detalhes': erros[:10]}), 400

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT COUNT(*) FROM carteira_vendas')
    antes = cur.fetchone()[0]
    # O CSV é sempre a base completa, não um incremento: troca tudo de uma vez
    # dentro da mesma transação, para nunca ficar com o banco pela metade.
    cur.execute('DELETE FROM carteira_vendas')
    cur.executemany('INSERT INTO carteira_vendas (data, cliente, valor) VALUES (%s, %s, %s)',
                    [(d, n, v) for d, n, v in linhas])
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'linhas': len(linhas), 'antes': antes,
                    'ignoradas': len(erros), 'detalhes': erros[:10]})


@app.route('/admin/carteira/ficha', methods=['POST'])
@login_required
def admin_carteira_ficha():
    d = request.get_json(silent=True) or {}
    cid = (d.get('cliente_id') or '').strip()
    if not cid:
        return jsonify({'success': False, 'erro': 'cliente_id ausente'}), 400
    situacao = d.get('situacao') or 'ativo'
    if situacao not in ('ativo', 'pausado', 'perdido'):
        situacao = 'ativo'
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO carteira_ficha
            (cliente_id, cliente_nome, cidade, estado, situacao, motivo_tipo, motivo, obs, atualizado_em)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (cliente_id) DO UPDATE SET
            cliente_nome=EXCLUDED.cliente_nome, cidade=EXCLUDED.cidade,
            estado=EXCLUDED.estado, situacao=EXCLUDED.situacao,
            motivo_tipo=EXCLUDED.motivo_tipo, motivo=EXCLUDED.motivo,
            obs=EXCLUDED.obs, atualizado_em=EXCLUDED.atualizado_em
    ''', (cid, (d.get('cliente_nome') or '')[:200], (d.get('cidade') or '')[:120],
          (d.get('estado') or '')[:2].upper(), situacao,
          (d.get('motivo_tipo') or '')[:40], (d.get('motivo') or '')[:500],
          (d.get('obs') or '')[:2000], now_sp_str()))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})


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
    cur.execute('INSERT INTO carteira_interacao (id, cliente_id, data, tipo, resumo, criado_em) '
                'VALUES (%s,%s,%s,%s,%s,%s)',
                (novo, cid, d.get('data') or today_sp(), (d.get('tipo') or '')[:40],
                 resumo[:1000], now_sp_str()))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'id': novo})


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
    novo = str(uuid.uuid4())
    conn = get_db()
    cur = conn.cursor()
    cur.execute('INSERT INTO carteira_tarefa (id, cliente_id, titulo, prazo, feita, criado_em) '
                'VALUES (%s,%s,%s,%s,%s,%s)',
                (novo, cid, titulo[:300], d.get('prazo') or None, False, now_sp_str()))
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
    cur.execute('UPDATE carteira_tarefa SET feita=%s WHERE id=%s', (feita, item_id))
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
            # A ficha só migra se o cliente que fica ainda não tiver uma, para
            # não sobrescrever um cadastro preenchido à mão.
            cur.execute('SELECT 1 FROM carteira_ficha WHERE cliente_id=%s', (para,))
            if cur.fetchone():
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
