(() => {
  'use strict';
  const ROOT = 'alterapso/alterapso_data/glossary-data/';
  const ART = 'https://alterapso.com/glossary-data/';
  const $ = selector => document.querySelector(selector);
  const el = $('#content'), search = $('#search'), tip = $('#tooltip'), status = $('#status');
  const detailCache = new Map(), itemMap = new Map(), enemyMap = new Map(), itemNameMap = new Map(), enemyNameMap = new Map();
  const legendaryIds = new Set(['00070E','000D09','000D0B','001D00','001E00','002002','003300','003601','008B05','00C001','010160','010162','010227','0102A9','030E01','03100B']);
  const syntheticUniqueIds = new Set(['00DD0A','008B05','002002','006E02','006E03','00B102','00B101','00DD0B','00070E','002602','002601','000D07','000D09','000D04','000D08','000D06']);
  const state = { view: 'drops', page: 0, query: '', filters: { ep: '1', diff: '0', unique: 'all' } };
  const routeMemory = {};
  let index, gacha, translations = {}, language = localStorage.getItem('wiki-language') || 'en', gachaPromise;
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
  const localizedTerm = value => {
    if(!value)return '';
    const mapped = mappedText(translations.categories?.[value]) || mappedText(translations.types?.[value]) || mappedText(translations.terms?.[value]);
    if(mapped?.trim())return mapped.trim();
    const item=itemNameMap.get(value);if(item)return mappedText(translations.items?.[item.c.toUpperCase()])?.trim()||value;
    const enemyForm=enemyNameMap.get(value);if(enemyForm){const entry=translations.enemies?.[enemyForm.enemy.k],mapped=enemyForm.form==='ultimate'?entry?.ultimate:entry?.normal;return mappedText(mapped)?.trim()||value;}
    return fallbackCn(value);
  };
  const term = value => !value?'':language==='cn'?localizedTerm(value):value;
  const searchNames = value => `${value || ''} ${localizedTerm(value)}`.toLocaleLowerCase();
  const searchMatches = (...values) => Boolean(state.query&&values.some(value=>searchNames(String(value??'')).includes(state.query.toLocaleLowerCase())));
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
    return translation||fallbackCn(source);
  };
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
    if (!ensureTranslations.promise) ensureTranslations.promise=fetch('cn.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('Chinese translations unavailable');return response.json();}).then(data=>{translations=data;});
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
  async function setRoute() {
    hideTooltip();
    const was = state.view, next = location.hash.startsWith('#items') ? 'items' : 'drops';
    if (was !== next) {
      routeMemory[was] = { query: state.query, search: search.value, filters: { ...state.filters } };
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
        ...(pool.g || []).map(row => ({ id: row[0], probability: row[2], category: 'Rare' })),
        ...(pool.l || []).map(row => ({ id: row[0], probability: row[1], category: 'Legendary' })),
        ...(pool.s || []).map(row => ({ id: row[0], probability: row[1], category: 'Extra' }))
      ];
      const searchable = `${searchNames(activeName)} ${enemyKey} ${drops.map(drop => `${searchNames(itemMap.get(drop.id)?.n)} ${itemName(drop.id)}`).join(' ')}`;
      if (state.query && !searchable.toLocaleLowerCase().includes(state.query.toLocaleLowerCase())) continue;
      const group = groups.get(enemyKey) || { enemy, kind: Number(pool.k ?? (enemy.b ? 2 : 0)), drops: [] };
      group.drops.push(...drops); groups.set(enemyKey, group);
    }
    return [...groups.values()].sort((a,b) => {
      const form=state.filters.diff==='3'?'ultimate':'normal';
      return enemyLabel(a.enemy,form).localeCompare(enemyLabel(b.enemy,form));
    });
  }
  function enemyNameHtml(enemy,form='normal'){
    const source=form==='ultimate'&&enemy.u?enemy.u:enemy.n||'';
    const localized=enemyLabel(enemy,form);
    return `${highlight(localized)}${language==='cn'&&source!==localized?` <span class="enemy-name-en">${highlight(source)}</span>`:''}`;
  }
  function renderDrops() {
    const rows = rowsDrops();
    el.innerHTML = rows.length ? `<div class="table-wrap"><table class="data drop-data"><colgroup><col class="drop-monster-col"><col></colgroup><thead><tr><th>${t('monsterHeader','Monster')}</th><th>${t('dropsHeader','Drops')}</th></tr></thead><tbody>${rows.map(({enemy,drops,kind})=>{
      const form=state.filters.diff==='3'&&enemy.u?'ultimate':'normal',activeName=form==='ultimate'?enemy.u:enemy.n;
      return `<tr><td><span class="enemy ${searchMatches(activeName,enemy.k)?'search-hit':''}" data-enemy-id="${esc(enemy.k)}" data-form="${form}">${enemyNameHtml(enemy,form)}</span><div><span class="badge monster-kind monster-kind-${kind}">${t(`kind${kind}`,['Regular','Big','Boss','Rare'][kind]||'Regular')}</span></div></td>
      <td><div class="drops">${drops.map(drop => { const item=itemMap.get(drop.id), className=drop.category==='Legendary'?'legendary':rarity(drop.id),matched=searchMatches(item?.n,item?itemLabel(item):drop.id,drop.id); return `<div class="drop ${matched?'search-hit':''}" data-item-id="${esc(drop.id)}"><span class="icon-slot"><img loading="lazy" src="${iconUrl(item?.a)}" onerror="this.hidden=true"></span><div class="drop-info"><div class="item-name ${className}">${highlight(itemName(drop.id))}</div><span class="rate">${t(`drop${drop.category}`,drop.category)} · ${fraction(drop.probability)} · ${percent(drop.probability)}</span></div></div>`; }).join('')}</div></td></tr>`;
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
  function sourceHtml(detail,isMag=false) {
    if (!detail) return `<span class="sub">${t('loadingSources','Loading sources…')}</span>`;
    const formatEpisodeMode=value=>String(value||'').replace(/Episode\s+(\d+)/gi,(_,episode)=>t(`ep${episode}`,`Episode ${episode}`)).replace(/,\s*/g,' · ').split(' · ').map(part=>/^EP\d+$/i.test(part)?part:term(part.trim())).join(' · ');
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
      const name=esc(term(source.t||source.k||'Other'));
      const meta=source.m?` <span class="quest-source__meta">(${esc(formatEpisodeMode(source.m))})</span>`:'';
      const rate=source.r?`<div class="quest-source__rate">${esc(formatRate(source.r))}</div>`:'';
      const note=source.c?`<div class="quest-source__note">${esc(term(source.c))}</div>`:'';
      const html=`<article class="quest-source"><div class="quest-source__name">${name}${meta}</div>${rate}${note}</article>`;
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
    const monsterHtml=episodes.length?`<section class="source-section source-section--monsters"><h4>${t('monsterDrops','Monster drops')}</h4><div class="monster-source-grid">${episodes.map(group=>`<div class="source-episode"><h5>${t(`ep${group.episode}`,`EP${group.episode}`)} <span>· ${t(`diff${group.diff}`,index.difficulties[group.diff]||'')}</span></h5>${[...group.enemies.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([enemyId,enemy])=>`<div class="source-entry"><span class="source-entry__name" data-enemy-id="${esc(enemyId)}" data-form="${enemy.form}">${esc(term(enemy.name))}</span><span class="source-entry__rate">${enemy.probability?fraction(enemy.probability):'—'}</span></div>`).join('')}</div>`).join('')}</div></section>`:'';
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
    const typeLabel=term(item.t||item.g||'Item'),nameMatched=searchMatches(item.n,shownName,id),typeMatched=searchMatches(item.t,item.g,categoryFor(item),typeFor(item));
    return `<tr class="item-row" data-row-id="${esc(id)}"><td><div class="item-cell"><span class="icon-slot"><img class="item-icon" loading="lazy" src="${iconUrl(item.a)}" onerror="this.hidden=true"></span><div class="item-name-block ${nameMatched?'search-hit':''}"><span class="item-name ${rarity(id)}" data-item-id="${esc(id)}">${highlight(`${shownName}${grind}`)}</span>${language==='cn'&&shownName!==item.n?`<span class="item-name-en">${highlight(`${item.n}${grind}`)}</span>`:''}<div class="star">${'★'.repeat(Math.min(12,item.s||0))} · <span class="star-type ${typeMatched?'search-hit':''}">${highlight(typeLabel)}</span> · ${item.s||0}★</div></div></div></td>
      <td class="effect-cell">${info?.sp&&!synthetic&&!matchingSpecial?`<span class="effect-name">${esc(term(info.sp))}</span>`:''}${uniques.map((entry,index)=>`<span class="unique-name" data-unique-id="${esc(id)}" data-unique-index="${index}">${esc(synthetic?term(entry.n):uniqueText(id,entry,index,'name'))}</span>`).join('')}</td>
      <td class="source-cell">${sourceHtml(info,item.g==='Mags')}</td></tr>`;
  }
  function categoryData() {
    const groups=new Map();
    for(const item of index.items){
      if(item.t==='Technique Disk')continue;
      if(state.filters.unique==='yes'&&!item.u&&!syntheticUniqueIds.has(item.c.toUpperCase()))continue;
      const haystack=`${searchNames(item.n)} ${item.c} ${searchNames(item.g)} ${searchNames(item.t)} ${searchNames(categoryFor(item))} ${searchNames(typeFor(item))} ${itemLabel(item)}`;
      if(state.query&&!haystack.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()))continue;
      const category=categoryFor(item),type=typeFor(item);
      if(!groups.has(category))groups.set(category,new Map());
      const types=groups.get(category);if(!types.has(type))types.set(type,[]);types.get(type).push(item);
    }
    return groups;
  }
  const categoryOrder=['Weapons','Armor','Shields','Units','Mags','Other'];
  const leafCategories=new Set(['Armor','Shields','Units','Mags','Other']);
  function equipmentTable(items){const first=items[0],isWeapon=first&&categoryFor(first)==='Weapons',isMag=first?.g==='Mags';return `<div class="table-wrap"><table class="data equipment-data"><colgroup><col class="equipment-name-col"><col class="equipment-effect-col"><col class="equipment-source-col"></colgroup><thead><tr><th>${t('equipmentHeader','Equipment')}</th><th>${isWeapon?t('effectHeader','EX Attack'):t('specialEffectsHeader','Special Effects')}</th><th>${isMag?t('magSourcesHeader','Sources'):t('sourcesHeader','Drop Sources')}</th></tr></thead><tbody>${items.map(itemRow).join('')}</tbody></table></div>`;}
  async function populateEquipment(mount,items){
    await ensureGacha();
    if(state.filters.unique==='all'){
      mount.innerHTML=items.length?equipmentTable(items):`<div class="empty">${t('noItems','No matching equipment')}</div>`;
      items.forEach(item=>loadDetail(item.c).then(()=>{
        const row=mount.querySelector(`[data-row-id="${CSS.escape(item.c.toUpperCase())}"]`);
        if(row){const buffer=document.createElement('tbody');buffer.innerHTML=itemRow(item);row.replaceWith(buffer.firstElementChild);}
      }));
      return;
    }
    mount.innerHTML=`<div class="loading-group">${t('loadingDetails','Loading this equipment group…')}</div>`;
    await Promise.all(items.map(item=>loadDetail(item.c)));
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
      return `<details class="category-group ${leafCategories.has(category)?'category-group--leaf':''}" data-category-group="${esc(category)}" data-group-key="${esc(categoryKey)}"><summary class="category-heading">${esc(term(category))}<span>${items.length}</span></summary><div class="category-contents"></div></details>`;
    }).join(''):`<div class="empty">${t('noItems','No matching equipment')}</div>`;
    const total=[...groups.values()].reduce((n,types)=>n+[...types.values()].reduce((sum,list)=>sum+list.length,0),0);
    status.textContent=`${total.toLocaleString()} ${t('equipmentCount','equipment')}`;
    $('#pager').replaceChildren();
    el.querySelectorAll('.category-group').forEach(categoryNode=>{
      const category=categoryNode.dataset.categoryGroup;
      categoryNode.open=openCategories.has(category);
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
          return `<details class="type-group" data-type-group="${esc(key)}"><summary class="type-heading">${esc(term(type))}<span>${items.length}</span></summary><div class="type-items"></div></details>`;
        }).join('');
        mount.querySelectorAll('.type-group').forEach(typeNode=>{
          const [,type]=typeNode.dataset.typeGroup.split('|');
          typeNode.open=openTypes.has(typeNode.dataset.typeGroup);
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
    const item=itemMap.get(id),detail=detailCache.get(id),uniques=uniqueList(item,detail),stats=Object.entries(detail?.st||{}).map(([key,value])=>`${statName(key)}: ${Array.isArray(value)?value.join('–'):value}`).join(' · ');
    tip.innerHTML=`<div class="tip-head"><span class="icon-slot icon-slot--large"><img src="${iconUrl(item?.a)}" onerror="this.hidden=true"></span><div class="${rarity(id)}">${esc(item?itemLabel(item):id)}<div class="sub">${esc(term(item?.g||''))} · ${esc(term(item?.t||''))} · ${item?.s||0}★</div></div></div>${stats?`<div class="tip-meta">${esc(stats)}${detail?.rq?.length?`<br>${t('requirements','Requirements')}: ${esc(detail.rq.map(formatRequirement).join(', '))}`:''}${detail?.cl?.length?`<br>${t('classes','Classes')}: ${esc(detail.cl.map(term).join(', '))}`:''}${detail?.mg!=null?`<br>${t('maxGrind','Max grind')}: +${detail.mg}`:''}</div>`:detail?.rq?.length?`<div class="tip-meta">${t('requirements','Requirements')}: ${esc(detail.rq.map(formatRequirement).join(', '))}</div>`:''}${detail?.sp?`<div class="tip-meta">EX · ${esc(term(detail.sp))}</div>`:''}${detail?.ef?.length?`<section class="tip-effects"><h4>${t('effectDetails','Effect details')}</h4>${detail.ef.map(effect=>`<div>${esc(term(effect))}</div>`).join('')}</section>`:''}${uniques.map((entry,index)=>`<div class="tip-unique"><b>${esc(uniqueText(id,entry,index,'name'))} · ${esc(uniqueText(id,entry,index,'type'))}</b><br>${esc(uniqueText(id,entry,index,'description'))}</div>`).join('')}`;
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
    const description=synthetic?term(Array.isArray(entry.t)?entry.t.join('\n'):entry.t):uniqueText(id,entry,index,'description');
    tip.innerHTML=`<div class="tip-unique"><b>${esc(title)}${kind?` · ${esc(kind)}`:''}</b>${description?`<div>${esc(description)}</div>`:''}</div>`;
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
  search.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(async()=>{state.query=search.value.trim();if(state.query&&/[^\x00-\x7F]/.test(state.query)&&!Object.keys(translations).length){try{await ensureTranslations();}catch(error){console.error(error);}}render();},160);});
  document.addEventListener('change',event=>{
    if(!event.target.matches('[data-filter]'))return;
    state.filters[event.target.dataset.filter]=event.target.dataset.filter==='unique'?(event.target.checked?'yes':'all'):event.target.value;
    render();
  });
  document.addEventListener('click',event=>{
    const ep=event.target.closest('[data-drop-ep]'),diff=event.target.closest('[data-drop-diff]');
    if(ep){state.filters.ep=ep.dataset.dropEp;render();return;}
    if(diff){state.filters.diff=diff.dataset.dropDiff;render();return;}
    const item=event.target.closest('[data-item-id]');if(item&&state.view==='drops'){hideTooltip();location.hash=`items?id=${encodeURIComponent(item.dataset.itemId.toUpperCase())}`;return;}
  });
  document.addEventListener('mouseover',event=>{const target=event.target.closest('[data-item-id],[data-unique-id],[data-enemy-id]');if(!target||target.contains(event.relatedTarget))return;showTooltip(target,event.clientX,event.clientY);});
  document.addEventListener('mousemove',event=>{if(tip.style.display==='block')positionTip(event.clientX,event.clientY);});
  document.addEventListener('mouseout',event=>{const target=event.target.closest('[data-item-id],[data-unique-id],[data-enemy-id]');if(target&&!target.contains(event.relatedTarget))hideTooltip();});
  window.addEventListener('hashchange',setRoute);
  document.addEventListener('keydown',event=>{if(event.key==='/'&&document.activeElement!==search){event.preventDefault();search.focus();}});
  initialize();
})();
