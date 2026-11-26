(() => {
  'use strict';
  const ROOT = 'alterapso/alterapso_data/glossary-data/';
  const ART = 'https://alterapso.com/glossary-data/';
  const $ = selector => document.querySelector(selector);
  const el = $('#content'), search = $('#search'), tip = $('#tooltip'), status = $('#status');
  const detailCache = new Map(), itemMap = new Map(), enemyMap = new Map(), itemNameMap = new Map(), enemyNameMap = new Map();
  const legendaryIds = new Set(['00070E','000D09','000D0B','001D00','001E00','002002','003300','003601','008B05','00C001','010160','010162','010227','0102A9','030E01','03100B']);
  const syntheticUniqueIds = new Set(['00DD0A','008B05','002002','006E02','006E03','00B102','00B101','00DD0B','00070E','002602','002601','000D07','000D09','000D04','000D08','000D06']);
  const state = { view: 'drops', page: 0, query: '', filters: { ep: '1', diff: '3', unique: 'all' } };
  const routeMemory = {};
  let index, gacha, bestiaryEnemies, bestiaryPromise, translations = {}, language = localStorage.getItem('wiki-language') || 'en', gachaPromise;
  let uniqueTranslationIndex = null, termTranslationIndex = null, taskItemAliasIndex = null, taskItemAliasLanguage = '', searchDetailsPromise = null;
  const openCategories = new Set(), openTypes = new Set();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const t = (key, fallback) => language === 'cn' ? (translations.ui?.[key] || fallback) : fallback;
  const statName = key => t(`stat${key}`,({ATP:'Attack Power',ATA:'Accuracy',MST:'Mental Strength',DFP:'Defense Power',EVP:'Evasion',LCK:'Luck',HP:'HP',TP:'TP'})[key]||key);
  const formatRequirement = value => {
    const text=String(value||'');
    const level=text.match(/^\s*Level\s+(\d+)\s*$/i);
    if(level)return language==='cn'?`${t('level','等级')} ${level[1]}`:`Level ${level[1]}`;
    const match=text.match(/^\s*(\d+)\s+(ATP|ATA|MST|DFP|EVP|LCK|HP|TP)\s*$/i);
    return match?`${match[1]} ${statName(match[2].toUpperCase())}`:term(value);
  };
  const fallbackCn = value => value || '';
  const mappedText = entry => typeof entry === 'string' ? entry : entry?.cn;
  const normalizeTranslationKey = value => String(value ?? '').trim().toLocaleLowerCase();
  function buildTermTranslationIndex() {
    const result = new Map();
    for (const section of ['categories', 'types', 'terms']) {
      for (const [source, entry] of Object.entries(translations[section] || {})) {
        const key = normalizeTranslationKey(source), value = mappedText(entry)?.trim();
        if (key && value) result.set(key, value);
      }
    }
    return result;
  }
  function buildUniqueTranslationIndex() {
    const result = new Map();
    for (const entries of Object.values(translations.unique || {})) {
      for (const entry of Array.isArray(entries) ? entries : [entries]) {
        const source = entry?.source;
        if (!source) continue;
        for (const field of ['name', 'type']) {
          const key = normalizeTranslationKey(source[field]);
          const value = entry[field];
          if (key && value) result.set(key, value);
        }
        const sourceDescriptions = Array.isArray(source.description) ? source.description : [source.description];
        const descriptions = Array.isArray(entry.description) ? entry.description : [entry.description];
        sourceDescriptions.forEach((text, position) => {
          const key = normalizeTranslationKey(text), value = descriptions[position];
          if (key && value) result.set(key, value);
        });
      }
    }
    return result;
  }
  const uniqueSourceTranslation = value => {
    if (!uniqueTranslationIndex) uniqueTranslationIndex = buildUniqueTranslationIndex();
    return uniqueTranslationIndex.get(normalizeTranslationKey(value));
  };
  const termSourceTranslation = value => {
    if (!termTranslationIndex) termTranslationIndex = buildTermTranslationIndex();
    return termTranslationIndex.get(normalizeTranslationKey(value));
  };
  const localizedTerm = value => {
    if(!value)return '';
    const mapped = mappedText(translations.categories?.[value]) || mappedText(translations.types?.[value]) || mappedText(translations.terms?.[value]);
    if(mapped?.trim())return mapped.trim();
    const normalizedMapped = termSourceTranslation(value);
    if (normalizedMapped) return normalizedMapped;
    const uniqueMapped = uniqueSourceTranslation(value);
    if (uniqueMapped) return uniqueMapped;
    const item=itemNameMap.get(value);if(item)return mappedText(translations.items?.[item.c.toUpperCase()])?.trim()||value;
    const enemyForm=enemyNameMap.get(value);if(enemyForm){const entry=translations.enemies?.[enemyForm.enemy.k],mapped=enemyForm.form==='ultimate'?entry?.ultimate:entry?.normal;return mappedText(mapped)?.trim()||value;}
    return fallbackCn(value);
  };
  const term = value => !value?'':language==='cn'?localizedTerm(value):value;
  const searchNames = value => `${value || ''} ${localizedTerm(value)}`.toLocaleLowerCase();
  const searchMatches = (...values) => Boolean(state.query&&values.some(value=>searchNames(String(value??'')).includes(state.query.toLocaleLowerCase())));
  function detailSearchMatches(item,detail){
    if(!state.query||!detail)return false;
    const unique=detail.un??detail.us,uniqueEntries=Array.isArray(unique)?unique:(unique?[unique]:[]);
    const sources=(detail.so||[]).flatMap(source=>[source.k,source.t,source.m,source.r,source.c]);
    const stats=Object.entries(detail.st||{}).flatMap(([key,value])=>[key,statName(key),...(Array.isArray(value)?value:[value])]);
    const relatedEnemies=(detail.dr||[]).map(drop=>index.enemies[Number(drop[3])]).filter(Boolean).flatMap(enemy=>[enemy.n,enemy.u]);
    const requirements=(detail.rq||[]).flatMap(value=>[value,formatRequirement(value)]),classes=(detail.cl||[]).flatMap(value=>[value,term(value)]);
    return searchMatches(...stats,...requirements,...classes,detail.mg,detail.sp,...(detail.ef||[]),...uniqueEntries.flatMap(entry=>[entry.l,entry.n,...(Array.isArray(entry.t)?entry.t:[entry.t])]),...sources,...relatedEnemies,...(detail.dr||[]).flat(),item.c);
  }
  function ensureSearchDetails(){
    if(searchDetailsPromise)return searchDetailsPromise;
    const representatives=new Map();
    for(const item of index.items){const shard=item.c.slice(-1).toLowerCase();if(!representatives.has(shard))representatives.set(shard,item);}
    searchDetailsPromise=Promise.all([...representatives.values()].map(item=>loadDetail(item.c))).then(()=>undefined);
    return searchDetailsPromise;
  }
  const itemLabel = item => {
    if (language !== 'cn') return item.n;
    return mappedText(translations.items?.[item.c.toUpperCase()])?.trim() || fallbackCn(item.n);
  };
  const enemyLabel = (enemy, form='normal') => {
    const source=form==='ultimate'&&enemy?.u?enemy.u:enemy?.n;
    if(language!=='cn')return source||'';
    const translation=translations.enemies?.[enemy?.k];
    const mapped=form==='ultimate'?translation?.ultimate:translation?.normal;
    return (mappedText(mapped)?.trim())||fallbackCn(source);
  };
  const uniqueList = (item,detail) => {
    const value=detail?.un??detail?.us??null;
    const entries=(Array.isArray(value)?value:(value?[value]:[])).filter(entry=>entry?.l!=='Weapon type');
    if(!entries.length&&item?.o&&detail?.sp){
      const effects=(detail.ef||[]).filter(text=>/special attack|special:/i.test(text));
      entries.push({l:'Unique EX',n:detail.sp,t:effects.length?effects:detail.ef||[]});
    }
    return entries;
  };
  const normalizeSpecialName=value=>(String(value||'').toLocaleLowerCase().match(/[a-z0-9]+/g)||[]).filter(word=>!['and','piercing','volley','volleys'].includes(word)).sort().join('');
  const uniqueText = (id, entry, index, field) => {
    const sourceKey=field==='name'?'n':field==='type'?'l':'t';
    const sourceValue=entry?.[sourceKey];
    const source=Array.isArray(sourceValue)?sourceValue.join('\n'):String(sourceValue||'');
    if(language!=='cn')return source;
    const raw=translations.unique?.[id]?.[index]?.[field];
    const translation=Array.isArray(raw)?raw.join('\n'):String(raw||'').trim();
    if (translation && normalizeTranslationKey(translation)!==normalizeTranslationKey(source)) return translation;
    if (Array.isArray(sourceValue)) return sourceValue.map(line => localizedTerm(line)).join('\n');
    return localizedTerm(source)||translation||fallbackCn(source);
  };
  const bulletLines = value => (Array.isArray(value)?value:[value]).flatMap(entry=>String(entry??'').split(/\r?\n/)).map(line=>line.trim().replace(/^[-•]\s*/,'')).filter(Boolean);
  const ssRankTypes={'Akimbo':'Mechgun','Cane Style':'Cane','Crossbow':'Shot','Lone Virtue':'Saber','Lone Wolf':'Rifle','Niten':'Twin Sword','Rod Style':'Rod','Slicer':'Slicer','Wand Style':'Wand'};
  const categoryFor = item => ['Weapons','S-Rank','SS-Rank'].includes(item.g)?'Weapons':item.g==='Items'?'Other':item.g||'Other';
  const typeFor = item => item.g==='SS-Rank'?(ssRankTypes[item.n]||item.t||'Other'):item.t||'Other';
  const iconUrl = icon => { const file = String(icon || ''); return `${ART}art/${file.startsWith('k') ? file : `k${file}`}${file.endsWith('.webp') ? '' : '.webp'}`; };
  const fraction = value => value > 0 ? `1/${Math.max(1, Math.round(1 / value))}` : '—';
  const percent = value => `${(value * 100).toFixed(value * 100 < .01 ? 4 : 2)}%`;
  const uniqueOf = detail => { const value = detail?.un ?? detail?.us ?? null; return Array.isArray(value) ? (value[0] || null) : value; };
  const rarity = id => legendaryIds.has(id) ? 'legendary' : ((itemMap.get(id)?.s || 0) >= 9 ? 'rare' : '');
  const itemName = id => { const item = itemMap.get(id); return item ? itemLabel(item) : `Unknown item ${id}`; };
  function highlight(value) {
    const safe = esc(value);
    if (!state.query) return safe;
    try { return safe.replace(new RegExp(state.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), match => `<mark class="mark">${match}</mark>`); }
    catch { return safe; }
  }
  async function ensureTranslations() {
    if (Object.keys(translations).length) return;
    if (!ensureTranslations.promise) ensureTranslations.promise=fetch('cn.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('Chinese translations unavailable');return response.json();}).then(data=>{translations=data;uniqueTranslationIndex=null;termTranslationIndex=null;});
    await ensureTranslations.promise;
  }
  async function applyLanguage(next) {
    language = next === 'cn' ? 'cn' : 'en';
    if(language==='cn')await ensureTranslations();
    localStorage.setItem('wiki-language', language);
    document.documentElement.lang = language === 'cn' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-language]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.language === language);
      button.setAttribute('aria-pressed', String(button.dataset.language === language));
    });
    render();
  }
  function configureNav() {
    $('#title').textContent = state.view === 'drops' ? t('dropTitle', 'Drop Table') : t('itemTitle', 'Equipment Database');
    $('#subtitle').textContent = state.view === 'drops'
      ? t('dropSubtitle', 'Search drops by episode, difficulty, and monster.')
      : t('itemSubtitle', 'Browse equipment by category, type, and name.') ;
    document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === state.view));
    document.querySelector('[data-route="drops"]').innerHTML = `${t('dropTitle','Drop Table')} <small>DROP TABLE</small>`;
    document.querySelector('[data-route="items"]').innerHTML = `${t('itemNav','Equipment')} <small>ITEM DATABASE</small>`;
    document.querySelector('.language-switcher').setAttribute('aria-label', t('language','Language'));
    search.placeholder = t('searchPlaceholder', 'Search monsters, items, or IDs…');
  }
  function filtersUI() {
    const filters = $('#filters');
    const dropNav = $('#drop-nav');
    if (state.view === 'drops') {
      dropNav.hidden=false;
      dropNav.innerHTML=`<div class="drop-nav-row"><span>${t('episodeLabel','Episode')}</span>${[['1','Episode 1'],['2','Episode 2'],['4','Episode 4']].map(([v,n])=>`<button type="button" data-drop-ep="${v}" class="drop-tab ${state.filters.ep===v?'active':''}">${t(`ep${v}`,n)}</button>`).join('')}</div><div class="drop-nav-row"><span>${t('difficultyLabel','Difficulty')}</span>${[['0','Normal'],['1','Hard'],['2','Very Hard'],['3','Ultimate']].map(([v,n])=>`<button type="button" data-drop-diff="${v}" class="drop-tab ${state.filters.diff===v?'active':''}">${t(`diff${v}`,n)}</button>`).join('')}</div>`;
      filters.replaceChildren();
    } else {
      dropNav.hidden=true;
      dropNav.replaceChildren();
      filters.innerHTML = `<label class="unique-filter"><input type="checkbox" data-filter="unique" ${state.filters.unique==='yes'?'checked':''}><span>${t('uniqueYes','Unique only')}</span></label>`;
    }
  }
  async function ensureGacha() {
    if(gacha)return;
    if(!gachaPromise)gachaPromise=fetch(`${ROOT}gacha.json`).then(response=>{if(!response.ok)throw Error('gacha unavailable');return response.json();}).then(data=>{gacha=data;});
    await gachaPromise;
  }
  async function ensureBestiary() {
    if(bestiaryEnemies)return bestiaryEnemies;
    if(!bestiaryPromise)bestiaryPromise=fetch(`${ROOT}bestiary.json`).then(response=>{if(!response.ok)throw Error('Bestiary unavailable');return response.json();}).then(data=>{
      bestiaryEnemies=Object.values(data.enemies||{});
      for(const source of bestiaryEnemies){
        if(!source.k||enemyMap.has(source.k))continue;
        const enemy={k:source.k,n:source.n||source.k,u:source.u||null,b:Boolean(source.b),x:Boolean(source.x)};
        enemyMap.set(source.k,enemy);
        if(enemy.n&&!enemyNameMap.has(enemy.n))enemyNameMap.set(enemy.n,{enemy,form:'normal'});
        if(enemy.u&&!enemyNameMap.has(enemy.u))enemyNameMap.set(enemy.u,{enemy,form:'ultimate'});
      }
      return bestiaryEnemies;
    }).catch(error=>{bestiaryPromise=null;throw error;});
    return bestiaryPromise;
  }
  async function ensureTaskSourceEnemies(items){
    if(bestiaryEnemies)return true;
    // Quest descriptions have no dedicated enemy-id field; detect task sources
    // by their documented q/c fields, then lazily enrich their named monsters.
    const needsMonsterMap=items.some(item=>(detailCache.get(item.c.toUpperCase())?.so||[]).some(source=>source.q===1&&source.c));
    if(!needsMonsterMap)return false;
    try{await ensureBestiary();return true;}catch(error){console.warn('Quest monster previews unavailable',error);return false;}
  }
  async function setRoute() {
    hideTooltip();
    const was = state.view, next = location.hash.startsWith('#items') ? 'items' : 'drops';
    if (was !== next) {
      routeMemory[was] = { query: state.query, search: search.value, filters: { ...state.filters }, scrollY: window.scrollY };
      state.view = next;
      const saved = routeMemory[next];
      state.query = saved?.query || ''; search.value = saved?.search || '';
      state.filters = { ...state.filters, ...(saved?.filters || {}) };
      state.page = 0;
    }
    if(state.view==='drops')await ensureGacha();
    if(language==='cn')await ensureTranslations();
    configureNav(); filtersUI(); render();
    const id = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
    if (state.view === 'items' && id) {
      state.filters.unique='all';state.query = id.toUpperCase(); search.value = state.query; render();
      openItemCategory(id.toUpperCase());
    } else if(!id&&routeMemory[state.view]?.pendingReturn) {
      const saved=routeMemory[state.view];
      state.query=saved.query||'';search.value=saved.search||'';
      state.filters={...state.filters,...(saved.filters||{})};state.page=0;saved.pendingReturn=false;
      render();requestAnimationFrame(()=>window.scrollTo(0,saved.scrollY||0));
    } else if(was!==next&&routeMemory[state.view]?.scrollY!=null) {
      requestAnimationFrame(()=>window.scrollTo(0,routeMemory[state.view].scrollY));
    }
  }
  function rowsDrops() {
    const groups = new Map();
    for (const [key, pool] of Object.entries(gacha.pools || {})) {
      const [enemyKey, ep, diff] = key.split('|');
      if (ep !== state.filters.ep || diff !== state.filters.diff) continue;
      const enemy = enemyMap.get(enemyKey); if (!enemy) continue;
      const form=diff==='3'&&enemy.u?'ultimate':'normal',activeName=form==='ultimate'?enemy.u:enemy.n;
      const drops = [
        ...(pool.g || []).map(row => ({ id: row[0], probability: row[2], category: gacha.names?.[Number(row[1])] || 'Rare' })),
        ...(pool.l || []).map(row => ({ id: row[0], probability: row[1], category: gacha.names?.[4] || 'Legendary' })),
        ...(pool.s || []).map(row => ({ id: row[0], probability: row[1], category: '' }))
      ];
      if(!drops.length)continue;
      const searchable = `${searchNames(activeName)} ${enemyKey} AAR ${fraction(pool.p)} ${drops.map(drop => `${searchNames(itemMap.get(drop.id)?.n)} ${itemName(drop.id)} ${searchNames(drop.category)} ${fraction(drop.probability)} ${percent(drop.probability)}`).join(' ')}`;
      if (state.query && !searchable.toLocaleLowerCase().includes(state.query.toLocaleLowerCase())) continue;
      const group = groups.get(enemyKey) || { enemy, kind: Number(pool.k ?? (enemy.b ? 2 : 0)), drops: [], aar: null };
      if(Number(pool.p)>0)group.aar=Number(pool.p);
      group.drops.push(...drops); groups.set(enemyKey, group);
    }
    const episode=Number(state.filters.ep),difficulty=Number(state.filters.diff);
    for(const source of bestiaryEnemies||[]){
      if(!(source.e||[]).includes(episode)||(source.d?.length&&!source.d.includes(difficulty)))continue;
      const specialGroups=(source.sd||[]).filter(section=>!section.d||section.d.includes(difficulty)).map(section=>({...section,g:(section.g||[]).filter(group=>group.i?.length)})).filter(section=>section.g.length);
      if(!specialGroups.length)continue;
      const enemy=enemyMap.get(source.k);if(!enemy)continue;
      const sourcePool=gacha.pools?.[`${source.k}|${episode}|${difficulty}`];
      const searchable=`${searchNames(enemy.n)} ${searchNames(enemy.u)} ${source.k} AAR ${fraction(sourcePool?.p)} ${specialGroups.flatMap(section=>[searchNames(section.h),searchNames(section.t),...(section.g||[]).flatMap(group=>[searchNames(group.n),searchNames(group.w),...(group.i||[]).flatMap(drop=>[searchNames(itemMap.get(String(drop.c).toUpperCase())?.n),drop.c,drop.r?.join('/'),drop.q])])]).join(' ')}`;
      if(state.query&&!searchable.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()))continue;
      const group=groups.get(source.k)||{enemy,kind:Number(source.b?2:0),drops:[],aar:null};
      if(Number(sourcePool?.p)>0)group.aar=Number(sourcePool.p);
      group.specialGroups=specialGroups;groups.set(source.k,group);
    }
    return [...groups.values()].filter(group=>group.drops.length||group.specialGroups?.some(section=>section.g?.some(tier=>tier.i?.length))).sort((a,b) => {
      const form=state.filters.diff==='3'?'ultimate':'normal';
      return enemyLabel(a.enemy,form).localeCompare(enemyLabel(b.enemy,form));
    });
  }
  function specialDropRate(rate,perContainer){
    if(!Array.isArray(rate)||rate.length<2||!Number(rate[1]))return '';
    const numerator=Number(rate[0])||1,denominator=Number(rate[1]);
    const chance=numerator/denominator,percentText=`${(chance*100).toFixed(chance*100<0.01?4:2)}%`;
    return `${numerator===1?'1':numerator}/${denominator.toLocaleString()} (${percentText})${perContainer?` ${t('perContainer','per container')}`:''}`;
  }
  function dropCardHtml(drop){
    const id=String(drop.id||'').toUpperCase(),item=itemMap.get(id),category=drop.category?`${esc(term(drop.category))} · `:'',rate=drop.rateText||(Number.isFinite(Number(drop.probability))?`${fraction(drop.probability)} · ${percent(drop.probability)}`:''),quantity=drop.quantity?` · ×${esc(drop.quantity)}`:'';
    const matched=searchMatches(item?.n,item?itemLabel(item):id,id,drop.category,rate),className=drop.category==='Legendary'||drop.tier===4?'legendary':rarity(id);
    return `<div class="drop ${matched?'search-hit':''}" data-item-id="${esc(id)}"><span class="icon-slot"><img loading="lazy" src="${iconUrl(item?.a)}" onerror="this.hidden=true"></span><div class="drop-info"><div class="item-name ${className}">${highlight(itemName(id))}</div><span class="rate">${category?highlight(term(drop.category))+' · ':''}${highlight(rate)}${quantity}</span></div></div>`;
  }
  function specialDropHtml(sections){
    const blocks=[];
    for(const section of sections||[]){
      const perContainer=/container/i.test(section.h||'');
      const cards=[];
      for(const group of section.g||[]){
        const category=group.n||gacha.names?.[Number(group.tier)]||'';
        for(const drop of group.i||[])cards.push(dropCardHtml({id:drop.c,category,tier:group.tier,rateText:specialDropRate(drop.r||group.r,perContainer),quantity:drop.q}));
      }
      if(cards.length){
        const title=section.h||section.g?.map(group=>group.w).find(Boolean)||'';
        blocks.push(`<section class="drop-special-group">${title?`<h4>${esc(term(title))}</h4>`:''}${section.t?`<p>${esc(term(section.t))}</p>`:''}<div class="drops">${cards.join('')}</div></section>`);
      }
    }
    return blocks.join('');
  }
  function enemyNameHtml(enemy,form='normal'){
    const source=form==='ultimate'&&enemy.u?enemy.u:enemy.n||'';
    const localized=enemyLabel(enemy,form);
    return `${highlight(localized)}${language==='cn'&&source!==localized?` <span class="enemy-name-en">${highlight(source)}</span>`:''}`;
  }
  function renderDrops() {
    if(!bestiaryEnemies&&!bestiaryPromise)ensureBestiary().then(()=>{if(state.view==='drops')renderDrops();}).catch(error=>console.error(error));
    const rows = rowsDrops();
    el.innerHTML = rows.length ? `<div class="table-wrap"><table class="data drop-data"><colgroup><col class="drop-monster-col"><col></colgroup><thead><tr><th>${t('monsterHeader','Monster')}</th><th>${t('dropsHeader','Drops')}</th></tr></thead><tbody>${rows.map(({enemy,drops,kind,specialGroups,aar})=>{
      const form=state.filters.diff==='3'&&enemy.u?'ultimate':'normal',activeName=form==='ultimate'?enemy.u:enemy.n;
      const special=specialDropHtml(specialGroups);
      return `<tr><td><span class="enemy ${searchMatches(activeName,enemy.k)?'search-hit':''}" data-enemy-id="${esc(enemy.k)}" data-form="${form}">${enemyNameHtml(enemy,form)}</span><div><span class="badge monster-kind monster-kind-${kind}">${t(`kind${kind}`,['Regular','Big','Boss','Rare'][kind]||'Regular')}</span>${aar?` <span class="aar-badge ${searchMatches('AAR',fraction(aar))?'search-hit':''}" title="Average Activation Rate">AAR ${highlight(fraction(aar))}</span>`:''}</div></td>
      <td>${drops.length?`<div class="drops">${drops.map(dropCardHtml).join('')}</div>`:''}${special}</td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="empty">${t('noDrops','No matching drop pools')}</div>`;
    status.textContent = `${rows.length.toLocaleString()} ${t('monsterGroups','monster groups')}`;
    $('#pager').replaceChildren();
  }
  function loadDetail(id) {
    id = String(id).toUpperCase(); const shard = id.slice(-1).toLowerCase();
    if (detailCache.has(id)) return Promise.resolve(detailCache.get(id));
    const key = `_promise${shard}`;
    if (!detailCache.has(key)) detailCache.set(key, fetch(`${ROOT}d${shard}.json`).then(response => { if(!response.ok) throw Error('shard unavailable'); return response.json(); }).then(data => { Object.entries(data).forEach(([itemId,detail]) => detailCache.set(itemId.toUpperCase(),detail)); return data; }).catch(() => ({})));
    return detailCache.get(key).then(() => detailCache.get(id) || null);
  }
  function sourceDescriptionHtml(source,includeTaskMonsterRefs=source.q===1){
    const raw=String(source.c||''),localized=String(term(raw));
    if(!raw||!localized)return esc(localized);
    const itemNameRanges=[...raw.matchAll(/\(([0-9a-f]{6})\)/gi)].map(match=>itemMap.get(match[1].toUpperCase())?.n).filter(Boolean);
    let nameSearchText=raw;
    for(const itemName of itemNameRanges)nameSearchText=nameSearchText.replace(new RegExp(itemName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),' ');
    const hasWholeName=(text,name)=>{
      const lower=text.toLocaleLowerCase(),textName=name.toLocaleLowerCase();let start=0,at;
      while((at=lower.indexOf(textName, start))!==-1){
        const before=lower[at-1]||'',after=lower[at+textName.length]||'';
        if(!/[a-z0-9]/i.test(before)&&!/[a-z0-9]/i.test(after)&&!/^['’]s\b/i.test(lower.slice(at+textName.length)))return true;
        start=at+1;
      }
      return false;
    };
    const aliases=new Map();
    if(includeTaskMonsterRefs)for(const enemy of enemyMap.values())for(const [form,name] of [['normal',enemy.n],['ultimate',enemy.u]]){
      if(!name||!hasWholeName(nameSearchText,name))continue;
      for(const alias of new Set([name,enemyLabel(enemy,form)].filter(Boolean)))if(!aliases.has(alias.toLocaleLowerCase()))aliases.set(alias.toLocaleLowerCase(),{kind:'enemy',id:enemy.k,form,alias});
    }
    if(!taskItemAliasIndex||taskItemAliasLanguage!==language){
      taskItemAliasIndex=new Map();
      for(const item of index.items)for(const alias of new Set([item.n,itemLabel(item)].filter(Boolean)))if(!taskItemAliasIndex.has(alias.toLocaleLowerCase()))taskItemAliasIndex.set(alias.toLocaleLowerCase(),{kind:'item',id:item.c.toUpperCase(),alias});
      taskItemAliasLanguage=language;
    }
    const itemAliases=taskItemAliasIndex;
    if(!taskItemAliasIndex.pattern||taskItemAliasIndex.patternLanguage!==language){
      taskItemAliasIndex.pattern=new RegExp([...itemAliases.keys()].sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gi');
      taskItemAliasIndex.patternLanguage=language;
    }
    const itemPattern=taskItemAliasIndex.pattern;
    for(const text of [raw,localized])for(const match of text.matchAll(itemPattern)){
      const entry=itemAliases.get(match[0].toLocaleLowerCase());
      const context=text.slice(Math.max(0,match.index-48),Math.min(text.length,match.index+match[0].length+48));
      const alias=entry?.alias.toLocaleLowerCase();
      const isTaskTitleToken=source.q===1&&(
        (alias==='genesis'&&/Project\s+C\.A\.R\.D\.\s*:\s*Genesis/i.test(context))||
        (['pioneer','先驱者'].includes(alias)&&/(?:Pioneer\s+Festival|先驱者庆典)/i.test(context))
      );
      if(isTaskTitleToken)continue;
      if(entry&&hasWholeName(text,entry.alias)&&!aliases.has(entry.alias.toLocaleLowerCase()))aliases.set(entry.alias.toLocaleLowerCase(),entry);
    }
    const names=[...aliases.values()].sort((a,b)=>b.alias.length-a.alias.length);
    if(!names.length)return highlight(localized);
    const pattern=new RegExp(names.map(entry=>entry.alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gi');
    let html='',cursor=0;
    for(const match of localized.matchAll(pattern)){
      html+=highlight(localized.slice(cursor,match.index));
      const entry=aliases.get(match[0].toLocaleLowerCase());
      if(entry?.kind==='enemy')html+=`<span class="source-monster-ref" data-enemy-id="${esc(entry.id)}" data-form="${entry.form}">${highlight(match[0])}</span>`;
      else if(entry?.kind==='item')html+=`<span class="source-item-ref" data-item-id="${esc(entry.id)}">${highlight(match[0])}</span>`;
      else html+=esc(match[0]);
      cursor=match.index+match[0].length;
    }
    return html+highlight(localized.slice(cursor));
  }
  function sourceHtml(detail,isMag=false) {
    if (!detail) return `<span class="sub">${t('loadingSources','Loading sources…')}</span>`;
    const formatEpisodeMode=value=>{
      const raw=String(value||'').trim();
      if(/(?:episode\s*)?(?:n\/?a|not applicable|not available|none|unknown)/i.test(raw))return '';
      return raw.replace(/Episode\s+(\d+)/gi,(_,episode)=>t(`ep${episode}`,`Episode ${episode}`)).replace(/,\s*/g,' · ').split(' · ').map(part=>/^EP\d+$/i.test(part)?part:term(part.trim())).join(' · ');
    };
    const formatRate=value=>{
      const rate=String(value||'').trim();
      const match=rate.match(/^(.*?)\s+per\s+(.+)$/i);
      if(!match)return term(rate);
      const key=match[2].toLowerCase().replace(/\s+/g,'');
      const phrase={container:'perContainer',roll:'perRoll',box:'perBox',secretticket:'perSecretTicket'}[key];
      return `${match[1]} ${phrase?t(phrase,`per ${match[2]}`):`per ${term(match[2])}`}`;
    };
    const quests=[],otherSources=[];
    for(const source of detail.so||[]){
      // Some non-quest records store a full instruction sentence in `t`
      // instead of `c` (for example combination and boss sources).
      const description=source.c||(!source.q&&source.t&&/[.!?;]/.test(source.t)?source.t:'');
      const sourceName=description===source.t?(source.k||'Other'):(source.t||source.k||'Other');
      const localizedSourceName=source.q?sourceName:term(sourceName),name=highlight(localizedSourceName);
      const episodeMode=source.m?formatEpisodeMode(source.m):'';
      const meta=episodeMode?` <span class="quest-source__meta ${searchMatches(source.m,episodeMode)?'search-hit':''}">(${highlight(episodeMode)})</span>`:'';
      const rate=source.r?`<div class="quest-source__rate ${searchMatches(source.r,formatRate(source.r))?'search-hit':''}">${highlight(formatRate(source.r))}</div>`:'';
      const note=description?`<div class="quest-source__note ${searchMatches(description,term(description))?'search-hit':''}">${sourceDescriptionHtml({...source,c:description})}</div>`:'';
      const html=`<article class="quest-source"><div class="quest-source__name ${searchMatches(sourceName,localizedSourceName)?'search-hit':''}">${name}${meta}</div>${rate}${note}</article>`;
      (source.q?quests:otherSources).push(html);
    }
      const monsterGroups=new Map();
    for(const drop of detail.dr||[]){
      const episode=Number(drop[0]),diff=Number(drop[2]),enemy=index.enemies[Number(drop[3])];
      if(!enemy)continue;
      const enemyName=diff===3&&enemy.u?enemy.u:enemy.n;
      const groupKey=`${episode}|${diff}`;
      const pool=gacha?.pools?.[`${enemy.k}|${episode}|${diff}`];
      let probability=null;
      for(const tier of ['g','l','s']){
        const found=(pool?.[tier]||[]).find(row=>String(row[0]).toUpperCase()===currentSourceItemId);
        if(!found)continue;
        if(tier==='g'){
          const tag=(pool.t||[]).find(entry=>Number(entry[0])===Number(found[1]));
          if(tag&&Number(tag[2])>0)probability=1/Number(tag[2]);
        }
        if(probability==null&&Number(found[tier==='g'?2:1])>0)probability=Number(found[tier==='g'?2:1]);
        break;
      }
      const group=monsterGroups.get(groupKey)||{episode,diff,enemies:new Map()};
      group.enemies.set(enemy.k,{name:enemyName,form:diff===3&&enemy.u?'ultimate':'normal',probability});monsterGroups.set(groupKey,group);
    }
    const questGroup=quests.length?`<section class="source-section source-section--quests"><h4>${t('quest','Quest sources')}</h4>${quests.join('')}</section>`:'';
    const otherGroup=otherSources.length?`<section class="source-section source-section--other"><h4>${isMag?t('magOtherSources','Feeding Method'):t('otherSources','Other sources')}</h4>${otherSources.join('')}</section>`:'';
    const episodes=[...monsterGroups.values()].sort((a,b)=>a.episode-b.episode||a.diff-b.diff);
    const monsterHtml=episodes.length?`<section class="source-section source-section--monsters"><h4>${t('monsterDrops','Monster drops')}</h4><div class="monster-source-grid">${episodes.map(group=>`<div class="source-episode"><h5>${highlight(`${t(`ep${group.episode}`,`EP${group.episode}`)} · ${t(`diff${group.diff}`,index.difficulties[group.diff]||'')}`)}</h5>${[...group.enemies.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([enemyId,enemy])=>{const label=term(enemy.name),matched=searchMatches(enemy.name,label);return `<div class="source-entry"><span class="source-entry__name ${matched?'search-hit':''}" data-enemy-id="${esc(enemyId)}" data-form="${enemy.form}">${highlight(label)}</span>${enemy.probability?`<span class="source-entry__rate ${searchMatches(fraction(enemy.probability))?'search-hit':''}">${highlight(fraction(enemy.probability))}</span>`:''}</div>`;}).join('')}</div>`).join('')}</div></section>`:'';
    return questGroup+otherGroup+monsterHtml||`<span class="sub">${t('noSources','No listed source')}</span>`;
  }
  let currentSourceItemId='';
  function itemRow(item) {
    const id=item.c.toUpperCase(), info=detailCache.get(id);
    const rawUnique=info?.un??info?.us,hasRealUnique=(Array.isArray(rawUnique)?rawUnique:(rawUnique?[rawUnique]:[])).some(entry=>entry?.l!=='Weapon type');
    const uniques=uniqueList(item,info),synthetic=Boolean(item.o&&info?.sp&&!hasRealUnique);
    const matchingSpecial=Boolean(info?.sp&&uniques.some(entry=>{
      const name=String(entry.n||'').trim();
      if(name.toLocaleLowerCase()===String(info.sp).trim().toLocaleLowerCase())return true;
      if(!/^unique (?:attacks|special)$/i.test(String(entry.l||'')))return false;
      return normalizeSpecialName(name)===normalizeSpecialName(info.sp);
    }));
    currentSourceItemId=id;
    const shownName=itemLabel(item),grind=info?.mg!=null?`+${info.mg}`:'';
    const typeLabel=term(item.t||item.g||'Item'),nameMatched=searchMatches(item.n,shownName,id,grind,info?.mg),typeMatched=searchMatches(item.t,item.g,categoryFor(item),typeFor(item));
    const requirementMatched=searchMatches(...(info?.rq||[]),...(info?.cl||[]),...Object.values(info?.st||{}).flat());
    const effectMatched=searchMatches(info?.sp,term(info?.sp||''));
    const effectHtml=info?.sp&&!synthetic&&!matchingSpecial?`<span class="effect-name ${effectMatched?'search-hit':''}" data-item-id="${esc(id)}">${highlight(term(info.sp))}</span>`:'';
    const uniqueHtml=uniques.map((entry,index)=>{
      const uniqueName=synthetic?term(entry.n):uniqueText(id,entry,index,'name');
      const uniqueDescription=synthetic?(Array.isArray(entry.t)?entry.t.map(term).join(' '):term(entry.t)):uniqueText(id,entry,index,'description');
      const matched=searchMatches(uniqueName,uniqueDescription,uniqueText(id,entry,index,'type'));
      return `<span class="unique-name ${matched?'search-hit':''}" data-unique-id="${esc(id)}" data-unique-index="${index}">${highlight(uniqueName)}</span>`;
    }).join('');
    return `<tr class="item-row" data-row-id="${esc(id)}"><td><div class="item-cell"><span class="icon-slot"><img class="item-icon" loading="lazy" src="${iconUrl(item.a)}" onerror="this.hidden=true"></span><div class="item-name-block ${nameMatched||requirementMatched?'search-hit':''}"><span class="item-name ${rarity(id)}" data-item-id="${esc(id)}">${highlight(`${shownName}${grind}`)}</span>${language==='cn'&&shownName!==item.n?`<span class="item-name-en">${highlight(`${item.n}${grind}`)}</span>`:''}<div class="star"><span class="star-type ${typeMatched?'search-hit':''}">${highlight(typeLabel)}</span> · <span class="${searchMatches(item.s,`${item.s}★`)?'search-hit':''}">${highlight(`${item.s||0}★`)}</span></div></div></div></td>
      <td class="effect-cell">${effectHtml}${uniqueHtml}</td>
      <td class="source-cell">${sourceHtml(info,item.g==='Mags')}</td></tr>`;
  }
  function categoryData() {
    const groups=new Map();
    for(const item of index.items){
      if(item.t==='Technique Disk')continue;
      if(state.filters.unique==='yes'&&!item.u&&!syntheticUniqueIds.has(item.c.toUpperCase()))continue;
      const haystack=`${searchNames(item.n)} ${item.c} ${searchNames(item.g)} ${searchNames(item.t)} ${searchNames(categoryFor(item))} ${searchNames(typeFor(item))} ${itemLabel(item)}`;
      if(state.query&&!haystack.toLocaleLowerCase().includes(state.query.toLocaleLowerCase())&&!detailSearchMatches(item,detailCache.get(item.c.toUpperCase())))continue;
      const category=categoryFor(item),type=typeFor(item);
      if(!groups.has(category))groups.set(category,new Map());
      const types=groups.get(category);if(!types.has(type))types.set(type,[]);types.get(type).push(item);
    }
    return groups;
  }
  const categoryOrder=['Weapons','Armor','Shields','Units','Mags','Other'];
  const leafCategories=new Set(['Armor','Shields','Units','Mags','Other']);
  function equipmentTable(items){const first=items[0],isMag=first?.g==='Mags';return `<div class="table-wrap"><table class="data equipment-data"><colgroup><col class="equipment-name-col"><col class="equipment-effect-col"><col class="equipment-source-col"></colgroup><thead><tr><th>${t('equipmentHeader','Equipment')}</th><th>${t('specialEffectsHeader','Special Effects')}</th><th>${isMag?t('magSourcesHeader','Sources'):t('sourcesHeader','Drop Sources')}</th></tr></thead><tbody>${items.map(itemRow).join('')}</tbody></table></div>`;}
  async function populateEquipment(mount,items){
    await ensureGacha();
    if(state.filters.unique==='all'){
      mount.innerHTML=items.length?equipmentTable(items):`<div class="empty">${t('noItems','No matching equipment')}</div>`;
      items.forEach(item=>loadDetail(item.c).then(async()=>{
        await ensureTaskSourceEnemies([item]);
      }).catch(error=>console.warn(`Could not load details for ${item.c}`,error)).finally(()=>{
        const row=mount.querySelector(`[data-row-id="${CSS.escape(item.c.toUpperCase())}"]`);
        if(row){const buffer=document.createElement('tbody');buffer.innerHTML=itemRow(item);row.replaceWith(buffer.firstElementChild);}
      }));
      return;
    }
    mount.innerHTML=`<div class="loading-group">${t('loadingDetails','Loading this equipment group…')}</div>`;
    await Promise.all(items.map(item=>loadDetail(item.c)));
    await ensureTaskSourceEnemies(items);
    if(!mount.isConnected)return;
            const visible=items.filter(item=>{const hasUnique=uniqueList(item,detailCache.get(item.c.toUpperCase())).length>0;return state.filters.unique==='yes'?hasUnique:!hasUnique;});
    mount.innerHTML=visible.length?equipmentTable(visible):`<div class="empty">${t('noItems','No matching equipment')}</div>`;
  }
  function renderItems() {
    const groups=categoryData();
    const categoryNames=[...groups.keys()].sort((a,b)=>{
      const ai=categoryOrder.indexOf(a),bi=categoryOrder.indexOf(b);
      return (ai<0?categoryOrder.length:ai)-(bi<0?categoryOrder.length:bi)||a.localeCompare(b);
    });
    el.innerHTML=categoryNames.length?categoryNames.map(category=>{
      const types=groups.get(category), categoryKey=`category:${category}`;
      const items=[...types.values()].flat();
      return `<details class="category-group ${leafCategories.has(category)?'category-group--leaf':''}" data-category-group="${esc(category)}" data-group-key="${esc(categoryKey)}"><summary class="category-heading ${searchMatches(category,term(category))?'search-hit':''}">${highlight(term(category))}<span>${items.length}</span></summary><div class="category-contents"></div></details>`;
    }).join(''):`<div class="empty">${t('noItems','No matching equipment')}</div>`;
    const total=[...groups.values()].reduce((n,types)=>n+[...types.values()].reduce((sum,list)=>sum+list.length,0),0);
    status.textContent=`${total.toLocaleString()} ${t('equipmentCount','equipment')}`;
    $('#pager').replaceChildren();
    el.querySelectorAll('.category-group').forEach(categoryNode=>{
      const category=categoryNode.dataset.categoryGroup;
      categoryNode.open=Boolean(state.query)||openCategories.has(category);
      categoryNode.addEventListener('toggle',()=>{
        if(!categoryNode.open){openCategories.delete(category);return;}
        openCategories.add(category);
        const mount=categoryNode.querySelector('.category-contents');
        if(mount.dataset.rendered==='true')return;
        mount.dataset.rendered='true';
        const types=groups.get(category);
        if(leafCategories.has(category)){
          populateEquipment(mount,[...types.values()].flat());
          return;
        }
        mount.innerHTML=[...types.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([type,items])=>{
          const key=`${category}|${type}`;
          return `<details class="type-group" data-type-group="${esc(key)}"><summary class="type-heading ${searchMatches(type,term(type))?'search-hit':''}">${highlight(term(type))}<span>${items.length}</span></summary><div class="type-items"></div></details>`;
        }).join('');
        mount.querySelectorAll('.type-group').forEach(typeNode=>{
          const [,type]=typeNode.dataset.typeGroup.split('|');
          typeNode.open=Boolean(state.query)||openTypes.has(typeNode.dataset.typeGroup);
          typeNode.addEventListener('toggle',async()=>{
            const key=typeNode.dataset.typeGroup;
            if(!typeNode.open){openTypes.delete(key);return;}
            openTypes.add(key);
            const typeMount=typeNode.querySelector('.type-items'),items=groups.get(category)?.get(type)||[];
            if(typeMount.dataset.loaded==='true')return;
            typeMount.dataset.loaded='true';
            await populateEquipment(typeMount,items);
          });
          if(typeNode.open)typeNode.dispatchEvent(new Event('toggle'));
        });
      });
      if(categoryNode.open){
        const event=new Event('toggle');categoryNode.dispatchEvent(event);
      }
    });
  }
  function render() { if(!index)return; hideTooltip();configureNav();filtersUI();state.view==='drops'?renderDrops():renderItems(); }
  function openItemCategory(id) {
    const item=itemMap.get(id);if(!item)return;
    const categoryName=categoryFor(item),category=el.querySelector(`[data-category-group="${CSS.escape(categoryName)}"]`);
    if(!category)return;
    category.open=true;category.dispatchEvent(new Event('toggle'));
    const find=()=>{const row=el.querySelector(`[data-row-id="${CSS.escape(id)}"]`);if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.add('target');setTimeout(()=>row.classList.remove('target'),2000);}};
    if(leafCategories.has(categoryName)){
      const candidates=index.items.filter(candidate=>categoryFor(candidate)===categoryName&&candidate.t!=='Technique Disk');
      Promise.all(candidates.map(candidate=>loadDetail(candidate.c))).then(find);
      return;
    }
    const typeName=typeFor(item),type=el.querySelector(`[data-type-group="${CSS.escape(categoryName)}|${CSS.escape(typeName)}"]`);
    if(type){type.open=true;type.dispatchEvent(new Event('toggle'));Promise.all(index.items.filter(candidate=>categoryFor(candidate)===categoryName&&typeFor(candidate)===typeName).map(candidate=>loadDetail(candidate.c))).then(find);}
  }
  function renderItemTip(id) {
    const item=itemMap.get(id),detail=detailCache.get(id),stats=Object.entries(detail?.st||{}).map(([key,value])=>`${statName(key)}: ${Array.isArray(value)?value.join('–'):value}`).join(' · ');
    tip.innerHTML=`<div class="tip-head"><span class="icon-slot icon-slot--large"><img src="${iconUrl(item?.a)}" onerror="this.hidden=true"></span><div class="${rarity(id)}">${highlight(item?itemLabel(item):id)}<div class="sub">${highlight(term(item?.g||''))} · ${highlight(term(item?.t||''))} · ${item?.s||0}★</div></div></div>${stats?`<div class="tip-meta">${highlight(stats)}${detail?.rq?.length?`<br>${t('requirements','Requirements')}: ${highlight(detail.rq.map(formatRequirement).join(', '))}`:''}${detail?.cl?.length?`<br>${t('classes','Classes')}: ${highlight(detail.cl.map(term).join(', '))}`:''}${detail?.mg!=null?`<br>${t('maxGrind','Max grind')}: +${highlight(detail.mg)}`:''}</div>`:detail?.rq?.length?`<div class="tip-meta">${t('requirements','Requirements')}: ${highlight(detail.rq.map(formatRequirement).join(', '))}</div>`:''}${detail?.sp?`<div class="tip-meta">EX · ${highlight(term(detail.sp))}</div>`:''}${detail?.ef?.length?`<section class="tip-effects"><h4>${t('effectDetails','Effect details')}</h4>${bulletLines(detail.ef).map(effect=>`<div class="tip-effect-entry">- ${highlight(term(effect))}</div>`).join('')}</section>`:''}`;
  }
  function showItemTip(id) {
    tip.dataset.current=id;
    renderItemTip(id);
    if(!detailCache.has(id))loadDetail(id).then(()=>{if(tip.style.display==='block'&&tip.dataset.current===id)renderItemTip(id);});
  }
  function positionTip(x,y){
    const rect=tip.getBoundingClientRect();
    const left=x+rect.width+18>innerWidth?x-rect.width-16:x+16;
    const below=y+rect.height+18<=innerHeight;
    const preferredTop=below?y+16:y-rect.height-16;
    tip.style.left=`${Math.max(8,Math.min(innerWidth-rect.width-8,left))}px`;
    tip.style.top=`${Math.max(8,Math.min(innerHeight-rect.height-8,preferredTop))}px`;
  }
  function hideTooltip(){tip.dataset.current='';tip.style.display='none';tip.setAttribute('aria-hidden','true');tip.replaceChildren();}
  function showUniqueTip(id,index,x,y){
    const item=itemMap.get(id),detail=detailCache.get(id),entry=uniqueList(item,detail)[index];
    if(!entry)return;
    const synthetic=Boolean(item?.o&&detail?.sp&&entry.n===detail.sp);
    const title=synthetic?term(entry.n):uniqueText(id,entry,index,'name');
    const kind=synthetic?term(entry.l||'Unique EX'):uniqueText(id,entry,index,'type');
    const description=synthetic?(Array.isArray(entry.t)?entry.t.map(term):term(entry.t)):uniqueText(id,entry,index,'description');
    const descriptionHtml=bulletLines(description).map(line=>`<div>- ${highlight(line)}</div>`).join('');
    tip.innerHTML=`<div class="tip-unique"><b>${highlight(title)}${kind?` · ${highlight(kind)}`:''}</b>${descriptionHtml}</div>`;
    tip.dataset.current=`unique:${id}:${index}`;tip.style.display='block';tip.setAttribute('aria-hidden','false');positionTip(x,y);
    if(!detailCache.has(id))loadDetail(id).then(()=>{if(tip.dataset.current===`unique:${id}:${index}`)showUniqueTip(id,index,x,y);});
  }
  function showTooltip(target,x,y){
    if(target.dataset.itemId){showItemTip(target.dataset.itemId.toUpperCase());}
    else if(target.dataset.uniqueId){showUniqueTip(target.dataset.uniqueId.toUpperCase(),Number(target.dataset.uniqueIndex||0),x,y);}
    else if(target.dataset.enemyId){
      const id=target.dataset.enemyId,enemy=enemyMap.get(id),ultimate=target.dataset.form==='ultimate',key=`enemy:${id}:${ultimate?'u':'n'}`;
      const image=new Image();image.className='tip-visual';image.alt='';
      tip.dataset.current=key;tip.style.display='none';
      image.onload=()=>{if(tip.dataset.current!==key)return;tip.innerHTML=`<div class="tip-head">${esc(enemy?enemyLabel(enemy,ultimate?'ultimate':'normal'):id)}</div>`;tip.append(image);tip.style.display='block';tip.setAttribute('aria-hidden','false');positionTip(x,y);};
      image.onerror=()=>{if(tip.dataset.current===key){tip.replaceChildren();tip.dataset.current='';tip.style.display='none';tip.setAttribute('aria-hidden','true');}};
      image.src=`${ART}enemies/${encodeURIComponent(id)}${ultimate?'-u':''}.webp`;
      return;
    }
    else return;
    tip.style.display='block';tip.setAttribute('aria-hidden','false');positionTip(x,y);
  }
  async function initialize(){
    try{
      const indexResponse=await fetch(`${ROOT}index.json`);
      if(!indexResponse.ok)throw Error('Could not load wiki index');
      index=await indexResponse.json();
      index.items.forEach(item=>{itemMap.set(item.c.toUpperCase(),item);if(!itemNameMap.has(item.n))itemNameMap.set(item.n,item);});
      index.enemies.forEach(enemy=>{if(!enemy.k)return;enemyMap.set(enemy.k,enemy);if(enemy.n&&!enemyNameMap.has(enemy.n))enemyNameMap.set(enemy.n,{enemy,form:'normal'});if(enemy.u&&!enemyNameMap.has(enemy.u))enemyNameMap.set(enemy.u,{enemy,form:'ultimate'});});
      if(language==='cn')await ensureTranslations();
      const validHash=location.hash.startsWith('#items')||location.hash.startsWith('#drops');if(!validHash)history.replaceState(null,'','#drops');
      await setRoute();status.textContent=t('ready','Ready');
      document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>applyLanguage(button.dataset.language).catch(error=>{console.error(error);status.textContent='中文词条读取失败';})));
      document.querySelectorAll('[data-language]').forEach(button=>{button.classList.toggle('is-active',button.dataset.language===language);button.setAttribute('aria-pressed',String(button.dataset.language===language));});
    }catch(error){status.textContent='数据加载失败：请通过本地 HTTP 服务打开页面，例如 python -m http.server 8765。';console.error(error);}
  }
  let debounce;
  search.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(async()=>{
    state.query=search.value.trim();
    if(state.query&&/[^\x00-\x7F]/.test(state.query)&&!Object.keys(translations).length){try{await ensureTranslations();}catch(error){console.error(error);}}
    render();
    if(state.view==='items'&&state.query){const queryAtStart=state.query;ensureSearchDetails().then(()=>{if(state.view==='items'&&state.query===queryAtStart)render();}).catch(error=>console.error('Search detail loading failed',error));}
  },160);});
  document.addEventListener('change',event=>{
    if(!event.target.matches('[data-filter]'))return;
    state.filters[event.target.dataset.filter]=event.target.dataset.filter==='unique'?(event.target.checked?'yes':'all'):event.target.value;
    render();
  });
  document.addEventListener('click',event=>{
    const ep=event.target.closest('[data-drop-ep]'),diff=event.target.closest('[data-drop-diff]');
    if(ep){state.filters.ep=ep.dataset.dropEp;render();return;}
    if(diff){state.filters.diff=diff.dataset.dropDiff;render();return;}
    const sourceItem=event.target.closest('.source-item-ref[data-item-id]');
    const item=sourceItem||event.target.closest('[data-item-id]');
    if(item&&(sourceItem||state.view==='drops')){
      if(state.view==='items')routeMemory.items={query:state.query,search:search.value,filters:{...state.filters},scrollY:window.scrollY,pendingReturn:true};
      hideTooltip();location.hash=`items?id=${encodeURIComponent(item.dataset.itemId.toUpperCase())}`;return;
    }
  });
  document.addEventListener('mouseover',event=>{const target=event.target.closest('[data-item-id],[data-unique-id],[data-enemy-id]');if(!target||target.contains(event.relatedTarget))return;showTooltip(target,event.clientX,event.clientY);});
  document.addEventListener('mousemove',event=>{if(tip.style.display==='block')positionTip(event.clientX,event.clientY);});
  document.addEventListener('mouseout',event=>{const target=event.target.closest('[data-item-id],[data-unique-id],[data-enemy-id]');if(target&&!target.contains(event.relatedTarget))hideTooltip();});
  window.addEventListener('hashchange',setRoute);
  document.addEventListener('keydown',event=>{if(event.key==='/'&&document.activeElement!==search){event.preventDefault();search.focus();}});
  initialize();
})();
