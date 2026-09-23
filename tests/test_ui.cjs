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
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const html=template.replace('data-usuario="{{ usuario_id }}"','data-usuario="fernando"');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost/admin/carteira',virtualConsole:vc});
 const w=dom.window;
 Object.assign(w,{D:data.dados,FICHA:data.fichas,INTER:data.inter,TAREFAS:data.tarefas,ALIASES:data.aliases,CANDIDATOS:data.candidatos,PROSPEC:data.prospec,PESSOAL:data.pessoal,REGIOES:data.regioes,ETAPAS:data.etapas,HOJE:data.hoje});
 w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.requestAnimationFrame=fn=>fn();w.confirm=()=>false;
 w.fetch=async(url,opt={})=>{
  const body=opt.body?JSON.parse(opt.body):{};calls.push({url,body});
  if(url.endsWith('/pedidos'))return {json:async()=>({success:true,pedidos:[{data:'2026-09-20',valor:300,registros:2,valores:[100,200]},{data:'2026-08-01',valor:50,registros:1,valores:[50]}],pedidos_especiais:[{cliente:'Cliente fictício',produto:'Produto fictício',quantidade:12,urgente:false,concluido:true,criado_em:'20/09/2026 09:00',data_entrega:'25/09/2026'}]})};
  if(url==='/admin/carteira/dados')return {json:async()=>structuredClone(data)};
  if(url==='/admin/carteira/contato')data.inter.unshift({id:'new',cliente:body.cliente_id,resumo:body.resumo,resultado:body.resultado,data:data.hoje,tipo:'contato'});
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
  for(const id of ['h-agenda','r-corpo','pr-corpo','a-corpo','d-corpo'])assert.ok(c.doc.getElementById(id).innerHTML.length>20,id);
  assert.ok(!c.doc.getElementById('h-sub').textContent.includes('em jogo'));
 });
 await test('Navigation has labelled panels and keeps keyboard focus',c=>{
  const tabs=Array.from(c.doc.querySelectorAll('#abas [role="tab"]'));
  assert.equal(tabs.length,5);
  for(const tab of tabs){
   assert.equal(c.doc.getElementById(tab.getAttribute('aria-controls')).getAttribute('aria-labelledby'),tab.id);
   assert.ok(tab.querySelector('svg[aria-hidden="true"]'));
  }
  tabs[1].click();
  assert.equal(c.api.estado.tela,'registros');
  assert.equal(c.doc.activeElement.id,'aba-registros');
  c.doc.activeElement.dispatchEvent(new c.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(c.doc.activeElement.id,'aba-prospeccao');
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
 await test('Lead has contact history, next step and explicit customer linkage',c=>{
  c.api.abrirFicha('lead-exemplo','lead');assert.ok(c.doc.getElementById('fc-nota'));assert.ok(c.doc.getElementById('fl-cliente'));
  assert.equal(c.doc.getElementById('fl-cliente').options.length,4);
 });
 await test('Customer drawer shows every imported purchase and same-day details',async c=>{
  const id=c.data.dados.clientes[0].id;
  c.api.abrirFicha(id,'cliente');await settle();
  assert.equal(c.doc.querySelectorAll('#f-pedidos .pedido-item').length,2);
  assert.equal(c.doc.getElementById('f-pedidos-contagem').textContent,'2 compras');
  assert.match(c.doc.getElementById('f-pedidos').textContent,/2 lançamentos neste dia/);
  assert.match(c.doc.getElementById('f-pedidos').textContent,/01\/08\/2026/);
  assert.match(c.doc.getElementById('f-pedidos-especiais').textContent,/Produto fictício/);
  assert.ok(c.calls.some(x=>x.url.endsWith('/cliente/'+id+'/pedidos')));
 });
 await test('Overview cards navigate to the appropriate customer filter',c=>{
  c.doc.querySelector('[data-visao="caindo"]').click();assert.equal(c.api.estado.tela,'registros');assert.equal(c.api.estado.view,'caindo');
 });
 console.log(`${passed} interface regression checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
