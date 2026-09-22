import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('cadastro, isolamento entre casas, convite, estoque, venda e contas', async () => {
  const dir=mkdtempSync(path.join(tmpdir(),'financas-test-'));
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  let base;
  try {
    const port=await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{const match=/porta (\d+)/.exec(String(chunk));if(match)resolve(match[1]);});child.once('error',reject);child.once('exit',code=>reject(new Error('Servidor encerrou: '+code)));});
    base='http://127.0.0.1:'+port;
    function client(){return {cookie:'',csrf:'',async call(route,method='GET',data){const response=await fetch(base+'/api/'+route,{method,headers:{'Content-Type':'application/json','Cookie':this.cookie,'X-CSRF-Token':this.csrf,'Origin':base},...(data===undefined?{}:{body:JSON.stringify(data)})});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();if(route==='state'&&response.ok)this.csrf=value.user.csrf;return {status:response.status,value};}};}
    const owner=client(), outsider=client(), partner=client();
    assert.equal((await owner.call('state')).status,401);
    assert.equal((await owner.call('register','POST',{name:'Eduardo',email:'eduardo@example.test',password:'test-password-123'})).status,201);
    await owner.call('state');
    assert.equal((await outsider.call('register','POST',{name:'Outra casa',email:'other@example.test',password:'test-password-123'})).status,201);
    await outsider.call('state');
    const product={name:'PC i3',cost:80000,asking:189000,sale:null,acquired:'2026-09-01',photo:'',notes:'Teste'};
    assert.equal((await owner.call('items','POST',product)).status,201);
    let state=(await owner.call('state')).value;
    const id=state.items[0].id;
    assert.equal((await outsider.call('state')).value.items.length,0);
    assert.equal((await outsider.call('items/'+id,'PUT',{...product,name:'Acesso indevido'})).status,404);
    assert.equal((await outsider.call('items/'+id,'DELETE')).status,404);
    const invite=(await owner.call('invite','POST',{})).value.token;
    assert.equal((await partner.call('register','POST',{name:'Rafa',email:'rafa@example.test',password:'test-password-123',invite})).status,201);
    assert.equal((await partner.call('state')).value.items.length,1);
    assert.equal((await partner.call('items/'+id,'PUT',{...product,sale:150000,sold_on:'2026-09-14'})).status,200);
    state=(await owner.call('state')).value;
    assert.equal(state.members.length,2);
    assert.equal(state.items[0].sale-state.items[0].cost,70000);
    assert.equal((await owner.call('transactions','POST',{description:'Aluguel',amount:120100,kind:'expense',category:'Aluguel',due:'2026-09-20',paid:false})).status,201);
    let transaction=(await partner.call('state')).value.transactions[0];
    assert.equal((await partner.call('transactions/'+transaction.id,'PUT',{...transaction,paid:true})).status,200);
    assert.equal((await owner.call('state')).value.transactions[0].paid,1);
    assert.equal((await owner.call('items','POST',{...product,cost:-1})).status,400);
    assert.equal((await owner.call('items','POST',{...product,acquired:'2026-02-30'})).status,400);
    assert.equal((await owner.call('items','POST',{...product,photo:'data:image/svg+xml;base64,AAAA'})).status,400);
    const used=client();
    assert.equal((await used.call('register','POST',{name:'Novo',email:'new@example.test',password:'test-password-123',invite})).status,400);
    const csrf=owner.csrf;owner.csrf='invalid';
    assert.equal((await owner.call('items/'+id,'DELETE')).status,403);owner.csrf=csrf;
    assert.equal((await owner.call('logout','POST',{})).status,200);
    assert.equal((await owner.call('state')).status,401);
    assert.equal((await owner.call('login','POST',{email:'eduardo@example.test',password:'incorrect-123'})).status,401);
    assert.equal((await owner.call('login','POST',{email:'eduardo@example.test',password:'test-password-123'})).status,200);
  } finally {child.kill();await new Promise(resolve=>child.once('exit',resolve));rmSync(dir,{recursive:true,force:true});}
});
