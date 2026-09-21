/* Carteira de Clientes — Fogos Piromax
   Depende das variáveis injetadas pelo template: D, FICHA, INTER, TAREFAS,
   ALIASES, CANDIDATOS, MOTIVOS, HOJE. */
(function () {
'use strict';

var MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
var ANO_REF = D ? parseInt(D.meta.ref.slice(0, 4), 10) : new Date().getFullYear();
var ANOS = [ANO_REF - 2, ANO_REF - 1, ANO_REF];

/* ── formatação ─────────────────────────────────────────────────────────── */
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
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function norm(s){return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/[^a-zA-Z0-9]+/g,' ').trim().toLowerCase();}

var SVGNS='http://www.w3.org/2000/svg';
function el(n,a){var e=document.createElementNS(SVGNS,n);for(var k in a)e.setAttribute(k,a[k]);return e;}
function $(id){return document.getElementById(id);}

/* ── sem dados ──────────────────────────────────────────────────────────── */
if (!D) {
  $('sem-dados').hidden = false;
  ['geral','carteira','segmentos','acao','prev','crm','clientes'].forEach(function(p){
    var n=$('p-'+p); if(n) n.hidden=true;
  });
  $('p-dados').hidden = false;
  document.querySelectorAll('.aba').forEach(function(t){
    t.setAttribute('aria-selected', String(t.dataset.p==='dados'));
  });
  montarDados();
  return;
}

var C = D.clientes, M = D.meta, PV = D.previsao, BT = D.backtest;
var PORID = {}, PORNOME = {};
C.forEach(function(c){
  PORID[c.id] = c; PORNOME[norm(c.nome)] = c;
  (c.alias||[]).forEach(function(a){ PORNOME[norm(a)] = c; });
});

/* ── dica flutuante ─────────────────────────────────────────────────────── */
var dica = $('dica');
function linha(a,b){return '<div class="r"><span>'+a+'</span><span>'+b+'</span></div>';}
function moverDica(ev){
  var r = dica.getBoundingClientRect(), x = ev.clientX+14, y = ev.clientY+14;
  if (x + r.width  > innerWidth  - 8) x = ev.clientX - r.width  - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  dica.style.left = Math.max(8,x)+'px'; dica.style.top = Math.max(8,y)+'px';
}
function comDica(node, html){
  node.addEventListener('pointerenter', function(e){ dica.innerHTML=html; dica.style.opacity='1'; moverDica(e); });
  node.addEventListener('pointermove', moverDica);
  node.addEventListener('pointerleave', function(){ dica.style.opacity='0'; });
}

/* ── gráficos ───────────────────────────────────────────────────────────── */
function topoArredondado(x,y,w,h,r){
  r = Math.min(r, w/2, h);
  return 'M'+x+','+(y+h)+'V'+(y+r)+'a'+r+','+r+' 0 0 1 '+r+',-'+r+
         'h'+(w-2*r)+'a'+r+','+r+' 0 0 1 '+r+','+r+'V'+(y+h)+'Z';
}
function barras(host, dados, opt){
  opt = opt || {};
  var W=920, H=opt.h||250, ml=54, mr=10, mt=26, mb=opt.mb||40;
  var iw=W-ml-mr, ih=H-mt-mb;
  var larguraMax = opt.maxBW || Infinity;
  var gw = Math.min(iw, larguraMax*dados.length), gx = ml + (iw-gw)/2;
  var max = Math.max.apply(null, dados.map(function(r){return r.v;})) * 1.06 || 1;
  var s = el('svg',{viewBox:'0 0 '+W+' '+H, role:'img','aria-label':opt.alt||''});
  for (var i=0;i<=4;i++){
    var y = mt+ih-ih*i/4;
    s.appendChild(el('line',{x1:ml,x2:ml+iw,y1:y,y2:y,'class': i?'gridline':'axisline'}));
    var t = el('text',{x:ml-8,y:y+3.5,'class':'tick','text-anchor':'end'});
    t.textContent = opt.fmtY ? opt.fmtY(max*i/4) : (max*i/4/1e6).toFixed(1);
    s.appendChild(t);
  }
  var bw = gw/dados.length, pad = Math.min(6, bw*0.18);
  dados.forEach(function(r,i){
    var h = Math.max(1.5, ih*r.v/max), x = gx+i*bw+pad/2, y = mt+ih-h, w = bw-pad;
    var p = el('path',{d:topoArredondado(x,y,w,h,4), fill:r.color||'var(--s1)'});
    if (r.fraca) p.setAttribute('opacity','.5');
    s.appendChild(p);
    var hit = el('rect',{x:gx+i*bw,y:mt,width:bw,height:ih,fill:'transparent'});
    comDica(hit, r.dica); s.appendChild(hit);
    if (r.lab){var t1=el('text',{x:x+w/2,y:H-mb+14,'class':'tick','text-anchor':'middle'});t1.textContent=r.lab;s.appendChild(t1);}
    if (r.lab2){var t2=el('text',{x:x+w/2,y:H-mb+27,'class':'mlab','text-anchor':'middle'});t2.textContent=r.lab2;s.appendChild(t2);}
  });
  if (opt.yLab){var yl=el('text',{x:ml-8,y:mt-11,'class':'tick','text-anchor':'end'});yl.textContent=opt.yLab;s.appendChild(yl);}
  host.innerHTML=''; host.appendChild(s);
  if (opt.legenda) host.insertAdjacentHTML('beforeend', opt.legenda);
}
function barrasH(host, pares, cor, aoClicar){
  var mx = Math.max.apply(null, pares.map(function(p){return p[2];})) || 1;
  host.innerHTML = pares.map(function(p){
    return '<div class="bl"'+(aoClicar?' role="button" tabindex="0" data-k="'+esc(p[0])+'" style="cursor:pointer"':'')+'>'+
      '<div class="t">'+esc(p[1])+'</div>'+
      '<div class="trilho"><div class="ench" style="width:'+(p[2]/mx*100).toFixed(1)+'%;background:'+cor(p[0])+'"></div></div>'+
      '<div class="v">'+mil(p[2])+' · '+p[3]+'</div></div>';
  }).join('');
  if (aoClicar) host.querySelectorAll('[data-k]').forEach(function(n){
    n.addEventListener('click', function(){ aoClicar(n.dataset.k); });
    n.addEventListener('keydown', function(e){
      if (e.key==='Enter'||e.key===' '){ e.preventDefault(); aoClicar(n.dataset.k); }});
  });
}

/* ── cabeçalho e visão geral ────────────────────────────────────────────── */
$('sub-periodo').textContent = dbr(M.inicio)+' a '+dbr(M.ref)+' · '+num(M.clientes)+' clientes · '+num(M.eventos)+' pedidos';

var ytdAtual = M['ytd'+ANO_REF], ytdAnt = M['ytd'+(ANO_REF-1)], ytdAnt2 = M['ytd'+(ANO_REF-2)];
var varA = ytdAnt>0 ? (ytdAtual/ytdAnt-1)*100 : null;
var varB = ytdAnt2>0 ? (ytdAnt/ytdAnt2-1)*100 : null;
function cartoes(host, itens){
  $(host).innerHTML = itens.map(function(k){
    return '<div class="kpi"><div class="lab">'+k[0]+'</div><div class="val">'+k[1]+'</div><div class="fine">'+k[2]+'</div></div>';
  }).join('');
}
var todosPedidos = C.reduce(function(a,c){return a.concat(c.hist.map(function(h){return h[1];}));},[]);
function mediana(a){var s=a.slice().sort(function(x,y){return x-y;});var m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;}
cartoes('kpis', [
  ['Receita no período', mi(M.receita), num(M.eventos)+' pedidos de '+num(M.clientes)+' clientes'],
  ['Pedido médio', brl(M.receita/M.eventos), 'mediana de '+brl(mediana(todosPedidos))],
  ['Jan a '+dbr(M.ref).slice(0,5)+' de '+ANO_REF, mil(ytdAtual),
   varA===null?'sem base de comparação':'<span class="'+(varA>0?'sobe':'desce')+'">'+pct(varA)+'</span> contra '+(ANO_REF-1)],
  ['Mesma janela em '+(ANO_REF-1), mil(ytdAnt),
   varB===null?'sem base de comparação':'<span class="'+(varB>0?'sobe':'desce')+'">'+pct(varB)+'</span> contra '+(ANO_REF-2)],
  ['Concentração', C.filter(function(c){return c.classe==='A';}).length+' clientes', 'somam 80% da receita']
]);
$('nota-ytd').textContent = 'Mesma janela do calendário nos três anos, de 1º de janeiro até '+dbr(M.ref)+
  ', para que a comparação não seja contaminada pelo pico de fim de ano.';

barras($('g-mensal'), D.mensal.map(function(m){
  var p = m.mes.split('-'), i = +p[1]-1, parcial = m.mes === M.ref.slice(0,7);
  return {v:m.receita, color: parcial?'var(--s2)':'var(--s1)', fraca:parcial,
    lab:(i===0||i===6)?MES[i]:'', lab2: i===0?p[0]:'',
    dica:'<b>'+MES[i]+'/'+p[0]+(parcial?' (parcial)':'')+'</b>'+linha('Receita',brl(m.receita))+
         linha('Pedidos',num(m.compras))+linha('Clientes',num(m.clientes))};
}), {h:260, mb:52, yLab:'R$ mi', alt:'Faturamento mensal',
  legenda:'<div class="legenda"><span><i style="background:var(--s1)"></i>mês fechado</span>'+
    '<span><i style="background:var(--s2);opacity:.5"></i>mês corrente, parcial</span></div>'});

barras($('g-ytd'), ANOS.map(function(a,idx){
  return {v:M['ytd'+a]||0, lab:String(a), color: idx===2?'var(--s2)':'var(--s1)',
    dica:'<b>1/jan a '+dbr(M.ref).slice(0,5)+' de '+a+'</b>'+linha('Receita',brl(M['ytd'+a]||0))};
}), {h:210, yLab:'R$ mi', maxBW:120, alt:'Acumulado do ano nos três anos'});

barras($('g-sazon'), D.sazonal.map(function(m){
  var anosNoMes = D.mensal.filter(function(x){return +x.mes.split('-')[1]===m.mes;}).length;
  var maxAnos = Math.max.apply(null, D.sazonal.map(function(x){
    return D.mensal.filter(function(y){return +y.mes.split('-')[1]===x.mes;}).length;}));
  return {v:m.receita, lab:MES[m.mes-1], color:'var(--s1)', fraca: anosNoMes < maxAnos,
    dica:'<b>'+MES[m.mes-1]+'</b>'+linha('Receita somada',brl(m.receita))+
      linha('% do total',(m.receita/M.receita*100).toFixed(1)+'%')+linha('Anos com dado',anosNoMes)};
}), {h:240, yLab:'R$ mi', alt:'Receita por mês do calendário',
  legenda:'<div class="legenda"><span><i style="background:var(--s1)"></i>todos os anos da base</span>'+
    '<span><i style="background:var(--s1);opacity:.5"></i>menos anos de histórico</span></div>'});

/* ── concentração ───────────────────────────────────────────────────────── */
(function(){
  var g={A:[0,0],B:[0,0],C:[0,0]};
  C.forEach(function(c){ g[c.classe][0]++; g[c.classe][1]+=c.receita; });
  var top10 = C.slice(0,10).reduce(function(a,c){return a+c.receita;},0);
  cartoes('kpis-abc', [
    ['Classe A', g.A[0]+' clientes', mi(g.A[1])+' · '+(g.A[1]/M.receita*100).toFixed(0)+'% da receita'],
    ['Classe B', g.B[0]+' clientes', mi(g.B[1])+' · '+(g.B[1]/M.receita*100).toFixed(0)+'% da receita'],
    ['Classe C', g.C[0]+' clientes', mil(g.C[1])+' · '+(g.C[1]/M.receita*100).toFixed(0)+'% da receita'],
    ['Maior cliente', esc(C[0].nome.split(' ').slice(0,2).join(' ')), mi(C[0].receita)+' · '+(C[0].receita/M.receita*100).toFixed(0)+'% sozinho'],
    ['Dez maiores', (top10/M.receita*100).toFixed(0)+'% da receita', mi(top10)]
  ]);

  var top = C.slice(0, Math.min(25, C.length));
  var W=920,H=380,ml=54,mr=44,mt=26,mb=150,iw=W-ml-mr,ih=H-mt-mb;
  var max = top[0].receita*1.05;
  var s = el('svg',{viewBox:'0 0 '+W+' '+H, role:'img','aria-label':'Curva ABC'});
  for (var i=0;i<=4;i++){
    var y=mt+ih-ih*i/4;
    s.appendChild(el('line',{x1:ml,x2:ml+iw,y1:y,y2:y,'class':i?'gridline':'axisline'}));
    var t=el('text',{x:ml-8,y:y+3.5,'class':'tick','text-anchor':'end'});t.textContent=(max*i/4/1e6).toFixed(1);s.appendChild(t);
    var t2=el('text',{x:ml+iw+8,y:y+3.5,'class':'tick','text-anchor':'start'});t2.textContent=Math.round(100*i/4)+'%';s.appendChild(t2);
  }
  var bw=iw/top.length, pad=Math.min(5,bw*0.22), pts=[];
  top.forEach(function(c,i){
    var h=ih*c.receita/max, x=ml+i*bw+pad/2, y=mt+ih-h, w=bw-pad;
    s.appendChild(el('path',{d:topoArredondado(x,y,w,h,3),fill:c.classe==='A'?'var(--s1)':'var(--o1)'}));
    pts.push([x+w/2, mt+ih-ih*c.acum]);
    var nm = c.nome.length>19 ? c.nome.slice(0,18)+'…' : c.nome;
    var t=el('text',{x:x+w/2,y:mt+ih+10,'class':'tick','text-anchor':'end',
      transform:'rotate(-58 '+(x+w/2)+' '+(mt+ih+10)+')'});
    t.textContent=nm; s.appendChild(t);
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
  var host=$('g-pareto'); host.innerHTML=''; host.appendChild(s);
  var temB = top.some(function(c){return c.classe!=='A';});
  host.insertAdjacentHTML('beforeend','<div class="legenda"><span><i style="background:var(--s1)"></i>classe A</span>'+
    (temB?'<span><i style="background:var(--o1)"></i>classe B</span>':'')+
    '<span><i style="background:var(--roxo)"></i>receita acumulada, eixo à direita</span></div>');

  var co=D.coortes, anos=Object.keys(co.base).sort(), colunas=[];
  Object.keys(co.receita).forEach(function(k){Object.keys(co.receita[k]).forEach(function(a){
    if(colunas.indexOf(a)<0)colunas.push(a);});});
  colunas.sort();
  var vals=[]; Object.keys(co.receita).forEach(function(k){Object.keys(co.receita[k]).forEach(function(a){vals.push(co.receita[k][a]);});});
  var mx=Math.max.apply(null,vals)||1;
  var ramp=['#ede9fe','#ddd6fe','#c4b5fd','#a78bfa','#8b5cf6','#7c3aed','#5b21b6'];
  var h='<thead><tr><th>Entrou em</th><th class="num">Clientes</th>'+
    colunas.map(function(a){return '<th class="num">Receita '+a+'</th>';}).join('')+'</tr></thead><tbody>';
  anos.forEach(function(k){
    h+='<tr><td class="nome">'+k+'</td><td class="num mono">'+co.base[k]+'</td>';
    colunas.forEach(function(a){
      var v=(co.receita[k]||{})[a]||0, n=(co.clientes[k]||{})[a]||0;
      if(!v){h+='<td class="num" style="color:var(--texto3)">—</td>';return;}
      var idx=Math.min(6,Math.floor(Math.pow(v/mx,.45)*7));
      h+='<td class="num mono" style="background:'+ramp[idx]+';color:'+(idx>=4?'#fff':'var(--roxo-forte)')+'">'+
         mil(v)+'<br><span style="font-size:10px;opacity:.85">'+n+' ativos</span></td>';
    });
    h+='</tr>';
  });
  $('t-coorte').innerHTML=h+'</tbody>';
})();

/* ── segmentos ──────────────────────────────────────────────────────────── */
var SEGORD=['Campeoes','Fieis','Promissores','Atencao','Em risco','Hibernando','Perdidos'];
var SEGNOME={Campeoes:'Campeões',Fieis:'Fiéis',Promissores:'Promissores',Atencao:'Atenção',
  'Em risco':'Em risco',Hibernando:'Hibernando',Perdidos:'Perdidos'};
var SEGCOR={Campeoes:'var(--o7)',Fieis:'var(--o6)',Promissores:'var(--o5)',Atencao:'var(--o4)',
  'Em risco':'var(--o3)',Hibernando:'var(--o2)',Perdidos:'var(--o1)'};
(function(){
  var ag={}; C.forEach(function(c){ag[c.segmento]=ag[c.segmento]||[0,0];ag[c.segmento][0]++;ag[c.segmento][1]+=c.receita;});
  barrasH($('b-seg'), SEGORD.filter(function(s){return ag[s];}).map(function(s){
    return [s, SEGNOME[s], ag[s][1], ag[s][0]+(ag[s][0]===1?' cliente':' clientes')];}),
    function(s){return SEGCOR[s];},
    function(s){ irPara('clientes'); $('f-seg').value=s; renderClientes(); });
  var ap={}; C.forEach(function(c){ap[c.perfil]=ap[c.perfil]||[0,0];ap[c.perfil][0]++;ap[c.perfil][1]+=c.receita;});
  var ordP=['Ano todo','Puxado p/ fim de ano','Fim de ano','Junino'];
  var corP={'Ano todo':'var(--o7)','Puxado p/ fim de ano':'var(--o5)','Fim de ano':'var(--o3)','Junino':'var(--o1)'};
  barrasH($('b-perfil'), ordP.filter(function(p){return ap[p];}).map(function(p){
    return [p,p,ap[p][1],ap[p][0]+' clientes'];}), function(p){return corP[p]||'var(--o3)';});

  var W=920,H=340,ml=62,mr=16,mt=26,mb=44,iw=W-ml-mr,ih=H-mt-mb;
  var maxX=Math.max.apply(null,C.map(function(c){return c.compras;}))*1.05;
  var maxY=Math.max.apply(null,C.map(function(c){return c.ticket;}))*1.05;
  var s=el('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':'Frequência contra ticket'});
  for(var i=0;i<=4;i++){
    var y=mt+ih-ih*i/4;
    s.appendChild(el('line',{x1:ml,x2:ml+iw,y1:y,y2:y,'class':i?'gridline':'axisline'}));
    var t=el('text',{x:ml-8,y:y+3.5,'class':'tick','text-anchor':'end'});
    t.textContent=Math.round(maxY*i/4/1000)+'k'; s.appendChild(t);
    var x=ml+iw*i/4, t2=el('text',{x:x,y:H-mb+16,'class':'tick','text-anchor':'middle'});
    t2.textContent=Math.round(maxX*i/4); s.appendChild(t2);
  }
  var yl=el('text',{x:ml-8,y:mt-11,'class':'tick','text-anchor':'end'});yl.textContent='ticket';s.appendChild(yl);
  var xl=el('text',{x:ml+iw,y:H-mb+31,'class':'mlab','text-anchor':'end'});xl.textContent='pedidos no período';s.appendChild(xl);
  C.forEach(function(c){
    var x=ml+iw*c.compras/maxX, y=mt+ih-ih*c.ticket/maxY;
    var r=Math.max(4,Math.min(15,Math.sqrt(c.receita/M.receita)*62));
    var cir=el('circle',{cx:x,cy:y,r:r,'fill-opacity':.72,stroke:'#fff','stroke-width':2,
      fill:c.classe==='A'?'var(--s1)':(c.classe==='B'?'var(--o2)':'var(--o1)'),style:'cursor:pointer'});
    comDica(cir,'<b>'+esc(c.nome)+'</b>'+linha('Pedidos',num(c.compras))+linha('Ticket médio',brl(c.ticket))+
      linha('Receita total',brl(c.receita))+linha('Classe',c.classe));
    cir.addEventListener('click',function(){abrirFicha(c.id);});
    s.appendChild(cir);
  });
  var host=$('g-disp');host.innerHTML='';host.appendChild(s);
  host.insertAdjacentHTML('beforeend','<div class="legenda"><span><i style="background:var(--s1)"></i>classe A</span>'+
    '<span><i style="background:var(--o2)"></i>classe B</span><span><i style="background:var(--o1)"></i>classe C</span>'+
    '<span>o tamanho do ponto é a receita total</span></div>');
})();

/* ── ação comercial (critério anual) ────────────────────────────────────── */
function situacaoDe(c){ return (FICHA[c.id]||{}).situacao || 'ativo'; }
function motivoTexto(c){
  var f = FICHA[c.id]||{}, rot = '';
  for (var i=0;i<MOTIVOS.length;i++) if (MOTIVOS[i][0]===f.motivo_tipo) rot = MOTIVOS[i][1];
  return [rot, f.motivo||''].filter(Boolean).join(' · ');
}
function gravidade(c){
  var v = c.var_ytd_pct;
  if (c.ytd_anos[ANO_REF] === 0) return ['sv-crit','Parou de comprar'];
  if (v !== null && v <= -60) return ['sv-crit','Queda forte'];
  if (v !== null && v <= -30) return ['sv-ser','Em queda'];
  return ['sv-at','Atenção'];
}
var ACAO = C.filter(function(c){
  if (c.classe === 'C' || situacaoDe(c) === 'perdido') return false;
  if (c.ytd_base <= 0) return false;
  return (c.var_ytd_pct !== null && c.var_ytd_pct < -30) || c.ytd_anos[ANO_REF] === 0;
});
var AB = C.filter(function(c){return c.classe!=='C' && situacaoDe(c)!=='perdido';});
$('nota-acao').innerHTML =
  'Clientes de classe A e B que compraram, de 1º de janeiro até '+dbr(M.ref)+', pelo menos 30% menos do que '+
  'compraram na <b>mesma janela</b> dos anos anteriores. A comparação é contra a média de '+(ANO_REF-2)+' e '+(ANO_REF-1)+
  ', o que elimina o efeito da sazonalidade: um cliente de fim de ano não aparece aqui só porque estamos em setembro. '+
  'São '+ACAO.length+' dos '+AB.length+' clientes A e B ativos.';

function tabelaAcao(){
  var ord = $('f-acao').value;
  var rows = ACAO.slice().sort(function(a,b){
    if (ord==='receita') return b.receita-a.receita;
    if (ord==='atraso')  return b.recencia-a.recencia;
    return a.var_ytd_abs-b.var_ytd_abs;
  });
  $('cont-acao').textContent = rows.length+' clientes · '+
    mil(rows.reduce(function(s,c){return s+Math.min(0,c.var_ytd_abs);},0)*-1)+' a menos que nos anos anteriores';
  $('t-acao').innerHTML =
    '<thead><tr><th>Cliente</th><th>Situação</th>'+
    ANOS.map(function(a){return '<th class="num">'+a+'</th>';}).join('')+
    '<th class="num">vs média</th><th class="num">Diferença</th><th class="num">Sem comprar</th><th>Motivo</th></tr></thead><tbody>'+
    rows.map(function(c){
      var g = gravidade(c), mt = motivoTexto(c);
      return '<tr class="cli" data-id="'+esc(c.id)+'">'+
        '<td class="nome">'+esc(c.nome)+' <span class="cls cls'+c.classe+'">'+c.classe+'</span></td>'+
        '<td><span class="selo '+g[0]+'"><i></i>'+g[1]+'</span></td>'+
        ANOS.map(function(a){return '<td class="num mono">'+mil(c.ytd_anos[a]||0)+'</td>';}).join('')+
        '<td class="num mono desce">'+(c.var_ytd_pct===null?'—':pct(c.var_ytd_pct))+'</td>'+
        '<td class="num mono desce">'+mil(c.var_ytd_abs)+'</td>'+
        '<td class="num mono">'+c.recencia+' d</td>'+
        '<td style="font-size:.78rem;color:var(--texto2)">'+(mt?esc(mt):'<span style="color:var(--texto3)">a registrar</span>')+'</td></tr>';
    }).join('')+'</tbody>';
  ligarLinhas('t-acao');
}
$('f-acao').addEventListener('change', tabelaAcao);

function tabelaEncerrados(){
  var rows = C.filter(function(c){return situacaoDe(c)==='perdido';})
               .sort(function(a,b){return b.receita-a.receita;});
  $('t-encerrados').innerHTML = rows.length
    ? '<thead><tr><th>Cliente</th><th>Motivo</th><th class="num">Receita histórica</th><th class="num">Última compra</th></tr></thead><tbody>'+
      rows.map(function(c){return '<tr class="cli" data-id="'+esc(c.id)+'">'+
        '<td class="nome">'+esc(c.nome)+'</td>'+
        '<td><span class="selo sv-off"><i></i>'+esc(motivoTexto(c)||'sem motivo registrado')+'</span></td>'+
        '<td class="num mono">'+mil(c.receita)+'</td>'+
        '<td class="num mono">'+dbr(c.ultima)+'</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">Nenhum cliente marcado como perdido. Abra a ficha de um cliente e mude a situação para registrar o motivo, por exemplo quando o dono falece ou a loja fecha.</td></tr></tbody>';
  ligarLinhas('t-encerrados');
}

function tabelaAlta(){
  var alta = C.filter(function(c){return c.var_ytd_abs>0 && c.ytd_base>0;})
              .sort(function(a,b){return b.var_ytd_abs-a.var_ytd_abs;}).slice(0,12);
  $('t-alta').innerHTML = alta.length
    ? '<thead><tr><th>Cliente</th>'+ANOS.map(function(a){return '<th class="num">'+a+'</th>';}).join('')+
      '<th class="num">Diferença</th><th class="num">vs média</th></tr></thead><tbody>'+
      alta.map(function(c){return '<tr class="cli" data-id="'+esc(c.id)+'">'+
        '<td class="nome">'+esc(c.nome)+' <span class="cls cls'+c.classe+'">'+c.classe+'</span></td>'+
        ANOS.map(function(a){return '<td class="num mono">'+mil(c.ytd_anos[a]||0)+'</td>';}).join('')+
        '<td class="num mono sobe">+'+mil(c.var_ytd_abs)+'</td>'+
        '<td class="num mono sobe">'+(c.var_ytd_pct===null?'novo':pct(c.var_ytd_pct))+'</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">Nenhum cliente acima da média dos anos anteriores.</td></tr></tbody>';
  ligarLinhas('t-alta');
}

/* ── projeção ───────────────────────────────────────────────────────────── */
(function(){
  if (!PV || !PV.clientes) return;
  var E = PV.empresa, meses = Object.keys(E.meses).sort();
  var r = BT.resumo || {};
  $('aviso-prev').innerHTML =
    '<b>Leia isto antes de usar os números.</b> Não é um modelo estatístico com intervalo de confiança: a base tem '+
    D.mensal.length+' meses, o que dá poucas observações de cada mês do calendário. Testando o método em '+
    (r.n||0)+' trimestres já encerrados, o total da empresa errou '+
    (r.pior_baixo!==null&&r.pior_baixo!==undefined?pct(r.pior_baixo):'?')+' no pior caso para baixo e '+
    (r.pior_alto!==null&&r.pior_alto!==undefined?pct(r.pior_alto):'?')+' no pior para cima, com erro médio de '+
    (r.erro_medio_abs?r.erro_medio_abs.toFixed(0):'?')+'%. Use como ordem de grandeza, nunca como número exato.';

  var somaAno=function(a){return D.mensal.filter(function(m){return m.mes.indexOf(String(a))===0;})
    .reduce(function(s,m){return s+m.receita;},0);};
  var anoAnt=somaAno(ANO_REF-1), anoAtual=somaAno(ANO_REF)+E.resto_mes+E.bloco;
  cartoes('kpis-prev', [
    ['Resto do mês corrente', mil(E.resto_mes), brl(E.ja_mes)+' já faturados'],
    ['Trimestre à frente', mi(E.bloco), (ANO_REF-2)+': '+mil(E.h1)+' · '+(ANO_REF-1)+': '+mil(E.h2)],
    [ANO_REF+' fechado, projetado', mi(anoAtual),
     '<span class="'+(anoAtual>anoAnt?'sobe':'desce')+'">'+pct((anoAtual/anoAnt-1)*100)+'</span> contra '+mi(anoAnt)+' em '+(ANO_REF-1)],
    ['Clientes com meta', PV.clientes.length, 'de '+M.clientes+', somando '+
      mil(PV.clientes.reduce(function(s,c){return s+c.prev;},0))]
  ]);

  var linhas = D.mensal.map(function(m){
    var p=m.mes.split('-'), i=+p[1]-1;
    return {v:m.receita,color:'var(--s1)',lab:(i===0||i===6)?MES[i]:'',lab2:i===0?p[0]:'',
      dica:'<b>'+MES[i]+'/'+p[0]+'</b>'+linha('Realizado',brl(m.receita))};
  });
  var iAtual = +M.ref.slice(5,7)-1;
  linhas[linhas.length-1] = {v:E.ja_mes+E.resto_mes, color:'var(--s2)', fraca:true, lab:MES[iAtual], lab2:'',
    dica:'<b>'+MES[iAtual]+'</b>'+linha('Já faturado',brl(E.ja_mes))+linha('Falta projetado',brl(E.resto_mes))+
         linha('Total projetado',brl(E.ja_mes+E.resto_mes))};
  meses.forEach(function(k){
    var i=+k.split('-')[1]-1, d=E.meses[k];
    linhas.push({v:d.previsto,color:'var(--s2)',fraca:true,lab:MES[i],lab2:'',
      dica:'<b>'+MES[i]+' (projeção)</b>'+linha('Projetado',brl(d.previsto))+
        linha(String(ANO_REF-2),brl(d.h1))+linha(String(ANO_REF-1),brl(d.h2))});
  });
  barras($('g-prev'), linhas, {h:270,mb:52,yLab:'R$ mi',alt:'Realizado e projeção',
    legenda:'<div class="legenda"><span><i style="background:var(--s1)"></i>realizado</span>'+
      '<span><i style="background:var(--s2);opacity:.5"></i>projeção</span></div>'});

  $('t-backtest').innerHTML =
    '<thead><tr><th>Trimestre testado</th><th class="num">Real</th><th class="num">Projetado</th>'+
    '<th class="num">Erro no total</th><th class="num">Erro mediano por cliente</th><th class="num">Dentro de ±30%</th></tr></thead><tbody>'+
    BT.blocos.map(function(b){return '<tr><td class="nome">'+esc(b.rot)+'</td>'+
      '<td class="num mono">'+mil(b.real)+'</td><td class="num mono">'+mil(b.prev)+'</td>'+
      '<td class="num mono '+(b.erro>0?'sobe':'desce')+'">'+pct(b.erro)+'</td>'+
      '<td class="num mono">'+(b.med_sel===null?'—':Math.round(b.med_sel)+'%')+'</td>'+
      '<td class="num mono">'+(b.d30===null?'—':Math.round(b.d30)+'%')+'</td></tr>';}).join('')+'</tbody>';
  $('leitura-bt').innerHTML =
    'As duas últimas colunas olham apenas os clientes regulares, que são os que recebem meta. Mesmo entre eles o erro '+
    'mediano é alto. Fora desse grupo, mês a mês, a projeção errou '+Math.round(BT.mensal.med)+'% na mediana e acertou '+
    'dentro de 30% em apenas '+Math.round(BT.mensal.d30)+'% dos casos. É por isso que a meta individual existe só para a '+
    'lista abaixo e sempre em bloco de três meses, nunca mês a mês.';

  var CONF={boa:['sv-ok','boa'],razoavel:['sv-at','razoável']};
  function tabelaPrev(){
    var f=$('f-conf').value;
    var rows=PV.clientes.filter(function(c){return !f||c.conf===f;});
    $('cont-prev').textContent=rows.length+' clientes · meta somada '+mil(rows.reduce(function(s,c){return s+c.prev;},0));
    $('t-prev').innerHTML=
      '<thead><tr><th>Cliente</th><th>Confiança</th><th class="num">Meta do trimestre</th>'+
      '<th class="num">Faixa já observada</th><th class="num">Resto do mês</th><th class="num">Meses com compra em 12</th></tr></thead><tbody>'+
      rows.map(function(c){var k=CONF[c.conf]||['sv-at',c.conf];
        return '<tr class="cli" data-id="'+esc(c.id)+'">'+
          '<td class="nome">'+esc(c.nome)+'</td>'+
          '<td><span class="selo '+k[0]+'"><i></i>'+k[1]+'</span></td>'+
          '<td class="num mono">'+mil(c.prev)+'</td>'+
          '<td class="num mono" style="color:var(--texto2)">'+mil(c.min)+' a '+mil(c.max)+'</td>'+
          '<td class="num mono">'+mil(c.set_resto)+'</td>'+
          '<td class="num mono">'+c.reg+'</td></tr>';}).join('')+'</tbody>';
    ligarLinhas('t-prev');
  }
  $('f-conf').addEventListener('change',tabelaPrev);
  tabelaPrev();
  $('nota-prev-cli').innerHTML='Meta apenas para os '+PV.clientes.length+
    ' clientes que compraram em pelo menos 7 dos últimos 12 meses, porque só neles o método passou no teste. '+
    'Confiança <b>boa</b> são os que compraram em 10 meses ou mais. A faixa ao lado é o menor e o maior valor que o '+
    'cliente já fez nesses três meses, para você ver se a meta está no meio do costume dele ou apostando num extremo. '+
    'Clientes marcados como perdidos ficam fora.';
})();

/* ── CRM ────────────────────────────────────────────────────────────────── */
function interDe(id){return INTER.filter(function(x){return x.cliente===id;})
  .sort(function(a,b){return String(b.data).localeCompare(String(a.data));});}
function tarefasDe(id){return TAREFAS.filter(function(x){return x.cliente===id;})
  .sort(function(a,b){return (a.feita?1:0)-(b.feita?1:0)||String(a.prazo||'9').localeCompare(String(b.prazo||'9'));});}

function descobertos(){
  var tocados={};
  INTER.forEach(function(i){tocados[i.cliente]=1;});
  TAREFAS.forEach(function(t){tocados[t.cliente]=1;});
  return ACAO.filter(function(c){return !tocados[c.id];})
             .sort(function(a,b){return a.var_ytd_abs-b.var_ytd_abs;});
}

function renderCRM(){
  var abertas=TAREFAS.filter(function(t){return !t.feita;});
  var atrasadas=abertas.filter(function(t){return t.prazo && t.prazo<HOJE;});
  var d30=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  var recentes=INTER.filter(function(i){return i.data>=d30;});
  var vistos={}; recentes.forEach(function(i){vistos[i.cliente]=1;});
  var comUF=C.filter(function(c){return (FICHA[c.id]||{}).estado;});
  var ufs={}; comUF.forEach(function(c){ufs[FICHA[c.id].estado]=1;});
  cartoes('kpis-crm',[
    ['Tarefas em aberto',abertas.length,atrasadas.length?'<span class="desce">'+atrasadas.length+' fora do prazo</span>':'nenhuma fora do prazo'],
    ['Contatos em 30 dias',recentes.length,Object.keys(vistos).length+' clientes tocados'],
    ['Alertas descobertos',descobertos().length,'de '+ACAO.length+' clientes em alerta'],
    ['Cadastro de região',comUF.length+' de '+C.length,comUF.length?Object.keys(ufs).length+' estados':'cidade e estado em branco']
  ]);

  var fila=abertas.slice().sort(function(a,b){return String(a.prazo||'9').localeCompare(String(b.prazo||'9'));});
  $('t-fila').innerHTML=fila.length
    ? '<thead><tr><th>Prazo</th><th>Cliente</th><th>Tarefa</th><th class="num">Receita do cliente</th></tr></thead><tbody>'+
      fila.map(function(t){var c=PORID[t.cliente], atrasada=t.prazo&&t.prazo<HOJE;
        return '<tr class="cli" data-id="'+esc(t.cliente)+'">'+
          '<td class="mono'+(atrasada?' desce':'')+'">'+(t.prazo?dbr(t.prazo):'sem prazo')+'</td>'+
          '<td class="nome">'+esc(c?c.nome:'—')+'</td><td>'+esc(t.titulo)+'</td>'+
          '<td class="num mono">'+(c?mil(c.receita):'—')+'</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">Nenhuma tarefa em aberto. Abra a ficha de um cliente para criar a primeira.</td></tr></tbody>';
  ligarLinhas('t-fila');

  var desc=descobertos();
  $('t-descoberto').innerHTML=desc.length
    ? '<thead><tr><th>Cliente</th><th>Situação</th><th class="num">Diferença no ano</th><th class="num">Sem comprar</th></tr></thead><tbody>'+
      desc.map(function(c){var g=gravidade(c);
        return '<tr class="cli" data-id="'+esc(c.id)+'">'+
          '<td class="nome">'+esc(c.nome)+' <span class="cls cls'+c.classe+'">'+c.classe+'</span></td>'+
          '<td><span class="selo '+g[0]+'"><i></i>'+g[1]+'</span></td>'+
          '<td class="num mono desce">'+mil(c.var_ytd_abs)+'</td>'+
          '<td class="num mono">'+c.recencia+' d</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">'+(ACAO.length?'Todos os clientes em alerta já têm registro no CRM.':'Nenhum cliente em alerta.')+'</td></tr></tbody>';
  ligarLinhas('t-descoberto');

  $('t-inter').innerHTML=INTER.length
    ? '<thead><tr><th>Data</th><th>Cliente</th><th>Tipo</th><th>Resumo</th></tr></thead><tbody>'+
      INTER.slice(0,25).map(function(i){var c=PORID[i.cliente];
        return '<tr class="cli" data-id="'+esc(i.cliente)+'"><td class="mono">'+dbr(i.data)+'</td>'+
          '<td class="nome">'+esc(c?c.nome:'—')+'</td><td>'+esc(i.tipo)+'</td><td>'+esc(i.resumo)+'</td></tr>';}).join('')+'</tbody>'
    : '<tbody><tr><td class="vazio">Nenhum contato registrado ainda.</td></tr></tbody>';
  ligarLinhas('t-inter');

  var porUF={};
  C.forEach(function(c){var uf=(FICHA[c.id]||{}).estado;
    if(uf){porUF[uf]=porUF[uf]||[0,0];porUF[uf][0]+=c.receita;porUF[uf][1]++;}});
  var lista=Object.keys(porUF).map(function(uf){return [uf,uf,porUF[uf][0],
    porUF[uf][1]+(porUF[uf][1]===1?' cliente':' clientes')];})
    .sort(function(a,b){return b[2]-a[2];});
  var semUF=C.filter(function(c){return !(FICHA[c.id]||{}).estado;});
  $('nota-uf').textContent=lista.length
    ? 'Receita do período somada por estado, com o cadastro preenchido até agora. Faltam '+semUF.length+
      ' clientes, que somam '+mil(semUF.reduce(function(s,c){return s+c.receita;},0))+'.'
    : 'Preencha o estado dos clientes para ver a receita distribuída por região. Use o painel de importação na aba Dados.';
  if(lista.length) barrasH($('b-uf'),lista,function(){return 'var(--s1)';});
  else $('b-uf').innerHTML='<p class="vazio">Sem dados de estado ainda.</p>';
}

/* ── tabela de clientes ─────────────────────────────────────────────────── */
var fseg=$('f-seg');
SEGORD.forEach(function(s){ if(C.some(function(c){return c.segmento===s;})){
  var o=document.createElement('option'); o.value=s; o.textContent=SEGNOME[s]; fseg.appendChild(o); }});
var ordCampo='receita', ordDir=-1;
var COLS=[['nome','Cliente',0],['local','Cidade e UF',0],['situacao','Situação',0],['segmento','Segmento',0],
  ['receita','Receita total',1],['compras','Pedidos',1],['ticket','Ticket médio',1],
  ['recencia','Sem comprar',1],['var_ytd_pct','Ano vs média',1],['ultima','Última compra',0]];
function localDe(c){var f=FICHA[c.id]||{};return f.cidade?(f.cidade+(f.estado?' · '+f.estado:'')):(f.estado||'');}
var SITSELO={ativo:['sv-ok','Ativo'],pausado:['sv-at','Pausado'],perdido:['sv-off','Perdido']};

function renderClientes(){
  var q=norm($('q').value), sg=fseg.value, cl=$('f-cls').value, sit=$('f-sit').value;
  var ufSel=$('f-uf');
  var ufs={}; C.forEach(function(c){var u=(FICHA[c.id]||{}).estado; if(u)ufs[u]=1;});
  var lista=Object.keys(ufs).sort();
  if(ufSel.options.length-1!==lista.length){
    var antes=ufSel.value;
    ufSel.innerHTML='<option value="">Todos os estados</option>'+
      lista.map(function(u){return '<option>'+esc(u)+'</option>';}).join('');
    ufSel.value=lista.indexOf(antes)>=0?antes:'';
  }
  var uf=ufSel.value;
  var rows=C.filter(function(c){
    if(q && norm(c.nome).indexOf(q)<0 && !(c.alias||[]).some(function(a){return norm(a).indexOf(q)>=0;})) return false;
    if(sg && c.segmento!==sg) return false;
    if(cl && c.classe!==cl) return false;
    if(uf && (FICHA[c.id]||{}).estado!==uf) return false;
    if(sit && situacaoDe(c)!==sit) return false;
    return true;
  });
  rows.forEach(function(c){c.local=localDe(c);c.situacao=situacaoDe(c);});
  rows.sort(function(a,b){
    var x=a[ordCampo], y=b[ordCampo];
    if(x===null||x===undefined)x=ordDir<0?-Infinity:Infinity;
    if(y===null||y===undefined)y=ordDir<0?-Infinity:Infinity;
    if(typeof x==='string')return ordDir*x.localeCompare(y,'pt-BR');
    return ordDir*(x-y);
  });
  $('cont-cli').textContent=rows.length+' de '+C.length+' clientes · '+
    mil(rows.reduce(function(s,c){return s+c.receita;},0));
  $('t-cli').innerHTML='<thead><tr>'+COLS.map(function(c){
      return '<th class="s'+(c[2]?' num':'')+'" data-k="'+c[0]+'">'+c[1]+
        (ordCampo===c[0]?(ordDir<0?' ↓':' ↑'):'')+'</th>';}).join('')+'</tr></thead><tbody>'+
    rows.map(function(c){var ss=SITSELO[c.situacao]||SITSELO.ativo;
      return '<tr class="cli" data-id="'+esc(c.id)+'">'+
      '<td class="nome">'+esc(c.nome)+' <span class="cls cls'+c.classe+'">'+c.classe+'</span></td>'+
      '<td>'+(c.local?esc(c.local):'<span style="color:var(--texto3)">—</span>')+'</td>'+
      '<td><span class="selo '+ss[0]+'"><i></i>'+ss[1]+'</span></td>'+
      '<td>'+SEGNOME[c.segmento]+'</td>'+
      '<td class="num mono">'+mil(c.receita)+'</td>'+
      '<td class="num mono">'+num(c.compras)+'</td>'+
      '<td class="num mono">'+mil(c.ticket)+'</td>'+
      '<td class="num mono">'+c.recencia+' d</td>'+
      '<td class="num mono '+(c.var_ytd_pct===null?'':(c.var_ytd_pct>0?'sobe':'desce'))+'">'+
        (c.var_ytd_pct===null?'—':pct(c.var_ytd_pct))+'</td>'+
      '<td class="mono">'+dbr(c.ultima)+'</td></tr>';}).join('')+'</tbody>';
  $('t-cli').querySelectorAll('th.s').forEach(function(th){
    th.addEventListener('click',function(){
      var k=th.dataset.k;
      if(ordCampo===k) ordDir*=-1;
      else { ordCampo=k; ordDir=(k==='nome'||k==='segmento'||k==='ultima'||k==='local'||k==='situacao')?1:-1; }
      renderClientes();
    });
  });
  ligarLinhas('t-cli');
}
['q','f-cls','f-uf','f-sit'].forEach(function(id){$(id).addEventListener('input',renderClientes);});
fseg.addEventListener('change',renderClientes);

function ligarLinhas(id){
  var t=$(id); if(!t)return;
  t.querySelectorAll('tr[data-id]').forEach(function(tr){
    tr.addEventListener('click',function(){abrirFicha(tr.dataset.id);});
  });
}

/* ── comunicação com o servidor ─────────────────────────────────────────── */
function erroDe(e){
  if(e && e.erro) return e.erro;
  return 'Não foi possível gravar. Verifique a conexão e tente de novo.';
}
function enviar(url, corpo, metodo){
  return fetch(url,{method:metodo||'POST',headers:{'Content-Type':'application/json'},
    body: corpo?JSON.stringify(corpo):undefined})
    .then(function(r){
      if(r.status===401 || r.redirected) throw {erro:'Sua sessão expirou. Recarregue a página e entre de novo.'};
      return r.json().catch(function(){throw {erro:'Resposta inesperada do servidor.'};});
    })
    .then(function(j){ if(!j.success) throw j; return j; });
}
function avisar(host, texto, tipo){
  var n=$(host); if(!n)return;
  n.innerHTML='<div class="faixa '+(tipo||'')+'" style="margin:12px 0 0">'+texto+'</div>';
}

/* ── ficha do cliente ───────────────────────────────────────────────────── */
var gaveta=$('gaveta'), folha=$('folha'), fichaAtual=null;
function abrirFicha(id){
  var c=PORID[id]; if(!c)return;
  fichaAtual=id;
  var f=FICHA[id]||{}, logs=interDe(id), tks=tarefasDe(id);
  var mx=Math.max.apply(null,c.mensal)||1;
  var ind=c.mensal.map(function(v,i){
    var h=Math.max(2,v/mx*46);
    return '<div><div title="'+MES[i]+': '+brl(v)+'" style="width:76%;height:'+h+'px;background:'+
      (v?'var(--s1)':'#e9e5ff')+';border-radius:3px 3px 0 0"></div><span>'+MES[i][0].toUpperCase()+'</span></div>';
  }).join('');
  var g=gravidade(c), emAlerta=ACAO.indexOf(c)>=0;
  var sit=situacaoDe(c);
  var ss=SITSELO[sit]||SITSELO.ativo;

  folha.innerHTML=
    '<div class="folha-topo"><div><h3>'+esc(c.nome)+'</h3>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'+
      '<span class="cls cls'+c.classe+'">Classe '+c.classe+'</span>'+
      '<span class="selo sv-off"><i style="background:'+SEGCOR[c.segmento]+'"></i>'+SEGNOME[c.segmento]+'</span>'+
      '<span class="selo sv-off"><i></i>'+esc(c.perfil)+'</span>'+
      '<span class="selo '+ss[0]+'"><i></i>'+ss[1]+'</span>'+
      (emAlerta?'<span class="selo '+g[0]+'"><i></i>'+g[1]+'</span>':'')+'</div>'+
      (c.alias&&c.alias.length?'<p class="nota" style="margin:8px 0 0;font-size:.74rem">Unificado a partir de: '+
        esc(c.alias.join(', '))+'</p>':'')+
    '</div><button class="bt sm" id="fechar">Fechar</button></div>'+

    '<h4>Situação e motivo</h4>'+
    '<div class="campos">'+
      '<div class="campo"><label for="f-situacao">Situação<span class="salvo" id="salvo">salvo</span></label>'+
        '<select id="f-situacao">'+
          ['ativo','pausado','perdido'].map(function(s){
            return '<option value="'+s+'"'+(sit===s?' selected':'')+'>'+SITSELO[s][1]+'</option>';}).join('')+
        '</select></div>'+
      '<div class="campo"><label for="f-motivo-tipo">Motivo</label><select id="f-motivo-tipo">'+
        '<option value="">Não informado</option>'+
        MOTIVOS.map(function(m){return '<option value="'+esc(m[0])+'"'+
          (f.motivo_tipo===m[0]?' selected':'')+'>'+esc(m[1])+'</option>';}).join('')+
        '</select></div>'+
    '</div>'+
    '<div class="campo" style="margin-top:10px"><label for="f-motivo">Detalhe do motivo</label>'+
      '<input type="text" id="f-motivo" maxlength="500" placeholder="Ex.: o dono faleceu em março, a família encerrou a loja" value="'+esc(f.motivo||'')+'"></div>'+
    '<p class="nota" style="margin-top:8px;font-size:.75rem">Marcar como <b>perdido</b> tira o cliente da fila de trabalho e da projeção, mas mantém todo o histórico.</p>'+

    '<h4>Cadastro</h4>'+
    '<div class="campos">'+
      '<div class="campo"><label for="f-cidade">Cidade</label><input type="text" id="f-cidade" value="'+esc(f.cidade||'')+'"></div>'+
      '<div class="campo"><label for="f-estado">Estado</label><input type="text" id="f-estado" maxlength="2" value="'+esc(f.estado||'')+'"></div>'+
    '</div>'+
    '<div class="campo" style="margin-top:10px"><label for="f-obs">Observações</label>'+
      '<textarea id="f-obs" rows="2">'+esc(f.obs||'')+'</textarea></div>'+
    '<div id="erro-ficha"></div>'+

    '<h4>Tarefas</h4>'+
    (tks.length?tks.map(function(t){
      var atrasada=!t.feita&&t.prazo&&t.prazo<HOJE;
      return '<div class="tsk'+(t.feita?' feita':'')+'">'+
        '<input type="checkbox" data-tk="'+esc(t.id)+'"'+(t.feita?' checked':'')+' aria-label="Concluir tarefa">'+
        '<span class="tt">'+esc(t.titulo)+'</span>'+
        '<span class="pz'+(atrasada?' atrasada':'')+'">'+(t.prazo?dbr(t.prazo):'sem prazo')+'</span>'+
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
      ANOS.map(function(a){return tr('1/jan a '+dbr(M.ref).slice(0,5)+' de '+a, mil(c.ytd_anos[a]||0));}).join('')+
      tr('<b>Média dos anos anteriores</b>', '<b>'+mil(c.ytd_base)+'</b>')+
      tr('Diferença de '+ANO_REF+' contra a média',
        '<span class="'+(c.var_ytd_abs>0?'sobe':'desce')+'">'+mil(c.var_ytd_abs)+
        (c.var_ytd_pct===null?'':' · '+pct(c.var_ytd_pct))+'</span>')+
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

  var scroll = gaveta.hidden ? 0 : folha.scrollTop;
  gaveta.hidden=false;
  ligarFicha(c);
  folha.scrollTop=scroll;
}
function fato(l,v){return '<div class="fato"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>';}
function tr(a,b){return '<tr><td style="color:var(--texto2)">'+a+'</td><td class="num mono">'+b+'</td></tr>';}

function ligarFicha(c){
  $('fechar').addEventListener('click',fecharFicha);
  var campos=['f-situacao','f-motivo-tipo','f-motivo','f-cidade','f-estado','f-obs'];
  var timer=null;
  function salvar(){
    clearTimeout(timer);
    timer=setTimeout(function(){
      var corpo={cliente_id:c.id,cliente_nome:c.nome,
        situacao:$('f-situacao').value, motivo_tipo:$('f-motivo-tipo').value,
        motivo:$('f-motivo').value.trim(), cidade:$('f-cidade').value.trim(),
        estado:$('f-estado').value.trim().toUpperCase().slice(0,2), obs:$('f-obs').value.trim()};
      var at=FICHA[c.id]||{};
      var igual=['situacao','motivo_tipo','motivo','cidade','estado','obs'].every(function(k){
        return corpo[k]===(at[k]||(k==='situacao'?'ativo':''));});
      if(igual)return;
      enviar('/admin/carteira/ficha',corpo).then(function(){
        FICHA[c.id]=corpo;
        var s=$('salvo'); if(s){s.classList.add('on');setTimeout(function(){s.classList.remove('on');},1400);}
        // mudar a situação muda quem está na fila: recarrega para recalcular
        if(corpo.situacao!==(at.situacao||'ativo')) setTimeout(function(){location.reload();},700);
        else { renderCRM(); renderClientes(); tabelaEncerrados(); tabelaAcao(); }
      }).catch(function(e){ avisar('erro-ficha',esc(erroDe(e)),'erro'); });
    },600);
  }
  campos.forEach(function(id){var n=$(id); if(n){n.addEventListener('input',salvar);n.addEventListener('change',salvar);}});

  $('tk-add').addEventListener('click',function(){
    var titulo=$('tk-titulo').value.trim();
    if(!titulo){$('tk-titulo').focus();return;}
    var b=this; b.disabled=true;
    enviar('/admin/carteira/tarefa',{cliente_id:c.id,titulo:titulo,prazo:$('tk-prazo').value||null})
      .then(function(j){
        TAREFAS.push({id:j.id,cliente:c.id,titulo:titulo,prazo:$('tk-prazo').value||'',feita:false});
        renderCRM(); abrirFicha(c.id);
      }).catch(function(e){ b.disabled=false; avisar('erro-ficha',esc(erroDe(e)),'erro'); });
  });
  $('in-add').addEventListener('click',function(){
    var resumo=$('in-resumo').value.trim();
    if(!resumo){$('in-resumo').focus();return;}
    var b=this; b.disabled=true;
    var data=$('in-data').value||HOJE, tipo=$('in-tipo').value;
    enviar('/admin/carteira/interacao',{cliente_id:c.id,data:data,tipo:tipo,resumo:resumo})
      .then(function(j){
        INTER.unshift({id:j.id,cliente:c.id,data:data,tipo:tipo,resumo:resumo});
        renderCRM(); abrirFicha(c.id);
      }).catch(function(e){ b.disabled=false; avisar('erro-ficha',esc(erroDe(e)),'erro'); });
  });
  folha.querySelectorAll('[data-tk]').forEach(function(n){
    n.addEventListener('change',function(){
      enviar('/admin/carteira/tarefa/'+n.dataset.tk,{feita:n.checked})
        .then(function(){
          TAREFAS.forEach(function(t){ if(t.id===n.dataset.tk) t.feita=n.checked; });
          renderCRM(); abrirFicha(c.id);
        }).catch(function(e){ n.checked=!n.checked; avisar('erro-ficha',esc(erroDe(e)),'erro'); });
    });
  });
  folha.querySelectorAll('[data-tkdel]').forEach(function(n){
    n.addEventListener('click',function(){
      n.disabled=true;
      enviar('/admin/carteira/tarefa/'+n.dataset.tkdel,null,'DELETE').then(function(){
        TAREFAS=TAREFAS.filter(function(t){return t.id!==n.dataset.tkdel;});
        renderCRM(); abrirFicha(c.id);
      }).catch(function(e){ n.disabled=false; avisar('erro-ficha',esc(erroDe(e)),'erro'); });
    });
  });
  folha.querySelectorAll('[data-indel]').forEach(function(n){
    n.addEventListener('click',function(){
      n.disabled=true;
      enviar('/admin/carteira/interacao/'+n.dataset.indel,null,'DELETE').then(function(){
        INTER=INTER.filter(function(i){return i.id!==n.dataset.indel;});
        renderCRM(); abrirFicha(c.id);
      }).catch(function(e){ n.disabled=false; avisar('erro-ficha',esc(erroDe(e)),'erro'); });
    });
  });
}
function fecharFicha(){gaveta.hidden=true;fichaAtual=null;dica.style.opacity='0';}
gaveta.addEventListener('click',function(e){if(e.target===gaveta)fecharFicha();});
addEventListener('keydown',function(e){if(e.key==='Escape'&&!gaveta.hidden)fecharFicha();});

/* ── aba Dados ──────────────────────────────────────────────────────────── */
function montarDados(){
  var form=$('form-upload');
  if(form) form.addEventListener('submit',function(e){
    e.preventDefault();
    var arq=$('arquivo').files[0];
    if(!arq){avisar('res-upload','Escolha um arquivo primeiro.','erro');return;}
    var b=$('bt-upload'); b.disabled=true; b.textContent='Enviando…';
    var fd=new FormData(); fd.append('arquivo',arq);
    fetch('/admin/carteira/upload',{method:'POST',body:fd})
      .then(function(r){return r.json().catch(function(){throw {erro:'Resposta inesperada do servidor.'};});})
      .then(function(j){
        if(!j.success) throw j;
        avisar('res-upload','<b>'+num(j.linhas)+' linhas gravadas</b>, no lugar das '+num(j.antes)+
          ' que havia antes.'+(j.ignoradas?' '+j.ignoradas+' linhas foram ignoradas: '+
          esc((j.detalhes||[]).join('; ')):'')+' Recarregando o painel…','ok');
        setTimeout(function(){location.reload();},1600);
      })
      .catch(function(e){
        b.disabled=false; b.textContent='Enviar e recalcular';
        avisar('res-upload','<b>Não deu certo.</b> '+esc(erroDe(e))+
          ((e&&e.detalhes&&e.detalhes.length)?'<br>'+esc(e.detalhes.join('; ')):''),'erro');
      });
  });

  var cand=$('candidatos');
  if(cand) cand.innerHTML = (CANDIDATOS && CANDIDATOS.length)
    ? CANDIDATOS.map(function(g){
        return '<div class="cartao" style="margin-bottom:10px"><p class="nota" style="margin-bottom:8px">'+
          esc(g.motivo)+'</p><div class="tabwrap"><table style="min-width:0"><tbody>'+
          g.clientes.map(function(x){return '<tr><td class="nome">'+esc(x.nome)+'</td>'+
            '<td class="num mono">'+mil(x.receita)+'</td><td class="num mono">'+x.compras+' pedidos</td>'+
            '<td class="num mono">'+dbr(x.ultima)+'</td></tr>';}).join('')+
          '</tbody></table></div><div style="margin-top:10px">'+
          '<button class="bt p sm" data-de="'+esc(g.clientes[1].nome)+'" data-para="'+esc(g.clientes[0].nome)+
          '">Unificar em '+esc(g.clientes[0].nome)+'</button></div></div>';
      }).join('')
    : '<p class="vazio">Nenhum par suspeito encontrado.</p>';

  if(cand) cand.querySelectorAll('[data-de]').forEach(function(b){
    b.addEventListener('click',function(){ unificar(b.dataset.de, b.dataset.para, b); });
  });

  if (typeof C !== 'undefined' && C) {
    var opcoes = C.map(function(c){return '<option value="'+esc(c.nome)+'">'+esc(c.nome)+'</option>';}).join('');
    $('al-de').innerHTML='<option value="">Escolha…</option>'+opcoes;
    $('al-para').innerHTML='<option value="">Escolha…</option>'+opcoes;
    $('bt-alias').addEventListener('click',function(){
      unificar($('al-de').value,$('al-para').value,this);
    });
    var chaves=Object.keys(ALIASES);
    $('lista-alias').innerHTML = chaves.length
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
          .catch(function(e){b.disabled=false;alert(erroDe(e));});
      });
    });

    montarLote();
  }
}
function unificar(de,para,botao){
  if(!de||!para||de===para){alert('Escolha dois nomes diferentes.');return;}
  botao.disabled=true; botao.textContent='Unificando…';
  enviar('/admin/carteira/alias',{apelido:de,canonico:para})
    .then(function(){location.reload();})
    .catch(function(e){botao.disabled=false;botao.textContent='Unificar';alert(erroDe(e));});
}

var pendentes=null;
function montarLote(){
  $('bt-copiar').addEventListener('click',function(){
    var txt=C.map(function(c){return c.nome+';;';}).join('\n');
    var b=this;
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(function(){b.textContent='Lista copiada';})
        .catch(function(){$('txt-lote').value=txt;b.textContent='Lista colada abaixo';});
    } else { $('txt-lote').value=txt; b.textContent='Lista colada abaixo'; }
    setTimeout(function(){b.textContent='Copiar a lista de clientes';},2500);
  });
  $('bt-conferir').addEventListener('click',function(){
    var linhas=$('txt-lote').value.split('\n').map(function(l){return l.trim();}).filter(Boolean);
    var ok=[],ruim=[];
    linhas.forEach(function(l){
      var p=l.split(';').map(function(x){return x.trim();});
      var c=PORNOME[norm(p[0]||'')];
      if(!c){ruim.push(p[0]||l);return;}
      if(!p[1]&&!p[2])return;
      ok.push({cliente_id:c.id,cliente_nome:c.nome,cidade:p[1]||'',estado:(p[2]||'').toUpperCase().slice(0,2)});
    });
    pendentes=ok;
    $('bt-gravar').disabled=!ok.length;
    $('res-lote').innerHTML='<p class="nota" style="margin:12px 0 0">'+ok.length+' linha(s) prontas'+
      (ruim.length?', '+ruim.length+' sem cliente correspondente: '+esc(ruim.slice(0,6).join(', '))+
        (ruim.length>6?'…':''):'')+'.</p>'+
      (ok.length?'<div class="tabwrap" style="margin-top:10px"><table style="min-width:0"><thead><tr>'+
        '<th>Cliente</th><th>Cidade</th><th>UF</th></tr></thead><tbody>'+
        ok.slice(0,12).map(function(r){return '<tr><td class="nome">'+esc(r.cliente_nome)+'</td>'+
          '<td>'+esc(r.cidade)+'</td><td class="mono">'+esc(r.estado)+'</td></tr>';}).join('')+
        '</tbody></table></div>'+(ok.length>12?'<p class="nota" style="margin-top:6px">Mostrando as 12 primeiras.</p>':''):'');
  });
  $('bt-gravar').addEventListener('click',function(){
    if(!pendentes||!pendentes.length)return;
    var b=this; b.disabled=true; b.textContent='Gravando…';
    enviar('/admin/carteira/fichas-lote',{itens:pendentes})
      .then(function(j){
        pendentes.forEach(function(r){
          FICHA[r.cliente_id]=Object.assign(FICHA[r.cliente_id]||{},{cidade:r.cidade,estado:r.estado});});
        pendentes=null; b.textContent='Gravar';
        $('res-lote').insertAdjacentHTML('beforeend',
          '<div class="faixa ok" style="margin-top:10px"><b>'+j.gravados+' cliente(s) atualizados.</b></div>');
        renderCRM(); renderClientes();
      })
      .catch(function(e){ b.disabled=false; b.textContent='Gravar';
        $('res-lote').insertAdjacentHTML('beforeend',
          '<div class="faixa erro" style="margin-top:10px">'+esc(erroDe(e))+'</div>'); });
  });
}

/* ── abas ───────────────────────────────────────────────────────────────── */
var PAINEIS=['geral','carteira','segmentos','acao','prev','crm','clientes','dados'];
function irPara(p){
  PAINEIS.forEach(function(x){var n=$('p-'+x); if(n) n.hidden=(x!==p);});
  document.querySelectorAll('.aba').forEach(function(t){
    t.setAttribute('aria-selected',String(t.dataset.p===p));});
  scrollTo({top:0,behavior:'instant'});
}
document.querySelectorAll('.aba').forEach(function(t){
  t.addEventListener('click',function(){irPara(t.dataset.p);});});

/* ── primeira renderização ──────────────────────────────────────────────── */
tabelaAcao(); tabelaEncerrados(); tabelaAlta(); renderCRM(); renderClientes(); montarDados();
})();
