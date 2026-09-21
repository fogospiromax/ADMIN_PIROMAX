/* Carteira de Clientes — Fogos Piromax
   Variáveis injetadas pelo template: D, FICHA, INTER, TAREFAS, ALIASES,
   CANDIDATOS, REGIOES, HOJE. */
(function () {
'use strict';

var MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
var ANO_REF = D ? parseInt(D.meta.ref.slice(0, 4), 10) : new Date().getFullYear();
var ANOS = [ANO_REF - 2, ANO_REF - 1, ANO_REF];

function brl(n){return Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});}
function mi(n){return 'R$ '+(n/1e6).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' mi';}
function mil(n){
  var s = n < 0 ? '-' : '', a = Math.abs(n);
  if (a >= 1e6) return s + mi(a);
  if (a >= 1000) return s + 'R$ ' + Math.round(a/1000).toLocaleString('pt-BR') + ' mil';
  return s + 'R$ ' + Math.round(a).toLocaleString('pt-BR');
}
function pct(n){return (n>0?'+':'')+Number(n).toLocaleString('pt-BR',{maximumFractionDigits:0})+'%';}
function num(n){return Number(n).toLocaleString('pt-BR');}
function dbr(s){if(!s)return '';var p=String(s).slice(0,10).split('-');return p[2]+'/'+p[1]+'/'+p[0];}
function mesbr(s){var p=String(s).split('-');return MES[+p[1]-1]+'/'+p[0].slice(2);}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function norm(s){return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/[^a-zA-Z0-9]+/g,' ').trim().toLowerCase();}
var SVGNS='http://www.w3.org/2000/svg';
function el(n,a){var e=document.createElementNS(SVGNS,n);for(var k in a)e.setAttribute(k,a[k]);return e;}
function $(id){return document.getElementById(id);}

/* ── vocabulário da direção comercial ───────────────────────────────────── */
var DIR = {
  'crescendo':   {rot:'Crescendo',   selo:'sv-ok',   cor:'var(--bom)',
    diz:'Comprou mais de 10% acima da média dos anos anteriores na mesma janela.',
    faz:'Procurar para ampliar: é onde a chance de resposta é maior.'},
  'estavel':     {rot:'Estável',     selo:'sv-off',  cor:'#9ca3af',
    diz:'Está dentro de 10% para cima ou para baixo da própria média.',
    faz:'Manter o relacionamento. Não exige ação imediata.'},
  'em queda':    {rot:'Em queda',    selo:'sv-at',   cor:'var(--atencao)',
    diz:'Comprou entre 10% e 30% menos que a própria média.',
    faz:'Ligar e entender o que mudou antes que vire queda forte.'},
  'queda forte': {rot:'Queda forte', selo:'sv-ser',  cor:'var(--serio)',
    diz:'Comprou mais de 30% abaixo da própria média.',
    faz:'Prioridade. Descobrir a causa e registrar o motivo na ficha.'},
  'parou':       {rot:'Parou',       selo:'sv-crit', cor:'var(--critico)',
    diz:'Não comprou nada este ano, tendo comprado antes.',
    faz:'Ligar. Se estiver perdido de vez, marcar na ficha com o motivo.'},
  'novo':        {rot:'Novo',        selo:'sv-ok',   cor:'var(--s1)',
    diz:'Primeira compra este ano, ainda sem histórico para comparar.',
    faz:'Acompanhar de perto: o segundo pedido é o que define se fica.'},
  'encerrado':   {rot:'Encerrado',   selo:'sv-off',  cor:'#6b7280',
    diz:'Marcado como perdido por você, com o motivo registrado.',
    faz:'Fora da fila e da projeção. Nada a fazer.'}
};
var DIRORD = ['crescendo','estavel','em queda','queda forte','parou','novo','encerrado'];
var RITMO = {'em dia':['sv-ok','Em dia'],'atrasado':['sv-at','Atrasado'],
             'muito atrasado':['sv-crit','Muito atrasado']};
var SITSELO = {ativo:['sv-ok','Ativo'],pausado:['sv-at','Pausado'],perdido:['sv-off','Perdido']};

var REG_ROT={}, TODAS_UF=[];
REGIOES.forEach(function(r){REG_ROT[r[0]]=r[1];TODAS_UF=TODAS_UF.concat(r[2]);});
TODAS_UF.sort();
function rotuloAtuacao(t){return (t||[]).map(function(x){return REG_ROT[x]||x;}).join(', ');}

/* ── servidor ───────────────────────────────────────────────────────────── */
function erroDe(e){ return (e&&e.erro)||'Não foi possível gravar. Verifique a conexão e tente de novo.'; }
function enviar(url,corpo,metodo){
  return fetch(url,{method:metodo||'POST',headers:{'Content-Type':'application/json'},
    body:corpo?JSON.stringify(corpo):undefined})
    .then(function(r){
      if(r.status===401||r.redirected) throw {erro:'Sua sessão expirou. Recarregue a página e entre de novo.'};
      return r.json().catch(function(){throw {erro:'Resposta inesperada do servidor.'};});
    })
    .then(function(j){ if(!j.success) throw j; return j; });
}
function avisar(host,texto,tipo){
  var n=$(host); if(!n)return;
  n.innerHTML='<div class="faixa '+(tipo||'')+'" style="margin:12px 0 0">'+texto+'</div>';
}


/* ── prospecção ─────────────────────────────────────────────────────────── */
var ETAPA_SELO={novo:'sv-off',contato:'sv-at',ganho:'sv-ok',perdido:'sv-crit'};
var ETAPA_ROT={}, ETAPA_AJUDA={};
ETAPAS.forEach(function(e){ETAPA_ROT[e[0]]=e[1];ETAPA_AJUDA[e[0]]=e[2];});
var LEADS=(PROSPEC&&PROSPEC.leads)||[];
var LPORID={}; LEADS.forEach(function(L){LPORID[L.id]=L;});
var filtroEtapa='', selLead={};

function montarProspec(){
  var P=PROSPEC;
  var atrasados=LEADS.filter(function(L){
    return (L.etapa==='novo'||L.etapa==='contato') && L.proximo_em && L.proximo_em<HOJE;});
  cartoes('kpis-prospec',[
    ['Leads em aberto',P.abertos,'de '+P.total+' importados no total'],
    ['Ganhos',P.ganhos,P.conversao==null?'ainda sem lead fechado':
      P.conversao.toFixed(0)+'% dos que já foram decididos'],
    ['Perdidos',P.perdidos,LEADS.filter(function(L){return L.etapa==='perdido'&&!L.motivo;}).length+' sem motivo escrito'],
    ['Próximo passo vencido',atrasados.length,atrasados.length?'precisam de contato hoje':'nenhum atrasado']
  ]);

  $('funil').innerHTML=P.etapas.map(function(e){
    return '<button class="fase" data-et="'+esc(e.chave)+'" aria-pressed="'+(filtroEtapa===e.chave)+'">'+
      '<div class="r">'+esc(e.rotulo)+'</div><div class="n">'+e.n+'</div>'+
      '<div class="a">'+esc(e.ajuda)+'</div></button>';}).join('');
  $('funil').querySelectorAll('[data-et]').forEach(function(b){
    b.addEventListener('click',function(){
      filtroEtapa = (filtroEtapa===b.dataset.et) ? '' : b.dataset.et;
      montarProspec();});
  });

  var jaCli=LEADS.filter(function(L){return L.ja_cliente && L.etapa!=='ganho';});
  $('aviso-ja-cliente').innerHTML=jaCli.length
    ? '<div class="aviso-lead"><b>'+jaCli.length+' lead(s) já compram da Piromax</b> e ainda estão marcados como '+
      'prospecção: '+esc(jaCli.slice(0,6).map(function(L){return L.nome;}).join(', '))+
      (jaCli.length>6?' e mais '+(jaCli.length-6):'')+'. Ligar para quem já é cliente oferecendo "conhecer a marca" '+
      'queima a credibilidade do time. Mova para <b>Ganhou</b> ou tire da lista.</div>'
    : '';

  var fuf=$('f-lead-uf');
  var ufs=[]; LEADS.forEach(function(L){if(L.uf&&ufs.indexOf(L.uf)<0)ufs.push(L.uf);});
  ufs.sort();
  if(fuf.options.length-1!==ufs.length)
    fuf.innerHTML='<option value="">Todos os estados</option>'+
      ufs.map(function(u){return '<option>'+esc(u)+'</option>';}).join('');
  var sel=$('lead-etapa-lote');
  if(!sel.options.length)
    sel.innerHTML=ETAPAS.map(function(e){return '<option value="'+esc(e[0])+'">'+esc(e[1])+'</option>';}).join('');
  renderLeads();
}

function renderLeads(){
  var q=norm($('q-lead').value), uf=$('f-lead-uf').value, ord=$('f-lead-ord').value;
  var rows=LEADS.filter(function(L){
    if(filtroEtapa && L.etapa!==filtroEtapa) return false;
    if(uf && L.uf!==uf) return false;
    if(q && norm(L.nome).indexOf(q)<0 && norm(L.cidade).indexOf(q)<0 &&
       norm(L.contato).indexOf(q)<0) return false;
    return true;});
  rows.sort(function(a,b){
    if(ord==='nome') return a.nome.localeCompare(b.nome,'pt-BR');
    if(ord==='novo') return String(b.criado_em||'').localeCompare(String(a.criado_em||''));
    var pa=a.proximo_em||'9999', pb=b.proximo_em||'9999';
    return pa.localeCompare(pb)||a.nome.localeCompare(b.nome,'pt-BR');});
  $('cont-lead').textContent=rows.length+' de '+LEADS.length+' leads'+
    (filtroEtapa?' · filtrando '+ETAPA_ROT[filtroEtapa]:'');
  $('t-lead').innerHTML=rows.length
    ? '<thead><tr><th class="sel"><input type="checkbox" id="lead-todos" aria-label="Selecionar todos"></th>'+
      '<th>Lead</th><th>Etapa</th><th>Cidade</th><th>UF</th><th>Contato</th><th>Telefone</th>'+
      '<th>Próximo passo</th></tr></thead><tbody>'+
      rows.map(function(L){
        var atrasado=L.proximo_em&&L.proximo_em<HOJE&&(L.etapa==='novo'||L.etapa==='contato');
        return '<tr data-lid="'+esc(L.id)+'">'+
        '<td class="sel"><input type="checkbox" data-lsel="'+esc(L.id)+'"'+(selLead[L.id]?' checked':'')+'></td>'+
        '<td class="nome">'+esc(L.nome)+
          (L.ja_cliente?' <span class="selo sv-crit" style="margin-left:4px"><i></i>já é cliente</span>':'')+'</td>'+
        '<td><span class="selo '+ETAPA_SELO[L.etapa]+'"><i></i>'+esc(ETAPA_ROT[L.etapa]||L.etapa)+'</span></td>'+
        '<td>'+(L.cidade?esc(L.cidade):'<span style="color:var(--texto3)">—</span>')+'</td>'+
        '<td class="mono">'+(L.uf?esc(L.uf):'<span style="color:var(--texto3)">—</span>')+'</td>'+
        '<td>'+(L.contato?esc(L.contato):'<span style="color:var(--texto3)">—</span>')+'</td>'+
        '<td class="mono">'+(L.telefone?esc(L.telefone):'<span style="color:var(--texto3)">—</span>')+'</td>'+
        '<td style="font-size:.78rem">'+(L.proximo?esc(L.proximo):'<span style="color:var(--texto3)">a definir</span>')+
          (L.proximo_em?' <span class="mono'+(atrasado?' desce':'')+'" style="font-size:.72rem">'+dbr(L.proximo_em)+'</span>':'')+
        '</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">'+(LEADS.length
        ? 'Nenhum lead nesse filtro.'
        : 'Nenhum lead importado ainda. Use o painel de importação abaixo.')+'</td></tr></tbody>';
  $('t-lead').querySelectorAll('tr[data-lid]').forEach(function(tr){
    tr.addEventListener('click',function(e){
      if(e.target.matches('input[data-lsel]'))return;
      abrirLead(tr.dataset.lid);});});
  $('t-lead').querySelectorAll('[data-lsel]').forEach(function(n){
    n.addEventListener('change',function(ev){
      ev.stopPropagation();
      if(n.checked) selLead[n.dataset.lsel]=true; else delete selLead[n.dataset.lsel];
      barraLead();});});
  var todos=$('lead-todos');
  if(todos) todos.addEventListener('change',function(){
    rows.forEach(function(L){ if(todos.checked) selLead[L.id]=true; else delete selLead[L.id]; });
    renderLeads();});
  barraLead();
}
function barraLead(){
  var n=Object.keys(selLead).length;
  $('barra-lead').hidden=n===0;
  if(n) $('lead-info').textContent=n+(n===1?' lead selecionado':' leads selecionados');
}
$('lead-limpar').addEventListener('click',function(){selLead={};renderLeads();});
$('lead-mover').addEventListener('click',function(){
  var ids=Object.keys(selLead), etapa=$('lead-etapa-lote').value;
  if(!ids.length)return;
  if(etapa==='perdido' && !confirm('Marcar '+ids.length+' lead(s) como perdido sem escrever o motivo? '+
     'O motivo é o que permite aprender depois. Continuar mesmo assim?')) return;
  var b=this;b.disabled=true;b.textContent='Movendo…';
  enviar('/admin/carteira/lead/etapa-lote',{ids:ids,etapa:etapa})
    .then(function(){location.reload();})
    .catch(function(e){b.disabled=false;b.textContent='Mover';alert(erroDe(e));});
});
['q-lead','f-lead-uf','f-lead-ord'].forEach(function(id){$(id).addEventListener('input',renderLeads);});

function abrirLead(id){
  var L=LPORID[id]; if(!L)return;
  var logs=interDe(id);
  folha.innerHTML=
    '<div class="folha-topo"><div><h3>'+esc(L.nome)+'</h3>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'+
      '<span class="selo '+ETAPA_SELO[L.etapa]+'"><i></i>'+esc(ETAPA_ROT[L.etapa]||L.etapa)+'</span>'+
      (L.uf?'<span class="selo sv-off"><i></i>'+esc(L.uf)+'</span>':'')+
      (L.ja_cliente?'<span class="selo sv-crit"><i></i>já compra da Piromax</span>':'')+'</div>'+
      (L.origem_arq?'<p class="nota" style="margin:8px 0 0;font-size:.74rem">Veio do arquivo '+esc(L.origem_arq)+'</p>':'')+
    '</div><button class="bt sm" id="fechar">Fechar</button></div>'+

    (L.ja_cliente
      ? '<div class="aviso-lead" style="margin-top:14px">Este nome já existe na carteira, com '+
        mil(L.cliente_receita)+' de histórico e direção <b>'+esc(L.cliente_direcao)+'</b>. '+
        'Não é prospecção, é relacionamento. Mova para Ganhou e trate pela ficha do cliente.</div>' : '')+

    '<h4>Etapa</h4>'+
    '<div class="campo"><label for="l-etapa">Em que pé está<span class="salvo" id="salvo">salvo</span></label>'+
      '<select id="l-etapa">'+ETAPAS.map(function(e){
        return '<option value="'+esc(e[0])+'"'+(L.etapa===e[0]?' selected':'')+'>'+esc(e[1])+'</option>';}).join('')+
      '</select></div>'+
    '<p class="nota" style="margin-top:6px;font-size:.75rem" id="l-ajuda">'+esc(ETAPA_AJUDA[L.etapa]||'')+'</p>'+
    '<div class="campo" style="margin-top:10px"><label for="l-motivo">Motivo, quando perder</label>'+
      '<textarea id="l-motivo" rows="2" placeholder="Ex.: já tem fornecedor fechado em contrato anual">'+esc(L.motivo||'')+'</textarea></div>'+

    '<h4>Próximo passo</h4>'+
    '<div class="novo" style="margin-top:0"><input type="date" id="l-prazo" value="'+esc(L.proximo_em||'')+'" aria-label="Quando">'+
      '<input type="text" id="l-proximo" value="'+esc(L.proximo||'')+'" placeholder="O que fazer, e quando" aria-label="Próximo passo">'+
      '<span></span></div>'+

    '<h4>Contato</h4>'+
    '<div class="campos"><div class="campo"><label for="l-contato">Quem falar</label>'+
      '<input type="text" id="l-contato" value="'+esc(L.contato||'')+'"></div>'+
      '<div class="campo"><label for="l-uf">UF</label><input type="text" id="l-uf" maxlength="2" value="'+esc(L.uf||'')+'"></div></div>'+
    '<div class="campos" style="margin-top:10px"><div class="campo"><label for="l-tel">Telefone</label>'+
      '<input type="text" id="l-tel" value="'+esc(L.telefone||'')+'"></div>'+
      '<div class="campo"><label for="l-cidade">Cidade</label><input type="text" id="l-cidade" value="'+esc(L.cidade||'')+'"></div></div>'+
    '<div class="campo" style="margin-top:10px"><label for="l-email">E-mail</label>'+
      '<input type="text" id="l-email" value="'+esc(L.email||'')+'"></div>'+
    '<div class="campo" style="margin-top:10px"><label for="l-obs">Observações</label>'+
      '<textarea id="l-obs" rows="2">'+esc(L.obs||'')+'</textarea></div>'+
    '<div id="erro-lead"></div>'+

    '<h4>Contatos registrados</h4>'+
    (logs.length?logs.map(function(i){
      return '<div class="linha-log"><span class="d">'+dbr(i.data)+'</span>'+
        '<span><b>'+esc(i.tipo||'Contato')+'</b> · '+esc(i.resumo)+'</span>'+
        '<button class="bt sm" data-lindel="'+esc(i.id)+'">Excluir</button></div>';}).join('')
      :'<p class="vazio">Nenhum contato registrado.</p>')+
    '<div class="novo"><input type="date" id="li-data" value="'+HOJE+'" aria-label="Data">'+
      '<input type="text" id="li-resumo" placeholder="O que foi conversado" aria-label="Resumo">'+
      '<button class="bt p" id="li-add">Registrar</button></div>'+
    '<div style="margin-top:8px"><select id="li-tipo" aria-label="Tipo">'+
      ['Ligação','WhatsApp','E-mail','Visita','Outro'].map(function(t){return '<option>'+t+'</option>';}).join('')+
      '</select></div>'+

    '<h4>Remover da lista</h4>'+
    '<p class="nota" style="font-size:.75rem">Apaga o lead e os contatos registrados nele, sem volta. '+
    'Para um lead que não deu certo prefira marcar como <b>perdido</b> com o motivo: aí ele sai da fila mas o aprendizado fica.</p>'+
    '<button class="bt" id="l-excluir" style="color:var(--critico);border-color:#fecaca">Excluir este lead</button>';

  gaveta.hidden=false;
  ligarLead(L);
  folha.scrollTop=0;
}

function ligarLead(L){
  $('fechar').addEventListener('click',fecharFicha);
  var timer=null;
  function salvar(){
    clearTimeout(timer);
    timer=setTimeout(function(){
      var corpo={id:L.id,etapa:$('l-etapa').value,motivo:$('l-motivo').value.trim(),
        proximo:$('l-proximo').value.trim(),proximo_em:$('l-prazo').value||null,
        contato:$('l-contato').value.trim(),telefone:$('l-tel').value.trim(),
        email:$('l-email').value.trim(),cidade:$('l-cidade').value.trim(),
        uf:$('l-uf').value.trim().toUpperCase().slice(0,2),obs:$('l-obs').value.trim()};
      var mudouEtapa = corpo.etapa!==L.etapa;
      enviar('/admin/carteira/lead',corpo).then(function(){
        Object.keys(corpo).forEach(function(k){ if(k!=='id') L[k]=corpo[k]; });
        var s=$('salvo'); if(s){s.classList.add('on');setTimeout(function(){s.classList.remove('on');},1400);}
        if(mudouEtapa) setTimeout(function(){location.reload();},700);
      }).catch(function(e){avisar('erro-lead',esc(erroDe(e)),'erro');});
    },700);
  }
  ['l-etapa','l-motivo','l-proximo','l-prazo','l-contato','l-tel','l-email','l-cidade','l-uf','l-obs']
    .forEach(function(id){var n=$(id); if(n){n.addEventListener('input',salvar);n.addEventListener('change',salvar);}});
  $('l-etapa').addEventListener('change',function(){
    $('l-ajuda').textContent=ETAPA_AJUDA[this.value]||'';});

  $('li-add').addEventListener('click',function(){
    var resumo=$('li-resumo').value.trim();
    if(!resumo){$('li-resumo').focus();return;}
    var b=this;b.disabled=true;
    var data=$('li-data').value||HOJE, tipo=$('li-tipo').value;
    enviar('/admin/carteira/interacao',{cliente_id:L.id,data:data,tipo:tipo,resumo:resumo})
      .then(function(j){
        INTER.unshift({id:j.id,cliente:L.id,data:data,tipo:tipo,resumo:resumo});
        abrirLead(L.id);
      }).catch(function(e){b.disabled=false;avisar('erro-lead',esc(erroDe(e)),'erro');});
  });
  folha.querySelectorAll('[data-lindel]').forEach(function(n){
    n.addEventListener('click',function(){
      n.disabled=true;
      enviar('/admin/carteira/interacao/'+n.dataset.lindel,null,'DELETE').then(function(){
        INTER=INTER.filter(function(i){return i.id!==n.dataset.lindel;});
        abrirLead(L.id);
      }).catch(function(e){n.disabled=false;avisar('erro-lead',esc(erroDe(e)),'erro');});});
  });
  $('l-excluir').addEventListener('click',function(){
    if(!confirm('Excluir "'+L.nome+'" e tudo que foi registrado nele? Não tem volta.')) return;
    var b=this;b.disabled=true;b.textContent='Excluindo…';
    enviar('/admin/carteira/lead/'+L.id,null,'DELETE')
      .then(function(){location.reload();})
      .catch(function(e){b.disabled=false;b.textContent='Excluir este lead';
        avisar('erro-lead',esc(erroDe(e)),'erro');});
  });
}

function montarUploadLeads(){
  var conferido=null;
  var fa=$('arq-lead');
  if(!fa) return;
  fa.addEventListener('change',function(){
    $('bt-lead-upload').disabled=true;conferido=null;$('res-lead').innerHTML='';});
  $('bt-lead-previa').addEventListener('click',function(){
    var arq=fa.files[0];
    if(!arq){avisar('res-lead','Escolha um arquivo primeiro.','erro');return;}
    var b=this;b.disabled=true;b.textContent='Conferindo…';
    var fd=new FormData();fd.append('arquivo',arq);
    fetch('/admin/carteira/leads/previa',{method:'POST',body:fd})
      .then(function(r){return r.json().catch(function(){throw {erro:'Resposta inesperada do servidor.'};});})
      .then(function(j){
        if(!j.success)throw j;
        b.disabled=false;b.textContent='Conferir o que vai entrar';
        conferido=arq.name;
        $('bt-lead-upload').disabled=j.novos===0;
        var t='<b>'+num(j.no_arquivo)+' linhas no arquivo.</b> '+num(j.novos)+' são leads novos e '+
          num(j.repetidos)+' já estão na lista, então serão ignorados.';
        if(j.qtd_ja_clientes) t+='<br><b>Atenção:</b> '+j.qtd_ja_clientes+' deles já compram da Piromax: '+
          esc(j.ja_clientes.slice(0,5).join(', '))+(j.qtd_ja_clientes>5?'…':'')+
          '. Vão entrar marcados, para o time não ligar oferecendo a marca a quem já compra.';
        if(j.sem_uf) t+='<br>'+j.sem_uf+' sem estado preenchido.';
        if(j.sem_telefone) t+='<br>'+j.sem_telefone+' sem telefone, o que limita a fila de ligação.';
        if(j.ja_no_banco) t+='<br>Já na base: '+num(j.ja_no_banco)+' leads.';
        if(j.ignoradas) t+='<br>'+esc((j.detalhes||[]).join('; '));
        if(j.amostra&&j.amostra.length) t+='<br><br>Primeiros que vão entrar: '+
          esc(j.amostra.slice(0,5).map(function(x){return x.nome+(x.uf?' ('+x.uf+')':'');}).join(', '));
        avisar('res-lead',t,j.novos?'':'ok');
      })
      .catch(function(e){
        b.disabled=false;b.textContent='Conferir o que vai entrar';
        avisar('res-lead','<b>Não deu certo.</b> '+esc(erroDe(e))+
          ((e&&e.detalhes&&e.detalhes.length)?'<br>'+esc(e.detalhes.join('; ')):''),'erro');});
  });
  $('bt-lead-upload').addEventListener('click',function(){
    var arq=fa.files[0];
    if(!arq||arq.name!==conferido){avisar('res-lead','Confira o arquivo antes de gravar.','erro');return;}
    var b=this;b.disabled=true;b.textContent='Gravando…';
    var fd=new FormData();fd.append('arquivo',arq);
    fetch('/admin/carteira/leads/upload',{method:'POST',body:fd})
      .then(function(r){return r.json().catch(function(){throw {erro:'Resposta inesperada do servidor.'};});})
      .then(function(j){
        if(!j.success)throw j;
        avisar('res-lead','<b>'+num(j.novos)+' leads novos.</b> '+num(j.repetidos)+
          ' já existiam e foram ignorados. A lista tem agora '+num(j.total)+'. Recarregando…','ok');
        setTimeout(function(){location.reload();},1600);
      })
      .catch(function(e){b.disabled=false;b.textContent='Gravar';
        avisar('res-lead','<b>Não deu certo.</b> '+esc(erroDe(e)),'erro');});
  });
}

/* ── abas ───────────────────────────────────────────────────────────────── */
var PAINEIS=['geral','acao','direcao','carteira','regiao','prev','prospec','crm','clientes','dados'];
function irPara(p){
  PAINEIS.forEach(function(x){var n=$('p-'+x); if(n)n.hidden=(x!==p);});
  document.querySelectorAll('.aba').forEach(function(t){
    t.setAttribute('aria-selected',String(t.dataset.p===p));});
  scrollTo({top:0,behavior:'instant'});
}
function montarAbas(){
  document.querySelectorAll('.aba').forEach(function(t){
    t.addEventListener('click',function(){irPara(t.dataset.p);});});
}

/* ── sem dados ──────────────────────────────────────────────────────────── */
if (!D) {
  $('sem-dados').hidden = false;
  ['geral','acao','direcao','carteira','regiao','prev','prospec','crm','clientes'].forEach(function(p){
    var n=$('p-'+p); if(n) n.hidden=true; });
  $('p-dados').hidden = false;
  document.querySelectorAll('.aba').forEach(function(t){
    t.setAttribute('aria-selected', String(t.dataset.p==='dados')); });
  montarUpload(); montarUploadLeads(); montarProspec(); montarAbas();
  return;
}

var C = D.clientes, M = D.meta, PV = D.previsao, BT = D.backtest;
var PORID = {}, PORNOME = {};
C.forEach(function(c){ PORID[c.id]=c; PORNOME[norm(c.nome)]=c;
  (c.alias||[]).forEach(function(a){ PORNOME[norm(a)]=c; }); });

/* ── dica flutuante ─────────────────────────────────────────────────────── */
var dica = $('dica');
function linha(a,b){return '<div class="r"><span>'+a+'</span><span>'+b+'</span></div>';}
function moverDica(ev){
  var r=dica.getBoundingClientRect(), x=ev.clientX+14, y=ev.clientY+14;
  if(x+r.width>innerWidth-8)x=ev.clientX-r.width-14;
  if(y+r.height>innerHeight-8)y=ev.clientY-r.height-14;
  dica.style.left=Math.max(8,x)+'px'; dica.style.top=Math.max(8,y)+'px';
}
function comDica(node,html){
  node.addEventListener('pointerenter',function(e){dica.innerHTML=html;dica.style.opacity='1';moverDica(e);});
  node.addEventListener('pointermove',moverDica);
  node.addEventListener('pointerleave',function(){dica.style.opacity='0';});
}

/* ── gráficos ───────────────────────────────────────────────────────────── */
function topoArredondado(x,y,w,h,r){
  r=Math.min(r,w/2,h);
  return 'M'+x+','+(y+h)+'V'+(y+r)+'a'+r+','+r+' 0 0 1 '+r+',-'+r+
         'h'+(w-2*r)+'a'+r+','+r+' 0 0 1 '+r+','+r+'V'+(y+h)+'Z';
}
function barras(host,dados,opt){
  opt=opt||{};
  var W=920,H=opt.h||250,ml=54,mr=10,mt=26,mb=opt.mb||40,iw=W-ml-mr,ih=H-mt-mb;
  var lmax=opt.maxBW||Infinity, gw=Math.min(iw,lmax*dados.length), gx=ml+(iw-gw)/2;
  var max=Math.max.apply(null,dados.map(function(r){return r.v;}))*1.06||1;
  var s=el('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':opt.alt||''});
  for(var i=0;i<=4;i++){
    var y=mt+ih-ih*i/4;
    s.appendChild(el('line',{x1:ml,x2:ml+iw,y1:y,y2:y,'class':i?'gridline':'axisline'}));
    var t=el('text',{x:ml-8,y:y+3.5,'class':'tick','text-anchor':'end'});
    t.textContent=opt.fmtY?opt.fmtY(max*i/4):(max*i/4/1e6).toFixed(1); s.appendChild(t);
  }
  var bw=gw/dados.length, pad=Math.min(6,bw*0.18);
  dados.forEach(function(r,i){
    var h=Math.max(1.5,ih*r.v/max), x=gx+i*bw+pad/2, y=mt+ih-h, w=bw-pad;
    var p=el('path',{d:topoArredondado(x,y,w,h,4),fill:r.color||'var(--s1)'});
    if(r.fraca)p.setAttribute('opacity','.5');
    s.appendChild(p);
    var hit=el('rect',{x:gx+i*bw,y:mt,width:bw,height:ih,fill:'transparent'});
    comDica(hit,r.dica); s.appendChild(hit);
    if(r.lab){var t1=el('text',{x:x+w/2,y:H-mb+14,'class':'tick','text-anchor':'middle'});t1.textContent=r.lab;s.appendChild(t1);}
    if(r.lab2){var t2=el('text',{x:x+w/2,y:H-mb+27,'class':'mlab','text-anchor':'middle'});t2.textContent=r.lab2;s.appendChild(t2);}
  });
  if(opt.yLab){var yl=el('text',{x:ml-8,y:mt-11,'class':'tick','text-anchor':'end'});yl.textContent=opt.yLab;s.appendChild(yl);}
  host.innerHTML=''; host.appendChild(s);
  if(opt.legenda) host.insertAdjacentHTML('beforeend',opt.legenda);
}
function barrasH(host,pares,cor,aoClicar){
  if(!pares.length){host.innerHTML='<p class="vazio">Sem dados ainda.</p>';return;}
  var mx=Math.max.apply(null,pares.map(function(p){return p[2];}))||1;
  host.innerHTML=pares.map(function(p){
    return '<div class="bl"'+(aoClicar?' role="button" tabindex="0" data-k="'+esc(p[0])+'" style="cursor:pointer"':'')+'>'+
      '<div class="t">'+esc(p[1])+'</div>'+
      '<div class="trilho"><div class="ench" style="width:'+(p[2]/mx*100).toFixed(1)+'%;background:'+cor(p[0])+'"></div></div>'+
      '<div class="v">'+mil(p[2])+' · '+p[3]+'</div></div>';}).join('');
  if(aoClicar) host.querySelectorAll('[data-k]').forEach(function(n){
    n.addEventListener('click',function(){aoClicar(n.dataset.k);});
    n.addEventListener('keydown',function(e){
      if(e.key==='Enter'||e.key===' '){e.preventDefault();aoClicar(n.dataset.k);}});
  });
}
function cartoes(host,itens){
  var n=$(host); if(!n)return;
  n.innerHTML=itens.map(function(k){
    return '<div class="kpi"><div class="lab">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="fine">'+k[2]+'</div></div>';
  }).join('');
}
function ligarLinhas(id){
  var t=$(id); if(!t)return;
  t.querySelectorAll('tr[data-id]').forEach(function(tr){
    tr.addEventListener('click',function(){abrirFicha(tr.dataset.id);});});
}

/* ── visão geral ────────────────────────────────────────────────────────── */
$('sub-periodo').textContent = dbr(M.inicio)+' a '+dbr(M.ref)+' · '+num(M.clientes)+' clientes · '+num(M.eventos)+' pedidos';
var ytdAtual=M['ytd'+ANO_REF], ytdAnt=M['ytd'+(ANO_REF-1)], ytdAnt2=M['ytd'+(ANO_REF-2)];
var varA=ytdAnt>0?(ytdAtual/ytdAnt-1)*100:null, varB=ytdAnt2>0?(ytdAnt/ytdAnt2-1)*100:null;
function mediana(a){var s=a.slice().sort(function(x,y){return x-y;});var m=s.length>>1;
  return s.length%2?s[m]:(s[m-1]+s[m])/2;}
var todosPedidos=C.reduce(function(a,c){return a.concat(c.hist.map(function(h){return h[1];}));},[]);
cartoes('kpis',[
  ['Receita no período',mi(M.receita),num(M.eventos)+' pedidos de '+num(M.clientes)+' clientes'],
  ['Pedido médio',brl(M.receita/M.eventos),'mediana de '+brl(mediana(todosPedidos))],
  ['Jan a '+dbr(M.ref).slice(0,5)+' de '+ANO_REF,mil(ytdAtual),
   varA===null?'sem base':'<span class="'+(varA>0?'sobe':'desce')+'">'+pct(varA)+'</span> contra '+(ANO_REF-1)],
  ['Mesma janela em '+(ANO_REF-1),mil(ytdAnt),
   varB===null?'sem base':'<span class="'+(varB>0?'sobe':'desce')+'">'+pct(varB)+'</span> contra '+(ANO_REF-2)],
  ['Concentração',C.filter(function(c){return c.classe==='A';}).length+' clientes','somam 80% da receita']
]);
$('nota-ytd').textContent='Mesma janela do calendário nos três anos, de 1º de janeiro até '+dbr(M.ref)+
  ', para que a comparação não seja contaminada pelo pico de fim de ano.';

barras($('g-mensal'),D.mensal.map(function(m){
  var p=m.mes.split('-'),i=+p[1]-1,parcial=m.mes===M.ref.slice(0,7);
  return {v:m.receita,color:parcial?'var(--s2)':'var(--s1)',fraca:parcial,
    lab:(i===0||i===6)?MES[i]:'',lab2:i===0?p[0]:'',
    dica:'<b>'+MES[i]+'/'+p[0]+(parcial?' (parcial)':'')+'</b>'+linha('Receita',brl(m.receita))+
      linha('Pedidos',num(m.compras))+linha('Clientes',num(m.clientes))};
}),{h:260,mb:52,yLab:'R$ mi',alt:'Faturamento mensal',
  legenda:'<div class="legenda"><span><i style="background:var(--s1)"></i>mês fechado</span>'+
    '<span><i style="background:var(--s2);opacity:.5"></i>mês corrente, parcial</span></div>'});

barras($('g-ytd'),ANOS.map(function(a,i){
  return {v:M['ytd'+a]||0,lab:String(a),color:i===2?'var(--s2)':'var(--s1)',
    dica:'<b>1/jan a '+dbr(M.ref).slice(0,5)+' de '+a+'</b>'+linha('Receita',brl(M['ytd'+a]||0))};
}),{h:210,yLab:'R$ mi',maxBW:120,alt:'Acumulado do ano'});

barras($('g-sazon'),D.sazonal.map(function(m){
  var n=D.mensal.filter(function(x){return +x.mes.split('-')[1]===m.mes;}).length;
  var mx=Math.max.apply(null,D.sazonal.map(function(x){
    return D.mensal.filter(function(y){return +y.mes.split('-')[1]===x.mes;}).length;}));
  return {v:m.receita,lab:MES[m.mes-1],color:'var(--s1)',fraca:n<mx,
    dica:'<b>'+MES[m.mes-1]+'</b>'+linha('Receita somada',brl(m.receita))+
      linha('% do total',(m.receita/M.receita*100).toFixed(1)+'%')+linha('Anos com dado',n)};
}),{h:240,yLab:'R$ mi',alt:'Receita por mês do calendário',
  legenda:'<div class="legenda"><span><i style="background:var(--s1)"></i>todos os anos</span>'+
    '<span><i style="background:var(--s1);opacity:.5"></i>menos anos de histórico</span></div>'});

/* ── ação comercial ─────────────────────────────────────────────────────── */
function motivoDe(c){ return (FICHA[c.id]||{}).motivo || c.motivo || ''; }
var QUEDA = C.filter(function(c){
  return c.classe!=='C' && (c.direcao==='queda forte'||c.direcao==='parou'||c.direcao==='em queda'); });
var ALTA = C.filter(function(c){ return c.direcao==='crescendo' && c.ytd_base>0; });
var ATIVOS_AB = C.filter(function(c){ return c.classe!=='C' && c.direcao!=='encerrado'; });

$('nota-acao').innerHTML =
  'Clientes de classe A e B que compraram, de 1º de janeiro até '+dbr(M.ref)+', menos do que na <b>mesma janela</b> '+
  'dos anos anteriores. A comparação é contra a média de '+(ANO_REF-2)+' e '+(ANO_REF-1)+', o que elimina a sazonalidade: '+
  'um cliente de fim de ano não aparece aqui só porque estamos em setembro. São '+QUEDA.length+' dos '+ATIVOS_AB.length+
  ' clientes A e B ativos.';

function colunasAno(c){
  return ANOS.map(function(a){return '<td class="num mono">'+mil(c.ytd_anos[a]||0)+'</td>';}).join('');
}
function tabelaAcao(){
  var ord=$('f-acao').value;
  var rows=QUEDA.slice().sort(function(a,b){
    if(ord==='receita')return b.receita-a.receita;
    if(ord==='atraso')return b.recencia-a.recencia;
    return a.var_ytd_abs-b.var_ytd_abs;
  });
  $('cont-acao').textContent=rows.length+' clientes · '+
    mil(rows.reduce(function(s,c){return s+Math.min(0,c.var_ytd_abs);},0)*-1)+' a menos que nos anos anteriores';
  $('t-acao').innerHTML=
    '<thead><tr><th>Cliente</th><th>Direção</th>'+ANOS.map(function(a){return '<th class="num">'+a+'</th>';}).join('')+
    '<th class="num">vs média</th><th class="num">Diferença</th><th>Ritmo</th><th>Motivo</th></tr></thead><tbody>'+
    rows.map(function(c){
      var d=DIR[c.direcao], r=RITMO[c.ritmo], mt=motivoDe(c);
      return '<tr class="cli" data-id="'+esc(c.id)+'">'+
        '<td class="nome">'+esc(c.nome)+' <span class="cls cls'+c.classe+'">'+c.classe+'</span></td>'+
        '<td><span class="selo '+d.selo+'"><i></i>'+d.rot+'</span></td>'+colunasAno(c)+
        '<td class="num mono desce">'+(c.var_ytd_pct==null?'—':pct(c.var_ytd_pct))+'</td>'+
        '<td class="num mono desce">'+mil(c.var_ytd_abs)+'</td>'+
        '<td>'+(r?'<span class="selo '+r[0]+'"><i></i>'+r[1]+'</span>':
          '<span style="color:var(--texto3);font-size:.76rem">'+c.recencia+' d</span>')+'</td>'+
        '<td style="font-size:.78rem;color:var(--texto2);max-width:240px">'+
          (mt?esc(mt):'<span style="color:var(--texto3)">a registrar</span>')+'</td></tr>';
    }).join('')+'</tbody>';
  ligarLinhas('t-acao');
}
$('f-acao').addEventListener('change',tabelaAcao);

function tabelaAlta(){
  var rows=ALTA.slice().sort(function(a,b){return b.var_ytd_abs-a.var_ytd_abs;});
  $('cont-alta').textContent=rows.length+' clientes · '+
    mil(rows.reduce(function(s,c){return s+c.var_ytd_abs;},0))+' acima dos anos anteriores';
  $('t-alta').innerHTML=rows.length
    ? '<thead><tr><th>Cliente</th>'+ANOS.map(function(a){return '<th class="num">'+a+'</th>';}).join('')+
      '<th class="num">vs média</th><th class="num">Diferença</th><th class="num">Melhor ano</th>'+
      '<th class="num">Espaço até lá</th></tr></thead><tbody>'+
      rows.map(function(c){
        var melhor=Math.max(c.ytd_anos[ANOS[0]]||0,c.ytd_anos[ANOS[1]]||0);
        var espaco=melhor-(c.ytd_anos[ANO_REF]||0);
        return '<tr class="cli" data-id="'+esc(c.id)+'">'+
          '<td class="nome">'+esc(c.nome)+' <span class="cls cls'+c.classe+'">'+c.classe+'</span></td>'+colunasAno(c)+
          '<td class="num mono sobe">'+pct(c.var_ytd_pct)+'</td>'+
          '<td class="num mono sobe">+'+mil(c.var_ytd_abs)+'</td>'+
          '<td class="num mono">'+mil(melhor)+'</td>'+
          '<td class="num mono">'+(espaco>0?mil(espaco):'<span class="sobe">já superou</span>')+'</td></tr>';
      }).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">Nenhum cliente acima da média dos anos anteriores.</td></tr></tbody>';
  ligarLinhas('t-alta');
}

function tabelaEncerrados(){
  var rows=C.filter(function(c){return c.direcao==='encerrado';})
            .sort(function(a,b){return b.receita-a.receita;});
  $('t-encerrados').innerHTML=rows.length
    ? '<thead><tr><th>Cliente</th><th>Motivo</th><th class="num">Receita histórica</th>'+
      '<th class="num">Última compra</th></tr></thead><tbody>'+
      rows.map(function(c){return '<tr class="cli" data-id="'+esc(c.id)+'">'+
        '<td class="nome">'+esc(c.nome)+'</td>'+
        '<td style="font-size:.79rem;color:var(--texto2)">'+
          (motivoDe(c)?esc(motivoDe(c)):'<span style="color:var(--texto3)">sem motivo escrito</span>')+'</td>'+
        '<td class="num mono">'+mil(c.receita)+'</td>'+
        '<td class="num mono">'+dbr(c.ultima)+'</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">Nenhum cliente marcado como perdido. Abra a ficha de um cliente, mude a situação e escreva o motivo.</td></tr></tbody>';
  ligarLinhas('t-encerrados');
}

function cartoesAcao(){
  var perda=QUEDA.reduce(function(s,c){return s+Math.min(0,c.var_ytd_abs);},0)*-1;
  var ganho=ALTA.reduce(function(s,c){return s+c.var_ytd_abs;},0);
  cartoes('kpis-acao',[
    ['Para recuperar',QUEDA.length+' clientes',mil(perda)+' a menos que nos anos anteriores'],
    ['Para crescer',ALTA.length+' clientes',mil(ganho)+' a mais que nos anos anteriores'],
    ['Saldo do ano','<span class="'+(ganho-perda>0?'sobe':'desce')+'">'+mil(ganho-perda)+'</span>',
     'ganho menos perda, cliente a cliente'],
    ['Encerrados',C.filter(function(c){return c.direcao==='encerrado';}).length,'marcados por você, fora da fila']
  ]);
}

/* ── direção ────────────────────────────────────────────────────────────── */
function montarDirecao(){
  $('legenda-dir').innerHTML=DIRORD.map(function(k){
    var d=DIR[k];
    return '<div class="dir-item"><span class="selo '+d.selo+'"><i></i>'+d.rot+'</span>'+
      '<span><b>'+esc(d.diz)+'</b>'+esc(d.faz)+'</span></div>';}).join('');

  var ag={};
  C.forEach(function(c){ag[c.direcao]=ag[c.direcao]||[0,0];ag[c.direcao][0]++;ag[c.direcao][1]+=c.receita;});
  barrasH($('b-dir'),DIRORD.filter(function(k){return ag[k];}).map(function(k){
    return [k,DIR[k].rot,ag[k][1],ag[k][0]+(ag[k][0]===1?' cliente':' clientes')];}),
    function(k){return DIR[k].cor;},
    function(k){irPara('clientes');$('f-dir').value=k;renderClientes();});

  var ar={};
  C.forEach(function(c){var k=c.ritmo||'sem ritmo';
    ar[k]=ar[k]||[0,0];ar[k][0]++;ar[k][1]+=c.receita;});
  var ordR=['em dia','atrasado','muito atrasado','sem ritmo'];
  var corR={'em dia':'var(--bom)','atrasado':'var(--atencao)','muito atrasado':'var(--critico)','sem ritmo':'#d1d5db'};
  barrasH($('b-ritmo'),ordR.filter(function(k){return ar[k];}).map(function(k){
    return [k,k==='sem ritmo'?'Sem ritmo definido':k.charAt(0).toUpperCase()+k.slice(1),
            ar[k][1],ar[k][0]+' clientes'];}),function(k){return corR[k];});

  var ap={};
  C.forEach(function(c){ap[c.perfil]=ap[c.perfil]||[0,0];ap[c.perfil][0]++;ap[c.perfil][1]+=c.receita;});
  var ordP=['Ano todo','Puxado p/ fim de ano','Fim de ano','Junino'];
  var corP={'Ano todo':'var(--o7)','Puxado p/ fim de ano':'var(--o5)','Fim de ano':'var(--o3)','Junino':'var(--o1)'};
  barrasH($('b-perfil'),ordP.filter(function(p){return ap[p];}).map(function(p){
    return [p,p,ap[p][1],ap[p][0]+' clientes'];}),function(p){return corP[p]||'var(--o3)';});

  var W=920,H=340,ml=62,mr=16,mt=26,mb=44,iw=W-ml-mr,ih=H-mt-mb;
  var maxX=Math.max.apply(null,C.map(function(c){return c.compras;}))*1.05;
  var maxY=Math.max.apply(null,C.map(function(c){return c.ticket;}))*1.05;
  var s=el('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':'Frequência contra ticket'});
  for(var i=0;i<=4;i++){
    var y=mt+ih-ih*i/4;
    s.appendChild(el('line',{x1:ml,x2:ml+iw,y1:y,y2:y,'class':i?'gridline':'axisline'}));
    var t=el('text',{x:ml-8,y:y+3.5,'class':'tick','text-anchor':'end'});
    t.textContent=Math.round(maxY*i/4/1000)+'k';s.appendChild(t);
    var x=ml+iw*i/4,t2=el('text',{x:x,y:H-mb+16,'class':'tick','text-anchor':'middle'});
    t2.textContent=Math.round(maxX*i/4);s.appendChild(t2);
  }
  var yl=el('text',{x:ml-8,y:mt-11,'class':'tick','text-anchor':'end'});yl.textContent='ticket';s.appendChild(yl);
  var xl=el('text',{x:ml+iw,y:H-mb+31,'class':'mlab','text-anchor':'end'});xl.textContent='pedidos no período';s.appendChild(xl);
  C.forEach(function(c){
    var x=ml+iw*c.compras/maxX,y=mt+ih-ih*c.ticket/maxY;
    var r=Math.max(4,Math.min(15,Math.sqrt(c.receita/M.receita)*62));
    var cir=el('circle',{cx:x,cy:y,r:r,'fill-opacity':.72,stroke:'#fff','stroke-width':2,
      fill:DIR[c.direcao].cor,style:'cursor:pointer'});
    comDica(cir,'<b>'+esc(c.nome)+'</b>'+linha('Direção',DIR[c.direcao].rot)+linha('Pedidos',num(c.compras))+
      linha('Ticket médio',brl(c.ticket))+linha('Receita total',brl(c.receita)));
    cir.addEventListener('click',function(){abrirFicha(c.id);});
    s.appendChild(cir);
  });
  var host=$('g-disp');host.innerHTML='';host.appendChild(s);
  host.insertAdjacentHTML('beforeend','<div class="legenda">'+
    DIRORD.filter(function(k){return C.some(function(c){return c.direcao===k;});}).map(function(k){
      return '<span><i style="background:'+DIR[k].cor+'"></i>'+DIR[k].rot+'</span>';}).join('')+
    '<span>o tamanho do ponto é a receita total</span></div>');
}

/* ── concentração ───────────────────────────────────────────────────────── */
function montarCarteira(){
  var g={A:[0,0],B:[0,0],C:[0,0]};
  C.forEach(function(c){g[c.classe][0]++;g[c.classe][1]+=c.receita;});
  var top10=C.slice(0,10).reduce(function(a,c){return a+c.receita;},0);
  cartoes('kpis-abc',[
    ['Classe A',g.A[0]+' clientes',mi(g.A[1])+' · '+(g.A[1]/M.receita*100).toFixed(0)+'% da receita'],
    ['Classe B',g.B[0]+' clientes',mi(g.B[1])+' · '+(g.B[1]/M.receita*100).toFixed(0)+'% da receita'],
    ['Classe C',g.C[0]+' clientes',mil(g.C[1])+' · '+(g.C[1]/M.receita*100).toFixed(0)+'% da receita'],
    ['Maior cliente',esc(C[0].nome.split(' ').slice(0,2).join(' ')),
     mi(C[0].receita)+' · '+(C[0].receita/M.receita*100).toFixed(0)+'% sozinho'],
    ['Dez maiores',(top10/M.receita*100).toFixed(0)+'% da receita',mi(top10)]
  ]);

  var top=C.slice(0,Math.min(25,C.length));
  var W=920,H=380,ml=54,mr=44,mt=26,mb=150,iw=W-ml-mr,ih=H-mt-mb;
  var max=top[0].receita*1.05;
  var s=el('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':'Curva ABC'});
  for(var i=0;i<=4;i++){
    var y=mt+ih-ih*i/4;
    s.appendChild(el('line',{x1:ml,x2:ml+iw,y1:y,y2:y,'class':i?'gridline':'axisline'}));
    var t=el('text',{x:ml-8,y:y+3.5,'class':'tick','text-anchor':'end'});t.textContent=(max*i/4/1e6).toFixed(1);s.appendChild(t);
    var t2=el('text',{x:ml+iw+8,y:y+3.5,'class':'tick','text-anchor':'start'});t2.textContent=Math.round(100*i/4)+'%';s.appendChild(t2);
  }
  var bw=iw/top.length,pad=Math.min(5,bw*0.22),pts=[];
  top.forEach(function(c,i){
    var h=ih*c.receita/max,x=ml+i*bw+pad/2,y=mt+ih-h,w=bw-pad;
    s.appendChild(el('path',{d:topoArredondado(x,y,w,h,3),fill:c.classe==='A'?'var(--s1)':'var(--o1)'}));
    pts.push([x+w/2,mt+ih-ih*c.acum]);
    var nm=c.nome.length>19?c.nome.slice(0,18)+'…':c.nome;
    var t=el('text',{x:x+w/2,y:mt+ih+10,'class':'tick','text-anchor':'end',
      transform:'rotate(-58 '+(x+w/2)+' '+(mt+ih+10)+')'});
    t.textContent=nm;s.appendChild(t);
    var hit=el('rect',{x:ml+i*bw,y:mt,width:bw,height:ih,fill:'transparent'});
    comDica(hit,'<b>'+esc(c.nome)+'</b>'+linha('Receita',brl(c.receita))+
      linha('Acumulado',(c.acum*100).toFixed(1)+'%')+linha('Classe',c.classe)+linha('Pedidos',num(c.compras)));
    s.appendChild(hit);
  });
  s.appendChild(el('path',{d:'M'+pts.map(function(p){return p[0]+','+p[1];}).join('L'),
    fill:'none',stroke:'var(--roxo)','stroke-width':2,'stroke-linejoin':'round'}));
  pts.forEach(function(p){s.appendChild(el('circle',{cx:p[0],cy:p[1],r:3,fill:'var(--roxo)',stroke:'#fff','stroke-width':1.5}));});
  var y80=mt+ih-ih*0.8;
  s.appendChild(el('line',{x1:ml,x2:ml+iw,y1:y80,y2:y80,stroke:'var(--roxo)','stroke-width':1,'stroke-dasharray':'4 4',opacity:.55}));
  var l=el('text',{x:ml+iw-4,y:y80-6,'class':'dlab','text-anchor':'end'});l.textContent='80% da receita acumulada';s.appendChild(l);
  var host=$('g-pareto');host.innerHTML='';host.appendChild(s);
  host.insertAdjacentHTML('beforeend','<div class="legenda"><span><i style="background:var(--s1)"></i>classe A</span>'+
    (top.some(function(c){return c.classe!=='A';})?'<span><i style="background:var(--o1)"></i>classe B</span>':'')+
    '<span><i style="background:var(--roxo)"></i>receita acumulada, eixo à direita</span></div>');

  var co=D.coortes, anos=Object.keys(co.base).sort(), colunas=[];
  Object.keys(co.receita).forEach(function(k){Object.keys(co.receita[k]).forEach(function(a){
    if(colunas.indexOf(a)<0)colunas.push(a);});});
  colunas.sort();
  $('nota-coorte').innerHTML=
    'Cada linha é um grupo de clientes pelo ano em que compraram da Piromax <b>pela primeira vez</b>. '+
    'As colunas mostram quanto esse mesmo grupo faturou em cada ano seguinte e quantos deles ainda estavam comprando. '+
    'Responde uma pergunta só: a empresa cresce conquistando gente nova, ou depende dos mesmos de sempre? '+
    'Se o grupo de '+anos[0]+' encolhe a cada ano e os grupos novos são pequenos, o problema não é venda, é reposição de carteira.';
  var vals=[];Object.keys(co.receita).forEach(function(k){Object.keys(co.receita[k]).forEach(function(a){vals.push(co.receita[k][a]);});});
  var mx=Math.max.apply(null,vals)||1;
  var ramp=['#ede9fe','#ddd6fe','#c4b5fd','#a78bfa','#8b5cf6','#7c3aed','#5b21b6'];
  var h='<thead><tr><th>Chegaram em</th><th class="num">Quantos eram</th>'+
    colunas.map(function(a){return '<th class="num">Faturaram em '+a+'</th>';}).join('')+'</tr></thead><tbody>';
  anos.forEach(function(k){
    h+='<tr><td class="nome">'+k+'</td><td class="num mono">'+co.base[k]+'</td>';
    colunas.forEach(function(a){
      var v=(co.receita[k]||{})[a]||0,n=(co.clientes[k]||{})[a]||0;
      if(!v){h+='<td class="num" style="color:var(--texto3)">—</td>';return;}
      var idx=Math.min(6,Math.floor(Math.pow(v/mx,.45)*7));
      h+='<td class="num mono" style="background:'+ramp[idx]+';color:'+(idx>=4?'#fff':'var(--roxo-forte)')+'">'+
        mil(v)+'<br><span style="font-size:10px;opacity:.85">'+n+' de '+co.base[k]+' compraram</span></td>';
    });
    h+='</tr>';
  });
  $('t-coorte').innerHTML=h+'</tbody>';
}

/* ── região ─────────────────────────────────────────────────────────────── */
var selecionados={};
function montarRegiao(){
  var comSede=C.filter(function(c){return c.uf_base;});
  var comAt=C.filter(function(c){return (c.atuacao||[]).length;});
  var ufsSede={}; comSede.forEach(function(c){ufsSede[c.uf_base]=1;});
  var ufsAt={}; comAt.forEach(function(c){(c.atuacao_ufs||[]).forEach(function(u){ufsAt[u]=1;});});
  cartoes('kpis-regiao',[
    ['Sede preenchida',comSede.length+' de '+C.length,
     comSede.length?Object.keys(ufsSede).length+' estados':'nenhuma sede cadastrada'],
    ['Atuação preenchida',comAt.length+' de '+C.length,
     comAt.length?'cobrindo '+Object.keys(ufsAt).length+' estados':'nenhuma área definida'],
    ['Receita sem sede',mil(C.filter(function(c){return !c.uf_base;}).reduce(function(s,c){return s+c.receita;},0)),
     'não entra no mapa por sede'],
    ['Receita sem atuação',mil(C.filter(function(c){return !(c.atuacao||[]).length;}).reduce(function(s,c){return s+c.receita;},0)),
     'não entra no mapa por atuação']
  ]);

  var porSede={};
  C.forEach(function(c){ if(c.uf_base){porSede[c.uf_base]=porSede[c.uf_base]||[0,0];
    porSede[c.uf_base][0]+=c.receita;porSede[c.uf_base][1]++;} });
  barrasH($('b-sede'),Object.keys(porSede).map(function(uf){
    return [uf,uf,porSede[uf][0],porSede[uf][1]+(porSede[uf][1]===1?' cliente':' clientes')];})
    .sort(function(a,b){return b[2]-a[2];}),function(){return 'var(--s1)';});

  var porAt={};
  C.forEach(function(c){ (c.atuacao||[]).forEach(function(t){
    porAt[t]=porAt[t]||[0,0];porAt[t][0]+=c.receita;porAt[t][1]++;});});
  barrasH($('b-atuacao'),Object.keys(porAt).map(function(t){
    return [t,REG_ROT[t]||t,porAt[t][0],porAt[t][1]+(porAt[t][1]===1?' cliente':' clientes')];})
    .sort(function(a,b){return b[2]-a[2];}),function(){return 'var(--s2)';});

  var fuf=$('f-reg-uf'), fat=$('f-reg-at');
  var ufs=Object.keys(ufsSede).sort();
  if(fuf.options.length-1!==ufs.length)
    fuf.innerHTML='<option value="">Todas as sedes</option>'+ufs.map(function(u){return '<option>'+esc(u)+'</option>';}).join('');
  if(fat.options.length<=2)
    fat.innerHTML='<option value="">Toda atuação</option><option value="__vazio">Sem atuação definida</option>'+
      REGIOES.map(function(r){return '<option value="'+esc(r[0])+'">'+esc(r[1])+'</option>';}).join('');
  renderTabelaRegiao();
  montarChips();
}
function renderTabelaRegiao(){
  var q=norm($('q-reg').value), uf=$('f-reg-uf').value, at=$('f-reg-at').value;
  var rows=C.filter(function(c){
    if(q && norm(c.nome).indexOf(q)<0) return false;
    if(uf && c.uf_base!==uf) return false;
    if(at==='__vazio' && (c.atuacao||[]).length) return false;
    if(at && at!=='__vazio' && (c.atuacao||[]).indexOf(at)<0) return false;
    return true;
  }).sort(function(a,b){return b.receita-a.receita;});
  $('cont-reg').textContent=rows.length+' clientes · '+mil(rows.reduce(function(s,c){return s+c.receita;},0));
  $('t-reg').innerHTML=
    '<thead><tr><th class="sel"><input type="checkbox" id="sel-todos" aria-label="Selecionar todos"></th>'+
    '<th>Cliente</th><th>Cidade</th><th>Sede</th><th>Área de atuação</th><th class="num">Receita</th></tr></thead><tbody>'+
    rows.map(function(c){
      return '<tr>'+
        '<td class="sel"><input type="checkbox" data-sel="'+esc(c.id)+'"'+(selecionados[c.id]?' checked':'')+'></td>'+
        '<td class="nome">'+esc(c.nome)+'</td>'+
        '<td>'+(c.cidade?esc(c.cidade):'<span style="color:var(--texto3)">—</span>')+'</td>'+
        '<td class="mono">'+(c.uf_base?esc(c.uf_base):'<span style="color:var(--texto3)">—</span>')+'</td>'+
        '<td>'+(c.atuacao_rotulo?esc(c.atuacao_rotulo):'<span style="color:var(--texto3)">não definida</span>')+'</td>'+
        '<td class="num mono">'+mil(c.receita)+'</td></tr>';}).join('')+'</tbody>';
  $('t-reg').querySelectorAll('[data-sel]').forEach(function(n){
    n.addEventListener('change',function(){
      if(n.checked) selecionados[n.dataset.sel]=true; else delete selecionados[n.dataset.sel];
      atualizaBarra();});
  });
  var todos=$('sel-todos');
  if(todos) todos.addEventListener('change',function(){
    rows.forEach(function(c){ if(todos.checked) selecionados[c.id]=true; else delete selecionados[c.id]; });
    renderTabelaRegiao();});
  atualizaBarra();
}
function atualizaBarra(){
  var n=Object.keys(selecionados).length;
  $('barra-sel').hidden = n===0;
  if(n) $('sel-info').textContent = n+(n===1?' cliente selecionado':' clientes selecionados');
}
function montarChips(){
  if($('chips-regiao').children.length) return;
  $('chips-regiao').innerHTML=REGIOES.map(function(r){
    return '<label class="chip"><input type="checkbox" value="'+esc(r[0])+'"> '+esc(r[1])+'</label>';}).join('');
  $('chips-uf').innerHTML=TODAS_UF.map(function(u){
    return '<label class="chip uf"><input type="checkbox" value="'+esc(u)+'"> '+esc(u)+'</label>';}).join('');
  document.querySelectorAll('#chips-regiao .chip, #chips-uf .chip').forEach(function(l){
    l.querySelector('input').addEventListener('change',function(){l.classList.toggle('on',this.checked);});});
}
function atuacaoEscolhida(){
  var out=[];
  document.querySelectorAll('#chips-regiao input:checked, #chips-uf input:checked')
    .forEach(function(i){out.push(i.value);});
  return out;
}
function aplicarAtuacao(modo){
  var ids=Object.keys(selecionados), at=atuacaoEscolhida();
  if(!ids.length) return;
  if(modo==='substituir' && !at.length &&
     !confirm('Nenhuma região marcada. Isso apaga a área de atuação dos clientes selecionados. Continuar?')) return;
  var nomes={}; ids.forEach(function(i){ if(PORID[i]) nomes[i]=PORID[i].nome; });
  var b=modo==='substituir'?$('at-substituir'):$('at-acrescentar');
  var rot=b.textContent; b.disabled=true; b.textContent='Gravando…';
  enviar('/admin/carteira/atuacao-lote',{ids:ids,atuacao:at,modo:modo,nomes:nomes})
    .then(function(j){
      avisar('res-atuacao','<b>'+j.gravados+' cliente(s) atualizados</b> com '+
        (at.length?esc(rotuloAtuacao(at)):'nenhuma área')+'. Recarregando…','ok');
      setTimeout(function(){location.reload();},1200);
    })
    .catch(function(e){b.disabled=false;b.textContent=rot;avisar('res-atuacao',esc(erroDe(e)),'erro');});
}

/* ── projeção ───────────────────────────────────────────────────────────── */
function montarProjecao(){
  if(!PV||!PV.clientes) return;
  var E=PV.empresa, r=BT.resumo||{};
  $('aviso-prev').innerHTML=
    '<b>Como esse número é feito.</b> A projeção de cada mês é a <b>média</b> do que foi vendido naquele mesmo mês em '+
    (ANO_REF-2)+' e '+(ANO_REF-1)+'. Nada de ajuste ou suavização: com duas observações por mês, qualquer sofisticação '+
    'seria enfeite sobre ruído. Você vê os dois anos ao lado do número e julga sozinho. Testado em '+(r.n||0)+
    ' trimestres já encerrados, o total da empresa errou entre '+(r.pior_baixo!=null?pct(r.pior_baixo):'?')+' e '+
    (r.pior_alto!=null?pct(r.pior_alto):'?')+', com erro médio de '+(r.erro_medio_abs?r.erro_medio_abs.toFixed(0):'?')+'%.';

  var somaAno=function(a){return D.mensal.filter(function(m){return m.mes.indexOf(String(a))===0;})
    .reduce(function(s,m){return s+m.receita;},0);};
  var anoAnt=somaAno(ANO_REF-1), anoAtual=somaAno(ANO_REF)+E.total;
  cartoes('kpis-prev',[
    ['Falta do ano',mi(E.total),'de hoje até 31 de dezembro'],
    [ANO_REF+' fechado, projetado',mi(anoAtual),
     '<span class="'+(anoAtual>anoAnt?'sobe':'desce')+'">'+pct((anoAtual/anoAnt-1)*100)+'</span> contra '+
     mi(anoAnt)+' em '+(ANO_REF-1)],
    ['Clientes projetados',PV.clientes.length,PV.com_meta+' com histórico regular'],
    ['Erro médio do método',(r.erro_medio_abs?r.erro_medio_abs.toFixed(0):'?')+'%','medido em '+(r.n||0)+' trimestres passados']
  ]);

  $('nota-prev-emp').innerHTML='Para cada mês: quanto foi vendido em '+(ANO_REF-2)+', quanto em '+(ANO_REF-1)+
    ', e a média dos dois, que é a projeção. A conta fecha exatamente, porque as três colunas somam os mesmos clientes. '+
    'A coluna <b>fora da conta</b> é o que aqueles dois anos tinham de clientes que hoje estão encerrados, e por isso '+
    'não entram. No mês corrente a última coluna desconta o que já foi faturado.';
  $('t-prev-emp').innerHTML=
    '<thead><tr><th>Mês</th><th class="num">'+(ANO_REF-2)+'</th><th class="num">'+(ANO_REF-1)+'</th>'+
    '<th class="num">Média, projetado</th><th class="num">Fora da conta</th>'+
    '<th class="num">Já faturado</th><th class="num">Falta entrar</th></tr></thead><tbody>'+
    E.meses.map(function(m){
      return '<tr><td class="nome">'+mesbr(m.mes)+'</td>'+
        '<td class="num mono">'+(m.h1==null?'—':mil(m.h1))+'</td>'+
        '<td class="num mono">'+(m.h2==null?'—':mil(m.h2))+'</td>'+
        '<td class="num mono"><b>'+mil(m.prev)+'</b></td>'+
        '<td class="num mono" style="color:var(--texto3)" title="'+
          (m.n_fora?esc(m.n_fora+' cliente(s) encerrados ou que ainda nao existiam'):'nenhum')+'">'+
          (m.fora?mil(m.fora):'—')+'</td>'+
        '<td class="num mono">'+('ja' in m?mil(m.ja):'—')+'</td>'+
        '<td class="num mono">'+('falta' in m?mil(m.falta):mil(m.prev))+'</td></tr>';}).join('')+
    '<tr><td class="nome"><b>Total</b></td><td></td><td></td><td></td><td></td><td></td>'+
    '<td class="num mono"><b>'+mil(E.total)+'</b></td></tr></tbody>';

  var linhas=D.mensal.map(function(m){
    var p=m.mes.split('-'),i=+p[1]-1;
    return {v:m.receita,color:'var(--s1)',lab:(i===0||i===6)?MES[i]:'',lab2:i===0?p[0]:'',
      dica:'<b>'+MES[i]+'/'+p[0]+'</b>'+linha('Realizado',brl(m.receita))};});
  linhas.pop();
  E.meses.forEach(function(m){
    var i=+m.mes.split('-')[1]-1;
    linhas.push({v:m.prev,color:'var(--s2)',fraca:true,lab:MES[i],lab2:'',
      dica:'<b>'+mesbr(m.mes)+' (projeção)</b>'+
        ('ja' in m?linha('Já faturado',brl(m.ja))+linha('Falta',brl(m.falta)):'')+
        linha(String(ANO_REF-2),m.h1==null?'—':brl(m.h1))+
        linha(String(ANO_REF-1),m.h2==null?'—':brl(m.h2))+linha('Média',brl(m.prev))});});
  barras($('g-prev'),linhas,{h:270,mb:52,yLab:'R$ mi',alt:'Realizado e projeção',
    legenda:'<div class="legenda"><span><i style="background:var(--s1)"></i>realizado</span>'+
      '<span><i style="background:var(--s2);opacity:.5"></i>projeção, média de '+(ANO_REF-2)+' e '+(ANO_REF-1)+'</span></div>'});

  $('t-backtest').innerHTML=
    '<thead><tr><th>Trimestre testado</th><th class="num">Real</th><th class="num">Projetado</th>'+
    '<th class="num">Erro no total</th><th class="num">Erro mediano por cliente</th>'+
    '<th class="num">Dentro de ±30%</th></tr></thead><tbody>'+
    BT.blocos.map(function(b){return '<tr><td class="nome">'+esc(b.rot)+'</td>'+
      '<td class="num mono">'+mil(b.real)+'</td><td class="num mono">'+mil(b.prev)+'</td>'+
      '<td class="num mono '+(b.erro>0?'sobe':'desce')+'">'+pct(b.erro)+'</td>'+
      '<td class="num mono">'+(b.med_sel==null?'—':Math.round(b.med_sel)+'%')+'</td>'+
      '<td class="num mono">'+(b.d30==null?'—':Math.round(b.d30)+'%')+'</td></tr>';}).join('')+'</tbody>';
  $('leitura-bt').innerHTML=
    'As duas últimas colunas olham apenas os clientes de compra regular. Mesmo entre eles o erro mediano é alto, '+
    'e mês a mês por cliente a projeção errou '+Math.round(BT.mensal.med)+'% na mediana, acertando dentro de 30% em '+
    'apenas '+Math.round(BT.mensal.d30)+'% dos casos. Por isso o número por cliente serve para conversa e prioridade, '+
    'não para cobrança. Quanto mais irregular o cliente, mais a média dos dois anos é só uma referência.';

  var CONF={boa:['sv-ok','boa'],razoavel:['sv-at','razoável'],fraca:['sv-off','fraca']};
  function tabelaPrev(){
    var f=$('f-conf').value, q=norm($('q-prev').value);
    var rows=PV.clientes.filter(function(c){
      if(q && norm(c.nome).indexOf(q)<0) return false;
      if(f==='boa') return c.conf==='boa';
      if(f==='razoavel') return c.conf==='boa'||c.conf==='razoavel';
      return true;});
    $('cont-prev').textContent=rows.length+' clientes · '+mil(rows.reduce(function(s,c){return s+c.total;},0));
    var meses=PV.clientes.length?PV.clientes[0].meses:[];
    $('t-prev').innerHTML=
      '<thead><tr><th>Cliente</th><th>Confiança</th>'+
      meses.map(function(m){return '<th class="num">'+mesbr(m.mes)+'</th>';}).join('')+
      '<th class="num">Total que falta</th></tr></thead><tbody>'+
      rows.map(function(c){var k=CONF[c.conf]||CONF.fraca;
        return '<tr class="cli" data-id="'+esc(c.id)+'">'+
          '<td class="nome">'+esc(c.nome)+'</td>'+
          '<td><span class="selo '+k[0]+'"><i></i>'+k[1]+'</span></td>'+
          c.meses.map(function(m){
            var titulo=(ANO_REF-2)+': '+mil(m.h1||0)+'  |  '+(ANO_REF-1)+': '+mil(m.h2||0);
            var v=('falta' in m)?m.falta:m.prev;
            return '<td class="num mono" title="'+esc(titulo)+'">'+mil(v)+'</td>';}).join('')+
          '<td class="num mono"><b>'+mil(c.total)+'</b></td></tr>';}).join('')+'</tbody>';
    ligarLinhas('t-prev');
  }
  $('f-conf').addEventListener('change',tabelaPrev);
  $('q-prev').addEventListener('input',tabelaPrev);
  tabelaPrev();
  $('nota-prev-cli').innerHTML=
    'Para cada cliente e cada mês, a média do que ele fez naquele mês em '+(ANO_REF-2)+' e '+(ANO_REF-1)+
    '. Passe o cursor sobre um valor para ver os dois anos que o geraram. No mês corrente o valor já desconta o faturado. '+
    'A <b>confiança</b> é o quanto o cliente compra com regularidade: boa são os que compraram em 10 ou mais dos últimos '+
    '12 meses, razoável de 7 a 9, fraca abaixo disso. Em confiança fraca o número é literalmente a média de duas '+
    'observações, e vale como referência, nunca como meta.';
}

/* ── CRM ────────────────────────────────────────────────────────────────── */
function interDe(id){return INTER.filter(function(x){return x.cliente===id;})
  .sort(function(a,b){return String(b.data).localeCompare(String(a.data));});}
function tarefasDe(id){return TAREFAS.filter(function(x){return x.cliente===id;})
  .sort(function(a,b){return (a.feita?1:0)-(b.feita?1:0)||String(a.prazo||'9').localeCompare(String(b.prazo||'9'));});}
function descobertos(){
  var tocados={};
  INTER.forEach(function(i){tocados[i.cliente]=1;});
  TAREFAS.forEach(function(t){tocados[t.cliente]=1;});
  return QUEDA.concat(ALTA).filter(function(c){return !tocados[c.id];})
    .sort(function(a,b){return Math.abs(b.var_ytd_abs)-Math.abs(a.var_ytd_abs);});
}
function renderCRM(){
  var abertas=TAREFAS.filter(function(t){return !t.feita;});
  var atrasadas=abertas.filter(function(t){return t.prazo && t.prazo<HOJE;});
  var d30=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  var soCliente=function(i){return String(i.cliente).indexOf('lead-')!==0;};
  var recentes=INTER.filter(function(i){return i.data>=d30 && soCliente(i);});
  var vistos={};recentes.forEach(function(i){vistos[i.cliente]=1;});
  cartoes('kpis-crm',[
    ['Tarefas em aberto',abertas.length,
     atrasadas.length?'<span class="desce">'+atrasadas.length+' fora do prazo</span>':'nenhuma fora do prazo'],
    ['Contatos em 30 dias',recentes.length,Object.keys(vistos).length+' clientes tocados'],
    ['Alertas descobertos',descobertos().length,'de '+(QUEDA.length+ALTA.length)+' clientes na ação comercial'],
    ['Com motivo escrito',C.filter(function(c){return motivoDe(c);}).length,'de '+C.length+' clientes']
  ]);

  var fila=abertas.slice().sort(function(a,b){return String(a.prazo||'9').localeCompare(String(b.prazo||'9'));});
  $('t-fila').innerHTML=fila.length
    ? '<thead><tr><th>Prazo</th><th>Cliente</th><th>Tarefa</th><th class="num">Receita do cliente</th></tr></thead><tbody>'+
      fila.map(function(t){var c=PORID[t.cliente],atr=t.prazo&&t.prazo<HOJE;
        return '<tr class="cli" data-id="'+esc(t.cliente)+'">'+
          '<td class="mono'+(atr?' desce':'')+'">'+(t.prazo?dbr(t.prazo):'sem prazo')+'</td>'+
          '<td class="nome">'+esc(c?c.nome:'—')+'</td><td>'+esc(t.titulo)+'</td>'+
          '<td class="num mono">'+(c?mil(c.receita):'—')+'</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">Nenhuma tarefa em aberto. Abra a ficha de um cliente para criar a primeira.</td></tr></tbody>';
  ligarLinhas('t-fila');

  var desc=descobertos();
  $('t-descoberto').innerHTML=desc.length
    ? '<thead><tr><th>Cliente</th><th>Direção</th><th class="num">Diferença no ano</th><th>Ritmo</th></tr></thead><tbody>'+
      desc.map(function(c){var d=DIR[c.direcao],r=RITMO[c.ritmo];
        return '<tr class="cli" data-id="'+esc(c.id)+'">'+
          '<td class="nome">'+esc(c.nome)+' <span class="cls cls'+c.classe+'">'+c.classe+'</span></td>'+
          '<td><span class="selo '+d.selo+'"><i></i>'+d.rot+'</span></td>'+
          '<td class="num mono '+(c.var_ytd_abs>0?'sobe':'desce')+'">'+mil(c.var_ytd_abs)+'</td>'+
          '<td>'+(r?'<span class="selo '+r[0]+'"><i></i>'+r[1]+'</span>':'—')+'</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">Todos os clientes da ação comercial já têm registro no CRM.</td></tr></tbody>';
  ligarLinhas('t-descoberto');

  $('t-inter').innerHTML=INTER.filter(soCliente).length
    ? '<thead><tr><th>Data</th><th>Cliente</th><th>Tipo</th><th>Resumo</th></tr></thead><tbody>'+
      INTER.filter(soCliente).slice(0,25).map(function(i){var c=PORID[i.cliente];
        return '<tr class="cli" data-id="'+esc(i.cliente)+'"><td class="mono">'+dbr(i.data)+'</td>'+
          '<td class="nome">'+esc(c?c.nome:'—')+'</td><td>'+esc(i.tipo)+'</td><td>'+esc(i.resumo)+'</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">Nenhum contato registrado ainda.</td></tr></tbody>';
  ligarLinhas('t-inter');
}

/* ── tabela de clientes ─────────────────────────────────────────────────── */
var fdir=$('f-dir');
DIRORD.forEach(function(k){ if(C.some(function(c){return c.direcao===k;})){
  var o=document.createElement('option');o.value=k;o.textContent=DIR[k].rot;fdir.appendChild(o);}});
var ordCampo='receita', ordDir=-1;
var COLS=[['nome','Cliente',0],['direcao','Direção',0],['uf_base','Sede',0],['atuacao_rotulo','Atuação',0],
  ['receita','Receita total',1],['compras','Pedidos',1],['recencia','Sem comprar',1],
  ['var_ytd_pct','Ano vs média',1],['ultima','Última compra',0]];
function renderClientes(){
  var q=norm($('q').value), dir=fdir.value, cl=$('f-cls').value, sit=$('f-sit').value;
  var ufSel=$('f-uf');
  var ufs=[];C.forEach(function(c){if(c.uf_base&&ufs.indexOf(c.uf_base)<0)ufs.push(c.uf_base);});
  ufs.sort();
  if(ufSel.options.length-1!==ufs.length){
    var antes=ufSel.value;
    ufSel.innerHTML='<option value="">Todas as sedes</option>'+ufs.map(function(u){return '<option>'+esc(u)+'</option>';}).join('');
    ufSel.value=ufs.indexOf(antes)>=0?antes:'';
  }
  var uf=ufSel.value;
  var rows=C.filter(function(c){
    if(q && norm(c.nome).indexOf(q)<0 && !(c.alias||[]).some(function(a){return norm(a).indexOf(q)>=0;})) return false;
    if(dir && c.direcao!==dir) return false;
    if(cl && c.classe!==cl) return false;
    if(uf && c.uf_base!==uf) return false;
    if(sit && c.situacao!==sit) return false;
    return true;});
  rows.sort(function(a,b){
    var x=a[ordCampo],y=b[ordCampo];
    if(x==null)x=ordDir<0?-Infinity:Infinity;
    if(y==null)y=ordDir<0?-Infinity:Infinity;
    if(typeof x==='string')return ordDir*x.localeCompare(y,'pt-BR');
    return ordDir*(x-y);});
  $('cont-cli').textContent=rows.length+' de '+C.length+' clientes · '+
    mil(rows.reduce(function(s,c){return s+c.receita;},0));
  $('t-cli').innerHTML='<thead><tr>'+COLS.map(function(c){
      return '<th class="s'+(c[2]?' num':'')+'" data-k="'+c[0]+'">'+c[1]+
        (ordCampo===c[0]?(ordDir<0?' ↓':' ↑'):'')+'</th>';}).join('')+'</tr></thead><tbody>'+
    rows.map(function(c){var d=DIR[c.direcao];
      return '<tr class="cli" data-id="'+esc(c.id)+'">'+
      '<td class="nome">'+esc(c.nome)+' <span class="cls cls'+c.classe+'">'+c.classe+'</span></td>'+
      '<td><span class="selo '+d.selo+'"><i></i>'+d.rot+'</span></td>'+
      '<td class="mono">'+(c.uf_base?esc(c.uf_base):'<span style="color:var(--texto3)">—</span>')+'</td>'+
      '<td style="font-size:.78rem">'+(c.atuacao_rotulo?esc(c.atuacao_rotulo):'<span style="color:var(--texto3)">—</span>')+'</td>'+
      '<td class="num mono">'+mil(c.receita)+'</td>'+
      '<td class="num mono">'+num(c.compras)+'</td>'+
      '<td class="num mono">'+c.recencia+' d</td>'+
      '<td class="num mono '+(c.var_ytd_pct==null?'':(c.var_ytd_pct>0?'sobe':'desce'))+'">'+
        (c.var_ytd_pct==null?'—':pct(c.var_ytd_pct))+'</td>'+
      '<td class="mono">'+dbr(c.ultima)+'</td></tr>';}).join('')+'</tbody>';
  $('t-cli').querySelectorAll('th.s').forEach(function(th){
    th.addEventListener('click',function(){
      var k=th.dataset.k;
      if(ordCampo===k) ordDir*=-1;
      else { ordCampo=k; ordDir=['nome','direcao','ultima','uf_base','atuacao_rotulo'].indexOf(k)>=0?1:-1; }
      renderClientes();});
  });
  ligarLinhas('t-cli');
}

/* ── ficha ──────────────────────────────────────────────────────────────── */
var gaveta=$('gaveta'), folha=$('folha');
function fato(l,v){return '<div class="fato"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>';}
function tr(a,b){return '<tr><td style="color:var(--texto2)">'+a+'</td><td class="num mono">'+b+'</td></tr>';}
function abrirFicha(id){
  var c=PORID[id]; if(!c)return;
  var f=FICHA[id]||{}, logs=interDe(id), tks=tarefasDe(id);
  var mx=Math.max.apply(null,c.mensal)||1;
  var ind=c.mensal.map(function(v,i){
    var h=Math.max(2,v/mx*46);
    return '<div><div title="'+MES[i]+': '+brl(v)+'" style="width:76%;height:'+h+'px;background:'+
      (v?'var(--s1)':'#e9e5ff')+';border-radius:3px 3px 0 0"></div><span>'+MES[i][0].toUpperCase()+'</span></div>';}).join('');
  var d=DIR[c.direcao], r=RITMO[c.ritmo], ss=SITSELO[c.situacao]||SITSELO.ativo, at=c.atuacao||[];

  folha.innerHTML=
    '<div class="folha-topo"><div><h3>'+esc(c.nome)+'</h3>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'+
      '<span class="cls cls'+c.classe+'">Classe '+c.classe+'</span>'+
      '<span class="selo '+d.selo+'"><i></i>'+d.rot+'</span>'+
      (r?'<span class="selo '+r[0]+'"><i></i>'+r[1]+'</span>':'')+
      '<span class="selo sv-off"><i></i>'+esc(c.perfil)+'</span>'+
      '<span class="selo '+ss[0]+'"><i></i>'+ss[1]+'</span></div>'+
      (c.alias&&c.alias.length?'<p class="nota" style="margin:8px 0 0;font-size:.74rem">Unificado a partir de: '+
        esc(c.alias.join(', '))+'</p>':'')+
    '</div><button class="bt sm" id="fechar">Fechar</button></div>'+

    '<h4>Situação e motivo</h4>'+
    '<div class="campo"><label for="f-situacao">Situação<span class="salvo" id="salvo">salvo</span></label>'+
      '<select id="f-situacao">'+['ativo','pausado','perdido'].map(function(s){
        return '<option value="'+s+'"'+(c.situacao===s?' selected':'')+'>'+SITSELO[s][1]+'</option>';}).join('')+
      '</select></div>'+
    '<div class="campo" style="margin-top:10px"><label for="f-motivo">Motivo, com suas palavras</label>'+
      '<textarea id="f-motivo" rows="3" placeholder="Ex.: o dono faleceu em fevereiro e a família encerrou a loja">'+
      esc(f.motivo||'')+'</textarea></div>'+
    '<p class="nota" style="margin-top:8px;font-size:.75rem">Marcar como <b>perdido</b> tira o cliente da fila e da projeção, mas mantém todo o histórico.</p>'+

    '<h4>Onde está e onde vende</h4>'+
    '<div class="campos">'+
      '<div class="campo"><label for="f-cidade">Cidade</label><input type="text" id="f-cidade" value="'+esc(f.cidade||'')+'"></div>'+
      '<div class="campo"><label for="f-estado">Sede, UF</label><input type="text" id="f-estado" maxlength="2" value="'+esc(f.estado||'')+'"></div>'+
    '</div>'+
    '<div style="margin-top:12px"><div class="gt" style="font:700 .63rem/1.4 sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--texto3);margin-bottom:6px">Área de atuação, onde ele revende</div>'+
      '<div class="chips" id="fc-reg">'+REGIOES.map(function(rg){
        return '<label class="chip'+(at.indexOf(rg[0])>=0?' on':'')+'"><input type="checkbox" value="'+esc(rg[0])+'"'+
          (at.indexOf(rg[0])>=0?' checked':'')+'> '+esc(rg[1])+'</label>';}).join('')+'</div>'+
      '<div class="grupo-uf"><div class="gt">Ou estados específicos</div><div class="chips" id="fc-uf">'+
        TODAS_UF.map(function(u){
          return '<label class="chip uf'+(at.indexOf(u)>=0?' on':'')+'"><input type="checkbox" value="'+esc(u)+'"'+
            (at.indexOf(u)>=0?' checked':'')+'> '+esc(u)+'</label>';}).join('')+'</div></div></div>'+
    '<div class="campo" style="margin-top:12px"><label for="f-obs">Observações</label>'+
      '<textarea id="f-obs" rows="2">'+esc(f.obs||'')+'</textarea></div>'+
    '<div id="erro-ficha"></div>'+

    '<h4>Tarefas</h4>'+
    (tks.length?tks.map(function(t){
      var atr=!t.feita&&t.prazo&&t.prazo<HOJE;
      return '<div class="tsk'+(t.feita?' feita':'')+'">'+
        '<input type="checkbox" data-tk="'+esc(t.id)+'"'+(t.feita?' checked':'')+' aria-label="Concluir tarefa">'+
        '<span class="tt">'+esc(t.titulo)+'</span>'+
        '<span class="pz'+(atr?' atrasada':'')+'">'+(t.prazo?dbr(t.prazo):'sem prazo')+'</span>'+
        '<button class="bt sm" data-tkdel="'+esc(t.id)+'">Excluir</button></div>';}).join('')
      :'<p class="vazio">Nenhuma tarefa para este cliente.</p>')+
    '<div class="novo"><input type="date" id="tk-prazo" aria-label="Prazo">'+
      '<input type="text" id="tk-titulo" placeholder="O que precisa ser feito" aria-label="Descrição">'+
      '<button class="bt p" id="tk-add">Criar</button></div>'+

    '<h4>Contatos registrados</h4>'+
    (logs.length?logs.map(function(i){
      return '<div class="linha-log"><span class="d">'+dbr(i.data)+'</span>'+
        '<span><b>'+esc(i.tipo||'Contato')+'</b> · '+esc(i.resumo)+'</span>'+
        '<button class="bt sm" data-indel="'+esc(i.id)+'">Excluir</button></div>';}).join('')
      :'<p class="vazio">Nenhum contato registrado.</p>')+
    '<div class="novo"><input type="date" id="in-data" value="'+HOJE+'" aria-label="Data">'+
      '<input type="text" id="in-resumo" placeholder="O que foi conversado" aria-label="Resumo">'+
      '<button class="bt p" id="in-add">Registrar</button></div>'+
    '<div style="margin-top:8px"><select id="in-tipo" aria-label="Tipo de contato">'+
      ['Ligação','WhatsApp','E-mail','Visita','Pedido','Outro'].map(function(t){
        return '<option>'+t+'</option>';}).join('')+'</select></div>'+

    '<h4>Compras no mesmo período, ano a ano</h4>'+
    '<div class="tabwrap"><table style="min-width:0"><tbody>'+
      ANOS.map(function(a){return tr('1/jan a '+dbr(M.ref).slice(0,5)+' de '+a,mil(c.ytd_anos[a]||0));}).join('')+
      tr('<b>Média dos anos anteriores</b>','<b>'+mil(c.ytd_base)+'</b>')+
      tr('Diferença de '+ANO_REF+' contra a média',
        '<span class="'+(c.var_ytd_abs>0?'sobe':'desce')+'">'+mil(c.var_ytd_abs)+
        (c.var_ytd_pct==null?'':' · '+pct(c.var_ytd_pct))+'</span>')+
    '</tbody></table></div>'+

    '<h4>Números gerais</h4>'+
    '<div class="fatos">'+
      fato('Receita total',mil(c.receita))+fato('Pedidos',num(c.compras))+
      fato('Ticket médio',mil(c.ticket))+fato('Maior pedido',mil(c.tmax))+
      fato('Sem comprar',c.recencia+' dias')+
      fato('Intervalo típico',c.intervalo?Math.round(c.intervalo)+' dias':'—')+
      fato('Primeira compra',dbr(c.primeira))+fato('Última compra',dbr(c.ultima))+
    '</div>'+

    '<h4>Sazonalidade do cliente</h4><div class="sub-ind">'+ind+'</div>'+

    '<h4>Últimos pedidos</h4>'+
    '<div class="tabwrap"><table style="min-width:0"><tbody>'+
      c.hist.slice(-14).reverse().map(function(h){return tr(dbr(h[0]),brl(h[1]));}).join('')+
    '</tbody></table></div>'+
    (c.hist.length>14?'<p class="nota" style="margin-top:8px">Mostrando os 14 pedidos mais recentes de '+c.hist.length+'.</p>':'');

  var scroll=gaveta.hidden?0:folha.scrollTop;
  gaveta.hidden=false;
  ligarFicha(c);
  folha.scrollTop=scroll;
}
function ligarFicha(c){
  $('fechar').addEventListener('click',fecharFicha);
  var timer=null;
  function atuacaoDaFicha(){
    var out=[];
    folha.querySelectorAll('#fc-reg input:checked, #fc-uf input:checked').forEach(function(i){out.push(i.value);});
    return out;
  }
  function salvar(){
    clearTimeout(timer);
    timer=setTimeout(function(){
      var corpo={cliente_id:c.id,cliente_nome:c.nome,
        situacao:$('f-situacao').value, motivo:$('f-motivo').value.trim(),
        cidade:$('f-cidade').value.trim(), estado:$('f-estado').value.trim().toUpperCase().slice(0,2),
        atuacao:atuacaoDaFicha(), obs:$('f-obs').value.trim()};
      var at=FICHA[c.id]||{};
      var mesmaAt=JSON.stringify((at.atuacao||[]).slice().sort())===JSON.stringify(corpo.atuacao.slice().sort());
      var igual=mesmaAt && ['situacao','motivo','cidade','estado','obs'].every(function(k){
        return corpo[k]===(at[k]||(k==='situacao'?'ativo':''));});
      if(igual)return;
      enviar('/admin/carteira/ficha',corpo).then(function(){
        FICHA[c.id]=corpo;
        var s=$('salvo'); if(s){s.classList.add('on');setTimeout(function(){s.classList.remove('on');},1400);}
        var estrutural = corpo.situacao!==(at.situacao||'ativo') || !mesmaAt || corpo.estado!==(at.estado||'');
        if(estrutural) setTimeout(function(){location.reload();},800);
      }).catch(function(e){ avisar('erro-ficha',esc(erroDe(e)),'erro'); });
    },700);
  }
  ['f-situacao','f-motivo','f-cidade','f-estado','f-obs'].forEach(function(id){
    var n=$(id); if(n){n.addEventListener('input',salvar);n.addEventListener('change',salvar);}});
  folha.querySelectorAll('#fc-reg .chip, #fc-uf .chip').forEach(function(l){
    l.querySelector('input').addEventListener('change',function(){
      l.classList.toggle('on',this.checked); salvar();});});

  $('tk-add').addEventListener('click',function(){
    var titulo=$('tk-titulo').value.trim();
    if(!titulo){$('tk-titulo').focus();return;}
    var b=this;b.disabled=true;
    enviar('/admin/carteira/tarefa',{cliente_id:c.id,titulo:titulo,prazo:$('tk-prazo').value||null})
      .then(function(j){
        TAREFAS.push({id:j.id,cliente:c.id,titulo:titulo,prazo:$('tk-prazo').value||'',feita:false});
        renderCRM();abrirFicha(c.id);
      }).catch(function(e){b.disabled=false;avisar('erro-ficha',esc(erroDe(e)),'erro');});
  });
  $('in-add').addEventListener('click',function(){
    var resumo=$('in-resumo').value.trim();
    if(!resumo){$('in-resumo').focus();return;}
    var b=this;b.disabled=true;
    var data=$('in-data').value||HOJE, tipo=$('in-tipo').value;
    enviar('/admin/carteira/interacao',{cliente_id:c.id,data:data,tipo:tipo,resumo:resumo})
      .then(function(j){
        INTER.unshift({id:j.id,cliente:c.id,data:data,tipo:tipo,resumo:resumo});
        renderCRM();abrirFicha(c.id);
      }).catch(function(e){b.disabled=false;avisar('erro-ficha',esc(erroDe(e)),'erro');});
  });
  folha.querySelectorAll('[data-tk]').forEach(function(n){
    n.addEventListener('change',function(){
      enviar('/admin/carteira/tarefa/'+n.dataset.tk,{feita:n.checked})
        .then(function(){
          TAREFAS.forEach(function(t){if(t.id===n.dataset.tk)t.feita=n.checked;});
          renderCRM();abrirFicha(c.id);
        }).catch(function(e){n.checked=!n.checked;avisar('erro-ficha',esc(erroDe(e)),'erro');});});
  });
  folha.querySelectorAll('[data-tkdel]').forEach(function(n){
    n.addEventListener('click',function(){
      n.disabled=true;
      enviar('/admin/carteira/tarefa/'+n.dataset.tkdel,null,'DELETE').then(function(){
        TAREFAS=TAREFAS.filter(function(t){return t.id!==n.dataset.tkdel;});
        renderCRM();abrirFicha(c.id);
      }).catch(function(e){n.disabled=false;avisar('erro-ficha',esc(erroDe(e)),'erro');});});
  });
  folha.querySelectorAll('[data-indel]').forEach(function(n){
    n.addEventListener('click',function(){
      n.disabled=true;
      enviar('/admin/carteira/interacao/'+n.dataset.indel,null,'DELETE').then(function(){
        INTER=INTER.filter(function(i){return i.id!==n.dataset.indel;});
        renderCRM();abrirFicha(c.id);
      }).catch(function(e){n.disabled=false;avisar('erro-ficha',esc(erroDe(e)),'erro');});});
  });
}
function fecharFicha(){gaveta.hidden=true;dica.style.opacity='0';}
gaveta.addEventListener('click',function(e){if(e.target===gaveta)fecharFicha();});
addEventListener('keydown',function(e){if(e.key==='Escape'&&!gaveta.hidden)fecharFicha();});

/* ── aba Dados: upload incremental ──────────────────────────────────────── */
function montarUpload(){
  var conferido=null;
  var fa=$('arquivo');
  if(fa) fa.addEventListener('change',function(){
    $('bt-upload').disabled=true; conferido=null; $('res-upload').innerHTML='';});
  var bp=$('bt-previa');
  if(bp) bp.addEventListener('click',function(){
    var arq=$('arquivo').files[0];
    if(!arq){avisar('res-upload','Escolha um arquivo primeiro.','erro');return;}
    var b=this;b.disabled=true;b.textContent='Conferindo…';
    var fd=new FormData();fd.append('arquivo',arq);
    fetch('/admin/carteira/previa',{method:'POST',body:fd})
      .then(function(r){return r.json().catch(function(){throw {erro:'Resposta inesperada do servidor.'};});})
      .then(function(j){
        if(!j.success)throw j;
        b.disabled=false;b.textContent='Conferir o que vai entrar';
        conferido=arq.name;
        $('bt-upload').disabled = j.novas===0;
        var txt='<b>'+num(j.no_arquivo)+' linhas no arquivo.</b> '+num(j.novas)+
          ' são novas e '+num(j.repetidas)+' já estão no banco, então serão ignoradas.';
        if(j.novas){
          txt+='<br>Vai entrar de '+dbr(j.periodo_novas[0])+' a '+dbr(j.periodo_novas[1])+
               ', somando '+mil(j.valor_novas)+'.';
          if(j.qtd_clientes_novos) txt+='<br>Clientes envolvidos: '+j.qtd_clientes_novos+'.';
        } else { txt+='<br>Nada de novo para gravar.'; }
        if(j.ja_no_banco) txt+='<br>Já no banco: '+num(j.ja_no_banco)+' notas, de '+
          dbr(j.periodo_banco[0])+' a '+dbr(j.periodo_banco[1])+'.';
        if(j.ignoradas) txt+='<br>'+j.ignoradas+' linhas com problema foram ignoradas: '+esc((j.detalhes||[]).join('; '));
        avisar('res-upload',txt, j.novas?'':'ok');
      })
      .catch(function(e){
        b.disabled=false;b.textContent='Conferir o que vai entrar';
        avisar('res-upload','<b>Não deu certo.</b> '+esc(erroDe(e))+
          ((e&&e.detalhes&&e.detalhes.length)?'<br>'+esc(e.detalhes.join('; ')):''),'erro');});
  });
  var bu=$('bt-upload');
  if(bu) bu.addEventListener('click',function(){
    var arq=$('arquivo').files[0];
    if(!arq||arq.name!==conferido){avisar('res-upload','Confira o arquivo antes de gravar.','erro');return;}
    var b=this;b.disabled=true;b.textContent='Gravando…';
    var fd=new FormData();fd.append('arquivo',arq);
    fetch('/admin/carteira/upload',{method:'POST',body:fd})
      .then(function(r){return r.json().catch(function(){throw {erro:'Resposta inesperada do servidor.'};});})
      .then(function(j){
        if(!j.success)throw j;
        avisar('res-upload','<b>'+num(j.novas)+' notas novas gravadas.</b> '+num(j.repetidas)+
          ' já existiam e foram ignoradas. A base tem agora '+num(j.total)+' notas. Recarregando…','ok');
        setTimeout(function(){location.reload();},1600);
      })
      .catch(function(e){
        b.disabled=false;b.textContent='Gravar';
        avisar('res-upload','<b>Não deu certo.</b> '+esc(erroDe(e)),'erro');});
  });
}

function montarDados(){
  montarUpload();
  var cand=$('candidatos');
  if(cand){
    cand.innerHTML=(CANDIDATOS&&CANDIDATOS.length)
      ? CANDIDATOS.map(function(g){
          return '<div class="cartao" style="margin-bottom:10px"><p class="nota" style="margin-bottom:8px">'+
            esc(g.motivo)+'</p><div class="tabwrap"><table style="min-width:0"><tbody>'+
            g.clientes.map(function(x){return '<tr><td class="nome">'+esc(x.nome)+'</td>'+
              '<td class="num mono">'+mil(x.receita)+'</td><td class="num mono">'+x.compras+
              (x.compras===1?' pedido':' pedidos')+'</td><td class="num mono">'+dbr(x.ultima)+'</td></tr>';}).join('')+
            '</tbody></table></div><div style="margin-top:10px">'+
            '<button class="bt p sm" data-de="'+esc(g.clientes[1].nome)+'" data-para="'+esc(g.clientes[0].nome)+
            '">Unificar em '+esc(g.clientes[0].nome)+'</button></div></div>';}).join('')
      : '<p class="vazio">Nenhum par suspeito encontrado.</p>';
    cand.querySelectorAll('[data-de]').forEach(function(b){
      b.addEventListener('click',function(){unificar(b.dataset.de,b.dataset.para,b);});});
  }
  var opcoes=C.map(function(c){return '<option value="'+esc(c.nome)+'">'+esc(c.nome)+'</option>';}).join('');
  $('al-de').innerHTML='<option value="">Escolha…</option>'+opcoes;
  $('al-para').innerHTML='<option value="">Escolha…</option>'+opcoes;
  $('bt-alias').addEventListener('click',function(){unificar($('al-de').value,$('al-para').value,this);});
  var chaves=Object.keys(ALIASES);
  $('lista-alias').innerHTML=chaves.length
    ? '<h3 style="font-size:.8rem;font-weight:700;color:var(--roxo-forte);margin-bottom:8px">Unificações ativas</h3>'+
      '<div class="tabwrap"><table style="min-width:0"><tbody>'+
      chaves.sort().map(function(k){return '<tr><td>'+esc(k)+' → <b>'+esc(ALIASES[k])+'</b></td>'+
        '<td class="num"><button class="bt sm" data-desfaz="'+esc(k)+'">Desfazer</button></td></tr>';}).join('')+
      '</tbody></table></div>'
    : '<p class="vazio">Nenhuma unificação ativa.</p>';
  $('lista-alias').querySelectorAll('[data-desfaz]').forEach(function(b){
    b.addEventListener('click',function(){
      b.disabled=true;
      enviar('/admin/carteira/alias',{apelido:b.dataset.desfaz,remover:true})
        .then(function(){location.reload();})
        .catch(function(e){b.disabled=false;alert(erroDe(e));});});
  });
  montarLote();
}
function unificar(de,para,botao){
  if(!de||!para||de===para){alert('Escolha dois nomes diferentes.');return;}
  botao.disabled=true;botao.textContent='Unificando…';
  enviar('/admin/carteira/alias',{apelido:de,canonico:para})
    .then(function(){location.reload();})
    .catch(function(e){botao.disabled=false;botao.textContent='Unificar';alert(erroDe(e));});
}
var pendentes=null;
function montarLote(){
  $('bt-copiar').addEventListener('click',function(){
    var txt=C.map(function(c){return c.nome+';;';}).join('\n'), b=this;
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(function(){b.textContent='Lista copiada';})
        .catch(function(){$('txt-lote').value=txt;b.textContent='Lista colada abaixo';});
    } else { $('txt-lote').value=txt;b.textContent='Lista colada abaixo'; }
    setTimeout(function(){b.textContent='Copiar a lista de clientes';},2500);});
  $('bt-conferir').addEventListener('click',function(){
    var linhas=$('txt-lote').value.split('\n').map(function(l){return l.trim();}).filter(Boolean);
    var ok=[],ruim=[];
    linhas.forEach(function(l){
      var p=l.split(';').map(function(x){return x.trim();});
      var c=PORNOME[norm(p[0]||'')];
      if(!c){ruim.push(p[0]||l);return;}
      if(!p[1]&&!p[2])return;
      ok.push({cliente_id:c.id,cliente_nome:c.nome,cidade:p[1]||'',estado:(p[2]||'').toUpperCase().slice(0,2)});});
    pendentes=ok;
    $('bt-gravar').disabled=!ok.length;
    $('res-lote').innerHTML='<p class="nota" style="margin:12px 0 0">'+ok.length+' linha(s) prontas'+
      (ruim.length?', '+ruim.length+' sem cliente correspondente: '+esc(ruim.slice(0,6).join(', '))+
        (ruim.length>6?'…':''):'')+'.</p>'+
      (ok.length?'<div class="tabwrap" style="margin-top:10px"><table style="min-width:0"><thead><tr>'+
        '<th>Cliente</th><th>Cidade</th><th>UF</th></tr></thead><tbody>'+
        ok.slice(0,12).map(function(r){return '<tr><td class="nome">'+esc(r.cliente_nome)+'</td>'+
          '<td>'+esc(r.cidade)+'</td><td class="mono">'+esc(r.estado)+'</td></tr>';}).join('')+
        '</tbody></table></div>'+(ok.length>12?'<p class="nota" style="margin-top:6px">Mostrando as 12 primeiras.</p>':''):'');});
  $('bt-gravar').addEventListener('click',function(){
    if(!pendentes||!pendentes.length)return;
    var b=this;b.disabled=true;b.textContent='Gravando…';
    enviar('/admin/carteira/fichas-lote',{itens:pendentes})
      .then(function(j){
        $('res-lote').insertAdjacentHTML('beforeend',
          '<div class="faixa ok" style="margin-top:10px"><b>'+j.gravados+' cliente(s) atualizados.</b> Recarregando…</div>');
        setTimeout(function(){location.reload();},1200);
      })
      .catch(function(e){b.disabled=false;b.textContent='Gravar';
        $('res-lote').insertAdjacentHTML('beforeend',
          '<div class="faixa erro" style="margin-top:10px">'+esc(erroDe(e))+'</div>');});});
}

/* ── ligações da aba Região ─────────────────────────────────────────────── */
$('sel-limpar').addEventListener('click',function(){selecionados={};renderTabelaRegiao();$('painel-atuacao').hidden=true;});
$('sel-aplicar').addEventListener('click',function(){
  var n=Object.keys(selecionados).length;
  $('atuacao-alvo').textContent='Vai valer para '+n+(n===1?' cliente selecionado.':' clientes selecionados.');
  $('painel-atuacao').hidden=false;
  $('painel-atuacao').scrollIntoView({behavior:'smooth',block:'nearest'});});
$('at-cancelar').addEventListener('click',function(){$('painel-atuacao').hidden=true;});
$('at-substituir').addEventListener('click',function(){aplicarAtuacao('substituir');});
$('at-acrescentar').addEventListener('click',function(){aplicarAtuacao('adicionar');});
['q-reg','f-reg-uf','f-reg-at'].forEach(function(id){$(id).addEventListener('input',renderTabelaRegiao);});
['q','f-cls','f-uf','f-sit'].forEach(function(id){$(id).addEventListener('input',renderClientes);});
fdir.addEventListener('change',renderClientes);

/* ── primeira renderização ──────────────────────────────────────────────── */
cartoesAcao(); tabelaAcao(); tabelaAlta(); tabelaEncerrados();
montarDirecao(); montarCarteira(); montarRegiao(); montarProjecao();
renderCRM(); renderClientes(); montarDados(); montarProspec(); montarUploadLeads(); montarAbas();
})();
