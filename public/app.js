const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cash = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents / 100);
const today = () => new Date().toLocaleDateString('sv-SE');
const prettyDate = value => value.split('-').reverse().join('/');
const decimal = value => (value / 100).toFixed(2);
const cents = value => Math.round(Number(String(value).replace(',','.')) * 100);
let state, view = 'overview', month = today().slice(0,7), filter = 'stock', toastTimer;
const modal = $('#modal');
const icons = {overview:'◫',items:'▣',home:'⌂',settings:'⚙'};
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(() => $('#toast').classList.remove('visible'),4500); }
async function api(route, method='GET', data) {
  const response = await fetch('/api/'+route,{method,headers:{'Content-Type':'application/json',...(state ? {'X-CSRF-Token':state.user.csrf} : {})},...(data !== undefined ? {body:JSON.stringify(data)} : {})});
  const result = await response.json();
  if (!response.ok) { if(response.status===401 && state) { state=null; modal.close(); renderAuth(); } throw new Error(result.error || 'Não foi possível concluir.'); }
  return result;
}
async function refresh() { state=await api('state'); render(); }
function authMarkup(register) {
  const invited = new URLSearchParams(location.search).has('convite');
  return `<main class="auth"><section class="auth-story"><a class="brand" href="/"><span class="brand-mark">F</span>Finanças<span class="brand-dot">.</span></a><div><span class="eyebrow">BRIQUE & CASA</span><h1>Cada negócio.<br>Cada conta.<br><em>Tudo no lugar.</em></h1><p>Cuide das suas revendas e organize a vida a dois.</p></div><span class="story-footer">Mais clareza para o seu dinheiro.</span></section><section class="auth-form"><div class="auth-inner"><span class="eyebrow">SEU ESPAÇO</span><h2>${register ? invited ? 'Entre para a casa' : 'Vamos começar?' : 'Bom ter você aqui'}</h2><p class="muted">${register ? invited ? 'Crie sua conta para acessar o brique e as finanças compartilhadas.' : 'Crie uma conta. Depois, convide quem divide as contas com você.' : 'Entre para acompanhar seus negócios e suas contas.'}</p><form id="auth-form">${register ? '<label>Seu nome<input name="name" autocomplete="name" required maxlength="80" placeholder="Como podemos chamar você?"></label>' : ''}<label>E-mail<input name="email" type="email" autocomplete="email" required placeholder="voce@email.com"></label><label>Senha<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required minlength="8" maxlength="128" placeholder="Pelo menos 8 caracteres"></label><p class="form-error" role="alert"></p><button class="primary full" type="submit">${register ? 'Criar minha conta' : 'Entrar'}</button></form><p class="auth-switch">${register ? 'Já tem cadastro?' : 'Primeira vez aqui?'} <button class="link" id="switch-auth">${register ? 'Entrar' : 'Criar conta'}</button></p></div></section></main>`;
}
function renderAuth(register = new URLSearchParams(location.search).has('convite')) {
  $('#app').innerHTML=authMarkup(register);
  $('#switch-auth').onclick=() => renderAuth(!register);
  $('#auth-form').onsubmit=async event => {
    event.preventDefault(); const form=event.target; const button=form.querySelector('button'); button.disabled=true;
    const data=Object.fromEntries(new FormData(form)); if(register) data.invite=new URLSearchParams(location.search).get('convite') || '';
    try { await api(register ? 'register' : 'login','POST',data); history.replaceState({},'', '/'); await refresh(); }
    catch(error) { form.querySelector('.form-error').textContent=error.message; }
    finally { button.disabled=false; }
  };
}
function metrics() {
  const stock=state.items.filter(item => item.sale===null), sold=state.items.filter(item=>item.sale!==null);
  const paid=state.transactions.filter(t=>t.paid);
  const monthly=state.transactions.filter(t=>t.due.startsWith(month));
  return { stock, sold, invested:stock.reduce((sum,item)=>sum+item.cost,0), profit:sold.reduce((sum,item)=>sum+item.sale-item.cost,0), balance:paid.reduce((sum,t)=>sum+(t.kind==='income'?t.amount:-t.amount),0), monthly, income:monthly.filter(t=>t.kind==='income'&&t.paid).reduce((s,t)=>s+t.amount,0), expense:monthly.filter(t=>t.kind==='expense'&&t.paid).reduce((s,t)=>s+t.amount,0), pending:monthly.filter(t=>t.kind==='expense'&&!t.paid).reduce((s,t)=>s+t.amount,0) };
}
function stat(label,value,detail,accent=false) { return `<article class="stat ${accent?'accent':''}"><span>${label}</span><strong>${cash(value)}</strong><small>${detail}</small></article>`; }
function empty(title,description,action,label) { return `<div class="empty"><span class="empty-symbol">＋</span><h3>${title}</h3><p>${description}</p>${action?`<button class="secondary" data-action="${action}">${label}</button>`:''}</div>`; }
function transactionRow(t) {
  const late=!t.paid&&t.due<today();
  return `<div class="transaction"><span class="transaction-icon ${t.kind}">${t.kind==='income'?'↙':'↗'}</span><div class="transaction-main"><strong>${esc(t.description)}</strong><span>${esc(t.category)} · ${prettyDate(t.due)}</span></div><div class="transaction-value"><strong class="${t.kind==='income'?'positive':''}">${t.kind==='income'?'+':'−'} ${cash(t.amount)}</strong><button class="badge ${t.paid?'paid':late?'late':'pending'}" data-action="toggle" data-id="${t.id}" title="Alterar situação">${t.paid?t.kind==='income'?'Recebido':'Pago':late?'Atrasado':'Pendente'}</button></div><button class="icon-button" data-action="edit-transaction" data-id="${t.id}" aria-label="Editar ${esc(t.description)}">⋯</button></div>`;
}
function productCard(item) {
  const sold=item.sale!==null;
  return `<article class="product"><div class="product-image">${item.photo?`<img src="${esc(item.photo)}" alt="${esc(item.name)}" loading="lazy">`:'<span aria-hidden="true">▣</span>'}<span class="badge ${sold?'paid':'stock'}">${sold?'Vendido':'Em estoque'}</span></div><div class="product-body"><h3>${esc(item.name)}</h3><p class="muted">Compra em ${prettyDate(item.acquired)}</p><div class="product-prices"><div><span>Custo</span><strong>${cash(item.cost)}</strong></div><div><span>${sold?'Venda':'Anúncio'}</span><strong>${cash(sold?item.sale:item.asking)}</strong></div></div>${sold?`<div class="profit-line ${item.sale-item.cost<0?'negative':'positive'}">Lucro realizado <strong>${cash(item.sale-item.cost)}</strong></div>`:''}<button class="secondary full" data-action="edit-item" data-id="${item.id}">${sold?'Ver / editar venda':'Editar / registrar venda'}</button></div></article>`;
}
function overview(m) {
  const upcoming=state.transactions.filter(t=>!t.paid&&t.kind==='expense').slice(0,5);
  return `<section class="stats">${stat('Capital no brique',m.invested,`${m.stock.length} produto${m.stock.length===1?'':'s'} em estoque`,true)}${stat('Lucro nas vendas',m.profit,`${m.sold.length} venda${m.sold.length===1?'':'s'} registrada${m.sold.length===1?'':'s'}`)}${stat('Saldo da casa',m.balance,'Entradas e saídas confirmadas')}</section><div class="overview-grid"><section class="panel"><div class="section-heading"><div><span class="eyebrow">CONTAS DA CASA</span><h2>Próximos pagamentos</h2></div><button class="link" data-action="go-home">Ver todos →</button></div>${upcoming.length?upcoming.map(transactionRow).join(''):empty('Nenhuma conta pendente','Cadastre aluguel, moto e as despesas do dia a dia.','new-transaction','Adicionar conta')}</section><section class="brique-summary"><span class="eyebrow">SEU BRIQUE</span><h2>Dinheiro em movimento.</h2><p>Da compra à venda, acompanhe quanto cada negócio deixa no bolso.</p><div class="summary-number">${m.stock.length}<span>produtos para vender</span></div><button class="light-button" data-action="go-items">Abrir meu estoque →</button></section></div><section class="panel"><div class="section-heading"><div><span class="eyebrow">ESTOQUE</span><h2>Seus últimos produtos</h2></div><button class="link" data-action="new-item">+ Novo produto</button></div>${m.stock.length?`<div class="products">${m.stock.slice(0,3).map(productCard).join('')}</div>`:empty('Seu próximo negócio começa aqui','Adicione uma foto, o custo e o preço que pretende pedir.','new-item','Cadastrar primeiro produto')}</section>`;
}
function itemsView(m) {
  const list=filter==='stock'?m.stock:filter==='sold'?m.sold:state.items;
  return `<section class="stats">${stat('Investido no estoque',m.invested,'Custo dos produtos ainda não vendidos',true)}${stat('Vendas realizadas',m.sold.reduce((s,i)=>s+i.sale,0),'Total recebido nas vendas')}${stat('Lucro realizado',m.profit,'Valor de venda menos custo total')}</section><section class="panel"><div class="section-heading"><div class="segmented" role="group" aria-label="Filtrar produtos">${[['stock','Em estoque'],['sold','Vendidos'],['all','Todos']].map(([key,label])=>`<button class="${filter===key?'selected':''}" data-action="filter" data-filter="${key}">${label}</button>`).join('')}</div><span class="muted">${list.length} produto${list.length===1?'':'s'}</span></div>${list.length?`<div class="products">${list.map(productCard).join('')}</div>`:empty('Nenhum produto por aqui','Cadastre suas compras e atualize o valor quando vender.','new-item','Novo produto')}</section>`;
}
function homeView(m) {
  return `<div class="month-control"><label for="month">Mês de referência</label><input id="month" type="month" value="${month}"></div><section class="stats">${stat('Entradas recebidas',m.income,'Neste mês',true)}${stat('Despesas pagas',m.expense,'Neste mês')}${stat('Falta pagar',m.pending,'Contas pendentes neste mês')}</section><section class="panel"><div class="section-heading"><h2>Entradas e despesas</h2><span class="muted">${m.monthly.length} lançamentos</span></div>${m.monthly.length?m.monthly.map(transactionRow).join(''):empty('Um mês para organizar','Registre suas entradas e contas. Marque quando receber ou pagar.','new-transaction','Novo lançamento')}</section><p class="footnote">O brique tem seu próprio controle. Para levar um valor para as contas da casa, registre uma entrada aqui.</p>`;
}
function settingsView() {
  return `<section class="panel settings-panel"><span class="eyebrow">COMPARTILHAMENTO</span><h2>Quem cuida da casa</h2><p class="muted">As pessoas desta casa acessam e podem editar os mesmos produtos e lançamentos.</p>${state.members.map(member=>`<div class="member"><span class="avatar">${esc(member.name[0].toUpperCase())}</span><div><strong>${esc(member.name)}</strong><span>${esc(member.email)}</span></div></div>`).join('')}<button class="primary" data-action="invite">Criar convite</button><div id="invite-result"></div><p class="footnote">O convite vale por 7 dias e permite um novo cadastro. Ao gerar outro, o convite anterior deixa de funcionar.</p></section><section class="panel settings-panel"><h2>Sua conta</h2><p>${esc(state.user.email)}</p><button class="secondary" data-action="logout">Sair da conta</button></section>`;
}
function render() {
  const m=metrics();
  const names={overview:'Visão geral',items:'Meu brique',home:'Contas da casa',settings:'Nossa casa'};
  const subtitles={overview:`Olá, ${state.user.name.split(' ')[0]}. Vamos colocar as contas em dia?`,items:'Compras, estoque e vendas em um só lugar.',home:'As entradas e despesas da vida a dois.',settings:'Divida a organização, com uma conta para cada pessoa.'};
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar"><a class="brand" href="/"><span class="brand-mark">F</span>Finanças<span class="brand-dot">.</span></a><span class="nav-caption">MEU ESPAÇO</span><nav>${Object.entries(names).map(([key,name])=>`<button data-view="${key}" class="nav-button ${view===key?'active':''}" ${view===key?'aria-current="page"':''}><span aria-hidden="true">${icons[key]}</span>${name}</button>`).join('')}</nav><div class="sidebar-bottom"><span class="avatar">${esc(state.user.name[0].toUpperCase())}</span><div><strong>${esc(state.user.name)}</strong><span>Seu dinheiro, organizado.</span></div></div></aside><main class="main"><header class="page-heading"><div><span class="eyebrow">FINANÇAS / ${view==='items'?'BRIQUE':'CASA'}</span><h1>${names[view]}</h1><p>${esc(subtitles[view])}</p></div>${view==='settings'?'':`<button class="primary" data-action="${view==='items'?'new-item':'new-transaction'}">＋ ${view==='items'?'Novo produto':'Novo lançamento'}</button>`}</header>${view==='overview'?overview(m):view==='items'?itemsView(m):view==='home'?homeView(m):settingsView()}</main></div>`;
  document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;render();window.scrollTo(0,0);});
  bindActions($('#app'));
  if($('#month')) $('#month').onchange=event=>{if(event.target.value){month=event.target.value;render();}};
}
function bindActions(container) {
  container.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{
    try {
      const action=button.dataset.action, id=Number(button.dataset.id);
      if(action==='new-item') itemForm();
      if(action==='edit-item') itemForm(state.items.find(i=>i.id===id));
      if(action==='new-transaction') transactionForm();
      if(action==='edit-transaction') transactionForm(state.transactions.find(t=>t.id===id));
      if(action==='go-home'||action==='go-items') {view=action==='go-home'?'home':'items';render();}
      if(action==='filter') {filter=button.dataset.filter;render();}
      if(action==='toggle') {button.disabled=true;const t=state.transactions.find(t=>t.id===id);await api('transactions/'+id,'PUT',{...t,paid:!t.paid});await refresh();toast('Situação atualizada.');}
      if(action==='invite') {button.disabled=true; const result=await api('invite','POST',{});$('#invite-result').innerHTML=`<label class="invite-label">Envie este link para quem vai dividir as contas<input id="invite-link" readonly value="${esc(location.origin+'/?convite='+result.token)}"></label><button class="secondary" id="copy-invite">Copiar convite</button>`;$('#invite-link').onclick=event=>event.target.select();$('#copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText($('#invite-link').value);toast('Convite copiado.');}catch{$('#invite-link').select();toast('Selecione e copie o link do convite.');}};button.disabled=false;}
      if(action==='logout') {await api('logout','POST',{});state=null;renderAuth(false);}
    } catch(error) {button.disabled=false;toast(error.message);}
  });
}
function openForm(title,content,save,remove) {
  modal.innerHTML=`<form id="edit-form"><div class="modal-heading"><h2>${title}</h2><button type="button" class="icon-button" id="close-modal" aria-label="Fechar">×</button></div>${content}<p class="form-error" role="alert"></p><div class="modal-footer">${remove?'<button type="button" class="danger" id="delete-record">Excluir</button>':''}<button type="button" class="secondary" id="cancel-modal">Cancelar</button><button type="submit" class="primary">Salvar</button></div></form>`;
  modal.showModal(); $('#close-modal').onclick=$('#cancel-modal').onclick=()=>modal.close();
  if(remove) $('#delete-record').onclick=async()=>{if(!confirm('Excluir este registro? Esta ação não pode ser desfeita.'))return;try{await remove();modal.close();await refresh();toast('Registro excluído.');}catch(error){modal.querySelector('.form-error').textContent=error.message;}};
  $('#edit-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;try{await save(Object.fromEntries(new FormData(event.target)));modal.close();await refresh();toast('Salvo com sucesso.');}catch(error){modal.querySelector('.form-error').textContent=error.message;}finally{button.disabled=false;}};
}
function itemForm(item) {
  const i=item || {name:'',cost:0,asking:0,sale:null,acquired:today(),sold_on:today(),notes:'',photo:''};
  let image=i.photo;
  openForm(item?'Editar produto':'Novo produto',`<label>Nome do produto<input name="name" value="${esc(i.name)}" required maxlength="120" placeholder="Ex.: PC i3 de 10ª geração"></label><div class="form-grid"><label>Custo total (R$)<input name="cost" type="number" min="0" step="0.01" required value="${decimal(i.cost)}"></label><label>Preço do anúncio (R$)<input name="asking" type="number" min="0" step="0.01" required value="${decimal(i.asking)}"></label></div><label>Data da compra<input type="date" name="acquired" required value="${i.acquired}"></label><label>Foto do produto<input id="photo" type="file" accept="image/jpeg,image/png,image/webp"><small>JPG, PNG ou WebP · até 3 MB</small></label><div id="photo-preview">${image?`<img class="photo-preview" src="${esc(image)}" alt="Foto do produto">`:''}</div><label>Observações<textarea name="notes" rows="3" maxlength="4000" placeholder="Peças, reparos, troca, acessórios…">${esc(i.notes)}</textarea></label><label class="checkbox-label"><input type="checkbox" id="sold" ${i.sale!==null?'checked':''}> Já vendi este produto</label><div id="sale-fields" class="form-grid" ${i.sale===null?'hidden':''}><label>Valor da venda (R$)<input id="sale" name="sale" type="number" min="0" step="0.01" value="${i.sale!==null?decimal(i.sale):''}"></label><label>Data da venda<input id="sold-on" type="date" name="sold_on" value="${i.sold_on || today()}"></label></div>`,async data=>{if(photoLoading)throw new Error('Aguarde a foto terminar de carregar.');await api('items'+(item?'/'+item.id:''),item?'PUT':'POST',{...data,cost:cents(data.cost),asking:cents(data.asking),sale:$('#sold').checked?cents(data.sale):null,photo:image});},item?()=>api('items/'+item.id,'DELETE'):null);
  let photoLoading=false;
  const setSold=()=>{$('#sale-fields').hidden=!$('#sold').checked;$('#sale').required=$('#sold').checked;$('#sold-on').required=$('#sold').checked;};setSold();$('#sold').onchange=setSold;
  $('#photo').onchange=event=>{const file=event.target.files[0];if(!file)return;if(file.size>3*1024*1024){event.target.value='';toast('Escolha uma foto de até 3 MB.');return;}photoLoading=true;const reader=new FileReader();reader.onload=()=>{image=reader.result;$('#photo-preview').innerHTML=`<img class="photo-preview" src="${esc(image)}" alt="Foto selecionada">`;photoLoading=false;};reader.onerror=()=>{photoLoading=false;toast('Não foi possível ler a foto.');};reader.readAsDataURL(file);};
}
function transactionForm(transaction) {
  const t=transaction || {description:'',amount:0,kind:'expense',category:'Casa',due:today(),paid:0};
  const categories=[...new Set(['Casa','Aluguel','Moto','Alimentação','Salário','Brique','Outros',t.category])];
  openForm(transaction?'Editar lançamento':'Novo lançamento',`<label>Descrição<input name="description" required maxlength="120" value="${esc(t.description)}" placeholder="Ex.: Aluguel de setembro"></label><div class="form-grid"><label>Tipo<select name="kind"><option value="expense" ${t.kind==='expense'?'selected':''}>Despesa</option><option value="income" ${t.kind==='income'?'selected':''}>Entrada</option></select></label><label>Valor (R$)<input name="amount" type="number" min="0.01" step="0.01" required value="${t.amount?decimal(t.amount):''}"></label></div><div class="form-grid"><label>Categoria<select name="category">${categories.map(c=>`<option ${c===t.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label>Data / vencimento<input name="due" type="date" required value="${t.due}"></label></div><label class="checkbox-label"><input type="checkbox" name="paid" ${t.paid?'checked':''}> Já foi pago ou recebido</label>`,data=>api('transactions'+(transaction?'/'+transaction.id:''),transaction?'PUT':'POST',{...data,amount:cents(data.amount),paid:data.paid==='on'}),transaction?()=>api('transactions/'+transaction.id,'DELETE'):null);
}
refresh().catch(error=>{if(error.message.includes('Entre na sua conta'))renderAuth();else $('#app').innerHTML=`<main class="loading"><h1>Não foi possível abrir o Finanças</h1><p>${esc(error.message)}</p><a href="/">Tentar novamente</a></main>`;});
