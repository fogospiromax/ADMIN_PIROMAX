/* ═══════════════════════════════════════════════════════════════════════════
   Carteira de clientes — Piromax
   Cinco telas: Hoje, Registros, Prospecção, Análise, Dados.

   A ideia que organiza tudo: uma fila, uma ficha, um relatório. A fila de Hoje
   é o que se abre de manhã; Registros é a lista única com filtros salvos;
   Análise é o relatório do mês numa página; Dados é manutenção e sai da frente.

   Nada aqui guarda estado no navegador. Toda gravação vai para o Postgres e a
   página se recarrega dos dados do servidor, sem perder rolagem nem ficha aberta.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var IX = {};                      /* id do cliente -> objeto */
var LEAD_IX = {};                 /* id do lead -> objeto */
var estado = { tela: 'hoje', tipo: 'todos', limite: 25, view: 'todos',
               busca: '', ord: 'receita', asc: false, marcados: {} };
var abertaId = null;              /* ficha aberta, para reabrir após gravar */
var abertoTipo = 'cliente';

/* ── utilidades ─────────────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function moeda(v) {
  v = Number(v) || 0;
  var n = Math.abs(v);
  if (n >= 1e6) return 'R$ ' + (v / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace('.', ',') + ' mi';
  if (n >= 1e3) return 'R$ ' + (v / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace('.', ',') + ' mil';
  return 'R$ ' + v.toFixed(0);
}
function cheio(v) {
  return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(v) { return (v > 0 ? '+' : '') + Number(v).toFixed(0) + '%'; }
function dia(iso) {
  if (!iso) return '—';
  var p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
}
var MS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function mesrot(m) { var p = String(m).split('-'); return MS[+p[1] - 1] + '/' + p[0].slice(2); }

var DIR = {
  'crescendo': ['Crescendo', 'crescer'], 'estavel': ['Estável', 'classe'],
  'em queda': ['Em queda', 'queda'], 'queda forte': ['Queda forte', 'queda'],
  'parou': ['Parou', 'queda'], 'novo': ['Novo', 'novo'], 'encerrado': ['Encerrado', 'classe']
};
var MOTIVOS = [
  ['recuperar', 'Recuperar', 'var(--ruim)'],
  ['queda', 'Caindo', 'var(--ruim)'],
  ['crescer', 'Crescendo', 'var(--bom)'],
  ['novo', 'Novo', 'var(--s1)'],
  ['ritmo', 'Atrasado', 'var(--atencao)'],
  ['rotina', 'Rotina', 'var(--frio)']
];

function recado(txt, ruim) {
  var el = document.createElement('div');
  el.className = 'recado' + (ruim ? ' ruim' : '');
  el.textContent = txt;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, ruim ? 5200 : 2600);
}

/* Toda gravação passa por aqui: envia, recarrega do servidor e repinta sem
   perder a rolagem nem a ficha aberta. É o que evita o location.reload(). */
function gravar(url, corpo, ok) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo || {})
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j.success) { recado(j.erro || 'Não consegui gravar.', true); return j; }
    if (ok) recado(ok);
    return atualizar().then(function () { return j; });
  }).catch(function (e) {
    recado('Falhou ao falar com o servidor: ' + e.message, true);
    return { success: false };
  });
}

function preservandoRolagem(fn) {
  var y = window.scrollY;
  return Promise.resolve(fn()).then(function (r) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { window.scrollTo(0, y); });
    });
    return r;
  });
}

function atualizar() {
  return preservandoRolagem(function () {
    return fetch('/admin/carteira/dados').then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.success) return;
        D = j.dados; FICHA = j.fichas; INTER = j.inter; TAREFAS = j.tarefas;
        ALIASES = j.aliases; CANDIDATOS = j.candidatos; PROSPEC = j.prospec;
        indexar();
        pintarTudo();
        if (abertaId) abrirFicha(abertaId, abertoTipo, true);
      });
  });
}

function indexar() {
  IX = {}; LEAD_IX = {};
  if (D && D.clientes) D.clientes.forEach(function (c) { IX[c.id] = c; });
  if (PROSPEC && PROSPEC.leads) PROSPEC.leads.forEach(function (l) { LEAD_IX[l.id] = l; });
}

/* ── navegação ──────────────────────────────────────────────────────────── */
var TELAS = [['hoje', 'Hoje'], ['registros', 'Registros'], ['prospeccao', 'Prospecção'],
             ['analise', 'Análise'], ['dados', 'Dados']];

function pintarAbas() {
  $('abas').innerHTML = TELAS.map(function (t) {
    var n = '';
    if (t[0] === 'hoje') n = D && D.fila ? D.fila.length : 0;
    else if (t[0] === 'registros') n = D && D.clientes ? D.clientes.length : 0;
    else if (t[0] === 'prospeccao') n = PROSPEC ? PROSPEC.abertos : 0;
    return '<button class="aba" role="tab" type="button" data-t="' + t[0] + '" aria-selected="'
      + (estado.tela === t[0]) + '">' + t[1]
      + (n !== '' ? '<span class="cnt">' + n + '</span>' : '') + '</button>';
  }).join('');
}
function irPara(t, semHash) {
  estado.tela = t;
  TELAS.forEach(function (x) { $('p-' + x[0]).hidden = (x[0] !== t); });
  pintarAbas();
  if (!semHash) history.replaceState(null, '', '#/' + t);
}
$('abas').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-t]');
  if (!b) return;
  fecharFicha(true);
  irPara(b.dataset.t);
  window.scrollTo(0, 0);
});

function rota() {
  var h = location.hash || '#/hoje';
  var m = h.match(/^#\/cliente\/(.+)$/);
  if (m && IX[m[1]]) { irPara('registros', true); abrirFicha(m[1], 'cliente', true); return; }
  var ml = h.match(/^#\/lead\/(.+)$/);
  if (ml && LEAD_IX[ml[1]]) { irPara('prospeccao', true); abrirFicha(ml[1], 'lead', true); return; }
  var t = h.replace('#/', '').split('/')[0];
  if (!TELAS.some(function (x) { return x[0] === t; })) t = 'hoje';
  irPara(t, true);
  var cap = h.split('/')[2];
  if (t === 'analise' && cap && $(cap)) $(cap).scrollIntoView({ block: 'start' });
}
window.addEventListener('hashchange', rota);

/* ═══ HOJE ═══════════════════════════════════════════════════════════════ */
function pintarHoje() {
  if (!D) { $('h-fila').innerHTML = semBase(); return; }
  var fila = D.fila || [], R = D.rotina || {};
  var soma = fila.reduce(function (a, f) { return a + (f.peso || 0); }, 0);

  $('h-n').textContent = R.vencidos || 0;
  $('h-n-sub').textContent = 'clientes com contato vencido';
  $('h-sub').innerHTML = '<b>' + moeda(soma) + '</b> em jogo entre eles<br>'
    + (R.em_dia || 0) + ' em dia · ' + (R.dispensados || 0) + ' dispensados da rotina'
    + (R.ocasionais ? ' · ' + R.ocasionais + ' ocasionais fora da fila' : '') + '<br>'
    + 'cadência: ' + (R.cadencia ? R.cadencia.A : 15) + ' dias para A e B, '
    + (R.cadencia ? R.cadencia.C : 30) + ' para C'
    + (R.manuais ? ' · ' + R.manuais + ' classificado(s) por você' : '');

  $('h-fichas').innerHTML = '<button class="ficha" type="button" data-f="todos" aria-pressed="'
    + (estado.tipo === 'todos') + '">Tudo <span class="n">' + fila.length + '</span></button>'
    + MOTIVOS.map(function (m) {
        var n = fila.filter(function (f) { return f.tipo === m[0]; }).length;
        if (!n) return '';
        return '<button class="ficha" type="button" data-f="' + m[0] + '" aria-pressed="'
          + (estado.tipo === m[0]) + '"><i style="background:' + m[2] + '"></i>'
          + m[1] + ' <span class="n">' + n + '</span></button>';
      }).join('');

  var vis = fila.filter(function (f) { return estado.tipo === 'todos' || f.tipo === estado.tipo; });
  var mostra = vis.slice(0, estado.limite);
  $('h-fila').innerHTML = mostra.length ? mostra.map(linhaFila).join('')
    : '<p class="vazio">Ninguém nesta categoria.<br>Se a fila inteira esvaziar, a rotina está em dia.</p>';
  $('h-mais').hidden = vis.length <= estado.limite;
  $('h-mais').textContent = 'Mostrar mais ' + Math.min(25, vis.length - estado.limite)
    + ' de ' + (vis.length - estado.limite) + ' restantes';

  var nunca = R.sem_contato || 0;
  $('h-nota').innerHTML = '<b>A rotina manda na ordem, o dinheiro desempata.</b> '
    + (nunca ? 'Há ' + nunca + ' cliente(s) sem nenhum contato registrado; enquanto estiverem empatados '
        + 'em "nunca contactado", é o dinheiro em jogo que define a ordem. ' : '')
    + 'Quem for contactado sai da fila e volta sozinho no fim do prazo. '
    + 'O valor ao lado é sempre uma quantia real: quem <b>parou</b> vale o que comprava nesta altura do ano; '
    + 'quem está <b>caindo</b> ou <b>crescendo</b> vale a diferença já acumulada no ano; '
    + 'quem é <b>novo</b> vale o que já trouxe; quem entra só por <b>rotina</b> não tem nada em jogo além da visita.'
    + (R.ocasionais ? ' <b>' + R.ocasionais + ' cliente(s) marcados como ocasionais</b> ficam fora desta fila de '
        + 'propósito, mas continuam contando no faturamento e na análise: são ' + moeda(R.receita_ocasional || 0)
        + ' de receita que existe e não vira trabalho de rotina.' : '');
}
function linhaFila(f) {
  var rot = MOTIVOS.filter(function (m) { return m[0] === f.tipo; })[0] || ['rotina', 'Rotina'];
  return '<div class="linha' + (f.contato_urgente ? '' : ' emdia') + '">'
    + '<span class="faixa f-' + f.tipo + '" aria-hidden="true"></span>'
    + '<button class="corpo" type="button" data-id="' + esc(f.id) + '">'
      + '<span class="topo"><span class="selo s-' + f.tipo + '">' + rot[1]
      + (f.manual ? ' ✎' : '') + '</span>'
      + '<span class="nome">' + esc(f.nome) + '</span>'
      + '<span class="selo s-classe">Classe ' + f.classe + '</span></span>'
      + '<span class="frase">' + esc(f.texto) + '</span>'
      + '<span class="marca' + (f.contato_urgente ? '' : ' ok') + '">'
        + (f.contato_urgente ? '⏱ ' : '✓ ') + esc(f.contato_rotulo)
        + (f.marcas && f.marcas.length ? ' · ' + esc(f.marcas.join(' · ')) : '') + '</span>'
      + (f.manual ? '<span class="marca obs">✎ classificado por você. O sistema diria: '
          + esc(f.auto_rotulo) + '</span>' : '')
      + (f.motivo ? '<span class="marca obs">✎ ' + esc(f.motivo) + '</span>' : '')
    + '</button>'
    + '<span class="dir">'
      + '<span class="valor">' + (f.peso ? moeda(f.peso) : '—') + '</span>'
      + '<span class="leg">' + (f.peso ? 'em jogo' : 'só rotina') + '</span>'
      + '<button class="btn-ok" type="button" data-c="' + esc(f.id) + '">Contato feito</button>'
    + '</span></div>';
}
$('h-fichas').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-f]');
  if (!b) return;
  estado.tipo = b.dataset.f; estado.limite = 25; pintarHoje();
});
$('h-mais').addEventListener('click', function () { estado.limite += 25; pintarHoje(); });
$('h-fila').addEventListener('click', function (e) {
  var ok = e.target.closest('button[data-c]');
  if (ok) {
    ok.disabled = true; ok.textContent = 'Gravando…';
    gravar('/admin/carteira/contato', { cliente_id: ok.dataset.c }, 'Contato registrado.');
    return;
  }
  var b = e.target.closest('button[data-id]');
  if (b) abrirFicha(b.dataset.id, 'cliente');
});

function semBase() {
  return '<p class="vazio"><b>Nenhuma venda carregada ainda.</b><br>'
    + 'Vá em <b>Dados</b> e envie o arquivo de vendas para o painel ganhar conteúdo.</p>';
}

/* ═══ REGISTROS ══════════════════════════════════════════════════════════ */
var VIEWS = [
  ['todos', 'Todos', function () { return true; }],
  ['a', 'Classe A', function (c) { return c.classe === 'A'; }],
  ['caindo', 'Caindo', function (c) { return c.direcao === 'em queda' || c.direcao === 'queda forte'; }],
  ['parou', 'Parados', function (c) { return c.direcao === 'parou'; }],
  ['crescendo', 'Crescendo', function (c) { return c.direcao === 'crescendo'; }],
  ['novo', 'Novos', function (c) { return c.direcao === 'novo'; }],
  ['atrasado', 'Atrasados no ritmo', function (c) { return c.ritmo === 'atrasado' || c.ritmo === 'muito atrasado'; }],
  ['vencido', 'Contato vencido', function (c) { return c.contato_urgente; }],
  ['ocasional', 'Ocasionais', function (c) { return c.ocasional; }],
  ['manual', 'Classificados por você', function (c) { return !!c.classe_manual; }],
  ['dispensa', 'Fora da rotina', function (c) { return c.dispensa_rotina && !c.ocasional; }],
  ['semuf', 'Sem estado', function (c) { return !c.uf_base; }]
];
function listaRegistros() {
  if (!D) return [];
  var v = VIEWS.filter(function (x) { return x[0] === estado.view; })[0] || VIEWS[0];
  var q = estado.busca.trim().toLowerCase();
  var l = D.clientes.filter(function (c) {
    return v[2](c) && (!q || c.nome.toLowerCase().indexOf(q) >= 0);
  });
  var k = estado.ord, s = estado.asc ? 1 : -1;
  l.sort(function (a, b) {
    if (k === 'nome') return a.nome.localeCompare(b.nome) * (estado.asc ? 1 : -1);
    var x = a[k], y = b[k];
    if (x === null || x === undefined) x = -1e15;
    if (y === null || y === undefined) y = -1e15;
    return (x - y) * s;
  });
  return l;
}
function pintarRegistros() {
  if (!D) { $('r-corpo').innerHTML = '<tr><td colspan="8">' + semBase() + '</td></tr>'; return; }
  $('r-views').innerHTML = VIEWS.map(function (v) {
    return '<button class="ficha" type="button" data-w="' + v[0] + '" aria-pressed="'
      + (estado.view === v[0]) + '">' + v[1]
      + ' <span class="n">' + D.clientes.filter(v[2]).length + '</span></button>';
  }).join('');

  var l = listaRegistros();
  $('r-cnt').textContent = l.length + ' de ' + D.clientes.length;
  $('r-corpo').innerHTML = l.length ? l.map(function (c) {
    var d = DIR[c.direcao] || ['—', 'classe'], v = c.var_ytd_pct;
    var cor = c.dispensa_rotina ? 'var(--texto3)' : (c.contato_urgente ? 'var(--atencao)' : 'var(--bom)');
    return '<tr data-id="' + esc(c.id) + '" tabindex="0">'
      + '<td class="marc"><input type="checkbox" data-m="' + esc(c.id) + '"'
        + (estado.marcados[c.id] ? ' checked' : '') + ' aria-label="Marcar ' + esc(c.nome) + '"></td>'
      + '<td class="nm">' + esc(c.nome) + ' <span class="selo s-classe">' + c.classe + '</span></td>'
      + '<td class="num">' + moeda(c.receita) + '</td>'
      + '<td class="num ' + (v === null ? '' : (v >= 0 ? 'pos' : 'neg')) + '">'
        + (v === null ? '—' : pct(v)) + '</td>'
      + '<td><span class="selo s-' + d[1] + '">' + d[0] + '</span>'
        + (c.ocasional ? ' <span class="selo s-rotina">ocasional</span>' : '')
        + (c.classe_manual ? ' <span class="selo s-novo">✎ ' + esc(c.classe_manual) + '</span>' : '')
        + '</td>'
      + '<td style="white-space:nowrap;font-size:.78rem;color:' + cor + '">' + esc(c.contato_rotulo) + '</td>'
      + '<td class="num">' + c.recencia + ' d</td>'
      + '<td>' + faisca(c.mensal) + '</td></tr>';
  }).join('') : '<tr><td colspan="8"><p class="vazio">Nenhum cliente nesta visão.</p></td></tr>';
  pintarLote();
}
function faisca(m) {
  if (!m || !m.length) return '';
  var max = Math.max.apply(null, m) || 1, w = 92, h = 22, p = w / m.length;
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h
    + '" role="img" aria-label="Receita por mês do ano, janeiro a dezembro">'
    + m.map(function (v, i) {
        var a = Math.max(1, (v / max) * (h - 2));
        return '<rect x="' + (i * p).toFixed(1) + '" y="' + (h - a).toFixed(1) + '" width="'
          + (p - 1.4).toFixed(1) + '" height="' + a.toFixed(1) + '" fill="var(--frio)" opacity="'
          + (i >= 8 ? '1' : '.5') + '"/>';
      }).join('') + '</svg>';
}
function pintarLote() {
  var ids = Object.keys(estado.marcados).filter(function (k) { return estado.marcados[k]; });
  var box = $('r-lote');
  box.hidden = !ids.length;
  if (!ids.length) return;
  box.innerHTML = '<div class="cartao" style="padding:12px 14px">'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'
    + '<b style="font-size:.85rem;color:var(--roxo-forte)">' + ids.length + ' marcado(s)</b>'
    + '<select id="lt-uf" aria-label="Estado da sede" style="font:inherit;font-size:.82rem;padding:6px 9px;border:1.5px solid var(--linha);border-radius:8px">'
      + '<option value="">Estado da sede…</option>' + UFS.map(function (u) { return '<option>' + u + '</option>'; }).join('')
    + '</select>'
    + '<select id="lt-at" aria-label="Área de atuação" style="font:inherit;font-size:.82rem;padding:6px 9px;border:1.5px solid var(--linha);border-radius:8px">'
      + '<option value="">Área de atuação…</option>'
      + REGIOES.map(function (r) { return '<option value="' + r[0] + '">' + r[1] + '</option>'; }).join('')
      + '<option value="__todas">Brasil inteiro</option>'
    + '</select>'
    + '<select id="lt-cad" aria-label="Cadência de contato" style="font:inherit;font-size:.82rem;padding:6px 9px;border:1.5px solid var(--linha);border-radius:8px">'
      + '<option value="">Rotina de contato…</option><option value="15">A cada 15 dias</option>'
      + '<option value="30">A cada 30 dias</option><option value="60">A cada 60 dias</option>'
      + '<option value="0">Voltar ao padrão da classe</option><option value="off">Dispensar da rotina</option>'
    + '</select>'
    + '<select id="lt-tipo" aria-label="Tipo de relação" style="font:inherit;font-size:.82rem;padding:6px 9px;border:1.5px solid var(--linha);border-radius:8px">'
      + '<option value="">Tipo de relação…</option>'
      + (D.tipos || []).map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('')
    + '</select>'
    + '<select id="lt-cman" aria-label="Classificação na fila" style="font:inherit;font-size:.82rem;padding:6px 9px;border:1.5px solid var(--linha);border-radius:8px">'
      + '<option value="">Classificação na fila…</option><option value="__auto">Deixar o sistema decidir</option>'
      + (D.motivos || []).map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('')
    + '</select>'
    + '<span class="acoes"><button type="button" id="lt-ok" class="pri">Aplicar</button>'
    + '<button type="button" id="lt-nada">Limpar seleção</button></span></div>'
    + '<p class="nota" style="margin-top:7px">Só os campos preenchidos são gravados. O resto de cada ficha fica como está.</p></div>';
}
var UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI',
           'PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

$('r-views').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-w]');
  if (!b) return;
  estado.view = b.dataset.w; pintarRegistros();
});
$('r-busca').addEventListener('input', function (e) { estado.busca = e.target.value; pintarRegistros(); });
$('r-todos').addEventListener('change', function (e) {
  listaRegistros().forEach(function (c) { estado.marcados[c.id] = e.target.checked; });
  pintarRegistros();
});
$('r-tab').addEventListener('click', function (e) {
  var cb = e.target.closest('input[data-m]');
  if (cb) { estado.marcados[cb.dataset.m] = cb.checked; pintarLote(); e.stopPropagation(); return; }
  var s = e.target.closest('button[data-s]');
  if (s) {
    if (estado.ord === s.dataset.s) estado.asc = !estado.asc;
    else { estado.ord = s.dataset.s; estado.asc = false; }
    pintarRegistros();
    return;
  }
  var tr = e.target.closest('tr[data-id]');
  if (tr) abrirFicha(tr.dataset.id, 'cliente');
});
$('r-tab').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  var tr = e.target.closest('tr[data-id]');
  if (tr) abrirFicha(tr.dataset.id, 'cliente');
});
$('r-lote').addEventListener('click', function (e) {
  if (e.target.id === 'lt-nada') { estado.marcados = {}; pintarRegistros(); return; }
  if (e.target.id !== 'lt-ok') return;
  var ids = Object.keys(estado.marcados).filter(function (k) { return estado.marcados[k]; });
  var nomes = {};
  ids.forEach(function (i) { if (IX[i]) nomes[i] = IX[i].nome; });
  var uf = $('lt-uf').value, at = $('lt-at').value, cad = $('lt-cad').value;
  var tipo = $('lt-tipo').value, cman = $('lt-cman').value;
  var fila = [];
  if (uf) fila.push(['/admin/carteira/fichas-lote',
    { itens: ids.map(function (i) { return { cliente_id: i, cliente_nome: nomes[i], estado: uf,
        cidade: (IX[i] && IX[i].cidade) || '' }; }) }]);
  if (at) fila.push(['/admin/carteira/atuacao-lote',
    { ids: ids, nomes: nomes, modo: 'substituir',
      atuacao: at === '__todas' ? REGIOES.map(function (r) { return r[0]; }) : [at] }]);
  if (cad) fila.push(['/admin/carteira/rotina-lote',
    { ids: ids, nomes: nomes, dispensa: cad === 'off', cadencia: cad === 'off' ? 0 : +cad }]);
  if (tipo || cman) {
    var corpo = { ids: ids, nomes: nomes,
                  dispensa: cad === 'off', cadencia: cad && cad !== 'off' ? +cad : 0 };
    if (tipo) corpo.tipo = tipo;
    if (cman) corpo.classe_manual = cman === '__auto' ? '' : cman;
    fila.push(['/admin/carteira/rotina-lote', corpo]);
  }
  if (!fila.length) { recado('Escolha o que aplicar antes.', true); return; }
  var p = Promise.resolve();
  fila.forEach(function (f) { p = p.then(function () { return gravar(f[0], f[1]); }); });
  p.then(function () { estado.marcados = {}; recado('Gravado em ' + ids.length + ' cliente(s).'); atualizar(); });
});

/* ═══ FICHA (gaveta com endereço próprio) ════════════════════════════════ */
function abrirFicha(id, tipo, semRolar) {
  tipo = tipo || 'cliente';
  abertaId = id; abertoTipo = tipo;
  history.replaceState(null, '', '#/' + (tipo === 'lead' ? 'lead' : 'cliente') + '/' + id);
  $('tela').innerHTML = tipo === 'lead' ? fichaLead(id) : fichaCliente(id);
  document.body.style.overflow = 'hidden';
  var x = $('fx');
  if (x && !semRolar) x.focus();
}
function fecharFicha(silencioso) {
  $('tela').innerHTML = '';
  document.body.style.overflow = '';
  abertaId = null;
  if (!silencioso) history.replaceState(null, '', '#/' + estado.tela);
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && $('tela').innerHTML) fecharFicha();
});

function stat(k, v) { return '<div class="stat"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }

function fichaCliente(id) {
  var c = IX[id];
  if (!c) return '';
  var f = (D.fila || []).filter(function (x) { return x.id === id; })[0];
  var d = DIR[c.direcao] || ['—', 'classe'];
  var anos = Object.keys(c.ytd_anos).sort();
  var log = INTER.filter(function (i) { return i.cliente === id; });
  var cor = c.dispensa_rotina ? 'var(--texto3)' : (c.contato_urgente ? 'var(--atencao)' : 'var(--bom)');
  return '<button class="veu" id="veu" type="button" aria-label="Fechar"></button>'
  + '<aside class="gaveta" role="dialog" aria-modal="true" aria-label="Ficha de ' + esc(c.nome) + '">'
  + '<div class="gtopo"><div style="min-width:0">'
    + '<p class="olho" style="margin-bottom:3px">Cliente · classe ' + c.classe + ' · entrou em ' + c.coorte + '</p>'
    + '<h2 style="word-break:break-word">' + esc(c.nome) + '</h2>'
    + '<p style="margin-top:4px;color:var(--texto2);font-size:.79rem">' + esc(c.perfil)
      + ' · compra a cada ~' + (c.intervalo || '—') + ' dias · ' + c.compras + ' compras</p>'
    + '</div><button class="x" id="fx" type="button" aria-label="Fechar ficha">✕</button></div>'
  + '<div class="gcorpo">'
    + '<div class="url">' + location.origin + '/admin/carteira#/cliente/' + esc(id) + '</div>'
    + (f ? '<div class="cartao" style="border-color:var(--roxo-borda)">'
        + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap">'
        + '<h3>Por que está na fila</h3><span class="mono" style="font-weight:700;font-size:.82rem">'
        + (f.peso ? moeda(f.peso) + ' em jogo' : 'só rotina') + '</span></div>'
        + '<p class="nota" style="margin-top:5px">' + esc(f.texto) + '</p></div>' : '')

    + '<div class="cartao" style="border-color:' + (c.contato_urgente ? '#f0dcae' : '#cfe6da') + '">'
      + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap">'
      + '<h3>Rotina de contato</h3><span class="mono" style="font-weight:700;font-size:.79rem;color:' + cor + '">'
      + esc(c.contato_rotulo) + '</span></div>'
      + '<p class="nota" style="margin-top:5px">Um contato a cada ' + c.cadencia + ' dias'
      + (c.cadencia_propria ? ' (cadência própria deste cliente)' : ' (padrão da classe ' + c.classe + ')') + '. '
      + (c.dispensa_rotina
          ? 'Ele está fora da rotina e só aparece na fila se houver alerta comercial.'
          : 'Registrar um contato zera o relógio e ele volta sozinho no fim do prazo.') + '</p>'
      + '<div class="acoes" style="margin-top:10px">'
        + '<button class="pri" type="button" data-a="contato">Registrar contato</button>'
        + '<button type="button" data-a="dispensa">'
          + (c.dispensa_rotina ? 'Voltar para a rotina' : 'Não precisa de rotina') + '</button>'
      + '</div>'
      + '<div class="campo" style="margin-top:10px"><label for="fc-cad">Cadência própria, em dias</label>'
        + '<input id="fc-cad" type="number" min="1" max="365" placeholder="vazio = padrão da classe ('
        + c.classe + ')" value="' + (c.cadencia_propria ? c.cadencia : '') + '"></div>'
    + '</div>'

    + '<div class="cartao">'
      + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap">'
      + '<h3>Classificação</h3>'
      + '<span class="mono" style="font-size:.76rem;color:var(--texto3)">o sistema diz: '
      + esc(c.motivo_auto_rotulo) + '</span></div>'
      + '<div class="campo" style="margin-top:9px"><label for="fc-tipo">Tipo de relação</label>'
        + '<select id="fc-tipo">' + (D.tipos || []).map(function (t) {
            return '<option value="' + t[0] + '"' + (c.tipo === t[0] ? ' selected' : '') + '>'
              + t[1] + '</option>'; }).join('') + '</select>'
        + '<p class="nota" style="margin-top:4px">' + esc(((D.tipos || []).filter(function (t) {
            return t[0] === c.tipo; })[0] || ['', '', ''])[2]) + '</p></div>'
      + '<div class="campo" style="margin-top:10px"><label for="fc-cman">Como tratar na fila</label>'
        + '<select id="fc-cman">'
        + '<option value="">Deixar o sistema decidir (' + esc(c.motivo_auto_rotulo) + ')</option>'
        + (D.motivos || []).map(function (m) {
            return '<option value="' + m[0] + '"' + (c.classe_manual === m[0] ? ' selected' : '') + '>'
              + m[1] + '</option>'; }).join('') + '</select>'
        + '<p class="nota" style="margin-top:4px">'
        + (c.classe_manual
            ? 'Você trocou a classificação. O rótulo é seu, mas o valor em jogo continua saindo da base, '
              + 'não de um número inventado para combinar com o rótulo.'
            : 'O sistema classifica sozinho pelo que os números dizem. Se ele errar, escolha aqui e '
              + 'escreva o porquê no motivo abaixo.') + '</p></div>'
    + '</div>'
    + '<div class="campo"><label for="fc-motivo">Motivo da situação (texto livre)</label>'
      + '<textarea id="fc-motivo" rows="2" placeholder="Ex.: o dono faleceu em março; a filha assumiu e ainda não retomou.">'
      + esc(c.motivo) + '</textarea></div>'
    + '<div class="grade g2">'
      + '<div class="campo"><label for="fc-uf">Estado da sede</label><select id="fc-uf">'
        + '<option value="">—</option>' + UFS.map(function (u) {
            return '<option' + (c.uf_base === u ? ' selected' : '') + '>' + u + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="campo"><label for="fc-cidade">Cidade</label>'
        + '<input id="fc-cidade" value="' + esc(c.cidade) + '"></div>'
    + '</div>'
    + '<div class="campo"><label>Área de atuação (onde ele vende)</label>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + REGIOES.map(function (r) {
          var on = c.atuacao.indexOf(r[0]) >= 0;
          return '<button class="ficha" type="button" data-at="' + r[0] + '" aria-pressed="' + on + '">'
            + r[1] + '</button>'; }).join('') + '</div></div>'
    + '<div class="campo"><label for="fc-sit">Situação declarada</label><select id="fc-sit">'
      + ['ativo', 'pausado', 'perdido'].map(function (s) {
          return '<option value="' + s + '"' + (c.situacao === s ? ' selected' : '') + '>'
            + (s === 'ativo' ? 'Ativo' : s === 'pausado' ? 'Pausado' : 'Encerrado') + '</option>'; }).join('')
      + '</select></div>'
    + '<div class="acoes"><button class="pri" type="button" data-a="salvar">Salvar ficha</button></div>'

    + '<div class="grade g2">'
      + '<div class="cartao"><h3 style="margin-bottom:8px">Mesmo período, ano a ano</h3>' + barrasAno(c, anos) + '</div>'
      + '<div class="cartao"><h3 style="margin-bottom:8px">Quando ele compra</h3>' + sazCliente(c.mensal) + '</div>'
    + '</div>'
    + '<div class="cartao">'
      + stat('Receita total', cheio(c.receita))
      + stat('Pedido médio', cheio(c.ticket))
      + stat('Maior pedido', cheio(c.tmax))
      + stat('Última compra', dia(c.ultima) + ' · ' + c.recencia + ' dias atrás')
      + stat('Primeira compra', dia(c.primeira))
      + stat('Direção', d[0] + (c.ritmo ? ' · ' + c.ritmo : ''))
      + stat('Área de atuação', c.atuacao_rotulo || 'não preenchida')
      + (c.alias && c.alias.length ? stat('Também aparecia como', esc(c.alias.join(', '))) : '')
    + '</div>'
    + '<div class="cartao"><h3 style="margin-bottom:9px">Histórico de contatos</h3>'
      + (log.length ? '<div class="hist">' + log.map(function (i) {
          return '<div class="it"><span class="d">' + dia(i.data) + '</span>'
            + '<span class="t">' + esc(i.resumo) + '</span>'
            + '<button class="del" type="button" data-del="' + esc(i.id) + '" aria-label="Apagar">✕</button></div>';
        }).join('') + '</div>'
        : '<p class="nota" style="margin-top:0">Nenhum contato registrado ainda.</p>')
      + '<div class="campo" style="margin-top:11px"><label for="fc-nota">Registrar um contato agora</label>'
        + '<textarea id="fc-nota" rows="2" placeholder="O que foi conversado."></textarea></div>'
      + '<div class="acoes" style="margin-top:8px"><button type="button" data-a="contato-texto">Gravar contato</button></div>'
    + '</div>'
  + '</div></aside>';
}

function fichaLead(id) {
  var L = LEAD_IX[id];
  if (!L) return '';
  return '<button class="veu" id="veu" type="button" aria-label="Fechar"></button>'
  + '<aside class="gaveta" role="dialog" aria-modal="true" aria-label="Lead ' + esc(L.nome) + '">'
  + '<div class="gtopo"><div style="min-width:0">'
    + '<p class="olho" style="margin-bottom:3px">Lead'
      + (L.ja_cliente ? ' · JÁ É CLIENTE DA CASA' : '') + '</p>'
    + '<h2 style="word-break:break-word">' + esc(L.nome) + '</h2>'
    + '<p style="margin-top:4px;color:var(--texto2);font-size:.79rem">'
      + esc([L.cidade, L.uf].filter(Boolean).join(' / ') || 'sem cidade') + '</p>'
    + '</div><button class="x" id="fx" type="button" aria-label="Fechar ficha">✕</button></div>'
  + '<div class="gcorpo">'
    + '<div class="url">' + location.origin + '/admin/carteira#/lead/' + esc(id) + '</div>'
    + (L.ja_cliente ? '<div class="cartao" style="border-color:#f0dcae;background:var(--atencao-fundo)">'
        + '<h3>Este nome já está na carteira</h3><p class="nota" style="margin-top:5px">'
        + 'Ele já compra da Piromax (' + moeda(L.cliente_receita) + ' no histórico). '
        + 'Prospectar aqui é ligar para quem já é cliente. Marque como ganho ou remova da lista.</p></div>' : '')
    + '<div class="campo"><label for="fl-etapa">Etapa</label><select id="fl-etapa">'
      + ETAPAS.map(function (e) {
          return '<option value="' + e[0] + '"' + (L.etapa === e[0] ? ' selected' : '') + '>' + e[1] + '</option>';
        }).join('') + '</select></div>'
    + '<div class="grade g2">'
      + '<div class="campo"><label for="fl-contato">Contato</label><input id="fl-contato" value="' + esc(L.contato) + '"></div>'
      + '<div class="campo"><label for="fl-tel">Telefone</label><input id="fl-tel" value="' + esc(L.telefone) + '"></div>'
      + '<div class="campo"><label for="fl-cidade">Cidade</label><input id="fl-cidade" value="' + esc(L.cidade) + '"></div>'
      + '<div class="campo"><label for="fl-uf">UF</label><select id="fl-uf"><option value="">—</option>'
        + UFS.map(function (u) { return '<option' + (L.uf === u ? ' selected' : '') + '>' + u + '</option>'; }).join('')
        + '</select></div>'
    + '</div>'
    + '<div class="campo"><label for="fl-prox">Próximo passo</label>'
      + '<input id="fl-prox" value="' + esc(L.proximo) + '" placeholder="Ex.: mandar tabela de preço"></div>'
    + '<div class="campo"><label for="fl-quando">Para quando</label>'
      + '<input id="fl-quando" type="date" value="' + esc(L.proximo_em || '') + '"></div>'
    + '<div class="campo"><label for="fl-motivo">Observação ou motivo da perda</label>'
      + '<textarea id="fl-motivo" rows="2">' + esc(L.motivo || L.obs || '') + '</textarea></div>'
    + '<div class="acoes"><button class="pri" type="button" data-a="lead-salvar">Salvar lead</button>'
      + '<button type="button" data-a="lead-remover">Remover da lista</button></div>'
  + '</div></aside>';
}

/* um único ouvinte na gaveta: ela é reconstruída a cada gravação */
$('tela').addEventListener('click', function (e) {
  if (e.target.id === 'veu' || e.target.id === 'fx') { fecharFicha(); return; }

  var at = e.target.closest('button[data-at]');
  if (at) { at.setAttribute('aria-pressed', at.getAttribute('aria-pressed') !== 'true'); return; }

  var del = e.target.closest('button[data-del]');
  if (del) {
    fetch('/admin/carteira/interacao/' + del.dataset.del, { method: 'DELETE' })
      .then(function () { atualizar(); recado('Contato apagado.'); });
    return;
  }

  var b = e.target.closest('button[data-a]');
  if (!b) return;
  var id = abertaId, a = b.dataset.a;

  if (a === 'contato') {
    gravar('/admin/carteira/contato', { cliente_id: id }, 'Contato registrado.');
  } else if (a === 'contato-texto') {
    var t = ($('fc-nota').value || '').trim();
    if (!t) { recado('Escreva o que foi conversado.', true); return; }
    gravar('/admin/carteira/contato', { cliente_id: id, resumo: t, tipo: 'contato' }, 'Contato registrado.');
  } else if (a === 'dispensa') {
    salvarFicha(id, { dispensa: !IX[id].dispensa_rotina },
      IX[id].dispensa_rotina ? 'De volta à rotina.' : 'Fora da rotina.');
  } else if (a === 'salvar') {
    salvarFicha(id, {}, 'Ficha salva.');
  } else if (a === 'lead-salvar') {
    gravar('/admin/carteira/lead', {
      id: id, etapa: $('fl-etapa').value, contato: $('fl-contato').value,
      telefone: $('fl-tel').value, cidade: $('fl-cidade').value, uf: $('fl-uf').value,
      proximo: $('fl-prox').value, proximo_em: $('fl-quando').value, motivo: $('fl-motivo').value
    }, 'Lead salvo.');
  } else if (a === 'lead-remover') {
    fetch('/admin/carteira/lead/' + id, { method: 'DELETE' })
      .then(function () { fecharFicha(); atualizar(); recado('Lead removido.'); });
  }
});

function salvarFicha(id, extra, msg) {
  var c = IX[id];
  var corpo = {
    cliente_id: id, cliente_nome: c.nome,
    motivo: $('fc-motivo') ? $('fc-motivo').value : c.motivo,
    cidade: $('fc-cidade') ? $('fc-cidade').value : c.cidade,
    estado: $('fc-uf') ? $('fc-uf').value : c.uf_base,
    situacao: $('fc-sit') ? $('fc-sit').value : c.situacao,
    dispensa: c.dispensa_rotina,
    cadencia: $('fc-cad') ? ($('fc-cad').value || 0) : (c.cadencia_propria ? c.cadencia : 0),
    tipo: $('fc-tipo') ? $('fc-tipo').value : c.tipo,
    classe_manual: $('fc-cman') ? $('fc-cman').value : c.classe_manual,
    atuacao: Array.prototype.slice.call(document.querySelectorAll('[data-at][aria-pressed="true"]'))
      .map(function (x) { return x.dataset.at; })
  };
  for (var k in extra) corpo[k] = extra[k];
  return gravar('/admin/carteira/ficha', corpo, msg);
}

/* ═══ gráficos da ficha ══════════════════════════════════════════════════ */
function barrasAno(c, anos) {
  var vals = anos.map(function (a) { return c.ytd_anos[a] || 0; });
  var max = Math.max.apply(null, vals) || 1;
  var w = 240, h = 92, bw = 46, gap = 26, x0 = 24;
  var s = '<svg viewBox="0 0 ' + w + ' ' + (h + 32) + '" width="100%" style="max-width:' + w
    + 'px" role="img" aria-label="Receita no mesmo período de cada ano">';
  vals.forEach(function (v, i) {
    var a = (v / max) * h, x = x0 + i * (bw + gap);
    var cor = i === vals.length - 1 ? 'var(--s1)' : (i === vals.length - 2 ? 'var(--s2)' : 'var(--s3)');
    s += '<rect x="' + x + '" y="' + (h - a).toFixed(1) + '" width="' + bw + '" height="'
      + Math.max(a, 1).toFixed(1) + '" rx="2" fill="' + cor + '"/>'
      + '<text x="' + (x + bw / 2) + '" y="' + (h + 14) + '" font-size="10" fill="var(--texto3)" text-anchor="middle">' + anos[i] + '</text>'
      + '<text x="' + (x + bw / 2) + '" y="' + (h + 27) + '" font-size="10" fill="var(--texto)" text-anchor="middle" font-weight="600">'
      + moeda(v).replace('R$ ', '') + '</text>';
  });
  return s + '</svg><p class="nota" style="margin-top:2px">1º de janeiro até o mesmo dia em cada ano. '
    + 'É a mesma janela dos dois lados, por isso dá para comparar.</p>';
}
function sazCliente(m) {
  var L = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  var max = Math.max.apply(null, m) || 1, w = 240, h = 82, p = w / 12;
  var s = '<svg viewBox="0 0 ' + w + ' ' + (h + 18) + '" width="100%" style="max-width:' + w
    + 'px" role="img" aria-label="Receita acumulada por mês do ano">';
  m.forEach(function (v, i) {
    var a = Math.max((v / max) * h, 1);
    s += '<rect x="' + (i * p + 1).toFixed(1) + '" y="' + (h - a).toFixed(1) + '" width="'
      + (p - 2).toFixed(1) + '" height="' + a.toFixed(1) + '" rx="1.5" fill="var(--s1)" opacity="'
      + (0.35 + 0.65 * (v / max)).toFixed(2) + '"/>'
      + '<text x="' + (i * p + p / 2).toFixed(1) + '" y="' + (h + 13)
      + '" font-size="9" fill="var(--texto3)" text-anchor="middle">' + L[i] + '</text>';
  });
  return s + '</svg><p class="nota" style="margin-top:2px">Todos os anos somados, para ver o desenho do ano dele.</p>';
}

/* ═══ ANÁLISE ════════════════════════════════════════════════════════════ */
var SERIE = ['var(--s3)', 'var(--s2)', 'var(--s1)'];   /* mais antigo → mais recente */

function pintarAnalise() {
  if (!D) { $('a-corpo').innerHTML = '<div class="cartao">' + semBase() + '</div>'; return; }
  $('a-corpo').innerHTML = capVisao() + capAnoAno() + capDirecao() + capConcentracao()
    + capRegiao() + capProjecao();
  ligarDica();
}
function anosLista() { return D.anos.anos.map(function (a) { return String(a.ano); }); }
function corAno(a) {
  var i = anosLista().indexOf(String(a));
  return SERIE[Math.max(0, SERIE.length - anosLista().length + i)];
}
function kv(k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }

function capVisao() {
  var A = D.anos.anos, ult = A[A.length - 1], pri = A[0];
  var corte = D.anos.corte;
  return '<section class="cap" id="visao"><header><h2>Visão geral</h2>'
    + '<span class="quando">três anos sobrepostos</span></header>'
    + '<div class="cartao">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px">'
      + '<h3>Receita por mês, um ano sobre o outro</h3>' + legendaAnos() + '</div>'
      + linhasAno()
      + '<p class="nota">O ano corrente termina com ponto vazado porque o mês ainda está correndo: '
      + 'ele fechou ' + cheio(D.mensal[D.mensal.length - 1].receita) + ' até o dia ' + corte.slice(0, 2)
      + ', contra o mês inteiro dos anos anteriores.</p>'
      + tabelaMeses()
      + '<h3 style="margin-top:20px">O mesmo pedaço do ano, nos três anos</h3>'
      + '<p class="nota" style="margin-top:4px">Tudo abaixo é 1º de janeiro a ' + corte
      + '. Nunca um ano inteiro contra um ano pela metade.</p>'
      + tabelaAnos(A)
      + leituraAnos(pri, ult)
      + '<details class="saiba"><summary>Por que não comparo com os últimos 180 dias</summary>'
      + '<p>Fogos têm estação. Os últimos 180 dias pegam junho a setembro; os 180 anteriores pegam janeiro a maio. '
      + 'São épocas diferentes do ano, então a queda que aparece pode ser só o calendário. Comparar o mesmo pedaço '
      + 'do calendário de cada ano tira a estação da conta.</p></details>'
    + '</div></section>';
}
function leituraAnos(pri, ult) {
  if (!pri || !ult || pri.ano === ult.ano) return '';
  var dif = ult.receita - pri.receita;
  return '<p class="nota"><b>A leitura que importa:</b> ' + ult.ano + ' tem ' + ult.pedidos
    + ' pedidos contra ' + pri.pedidos + ' em ' + pri.ano + ', e ' + ult.clientes
    + ' clientes comprando contra ' + pri.clientes + ', mas fatura ' + moeda(Math.abs(dif))
    + (dif < 0 ? ' a menos' : ' a mais') + '. O pedido médio foi de ' + cheio(pri.ticket)
    + ' para ' + cheio(ult.ticket) + '.'
    + (dif < 0 ? ' A empresa está vendendo para mais gente, em pedaços menores.' : '') + '</p>'
    + '<p class="nota fraca">Os "clientes novos" do primeiro ano são efeito do começo da base: '
    + 'como o arquivo começa ali, todo mundo aparece como novo naquele ano.</p>';
}
function legendaAnos() {
  return '<div class="legenda">' + D.anos.anos.map(function (a) {
    return '<span><i style="background:' + corAno(a.ano) + '"></i>' + a.ano
      + (a.ano === D.anos.ultimo_ano ? ' <span style="color:var(--texto3);font-weight:400">até '
        + D.anos.corte + '</span>' : '') + '</span>';
  }).join('') + '</div>';
}
function linhasAno() {
  var M = D.anos.mensal, lista = anosLista();
  var ultMes = +D.mensal[D.mensal.length - 1].mes.split('-')[1] - 1;
  var w = 620, h = 204, pl = 58, pr = 46, pt = 16, pb = 26;
  var iw = w - pl - pr, ih = h - pt - pb, max = 0;
  lista.forEach(function (a) { (M[a] || []).forEach(function (v) { if (v > max) max = v; }); });
  max = (max || 1) * 1.08;
  var px = function (i) { return pl + (i / 11) * iw; };
  var py = function (v) { return pt + ih - (v / max) * ih; };
  var s = '<div class="svgbox"><svg id="svg-anos" viewBox="0 0 ' + w + ' ' + h
    + '" width="100%" style="max-width:' + w + 'px;min-width:380px" role="img" '
    + 'aria-label="Receita por mês nos últimos três anos, sobrepostos">';
  [0, 0.5, 1].forEach(function (f) {
    var y = py(max * f);
    s += '<line x1="' + pl + '" x2="' + (pl + iw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1)
      + '" stroke="var(--linha)" stroke-width="1"/>'
      + '<text x="' + (pl - 8) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="10" fill="var(--texto3)" '
      + 'text-anchor="end">' + (f ? moeda(max * f).replace('R$ ', '') : '0') + '</text>';
  });
  MS.forEach(function (m, i) {
    s += '<text x="' + px(i).toFixed(1) + '" y="' + (h - 9) + '" font-size="10" fill="var(--texto3)" '
      + 'text-anchor="middle">' + m + '</text>';
  });
  var usados = [];
  lista.forEach(function (a) {
    var vs = M[a] || [], cor = corAno(a);
    var fim = (+a === D.anos.ultimo_ano) ? ultMes : 11;
    var pts = [];
    for (var i = 0; i <= fim; i++) pts.push(px(i).toFixed(1) + ',' + py(vs[i] || 0).toFixed(1));
    s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + cor
      + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    var parcial = (+a === D.anos.ultimo_ano);
    s += '<circle cx="' + px(fim).toFixed(1) + '" cy="' + py(vs[fim] || 0).toFixed(1) + '" r="4.5" fill="'
      + (parcial ? '#fff' : cor) + '" stroke="' + cor + '" stroke-width="2"/>';
    var lx = px(fim) + 9, anc = 'start', ly = py(vs[fim] || 0) - 9;
    if (fim === 11) { lx = px(fim) - 4; anc = 'end'; }
    usados.forEach(function (u) { if (Math.abs(u - ly) < 13) ly = u + 13; });
    usados.push(ly);
    s += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" font-size="11" font-weight="700" fill="'
      + cor + '" text-anchor="' + anc + '">' + a + '</text>';
  });
  for (var i = 0; i < 12; i++) {
    s += '<rect class="hov" data-m="' + i + '" x="' + (px(i) - iw / 22).toFixed(1) + '" y="' + pt
      + '" width="' + (iw / 11).toFixed(1) + '" height="' + ih + '" fill="transparent"/>';
  }
  s += '<line id="cruz" x1="0" x2="0" y1="' + pt + '" y2="' + (pt + ih)
    + '" stroke="var(--texto2)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>';
  return s + '</svg><div id="dica-anos" class="dica" hidden></div></div>';
}
function ligarDica() {
  var svg = $('svg-anos');
  if (!svg) return;
  var dica = $('dica-anos'), cruz = $('cruz'), M = D.anos.mensal;
  var ultMes = +D.mensal[D.mensal.length - 1].mes.split('-')[1] - 1;
  svg.addEventListener('mousemove', function (e) {
    var r = e.target.closest('rect.hov');
    if (!r) { dica.hidden = true; cruz.setAttribute('opacity', '0'); return; }
    var i = +r.dataset.m, meio = +r.getAttribute('x') + +r.getAttribute('width') / 2;
    cruz.setAttribute('x1', meio); cruz.setAttribute('x2', meio); cruz.setAttribute('opacity', '1');
    dica.hidden = false;
    dica.innerHTML = '<b>' + MS[i] + '</b>' + anosLista().map(function (a) {
      var v = (M[a] || [])[i] || 0, futuro = (+a === D.anos.ultimo_ano && i > ultMes);
      var parcial = (+a === D.anos.ultimo_ano && i === ultMes);
      return '<span><i style="background:' + corAno(a) + '"></i>' + a + '<em>'
        + (futuro ? 'ainda não' : moeda(v) + (parcial ? ' (parcial)' : '')) + '</em></span>';
    }).join('');
    var p = svg.parentNode.getBoundingClientRect();
    dica.style.left = Math.min(Math.max(e.clientX - p.left - 75, 0), Math.max(0, p.width - 160)) + 'px';
    dica.style.top = (e.clientY - p.top + 14) + 'px';
  });
  svg.addEventListener('mouseleave', function () {
    dica.hidden = true; cruz.setAttribute('opacity', '0');
  });
}
function tabelaMeses() {
  var M = D.anos.mensal, lista = anosLista();
  var ultMes = +D.mensal[D.mensal.length - 1].mes.split('-')[1] - 1;
  var penult = lista[lista.length - 2], ultA = lista[lista.length - 1];
  var linhas = MS.map(function (m, i) {
    var a = (M[penult] || [])[i] || 0, b = (M[ultA] || [])[i] || 0;
    return '<tr><td class="nm">' + m + '</td>'
      + lista.map(function (y) {
          var v = (M[y] || [])[i] || 0, futuro = (+y === D.anos.ultimo_ano && i > ultMes);
          return '<td class="num">' + (futuro ? '—' : moeda(v)) + '</td>';
        }).join('')
      + '<td class="num ' + (b >= a ? 'pos' : 'neg') + '">'
      + (i > ultMes || !a ? '—' : pct((b / a - 1) * 100)) + '</td></tr>';
  }).join('');
  return '<details class="saiba"><summary>Ver os mesmos números em tabela</summary>'
    + '<div class="tw" style="margin-top:8px"><table style="min-width:440px"><thead><tr><th>Mês</th>'
    + lista.map(function (y) { return '<th class="num">' + y + '</th>'; }).join('')
    + '<th class="num">' + String(ultA).slice(2) + ' vs ' + String(penult).slice(2) + '</th></tr></thead>'
    + '<tbody>' + linhas + '</tbody></table></div></details>';
}
function tabelaAnos(A) {
  var linhas = [
    ['Receita', function (a) { return moeda(a.receita); }],
    ['Pedidos', function (a) { return a.pedidos; }],
    ['Clientes que compraram', function (a) { return a.clientes; }],
    ['Pedido médio', function (a) { return cheio(a.ticket); }],
    ['Clientes novos na janela', function (a) { return a.novos; }],
    ['Peso dos 10 maiores', function (a) { return a.top10.toFixed(0) + '%'; }]
  ].map(function (l) {
    return '<tr><td class="nm">' + l[0] + '</td>'
      + A.map(function (a) { return '<td class="num">' + l[1](a) + '</td>'; }).join('') + '</tr>';
  }).join('');
  return '<div class="tw" style="margin-top:10px"><table style="min-width:440px"><thead><tr>'
    + '<th>1º jan – ' + D.anos.corte + '</th>'
    + A.map(function (a) { return '<th class="num">' + a.ano + '</th>'; }).join('')
    + '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
}

function capAnoAno() {
  var A = D.anos, lista = anosLista();
  var cab = '<thead><tr><th>Cliente</th>'
    + lista.map(function (y) { return '<th class="num">' + y + '</th>'; }).join('')
    + '<th class="num">vs. média</th></tr></thead>';
  var linhas = function (l, cor) {
    return l.map(function (x) {
      return '<tr data-id="' + esc(x.id) + '" tabindex="0"><td class="nm">' + esc(x.nome) + '</td>'
        + lista.map(function (y) {
            var v = x.anos[y] || 0;
            return '<td class="num">' + (v ? moeda(v) : '—') + '</td>';
          }).join('')
        + '<td class="num ' + cor + '">' + (x.dif > 0 ? '+' : '−')
        + moeda(Math.abs(x.dif)).replace('R$ ', '') + '</td></tr>';
    }).join('');
  };
  var ret = A.anos.filter(function (a) { return a.base_ant; }).map(function (a) {
    var p = a.retidos / a.base_ant * 100;
    return '<div class="par"><span class="n"><b>' + a.ano + '</b> contra ' + (a.ano - 1) + '</span>'
      + '<small>' + a.retidos + ' voltaram de ' + a.base_ant + '</small>'
      + '<small>' + a.sumiram + ' sumiram</small><small>' + a.novos + ' novos</small>'
      + '<small style="font-weight:700;color:' + (p >= 70 ? 'var(--bom)' : 'var(--atencao)')
      + ';min-width:58px;text-align:right">' + p.toFixed(0) + '% ficaram</small></div>';
  }).join('');
  var perdido = A.desce.reduce(function (s, x) { return s + x.dif; }, 0);
  var F = A.fechado, ys = Object.keys(F).sort();
  var fech = ys.length >= 2 ? (function () {
    var a = F[ys[ys.length - 2]], b = F[ys[ys.length - 1]];
    return '<div class="cartao" style="margin-top:12px"><h3>Os anos que já fecharam</h3>'
      + '<p class="nota" style="margin-top:4px;margin-bottom:8px">Janeiro a dezembro inteiros. '
      + 'O ano corrente fica de fora porque ainda não acabou.</p>'
      + '<div class="tw"><table style="min-width:440px"><thead><tr><th>Ano cheio</th>'
      + '<th class="num">Receita</th><th class="num">Pedidos</th><th class="num">Clientes</th>'
      + '<th class="num">Pedido médio</th></tr></thead><tbody>'
      + ys.map(function (y) {
          var f = F[y];
          return '<tr><td class="nm">' + y + '</td><td class="num">' + moeda(f.receita)
            + '</td><td class="num">' + f.pedidos + '</td><td class="num">' + f.clientes
            + '</td><td class="num">' + cheio(f.ticket) + '</td></tr>';
        }).join('')
      + '<tr><td class="nm" style="color:var(--texto2)">' + ys[ys.length - 1] + ' vs ' + ys[ys.length - 2] + '</td>'
      + '<td class="num ' + (b.receita >= a.receita ? 'pos' : 'neg') + '">' + pct((b.receita / a.receita - 1) * 100) + '</td>'
      + '<td class="num ' + (b.pedidos >= a.pedidos ? 'pos' : 'neg') + '">' + pct((b.pedidos / a.pedidos - 1) * 100) + '</td>'
      + '<td class="num ' + (b.clientes >= a.clientes ? 'pos' : 'neg') + '">' + pct((b.clientes / a.clientes - 1) * 100) + '</td>'
      + '<td class="num ' + (b.ticket >= a.ticket ? 'pos' : 'neg') + '">' + pct((b.ticket / a.ticket - 1) * 100) + '</td>'
      + '</tr></tbody></table></div></div>';
  })() : '';
  return '<section class="cap" id="anoaano"><header><h2>Ano a ano</h2>'
    + '<span class="quando">quem entrou, quem saiu, quem mudou</span></header>'
    + (ret ? '<div class="cartao"><h3>Quem volta de um ano para o outro</h3>'
        + '<p class="nota" style="margin-top:4px;margin-bottom:6px">Clientes que compraram no mesmo pedaço '
        + 'do ano anterior e voltaram a comprar neste.</p>' + ret + '</div>' : '')
    + '<div class="cartao" style="margin-top:12px"><h3>Quem mais cresceu</h3>'
      + '<p class="nota" style="margin-top:4px;margin-bottom:8px">Os anos lado a lado, sempre de 1º de janeiro a '
      + A.corte + '. A última coluna é o ano corrente contra a média dos anteriores.</p>'
      + '<div class="tw"><table class="movers">' + cab + '<tbody>' + linhas(A.sobe, 'pos') + '</tbody></table></div>'
      + '<h3 style="margin-top:20px">Quem mais caiu</h3>'
      + '<p class="nota" style="margin-top:4px;margin-bottom:8px">Estes ' + A.desce.length + ' somam '
      + moeda(Math.abs(perdido)) + ' a menos que a média dos anos anteriores.</p>'
      + '<div class="tw"><table class="movers">' + cab + '<tbody>' + linhas(A.desce, 'neg') + '</tbody></table></div>'
    + '</div>' + fech + '</section>';
}

function capDirecao() {
  var ordem = ['crescendo', 'estavel', 'em queda', 'queda forte', 'parou', 'novo'];
  var ultA = String(D.anos.ultimo_ano);
  var l = ordem.map(function (k) {
    var g = D.clientes.filter(function (c) { return c.direcao === k; });
    return { k: k, n: g.length, r: g.reduce(function (a, c) { return a + (c.ytd_anos[ultA] || 0); }, 0) };
  });
  var max = Math.max.apply(null, l.map(function (x) { return x.r; })) || 1;
  var corpo = l.map(function (x) {
    var d = DIR[x.k];
    var cor = d[1] === 'crescer' ? 'var(--bom)' : d[1] === 'queda' ? 'var(--ruim)'
            : d[1] === 'novo' ? 'var(--s1)' : 'var(--frio)';
    return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--linha2)">'
      + '<span style="flex:0 0 96px;font-weight:600;font-size:.82rem">' + d[0] + '</span>'
      + '<span class="mono" style="flex:0 0 40px;color:var(--texto2);font-size:.76rem">' + x.n + '</span>'
      + '<span style="flex:1;min-width:60px;height:12px;background:var(--linha);border-radius:3px;overflow:hidden;display:block">'
        + '<span style="display:block;height:100%;width:' + ((x.r / max) * 100).toFixed(1) + '%;background:' + cor + '"></span></span>'
      + '<span class="mono" style="flex:0 0 78px;text-align:right;font-size:.79rem;font-weight:600">' + moeda(x.r) + '</span></div>';
  }).join('');
  return '<section class="cap" id="direcao"><header><h2>Direção</h2>'
    + '<span class="quando">receita de ' + ultA + ' por estado do cliente</span></header>'
    + '<div class="cartao">' + corpo
    + '<p class="nota">Não é RFM nem "campeões / em risco". É uma pergunta só: '
    + '<b>ele está comprando mais ou menos do que comprava nesta mesma altura do ano?</b> '
    + 'A barra mede a receita do ano corrente, a contagem ao lado é o número de clientes. '
    + 'Quem <b>parou</b> dá zero aqui por definição; o que ele trazia antes aparece na fila de Hoje, '
    + 'que é onde essa conta importa.</p>'
    + '<details class="saiba"><summary>O que cada estado quer dizer</summary><p>'
    + '<b>Crescendo</b>: subiu mais de 10% contra a média dos anos anteriores na mesma janela. '
    + '<b>Estável</b>: entre −10% e +10%. <b>Em queda</b>: caiu entre 10% e 30%. '
    + '<b>Queda forte</b>: caiu mais de 30%. <b>Parou</b>: comprava antes e não comprou nada neste ano. '
    + '<b>Novo</b>: ainda não tem um ano anterior inteiro para comparar, e por isso nunca é chamado de perdido.'
    + '</p></details></div></section>';
}

function capConcentracao() {
  var ord = D.clientes.slice().sort(function (a, b) { return b.receita - a.receita; });
  var total = D.meta.receita;
  var conta = function (cl) { return ord.filter(function (c) { return c.classe === cl; }); };
  var a = conta('A'), b = conta('B'), c = conta('C');
  var som = function (l) { return l.reduce(function (s, x) { return s + x.receita; }, 0); };
  return '<section class="cap" id="concentracao"><header><h2>Concentração</h2>'
    + '<span class="quando">curva ABC</span></header>'
    + '<div class="cartao">'
      + '<div class="kvlinha" style="margin-bottom:14px">'
        + kv(a.length + ' clientes A', (som(a) / total * 100).toFixed(0) + '% da receita')
        + kv(b.length + ' clientes B', (som(b) / total * 100).toFixed(0) + '%')
        + kv(c.length + ' clientes C', (som(c) / total * 100).toFixed(0) + '%')
      + '</div>'
      + curvaABC(ord, total)
      + '<p class="nota">O eixo horizontal são os ' + ord.length + ' clientes do maior para o menor; '
      + 'o vertical, quanto da receita eles já somam. O primeiro sozinho é <b>'
      + (ord[0].receita / total * 100).toFixed(1) + '%</b> de tudo, ' + esc(ord[0].nome)
      + '. Isso é risco, não mérito: se ele parar, o buraco é esse.</p>'
      + '<h3 style="margin-top:18px">Peso dos dez maiores, ano a ano</h3>'
      + '<p class="nota" style="margin-top:4px;margin-bottom:8px">Quanto da receita da janela veio dos dez maiores clientes.</p>'
      + D.anos.anos.map(function (x) {
          return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">'
            + '<span class="mono" style="flex:0 0 40px;font-size:.79rem;font-weight:600">' + x.ano + '</span>'
            + '<span style="flex:1;height:14px;background:var(--linha);border-radius:3px;overflow:hidden;display:block">'
            + '<span style="display:block;height:100%;width:' + x.top10.toFixed(1) + '%;background:'
            + corAno(x.ano) + '"></span></span>'
            + '<span class="mono" style="flex:0 0 44px;text-align:right;font-size:.79rem;font-weight:700">'
            + x.top10.toFixed(0) + '%</span></div>';
        }).join('')
    + '</div></section>';
}
function curvaABC(ord, total) {
  var w = 600, h = 136, acum = 0;
  var pts = ord.map(function (c, i) {
    acum += c.receita;
    return ((i + 1) / ord.length * (w - 54) + 4).toFixed(1) + ',' + (h - (acum / total) * (h - 8)).toFixed(1);
  });
  var nA = ord.filter(function (c) { return c.classe === 'A'; }).length;
  var nB = nA + ord.filter(function (c) { return c.classe === 'B'; }).length;
  var xA = nA / ord.length * (w - 54) + 4, xB = nB / ord.length * (w - 54) + 4;
  var ticks = [[1, '100%'], [0.5, '50%']].map(function (t) {
    var y = (h - t[0] * (h - 8)).toFixed(1);
    return '<line x1="4" x2="' + (w - 46) + '" y1="' + y + '" y2="' + y + '" stroke="var(--linha)" stroke-width="1"/>'
      + '<text x="' + (w - 42) + '" y="' + (+y + 3.5).toFixed(1) + '" font-size="10" fill="var(--texto3)">' + t[1] + '</text>';
  }).join('');
  return '<div class="svgbox"><svg viewBox="0 0 ' + w + ' ' + (h + 22) + '" width="100%" style="max-width:'
    + w + 'px;min-width:340px" role="img" aria-label="Curva ABC: receita acumulada dos clientes do maior para o menor">'
    + ticks
    + '<rect x="4" y="0" width="' + (xA - 4).toFixed(1) + '" height="' + h + '" fill="var(--s1)" opacity=".09"/>'
    + '<rect x="' + xA.toFixed(1) + '" y="0" width="' + (xB - xA).toFixed(1) + '" height="' + h + '" fill="var(--frio)" opacity=".10"/>'
    + '<polyline points="4,' + h + ' ' + pts.join(' ') + '" fill="none" stroke="var(--s1)" stroke-width="2"/>'
    + '<text x="' + ((xA + 4) / 2).toFixed(1) + '" y="14" font-size="10" fill="var(--s1)" text-anchor="middle" font-weight="700">A</text>'
    + '<text x="' + ((xA + xB) / 2).toFixed(1) + '" y="14" font-size="10" fill="var(--frio)" text-anchor="middle" font-weight="700">B</text>'
    + '<text x="' + ((xB + w - 54) / 2).toFixed(1) + '" y="14" font-size="10" fill="var(--texto3)" text-anchor="middle" font-weight="700">C</text>'
    + '<text x="4" y="' + (h + 15) + '" font-size="10" fill="var(--texto3)">1º cliente</text>'
    + '<text x="' + (w - 54) + '" y="' + (h + 15) + '" font-size="10" fill="var(--texto3)" text-anchor="end">'
    + ord.length + 'º</text></svg></div>';
}

function capRegiao() {
  var com = D.clientes.filter(function (c) { return c.uf_base; });
  if (!com.length) {
    return '<section class="cap" id="regiao"><header><h2>Região</h2><span class="quando">sem dado</span></header>'
      + '<div class="cartao"><p class="vazio" style="padding:22px 12px">'
      + 'Nenhum dos ' + D.clientes.length + ' clientes tem estado preenchido, então este capítulo está vazio.</p>'
      + '<p class="nota">Preferi mostrar a tela vazia de verdade a inventar estados para ela ficar bonita. '
      + 'Preencha em <b>Registros</b>, marcando vários clientes de uma vez. Este capítulo separa duas coisas '
      + 'que hoje se confundem: a <b>sede</b> do cliente e a <b>área onde ele vende</b>. Um cliente com sede em '
      + 'Minas que revende no Nordeste conta como Nordeste na análise de mercado e como Minas na de logística.</p>'
      + '</div></section>';
  }
  var porUF = {}, porAt = {};
  com.forEach(function (c) { porUF[c.uf_base] = (porUF[c.uf_base] || 0) + c.receita; });
  D.clientes.forEach(function (c) {
    (c.atuacao_ufs && c.atuacao_ufs.length ? [c.atuacao_rotulo] : []).forEach(function (r) {
      porAt[r] = (porAt[r] || 0) + c.receita;
    });
  });
  var barra = function (obj, titulo, nota) {
    var ks = Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; });
    if (!ks.length) return '';
    var max = obj[ks[0]] || 1;
    return '<h3 style="margin-top:14px">' + titulo + '</h3><p class="nota" style="margin:4px 0 8px">' + nota + '</p>'
      + ks.map(function (k) {
          return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'
            + '<span style="flex:0 0 110px;font-size:.8rem;font-weight:600">' + esc(k) + '</span>'
            + '<span style="flex:1;height:13px;background:var(--linha);border-radius:3px;overflow:hidden;display:block">'
            + '<span style="display:block;height:100%;width:' + (obj[k] / max * 100).toFixed(1) + '%;background:var(--s1)"></span></span>'
            + '<span class="mono" style="flex:0 0 76px;text-align:right;font-size:.78rem;font-weight:600">'
            + moeda(obj[k]) + '</span></div>';
        }).join('');
  };
  return '<section class="cap" id="regiao"><header><h2>Região</h2>'
    + '<span class="quando">' + com.length + ' de ' + D.clientes.length + ' com estado preenchido</span></header>'
    + '<div class="cartao">'
    + barra(porUF, 'Por sede do cliente', 'Onde ele está. Serve para frete, visita e representante.')
    + barra(porAt, 'Por área de atuação', 'Onde ele vende. Serve para ler mercado, e não coincide com a sede.')
    + '</div></section>';
}

function capProjecao() {
  var p = D.previsao.empresa, bt = D.backtest.resumo, mm = p.meses;
  if (!mm || !mm.length) return '';
  var max = Math.max.apply(null, mm.map(function (m) {
    return Math.max(m.prev, m.h1 || 0, m.h2 || 0); })) * 1.1;
  var w = 600, h = 150, gw = w / mm.length;
  var s = '<div class="svgbox"><svg viewBox="0 0 ' + w + ' ' + (h + 46) + '" width="100%" style="max-width:'
    + w + 'px;min-width:340px" role="img" aria-label="Projeção dos próximos meses comparada com os anos anteriores">';
  mm.forEach(function (m, i) {
    var x = i * gw + 14, bw = (gw - 34) / 3;
    [[m.h1, 'var(--s3)'], [m.h2, 'var(--s2)'], [m.prev, 'var(--s1)']].forEach(function (b, j) {
      var v = b[0] || 0, a = Math.max((v / max) * h, 1);
      s += '<rect x="' + (x + j * (bw + 4)).toFixed(1) + '" y="' + (h - a).toFixed(1) + '" width="'
        + bw.toFixed(1) + '" height="' + a.toFixed(1) + '" rx="2" fill="' + b[1] + '"/>';
    });
    s += '<text x="' + (x + (bw * 3 + 8) / 2).toFixed(1) + '" y="' + (h + 15)
      + '" font-size="11" fill="var(--texto2)" text-anchor="middle">' + mesrot(m.mes) + '</text>'
      + '<text x="' + (x + (bw * 3 + 8) / 2).toFixed(1) + '" y="' + (h + 30)
      + '" font-size="11" fill="var(--texto)" text-anchor="middle" font-weight="700">'
      + moeda(m.prev).replace('R$ ', '') + '</text>';
  });
  s += '<text x="0" y="' + (h + 44) + '" font-size="10" fill="var(--texto3)">'
    + 'as duas primeiras barras são os anos anteriores; a azul é a média dos dois, que é a projeção</text></svg></div>';
  var blocos = D.backtest.blocos.map(function (b) {
    return '<div class="par"><span class="n">' + b.rot + '</span>'
      + '<small>real ' + moeda(b.real) + '</small><small>previsto ' + moeda(b.prev) + '</small>'
      + '<small class="' + (b.erro >= 0 ? 'pos' : 'neg') + '" style="font-weight:700;min-width:60px;text-align:right">'
      + pct(b.erro) + '</small></div>';
  }).join('');
  return '<section class="cap" id="projecao"><header><h2>Projeção</h2>'
    + '<span class="quando">' + mesrot(mm[0].mes) + ' – ' + mesrot(mm[mm.length - 1].mes) + '</span></header>'
    + '<div class="cartao">'
      + '<div class="kvlinha" style="margin-bottom:14px">'
        + kv('Total projetado', moeda(p.total))
        + kv('Mês corrente, já faturado', moeda(p.ja_mes))
        + kv('Falta no mês corrente', moeda(mm[0].falta || 0))
      + '</div>' + s
      + '<p class="nota">A conta é deliberadamente burra: para cada cliente, em cada mês, a '
      + '<b>média do que ele comprou naquele mês nos dois anos anteriores</b>. Sem suavização, sem tendência, '
      + 'sem peso maior para o ano recente. Seis variantes mais espertas foram testadas e nenhuma acertou mais.</p>'
      + '<h3 style="margin-top:18px">Quanto essa conta erra</h3>'
      + '<p class="nota" style="margin-top:4px">A mesma fórmula rodada em todas as janelas de três meses já '
      + 'fechadas deste ano, fingindo não conhecer o resultado:</p>'
      + '<div style="margin-top:6px">' + blocos + '</div>'
      + '<p class="nota">No pior caso ela errou <b>' + pct(bt.pior_baixo) + '</b> e no outro extremo <b>'
      + pct(bt.pior_alto) + '</b>; o erro médio é de ' + bt.erro_medio_abs.toFixed(0) + '%. '
      + 'Use para planejar compra de insumo e caixa, não para prometer número a ninguém.</p>'
      + '<details class="saiba"><summary>Por que não há meta por cliente</summary><p>Foi testado. Para a empresa '
      + 'inteira o erro fica na casa dos 12%, mas por cliente e por mês o erro mediano passa de 70% e menos de '
      + 'um quinto das previsões cai dentro de ±30%. Uma meta individual com esse erro não é meta, é ruído com '
      + 'aparência de número. Por isso ela não existe aqui.</p></details>'
    + '</div></section>';
}

$('a-corpo').addEventListener('click', function (e) {
  var tr = e.target.closest('table.movers tr[data-id]');
  if (tr) abrirFicha(tr.dataset.id, 'cliente');
});

/* ═══ PROSPECÇÃO ═════════════════════════════════════════════════════════ */
var CORES_ETAPA = { novo: 'var(--frio)', qualificado: 'var(--s1)', contato: 'var(--atencao)',
                    ganho: 'var(--bom)', perdido: 'var(--ruim)' };
var prFiltro = { seg: '', reg: '' };

function pintarProspeccao() {
  var P = PROSPEC || { leads: [], etapas: [], total: 0, abertos: 0, ganhos: 0, perdidos: 0,
                       ja_clientes: 0, por_segmento: [], por_regiao: [] };
  var vis = P.leads.filter(function (x) {
    return (!prFiltro.seg || (x.segmento || 'sem segmento') === prFiltro.seg)
        && (!prFiltro.reg || (x.regiao_nome || 'sem estado') === prFiltro.reg);
  });
  var colunas = ETAPAS.map(function (e) {
    var l = vis.filter(function (x) { return x.etapa === e[0]; });
    return '<div class="cartao col"><div class="cab">'
      + '<i style="background:' + CORES_ETAPA[e[0]] + '"></i><h3>' + e[1] + '</h3>'
      + '<span class="n">' + l.length + '</span></div>'
      + '<p class="nota" style="margin:0">' + e[2] + '</p>'
      + (l.length ? l.slice(0, 20).map(function (x) {
            return '<button class="lead" type="button" data-l="' + esc(x.id) + '">'
              + '<b>' + esc(x.nome)
              + (x.ja_cliente ? ' <span class="selo s-ritmo">já é cliente</span>' : '') + '</b>'
              + '<small>' + esc([x.cidade, x.uf].filter(Boolean).join(' / ') || 'sem cidade')
              + (x.segmento ? ' · ' + esc(x.segmento) : '')
              + (x.proximo ? ' · ' + esc(x.proximo) : '') + '</small></button>';
          }).join('')
          + (l.length > 20 ? '<p class="nota" style="margin:0">e mais ' + (l.length - 20)
              + ' nesta etapa. Use os filtros abaixo para chegar em quem você quer.</p>' : '')
        : '<p class="vazio" style="padding:16px 8px;font-size:.78rem">vazio</p>')
      + '</div>';
  }).join('');

  var barrinhas = function (lista, titulo, campo) {
    if (!lista || !lista.length) return '';
    var max = lista[0][1] || 1;
    return '<div class="cartao"><h3>' + titulo + '</h3><div style="margin-top:9px">'
      + lista.map(function (p) {
          var on = prFiltro[campo] === p[0];
          return '<button type="button" data-fl="' + campo + '" data-fv="' + esc(p[0])
            + '" style="display:flex;align-items:center;gap:9px;width:100%;background:'
            + (on ? 'var(--roxo-claro)' : 'none') + ';border:0;padding:4px 5px;border-radius:6px;cursor:pointer;margin-bottom:2px">'
            + '<span style="flex:0 0 108px;font-size:.79rem;text-align:left;font-weight:' + (on ? '700' : '500') + '">'
            + esc(p[0]) + '</span>'
            + '<span style="flex:1;height:12px;background:var(--linha);border-radius:3px;overflow:hidden;display:block">'
            + '<span style="display:block;height:100%;width:' + (p[1] / max * 100).toFixed(1)
            + '%;background:var(--s1)"></span></span>'
            + '<span class="mono" style="flex:0 0 34px;text-align:right;font-size:.76rem;font-weight:600">'
            + p[1] + '</span></button>';
        }).join('')
      + '</div><p class="nota">Clique para filtrar o funil. Clique de novo para tirar o filtro.</p></div>';
  };

  var filtrando = prFiltro.seg || prFiltro.reg;
  $('pr-corpo').innerHTML =
    '<div class="heroi" style="margin-top:0">'
      + '<div><div class="n">' + P.abertos + '</div><div class="sub">leads em aberto</div></div>'
      + '<div class="sub">' + P.total + ' na lista · ' + P.ganhos + ' ganhos · ' + P.perdidos + ' perdidos'
      + (P.conversao !== null && P.conversao !== undefined
          ? '<br>conversão de ' + P.conversao.toFixed(0) + '% sobre o que já foi decidido' : '')
      + (P.ja_clientes ? '<br><b style="color:var(--atencao)">' + P.ja_clientes
          + ' já compram da Piromax</b> e estão marcados na lista' : '') + '</div>'
    + '</div>'
    + (filtrando ? '<p class="nota" style="margin:0 0 10px">Mostrando só '
        + esc([prFiltro.seg, prFiltro.reg].filter(Boolean).join(' · ')) + ' — ' + vis.length
        + ' de ' + P.total + ' leads. <button type="button" id="pr-limpa" style="background:none;border:0;'
        + 'color:var(--roxo);cursor:pointer;font:inherit;text-decoration:underline">mostrar todos</button></p>' : '')
    + '<div class="funil">' + colunas + '</div>'
    + '<div class="grade g2" style="margin-top:12px">'
      + barrinhas(P.por_segmento, 'Por tipo de negócio', 'seg')
      + barrinhas(P.por_regiao, 'Por região', 'reg')
    + '</div>'
    + '<div class="cartao" style="margin-top:12px"><h3>Carregar lista de leads</h3>'
      + '<p class="nota" style="margin-top:4px;margin-bottom:11px">Empresa, tipo de lead, atuação, estado, cidade, '
      + 'telefone e o que mais tiver na planilha — o importador acha as colunas pelo nome do cabeçalho, '
      + 'em qualquer ordem, e entende o estado por extenso. O tipo de lead da planilha vira a etapa do funil, '
      + 'então a qualificação que você já fez não se perde. Quem já está na carteira é marcado na hora.</p>'
      + '<div class="solto" id="solto-leads"><b>Clique ou arraste a lista aqui</b>CSV com cabeçalho</div>'
      + '<div id="pv-leads"></div></div>';
}
$('pr-corpo').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-l]');
  if (b) { abrirFicha(b.dataset.l, 'lead'); return; }
  if (e.target.id === 'pr-limpa') { prFiltro = { seg: '', reg: '' }; pintarProspeccao(); return; }
  var f = e.target.closest('button[data-fl]');
  if (f) {
    var campo = f.dataset.fl;
    prFiltro[campo] = prFiltro[campo] === f.dataset.fv ? '' : f.dataset.fv;
    pintarProspeccao();
    return;
  }
  if (e.target.closest('#solto-leads')) $('arq-leads').click();
});

/* ═══ DADOS ══════════════════════════════════════════════════════════════ */
function pintarDados() {
  var m = D ? D.meta : null;
  var dup = CANDIDATOS || [];
  $('d-corpo').innerHTML =
    '<div class="cartao"><h3>Vendas</h3>'
      + '<p class="nota" style="margin-top:4px;margin-bottom:11px">Arquivo com data, cliente e valor. '
      + 'Um arquivo novo <b>soma</b>, nunca apaga: linhas idênticas às que já existem são descartadas '
      + 'e o resto entra, então reenviar o histórico inteiro não duplica nada.</p>'
      + '<div class="solto" id="solto-vendas"><b>Clique ou arraste o CSV aqui</b>Data;Nome;Valor</div>'
      + '<div id="pv-vendas"></div>'
      + (m ? '<p class="nota">Hoje no banco: ' + m.notas.toLocaleString('pt-BR') + ' notas, '
            + m.eventos.toLocaleString('pt-BR') + ' pedidos, ' + m.clientes + ' clientes, '
            + cheio(m.receita) + ', de ' + dia(m.inicio) + ' a ' + dia(m.ref) + '.</p>' : '')
    + '</div>'
    + '<div class="cartao" style="margin-top:12px"><h3>Possíveis duplicados</h3>'
      + '<p class="nota" style="margin-top:4px;margin-bottom:8px">O sistema só sugere; quem decide é você. '
      + 'Unificar junta o histórico dos dois e pode ser desfeito depois.</p>'
      + (dup.length ? dup.map(function (p) {
          return '<div class="par"><span class="n"><b>' + esc(p.canonico) + '</b><br>'
            + '<span style="color:var(--texto2)">' + esc(p.apelido) + '</span></span>'
            + '<small>juntos ' + moeda((p.receita_a || 0) + (p.receita_b || 0)) + '</small>'
            + '<span class="acoes"><button type="button" class="pri" data-uni="1" data-ap="' + esc(p.apelido)
            + '" data-cn="' + esc(p.canonico) + '">São o mesmo</button></span></div>';
        }).join('')
        : '<p class="nota" style="margin-top:0">Nenhum par suspeito no momento.</p>')
      + (Object.keys(ALIASES || {}).length
          ? '<p class="nota">Já unificados: ' + Object.keys(ALIASES).map(function (k) {
              return esc(k) + ' → ' + esc(ALIASES[k]); }).join(' · ')
            + '. <button type="button" id="desfazer" style="background:none;border:0;color:var(--roxo);'
            + 'cursor:pointer;font:inherit;text-decoration:underline">desfazer alguma</button></p>' : '')
    + '</div>'
    + '<div class="cartao" style="margin-top:12px"><h3>Preencher estado e área de atuação</h3>'
      + '<p class="nota" style="margin-top:4px">Isso se faz em <b>Registros</b>: marque vários clientes na lista e '
      + 'aplique de uma vez. A barra de ações aparece assim que você marca o primeiro.'
      + (D ? ' Faltam <b>' + D.clientes.filter(function (c) { return !c.uf_base; }).length
            + ' clientes sem estado</b>.' : '') + '</p>'
    + '</div>'
    + '<div class="cartao" style="margin-top:12px"><h3>Onde isto tudo fica guardado</h3>'
      + '<p class="nota" style="margin-top:4px">Vendas, fichas, motivos, contatos, tarefas, unificações e leads '
      + 'ficam no mesmo banco Postgres do Render que o resto do app usa, nas tabelas que começam com '
      + '<b>carteira_</b>. Nada fica no navegador nem em arquivo no servidor, então o que você grava aqui '
      + 'sobrevive a deploy, reinício e troca de máquina, e aparece igual em qualquer celular ou computador.</p>'
    + '</div>';
}
$('d-corpo').addEventListener('click', function (e) {
  if (e.target.closest('#solto-vendas')) { $('arq-vendas').click(); return; }
  var u = e.target.closest('button[data-uni]');
  if (u) { gravar('/admin/carteira/alias', { apelido: u.dataset.ap, canonico: u.dataset.cn },
      'Clientes unificados.'); return; }
  if (e.target.id === 'desfazer') {
    var ap = prompt('Qual nome deve voltar a ser um cliente separado?\n\n'
      + Object.keys(ALIASES).join('\n'));
    if (ap && ALIASES[ap]) gravar('/admin/carteira/alias', { apelido: ap, remover: true }, 'Desfeito.');
  }
});

/* ── upload com prévia: nada entra sem o gestor ver o que vai entrar ── */
function ligarUpload(input, alvo, urlPrevia, urlUpload, desenhar) {
  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    if (!f) return;
    var fd = new FormData(); fd.append('arquivo', f);
    var box = $(alvo);
    box.innerHTML = '<p class="nota">Lendo o arquivo…</p>';
    fetch(urlPrevia, { method: 'POST', body: fd }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.success) { box.innerHTML = '<p class="nota" style="color:var(--ruim)">'
          + esc(j.erro || 'Não consegui ler.') + '</p>'; return; }
        box.innerHTML = desenhar(j);
        var ok = box.querySelector('[data-conf]');
        if (ok) ok.addEventListener('click', function () {
          ok.disabled = true; ok.textContent = 'Gravando…';
          var fd2 = new FormData(); fd2.append('arquivo', f);
          fetch(urlUpload, { method: 'POST', body: fd2 }).then(function (r) { return r.json(); })
            .then(function (k) {
              if (!k.success) { recado(k.erro || 'Falhou.', true); ok.disabled = false; return; }
              box.innerHTML = '';
              recado('Pronto: ' + (k.inseridas !== undefined ? k.inseridas + ' linhas novas'
                : (k.novos || 0) + ' leads novos') + '.');
              atualizar();
            });
        });
      });
    input.value = '';
  });
}
ligarUpload($('arq-vendas'), 'pv-vendas', '/admin/carteira/previa', '/admin/carteira/upload',
  function (j) {
    return '<div class="cartao" style="margin-top:11px;border-color:var(--roxo-borda)">'
      + '<h3>Confira antes de gravar</h3>'
      + '<p class="nota" style="margin-top:4px">O arquivo tem <b>' + j.lidas + '</b> linhas válidas. '
      + 'Destas, <b>' + j.novas + '</b> ainda não estão no banco e <b>' + (j.lidas - j.novas)
      + '</b> já existem e serão ignoradas.'
      + (j.periodo_novo ? ' O que entra vai de ' + dia(j.periodo_novo[0]) + ' a ' + dia(j.periodo_novo[1]) + '.' : '')
      + (j.erros && j.erros.length ? '<br><span style="color:var(--ruim)">' + j.erros.length
          + ' linha(s) com problema serão puladas.</span>' : '') + '</p>'
      + '<div class="acoes" style="margin-top:9px">'
      + (j.novas ? '<button class="pri" type="button" data-conf="1">Gravar as ' + j.novas + ' linhas novas</button>'
          : '<span class="nota" style="margin:0">Nada novo para gravar.</span>') + '</div></div>';
  });
ligarUpload($('arq-leads'), 'pv-leads', '/admin/carteira/leads/previa', '/admin/carteira/leads/upload',
  function (j) {
    return '<div class="cartao" style="margin-top:11px;border-color:var(--roxo-borda)">'
      + '<h3>Confira antes de gravar</h3>'
      + '<p class="nota" style="margin-top:4px">O arquivo tem <b>' + j.no_arquivo + '</b> leads. '
      + '<b>' + j.novos + '</b> são novos'
      + (j.repetidos ? ', ' + j.repetidos + ' já estão na lista' : '') + '.'
      + (j.qtd_ja_clientes ? ' <b style="color:var(--atencao)">' + j.qtd_ja_clientes
          + ' já compram da Piromax</b> e vão entrar marcados: ' + esc((j.ja_clientes || []).join(', ')) + '.' : '')
      + (j.por_etapa && j.por_etapa.length ? '<br>Entram assim: ' + j.por_etapa.map(function (p) {
          var e = ETAPAS.filter(function (x) { return x[0] === p[0]; })[0];
          return p[1] + ' em "' + (e ? e[1] : p[0]) + '"';
        }).join(', ') + '.' : '')
      + (j.sem_uf ? '<br>' + j.sem_uf + ' sem estado.' : '')
      + (j.sem_telefone ? ' ' + j.sem_telefone + ' sem telefone.' : '') + '</p>'
      + '<div class="acoes" style="margin-top:9px">'
      + (j.novos ? '<button class="pri" type="button" data-conf="1">Gravar os ' + j.novos + ' leads novos</button>'
          : '<span class="nota" style="margin:0">Nada novo para gravar.</span>') + '</div></div>';
  });

/* arrastar e soltar nas duas caixas */
['dragover', 'dragleave', 'drop'].forEach(function (ev) {
  document.addEventListener(ev, function (e) {
    var alvo = e.target.closest('#solto-vendas, #solto-leads');
    if (!alvo) return;
    e.preventDefault();
    alvo.classList.toggle('sobre', ev === 'dragover');
    if (ev === 'drop' && e.dataTransfer.files && e.dataTransfer.files[0]) {
      var input = alvo.id === 'solto-vendas' ? $('arq-vendas') : $('arq-leads');
      var dt = new DataTransfer();
      dt.items.add(e.dataTransfer.files[0]);
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    }
  });
});

/* ═══ arranque ═══════════════════════════════════════════════════════════ */
function pintarTudo() {
  pintarAbas();
  pintarHoje();
  pintarRegistros();
  pintarProspeccao();
  pintarAnalise();
  pintarDados();
  if (D) {
    $('sub-periodo').textContent = D.meta.clientes + ' clientes · '
      + D.meta.notas.toLocaleString('pt-BR') + ' notas · base até ' + dia(D.meta.ref);
    $('rodape').innerHTML = 'Base da Piromax: ' + D.meta.notas.toLocaleString('pt-BR') + ' notas, '
      + D.meta.eventos.toLocaleString('pt-BR') + ' pedidos, ' + D.meta.clientes + ' clientes, '
      + cheio(D.meta.receita) + ' entre ' + dia(D.meta.inicio) + ' e ' + dia(D.meta.ref)
      + '. Rotina de contato medida contra ' + dia(D.rotina.hoje) + '. '
      + 'Onde não há dado, a tela mostra que não há, em vez de preencher com estimativa.';
  } else {
    $('sub-periodo').textContent = 'Nenhuma venda carregada';
  }
}

indexar();
pintarTudo();
rota();
})();
