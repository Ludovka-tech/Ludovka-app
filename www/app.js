/* Ľudovka — offline Slovak folk song app. Single-file app logic.
 * Storage: IndexedDB (songs, playlists). Runs fully offline inside an Android WebView
 * (see ../android project) or in any modern desktop browser for testing.
 */
(function(){
"use strict";

/* ---------------------------------------------------------------- utils */

function normalizeChar(c){
  return c.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
}
function normalizeStr(s){
  s = s || '';
  var out = '';
  for (var i=0;i<s.length;i++) out += normalizeChar(s[i]);
  return out;
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
var SEARCH_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;color:var(--ink-soft);"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

/* Small, consistent line-art icon set (matches the bottom nav style). */
function iconTag(path, size, sw){
  return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="'+(sw||1.8)+'" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-'+Math.round(size*0.2)+'px;">'+path+'</svg>';
}
function iconMusic(size){ return iconTag('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', size); }
function iconFolder(size){ return iconTag('<path d="M3 6h6l2 2.5h10a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"/>', size); }
function iconEdit(size){ return iconTag('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>', size); }
function iconPlus(size){ return iconTag('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', size); }
function iconUpload(size){ return iconTag('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>', size); }
function iconDownload(size){ return iconTag('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', size); }
function iconFile(size){ return iconTag('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>', size); }
function iconSearchBig(size){ return iconTag('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', size); }
function uid(prefix){
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}
function debounce(fn, ms){
  var t; return function(){ var a=arguments, ctx=this; clearTimeout(t); t=setTimeout(function(){fn.apply(ctx,a);}, ms); };
}
function toast(msg){
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function(){ el.hidden = true; }, 2400);
}

/* --------------------------------------------------------------- history
 * "Recently searched" and "recently opened" are local-only UI convenience
 * state (not exported/imported with the songs), so plain localStorage is
 * enough — no need to route through IndexedDB.
 */
var HISTORY_SEARCHES_KEY = 'ludovka_recent_searches';
var HISTORY_SONGS_KEY = 'ludovka_recent_songs';
var HISTORY_MAX = 10;

function readJsonLS(key){
  try { var v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : []; }
  catch(e){ return []; }
}
function getRecentSearches(){ return readJsonLS(HISTORY_SEARCHES_KEY); }
function addRecentSearch(q){
  q = (q||'').trim();
  if (q.length < 2) return;
  var norm = normalizeStr(q);
  var list = getRecentSearches().filter(function(x){ return normalizeStr(x) !== norm; });
  list.unshift(q);
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
  localStorage.setItem(HISTORY_SEARCHES_KEY, JSON.stringify(list));
}
function clearRecentSearches(){ localStorage.removeItem(HISTORY_SEARCHES_KEY); }

function getRecentSongIds(){ return readJsonLS(HISTORY_SONGS_KEY); }
function addRecentSong(id){
  var list = getRecentSongIds().filter(function(x){ return x !== id; });
  list.unshift(id);
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
  localStorage.setItem(HISTORY_SONGS_KEY, JSON.stringify(list));
}
function clearRecentSongs(){ localStorage.removeItem(HISTORY_SONGS_KEY); }

/* Returns {before, match, after} snippet around first hit of query inside text, or null. */
function findSnippet(text, normQuery){
  if (!normQuery) return null;
  var normText = normalizeStr(text);
  var idx = normText.indexOf(normQuery);
  if (idx < 0) return null;
  var start = Math.max(0, idx - 26);
  var end = Math.min(text.length, idx + normQuery.length + 26);
  var prefix = start > 0 ? '…' : '';
  var suffix = end < text.length ? '…' : '';
  return {
    before: escapeHtml(prefix + text.substring(start, idx)),
    match: escapeHtml(text.substring(idx, idx + normQuery.length)),
    after: escapeHtml(text.substring(idx + normQuery.length, end) + suffix)
  };
}
function highlightTitle(title, normQuery){
  if (!normQuery) return escapeHtml(title);
  var normText = normalizeStr(title);
  var idx = normText.indexOf(normQuery);
  if (idx < 0) return escapeHtml(title);
  return escapeHtml(title.substring(0,idx)) + '<mark>' + escapeHtml(title.substring(idx, idx+normQuery.length)) + '</mark>' + escapeHtml(title.substring(idx+normQuery.length));
}

/* Chorus / repeat markers. Traditional song sheets mark a repeated line or
 * verse two ways depending on where the text came from: "[:like this:]"
 * (square-bracket repeat sign) or the older "​:,: like this :,:" style already
 * used in a couple of the seeded songs. Neither the CSV/Excel importer nor
 * storage strip these — they're just characters in the lyrics text — so this
 * only has to run at render time: find the marked spans and set them off
 * with the standard musical repeat-dot glyphs (𝄆 … 𝄇) instead of showing the
 * raw brackets/colons, so it actually reads as "repeat this" in the app.
 */
function markChoruses(escapedText){
  return escapedText.replace(/\[:([\s\S]*?):\]|:,:([\s\S]*?):,:/g, function(m, g1, g2){
    var inner = (g1 !== undefined ? g1 : g2).trim();
    return '<span class="repeat-mark">𝄆 ' + inner + ' 𝄇</span>';
  });
}

/* -------------------------------------------------------------- storage */

var DB_NAME = 'ludovka';
var DB_VERSION = 2;
var dbPromise = null;

function openDB(){
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function(resolve, reject){
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e){
      var db = e.target.result;
      if (!db.objectStoreNames.contains('songs')){
        var s = db.createObjectStore('songs', {keyPath:'id'});
        s.createIndex('title', 'title', {unique:false});
      }
      if (!db.objectStoreNames.contains('playlists')){
        db.createObjectStore('playlists', {keyPath:'id'});
      }
      if (!db.objectStoreNames.contains('tags')){
        db.createObjectStore('tags', {keyPath:'id'});
      }
    };
    req.onsuccess = function(e){ resolve(e.target.result); };
    req.onerror = function(e){ reject(e.target.error); };
  });
  return dbPromise;
}

function tx(storeNames, mode){
  return openDB().then(function(db){ return db.transaction(storeNames, mode); });
}
function reqToPromise(req){
  return new Promise(function(resolve,reject){
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
}

var Store = {
  allSongs: function(){
    return tx(['songs'],'readonly').then(function(t){
      return reqToPromise(t.objectStore('songs').getAll());
    });
  },
  putSong: function(song){
    return tx(['songs'],'readwrite').then(function(t){
      t.objectStore('songs').put(song);
      return new Promise(function(res,rej){ t.oncomplete=function(){res(song);}; t.onerror=function(){rej(t.error);}; });
    });
  },
  deleteSong: function(id){
    return tx(['songs','playlists'],'readwrite').then(function(t){
      t.objectStore('songs').delete(id);
      var ps = t.objectStore('playlists');
      ps.getAll().onsuccess = function(e){
        var lists = e.target.result || [];
        lists.forEach(function(pl){
          var i = pl.songIds.indexOf(id);
          if (i>=0){ pl.songIds.splice(i,1); ps.put(pl); }
        });
      };
      return new Promise(function(res,rej){ t.oncomplete=function(){res();}; t.onerror=function(){rej(t.error);}; });
    });
  },
  allPlaylists: function(){
    return tx(['playlists'],'readonly').then(function(t){
      return reqToPromise(t.objectStore('playlists').getAll());
    });
  },
  putPlaylist: function(pl){
    return tx(['playlists'],'readwrite').then(function(t){
      t.objectStore('playlists').put(pl);
      return new Promise(function(res,rej){ t.oncomplete=function(){res(pl);}; t.onerror=function(){rej(t.error);}; });
    });
  },
  deletePlaylist: function(id){
    return tx(['playlists'],'readwrite').then(function(t){
      t.objectStore('playlists').delete(id);
      return new Promise(function(res,rej){ t.oncomplete=function(){res();}; t.onerror=function(){rej(t.error);}; });
    });
  },
  allTags: function(){
    return tx(['tags'],'readonly').then(function(t){
      return reqToPromise(t.objectStore('tags').getAll());
    });
  },
  putTag: function(tag){
    return tx(['tags'],'readwrite').then(function(t){
      t.objectStore('tags').put(tag);
      return new Promise(function(res,rej){ t.oncomplete=function(){res(tag);}; t.onerror=function(){rej(t.error);}; });
    });
  },
  deleteTag: function(id){
    return tx(['tags','songs'],'readwrite').then(function(t){
      t.objectStore('tags').delete(id);
      var ss = t.objectStore('songs');
      ss.getAll().onsuccess = function(e){
        (e.target.result || []).forEach(function(s){
          if (s.tagIds && s.tagIds.indexOf(id) >= 0){
            s.tagIds = s.tagIds.filter(function(x){ return x !== id; });
            ss.put(s);
          }
        });
      };
      return new Promise(function(res,rej){ t.oncomplete=function(){res();}; t.onerror=function(){rej(t.error);}; });
    });
  },
  // One-time, idempotent migration: songs created before the tag system existed
  // only had a single free-text `category`. Turn that into a real (auto-created) tag.
  migrateCategoriesToTags: function(){
    return Promise.all([Store.allSongs(), Store.allTags()]).then(function(r){
      var songs = r[0], tags = r[1];
      var byName = {};
      tags.forEach(function(t){ byName[normalizeStr(t.name)] = t; });
      var chain = Promise.resolve();
      songs.forEach(function(s){
        if (s.tagIds) return;
        var tagIds = [];
        if (s.category && s.category.trim()){
          var name = s.category.trim();
          var key = normalizeStr(name);
          var tag = byName[key];
          if (!tag){
            tag = {id: uid('t'), name: name, createdAt: Date.now()};
            byName[key] = tag;
            chain = chain.then(function(){ return Store.putTag(tag); });
          }
          tagIds = [tag.id];
        }
        s.tagIds = tagIds;
        chain = chain.then(function(){ return Store.putSong(s); });
      });
      return chain;
    });
  },
  // Supports two SEED_SONGS shapes: the newer `tags: [name, ...]` (multiple
  // tags, auto-created like the CSV/Excel bulk importer does) and the older
  // single free-text `category` (kept for backward compatibility).
  seedIfEmpty: function(){
    return Promise.all([Store.allSongs(), Store.allTags()]).then(function(r){
      var songs = r[0], existingTags = r[1];
      if (songs.length > 0 || !window.SEED_SONGS) return;
      var now = Date.now();
      var byTagName = {};
      existingTags.forEach(function(t){ byTagName[normalizeStr(t.name)] = t; });
      var chain = Promise.resolve();
      window.SEED_SONGS.forEach(function(s, i){
        var tagNames = (s.tags && s.tags.length) ? s.tags : (s.category ? [s.category] : []);
        var tagIds = tagNames.map(function(name){
          var key = normalizeStr(name);
          var tag = byTagName[key];
          if (!tag){
            tag = {id: uid('t'), name: name, createdAt: now};
            byTagName[key] = tag;
            chain = chain.then(function(){ return Store.putTag(tag); });
          }
          return tag.id;
        });
        chain = chain.then(function(){
          return Store.putSong({ id: uid('s'), title: s.title, tagIds: tagIds, lyrics: s.lyrics, createdAt: now+i });
        });
      });
      return chain;
    });
  }
};

/* ------------------------------------------------------------- app state */

var App = {
  songs: [],
  playlists: [],
  tags: [],
  tab: 'songs',
  stack: [{name:'songs-root'}],
  searchQuery: ''
};

function reloadData(){
  return Promise.all([Store.allSongs(), Store.allPlaylists(), Store.allTags()]).then(function(r){
    App.songs = r[0].sort(function(a,b){ return a.title.localeCompare(b.title,'sk'); });
    App.playlists = r[1].sort(function(a,b){ return (b.createdAt||0)-(a.createdAt||0); });
    App.tags = r[2].sort(function(a,b){ return a.name.localeCompare(b.name,'sk'); });
  });
}
function songById(id){ return App.songs.find(function(s){ return s.id===id; }); }
function playlistById(id){ return App.playlists.find(function(p){ return p.id===id; }); }
function tagById(id){ return App.tags.find(function(t){ return t.id===id; }); }
function tagNamesForSong(s){
  return (s.tagIds || []).map(tagById).filter(Boolean).map(function(t){ return t.name; });
}

/* ---- navigation + animated transitions ----
 * Every real page change (push/pop/tab switch) goes through navigate(), which
 * wraps the DOM mutation in document.startViewTransition() when the browser
 * supports it (modern Android WebView does), producing a smooth slide/fade
 * between screens instead of an instant flash. Older WebViews fall back to
 * the previous instant behaviour automatically. In-place refreshes (typing
 * in a search box, toggling a checkbox, etc.) should keep calling render()
 * directly — they don't go through here, and shouldn't.
 */
function navigate(mutateFn, opts){
  opts = opts || {};
  if (typeof document.startViewTransition !== 'function'){
    mutateFn(); render();
    return;
  }
  var html = document.documentElement;
  html.dataset.navDir = opts.dir || 'forward';
  if (opts.sourceEl) opts.sourceEl.style.viewTransitionName = 'song-morph';

  var transition = document.startViewTransition(function(){
    mutateFn();
    render();
    if (opts.morph){
      var hero = view.querySelector('[data-morph-target]');
      if (hero) hero.style.viewTransitionName = 'song-morph';
    }
  });

  transition.finished.catch(function(){}).then(function(){
    delete html.dataset.navDir;
    if (opts.sourceEl) opts.sourceEl.style.viewTransitionName = '';
    var hero = view.querySelector('[data-morph-target]');
    if (hero) hero.style.viewTransitionName = '';
  });
}

function push(view, opts){
  navigate(function(){ App.stack.push(view); }, Object.assign({dir:'forward'}, opts));
}
// Opens a song with a "dive in" morph: the tapped title grows into the
// reader-mode title instead of the screen just cutting to the new content.
function openSong(sourceEl, id){
  var titleEl = sourceEl && (sourceEl.classList.contains('song-title') ? sourceEl : sourceEl.querySelector('.song-title'));
  push({name:'song-detail', id: id}, {sourceEl: titleEl, morph: true});
}
function pop(){ navigate(function(){ App.stack.pop(); }, {dir:'back'}); }

// Tabs sit side by side in a fixed order (Piesne, Playlisty, Spravovať), so
// switching between them slides sideways in the matching direction — like
// swiping across a row of pages — rather than just cross-fading.
var TAB_ORDER = ['songs','playlists','admin'];
function resetTab(tab){
  var fromIdx = TAB_ORDER.indexOf(App.tab);
  var toIdx = TAB_ORDER.indexOf(tab);
  var dir = toIdx === fromIdx ? 'cross' : (toIdx > fromIdx ? 'forward' : 'back');
  navigate(function(){ App.tab = tab; App.stack = [{name: tab+'-root'}]; }, {dir: dir});
}

/* ------------------------------------------------------------ rendering */

var view = document.getElementById('view');
var topbarTitle = document.getElementById('topbarTitle');
var backBtn = document.getElementById('backBtn');

// Remember each stack frame's own scroll position (e.g. how far down the
// "všetky piesne" or playlist song list you'd scrolled) so going back to it
// — from a song you tapped into, say — lands you where you left off instead
// of snapping back to the top. Forward navigation still starts a fresh page
// at the top, since the new stack frame has no recorded scrollY yet.
view.addEventListener('scroll', function(){
  var top = App.stack[App.stack.length-1];
  if (top) top.scrollY = view.scrollTop;
});

function render(){
  var top = App.stack[App.stack.length-1];
  backBtn.hidden = App.stack.length <= 1;
  document.querySelectorAll('.navbtn').forEach(function(b){
    b.classList.toggle('active', b.dataset.tab === App.tab);
  });
  document.body.classList.toggle('song-detail-mode', top.name === 'song-detail');
  if (window.AndroidBridge && window.AndroidBridge.setCanGoBack){
    window.AndroidBridge.setCanGoBack(App.stack.length > 1);
  }

  var renderers = {
    'songs-root': renderSongsRoot,
    'songs-all': renderSongsAll,
    'song-detail': renderSongDetail,
    'song-form': renderSongForm,
    'playlists-root': renderPlaylistsRoot,
    'playlist-detail': renderPlaylistDetail,
    'admin-root': renderAdminRoot
  };
  var fn = renderers[top.name] || renderSongsRoot;
  fn(top);
  view.scrollTop = top.scrollY || 0;

  // Doubles as "new playlist" on Playlisty and "add a song" on Piesne.
  // Hidden everywhere else (playlist-detail, song-detail, forms, admin).
  var fab = document.getElementById('newPlaylistFab');
  var fabMode = top.name === 'playlists-root' ? 'playlist'
    : (top.name === 'songs-root' || top.name === 'songs-all') ? 'song'
    : null;
  fab.hidden = !fabMode;
  if (!fab.hidden){
    fab.dataset.fabMode = fabMode;
    fab.setAttribute('aria-label', fabMode === 'playlist' ? 'Nový playlist' : 'Pridať pieseň');
    var navEl = document.querySelector('.bottomnav');
    fab.style.bottom = ((navEl ? navEl.offsetHeight : 64) + 18) + 'px';
  }
}

/* ---- Songs tab ---- */

function songCardHtml(s, normQ){
  var snippet = null;
  var titleHit = normQ && normalizeStr(s.title).indexOf(normQ) >= 0;
  if (normQ && !titleHit) snippet = findSnippet(s.lyrics, normQ);
  var html = '<div class="song-card" data-open-song="'+s.id+'">';
  html += '<div class="meta">';
  html += '<div class="song-title">'+(normQ ? highlightTitle(s.title, normQ) : escapeHtml(s.title))+'</div>';
  var tagNames = tagNamesForSong(s);
  if (tagNames.length) html += '<div class="song-sub">'+escapeHtml(tagNames.join(' · '))+'</div>';
  if (snippet) html += '<div class="song-snippet">'+snippet.before+'<mark>'+snippet.match+'</mark>'+snippet.after+'</div>';
  html += '</div><div class="chev">›</div></div>';
  return html;
}
function wireSongCardOpens(root, onOpen){
  root.querySelectorAll('[data-open-song]').forEach(function(el){
    el.onclick = function(){
      if (onOpen) onOpen(el.dataset.openSong);
      openSong(el, el.dataset.openSong);
    };
  });
}

function renderSongsRoot(){
  topbarTitle.textContent = 'Ľudovka';
  var q = App.searchQuery;
  var normQ = normalizeStr(q);

  var html = '';
  html += '<div class="searchbox">'+SEARCH_ICON+'<input id="searchInput" type="text" placeholder="Hľadať podľa názvu alebo textu…" value="'+escapeHtml(q)+'">';
  if (q) html += '<button class="clear-x" id="clearSearch">✕</button>';
  html += '</div>';

  if (App.songs.length === 0){
    html += '<div class="empty-state"><span class="big">'+iconMusic(40)+'</span>Zatiaľ tu nie sú žiadne piesne.<br>Pridaj ich v sekcii „Spravovať“.</div>';
    view.innerHTML = html;
    wireSongsRootSearch();
    return;
  }

  if (normQ){
    // Actively searching: show live results across the whole library.
    var results = App.songs.filter(function(s){
      return normalizeStr(s.title).indexOf(normQ) >= 0 || normalizeStr(s.lyrics).indexOf(normQ) >= 0;
    });
    if (results.length === 0){
      html += '<div class="empty-state"><span class="big">'+iconSearchBig(40)+'</span>Nič sa nenašlo pre „'+escapeHtml(q)+'“.</div>';
    } else {
      html += '<div class="section-title">'+results.length+' výsledkov</div>';
      results.forEach(function(s){ html += songCardHtml(s, normQ); });
    }
    view.innerHTML = html;
    wireSongsRootSearch();
    wireSongCardOpens(view, function(){ addRecentSearch(App.searchQuery); });
    return;
  }

  // No active query: default view is history, not the full library.
  var recentSearches = getRecentSearches();
  var recentSongs = getRecentSongIds().map(songById).filter(Boolean);

  if (recentSearches.length === 0 && recentSongs.length === 0){
    html += '<div class="empty-state"><span class="big">'+iconSearchBig(40)+'</span>Zatiaľ tu nie je žiadna história.<br>Vyhľadaj alebo si prezri pieseň a nájdeš ju tu nabudúce.</div>';
  } else {
    if (recentSearches.length){
      html += '<div class="section-title">Naposledy vyhľadávané</div>';
      html += '<div class="chip-row" id="recentSearchRow">';
      recentSearches.forEach(function(term){
        html += '<button type="button" class="chip-search" data-recent-search="'+escapeHtml(term)+'">'+SEARCH_ICON+escapeHtml(term)+'</button>';
      });
      html += '</div>';
    }
    if (recentSongs.length){
      html += '<div class="section-title" style="margin-top:'+(recentSearches.length?'22px':'18px')+';">Naposledy otvorené</div>';
      recentSongs.forEach(function(s){ html += songCardHtml(s, ''); });
    }
    html += '<button type="button" class="history-clear" id="clearHistoryBtn">Vymazať históriu</button>';
  }
  html += '<button type="button" class="browse-all-link" id="browseAllBtn">'+iconMusic(16)+' Zobraziť všetky piesne ('+App.songs.length+')</button>';
  view.innerHTML = html;

  wireSongsRootSearch();
  wireSongCardOpens(view);
  view.querySelectorAll('[data-recent-search]').forEach(function(el){
    el.onclick = function(){ App.searchQuery = el.dataset.recentSearch; render(); };
  });
  var clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) clearHistoryBtn.onclick = function(){ clearRecentSearches(); clearRecentSongs(); render(); };
  document.getElementById('browseAllBtn').onclick = function(){ push({name:'songs-all', query:''}); };
}

function wireSongsRootSearch(){
  var input = document.getElementById('searchInput');
  input.oninput = debounce(function(){
    App.searchQuery = input.value;
    render();
    var i2 = document.getElementById('searchInput');
    i2.focus();
    i2.selectionStart = i2.selectionEnd = i2.value.length;
  }, 150);
  input.addEventListener('keydown', function(e){ if (e.key === 'Enter') addRecentSearch(input.value); });
  var clearBtn = document.getElementById('clearSearch');
  if (clearBtn) clearBtn.onclick = function(){ App.searchQuery=''; render(); };
}

/* ---- Full song library (reached via "Zobraziť všetky piesne") ---- */

function renderSongsAll(top){
  topbarTitle.textContent = 'Všetky piesne';
  var q = top.query || '';
  var normQ = normalizeStr(q);
  var results = App.songs;
  if (normQ){
    results = App.songs.filter(function(s){
      return normalizeStr(s.title).indexOf(normQ) >= 0 || normalizeStr(s.lyrics).indexOf(normQ) >= 0;
    });
  }

  var html = '';
  html += '<div class="searchbox">'+SEARCH_ICON+'<input id="allSearchInput" type="text" placeholder="Hľadať podľa názvu alebo textu…" value="'+escapeHtml(q)+'">';
  if (q) html += '<button class="clear-x" id="allClearSearch">✕</button>';
  html += '</div>';

  if (results.length === 0){
    html += '<div class="empty-state"><span class="big">'+iconSearchBig(40)+'</span>Nič sa nenašlo pre „'+escapeHtml(q)+'“.</div>';
  } else {
    html += '<div class="section-title">'+(q ? results.length+' výsledkov' : 'Všetky piesne ('+results.length+')')+'</div>';
    results.forEach(function(s){ html += songCardHtml(s, normQ); });
  }
  view.innerHTML = html;

  var input = document.getElementById('allSearchInput');
  input.oninput = debounce(function(){
    top.query = input.value;
    render();
    var i2 = document.getElementById('allSearchInput');
    i2.focus();
    i2.selectionStart = i2.selectionEnd = i2.value.length;
  }, 150);
  input.addEventListener('keydown', function(e){ if (e.key === 'Enter') addRecentSearch(input.value); });
  var clearBtn = document.getElementById('allClearSearch');
  if (clearBtn) clearBtn.onclick = function(){ top.query=''; render(); };
  wireSongCardOpens(view, function(){ if (top.query) addRecentSearch(top.query); });
}

function renderSongDetail(top){
  var s = songById(top.id);
  if (!s){ pop(); return; }
  topbarTitle.textContent = s.title;
  addRecentSong(s.id);
  var inPlaylists = App.playlists.filter(function(p){ return p.songIds.indexOf(s.id)>=0; });

  var html = '';
  html += '<div class="detail-header" data-morph-target><div class="detail-title">'+escapeHtml(s.title)+'</div></div>';
  var songTagNames = tagNamesForSong(s);
  if (songTagNames.length){
    html += '<div class="chip-row" style="margin-bottom:14px;">'+songTagNames.map(function(n){return '<span class="chip">'+escapeHtml(n)+'</span>';}).join('')+'</div>';
  }
  html += '<div class="btn-row">';
  html += '<button class="btn btn-primary" id="addToPlaylistBtn">'+iconFolder(16)+' Pridať do playlistu</button>';
  html += '</div>';
  if (inPlaylists.length){
    html += '<div class="chip-row" style="margin-top:10px;">'+inPlaylists.map(function(p){return '<span class="chip">'+escapeHtml(p.name)+'</span>';}).join('')+'</div>';
  }
  html += '<div class="detail-lyrics">'+markChoruses(escapeHtml(s.lyrics))+'</div>';
  html += '<div class="btn-row">';
  html += '<button class="btn btn-secondary btn-block" id="editSongBtn">'+iconEdit(16)+' Upraviť pieseň</button>';
  html += '</div>';
  view.innerHTML = html;

  document.getElementById('addToPlaylistBtn').onclick = function(){ openPlaylistPicker(s.id); };
  document.getElementById('editSongBtn').onclick = function(){
    push({name:'song-form', id: s.id});
  };
}

/* ---- Song add/edit form ---- */

function renderSongForm(top){
  var editing = !!top.id;
  var s = editing ? songById(top.id) : {title:'', lyrics:'', tagIds:[]};
  if (editing && !s){ pop(); return; }
  topbarTitle.textContent = editing ? 'Upraviť pieseň' : 'Nová pieseň';

  var selectedTagIds = (s.tagIds || []).slice();

  function tagFieldHtml(){
    var html = '<div class="field"><label>Tagy (voliteľné)</label>';
    if (App.tags.length === 0){
      html += '<div class="hint">Zatiaľ nemáš žiadne tagy. Vytvor ich nižšie alebo v sekcii Spravovať → Tagy.</div>';
    } else {
      html += '<div class="chip-row" id="tagPickRow">';
      App.tags.forEach(function(t){
        var active = selectedTagIds.indexOf(t.id) >= 0;
        html += '<button type="button" class="chip-toggle'+(active?' chip-active':'')+'" data-toggle-tag="'+t.id+'">'+escapeHtml(t.name)+'</button>';
      });
      html += '</div>';
    }
    html += '<button type="button" class="btn btn-secondary" id="newTagFromForm" style="margin-top:10px;">+ Nový tag</button>';
    html += '</div>';
    return html;
  }

  var html = '';
  html += '<div class="field"><label>Názov piesne</label><input type="text" id="fTitle" value="'+escapeHtml(s.title)+'" placeholder="napr. Tancuj, tancuj"></div>';
  html += '<div id="tagFieldWrap">'+tagFieldHtml()+'</div>';
  html += '<div class="field"><label>Text piesne</label><textarea id="fLyrics" placeholder="Vlož text piesne…">'+escapeHtml(s.lyrics)+'</textarea></div>';
  html += '<button class="btn btn-primary btn-block" id="saveSongBtn">'+(editing?'Uložiť zmeny':'Pridať pieseň')+'</button>';
  if (editing){
    html += '<button class="btn btn-danger btn-block" id="deleteSongBtn" style="margin-top:10px;">Odstrániť pieseň</button>';
  }
  view.innerHTML = html;

  function wireTagField(){
    var wrap = document.getElementById('tagFieldWrap');
    wrap.querySelectorAll('[data-toggle-tag]').forEach(function(btn){
      btn.onclick = function(){
        var id = btn.dataset.toggleTag;
        var idx = selectedTagIds.indexOf(id);
        if (idx >= 0) selectedTagIds.splice(idx,1); else selectedTagIds.push(id);
        btn.classList.toggle('chip-active');
      };
    });
    document.getElementById('newTagFromForm').onclick = function(){
      promptDialog('Nový tag', 'Názov tagu (napr. Vianočné, Svadobné…)', '').then(function(name){
        if (!name) return;
        var norm = normalizeStr(name);
        var existing = App.tags.find(function(t){ return normalizeStr(t.name) === norm; });
        if (existing){
          if (selectedTagIds.indexOf(existing.id) < 0) selectedTagIds.push(existing.id);
          wrap.innerHTML = tagFieldHtml(); wireTagField();
          return;
        }
        var tag = {id: uid('t'), name: name.trim(), createdAt: Date.now()};
        Store.putTag(tag).then(reloadData).then(function(){
          selectedTagIds.push(tag.id);
          wrap.innerHTML = tagFieldHtml(); wireTagField();
        });
      });
    };
  }
  wireTagField();

  document.getElementById('saveSongBtn').onclick = function(){
    var title = document.getElementById('fTitle').value.trim();
    var lyrics = document.getElementById('fLyrics').value.trim();
    if (!title){ toast('Zadaj názov piesne.'); return; }
    if (!lyrics){ toast('Zadaj text piesne.'); return; }

    function doSave(){
      var song = editing ? Object.assign({}, s, {title:title, lyrics:lyrics, tagIds:selectedTagIds}) :
        {id: uid('s'), title:title, lyrics:lyrics, tagIds:selectedTagIds, createdAt: Date.now()};
      Store.putSong(song).then(reloadData).then(function(){
        toast(editing ? 'Zmeny uložené.' : 'Pieseň pridaná.');
        App.stack = App.tab==='admin' ? [{name:'admin-root'}] : [{name:'songs-root'}];
        render();
      });
    }

    // Unlike bulk import (which merges rows onto an existing title), adding/
    // renaming one song by hand doesn't otherwise check for a name clash —
    // warn so the user doesn't end up with two separate songs sharing a title.
    var normTitle = normalizeStr(title);
    var dup = App.songs.find(function(x){ return normalizeStr(x.title) === normTitle && (!editing || x.id !== s.id); });
    if (dup){
      confirmDialog('Pieseň s názvom „'+escapeHtml(title)+'“ už v knižnici existuje. Uložiť aj tak ako samostatnú pieseň?').then(function(ok){
        if (ok) doSave();
      });
    } else {
      doSave();
    }
  };
  if (editing){
    document.getElementById('deleteSongBtn').onclick = function(){
      confirmDialog('Odstrániť pieseň „'+escapeHtml(s.title)+'“? Táto akcia sa nedá vrátiť späť a pieseň sa odstráni aj zo všetkých playlistov.').then(function(ok){
        if (!ok) return;
        Store.deleteSong(s.id).then(reloadData).then(function(){
          toast('Pieseň odstránená.');
          App.stack = App.tab==='admin' ? [{name:'admin-root'}] : [{name:'songs-root'}];
          render();
        });
      });
    };
  }
}

/* ---- Playlists tab ---- */

function renderPlaylistsRoot(){
  topbarTitle.textContent = 'Playlisty';
  var html = '';
  if (App.playlists.length === 0){
    html += '<div class="empty-state"><span class="big">'+iconFolder(40)+'</span>Zatiaľ nemáš žiadne playlisty.<br>Vytvor si prvý tlačidlom „+“.</div>';
  } else {
    App.playlists.forEach(function(p){
      html += '<div class="playlist-card" data-open-playlist="'+p.id+'">';
      html += '<div class="playlist-icon">'+iconFolder(21)+'</div><div class="meta" style="flex:1;">';
      html += '<div class="playlist-name">'+escapeHtml(p.name)+'</div>';
      html += '<div class="playlist-count">'+p.songIds.length+' '+(p.songIds.length===1?'pieseň':(p.songIds.length>=2&&p.songIds.length<=4?'piesne':'piesní'))+'</div>';
      html += '</div><div class="chev">›</div></div>';
    });
  }
  view.innerHTML = html;

  view.querySelectorAll('[data-open-playlist]').forEach(function(el){
    el.onclick = function(){ push({name:'playlist-detail', id: el.dataset.openPlaylist}); };
  });
}

function renderPlaylistDetail(top){
  var p = playlistById(top.id);
  if (!p){ pop(); return; }
  topbarTitle.textContent = '';
  var songs = p.songIds.map(songById).filter(Boolean);

  var html = '';
  html += '<div class="detail-header"><div class="detail-title">'+escapeHtml(p.name)+'</div>';
  html += '<div class="detail-category">'+songs.length+' '+(songs.length===1?'pieseň':(songs.length>=2&&songs.length<=4?'piesne':'piesní'))+'</div></div>';
  html += '<div class="btn-row">';
  html += '<button class="btn btn-primary" id="addSongsBtn">'+iconPlus(16)+' Pridať piesne</button>';
  html += '<button class="btn btn-secondary" id="renameBtn">'+iconEdit(16)+' Premenovať</button>';
  html += '</div>';

  if (songs.length === 0){
    html += '<div class="empty-state"><span class="big">'+iconMusic(40)+'</span>Tento playlist je zatiaľ prázdny.</div>';
  } else {
    html += '<div class="section-title">Piesne v playliste</div>';
    songs.forEach(function(s){
      html += '<div class="song-card">';
      html += '<div class="meta" data-open-song="'+s.id+'"><div class="song-title">'+escapeHtml(s.title)+'</div>';
      var plTagNames = tagNamesForSong(s);
      if (plTagNames.length) html += '<div class="song-sub">'+escapeHtml(plTagNames.join(' · '))+'</div>';
      html += '</div>';
      html += '<button class="icon-btn" style="background:#fdeceb;color:#b3382c;" data-remove-song="'+s.id+'" aria-label="Odstrániť z playlistu">✕</button>';
      html += '</div>';
    });
  }
  html += '<button class="btn btn-danger btn-block" id="deletePlaylistBtn" style="margin-top:18px;">Odstrániť playlist</button>';
  view.innerHTML = html;

  view.querySelectorAll('[data-open-song]').forEach(function(el){
    el.onclick = function(){ openSong(el, el.dataset.openSong); };
  });
  view.querySelectorAll('[data-remove-song]').forEach(function(el){
    el.onclick = function(e){
      e.stopPropagation();
      var songId = el.dataset.removeSong;
      var song = songById(songId);
      confirmDialog('Odstrániť pieseň „'+escapeHtml(song ? song.title : '')+'“ z playlistu „'+escapeHtml(p.name)+'“?').then(function(ok){
        if (!ok) return;
        p.songIds = p.songIds.filter(function(id){ return id!==songId; });
        Store.putPlaylist(p).then(reloadData).then(render);
      });
    };
  });
  document.getElementById('addSongsBtn').onclick = function(){ openSongPickerForPlaylist(p.id); };
  document.getElementById('renameBtn').onclick = function(){
    promptDialog('Premenovať playlist', 'Nový názov', p.name).then(function(name){
      if (!name) return;
      p.name = name.trim();
      Store.putPlaylist(p).then(reloadData).then(render);
    });
  };
  document.getElementById('deletePlaylistBtn').onclick = function(){
    confirmDialog('Odstrániť playlist „'+escapeHtml(p.name)+'“? Piesne samotné zostanú zachované.').then(function(ok){
      if (!ok) return;
      Store.deletePlaylist(p.id).then(reloadData).then(function(){
        toast('Playlist odstránený.');
        App.stack = [{name:'playlists-root'}];
        render();
      });
    });
  };
}

/* ---- Playlist picker (from song detail) ---- */

function openPlaylistPicker(songId){
  var s = songById(songId);
  var html = '<div class="sheet-title">Pridať „'+escapeHtml(s.title)+'“ do playlistu</div>';
  if (App.playlists.length === 0){
    html += '<div class="hint" style="margin-bottom:14px;">Zatiaľ nemáš žiadny playlist.</div>';
  } else {
    App.playlists.forEach(function(p){
      var checked = p.songIds.indexOf(songId) >= 0 ? 'checked' : '';
      html += '<label class="checkrow"><input type="checkbox" data-pl="'+p.id+'" '+checked+'><span class="label">'+escapeHtml(p.name)+'</span></label>';
    });
  }
  html += '<button class="btn btn-secondary btn-block" id="newPlFromPicker" style="margin-top:6px;">+ Nový playlist</button>';
  html += '<button class="btn btn-primary btn-block" id="closePicker" style="margin-top:10px;">Hotovo</button>';

  var close = showSheet(html, function(root){
    root.querySelectorAll('[data-pl]').forEach(function(cb){
      cb.onchange = function(){
        var p = playlistById(cb.dataset.pl);
        var idx = p.songIds.indexOf(songId);
        if (cb.checked && idx<0) p.songIds.push(songId);
        if (!cb.checked && idx>=0) p.songIds.splice(idx,1);
        Store.putPlaylist(p).then(reloadData);
      };
    });
    root.querySelector('#newPlFromPicker').onclick = function(){
      promptDialog('Nový playlist', 'Názov playlistu', '').then(function(name){
        if (!name) return;
        var pl = {id: uid('p'), name:name.trim(), songIds:[songId], createdAt: Date.now()};
        Store.putPlaylist(pl).then(reloadData).then(function(){
          closeSheet();
          openPlaylistPicker(songId);
        });
      });
    };
    root.querySelector('#closePicker').onclick = function(){ closeSheet(); render(); };
  });
}

/* ---- Song picker (from playlist detail, add many songs) ---- */

function openSongPickerForPlaylist(playlistId){
  var p = playlistById(playlistId);
  var query = '';
  // Checking/unchecking only edits this local working copy — nothing is saved
  // until "Pridať" is tapped. That way closing the sheet any other way (tap
  // outside, the phone's back button) just discards the picks instead of
  // silently committing them.
  var pendingIds = p.songIds.slice();

  function doneLabel(){ return 'Pridať' + (pendingIds.length ? ' (' + pendingIds.length + ')' : ''); }

  function body(){
    var normQ = normalizeStr(query);
    var list = App.songs.filter(function(s){ return !normQ || normalizeStr(s.title).indexOf(normQ)>=0; });
    // The checkbox list scrolls in its own inner area; the title, search box,
    // and "Pridať" button stay pinned outside it (via the flex layout applied
    // in wire()) so the button is always reachable without scrolling past a
    // library that can run into the hundreds of songs.
    var html = '<div class="sheet-title">Pridať piesne do „'+escapeHtml(p.name)+'“</div>';
    html += '<div class="searchbox" style="margin-bottom:10px;">'+SEARCH_ICON+'<input id="pickerSearch" type="text" placeholder="Hľadať pieseň…" value="'+escapeHtml(query)+'"></div>';
    html += '<div class="picker-scroll" id="pickerScroll">';
    if (list.length===0){
      html += '<div class="hint">Žiadne piesne nenájdené.</div>';
    } else {
      list.forEach(function(s){
        var checked = pendingIds.indexOf(s.id)>=0 ? 'checked':'';
        html += '<label class="checkrow"><input type="checkbox" data-song="'+s.id+'" '+checked+'><span class="label">'+escapeHtml(s.title)+'</span></label>';
      });
    }
    html += '</div>';
    html += '<button class="btn btn-primary btn-block" id="doneAddSongs" style="margin-top:10px;">'+doneLabel()+'</button>';
    return html;
  }
  var close = showSheet(body(), wire);
  function wire(root){
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.overflowY = 'hidden';
    root.querySelectorAll('[data-song]').forEach(function(cb){
      cb.onchange = function(){
        var idx = pendingIds.indexOf(cb.dataset.song);
        if (cb.checked && idx<0) pendingIds.push(cb.dataset.song);
        if (!cb.checked && idx>=0) pendingIds.splice(idx,1);
        var btn = document.getElementById('doneAddSongs');
        if (btn) btn.textContent = doneLabel();
      };
    });
    var search = root.querySelector('#pickerSearch');
    search.oninput = debounce(function(){ query = search.value; refresh(); }, 150);
    root.querySelector('#doneAddSongs').onclick = function(){
      p.songIds = pendingIds;
      Store.putPlaylist(p).then(reloadData).then(function(){
        closeSheet();
        render();
      });
    };
  }
  function refresh(){
    var root = document.querySelector('.sheet');
    if (!root) return;
    var focusVal = query, caret = null;
    root.innerHTML = body();
    wire(root);
    var s = root.querySelector('#pickerSearch');
    if (s){ s.focus(); s.selectionStart = s.selectionEnd = s.value.length; }
  }
}

/* ---- Admin tab ---- */

function renderAdminRoot(){
  topbarTitle.textContent = 'Spravovať';
  var html = '';
  html += '<div class="section-title">Pridávanie piesní</div>';
  html += '<button class="btn btn-secondary btn-block" id="addSongBtn">'+iconPlus(16)+' Pridať jednu pieseň</button>';
  html += '<button class="btn btn-secondary btn-block" id="importBtn" style="margin-top:10px;">'+iconUpload(16)+' Hromadný import (CSV / Excel)</button>';
  html += '<input type="file" id="csvFile" accept=".csv,.xlsx,.xls,text/csv,text/comma-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden>';
  html += '<div class="btn-row">';
  html += '<button class="btn btn-secondary" id="templateBtn" style="flex:1;">'+iconFile(16)+' Stiahnuť šablónu</button>';
  html += '<button class="btn btn-secondary" id="exportBtn" style="flex:1;">'+iconDownload(16)+' Exportovať všetko</button>';
  html += '</div>';
  html += '<div class="hint">Dá sa nahrať <b>.xlsx</b> aj <b>.csv</b> súbor so stĺpcami <b>Nazov</b>, <b>Tagy</b>, <b>Text</b>. Viac tagov v jednej bunke oddeľ bodkočiarkou (napr. „Milostné; Tanečné“) — nové tagy sa pri importe vytvoria automaticky. Piesne s rovnakým názvom sa aktualizujú, nové sa pridajú.</div>';
  html += '<div id="importSummary"></div>';

  html += '<div class="section-title" style="margin-top:26px;">Tagy</div>';
  if (App.tags.length === 0){
    html += '<div class="hint" style="margin-bottom:10px;">Tagmi si vieš roztriediť piesne podľa žánru, príležitosti, kraja a podobne.</div>';
  } else {
    html += '<div class="chip-row" id="tagManageRow">';
    App.tags.forEach(function(t){
      html += '<span class="chip chip-removable" data-rename-tag="'+t.id+'">'+escapeHtml(t.name)+'<span class="chip-x" data-delete-tag="'+t.id+'">✕</span></span>';
    });
    html += '</div>';
  }
  html += '<button class="btn btn-secondary btn-block" id="newTagBtn" style="margin-top:10px;">'+iconPlus(15)+' Nový tag</button>';

  html += '<div class="section-title" style="margin-top:26px;">Všetky piesne ('+App.songs.length+')</div>';
  if (App.songs.length === 0){
    html += '<div class="empty-state"><span class="big">'+iconMusic(40)+'</span>Zatiaľ žiadne piesne.</div>';
  } else {
    App.songs.forEach(function(s){
      html += '<div class="song-card" data-edit-song="'+s.id+'">';
      html += '<div class="meta"><div class="song-title">'+escapeHtml(s.title)+'</div>';
      var tagNames = tagNamesForSong(s);
      if (tagNames.length) html += '<div class="song-sub">'+escapeHtml(tagNames.join(' · '))+'</div>';
      html += '</div><div class="chev">'+iconEdit(17)+'</div></div>';
    });
  }
  view.innerHTML = html;

  document.getElementById('addSongBtn').onclick = function(){ push({name:'song-form'}); };
  view.querySelectorAll('[data-edit-song]').forEach(function(el){
    el.onclick = function(){ push({name:'song-form', id: el.dataset.editSong}); };
  });
  document.getElementById('newTagBtn').onclick = function(){
    promptDialog('Nový tag', 'Názov tagu (napr. Vianočné, Svadobné…)', '').then(function(name){
      if (!name) return;
      var norm = normalizeStr(name);
      if (App.tags.some(function(t){ return normalizeStr(t.name) === norm; })){
        toast('Tento tag už existuje.');
        return;
      }
      Store.putTag({id: uid('t'), name: name.trim(), createdAt: Date.now()}).then(reloadData).then(render);
    });
  };
  view.querySelectorAll('[data-delete-tag]').forEach(function(el){
    el.onclick = function(e){
      e.stopPropagation();
      var t = tagById(el.dataset.deleteTag);
      if (!t) return;
      confirmDialog('Odstrániť tag „'+escapeHtml(t.name)+'“? Odstráni sa zo všetkých piesní, ktoré ho majú priradený.').then(function(ok){
        if (!ok) return;
        Store.deleteTag(t.id).then(reloadData).then(render);
      });
    };
  });
  view.querySelectorAll('[data-rename-tag]').forEach(function(el){
    el.onclick = function(){
      var t = tagById(el.dataset.renameTag);
      if (!t) return;
      promptDialog('Premenovať tag', 'Nový názov', t.name).then(function(name){
        if (!name) return;
        t.name = name.trim();
        Store.putTag(t).then(reloadData).then(render);
      });
    };
  });
  document.getElementById('importBtn').onclick = function(){ document.getElementById('csvFile').click(); };
  document.getElementById('csvFile').onchange = function(e){
    var file = e.target.files[0];
    if (!file) return;
    var isExcel = /\.(xlsx|xls)$/i.test(file.name);
    var reader = new FileReader();
    reader.onload = function(){
      try {
        var result = isExcel ? importXlsx(reader.result) : importCsv(reader.result);
        reloadData().then(function(){
          render();
          document.getElementById('importSummary').innerHTML =
            '<div class="import-summary">Import dokončený z „'+escapeHtml(file.name)+'“:\n'+
            'Pridané: '+result.added+'\n'+
            'Aktualizované: '+result.updated+'\n'+
            (result.skipped ? 'Preskočené (bez názvu): '+result.skipped+'\n' : '') +
            'Spolu v knižnici: '+App.songs.length+'</div>';
        });
      } catch(err){
        toast('Import zlyhal: ' + err.message);
      }
    };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };
  document.getElementById('templateBtn').onclick = function(){
    var csv = '﻿Nazov,Tagy,Text\n' +
      '"Príklad názvu piesne","Milostné; Tanečné","Prvý riadok textu\nDruhý riadok textu\nTretí riadok textu"\n';
    saveTextFile('sablona-import.csv', csv, 'text/csv');
  };
  document.getElementById('exportBtn').onclick = function(){
    var csv = songsToCsv(App.songs);
    saveTextFile('ludovka-export.csv', csv, 'text/csv');
  };
}

/* ------------------------------------------------------------- CSV I/O */

function parseCsv(text){
  // RFC4180-ish parser: handles quoted fields, embedded commas/newlines, "" escaping.
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  var i = 0;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  while (i < text.length){
    var c = text[i];
    if (inQuotes){
      if (c === '"'){
        if (text[i+1] === '"'){ field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    } else {
      if (c === '"'){ inQuotes = true; i++; continue; }
      if (c === ','){ row.push(field); field=''; i++; continue; }
      if (c === '\r'){ i++; continue; }
      if (c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; i++; continue; }
      field += c; i++; continue;
    }
  }
  row.push(field); rows.push(row);
  // drop trailing fully-empty row
  while (rows.length && rows[rows.length-1].every(function(f){return f==='';})) rows.pop();
  return rows;
}

var HEADER_ALIASES = {
  title: ['title','nazov','názov','meno','name'],
  tags: ['tags','tagy','tag','štítky','stitky','category','kategoria','kategória'],
  lyrics: ['lyrics','text','texty','text piesne','words','obsah']
};
function matchHeader(h){
  var n = normalizeStr(h.trim());
  for (var key in HEADER_ALIASES){
    if (HEADER_ALIASES[key].some(function(a){ return normalizeStr(a)===n; })) return key;
  }
  return null;
}

function importCsv(text){
  return importRows(parseCsv(text));
}
function importXlsx(arrayBuffer){
  if (!window.XLSX) throw new Error('Podpora pre Excel sa nenačítala. Skús import ako .csv.');
  var wb = XLSX.read(new Uint8Array(arrayBuffer), {type:'array'});
  var sheet = wb.Sheets[wb.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:'', blankrows:false});
  rows = rows.map(function(row){ return row.map(function(c){ return c==null ? '' : String(c); }); });
  return importRows(rows);
}
function importRows(rows){
  if (rows.length === 0) throw new Error('Súbor je prázdny.');
  var header = rows[0].map(matchHeader);
  if (header.indexOf('title') < 0 || header.indexOf('lyrics') < 0){
    throw new Error('Chýbajú stĺpce Nazov / Text. Skontroluj hlavičku súboru.');
  }
  var byTitle = {};
  App.songs.forEach(function(s){ byTitle[normalizeStr(s.title)] = s; });
  var byTagName = {};
  App.tags.forEach(function(t){ byTagName[normalizeStr(t.name)] = t; });

  function resolveTagIds(tagsField){
    if (!tagsField) return null; // null = "column blank, leave existing tags untouched"
    var names = tagsField.split(/[;,]/).map(function(x){ return x.trim(); }).filter(Boolean);
    return names.map(function(name){
      var key = normalizeStr(name);
      var tag = byTagName[key];
      if (!tag){
        tag = {id: uid('t'), name: name, createdAt: Date.now()};
        byTagName[key] = tag;
        Store.putTag(tag);
      }
      return tag.id;
    });
  }

  var added=0, updated=0, skipped=0;
  var now = Date.now();
  for (var r=1; r<rows.length; r++){
    var cells = rows[r];
    if (cells.every(function(c){return c.trim()==='';})) continue;
    var rec = {};
    header.forEach(function(key, idx){ if (key) rec[key] = (cells[idx]||'').trim(); });
    if (!rec.title){ skipped++; continue; }
    var existing = byTitle[normalizeStr(rec.title)];
    var tagIds = resolveTagIds(rec.tags);
    if (existing){
      if (tagIds !== null) existing.tagIds = tagIds;
      else if (!existing.tagIds) existing.tagIds = [];
      existing.lyrics = rec.lyrics || existing.lyrics;
      Store.putSong(existing);
      updated++;
    } else {
      var song = {id: uid('s'), title: rec.title, tagIds: tagIds || [], lyrics: rec.lyrics||'', createdAt: now+r};
      byTitle[normalizeStr(song.title)] = song;
      Store.putSong(song);
      added++;
    }
  }
  return {added:added, updated:updated, skipped:skipped};
}

function csvEscape(v){
  v = (v==null ? '' : String(v));
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g,'""') + '"';
  return v;
}
function songsToCsv(songs){
  var lines = ['﻿Nazov,Tagy,Text'];
  songs.forEach(function(s){
    lines.push([csvEscape(s.title), csvEscape(tagNamesForSong(s).join('; ')), csvEscape(s.lyrics)].join(','));
  });
  return lines.join('\n');
}

function saveTextFile(filename, content, mime){
  if (window.AndroidBridge && window.AndroidBridge.saveTextFile){
    window.AndroidBridge.saveTextFile(filename, content, mime || 'text/plain');
    toast('Súbor uložený do priečinka Downloads.');
    return;
  }
  var blob = new Blob([content], {type: mime || 'text/plain'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
}

/* --------------------------------------------------------- sheet/dialogs */

function showSheet(innerHtml, onMount){
  var overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = '<div class="sheet">'+innerHtml+'</div>';
  document.body.appendChild(overlay);
  // Start below/transparent, then trigger the CSS transition to slide+fade in.
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ overlay.classList.add('overlay-active'); }); });
  overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });
  function close(){
    if (!overlay.parentNode) return;
    overlay.classList.remove('overlay-active');
    setTimeout(function(){ if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 420);
  }
  if (onMount) onMount(overlay.querySelector('.sheet'));
  window._closeActiveSheet = close;
  return close;
}
function closeSheet(){ if (window._closeActiveSheet) window._closeActiveSheet(); }

function confirmDialog(message){
  return new Promise(function(resolve){
    showSheet(
      '<div class="sheet-title">'+message+'</div>'+
      '<div class="btn-row">'+
      '<button class="btn btn-secondary" style="flex:1;" id="cdNo">Zrušiť</button>'+
      '<button class="btn btn-danger" style="flex:1;" id="cdYes">Potvrdiť</button>'+
      '</div>',
      function(root){
        root.querySelector('#cdNo').onclick = function(){ closeSheet(); resolve(false); };
        root.querySelector('#cdYes').onclick = function(){ closeSheet(); resolve(true); };
      }
    );
  });
}
function promptDialog(title, placeholder, value){
  return new Promise(function(resolve){
    showSheet(
      '<div class="sheet-title">'+title+'</div>'+
      '<div class="field"><input type="text" id="pdInput" placeholder="'+escapeHtml(placeholder)+'" value="'+escapeHtml(value||'')+'"></div>'+
      '<div class="btn-row">'+
      '<button class="btn btn-secondary" style="flex:1;" id="pdCancel">Zrušiť</button>'+
      '<button class="btn btn-primary" style="flex:1;" id="pdOk">OK</button>'+
      '</div>',
      function(root){
        var input = root.querySelector('#pdInput');
        input.focus();
        root.querySelector('#pdCancel').onclick = function(){ closeSheet(); resolve(null); };
        root.querySelector('#pdOk').onclick = function(){ var v=input.value.trim(); closeSheet(); resolve(v||null); };
      }
    );
  });
}
/* ------------------------------------------------------------------ nav */

document.querySelectorAll('.navbtn').forEach(function(b){
  b.addEventListener('click', function(){
    resetTab(b.dataset.tab);
  });
});
backBtn.addEventListener('click', pop);
// Called from Android's hardware/gesture back button (see MainActivity.onBackPressed).
// If a sheet (playlist/song picker, confirm dialog, etc.) is open on top, close
// that first — otherwise the button was popping the page underneath while the
// sheet stayed stranded on screen, showing both at once.
window.appGoBack = function(){
  if (document.querySelector('.overlay')){ closeSheet(); return; }
  pop();
};

document.getElementById('newPlaylistFab').onclick = function(){
  var top = App.stack[App.stack.length-1];
  if (top.name === 'songs-root' || top.name === 'songs-all'){
    push({name:'song-form'});
    return;
  }
  promptDialog('Nový playlist', 'Názov playlistu', '').then(function(name){
    if (!name) return;
    Store.putPlaylist({id: uid('p'), name:name.trim(), songIds:[], createdAt: Date.now()}).then(reloadData).then(render);
  });
};

/* ------------------------------------------------------------------ init */

openDB().then(Store.seedIfEmpty).then(Store.migrateCategoriesToTags).then(reloadData).then(render).catch(function(err){
  document.getElementById('view').innerHTML = '<div class="empty-state">Chyba pri načítaní databázy: '+escapeHtml(err.message||String(err))+'</div>';
});

})();
