/* FireMeBot frontend */
(function(){
  const els = {
    roleInput: document.getElementById('roleInput'),
    goBtn: document.getElementById('goBtn'),
    results: document.getElementById('results'),
    status: document.getElementById('statusBar'),
    envStatus: document.getElementById('envStatus'),
    editEndpointBtn: document.getElementById('editEndpointBtn'),
    historyList: document.getElementById('historyList'),
    clearHistory: document.getElementById('clearHistory'),
  };

  let WORKER_URL = (window.FireMeBot && window.FireMeBot.WORKER_URL) || localStorage.getItem('FMB_WORKER_URL') || '';

  function setEnvLabel(){
    const txt = WORKER_URL ? new URL(WORKER_URL).host : 'unset';
    els.envStatus.innerHTML = 'worker: <em>' + txt + '</em>';
  }
  setEnvLabel();

  function setStatus(msg, type='ok'){
    els.status.classList.remove('hidden','ok','error');
    els.status.classList.add(type);
    els.status.textContent = msg;
  }
  function clearStatus(){ els.status.classList.add('hidden'); }

  // Shortcuts
  window.addEventListener('keydown', (e)=>{
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){
      e.preventDefault(); els.roleInput.focus();
    }
    if(e.key === 'Enter' && document.activeElement === els.roleInput){
      run();
    }
  });

  els.goBtn.addEventListener('click', run);
  els.editEndpointBtn.addEventListener('click', ()=>{
    const current = WORKER_URL || '';
    const next = prompt('Cloudflare Worker endpoint (https://...):', current);
    if(next){
      WORKER_URL = next.trim();
      localStorage.setItem('FMB_WORKER_URL', WORKER_URL);
      setEnvLabel();
    }
  });

  els.clearHistory.addEventListener('click', ()=>{
    localStorage.removeItem('FMB_HISTORY');
    renderHistory();
  });

  function saveHistory(q){
    const key='FMB_HISTORY';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    if(!arr.includes(q)){
      arr.unshift(q);
      if(arr.length>12) arr.pop();
      localStorage.setItem(key, JSON.stringify(arr));
    }
  }

  function renderHistory(){
    const arr = JSON.parse(localStorage.getItem('FMB_HISTORY') || '[]');
    els.historyList.innerHTML = '';
    arr.forEach(item=>{
      const li = document.createElement('li');
      li.textContent = item;
      li.addEventListener('click', ()=>{
        els.roleInput.value = item;
        run();
      });
      els.historyList.appendChild(li);
    });
  }
  renderHistory();

  function copyText(text){
    navigator.clipboard.writeText(text).then(()=>{
      setStatus('Copied to clipboard.', 'ok');
      setTimeout(clearStatus, 1200);
    }).catch(()=> setStatus('Copy failed.', 'error'));
  }

  function createCard(title, content, {pre=false, big=false, raw=false}={}){
    const card = document.createElement('article');
    card.className = 'card result-card';

    const head = document.createElement('div');
    head.className = 'head';
    const h3 = document.createElement('h3'); h3.textContent = title;
    const actions = document.createElement('div');
    actions.className = 'row';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn small';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', ()=> copyText(typeof content === 'string' ? content : JSON.stringify(content, null, 2)));
    actions.appendChild(copyBtn);
    head.appendChild(h3); head.appendChild(actions);

    const body = document.createElement('div');
    body.className = pre ? 'kv' : (big ? 'bigtext' : 'kv');
    body.textContent = typeof content === 'string' ? content : (raw ? JSON.stringify(content) : JSON.stringify(content, null, 2));

    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  function renderResponse(data){
    els.results.innerHTML = '';

    // Common fields with nicer presentation
    const fieldOrder = [
      'roast','summary','verdict','threat_level','spectrum','score',
      'model','tokens','latency_ms','cost','timestamp','input','job_title',
      'raw','meta'
    ];

    function addIf(field, label, opts){
      if(data[field] !== undefined){
        els.results.appendChild(createCard(label, data[field], opts));
      }
    }

    addIf('roast','Roast',{big:true});
    addIf('summary','Summary',{big:true});
    addIf('verdict','Verdict',{pre:false, big:false});
    addIf('threat_level','Threat Level',{pre:false});
    addIf('spectrum','Spectrum',{pre:true});
    addIf('score','Score',{pre:false});
    addIf('job_title','Job Title',{pre:false});
    addIf('model','Model',{pre:false});
    addIf('tokens','Tokens',{pre:true});
    addIf('latency_ms','Latency (ms)',{pre:false});
    addIf('cost','Cost',{pre:false});
    addIf('timestamp','Timestamp',{pre:false});
    addIf('input','Input',{pre:true});
    addIf('raw','Raw',{pre:true});
    addIf('meta','Meta',{pre:true});

    // Render any extra keys dynamically
    Object.keys(data).forEach(k=>{
      if(fieldOrder.includes(k)) return;
      els.results.appendChild(createCard(k, data[k], {pre: typeof data[k] !== 'string'}));
    });
  }

  async function run(){
    clearStatus();
    const q = els.roleInput.value.trim();
    if(!q){ setStatus('Type a job title first.', 'error'); return; }
    if(!WORKER_URL){ setStatus('Set your Cloudflare Worker endpoint first.', 'error'); return; }

    setStatus('Summoning layoffs...', 'ok');
    els.results.innerHTML = '';

    try{
      const url = new URL(WORKER_URL);
      // Support both GET ?q= and POST {q}
      let resp = await fetch(url.toString() + (url.search ? '&' : '?') + 'q=' + encodeURIComponent(q), {
        method: 'GET',
        headers: { 'Accept':'application/json' },
      });

      // Fallback to POST if GET blocked
      if(!resp.ok){
        resp = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
          body: JSON.stringify({ q }),
        });
      }

      if(!resp.ok){
        const text = await resp.text();
        throw new Error('HTTP ' + resp.status + ' ' + text.slice(0,200));
      }

      const data = await resp.json().catch(async ()=>{
        const fallback = await resp.text();
        return { raw: fallback };
      });

      renderResponse(data);
      setStatus('Done.', 'ok');
      saveHistory(q);
      renderHistory();
    }catch(err){
      console.error(err);
      setStatus('Error: ' + (err.message || 'request failed'), 'error');
      // Hint about CORS
      if(String(err).toLowerCase().includes('cors') || String(err).toLowerCase().includes('fetch')){
        const hint = createCard('Hint', 'If you see a CORS error, allow your site origin on the Worker (Access-Control-Allow-Origin) and include JSON on both methods.', {pre:false});
        els.results.appendChild(hint);
      }
    }
  }

  // Auto-focus
  setTimeout(()=> els.roleInput.focus(), 100);

})();