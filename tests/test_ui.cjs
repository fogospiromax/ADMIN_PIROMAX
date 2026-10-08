const fs=require('node:fs');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const initial=JSON.parse(execFileSync(process.env.PYTHON || 'python3',[path.join(__dirname,'fixture_crm.py')],{encoding:'utf8'}));
const template=fs.readFileSync(root+'/templates/admin_carteira.html','utf8');
const source=fs.readFileSync(root+'/static/carteira.js','utf8').replace(/\}\)\(\);\s*$/,`window.testCRM={abrirFicha,fecharFicha,gravarContato,salvarFicha,camposAlterados,agendaItens,listaRegistros,estado,gravar,indexar,abrirNovoLead};})();`);
let passed=0;
function boot(){
 const errors=[],calls=[],data=structuredClone(initial);
 const vendas=[{id:7,data:'2026-09-24',cliente:'CLIENTE FICTÍCIO',cliente_exibicao:'CLIENTE FICTÍCIO',
   valor:2726.60,cancelado_em:null,cancelado_por:null,cancelado_motivo:null,eventos:[]}];
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const html=template.replace('data-usuario="{{ usuario_id }}"','data-usuario="fernando"');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost/admin/carteira',virtualConsole:vc});
 const w=dom.window;
 Object.assign(w,{D:data.dados,FICHA:data.fichas,INTER:data.inter,TAREFAS:data.tarefas,ALIASES:data.aliases,CANDIDATOS:data.candidatos,PROSPEC:data.prospec,PESSOAL:data.pessoal,REGIOES:data.regioes,ETAPAS:data.etapas,HOJE:data.hoje});
 w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.requestAnimationFrame=fn=>fn();w.confirm=()=>false;
 w.fetch=async(url,opt={})=>{
  const body=opt.body?JSON.parse(opt.body):{};calls.push({url,body});
  if(url.startsWith('/admin/carteira/vendas?')){
   const params=new URL(url,'http://localhost').searchParams;
   const found=vendas.filter(v=>(!params.get('busca')||v.cliente.includes(params.get('busca').toUpperCase()))
     &&(!params.get('data')||v.data===params.get('data'))
     &&(params.get('situacao')==='todas'||(params.get('situacao')==='canceladas'?!!v.cancelado_em:!v.cancelado_em)));
   return {json:async()=>({success:true,total:found.length,limite:60,notas:structuredClone(found)})};
  }
  if(url.startsWith('/admin/carteira/vendas/')){
   const v=vendas.find(x=>x.id===Number(url.split('/')[4]));
   if(url.endsWith('/cancelar')){v.cancelado_em='2026-09-24T12:00:00';v.cancelado_por='fernando';v.cancelado_motivo=body.motivo;}
   if(url.endsWith('/restaurar')){v.cancelado_em=null;v.cancelado_por=null;v.cancelado_motivo=null;}
   return {json:async()=>({success:true})};
  }
  if(url.startsWith('/admin/carteira/comunicacoes?'))return {json:async()=>({success:true,registros:data.comunicacoes||[]})};
  if(url==='/admin/carteira/comunicacoes'&&opt.method==='POST'){
   (data.comunicacoes||(data.comunicacoes=[])).unshift({id:'cm-'+(data.comunicacoes.length+1),cliente_id:body.cliente_id,data:data.hoje,usuario_id:'fernando',assunto:body.assunto||'',canal:'whatsapp'});
   return {json:async()=>({success:true})};
  }
  if(url.endsWith('/desfazer')){
   data.comunicacoes=(data.comunicacoes||[]).filter(x=>!url.includes(x.id));
   return {json:async()=>({success:true})};
  }
  if(url.endsWith('/pedidos'))return {json:async()=>({success:true,pedidos:[{data:'2026-09-20',valor:300,registros:2,valores:[100,200]},{data:'2026-08-01',valor:50,registros:1,valores:[50]}]})};
  if(url==='/admin/carteira/dados')return {json:async()=>structuredClone(data)};
  if(url==='/admin/carteira/contato')data.inter.unshift({id:'new',cliente:body.cliente_id,resumo:body.resumo,resultado:body.resultado,data:data.hoje,tipo:'contato'});
  if(url==='/admin/carteira/lead'){
   const lead=data.prospec.leads.find(l=>l.id===body.id);
   if(lead){Object.assign(lead,body);if(body.confirmar_etapa||body.etapa)lead.etapa_origem='';if(body.resolver_pendencias){lead.proximo='';lead.proximo_em='';}}
   if(body.resolver_pendencias==='cancelar')data.tarefas.filter(t=>t.cliente===body.id&&!t.feita).forEach(t=>t.cancelada=true);
  }
  if(url==='/admin/carteira/ficha'){Object.assign(data.dados.clientes.find(c=>c.id===body.cliente_id),body);}
  if(url.startsWith('/admin/carteira/tarefa/')){Object.assign(data.tarefas.find(t=>t.id===url.split('/').at(-1)),{feita:body.feita,concluido_em:body.feita?data.hoje:''});}
  return {json:async()=>({success:true})};
 };
 w.eval(source);
 return {w,doc:w.document,api:w.testCRM,calls,data,errors,close:()=>w.close()};
}
const fill=(c,id,value)=>{const el=c.doc.getElementById(id);assert.ok(el,id+' exists');el.value=value;el.dispatchEvent(new c.w.Event('input',{bubbles:true}));};
const settle=()=>new Promise(r=>setTimeout(r,20));
async function test(name,fn){let c=boot();try{await fn(c);await settle();assert.deepEqual(c.errors,[]);passed++;console.log('OK '+name);}finally{await settle();c.close();}}
(async()=>{
 await test('All screens render and agenda combines tasks with lead returns',c=>{
  assert.equal(c.api.agendaItens().length,4);
  assert.ok(!c.doc.getElementById('h-agenda').textContent.includes('Tarefa exclusiva de Flávia'));
  for(const id of ['h-agenda','r-corpo','cm-resumo','pr-corpo','a-corpo','d-corpo'])assert.ok(c.doc.getElementById(id).innerHTML.length>20,id);
  assert.ok(!c.doc.getElementById('h-sub').textContent.includes('em jogo'));
 });
 await test('Client variation is visible beside trend and both PDF reports are available',c=>{
  const headers=[...c.doc.querySelectorAll('#r-tab thead th')].map(th=>th.textContent.trim());
  assert.equal(headers[headers.indexOf('Tendência')+1],'Variação no ano');
  assert.ok(c.doc.querySelector('#r-tab tbody .variacao-ano'));
  assert.equal(c.doc.querySelectorAll('.relatorios-pdf a[href$=".pdf"]').length,2);
 });
 await test('Navigation has labelled panels and keeps keyboard focus',c=>{
  const tabs=Array.from(c.doc.querySelectorAll('#abas [role="tab"]'));
  assert.equal(tabs.length,6);
  for(const tab of tabs){
   assert.equal(c.doc.getElementById(tab.getAttribute('aria-controls')).getAttribute('aria-labelledby'),tab.id);
   assert.ok(tab.querySelector('svg[aria-hidden="true"]'));
  }
  tabs[1].click();
  assert.equal(c.api.estado.tela,'registros');
  assert.equal(c.doc.activeElement.id,'aba-registros');
  c.doc.activeElement.dispatchEvent(new c.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(c.doc.activeElement.id,'aba-comunicacoes');
 });
 await test('Communication tab records individual messages without changing sales contacts',async c=>{
  const id=c.data.dados.clientes[0].id;
  c.doc.getElementById('aba-comunicacoes').click();await settle();
  assert.ok(c.doc.getElementById('cm-lista').textContent.includes('0/2'));
  fill(c,'cm-assunto','Comunicado fictício');
  c.doc.querySelector('[data-cm-enviar="'+id+'"]').click();await settle();
  assert.equal(c.calls.filter(x=>x.url==='/admin/carteira/comunicacoes'&&x.body.cliente_id===id).length,1);
  assert.ok(c.doc.getElementById('cm-lista').textContent.includes('1/2'));
  assert.equal(c.data.inter.length,1);
  c.w.confirm=()=>true;
  c.doc.querySelector('[data-cm-desfazer]').click();await settle();
  assert.ok(c.doc.getElementById('cm-lista').textContent.includes('0/2'));
 });
 await test('Sales correction can be found, cancelled with reason, and restored in Dados',async c=>{
  c.doc.getElementById('aba-dados').click();await settle();
  assert.match(c.doc.getElementById('vd-lista').textContent,/2\.726,60/);
  fill(c,'vd-busca','Cliente');fill(c,'vd-data','2026-09-24');
  c.doc.getElementById('vd-filtros').dispatchEvent(new c.w.Event('submit',{bubbles:true,cancelable:true}));await settle();
  const form=c.doc.querySelector('.vd-cancelar');
  form.elements.motivo.value='Cancelada no ERP';
  form.dispatchEvent(new c.w.Event('submit',{bubbles:true,cancelable:true}));await settle();
  assert.ok(c.calls.some(x=>x.url==='/admin/carteira/vendas/7/cancelar'&&x.body.motivo==='Cancelada no ERP'));
  c.doc.getElementById('vd-situacao').value='canceladas';
  c.doc.getElementById('vd-filtros').dispatchEvent(new c.w.Event('submit',{bubbles:true,cancelable:true}));await settle();
  assert.match(c.doc.getElementById('vd-lista').textContent,/Cancelada no ERP/);
  c.doc.querySelector('[data-vd-restaurar="7"]').click();await settle();
  assert.ok(c.calls.some(x=>x.url==='/admin/carteira/vendas/7/restaurar'));
 });
 await test('Saving contact clears only submitted fields and preserves another draft',async c=>{
  const id=c.data.dados.clientes[0].id;c.api.abrirFicha(id,'cliente');
  fill(c,'fc-nota','Conversa fictícia');fill(c,'fc-motivo','Rascunho que deve sobreviver');
  await c.api.gravarContato(id);
  assert.equal(c.doc.getElementById('fc-nota').value,'');
  assert.equal(c.doc.getElementById('fc-motivo').value,'Rascunho que deve sobreviver');
  assert.equal(c.doc.getElementById('f-status').textContent,'Alterações não salvas');
  assert.equal(c.calls.filter(x=>x.url==='/admin/carteira/contato').length,1);
 });
 await test('Failed save keeps draft and allows retry',async c=>{
  const id=c.data.dados.clientes[0].id;c.api.abrirFicha(id,'cliente');fill(c,'fc-nota','Não perder texto');
  const original=c.w.fetch;c.w.fetch=async()=>{throw new Error('offline');};
  await c.api.gravarContato(id);assert.equal(c.doc.getElementById('fc-nota').value,'Não perder texto');
  c.w.fetch=original;await c.api.gravarContato(id);assert.equal(c.doc.getElementById('fc-nota').value,'');
 });
 await test('Typing during a save is preserved and double click does not resubmit',async c=>{
  const id=c.data.dados.clientes[0].id;c.api.abrirFicha(id,'cliente');fill(c,'fc-nota','Primeira versão');
  let release;const original=c.w.fetch;
  c.w.fetch=(url,opt)=>url==='/admin/carteira/contato'?new Promise(resolve=>{release=()=>resolve({json:async()=>({success:true})});}):original(url,opt);
  const request=c.api.gravarContato(id);fill(c,'fc-nota','Texto digitado durante envio');c.api.gravarContato(id);
  release();await request;assert.equal(c.doc.getElementById('fc-nota').value,'Texto digitado durante envio');
 });
 await test('Closing an unsaved drawer asks and respects cancellation',c=>{
  c.api.abrirFicha(c.data.dados.clientes[0].id,'cliente');fill(c,'fc-nota','Rascunho');let confirms=0;c.w.confirm=()=>{confirms++;return false;};
  assert.equal(c.api.fecharFicha(),false);assert.equal(confirms,1);assert.equal(c.doc.getElementById('fc-nota').value,'Rascunho');
  c.w.confirm=()=>true;assert.equal(c.api.fecharFicha(),true);assert.equal(c.doc.getElementById('tela').innerHTML,'');
 });
 await test('Mouse closes drawer without leaving focus outline on prior customer',c=>{
  const row=c.doc.querySelector('#r-tab tr[data-id]');
  assert.ok(row);
  row.focus();row.click();
  c.doc.getElementById('fx').dispatchEvent(new c.w.Event('pointerdown',{bubbles:true}));
  c.doc.getElementById('fx').click();
  assert.notEqual(c.doc.activeElement,row);
 });
 await test('No-answer attempt needs next action and date',async c=>{
  const id=c.data.dados.clientes[0].id;c.api.abrirFicha(id,'cliente');fill(c,'fc-nota','Tentativa fictícia');fill(c,'fc-resultado','sem_resposta');
  await c.api.gravarContato(id);assert.equal(c.calls.filter(x=>x.url==='/admin/carteira/contato').length,0);
  fill(c,'fc-proximo','Tentar novamente');fill(c,'fc-prazo','2026-09-24');await c.api.gravarContato(id);
  const contact=c.calls.find(x=>x.url==='/admin/carteira/contato');
  assert.equal(contact.body.resultado,'sem_resposta');assert.equal(contact.body.proximo_em,'2026-09-24');
 });
 await test('Client since sorts on the first purchase instead of recency',c=>{
  c.data.dados.clientes[0].primeira='2024-01-01';c.data.dados.clientes[1].primeira='2025-01-01';c.data.dados.clientes[2].primeira='2023-01-01';
  c.api.estado.ord='primeira';c.api.estado.asc=true;
  assert.deepEqual(Array.from(c.api.listaRegistros(),x=>x.primeira),['2023-01-01','2024-01-01','2025-01-01']);
 });
 await test('Task completion updates completed count and can be reopened',async c=>{
  c.doc.querySelector('[data-tarefa="t1"]').click();await settle();
  c.doc.querySelector('[data-agenda="feitos"]').click();
  assert.ok(c.doc.querySelector('[data-tarefa="t1"][data-feita="false"]'));
  c.doc.querySelector('[data-tarefa="t1"]').click();await settle();
  assert.equal(c.api.agendaItens().find(t=>t.id==='t1').feita,false);
 });
 await test('Lead has its own history and an optional reseller source',c=>{
  c.api.abrirFicha('lead-exemplo','lead');assert.ok(c.doc.getElementById('fc-nota'));
  assert.ok(c.doc.getElementById('fl-revenda'));assert.ok(c.doc.getElementById('fl-revde'));
  assert.equal(c.doc.getElementById('fl-cliente'),null);
  assert.ok(c.doc.querySelector('[data-a="lead-remover"]'));
 });
 await test('Funnel shows only open stages and moves a lead without opening its full cadastro',async c=>{
  assert.equal(c.doc.querySelectorAll('#pr-corpo .funil .col').length,4);
  c.api.abrirFicha('lead-exemplo','lead');
  assert.ok(c.doc.querySelector('.lead-fluxo #fl-etapa-rapida'));
  assert.equal(c.doc.querySelector('.cadastro-detalhes').open,false);
  const sel=c.doc.getElementById('fl-etapa-rapida');sel.value='tentando';
  sel.dispatchEvent(new c.w.Event('change',{bubbles:true}));await settle();
  const change=c.calls.find(x=>x.url==='/admin/carteira/lead'&&x.body.etapa==='tentando');
  assert.deepEqual(change.body,{id:'lead-exemplo',etapa:'tentando'});
 });
 await test('Large funnel shows a readable sample and opens the complete filtered list',c=>{
  const source=c.data.prospec.leads.find(x=>x.etapa==='novo');
  assert.ok(source);
  for(let i=0;i<20;i++)c.data.prospec.leads.push({...source,id:'volume-'+i,nome:'Empresa fictícia '+i,etapa_origem:''});
  c.doc.getElementById('pr-modo').click();
  c.doc.getElementById('pr-modo').click();
  const column=c.doc.querySelector('#pr-corpo .funil .col');
  assert.equal(column.querySelectorAll('.lead-item').length,8);
  const all=column.querySelector('[data-pr-etapa-list="novo"]');
  assert.ok(all);
  all.click();
  assert.equal(c.api.estado.prView,'lista');
  assert.equal(c.doc.getElementById('pr-etapa').value,'novo');
  assert.ok(c.doc.querySelectorAll('#pr-tab tr[data-l]').length>8);
  assert.deepEqual([...c.doc.querySelectorAll('#pr-tab thead th')].slice(1,4).map(th=>th.textContent),
    ['Empresa / responsável','Etapa','Próximo passo']);
  assert.ok(c.doc.querySelector('#pr-tab tr[data-l] .nm .celula-sub'));
 });
 await test('Ambiguous imported lead stays in review until its stage is confirmed',async c=>{
  assert.match(c.doc.querySelector('[data-l="lead-sem-acao"]').textContent,/Revisar etapa importada/);
  c.api.abrirFicha('lead-sem-acao','lead');
  assert.match(c.doc.querySelector('.lead-importacao-alerta').textContent,/Cliente/);
  c.doc.querySelector('[data-a="lead-confirmar-etapa"]').click();await settle();
  assert.ok(c.calls.some(x=>x.url==='/admin/carteira/lead'&&x.body.confirmar_etapa));
  assert.equal(c.doc.querySelector('.lead-importacao-alerta'),null);
 });
 await test('Indirect lead closure requires a reason and explicit pending-task decision',async c=>{
  c.data.tarefas.push({id:'lead-pending',cliente:'lead-exemplo',titulo:'Retorno de demonstração',prazo:c.data.hoje,feita:false});
  c.api.abrirFicha('lead-exemplo','lead');
  c.doc.querySelector('[data-a="lead-encerrar-abrir"]').click();
  c.doc.getElementById('fl-desfecho').value='fora_direto';
  c.doc.querySelector('[data-a="lead-encerrar"]').click();
  assert.ok(!c.calls.some(x=>x.url==='/admin/carteira/lead'));
  fill(c,'fl-motivo','Compra por revenda');
  c.doc.querySelector('[data-a="lead-encerrar"]').click();
  assert.ok(!c.calls.some(x=>x.url==='/admin/carteira/lead'));
  c.doc.getElementById('fl-pendencias').value='cancelar';
  c.doc.querySelector('[data-a="lead-encerrar"]').click();await settle();
  const call=c.calls.find(x=>x.url==='/admin/carteira/lead');
  assert.equal(call.body.etapa,'fora_direto');
  assert.equal(call.body.resolver_pendencias,'cancelar');
  assert.match(c.doc.getElementById('tela').textContent,/Histórico de tarefas/);
  assert.equal(c.doc.querySelectorAll('#pr-corpo .funil .col').length,4);
  c.doc.querySelector('[data-pr-escopo="encerrados"]').click();
  assert.equal(c.doc.querySelectorAll('#pr-corpo .funil .col').length,3);
 });
 await test('Lead deletion requires confirmation and closes the drawer',async c=>{
  c.api.abrirFicha('lead-exemplo','lead');
  c.doc.querySelector('[data-a="lead-remover"]').click();
  assert.ok(!c.calls.some(x=>x.url.endsWith('/lead/lead-exemplo')));
  c.w.confirm=()=>true;
  c.doc.querySelector('[data-a="lead-remover"]').click();
  await settle();
  assert.ok(c.calls.some(x=>x.url.endsWith('/lead/lead-exemplo')));
  assert.equal(c.doc.getElementById('tela').innerHTML,'');
 });
 await test('Prospecting filters have balanced rows',c=>{
  assert.equal(c.doc.querySelectorAll('.pr-filtros-principal > .busca, .pr-filtros-principal > select').length,3);
  assert.equal(c.doc.querySelectorAll('.pr-filtros-secundaria > select').length,4);
 });
 await test('Legacy link does not mix a lead with a direct customer',c=>{
  const cid=c.data.dados.clientes[0].id,lead=c.data.prospec.leads[0];
  lead.cliente_id=cid;lead.responsavel_usuario='tiago';
  c.data.inter.push({id:'lead-contact',cliente:lead.id,data:c.data.hoje,tipo:'contato',resumo:'Contato exclusivo do lead'});
  c.data.tarefas.push({id:'lead-task',cliente:lead.id,titulo:'Tarefa exclusiva do lead',prazo:c.data.hoje,feita:false});
  c.api.abrirFicha(cid,'cliente');
  assert.ok(!c.doc.getElementById('tela').textContent.includes('Contato exclusivo do lead'));
  assert.ok(!c.doc.getElementById('tela').textContent.includes('Tarefa exclusiva do lead'));
  c.api.abrirFicha(lead.id,'lead');
  assert.ok(c.doc.getElementById('tela').textContent.includes('Contato exclusivo do lead'));
  assert.ok(c.doc.getElementById('tela').textContent.includes('Tarefa exclusiva do lead'));
  assert.equal(c.doc.getElementById('fl-dono').value,'tiago');
 });
 await test('Customer drawer shows every imported purchase and same-day details',async c=>{
  const id=c.data.dados.clientes[0].id;
  c.api.abrirFicha(id,'cliente');await settle();
  assert.equal(c.doc.querySelectorAll('#f-pedidos .pedido-item').length,2);
  assert.equal(c.doc.getElementById('f-pedidos-contagem').textContent,'2 compras');
  assert.match(c.doc.getElementById('f-pedidos').textContent,/2 lançamentos neste dia/);
  assert.match(c.doc.getElementById('f-pedidos').textContent,/01\/08\/2026/);
  assert.equal(c.doc.getElementById('f-pedidos-especiais'),null);
  assert.ok(c.calls.some(x=>x.url.endsWith('/cliente/'+id+'/pedidos')));
  const report=c.doc.querySelector('.relatorio-atalho');
  assert.equal(report.getAttribute('href'),'/admin/carteira/cliente/'+id+'/relatorio');
  assert.equal(report.getAttribute('target'),'_blank');
 });
 await test('Customer view separates current sales from the three-month estimate',c=>{
  const customer=c.data.dados.clientes[0];
  assert.ok(customer.previsao_trimestre>0);
  const row=c.doc.querySelector('#r-tab tr[data-id="'+customer.id+'"]');
  assert.ok(row.querySelector('.horizonte-col').textContent.includes('set/26'));
  c.api.abrirFicha(customer.id,'cliente');
  assert.equal(c.doc.querySelectorAll('.horizonte-mes').length,3);
  assert.match(c.doc.querySelector('.horizonte-mes').textContent,/Vendido até hoje/);
  assert.match(c.doc.querySelector('.horizonte-nota').textContent,/Não representa pedido confirmado/);
 });
 await test('Overview cards navigate to the appropriate customer filter',c=>{
  c.doc.querySelector('[data-visao="caindo"]').click();assert.equal(c.api.estado.tela,'registros');assert.equal(c.api.estado.view,'caindo');
 });
 console.log(`${passed} interface regression checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
