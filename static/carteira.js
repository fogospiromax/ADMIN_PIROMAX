/* ═══════════════════════════════════════════════════════════════════════════
   Carteira de clientes — Piromax
   Cinco telas: Hoje, Clientes, Prospecção, Resultados, Dados.

   A ideia que organiza tudo: uma fila, uma ficha, um relatório. A fila de Hoje
   é o que se abre de manhã; Clientes é a lista única com filtros salvos;
   Análise é o relatório do mês numa página; Dados é manutenção e sai da frente.

   Rascunhos ficam somente na memória da página. Toda gravação vai para o
   Postgres; a atualização preserva campos ainda não salvos e a posição da ficha.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var IX = {};                      /* id do cliente -> objeto */
var LEAD_IX = {};                 /* id do lead -> objeto */
var estado = { tela: 'hoje', tipo: 'todos', limite: 10, view: 'todos',
               busca: '', uf: '', cidade: '', ord: 'receita', asc: false, marcados: {},
               prView: 'funil', prBusca: '', prUf: '', prCidade: '', prEtapa: '',
               prRevenda: '', prMarcados: {}, prAcao: '' };
var abertaId = null;              /* ficha aberta, para reabrir após gravar */
var abertoTipo = 'cliente';
var USUARIO_ATUAL = document.body.dataset.usuario || '';
var USUARIOS_CRM = [['flavia','Flávia'],['tiago','Tiago'],['fernando','Fernando']];
function nomeUsuario(id) {
  var u = USUARIOS_CRM.find(function(x){return x[0]===id;});
  return u ? u[1] : 'Sem responsável';
}
function opcoesResponsavel(valor, vazio) {
  return '<option value="">'+esc(vazio || 'Sem responsável')+'</option>'
    + USUARIOS_CRM.map(function(u){return '<option value="'+u[0]+'"'+(valor===u[0]?' selected':'')+'>'+u[1]+'</option>';}).join('');
}

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
  el.setAttribute('role', ruim ? 'alert' : 'status');
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, ruim ? 5200 : 2600);
}

/* Toda gravação passa por aqui: envia, recarrega do servidor e repinta sem
   perder a rolagem nem a ficha aberta. É o que evita o location.reload(). */
function gravar(url, corpo, ok, camposSalvos) {
  if (gravando) { recado('Aguarde a gravação atual.', true); return Promise.resolve({success:false}); }
  gravando = true; estadoFicha();
  var enviados = capturarCampos();
  return fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(corpo || {})})
    .then(function(r){ return r.json(); }).then(function(j){
      if(!j.success){recado(j.erro || 'Não foi possível salvar.',true);return j;}
      (camposSalvos || []).forEach(function(k){
        var atuais = capturarCampos();
        if(atuais[k] === enviados[k]) fichaBase[k] = atuais[k];
      });
      if(ok) recado(ok);
      return atualizar().then(function(){return j;}).catch(function(){
        recado('Salvo no servidor, mas a tela não atualizou. Recarregue após guardar seus rascunhos.',true);
        return j;
      });
    }).catch(function(){recado('Não foi possível confirmar a gravação. Seu texto foi mantido; confira a conexão antes de tentar novamente.',true);return {success:false};})
    .finally(function(){gravando=false;estadoFicha();});
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
        if (!j.success) throw new Error('Falha ao atualizar');
        var rascunho = camposAlterados();
        var corpo = $('tela').querySelector('.gcorpo');
        var scroll = corpo ? corpo.scrollTop : 0;
        var foco = document.activeElement && document.activeElement.id;
        var detalhes = Array.from($('tela').querySelectorAll('details')).map(function(el){return el.open;});
        D = j.dados; FICHA = j.fichas; INTER = j.inter; TAREFAS = j.tarefas;
        ALIASES = j.aliases; CANDIDATOS = j.candidatos; PROSPEC = j.prospec;
        PESSOAL = j.pessoal;
        indexar();
        pintarTudo();
        if (abertaId) {
          abrirFicha(abertaId, abertoTipo, true);
          restaurarCampos(rascunho);
          $('tela').querySelectorAll('details').forEach(function(el,i){el.open=!!detalhes[i];});
          var novoCorpo=$('tela').querySelector('.gcorpo'); if(novoCorpo)novoCorpo.scrollTop=scroll;
          if(foco && $(foco))$(foco).focus({preventScroll:true});
        }
      });
  });
}

function indexar() {
  IX = {}; LEAD_IX = {};
  if (D && D.clientes) D.clientes.forEach(function (c) { IX[c.id] = c; });
  if (PROSPEC && PROSPEC.leads) PROSPEC.leads.forEach(function (l) { LEAD_IX[l.id] = l; });
}
function donoRegistro(id) {
  var cliente = IX[id], lead = LEAD_IX[id];
  if (cliente) return cliente.responsavel_usuario || '';
  if (lead && lead.cliente_id && IX[lead.cliente_id])
    return IX[lead.cliente_id].responsavel_usuario || '';
  return lead ? lead.responsavel_usuario || '' : '';
}

/* ── navegação ──────────────────────────────────────────────────────────── */
var TELAS = [['hoje', 'Hoje'], ['registros', 'Clientes'], ['prospeccao', 'Prospecção'],
             ['analise', 'Resultados'], ['dados', 'Dados']];
var ICONES_ABA = {
  hoje: '<path d="M4 5.5h16v15H4zM4 9.5h16M8 3.5v4M16 3.5v4M8 14h3l1.5 1.5L16 12"/>',
  registros: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2zM17 5h4M17 9h4M17 13h4"/>',
  prospeccao: '<path d="M4 5h16v14H4zM4 10h16M9 10v9M16 10v9"/>',
  analise: '<path d="M4 19V5M4 19h16M8 16v-4M13 16V8M18 16V5"/>',
  dados: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'
};
function iconeAba(t) {
  return '<svg class="aba-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONES_ABA[t] + '</svg>';
}

function pendenciasDoDia() {
  var hoje = hojeISO(), compromissos = agendaPessoalItens().filter(function(t) {
    return !t.feita && t.prazo && t.prazo <= hoje;
  });
  var agendados = {};
  compromissos.forEach(function(t) {
    agendados[t.cliente] = true;
    var lead = LEAD_IX[t.cliente];
    if (lead && lead.cliente_id) agendados[lead.cliente_id] = true;
  });
  var meus = new Set((PESSOAL && PESSOAL.clientes) || []);
  var sugestoes = D && D.fila ? D.fila.filter(function(f) {
    return meus.has(f.id) && f.contato_urgente && !agendados[f.id];
  }) : [];
  return {compromissos: compromissos, sugestoes: sugestoes};
}

function pintarAbas() {
  $('abas').innerHTML = TELAS.map(function (t) {
    var n = '';
    if (t[0] === 'hoje') { var diaAtivo=pendenciasDoDia(); n=diaAtivo.compromissos.length+diaAtivo.sugestoes.length; }
    else if (t[0] === 'registros') n = D && D.clientes ? D.clientes.length : 0;
    else if (t[0] === 'prospeccao') n = PROSPEC ? PROSPEC.abertos : 0;
    return '<button class="aba" role="tab" type="button" id="aba-' + t[0] + '" aria-controls="p-' + t[0] + '" tabindex="' + (estado.tela === t[0] ? '0' : '-1') + '" data-t="' + t[0] + '" aria-selected="'
      + (estado.tela === t[0]) + '">' + iconeAba(t[0]) + '<span class="aba-label">' + t[1] + '</span>'
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
  if (!fecharFicha(true)) return;
  irPara(b.dataset.t);
  $('aba-' + b.dataset.t).focus({preventScroll:true});
  window.scrollTo(0, 0);
});
$('abas').addEventListener('keydown', function (e) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  var atual = e.target.closest('button[data-t]');
  if (!atual) return;
  var i = TELAS.findIndex(function(t){return t[0] === atual.dataset.t;});
  var proximo = e.key === 'Home' ? 0 : e.key === 'End' ? TELAS.length - 1 :
    (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + TELAS.length) % TELAS.length;
  e.preventDefault();
  var alvo = $('aba-' + TELAS[proximo][0]);
  if (alvo) alvo.focus();
});

function rota() {
  var h = location.hash || '#/hoje';
  var m = h.match(/^#\/cliente\/(.+)$/);
  if (m && IX[m[1]]) { if ($('tela').innerHTML && !podeFechar()) { history.replaceState(null,'','#/'+abertoTipo+'/'+abertaId); return; } irPara('registros', true); abrirFicha(m[1], 'cliente', true); return; }
  var ml = h.match(/^#\/lead\/(.+)$/);
  if (ml && LEAD_IX[ml[1]]) { if ($('tela').innerHTML && !podeFechar()) { history.replaceState(null,'','#/'+abertoTipo+'/'+abertaId); return; } irPara('prospeccao', true); abrirFicha(ml[1], 'lead', true); return; }
  var t = h.replace('#/', '').split('/')[0];
  if (!TELAS.some(function (x) { return x[0] === t; })) t = 'hoje';
  if ($('tela').innerHTML && !fecharFicha(true)) { history.replaceState(null,'','#/'+abertoTipo+'/'+abertaId); return; }
  irPara(t, true);
  var cap = h.split('/')[2];
  if (t === 'analise' && cap && $(cap)) $(cap).scrollIntoView({ block: 'start' });
}
window.addEventListener('hashchange', rota);

/* ═══ HOJE ═══════════════════════════════════════════════════════════════ */
var RESULTADOS = {conversou:'Conversou', sem_resposta:'Sem resposta', orcamento:'Pediu orçamento', retorno:'Retorno combinado', sem_interesse:'Sem interesse'};
var fichaBase = {}, focoAnterior = null, gravando = false, navegandoTeclado = false;
document.addEventListener('pointerdown', function () { navegandoTeclado = false; }, true);
document.addEventListener('keydown', function (e) {
  if (['Tab', 'Enter', ' ', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key))
    navegandoTeclado = true;
}, true);
function hojeISO() { return (D && D.rotina && D.rotina.hoje) || HOJE; }
function valorReferencia(tipo) {
  return {recuperar:'Base histórica', queda:'Redução no período', crescer:'Crescimento realizado', novo:'Receita no ano', ritmo:'Pedido médio'}[tipo] || 'Rotina';
}
function capturarCampos() {
  var dados = {};
  $('tela').querySelectorAll('input[id],textarea[id],select[id]').forEach(function (el) {
    dados[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  $('tela').querySelectorAll('[data-at]').forEach(function (el) { dados['at:'+el.dataset.at] = el.getAttribute('aria-pressed'); });
  return dados;
}
function camposAlterados() {
  var agora = capturarCampos(), diff = {};
  Object.keys(agora).forEach(function (k) { if (agora[k] !== fichaBase[k]) diff[k] = agora[k]; });
  return diff;
}
function restaurarCampos(diff) {
  Object.keys(diff).forEach(function (k) {
    if (k.indexOf('at:') === 0) {
      $('tela').querySelectorAll('[data-at]').forEach(function (el) { if ('at:'+el.dataset.at === k) el.setAttribute('aria-pressed', diff[k]); });
      return;
    }
    var el = $(k); if (!el) return;
    if (el.type === 'checkbox') el.checked = diff[k]; else el.value = diff[k];
  });
  estadoFicha();
}
function estadoFicha() {
  var el = $('f-status');
  if (el) el.textContent = gravando ? 'Salvando…' : Object.keys(camposAlterados()).length ? 'Alterações não salvas' : 'Sem alterações pendentes';
}
function podeFechar() {
  if (gravando) { recado('Aguarde a gravação terminar.', true); return false; }
  return !Object.keys(camposAlterados()).length || window.confirm('Há alterações não salvas nesta ficha. Deseja descartá-las?');
}
window.addEventListener('beforeunload', function (e) {
  if (gravando || Object.keys(camposAlterados()).length) { e.preventDefault(); e.returnValue = ''; }
});
$('tela').addEventListener('input', estadoFicha);
$('tela').addEventListener('change', estadoFicha);
function agendaItens() {
  var itens = (TAREFAS || []).map(function (t) {
    var pessoa = IX[t.cliente] || LEAD_IX[t.cliente];
    return {id:t.id, origem:'tarefa', cliente:t.cliente, nome:pessoa ? pessoa.nome : 'Cadastro a revisar',
      tipo:IX[t.cliente] ? 'cliente' : 'lead', titulo:t.titulo, prazo:t.prazo || '', feita:t.feita,
      concluido:t.concluido_em || '', responsavel:t.responsavel || (pessoa && pessoa.responsavel) || ''};
  });
  if (PROSPEC) PROSPEC.leads.forEach(function (l) {
    if (['ganho','perdido'].indexOf(l.etapa) >= 0 || (!l.proximo && !l.proximo_em)) return;
    itens.push({id:l.id, origem:'lead', cliente:l.id, nome:l.nome, tipo:'lead', titulo:l.proximo || 'Definir próximo passo',
      prazo:l.proximo_em || '', feita:false, responsavel:''});
  });
  return itens.sort(function (a,b) { return (a.prazo || '9999').localeCompare(b.prazo || '9999') || a.nome.localeCompare(b.nome); });
}
function agendaPessoalItens() {
  // A seleção dos IDs é feita no servidor a partir do usuário autenticado.
  var tarefas = new Set((PESSOAL && PESSOAL.tarefas) || []);
  var leads = new Set((PESSOAL && PESSOAL.leads) || []);
  return agendaItens().filter(function(t) {
    return t.origem === 'tarefa' ? tarefas.has(t.id) : leads.has(t.id);
  });
}
function proximaTarefa(id) {
  var ids = [id];
  if (PROSPEC) PROSPEC.leads.forEach(function (l) { if (l.cliente_id === id) ids.push(l.id); });
  return agendaItens().filter(function (t) { return !t.feita && ids.indexOf(t.cliente) >= 0; })[0];
}
function pintarAgenda() {
  var hoje = hojeISO(), itens = agendaPessoalItens(), grupos = {
    vencidos:itens.filter(function (t) { return !t.feita && t.prazo && t.prazo < hoje; }),
    hoje:itens.filter(function (t) { return !t.feita && t.prazo === hoje; }),
    proximos:itens.filter(function (t) { return !t.feita && t.prazo > hoje; }),
    semdata:itens.filter(function (t) { return !t.feita && !t.prazo; }),
    feitos:itens.filter(function (t) { return t.feita && t.concluido === hoje; })
  };
  var chave = estado.agenda || 'pendentes';
  var lista = chave === 'pendentes' ? grupos.vencidos.concat(grupos.hoje) : grupos[chave];
  var filtros = [['pendentes','Vencidos e hoje',grupos.vencidos.length+grupos.hoje.length], ['proximos','Próximos',grupos.proximos.length], ['semdata','Sem data',grupos.semdata.length], ['feitos','Concluídos hoje',grupos.feitos.length]];
  var contatosHoje = (PESSOAL && PESSOAL.contatos_hoje) || 0;
  $('h-agenda').innerHTML = '<div class="agenda-titulo"><div><p class="olho">Seu dia</p><h2>Agenda de '+esc(nomeUsuario(USUARIO_ATUAL))+'</h2><p class="nota">Compromissos dos clientes e leads sob sua responsabilidade, em ordem de prazo.</p></div><span class="selo s-classe">'+contatosHoje+' contato(s) registrado(s) hoje</span></div>'
    + '<div class="agenda-resumo"><div><strong>'+grupos.vencidos.length+'</strong><span>compromissos vencidos</span></div><div><strong>'+grupos.hoje.length+'</strong><span>combinados para hoje</span></div><div><strong>'+grupos.feitos.length+'</strong><span>tarefas concluídas hoje</span></div></div>'
    + '<div class="fichas">'+filtros.map(function(f){return '<button class="ficha" data-agenda="'+f[0]+'" aria-pressed="'+(chave===f[0])+'">'+f[1]+' <span class="n">'+f[2]+'</span></button>';}).join('')+'</div>'
    + (lista.length ? lista.slice(0,estado.agendaLimite || 8).map(linhaAgenda).join('') : '<p class="vazio">Nenhum compromisso nesta visão da sua agenda.</p>')
    + (lista.length > (estado.agendaLimite || 8) ? '<button class="mais" data-agenda-mais>Mostrar mais compromissos</button>' : '');
}
function linhaAgenda(t) {
  var atrasada = t.prazo && t.prazo < hojeISO() && !t.feita;
  return '<div class="agenda-linha"><span class="agenda-data '+(atrasada?'neg':'')+'">'+(t.feita?'Concluída':t.prazo===hojeISO()?'Hoje':t.prazo?dia(t.prazo):'Sem data')+'</span>'
    + '<button class="agenda-abrir" data-abrir="'+esc(t.cliente)+'" data-tipo="'+t.tipo+'"><strong>'+esc(t.titulo)+'</strong><span>'+esc(t.nome)+' · '+(t.tipo==='lead'?'Lead':'Cliente')+(t.responsavel?' · '+esc(t.responsavel):'')+'</span></button>'
    + (t.origem==='tarefa' ? '<button class="btn-ok" data-tarefa="'+esc(t.id)+'" data-feita="'+(!t.feita)+'">'+(t.feita?'Reabrir':'Concluir tarefa')+'</button>'
      : '<button class="btn-ok" data-concluir-lead="'+esc(t.id)+'">Concluir retorno</button>')+'</div>';
}
function formularioContato(id) {
  var p = IX[id] || LEAD_IX[id] || {}, ids = [id];
  if (PROSPEC) PROSPEC.leads.forEach(function(l){ if(l.cliente_id === id) ids.push(l.id); });
  var log = (INTER || []).filter(function(i){return ids.indexOf(i.cliente)>=0;});
  return '<div class="cartao" id="bloco-contato"><h3>Registrar contato</h3><div class="grade g2" style="margin-top:12px">'
    + '<div class="campo"><label for="fc-resultado">Resultado</label><select id="fc-resultado">'+Object.keys(RESULTADOS).map(function(k){return '<option value="'+k+'">'+RESULTADOS[k]+'</option>';}).join('')+'</select></div>'
    + '<div class="assinatura-contato"><span>Registrado por</span><strong>'+esc(nomeUsuario(USUARIO_ATUAL))+'</strong><small>Identificado automaticamente pelo login</small></div></div>'
    + '<div class="campo" style="margin-top:12px"><label for="fc-nota">Resumo da conversa ou tentativa</label><textarea id="fc-nota" rows="3" maxlength="1000" placeholder="O que aconteceu e o que ficou combinado?"></textarea></div>'
    + '<div class="grade g2" style="margin-top:12px"><div class="campo"><label for="fc-proximo">Próximo passo</label><input id="fc-proximo" maxlength="300" placeholder="Ex.: retornar sobre o orçamento"></div><div class="campo"><label for="fc-prazo">Data do próximo passo</label><input id="fc-prazo" type="date" min="'+hojeISO()+'"></div></div>'
    + '<div class="campo" style="margin-top:12px"><label for="fc-concluir">Concluir uma tarefa com este contato</label><select id="fc-concluir"><option value="">Não concluir tarefa</option>'+(TAREFAS||[]).filter(function(t){return t.cliente===id&&!t.feita;}).map(function(t){return '<option value="'+esc(t.id)+'">'+esc(t.titulo)+'</option>';}).join('')+'</select></div>'
    + (LEAD_IX[id] && (LEAD_IX[id].proximo || LEAD_IX[id].proximo_em) ? '<p class="nota">O retorno já combinado será registrado como concluído; informe o novo próximo passo se houver.</p>' : '')
    + '<p class="nota">Sem resposta não reinicia a cadência. Para tentativas sem resposta e retornos combinados, informe o próximo passo e a data.</p>'
    + '<div class="acoes"><button class="pri" data-a="contato">Salvar contato e próximo passo</button><span class="nota">Ctrl / ⌘ + Enter</span></div>'
    + '<details class="saiba" '+(log.length?'':'open')+'><summary>Histórico de contatos ('+log.length+')</summary><div class="hist">'
    + (log.length?log.map(function(i){return '<div class="it"><span class="d">'+dia(i.data)+'</span><span class="t"><b>'+esc(RESULTADOS[i.resultado] || (i.tipo==='tarefa'?'Retorno concluído':'Contato'))+'</b>'+ (i.responsavel?' · '+esc(i.responsavel):'')+'<br>'+esc(i.resumo)+'</span></div>';}).join(''):'<p class="nota">Sem contato registrado.</p>')+'</div></details></div>';
}
function painelTarefas(id) {
  var ids = [id];
  if (PROSPEC) PROSPEC.leads.forEach(function(l){if(l.cliente_id===id)ids.push(l.id);});
  var itens = agendaItens().filter(function(t){return ids.indexOf(t.cliente)>=0 && !t.feita;});
  return '<div class="cartao"><h3>Próximas ações</h3>'+ (itens.length?itens.map(linhaAgenda).join(''):'<p class="nota">Nenhuma tarefa pendente.</p>')
    + '<details class="saiba"><summary>Agendar tarefa sem registrar contato</summary><div class="campo"><label for="ft-titulo">O que precisa ser feito</label><input id="ft-titulo" maxlength="300"></div><div class="grade g2"><div class="campo"><label for="ft-prazo">Prazo</label><input id="ft-prazo" type="date"></div><div class="campo"><label for="ft-responsavel">Responsável</label><input id="ft-responsavel" maxlength="120"></div></div><div class="acoes"><button data-a="tarefa">Agendar tarefa</button></div></details></div>';
}
function atalhosContato(p) {
  var tel = String(p.telefone || '').replace(/\D/g,'');
  var wa = tel.length === 10 || tel.length === 11 ? '55'+tel : tel;
  return '<div class="contato-atalhos">'+(p.contato?'<span>'+esc(p.contato)+'</span>':'')
    + (tel?'<a class="btn-ok" href="tel:+'+wa+'">Ligar</a><a class="btn-ok" href="https://wa.me/'+wa+'" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>':'<span class="nota">Telefone não cadastrado</span>')+'</div>';
}
function concluirTarefa(id, feita) {
  return gravar('/admin/carteira/tarefa/'+encodeURIComponent(id),{feita:feita},feita?'Tarefa concluída.':'Tarefa reaberta.');
}
document.addEventListener('click', function(e){
  var b=e.target.closest('[data-agenda]');
  if(b){estado.agenda=b.dataset.agenda;estado.agendaLimite=8;pintarAgenda();return;}
  if(e.target.closest('[data-agenda-mais]')){estado.agendaLimite=(estado.agendaLimite||8)+8;pintarAgenda();return;}
  b=e.target.closest('[data-tarefa]');
  if(b){concluirTarefa(b.dataset.tarefa,b.dataset.feita==='true');return;}
  b=e.target.closest('[data-concluir-lead]');
  if(b){var l=LEAD_IX[b.dataset.concluirLead];if(l)gravar('/admin/carteira/lead/retorno',{id:l.id,proximo:l.proximo,proximo_em:l.proximo_em},'Retorno concluído.');return;}
  b=e.target.closest('[data-abrir]');
  if(b){abrirFicha(b.dataset.abrir,b.dataset.tipo);return;}
  b=e.target.closest('[data-visao]');
  if(b){estado.view=b.dataset.visao;irPara('registros');pintarRegistros();window.scrollTo(0,0);}
});

function pintarHoje() {
  pintarAgenda();
  if (!D) { $('h-fila').innerHTML = semBase(); return; }
  var meus = new Set((PESSOAL && PESSOAL.clientes) || []);
  var fila = (D.fila || []).filter(function(f){return meus.has(f.id);}), R = D.rotina || {};

  // A fila de trabalho e so quem esta com contato vencido. Quem ja esta em dia,
  // quem acabou de ser contactado e quem nao tem rotina saem da contagem e
  // ficam na visão separada. Compromissos da agenda não duplicam sugestões;
  // o total do topo mostra somente ações que ainda precisam ser feitas.
  var pend = pendenciasDoDia().sugestoes;
  var prio = pend.filter(function (f) { return f.prioridade; });
  var emdia = fila.filter(function (f) { return !f.contato_urgente; });


  $('h-n').textContent = pend.length;
  $('h-n-sub').textContent = 'contatos sugeridos além da agenda';
  $('h-sub').innerHTML = '<b>Contatos sugeridos pela rotina</b><br>'
    + 'Compromissos com data aparecem primeiro na agenda acima.<br>'
    + 'Os valores de cada cliente têm significados próprios e não são somados.';

  $('h-fichas').innerHTML = '<button class="ficha" type="button" data-f="todos" aria-pressed="'
    + (estado.tipo === 'todos') + '">Tudo <span class="n">' + pend.length + '</span></button>'
    + MOTIVOS.map(function (m) {
        var n = pend.filter(function (f) { return f.tipo === m[0]; }).length;
        if (!n) return '';
        return '<button class="ficha" type="button" data-f="' + m[0] + '" aria-pressed="'
          + (estado.tipo === m[0]) + '"><i style="background:' + m[2] + '"></i>'
          + m[1] + ' <span class="n">' + n + '</span></button>';
      }).join('')
    + (prio.length ? '<button class="ficha prio" type="button" data-f="prioridade" aria-pressed="'
        + (estado.tipo === 'prioridade') + '">★ Prioridade <span class="n">' + prio.length + '</span></button>' : '')
    + (emdia.length ? '<button class="ficha feito" type="button" data-f="emdia" aria-pressed="'
        + (estado.tipo === 'emdia') + '"><i style="background:var(--bom)"></i>Fora da fila '
        + '<span class="n">' + emdia.length + '</span></button>' : '');

  var vis;
  if (estado.tipo === 'emdia') vis = emdia;
  else if (estado.tipo === 'prioridade') vis = prio;
  else vis = pend.filter(function (f) { return estado.tipo === 'todos' || f.tipo === estado.tipo; });

  var mostra = vis.slice(0, estado.limite);
  $('h-fila').innerHTML = mostra.length ? mostra.map(linhaFila).join('')
    : (!meus.size && D.clientes.length ? '<div class="vazio"><b>Você ainda não tem clientes atribuídos.</b><br>'
      + 'Os clientes existentes estão na fila até receberem um responsável.<br>'
      + '<button type="button" class="btn-ok" data-ir-distribuicao>Ver fila de distribuição</button></div>'
    : '<p class="vazio">' + (estado.tipo === 'emdia'
        ? 'Nenhum cliente nesta visão.'
        : 'Nada pendente nesta categoria.'
          + (emdia.length ? '<br>Veja em <b>Fora da fila</b> quem já foi atendido.'
                          : '<br>Se a fila inteira esvaziar, a rotina está em dia.')) + '</p>');
  $('h-mais').hidden = vis.length <= estado.limite;
  $('h-mais').textContent = 'Mostrar mais ' + Math.min(25, vis.length - estado.limite)
    + ' de ' + (vis.length - estado.limite) + ' restantes';

  $('h-nota').innerHTML = estado.tipo === 'emdia'
    ? 'Quem já foi atendido no prazo, quem você marcou como feito hoje e quem está fora da rotina. '
      + 'A etiqueta de cada linha diz em quantos dias ele volta para a fila.'
    : '';
}
function linhaFila(f) {
  var rot = MOTIVOS.filter(function (m) { return m[0] === f.tipo; })[0] || ['rotina', 'Rotina'];
  return '<div class="linha' + (f.prioridade ? ' prio' : '')
    + (f.contato_hoje ? ' feita' : (f.contato_urgente ? '' : ' emdia')) + '">'
    + '<span class="faixa f-' + f.tipo + '" aria-hidden="true"></span>'
    + '<div class="corpo" role="button" tabindex="0" data-id="' + esc(f.id) + '">'
      + '<span class="topo">'
      + (f.prioridade ? '<span class="selo s-prio">★ Prioridade</span>' : '')
      + '<span class="selo s-' + f.tipo + '">' + rot[1]
      + (f.manual ? ' ✎' : '') + '</span>'
      + '<span class="nome">' + esc(f.nome) + '</span>'
      + '<span class="selo s-classe">Classe ' + f.classe + '</span></span>'
      + '<span class="frase">' + esc(f.texto) + '</span>'
      + '<span class="marca' + (f.contato_urgente ? '' : ' ok') + '">'
        + (f.contato_hoje ? '✓ Contato registrado hoje · ' + esc(f.contato_rotulo)
            : (f.contato_urgente ? '⏱ ' : '✓ ') + esc(f.contato_rotulo))
        + (f.marcas && f.marcas.length ? ' · ' + esc(f.marcas.join(' · ')) : '') + '</span>'
      + (f.manual ? '<span class="marca obs">✎ classificado por você. O sistema diria: '
          + esc(f.auto_rotulo) + '</span>' : '')
      + (f.motivo ? '<span class="marca obs">✎ ' + esc(f.motivo) + '</span>' : '')
    + '</div>'
    + '<span class="dir">'
      + '<span class="valor">' + (f.peso ? moeda(f.peso) : '—') + '</span>'
      + '<span class="leg">' + (f.peso ? valorReferencia(f.tipo) : 'só rotina') + '</span>'
      + '<button class="btn-ok" type="button" data-c="' + esc(f.id) + '">Registrar contato</button>'
    + '</span></div>';
}
$('h-fichas').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-f]');
  if (!b) return;
  estado.tipo = b.dataset.f; estado.limite = 10; pintarHoje();
});
$('h-mais').addEventListener('click', function () { estado.limite += 25; pintarHoje(); });
$('h-fila').addEventListener('click', function (e) {
  if (e.target.closest('[data-ir-distribuicao]')) {
    estado.view='semresponsavel'; irPara('registros'); pintarRegistros(); window.scrollTo(0,0); return;
  }
  var ok = e.target.closest('button[data-c]');
  if (ok) { abrirFicha(ok.dataset.c, 'cliente', false, true); return; }
  var b = e.target.closest('.corpo[data-id]');
  if (b) abrirFicha(b.dataset.id, 'cliente');
});
/* O corpo da linha nao e <button> de proposito: o Chrome cria uma caixa
   interna que RECORTA o conteudo do botao quando ele transborda, e isso comia
   o comeco de cada linha em tela estreita. Com div + role + tabindex o
   teclado continua funcionando e o layout se comporta. */
$('h-fila').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var b = e.target.closest('.corpo[data-id]');
  if (!b) return;
  e.preventDefault();
  abrirFicha(b.dataset.id, 'cliente');
});

function semBase() {
  return '<p class="vazio"><b>Nenhuma venda carregada ainda.</b><br>'
    + 'Vá em <b>Dados</b> e envie o arquivo de vendas para o painel ganhar conteúdo.</p>';
}

/* ═══ REGISTROS ══════════════════════════════════════════════════════════ */
var VIEWS = [
  ['todos', 'Todos', function () { return true; }],
  ['meus', 'Meus clientes', function(c) { return c.responsavel_usuario === USUARIO_ATUAL; }],
  ['semresponsavel', 'Fila de distribuição', function(c) { return !c.responsavel_usuario; }],
  ['a', 'Classe A', function (c) { return c.classe === 'A'; }],
  ['caindo', 'Caindo', function (c) { return c.direcao === 'em queda' || c.direcao === 'queda forte'; }],
  ['parou', 'Parados', function (c) { return c.direcao === 'parou'; }],
  ['crescendo', 'Crescendo', function (c) { return c.direcao === 'crescendo'; }],
  ['novo', 'Novos', function (c) { return c.direcao === 'novo'; }],
  ['atrasado', 'Atrasados no ritmo', function (c) { return c.ritmo === 'atrasado' || c.ritmo === 'muito atrasado'; }],
  ['vencido', 'Contato vencido', function (c) { return c.contato_urgente; }],
  ['prioridade', 'Prioridade', function (c) { return c.prioridade; }],
  ['semcidade', 'Sem cidade', function (c) { return !c.cidade; }],
  ['ocasional', 'Ocasionais', function (c) { return c.ocasional; }],
  ['manual', 'Classificados por você', function (c) { return !!c.classe_manual; }],
  ['dispensa', 'Fora da rotina', function (c) { return c.dispensa_rotina && !c.ocasional; }],
  ['semuf', 'Sem estado', function (c) { return !c.uf_base; }]
];
function normalBusca(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function listaRegistros() {
  if (!D) return [];
  var v = VIEWS.filter(function (x) { return x[0] === estado.view; })[0] || VIEWS[0];
  var q = estado.busca.trim().toLowerCase();
  var l = D.clientes.filter(function (c) {
    return v[2](c)
      && (!q || normalBusca([c.nome,c.cidade,c.contato].join(' ')).indexOf(normalBusca(q)) >= 0)
      && (!estado.uf || c.uf_base === estado.uf)
      && (!estado.cidade || (c.cidade || '').toLowerCase() === estado.cidade.toLowerCase());
  });
  var k = estado.ord, s = estado.asc ? 1 : -1;
  l.sort(function (a, b) {
    if (['nome','primeira','ultima'].indexOf(k) >= 0) return String(a[k] || '').localeCompare(String(b[k] || '')) * s;
    var x = a[k], y = b[k];
    if (x === null || x === undefined) x = -1e15;
    if (y === null || y === undefined) y = -1e15;
    return (x - y) * s;
  });
  return l;
}
function pintarRegistros() {
  if (!D) { $('r-corpo').innerHTML = '<tr><td colspan="8">' + semBase() + '</td></tr>'; return; }
  var semDono = D.clientes.filter(function(c){return !c.responsavel_usuario;}).length;
  $('r-distribuicao').innerHTML = semDono ? '<div class="cartao distribuicao-aviso">'
    + '<div><strong>'+semDono+' cliente(s) na fila de distribuição</strong><p>Escolha um responsável na tabela ou marque vários clientes para atribuir em lote.</p></div>'
    + '<button type="button" class="btn-ok" data-distribuir>Ver fila</button></div>' : '';
  $('r-views').innerHTML = VIEWS.map(function (v, vi) {
    return '<button class="ficha' + (vi > 7 && estado.view !== v[0] ? ' filtro-extra' : '') + '" type="button" data-w="' + v[0] + '" aria-pressed="'
      + (estado.view === v[0]) + '">' + v[1]
      + ' <span class="n">' + D.clientes.filter(v[2]).length + '</span></button>';
  }).join('');

  pintarFiltrosRegistros();

  var l = listaRegistros();
  $('r-cnt').textContent = l.length + ' de ' + D.clientes.length;
  $('r-corpo').innerHTML = l.length ? l.map(function (c) {
    var d = DIR[c.direcao] || ['—', 'classe'], v = c.var_ytd_pct;
    var ult = INTER.filter(function (i) { return i.cliente === c.id; })[0];
    return '<tr data-id="' + esc(c.id) + '" tabindex="0">'
      + '<td class="marc"><input type="checkbox" data-m="' + esc(c.id) + '"'
        + (estado.marcados[c.id] ? ' checked' : '') + ' aria-label="Marcar ' + esc(c.nome) + '"></td>'
      + '<td class="nm">' + (c.prioridade ? '<span class="estrela">★</span> ' : '')
        + esc(c.nome) + ' <span class="selo s-classe">' + c.classe + '</span>'
        + (c.ocasional ? ' <span class="selo s-rotina">ocasional</span>' : '')
        + (c.alias && c.alias.length ? ' <span class="selo s-rotina" title="' + esc(c.alias.join(', '))
            + '">+' + c.alias.length + ' nome(s)</span>' : '') + '</td>'
      + '<td class="owner-edit"><select data-dono="'+esc(c.id)+'" data-anterior="'+esc(c.responsavel_usuario || '')+'" aria-label="Responsável por '+esc(c.nome)+'">'
      + opcoesResponsavel(c.responsavel_usuario || '', 'Distribuir…') + '</select></td>'
      // Cidade e estado se editam aqui mesmo. Sao 161 para preencher a mao, e
      // abrir e fechar a ficha de cada um seria tres cliques por cliente.
      + '<td class="edit extra-col"><div class="par2">'
        + '<input class="cid" data-cid="' + esc(c.id) + '" value="' + esc(c.cidade) + '"'
        + ' placeholder="cidade" aria-label="Cidade de ' + esc(c.nome) + '">'
        + '<select class="uf" data-uf="' + esc(c.id) + '" aria-label="Estado de ' + esc(c.nome) + '">'
        + '<option value="">UF</option>'
        + UFS.map(function (u) {
            return '<option' + (c.uf_base === u ? ' selected' : '') + '>' + u + '</option>'; }).join('')
        + '</select></div></td>'
      + '<td class="extra-col" style="font-size:.79rem;color:var(--texto2)">' + esc(c.atuacao_rotulo || '—') + '</td>'
      + '<td><span class="selo s-' + d[1] + '">' + d[0] + '</span>'
        + (c.classe_manual ? ' <span class="selo s-novo">✎</span>' : '') + '</td>'
      + '<td class="num extra-col">' + moeda(c.receita) + '</td>'
      + '<td class="num extra-col ' + (v === null ? '' : (v >= 0 ? 'pos' : 'neg')) + '">'
        + (v === null ? '—' : pct(v)) + '</td>'
      + '<td class="num extra-col">' + cheio(c.ticket).replace('R$ ', '') + '</td>'
      + '<td class="num extra-col">' + c.compras + '</td>'
      + '<td class="num extra-col">' + dia(c.primeira) + '</td>'
      + '<td class="num">' + dia(c.ultima) + '</td>'
      + '<td>' + (ult ? dia(ult.data) : 'Sem registro') + '<small class="celula-sub">' + esc(c.contato_rotulo) + '</small></td>'
      + '<td class="proxima-col">' + (proximaTarefa(c.id) ? esc(proximaTarefa(c.id).titulo) + '<small class="celula-sub">' + dia(proximaTarefa(c.id).prazo) + '</small>' : 'Sem ação agendada') + '</td></tr>';
  }).join('') : '<tr><td colspan="14"><p class="vazio">Nenhum cliente nesta visão.</p></td></tr>';
  document.querySelectorAll('#r-tab th button[data-s]').forEach(function(b){
    b.parentElement.setAttribute('aria-sort', b.dataset.s === estado.ord ? (estado.asc ? 'ascending':'descending') : 'none');
  });
  pintarLote();
}

/* Os filtros so oferecem o que existe na base. Uma lista de 27 estados com 26
   vazios e pior do que nao ter filtro. Fica separado do resto porque precisa
   ser atualizado quando o gestor digita uma cidade nova na propria linha, sem
   repintar a tabela inteira embaixo do cursor dele. */
function pintarFiltrosRegistros() {
  if (!D) return;
  var ufs = {}, cidades = {};
  D.clientes.forEach(function (c) {
    if (c.uf_base) ufs[c.uf_base] = (ufs[c.uf_base] || 0) + 1;
    if (c.cidade) cidades[c.cidade] = (cidades[c.cidade] || 0) + 1;
  });
  var opcoes = function (obj, vazio, sel) {
    var ks = Object.keys(obj).sort();
    return '<option value="">' + vazio + (ks.length ? '' : ' (nenhum preenchido)') + '</option>'
      + ks.map(function (k) {
          return '<option value="' + esc(k) + '"' + (sel === k ? ' selected' : '') + '>'
            + esc(k) + ' (' + obj[k] + ')</option>';
        }).join('');
  };
  $('r-uf').innerHTML = opcoes(ufs, 'Todos os estados', estado.uf);
  $('r-cidade').innerHTML = opcoes(cidades, 'Todas as cidades', estado.cidade);
}

/* Grava cidade e UF sem sair da linha e sem repintar a tabela inteira: quem
   esta preenchendo 161 clientes nao pode perder o foco a cada campo. */
function salvarCelula(id, cidade, uf) {
  var c = IX[id];
  if (!c) return Promise.resolve();
  return fetch('/admin/carteira/fichas-lote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itens: [{ cliente_id: id, cliente_nome: c.nome,
                                     cidade: cidade, estado: uf }] })
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j.success) { recado(j.erro || 'Nao consegui gravar.', true); return; }
    c.cidade = cidade; c.uf_base = uf;
    return fetch('/admin/carteira/dados').then(function (r) { return r.json(); })
      .then(function (k) {
        if (!k.success) return;
        D = k.dados; FICHA = k.fichas; INTER = k.inter; TAREFAS = k.tarefas;
        ALIASES = k.aliases; CANDIDATOS = k.candidatos; PROSPEC = k.prospec;
        PESSOAL = k.pessoal;
        indexar();
        pintarAbas();
        pintarFiltrosRegistros();
        $('r-views').innerHTML = VIEWS.map(function (x) {
          return '<button class="ficha" type="button" data-w="' + x[0] + '" aria-pressed="'
            + (estado.view === x[0]) + '">' + x[1]
            + ' <span class="n">' + D.clientes.filter(x[2]).length + '</span></button>';
        }).join('');
        $('r-cnt').textContent = listaRegistros().length + ' de ' + D.clientes.length;
      });
  });
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
    + '<select id="lt-dono" aria-label="Responsável para os clientes marcados" class="filtro"><option value="">Atribuir responsável…</option>'
    + USUARIOS_CRM.map(function(u){return '<option value="'+u[0]+'">'+u[1]+'</option>';}).join('')
    + '<option value="__sem">Devolver à distribuição</option></select>'
    + '<button type="button" id="lt-atribuir" class="btn-ok">Atribuir</button>'
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
    + '<span class="acoes">'
      + '<button type="button" id="lt-prio" class="pri">★ Prioridade</button>'
      + '<button type="button" id="lt-semprio">Tirar prioridade</button>'
      + '<button type="button" id="lt-ok">Aplicar os campos acima</button>'
      + (ids.length > 1 ? '<button type="button" id="lt-uni">Unificar em um só</button>' : '')
      + '<button type="button" id="lt-nada">Limpar seleção</button></span></div>'
    + (estado.unificando ? painelUnificar(ids) : '')
    + '<p class="nota" style="margin-top:7px">Só os campos preenchidos são gravados. '
      + 'O resto de cada ficha fica como está.</p></div>';
}
var UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI',
           'PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

/* Unificar cadastro e juntar historico de venda, contato e tarefa sob um nome
   so. Quem decide qual nome fica e o gestor, porque o sistema nao sabe qual e
   o certo: o maior nem sempre e o nome que ele usa no dia a dia. */
function painelUnificar(ids) {
  var lista = ids.map(function (i) { return IX[i]; }).filter(Boolean)
    .sort(function (a, b) { return b.receita - a.receita; });
  if (lista.length < 2) return '';
  var soma = lista.reduce(function (s, c) { return s + c.receita; }, 0);
  var compras = lista.reduce(function (s, c) { return s + c.compras; }, 0);
  return '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--linha)">'
    + '<h3>Qual nome fica?</h3>'
    + '<p class="nota" style="margin-top:4px;margin-bottom:9px">Os outros viram apelidos dele. '
      + 'As vendas somam, e os contatos, tarefas e o que estiver escrito na ficha vão junto. '
      + 'Dá para desfazer depois em <b>Dados</b>.</p>'
    + lista.map(function (c, i) {
        return '<label style="display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:7px;'
          + 'cursor:pointer;border:1.5px solid ' + (i === 0 ? 'var(--roxo-borda)' : 'transparent') + '">'
          + '<input type="radio" name="uni-nome" value="' + esc(c.nome) + '"' + (i === 0 ? ' checked' : '')
          + ' style="width:16px;height:16px;accent-color:var(--roxo)">'
          + '<span style="flex:1;min-width:0"><b style="font-size:.86rem;color:var(--roxo-forte)">'
          + esc(c.nome) + '</b><br><span class="nota" style="margin:0">' + moeda(c.receita) + ' · '
          + c.compras + ' compras · desde ' + dia(c.primeira)
          + (c.cidade ? ' · ' + esc(c.cidade) : '') + '</span></span></label>';
      }).join('')
    + '<p class="nota"><b>Depois de unificar:</b> um cliente só, ' + moeda(soma) + ' e '
      + compras + ' compras somadas.</p>'
    + '<div class="acoes" style="margin-top:9px">'
      + '<button type="button" class="pri" id="lt-uni-ok">Unificar os ' + lista.length + '</button>'
      + '<button type="button" id="lt-uni-nao">Cancelar</button></div></div>';
}

$('r-mais-filtros').addEventListener('click',function(){var on=$('r-views').classList.toggle('expandido');this.setAttribute('aria-expanded',String(on));this.textContent=on?'Menos filtros':'Mais filtros';});
$('r-colunas').addEventListener('click',function(){var on=$('r-tab').classList.toggle('completo');this.setAttribute('aria-pressed',String(on));this.textContent=on?'Visão do dia a dia':'Mostrar detalhes e editar localização';});
$('r-distribuicao').addEventListener('click',function(e){if(e.target.closest('[data-distribuir]')){estado.view='semresponsavel';pintarRegistros();}});
$('r-limpa').addEventListener('click',function(){estado.view='todos';estado.busca=estado.uf=estado.cidade='';$('r-busca').value='';pintarRegistros();});
$('r-views').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-w]');
  if (!b) return;
  estado.view = b.dataset.w; pintarRegistros();
});
$('r-busca').addEventListener('input', function (e) { estado.busca = e.target.value; pintarRegistros(); });
$('r-uf').addEventListener('change', function (e) { estado.uf = e.target.value; pintarRegistros(); });
$('r-cidade').addEventListener('change', function (e) { estado.cidade = e.target.value; pintarRegistros(); });
$('r-todos').addEventListener('change', function (e) {
  listaRegistros().forEach(function (c) { estado.marcados[c.id] = e.target.checked; });
  pintarRegistros();
});
$('r-tab').addEventListener('change', function (e) {
  var dono = e.target.closest('select[data-dono]');
  if (dono) {
    var antigo = dono.dataset.anterior;
    gravar('/admin/carteira/atribuir',{ids:[dono.dataset.dono],responsavel_usuario:dono.value},'Responsável atualizado.')
      .then(function(j){if(!j.success && dono.isConnected)dono.value=antigo;});
    return;
  }
  var cid = e.target.closest('input[data-cid]'), uf = e.target.closest('select[data-uf]');
  if (!cid && !uf) return;
  var linha = e.target.closest('tr[data-id]'), id = linha.dataset.id;
  salvarCelula(id, linha.querySelector('input[data-cid]').value.trim(),
               linha.querySelector('select[data-uf]').value);
});
$('r-tab').addEventListener('click', function (e) {
  if (e.target.closest('.edit,.owner-edit')) return;      /* editar nao abre a ficha */
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
  var cid = e.target.closest('input[data-cid]');
  if (cid) {                                  /* Enter grava e desce uma linha */
    var tr = cid.closest('tr'), prox = tr.nextElementSibling;
    cid.blur();
    if (prox && prox.querySelector('input[data-cid]')) prox.querySelector('input[data-cid]').focus();
    return;
  }
  if (e.target.closest('.edit,.owner-edit')) return;
  var tr2 = e.target.closest('tr[data-id]');
  if (tr2) abrirFicha(tr2.dataset.id, 'cliente');
});
$('r-lote').addEventListener('click', function (e) {
  var marcados = function () {
    return Object.keys(estado.marcados).filter(function (k) { return estado.marcados[k]; });
  };
  var nomesDe = function (l) {
    var m = {}; l.forEach(function (i) { if (IX[i]) m[i] = IX[i].nome; }); return m;
  };
  if (e.target.id === 'lt-nada') {
    estado.marcados = {}; estado.unificando = false; pintarRegistros(); return;
  }
  if (e.target.id === 'lt-atribuir') {
    var novo=$('lt-dono').value;
    if(!novo){recado('Escolha um responsável para atribuir.',true);return;}
    gravar('/admin/carteira/atribuir',
      {ids:marcados(),responsavel_usuario:novo==='__sem'?'':novo},'Responsáveis atualizados.')
      .then(function(j){if(j.success){estado.marcados={};pintarRegistros();}});
    return;
  }
  if (e.target.id === 'lt-prio' || e.target.id === 'lt-semprio') {
    var l = marcados();
    gravar('/admin/carteira/rotina-lote',
      { ids: l, nomes: nomesDe(l), prioridade: e.target.id === 'lt-prio',
        dispensa: false, cadencia: 0 },
      e.target.id === 'lt-prio' ? 'Marcados como prioridade.' : 'Prioridade removida.')
      .then(function () { estado.marcados = {}; pintarRegistros(); });
    return;
  }
  if (e.target.id === 'lt-uni') { estado.unificando = true; pintarLote(); return; }
  if (e.target.id === 'lt-uni-nao') { estado.unificando = false; pintarLote(); return; }
  if (e.target.id === 'lt-uni-ok') {
    var esc2 = document.querySelector('input[name="uni-nome"]:checked');
    if (!esc2) { recado('Escolha qual nome fica.', true); return; }
    var todos = marcados().map(function (i) { return IX[i] ? IX[i].nome : ''; }).filter(Boolean);
    e.target.disabled = true; e.target.textContent = 'Unificando…';
    gravar('/admin/carteira/unificar',
      { canonico: esc2.value, apelidos: todos.filter(function (n) { return n !== esc2.value; }) },
      'Cadastros unificados.')
      .then(function () { estado.marcados = {}; estado.unificando = false; pintarRegistros(); });
    return;
  }
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
function abrirFicha(id, tipo, semRolar, focoContato) {
  tipo = tipo || 'cliente';
  if (!semRolar && $('tela').innerHTML && !podeFechar()) return;
  if (!semRolar) focoAnterior = document.activeElement;
  abertaId = id; abertoTipo = tipo;
  history.replaceState(null, '', '#/' + (tipo === 'lead' ? 'lead' : 'cliente') + '/' + id);
  $('tela').innerHTML = tipo === 'lead' ? fichaLead(id) : fichaCliente(id);
  if (tipo === 'cliente') carregarPedidos(id);
  document.body.style.overflow = 'hidden';
  fichaBase = capturarCampos();
  estadoFicha();
  // Vindo da fila, a ficha ja abre no campo de escrever o que foi conversado.
  var nota = focoContato ? $('fc-nota') : null;
  if (nota) {
    // 'nearest' respeita o scroll-padding-top e para logo abaixo da faixa,
    // em vez de centralizar e empurrar os numeros do cliente para fora.
    nota.scrollIntoView({ block: 'nearest' });
    nota.focus({ preventScroll: true });
    return;
  }
  var x = $('fx');
  if (x && !semRolar) x.focus();
}
function fecharFicha(silencioso, forcar) {
  if (!forcar && !podeFechar()) return false;
  fichaBase = {};
  $('tela').innerHTML = '';
  document.body.style.overflow = '';
  abertaId = null;
  if (!silencioso) history.replaceState(null, '', '#/' + estado.tela);
  if (navegandoTeclado && focoAnterior && document.contains(focoAnterior))
    focoAnterior.focus({preventScroll:true});
  return true;
}
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && $('tela').innerHTML) fecharFicha();
});

$('tela').addEventListener('keydown', function (e) {
  if(e.key==='Tab'){
    var itens=Array.from($('tela').querySelectorAll('.gaveta button,.gaveta a[href],.gaveta input,.gaveta select,.gaveta textarea,.gaveta summary')).filter(function(el){return !el.disabled && el.offsetParent!==null;});
    var primeiro=itens[0],ultimo=itens[itens.length-1];
    if(e.shiftKey && document.activeElement===primeiro){e.preventDefault();ultimo.focus();}
    else if(!e.shiftKey && document.activeElement===ultimo){e.preventDefault();primeiro.focus();}
  }
  if (e.target.id === 'fc-nota' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    gravarContato(abertaId, null);
  }
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
    + atalhosContato(c) + '<p id="f-status" class="nota" role="status"></p>'
    + '</div><button class="x" id="fx" type="button" aria-label="Fechar ficha">✕</button></div>'
  + '<div class="gcorpo">'
    + faixaCliente(c, d, anos)
    + '<div class="gdupla">'

    // ── coluna da esquerda: o trabalho. Rotina e contato coladas, porque uma
    //    so existe por causa da outra e ler as duas junto e o dia a dia.
    + '<div class="gcol">'
      + (f ? '<div class="cartao" style="border-color:var(--roxo-borda)">'
          + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap">'
          + '<h3>Por que está na fila</h3><span class="mono" style="font-weight:700;font-size:.82rem">'
          + (f.peso ? moeda(f.peso) + ' · ' + valorReferencia(f.tipo) : 'só rotina') + '</span></div>'
          + '<p class="nota" style="margin-top:5px">' + esc(f.texto) + '</p></div>' : '')

      + formularioContato(id)
      + painelTarefas(id)
      + '<div class="cartao" style="border-color:' + (c.contato_urgente ? '#f0dcae' : '#cfe6da') + '">'
        + '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap">'
        + '<h3>Rotina de contato</h3><span class="mono" style="font-weight:700;font-size:.79rem;color:' + cor + '">'
        + esc(c.contato_rotulo) + '</span></div>'
        + '<p class="nota" style="margin-top:5px">Um contato a cada ' + c.cadencia + ' dias'
        + (c.cadencia_propria ? ' (cadência própria deste cliente)' : ' (padrão da classe ' + c.classe + ')') + '. '
        + (c.dispensa_rotina
            ? 'Ele está fora da rotina e só aparece na fila se houver alerta comercial.'
            : 'Um contato efetivo reinicia a cadência. Uma tarefa com data define o próximo retorno.') + '</p>'
        + '<div class="acoes" style="margin-top:10px">'
          + '<button class="pri" type="button" data-a="prioridade">'
            + (c.prioridade ? '★ Tirar a prioridade' : '★ Marcar como prioridade') + '</button>'
          + '<button type="button" data-a="dispensa">'
            + (c.dispensa_rotina ? 'Voltar para a rotina' : 'Não precisa de rotina') + '</button>'
        + '</div>'
        + '<div class="campo" style="margin-top:10px"><label for="fc-cad">Cadência própria, em dias</label>'
          + '<input id="fc-cad" type="number" min="1" max="365" placeholder="vazio = padrão da classe ('
          + c.classe + ')" value="' + (c.cadencia_propria ? c.cadencia : '') + '"></div><div class="acoes"><button data-a="salvar">Salvar rotina e ficha</button></div>'
      + '</div>'
    + '</div>'

    // ── coluna da direita: o cadastro e os números ──
    + '<div class="gcol">'
      + '<details class="cartao cadastro-detalhes"><summary>Cadastro e regras de atendimento</summary><div class="campo"><label for="fc-contato">Pessoa de contato</label><input id="fc-contato" maxlength="120" value="' + esc(c.contato || '') + '"></div><div class="campo"><label for="fc-telefone">Telefone com DDD</label><input id="fc-telefone" type="tel" maxlength="40" value="' + esc(c.telefone || '') + '"></div><div class="campo"><label for="fc-email">E-mail</label><input id="fc-email" type="email" maxlength="160" value="' + esc(c.email || '') + '"></div><div class="campo"><label for="fc-dono">Responsável pela carteira</label><select id="fc-dono">' + opcoesResponsavel(c.responsavel_usuario || '') + '</select><p class="nota">Clientes sem responsável ficam na fila de distribuição e não entram em uma agenda pessoal.</p></div>'
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
              ? 'Você trocou a classificação. O valor exibido continua vindo do histórico de vendas, '
                + 'com o significado indicado no cartão do cliente.'
              : 'O sistema classifica sozinho pelo que os números dizem. Se ele errar, escolha aqui e '
                + 'escreva o porquê no motivo abaixo.') + '</p></div>'
      + '</div>'
      + '<div class="cartao">'
        + '<div class="campo"><label for="fc-motivo">Motivo da situação (texto livre)</label>'
          + '<textarea id="fc-motivo" rows="2" placeholder="Ex.: o dono faleceu em março; a filha assumiu e ainda não retomou.">'
          + esc(c.motivo) + '</textarea></div>'
        + '<div class="grade g2" style="margin-top:10px">'
          + '<div class="campo"><label for="fc-uf">Estado da sede</label><select id="fc-uf">'
            + '<option value="">—</option>' + UFS.map(function (u) {
                return '<option' + (c.uf_base === u ? ' selected' : '') + '>' + u + '</option>'; }).join('')
            + '</select></div>'
          + '<div class="campo"><label for="fc-cidade">Cidade</label>'
            + '<input id="fc-cidade" value="' + esc(c.cidade) + '"></div>'
        + '</div>'
        + '<div class="campo" style="margin-top:10px"><label>Área de atuação (onde ele vende)</label>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + REGIOES.map(function (r) {
              var on = c.atuacao.indexOf(r[0]) >= 0;
              return '<button class="ficha" type="button" data-at="' + r[0] + '" aria-pressed="' + on + '">'
                + r[1] + '</button>'; }).join('') + '</div></div>'
        + '<div class="campo" style="margin-top:10px"><label for="fc-sit">Situação declarada</label>'
          + '<select id="fc-sit">'
          + ['ativo', 'pausado', 'perdido'].map(function (s) {
              return '<option value="' + s + '"' + (c.situacao === s ? ' selected' : '') + '>'
                + (s === 'ativo' ? 'Ativo' : s === 'pausado' ? 'Pausado' : 'Encerrado') + '</option>'; }).join('')
          + '</select></div>'
        + '<div class="acoes" style="margin-top:11px">'
          + '<button class="pri" type="button" data-a="salvar">Salvar ficha</button></div>'
      + '</div>'
      + '</details><div class="cartao">'
        + stat('Maior pedido', cheio(c.tmax))
        + stat('Primeira compra', dia(c.primeira))
        + stat('Compras no total', String(c.compras))
        + stat('Entrou em', String(c.coorte))
        + stat('Área de atuação', c.atuacao_rotulo || 'não preenchida')
        + (c.alias && c.alias.length ? stat('Também aparecia como', esc(c.alias.join(', '))) : '')
      + '</div>'
      + '<div class="cartao pedidos-cartao"><div class="pedidos-cabecalho"><h3>Histórico de compras</h3>'
        + '<span class="pedidos-contagem" id="f-pedidos-contagem"></span></div>'
        + '<div id="f-pedidos" role="status"><p class="nota">Carregando compras…</p></div>'
        + '<p class="nota pedidos-fonte">A importação de vendas contém data, cliente e valor. Lançamentos do mesmo dia são agrupados como uma compra; número do pedido e produtos não constam nessa origem.</p>'
        + '<div class="pedidos-cabecalho pedidos-subtitulo"><h3>Pedidos especiais</h3><span class="pedidos-contagem" id="f-especiais-contagem"></span></div>'
        + '<div id="f-pedidos-especiais" role="status"><p class="nota">Carregando pedidos…</p></div>'
      + '</div>'
      + '<div class="cartao"><h3 style="margin-bottom:8px">Quando ele compra</h3>' + sazCliente(c.mensal) + '</div>'
    + '</div>'

    + '</div>'
  + '</div></aside>';
}

function carregarPedidos(id) {
  var alvo = $('f-pedidos');
  if (!alvo) return;
  alvo.innerHTML = '<p class="nota">Carregando compras…</p>';
  fetch('/admin/carteira/cliente/' + encodeURIComponent(id) + '/pedidos')
    .then(function(r) { return r.json(); })
    .then(function(j) {
      if (abertaId !== id || abertoTipo !== 'cliente' || !$('f-pedidos')) return;
      if (!j.success) throw new Error(j.erro || 'Falha ao carregar compras.');
      var pedidos = j.pedidos || [];
      $('f-pedidos-contagem').textContent = pedidos.length + (pedidos.length === 1 ? ' compra' : ' compras');
      $('f-pedidos').removeAttribute('role');
      $('f-pedidos').innerHTML = pedidos.length ? '<ol class="pedidos-lista">'
        + pedidos.map(function(p) {
            return '<li class="pedido-item"><div class="pedido-principal">'
              + '<time datetime="' + esc(p.data) + '">' + esc(dia(p.data)) + '</time>'
              + '<strong>' + esc(cheio(p.valor)) + '</strong></div>'
              + (p.registros > 1 ? '<details class="pedido-detalhes"><summary>'
                + p.registros + ' lançamentos neste dia</summary><ul>'
                + (p.valores || []).map(function(v) { return '<li>' + esc(cheio(v)) + '</li>'; }).join('')
                + '</ul></details>' : '') + '</li>';
          }).join('') + '</ol>' : '<p class="nota">Nenhuma compra encontrada.</p>';
      var especiais = j.pedidos_especiais || [];
      $('f-especiais-contagem').textContent = especiais.length
        + (especiais.length === 1 ? ' item' : ' itens');
      $('f-pedidos-especiais').removeAttribute('role');
      $('f-pedidos-especiais').innerHTML = especiais.length ? '<ol class="pedidos-lista">'
        + especiais.map(function(p) {
            return '<li class="pedido-item"><div class="pedido-principal">'
              + '<strong class="pedido-produto">' + esc(p.produto) + '</strong>'
              + '<span class="pedido-situacao' + (p.concluido ? ' pronto' : '') + '">'
              + (p.concluido ? 'Concluído' : 'Em aberto') + '</span></div>'
              + '<div class="pedido-metadata">' + esc(p.quantidade) + ' un. · registrado em '
              + esc(p.criado_em || '—')
              + (p.data_entrega ? ' · entrega ' + esc(p.data_entrega) : '')
              + (p.urgente ? ' · urgente' : '') + '</div></li>';
          }).join('') + '</ol>' : '<p class="nota">Nenhum pedido especial vinculado a este nome de cliente.</p>';
    }).catch(function() {
      if (abertaId !== id || abertoTipo !== 'cliente' || !$('f-pedidos')) return;
      $('f-pedidos').innerHTML = '<p class="nota">Não foi possível carregar as compras.</p>'
        + '<button type="button" data-a="pedidos-recarregar">Tentar novamente</button>';
      $('f-pedidos-especiais').innerHTML = '';
    });
}

/* O que se olha antes de ligar fica na primeira tela, sem rolagem: tamanho do
   cliente, pedido tipico, quando comprou pela ultima vez e a comparacao dos
   tres anos. O resto e consulta e pode ficar embaixo. */
function faixaCliente(c, d, anos) {
  var cor = d[1] === 'crescer' ? 'var(--bom)' : d[1] === 'queda' ? 'var(--ruim)'
          : d[1] === 'novo' ? 'var(--s1)' : 'var(--frio)';
  var tile = function (k, v, s2, corv) {
    return '<div class="tile"><span class="k">' + k + '</span>'
      + '<span class="v"' + (corv ? ' style="color:' + corv + '"' : '') + '>' + v + '</span>'
      + (s2 ? '<span class="s">' + s2 + '</span>' : '') + '</div>';
  };
  var v = c.var_ytd_pct;
  return '<div class="cartao faixatopo">'
    + '<div class="nums">'
      + tile('Receita total', cheio(c.receita), c.compras + ' compras')
      + tile('Pedido médio', cheio(c.ticket), 'maior: ' + moeda(c.tmax))
      + tile('Última compra', dia(c.ultima), (c.dias_desde_compra_hoje === undefined ? c.recencia : c.dias_desde_compra_hoje) + ' dias atrás'
          + (c.intervalo ? ' · compra a cada ~' + c.intervalo : ''))
      + tile('No ano vs. média', v === null ? '—' : pct(v),
             d[0] + (c.ritmo ? ' · ' + c.ritmo : ''), v === null ? '' : cor)
    + '</div>'
    + '<div class="anosmini">' + barrasAnoMini(c, anos) + '</div>'
  + '</div>';
}

function barrasAnoMini(c, anos) {
  var vals = anos.map(function (a) { return c.ytd_anos[a] || 0; });
  var max = Math.max.apply(null, vals) || 1;
  var w = 196, h = 52, bw = 40, gap = 18, x0 = 8;
  var s = '<svg viewBox="0 0 ' + w + ' ' + (h + 28) + '" width="' + w + '" height="' + (h + 28)
    + '" role="img" aria-label="Receita no mesmo período de cada ano">';
  vals.forEach(function (val, i) {
    var a = (val / max) * h, x = x0 + i * (bw + gap);
    var cr = i === vals.length - 1 ? 'var(--s1)' : (i === vals.length - 2 ? 'var(--s2)' : 'var(--s3)');
    s += '<rect x="' + x + '" y="' + (h - a).toFixed(1) + '" width="' + bw + '" height="'
      + Math.max(a, 1).toFixed(1) + '" rx="2" fill="' + cr + '"/>'
      + '<text x="' + (x + bw / 2) + '" y="' + (h + 12) + '" font-size="9" fill="var(--texto3)" text-anchor="middle">'
      + anos[i] + '</text>'
      + '<text x="' + (x + bw / 2) + '" y="' + (h + 24) + '" font-size="9.5" fill="var(--texto)" '
      + 'text-anchor="middle" font-weight="600">' + moeda(val).replace('R$ ', '') + '</text>';
  });
  return s + '</svg><span class="leg2">1º de janeiro até o mesmo dia de cada ano</span>';
}

function fichaLead(id) {
  var L = LEAD_IX[id];
  if (!L) return '';
  return '<button class="veu" id="veu" type="button" aria-label="Fechar"></button>'
  + '<aside class="gaveta" role="dialog" aria-modal="true" aria-label="Lead ' + esc(L.nome) + '">'
  + '<div class="gtopo"><div style="min-width:0">'
    + '<p class="olho" style="margin-bottom:3px">Lead'
      + (L.revenda ? ' · JÁ REVENDE PIROMAX' : '') + '</p>'
    + '<h2 style="word-break:break-word">' + esc(L.nome) + '</h2>'
    + '<p style="margin-top:4px;color:var(--texto2);font-size:.79rem">'
      + esc([L.cidade, L.uf].filter(Boolean).join(' / ') || 'sem cidade') + '</p>'
    + '</div><button class="x" id="fx" type="button" aria-label="Fechar ficha">✕</button></div>'
  + '<div class="gcorpo">'
    + '<p id="f-status" class="nota" role="status"></p>' + atalhosContato(L)
    + formularioContato(id) + painelTarefas(id)
    + '<details class="cartao cadastro-detalhes"><summary>Cadastro, etapa e vínculo com cliente</summary>'
    + '<div class="cartao"' + (L.revenda ? ' style="border-color:#f0dcae"' : '') + '>'
      + '<h3>Já revende Piromax?</h3>'
      + '<p class="nota" style="margin-top:4px;margin-bottom:9px">Marque quando ele já vende produto '
      + 'Piromax comprado de um cliente seu. A conversa passa a ser outra: ele conhece o produto, '
      + 'e puxar para venda direta mexe com o seu próprio distribuidor.</p>'
      + '<label style="display:flex;gap:8px;align-items:center;font-size:.85rem;cursor:pointer">'
      + '<input type="checkbox" id="fl-revenda"' + (L.revenda ? ' checked' : '')
      + ' style="width:16px;height:16px;accent-color:var(--roxo)">'
      + 'Compra Piromax por revenda</label>'
      + '<div class="campo" style="margin-top:9px"><label for="fl-revde">De qual cliente seu</label>'
      + '<input id="fl-revde" list="fl-clientes" value="' + esc(L.revenda_de || '') + '" '
      + 'placeholder="nome do cliente que abastece ele">'
      + '<datalist id="fl-clientes">'
      + (D && D.clientes ? D.clientes.map(function (c) {
          return '<option value="' + esc(c.nome) + '">'; }).join('') : '')
      + '</datalist></div></div>'
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
    + '<div class="campo"><label for="fl-insta">Instagram ou site</label>'
      + '<input id="fl-insta" value="' + esc(L.instagram || '') + '" placeholder="cole o link do perfil">'
      + (L.instagram ? '<p class="nota" style="margin-top:3px"><a href="' + esc(L.instagram)
          + '" target="_blank" rel="noopener noreferrer">abrir ' + esc(perfil(L.instagram))
          + '</a></p>' : '') + '</div>'
    + '<div class="campo"><label for="fl-seg">Tipo de negócio</label>'
      + '<input id="fl-seg" value="' + esc(L.segmento || '') + '" list="fl-segs">'
      + '<datalist id="fl-segs">' + ((PROSPEC && PROSPEC.por_segmento) || []).map(function (q) {
          return '<option value="' + esc(q[0]) + '">'; }).join('') + '</datalist></div>'
    + '<div class="campo"><label for="fl-cliente">Cliente vinculado</label><select id="fl-cliente"><option value="">Ainda sem vínculo</option>' + (D ? D.clientes : []).map(function(c){return '<option value="'+esc(c.id)+'"'+(L.cliente_id===c.id?' selected':'')+'>'+esc(c.nome)+'</option>';}).join('') + '</select><p class="nota">Ganho indica negociação fechada. Após importar a primeira venda, selecione o cliente correspondente. O vínculo não altera vendas.</p></div>'
    + '<div class="campo"><label for="fl-dono">Responsável pelo lead</label><select id="fl-dono">'+opcoesResponsavel(donoRegistro(id))+'</select><p class="nota">Se estiver vinculado a um cliente, a agenda seguirá o responsável desse cliente.</p></div>'
    + '<div class="campo"><label for="fl-prox">Próximo passo</label>'
      + '<input id="fl-prox" value="' + esc(L.proximo) + '" placeholder="Ex.: mandar tabela de preço"></div>'
    + '<div class="campo"><label for="fl-quando">Para quando</label>'
      + '<input id="fl-quando" type="date" value="' + esc(L.proximo_em || '') + '"></div>'
    + '<div class="campo"><label for="fl-motivo">Observação ou motivo da perda</label>'
      + '<textarea id="fl-motivo" rows="2">' + esc(L.motivo || L.obs || '') + '</textarea></div>'
    + '<div class="acoes"><button class="pri" type="button" data-a="lead-salvar">Salvar lead</button>'
      + '</div></details>'
  + '</div></aside>';
}

/* Lead que chega por telefone ou feira, sem planilha no meio. */
function abrirNovoLead() {
  if ($('tela').innerHTML && !podeFechar()) return;
  focoAnterior=document.activeElement;
  abertaId = null; abertoTipo = 'novo';
  var campo = function (id, rot, extra) {
    return '<div class="campo"><label for="' + id + '">' + rot + '</label>'
      + '<input id="' + id + '" ' + (extra || '') + '></div>';
  };
  $('tela').innerHTML =
    '<button class="veu" id="veu" type="button" aria-label="Fechar"></button>'
  + '<aside class="gaveta" role="dialog" aria-modal="true" aria-label="Novo lead">'
  + '<div class="gtopo"><div style="min-width:0">'
    + '<p class="olho" style="margin-bottom:3px">Prospecção</p><h2>Novo lead</h2>'
    + '<p style="margin-top:4px;color:var(--texto2);font-size:.79rem">'
    + 'Só o nome da empresa é obrigatório. O lead ficará sob sua responsabilidade.</p>'
    + '</div><button class="x" id="fx" type="button" aria-label="Fechar">✕</button></div>'
  + '<div class="gcorpo">'
    + campo('nl-nome', 'Empresa', 'placeholder="Nome como aparece na nota" autofocus')
    + '<div class="grade g2">'
      + campo('nl-cidade', 'Cidade')
      + '<div class="campo"><label for="nl-uf">Estado</label><select id="nl-uf">'
        + '<option value="">—</option>'
        + UFS.map(function (u) { return '<option>' + u + '</option>'; }).join('') + '</select></div>'
      + campo('nl-contato', 'Quem é o contato')
      + campo('nl-tel', 'Telefone')
    + '</div>'
    + '<div class="grade g2">'
      + '<div class="campo"><label for="nl-seg">Tipo de negócio</label>'
        + '<input id="nl-seg" list="nl-segs" placeholder="Lojista, Shows…">'
        + '<datalist id="nl-segs">' + ((PROSPEC && PROSPEC.por_segmento) || []).map(function (p) {
            return '<option value="' + esc(p[0]) + '">'; }).join('') + '</datalist></div>'
      + '<div class="campo"><label for="nl-etapa">Etapa</label><select id="nl-etapa">'
        + ETAPAS.map(function (e) { return '<option value="' + e[0] + '">' + e[1] + '</option>'; }).join('')
        + '</select></div>'
    + '</div>'
    + campo('nl-insta', 'Instagram ou site', 'placeholder="cole o link do perfil"')
    + '<label style="display:flex;gap:8px;align-items:center;font-size:.85rem;cursor:pointer">'
      + '<input type="checkbox" id="nl-revenda" style="width:16px;height:16px;accent-color:var(--roxo)">'
      + 'Já revende Piromax comprando de um cliente meu</label>'
    + '<div class="campo"><label for="nl-revde">De qual cliente seu</label>'
      + '<input id="nl-revde" list="nl-clientes" placeholder="opcional">'
      + '<datalist id="nl-clientes">' + (D && D.clientes ? D.clientes.map(function (c) {
          return '<option value="' + esc(c.nome) + '">'; }).join('') : '') + '</datalist></div>'
    + campo('nl-prox', 'Próximo passo', 'placeholder="Ex.: mandar tabela de preço"')
    + '<div class="campo"><label for="nl-quando">Para quando</label>'
      + '<input id="nl-quando" type="date"></div>'
    + '<div class="campo"><label for="nl-obs">Observação</label><textarea id="nl-obs" rows="2"></textarea></div>'
    + '<div class="acoes"><button class="pri" type="button" data-a="lead-criar">Criar lead</button>'
      + '<button type="button" data-a="fechar">Cancelar</button></div>'
    + '<p class="nota">Leads com o mesmo nome e cidade não são duplicados. Confira possíveis vínculos com clientes após cadastrar.</p>'
  + '</div></aside>';
  document.body.style.overflow = 'hidden';
  fichaBase=capturarCampos();
  if ($('nl-nome')) $('nl-nome').focus();
}

function criarLead(botao) {
  if (gravando) return;
  var nome = ($('nl-nome').value || '').trim();
  if (!nome) { recado('Escreva o nome da empresa.', true); $('nl-nome').focus(); return; }
  gravando=true;estadoFicha();
  if (botao) { botao.disabled = true; botao.textContent = 'Criando…'; }
  fetch('/admin/carteira/lead/novo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: nome, cidade: $('nl-cidade').value, uf: $('nl-uf').value,
      contato: $('nl-contato').value, telefone: $('nl-tel').value,
      segmento: $('nl-seg').value, etapa: $('nl-etapa').value,
      instagram: $('nl-insta').value, proximo: $('nl-prox').value,
      revenda: $('nl-revenda').checked, revenda_de: $('nl-revde').value,
      proximo_em: $('nl-quando').value || null, obs: $('nl-obs').value
    })
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j.success) {
      recado(j.erro || 'Não consegui criar.', true);
      if (botao) { botao.disabled = false; botao.textContent = 'Criar lead'; }
      // Mantém o rascunho para o usuário corrigir os dados.

      return;
    }
    recado('Lead criado.');
    fecharFicha(true, true);
    return atualizar().then(function () { abrirFicha(j.id, 'lead',true); });
  }).catch(function(){recado('Não foi possível confirmar a criação. O rascunho foi mantido.',true);})
    .finally(function(){gravando=false;if(botao){botao.disabled=false;botao.textContent='Criar lead';}estadoFicha();});
}

/* um único ouvinte na gaveta: ela é reconstruída a cada gravação */
$('tela').addEventListener('click', function (e) {
  if (e.target.id === 'veu' || e.target.id === 'fx') { fecharFicha(); return; }

  var at = e.target.closest('button[data-at]');
  if (at) { at.setAttribute('aria-pressed', at.getAttribute('aria-pressed') !== 'true'); estadoFicha(); return; }

  var del = e.target.closest('button[data-del]');
  if (del) {
    fetch('/admin/carteira/interacao/' + del.dataset.del, { method: 'DELETE' })
      .then(function () { atualizar(); recado('Contato apagado.'); });
    return;
  }

  var b = e.target.closest('button[data-a]');
  if (!b) return;
  var id = abertaId, a = b.dataset.a;

  if (a === 'pedidos-recarregar') { carregarPedidos(id); return; }
  if (a === 'lead-criar') { criarLead(b); return; }
  if (a === 'fechar') { fecharFicha(); return; }
  if (a === 'ir-contato') {
    var alvo = $('fc-nota');
    if (alvo) { alvo.scrollIntoView({ block: 'center' }); alvo.focus(); }
    return;
  }
  if (a === 'tarefa') {
    if (!$('ft-titulo').value.trim() || !$('ft-prazo').value) { recado('Informe a tarefa e o prazo.',true);return; }
    gravar('/admin/carteira/tarefa',{cliente_id:id,titulo:$('ft-titulo').value,prazo:$('ft-prazo').value,responsavel:$('ft-responsavel').value},'Tarefa agendada.',['ft-titulo','ft-prazo','ft-responsavel']);
  } else if (a === 'contato') {
    gravarContato(id, b);
  } else if (a === 'prioridade') {
    salvarFicha(id, { prioridade: !IX[id].prioridade },
      IX[id].prioridade ? 'Prioridade removida.' : 'Marcado como prioridade.');
  } else if (a === 'dispensa') {
    salvarFicha(id, { dispensa: !IX[id].dispensa_rotina },
      IX[id].dispensa_rotina ? 'De volta à rotina.' : 'Fora da rotina.');
  } else if (a === 'salvar') {
    salvarFicha(id, {}, 'Ficha salva.');
  } else if (a === 'lead-salvar') {
    gravar('/admin/carteira/lead', {
      id: id, cliente_id: $('fl-cliente').value, responsavel_usuario:$('fl-dono').value,
      etapa: $('fl-etapa').value, contato: $('fl-contato').value,
      telefone: $('fl-tel').value, cidade: $('fl-cidade').value, uf: $('fl-uf').value,
      proximo: $('fl-prox').value, proximo_em: $('fl-quando').value, motivo: $('fl-motivo').value,
      instagram: $('fl-insta').value, segmento: $('fl-seg').value,
      revenda: $('fl-revenda').checked, revenda_de: $('fl-revde').value
    }, 'Lead salvo.', Object.keys(capturarCampos()).filter(function(k){return k.indexOf('fl-')===0;}));
  } else if (a === 'lead-remover') {
    fetch('/admin/carteira/lead/' + id, { method: 'DELETE' })
      .then(function () { fecharFicha(); atualizar(); recado('Lead removido.'); });
  }
});

function gravarContato(id, botao) {
  if(gravando) return;
  var t=$('fc-nota').value.trim(), prox=$('fc-proximo').value.trim(), prazo=$('fc-prazo').value, resultado=$('fc-resultado').value;
  if(!t){recado('Escreva um resumo da conversa ou tentativa.',true);$('fc-nota').focus();return;}
  if(!!prox !== !!prazo || (['sem_resposta','retorno'].indexOf(resultado)>=0 && !prox)){
    recado('Informe o próximo passo e a data do retorno.',true);$('fc-proximo').focus();return;
  }
  if(prazo && prazo<hojeISO()){recado('Agende o retorno para hoje ou uma data futura.',true);return;}
  return gravar('/admin/carteira/contato',{cliente_id:id,resumo:t,resultado:resultado,proximo:prox,proximo_em:prazo,tarefa_id:$('fc-concluir').value},
    'Contato salvo'+(prox?' e próximo passo agendado.':'.'),['fc-nota','fc-resultado','fc-proximo','fc-prazo','fc-concluir']);
}

function salvarFicha(id, extra, msg) {
  var c = IX[id];
  var corpo = {
    cliente_id: id, cliente_nome: c.nome,
    contato:$('fc-contato').value, telefone:$('fc-telefone').value, email:$('fc-email').value,
    responsavel_usuario:$('fc-dono').value,
    motivo: $('fc-motivo') ? $('fc-motivo').value : c.motivo,
    cidade: $('fc-cidade') ? $('fc-cidade').value : c.cidade,
    estado: $('fc-uf') ? $('fc-uf').value : c.uf_base,
    situacao: $('fc-sit') ? $('fc-sit').value : c.situacao,
    dispensa: c.dispensa_rotina,
    cadencia: $('fc-cad') ? ($('fc-cad').value || 0) : (c.cadencia_propria ? c.cadencia : 0),
    prioridade: c.prioridade,
    tipo: $('fc-tipo') ? $('fc-tipo').value : c.tipo,
    classe_manual: $('fc-cman') ? $('fc-cman').value : c.classe_manual,
    atuacao: Array.prototype.slice.call(document.querySelectorAll('[data-at][aria-pressed="true"]'))
      .map(function (x) { return x.dataset.at; })
  };
  for (var k in extra) corpo[k] = extra[k];
  return gravar('/admin/carteira/ficha', corpo, msg, Object.keys(capturarCampos()).filter(function(k){return k.indexOf('at:')===0 || ['fc-motivo','fc-cidade','fc-uf','fc-sit','fc-cad','fc-tipo','fc-cman','fc-contato','fc-telefone','fc-email','fc-dono'].indexOf(k)>=0;}));
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
  $('a-corpo').innerHTML = resumoResultados() + capVisao() + capAnoAno() + capDirecao() + capConcentracao()
    + capRegiao() + capProjecao();
  ligarDica();
}
function resumoResultados() {
  var clientes=D.clientes, ultimo=D.anos.anos[D.anos.anos.length-1];
  var metricas=[['caindo','Clientes em queda',clientes.filter(function(c){return c.direcao==='em queda'||c.direcao==='queda forte';}).length],['parou','Sem compras no ano',clientes.filter(function(c){return c.direcao==='parou';}).length],['vencido','Contato pendente',clientes.filter(function(c){return c.contato_urgente&&!c.encerrado&&!c.ocasional;}).length]];
  return '<div class="resultados-resumo"><div class="cartao"><span>Receita no período comparável</span><strong>'+moeda(ultimo.receita)+'</strong><small>1º de janeiro a '+D.anos.corte+'</small></div>'+metricas.map(function(m){return '<button class="cartao" data-visao="'+m[0]+'"><span>'+m[1]+'</span><strong>'+m[2]+'</strong><small>Ver clientes →</small></button>';}).join('')+'</div>';
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
      + 'Preencha em <b>Clientes</b>, marcando vários clientes de uma vez. Este capítulo separa duas coisas '
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

function prVisiveis() {
  var P = PROSPEC || { leads: [] };
  var q = estado.prBusca.trim().toLowerCase();
  return P.leads.filter(function (x) {
    return (!prFiltro.seg || (x.segmento || 'sem segmento') === prFiltro.seg)
        && (!prFiltro.reg || (x.regiao_nome || 'sem estado') === prFiltro.reg)
        && (!estado.prUf || x.uf === estado.prUf)
        && (!estado.prCidade || (x.cidade || '') === estado.prCidade)
        && (!estado.prEtapa || x.etapa === estado.prEtapa)
        && (!estado.prDono || (estado.prDono==='meus' ? donoRegistro(x.id)===USUARIO_ATUAL
             : estado.prDono==='sem' ? !donoRegistro(x.id) : donoRegistro(x.id)===estado.prDono))
        && (!estado.prAcao || (estado.prAcao==='semacao' ? (!x.proximo && !proximaTarefa(x.id) && ['ganho','perdido'].indexOf(x.etapa)<0) : (proximaTarefa(x.id) && proximaTarefa(x.id).prazo && proximaTarefa(x.id).prazo<hojeISO())))
        && (!estado.prRevenda || (estado.prRevenda === 'sim' ? x.revenda : !x.revenda))
        && (!q || x.nome.toLowerCase().indexOf(q) >= 0
             || (x.cidade || '').toLowerCase().indexOf(q) >= 0);
  });
}

function pintarProspeccao() {
  var P = PROSPEC || { leads: [], etapas: [], total: 0, abertos: 0, ganhos: 0, perdidos: 0,
                       revendas: 0, por_segmento: [], por_regiao: [], cidades: [],
                       acompanhar: { vencidos: [], hoje: [], proximos: [], sem_data: [], total: 0 } };
  var vis = prVisiveis().sort(function(a,b){var ta=proximaTarefa(a.id),tb=proximaTarefa(b.id);return ((ta && ta.prazo)||'9999').localeCompare((tb && tb.prazo)||'9999')||a.nome.localeCompare(b.nome);});
  var A = P.acompanhar || { vencidos: [], hoje: [], proximos: [], sem_data: [], total: 0 };

  /* ── Para acompanhar: o que ficou combinado e tem data ── */
  var linhaAc = function (x, cor, quando) {
    return '<button class="acomp" type="button" data-l="' + esc(x.id) + '">'
      + '<span class="q" style="color:' + cor + '">' + quando + '</span>'
      + '<span class="t"><b>' + esc(x.nome) + '</b>'
      + '<small>' + esc(x.proximo || 'sem o que foi combinado escrito')
      + (x.cidade ? ' · ' + esc([x.cidade, x.uf].filter(Boolean).join('/')) : '')
      + (x.telefone ? ' · ' + esc(x.telefone) : '') + '</small></span>'
      + '<span class="e">' + esc(rotuloEtapa(x.etapa)) + '</span></button>';
  };
  var acompanhar = '<div class="cartao"><div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">'
    + '<h3>Para acompanhar</h3>'
    + '<span class="mono" style="color:var(--texto3);font-size:.76rem">'
    + (A.total ? A.total + ' próximo(s) passo(s)' : 'nada combinado ainda') + '</span>'
    + (A.vencidos.length ? '<span class="selo s-queda" style="margin-left:auto">'
        + A.vencidos.length + ' vencido(s)</span>' : '') + '</div>'
    + (A.total
        ? '<div class="acomps">'
          + A.vencidos.map(function (x) {
              return linhaAc(x, 'var(--ruim)', 'venceu há ' + x.atraso + 'd'); }).join('')
          + A.hoje.map(function (x) { return linhaAc(x, 'var(--atencao)', 'é hoje'); }).join('')
          + A.proximos.map(function (x) { return linhaAc(x, 'var(--texto2)', dia(x.proximo_em)); }).join('')
          + A.sem_data.map(function (x) { return linhaAc(x, 'var(--texto3)', 'sem data'); }).join('')
          + '</div>'
        : '<p class="nota" style="margin-top:6px">Aqui aparece o que você combinou com cada lead e '
          + 'marcou uma data. Abra um lead, escreva o próximo passo e o para quando, e ele passa a '
          + 'cobrar você aqui. Vencido vem primeiro, em vermelho.</p>');
  acompanhar += '</div>';

  /* ── filtros, valem para o funil e para a lista ── */
  var ufs = {}, cids = {};
  P.leads.forEach(function (x) {
    if (x.uf) ufs[x.uf] = (ufs[x.uf] || 0) + 1;
    if (x.cidade) cids[x.cidade] = (cids[x.cidade] || 0) + 1;
  });
  var opc = function (obj, vazio, sel) {
    return '<option value="">' + vazio + '</option>' + Object.keys(obj).sort().map(function (k) {
      return '<option value="' + esc(k) + '"' + (sel === k ? ' selected' : '') + '>'
        + esc(k) + ' (' + obj[k] + ')</option>';
    }).join('');
  };
  var barra = '<div class="barra" style="margin:14px 0 11px">'
    + '<div class="busca"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" aria-hidden="true" style="color:var(--texto3);flex:0 0 15px">'
      + '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>'
      + '<label for="pr-busca" style="position:absolute;left:-9999px">Buscar lead</label>'
      + '<input id="pr-busca" type="search" placeholder="Buscar empresa ou cidade…" autocomplete="off" '
      + 'value="' + esc(estado.prBusca) + '"></div>'
    + '<label for="pr-uf" style="position:absolute;left:-9999px">Estado</label>'
    + '<select id="pr-uf" class="filtro">' + opc(ufs, 'Todos os estados', estado.prUf) + '</select>'
    + '<label for="pr-cidade" style="position:absolute;left:-9999px">Cidade</label>'
    + '<select id="pr-cidade" class="filtro">' + opc(cids, 'Todas as cidades', estado.prCidade) + '</select>'
    + '<label for="pr-etapa" style="position:absolute;left:-9999px">Etapa</label>'
    + '<select id="pr-etapa" class="filtro"><option value="">Todas as etapas</option>'
      + ETAPAS.map(function (e) {
          return '<option value="' + e[0] + '"' + (estado.prEtapa === e[0] ? ' selected' : '') + '>'
            + e[1] + '</option>'; }).join('') + '</select>'
    + '<label for="pr-acao" class="sr-only">Pendências</label><select id="pr-acao" class="filtro"><option value="">Todas as pendências</option><option value="semacao"'+(estado.prAcao==='semacao'?' selected':'')+'>Sem próxima ação</option><option value="vencido"'+(estado.prAcao==='vencido'?' selected':'')+'>Retorno vencido</option></select>'
    + '<label for="pr-dono" class="sr-only">Responsável pelo lead</label><select id="pr-dono" class="filtro">'
    + '<option value="">Todos os responsáveis</option><option value="meus"'+(estado.prDono==='meus'?' selected':'')+'>Meus leads</option><option value="sem"'+(estado.prDono==='sem'?' selected':'')+'>Sem responsável</option>'
    + USUARIOS_CRM.map(function(u){return '<option value="'+u[0]+'"'+(estado.prDono===u[0]?' selected':'')+'>'+u[1]+'</option>';}).join('')+'</select>'
    + '<label for="pr-rev" style="position:absolute;left:-9999px">Revenda</label>'
    + '<select id="pr-rev" class="filtro">'
      + '<option value="">Revenda: todos</option>'
      + '<option value="sim"' + (estado.prRevenda === 'sim' ? ' selected' : '') + '>'
        + 'Só quem já revende (' + (P.revendas || 0) + ')</option>'
      + '<option value="nao"' + (estado.prRevenda === 'nao' ? ' selected' : '') + '>'
        + 'Só quem não revende</option></select>'
    + '<span class="mono" style="color:var(--texto3);font-size:.76rem">' + vis.length + ' de ' + P.total + '</span>'
    + '<span class="acoes" style="margin-left:auto">'
      + '<button type="button" id="pr-modo">' + (estado.prView === 'funil' ? 'Ver em lista' : 'Ver o funil') + '</button>'
      + '<button type="button" class="pri" id="pr-novo">Novo lead</button></span>'
    + (prFiltrando() ? '<button type="button" id="pr-limpa" class="ficha">limpar filtros ✕</button>' : '')
    + '</div>';

  /* ── funil: todas as colunas rolam por dentro, ninguém fica escondido ── */
  var colunas = ETAPAS.map(function (e) {
    var l = vis.filter(function (x) { return x.etapa === e[0]; });
    return '<div class="cartao col"><div class="cab">'
      + '<i style="background:' + CORES_ETAPA[e[0]] + '"></i><h3>' + e[1] + '</h3>'
      + '<span class="n">' + l.length + '</span></div>'
      + '<p class="nota" style="margin:0">' + e[2] + '</p>'
      + (l.length ? '<div class="pilha">' + l.map(cartaoLead).join('') + '</div>'
          : '<p class="vazio" style="padding:16px 8px;font-size:.78rem">vazio</p>')
      + '</div>';
  }).join('');

  /* ── lista: a mesma coisa em tabela, para varrer de uma vez ── */
  var lista = loteLeads(vis) + '<div class="tw"><table id="pr-tab"><thead><tr>'
    + '<th class="marc"><input type="checkbox" id="pr-todos" aria-label="Marcar todos"></th>'
    + '<th>Empresa</th><th>Cidade</th><th>UF</th><th>Tipo</th><th>Etapa</th>'
    + '<th>Telefone</th><th>Instagram</th><th>Revenda</th><th>Próximo passo</th></tr></thead><tbody>'
    + (vis.length ? vis.map(function (x) {
        return '<tr data-l="' + esc(x.id) + '" tabindex="0">'
          + '<td class="marc"><input type="checkbox" data-pm="' + esc(x.id) + '"'
            + (estado.prMarcados[x.id] ? ' checked' : '')
            + ' aria-label="Marcar ' + esc(x.nome) + '"></td>'
          + '<td class="nm">' + esc(x.nome) + '</td>'
          + '<td>' + esc(x.cidade || '—') + '</td><td>' + esc(x.uf || '—') + '</td>'
          + '<td style="font-size:.79rem;color:var(--texto2)">' + esc(x.segmento || '—') + '</td>'
          + '<td><span class="selo s-classe">' + esc(rotuloEtapa(x.etapa)) + '</span></td>'
          + '<td class="mono" style="font-size:.78rem">' + esc(x.telefone || '—') + '</td>'
          + '<td>' + (x.instagram
              ? '<a href="' + esc(x.instagram) + '" target="_blank" rel="noopener noreferrer" '
                + 'style="font-size:.78rem">' + esc(perfil(x.instagram)) + '</a>'
              : '<span style="color:var(--texto3)">—</span>') + '</td>'
          + '<td>' + (x.revenda
              ? '<span class="selo s-ritmo">sim</span>'
                + (x.revenda_de ? ' <small style="color:var(--texto2)">' + esc(x.revenda_de) + '</small>' : '')
              : '<span style="color:var(--texto3)">—</span>') + '</td>'
          + '<td style="font-size:.79rem;color:var(--texto2)">' + esc(x.proximo || '—')
            + (x.proximo_em ? ' <span class="mono" style="color:var(--texto3)">(' + dia(x.proximo_em) + ')</span>' : '')
            + '</td></tr>';
      }).join('')
      : '<tr><td colspan="10"><p class="vazio">Nenhum lead com esses filtros.</p></td></tr>')
    + '</tbody></table></div>';

  var barrinhas = function (lista2, titulo, campo) {
    if (!lista2 || !lista2.length) return '';
    var max = lista2[0][1] || 1;
    return '<div class="cartao"><h3>' + titulo + '</h3><div style="margin-top:9px">'
      + lista2.map(function (pp) {
          var on = prFiltro[campo] === pp[0];
          return '<button type="button" data-fl="' + campo + '" data-fv="' + esc(pp[0])
            + '" style="display:flex;align-items:center;gap:9px;width:100%;background:'
            + (on ? 'var(--roxo-claro)' : 'none') + ';border:0;padding:4px 5px;border-radius:6px;cursor:pointer;margin-bottom:2px">'
            + '<span style="flex:0 0 108px;font-size:.79rem;text-align:left;font-weight:' + (on ? '700' : '500') + '">'
            + esc(pp[0]) + '</span>'
            + '<span style="flex:1;height:12px;background:var(--linha);border-radius:3px;overflow:hidden;display:block">'
            + '<span style="display:block;height:100%;width:' + (pp[1] / max * 100).toFixed(1)
            + '%;background:var(--s1)"></span></span>'
            + '<span class="mono" style="flex:0 0 34px;text-align:right;font-size:.76rem;font-weight:600">'
            + pp[1] + '</span></button>';
        }).join('')
      + '</div><p class="nota">Clique para filtrar. Clique de novo para tirar o filtro.</p></div>';
  };

  $('pr-corpo').innerHTML =
    '<div class="heroi" style="margin-top:0">'
      + '<div><div class="n">' + P.abertos + '</div><div class="sub">leads em aberto</div></div>'
      + '<div class="sub">' + P.total + ' na lista · ' + P.ganhos + ' ganhos · ' + P.perdidos + ' perdidos'
      + (P.conversao !== null && P.conversao !== undefined
          ? '<br>conversão de ' + P.conversao.toFixed(0) + '% sobre o que já foi decidido' : '')
      + (P.revendas ? '<br><b style="color:var(--atencao)">' + P.revendas
          + ' já revendem Piromax</b> comprando de um cliente seu' : '') + '</div>'
    + '</div>'
    + acompanhar
    + barra
    + (estado.prView === 'funil' ? '<div class="funil">' + colunas + '</div>' : lista)
    + '<div class="grade g2" style="margin-top:12px">'
      + barrinhas(P.por_segmento, 'Por tipo de negócio', 'seg')
      + barrinhas(P.por_regiao, 'Por região', 'reg')
    + '</div>'
    + (P.revendas ? '<div class="cartao" style="margin-top:12px"><h3>Quem já revende Piromax</h3>'
        + '<p class="nota" style="margin-top:4px;margin-bottom:9px">Leads que você marcou como abastecidos '
        + 'por um cliente seu. Não são prospecção fria: eles já vendem o produto, só não compram direto. '
        + 'Vale pensar duas vezes antes de puxar o cliente do seu próprio cliente.</p>'
        + (P.por_fornecedor || []).map(function (p) {
            return '<div class="par"><span class="n">' + esc(p[0]) + '</span>'
              + '<small style="font-weight:700">' + p[1] + ' lead(s)</small></div>';
          }).join('') + '</div>' : '')
    + '<div class="cartao" style="margin-top:12px"><h3>Carregar lista de leads</h3>'
      + '<p class="nota" style="margin-top:4px;margin-bottom:11px">Empresa, tipo de lead, atuação, estado, cidade, '
      + 'telefone e o que mais tiver na planilha. O importador acha as colunas pelo nome do cabeçalho, '
      + 'em qualquer ordem, e entende o estado por extenso. O tipo de lead da planilha vira a etapa do funil, '
      + 'então a qualificação que você já fez não se perde. Vínculos com clientes são conferidos por você na ficha do lead.</p>'
      + '<div class="solto" id="solto-leads"><b>Clique ou arraste a lista aqui</b>CSV com cabeçalho</div>'
      + '<div id="pv-leads"></div></div>';
}
/* Marcar revenda um a um em 248 leads seria castigo. A barra aparece assim que
   o primeiro é marcado na lista, igual à de Registros. */
function loteLeads(vis) {
  var ids = Object.keys(estado.prMarcados).filter(function (k) { return estado.prMarcados[k]; });
  if (!ids.length) return '';
  var nomes = (D && D.clientes ? D.clientes : []).map(function (c) {
    return '<option value="' + esc(c.nome) + '">'; }).join('');
  return '<div class="cartao" style="padding:12px 14px;margin-bottom:11px">'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'
    + '<b style="font-size:.85rem;color:var(--roxo-forte)">' + ids.length + ' marcado(s)</b>'
    + '<input id="lp-de" class="filtro" list="lp-clientes" placeholder="Revenda de qual cliente seu…" '
      + 'style="max-width:250px"><datalist id="lp-clientes">' + nomes + '</datalist>'
    + '<span class="acoes">'
      + '<button type="button" class="pri" id="lp-rev">Marcar como revenda</button>'
      + '<button type="button" id="lp-norev">Tirar a marca</button>'
      + '<select id="lp-etapa" class="filtro"><option value="">Mover para…</option>'
        + ETAPAS.map(function (e) { return '<option value="' + e[0] + '">' + e[1] + '</option>'; }).join('')
        + '</select>'
      + '<button type="button" id="lp-nada">Limpar seleção</button></span></div>'
    + '<p class="nota" style="margin-top:7px">O nome do fornecedor é opcional, mas é o que transforma '
      + 'a marca em informação: dá para ver quantos leads cada cliente seu já abastece.</p></div>';
}

function prFiltrando() {
  return !!(prFiltro.seg || prFiltro.reg || estado.prUf || estado.prCidade
            || estado.prEtapa || estado.prBusca || estado.prRevenda || estado.prAcao || estado.prDono);
}
function rotuloEtapa(e) {
  var x = ETAPAS.filter(function (y) { return y[0] === e; })[0];
  return x ? x[1] : e;
}
function cartaoLead(x) {
  return '<button class="lead" type="button" data-l="' + esc(x.id) + '">'
    + '<b>' + esc(x.nome)
    + (x.revenda ? ' <span class="selo s-ritmo">revenda</span>' : '') + '</b>'
    + '<small>' + esc([x.cidade, x.uf].filter(Boolean).join(' / ') || 'sem cidade')
    + (x.segmento ? ' · ' + esc(x.segmento) : '')
    + (x.proximo ? ' · ' + esc(x.proximo) : '') + '</small>'
    + (proximaTarefa(x.id) ? '<small class="prazo-lead">Retorno: '+dia(proximaTarefa(x.id).prazo)+'</small>' : (['ganho','perdido'].indexOf(x.etapa)<0 ? '<small class="prazo-lead">Sem próxima ação</small>' : ''))
    + '<small class="lead-dono">Responsável: '+esc(nomeUsuario(donoRegistro(x.id)))+'</small>'
    + (x.cliente_id ? '<small>Vinculado à carteira</small>' : x.etapa==='ganho'?'<small>Aguardando vínculo com cliente</small>':'')
    + (x.instagram ? '<small class="insta">' + esc(perfil(x.instagram)) + '</small>' : '')
    + '</button>';
}

/* A planilha traz a URL inteira com rastreador. Na tela o que importa e o
   arroba; a URL completa fica no link da ficha. */
function perfil(url) {
  var u = String(url || '');
  var m = u.match(/instagram\.com\/([^/?#]+)/i);
  if (m) return '@' + m[1];
  m = u.match(/facebook\.com\/(?:share\/)?([^/?#]+)/i);
  if (m) return 'facebook';
  return u.replace(/^https?:\/\//, '').slice(0, 40);
}

$('pr-corpo').addEventListener('click', function (e) {
  var cb = e.target.closest('input[data-pm]');
  if (cb) { estado.prMarcados[cb.dataset.pm] = cb.checked; pintarProspeccao(); e.stopPropagation(); return; }
  if (e.target.id === 'pr-todos') {
    prVisiveis().forEach(function (x) { estado.prMarcados[x.id] = e.target.checked; });
    pintarProspeccao();
    return;
  }
  if (e.target.id === 'lp-nada') { estado.prMarcados = {}; pintarProspeccao(); return; }
  if (e.target.id === 'lp-rev' || e.target.id === 'lp-norev') {
    var marcados = Object.keys(estado.prMarcados).filter(function (k) { return estado.prMarcados[k]; });
    var sim = e.target.id === 'lp-rev';
    gravar('/admin/carteira/lead/revenda-lote',
      { ids: marcados, revenda: sim, revenda_de: sim && $('lp-de') ? $('lp-de').value.trim() : '' },
      sim ? 'Marcados como revenda.' : 'Marca removida.')
      .then(function () { estado.prMarcados = {}; pintarProspeccao(); });
    return;
  }
  if (e.target.id === 'pr-novo') { abrirNovoLead(); return; }
  if (e.target.id === 'pr-modo') {
    estado.prView = estado.prView === 'funil' ? 'lista' : 'funil';
    pintarProspeccao();
    return;
  }
  if (e.target.id === 'pr-limpa') {
    prFiltro = { seg: '', reg: '' };
    estado.prUf = estado.prCidade = estado.prEtapa = estado.prBusca = estado.prRevenda = estado.prAcao = estado.prDono = '';
    pintarProspeccao();
    return;
  }
  if (e.target.closest('a')) return;           /* link do Instagram abre o link */
  var tr = e.target.closest('tr[data-l]');
  if (tr) { abrirFicha(tr.dataset.l, 'lead'); return; }
  var b = e.target.closest('button[data-l]');
  if (b) { abrirFicha(b.dataset.l, 'lead'); return; }
  var f = e.target.closest('button[data-fl]');
  if (f) {
    var campo = f.dataset.fl;
    prFiltro[campo] = prFiltro[campo] === f.dataset.fv ? '' : f.dataset.fv;
    pintarProspeccao();
    return;
  }
  if (e.target.closest('#solto-leads')) $('arq-leads').click();
});
$('pr-corpo').addEventListener('change', function (e) {
  if (e.target.id === 'pr-dono') { estado.prDono=e.target.value; pintarProspeccao(); }
  else if (e.target.id === 'pr-acao') { estado.prAcao=e.target.value; pintarProspeccao(); }
  else if (e.target.id === 'pr-uf') { estado.prUf = e.target.value; pintarProspeccao(); }
  else if (e.target.id === 'pr-cidade') { estado.prCidade = e.target.value; pintarProspeccao(); }
  else if (e.target.id === 'pr-etapa') { estado.prEtapa = e.target.value; pintarProspeccao(); }
  else if (e.target.id === 'pr-rev') { estado.prRevenda = e.target.value; pintarProspeccao(); }
  else if (e.target.id === 'lp-etapa' && e.target.value) {
    var marcados = Object.keys(estado.prMarcados).filter(function (k) { return estado.prMarcados[k]; });
    gravar('/admin/carteira/lead/etapa-lote', { ids: marcados, etapa: e.target.value }, 'Etapa alterada.')
      .then(function () { estado.prMarcados = {}; pintarProspeccao(); });
  }
});
$('pr-corpo').addEventListener('input', function (e) {
  if (e.target.id !== 'pr-busca') return;
  estado.prBusca = e.target.value;
  clearTimeout(pintarProspeccao.t);
  pintarProspeccao.t = setTimeout(function () {
    pintarProspeccao();
    var i = $('pr-busca');
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }, 220);
});
$('pr-corpo').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  var tr = e.target.closest('tr[data-l]');
  if (tr) abrirFicha(tr.dataset.l, 'lead');
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
      + '<p class="nota" style="margin-top:4px">Isso se faz em <b>Clientes</b>: marque vários clientes na lista e '
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
    $('sub-periodo').textContent = 'Vendas até ' + dia(D.meta.ref) + ' · Importação: ' + (D.meta.ultima_importacao ? dia(D.meta.ultima_importacao.slice(0,10)) : 'sem registro anterior');
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
