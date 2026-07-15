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
  seedIfEmpty: function(){
    return Store.allSongs().then(function(songs){
      if (songs.length > 0 || !window.SEED_SONGS) return;
      var now = Date.now();
      var chain = Promise.resolve();
      window.SEED_SONGS.forEach(function(s, i){
        chain = chain.then(function(){
          return Store.putSong({ id: uid('s'), title: s.title, category: s.category||'', lyrics: s.lyrics, createdAt: now+i });
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

function push(view){ App.stack.push(view); render(); }
function pop(){ App.stack.pop(); render(); }
function resetTab(tab){ App.tab = tab; App.stack = [{name: tab+'-root'}]; render(); }

/* ------------------------------------------------------------ rendering */

var view = document.getElementById('view');
var topbarTitle = document.getElementById('topbarTitle');
var backBtn = document.getElementById('backBtn');

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
    'song-detail': renderSongDetail,
    'song-form': renderSongForm,
    'playlists-root': renderPlaylistsRoot,
    'playlist-detail': renderPlaylistDetail,
    'admin-root': renderAdminRoot
  };
  var fn = renderers[top.name] || renderSongsRoot;
  fn(top);
  view.scrollTop = 0;
}

/* ---- Songs tab ---- */

function renderSongsRoot(){
  topbarTitle.textContent = 'Ľudovka';
  var q = App.searchQuery;
  var normQ = normalizeStr(q);
  var results = App.songs;
  if (normQ){
    results = App.songs.filter(function(s){
      return normalizeStr(s.title).indexOf(normQ) >= 0 || normalizeStr(s.lyrics).indexOf(normQ) >= 0;
    });
  }

  var html = '';
  html += '<div class="searchbox">🔍 <input id="searchInput" type="text" placeholder="Hľadať podľa názvu alebo textu…" value="'+escapeHtml(q)+'">';
  if (q) html += '<button class="clear-x" id="clearSearch">✕</button>';
  html += '</div>';

  if (App.songs.length === 0){
    html += '<div class="empty-state"><span class="big">🎻</span>Zatiaľ tu nie sú žiadne piesne.<br>Pridaj ich v sekcii „Spravovať“.</div>';
  } else if (results.length === 0){
    html += '<div class="empty-state"><span class="big">🔎</span>Nič sa nenašlo pre „'+escapeHtml(q)+'“.</div>';
  } else {
    html += '<div class="section-title">'+(q ? results.length+' výsledkov' : 'Všetky piesne ('+results.length+')')+'</div>';
    results.forEach(function(s){
      var snippet = null;
      var titleHit = normalizeStr(s.title).indexOf(normQ) >= 0;
      if (normQ && !titleHit) snippet = findSnippet(s.lyrics, normQ);
      html += '<div class="song-card" data-open-song="'+s.id+'">';
      html += '<div class="meta">';
      html += '<div class="song-title">'+highlightTitle(s.title, normQ)+'</div>';
      var tagNames = tagNamesForSong(s);
      if (tagNames.length) html += '<div class="song-sub">'+escapeHtml(tagNames.join(' · '))+'</div>';
      if (snippet) html += '<div class="song-snippet">'+snippet.before+'<mark>'+snippet.match+'</mark>'+snippet.after+'</div>';
      html += '</div><div class="chev">›</div></div>';
    });
  }
  view.innerHTML = html;

  var input = document.getElementById('searchInput');
  input.oninput = debounce(function(){ App.searchQuery = input.value; render(); document.getElementById('searchInput').focus(); document.getElementById('searchInput').selectionStart = document.getElementById('searchInput').value.length; }, 150);
  var clearBtn = document.getElementById('clearSearch');
  if (clearBtn) clearBtn.onclick = function(){ App.searchQuery=''; render(); };
  view.querySelectorAll('[data-open-song]').forEach(function(el){
    el.onclick = function(){ push({name:'song-detail', id: el.dataset.openSong, from:'songs'}); };
  });
}

function renderSongDetail(top){
  var s = songById(top.id);
  if (!s){ pop(); return; }
  topbarTitle.textContent = s.title;
  var inPlaylists = App.playlists.filter(function(p){ return p.songIds.indexOf(s.id)>=0; });

  var html = '';
  var songTagNames = tagNamesForSong(s);
  if (songTagNames.length){
    html += '<div class="chip-row" style="margin-bottom:14px;">'+songTagNames.map(function(n){return '<span class="chip">'+escapeHtml(n)+'</span>';}).join('')+'</div>';
  }
  html += '<div class="btn-row">';
  html += '<button class="btn btn-primary" id="addToPlaylistBtn">📁 Pridať do playlistu</button>';
  html += '</div>';
  if (inPlaylists.length){
    html += '<div class="chip-row" style="margin-top:10px;">'+inPlaylists.map(function(p){return '<span class="chip">'+escapeHtml(p.name)+'</span>';}).join('')+'</div>';
  }
  html += '<div class="detail-lyrics">'+escapeHtml(s.lyrics)+'</div>';
  html += '<div class="btn-row">';
  html += '<button class="btn btn-secondary btn-block" id="editSongBtn">✏️ Upraviť pieseň</button>';
  html += '</div>';
  view.innerHTML = html;

  document.getElementById('addToPlaylistBtn').onclick = function(){ openPlaylistPicker(s.id); };
  document.getElementById('editSongBtn').onclick = function(){ push({name:'song-form', id: s.id}); };
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
    var song = editing ? Object.assign({}, s, {title:title, lyrics:lyrics, tagIds:selectedTagIds}) :
      {id: uid('s'), title:title, lyrics:lyrics, tagIds:selectedTagIds, createdAt: Date.now()};
    Store.putSong(song).then(reloadData).then(function(){
      toast(editing ? 'Zmeny uložené.' : 'Pieseň pridaná.');
      App.stack = App.tab==='admin' ? [{name:'admin-root'}] : [{name:'songs-root'}];
      render();
    });
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
  var html = '<div style="position:relative;min-height:60vh;">';
  if (App.playlists.length === 0){
    html += '<div class="empty-state"><span class="big">📁</span>Zatiaľ nemáš žiadne playlisty.<br>Vytvor si prvý tlačidlom „+“.</div>';
  } else {
    App.playlists.forEach(function(p){
      html += '<div class="playlist-card" data-open-playlist="'+p.id+'">';
      html += '<div class="playlist-icon">📁</div><div class="meta" style="flex:1;">';
      html += '<div class="playlist-name">'+escapeHtml(p.name)+'</div>';
      html += '<div class="playlist-count">'+p.songIds.length+' '+(p.songIds.length===1?'pieseň':(p.songIds.length>=2&&p.songIds.length<=4?'piesne':'piesní'))+'</div>';
      html += '</div><div class="chev">›</div></div>';
    });
  }
  html += '<button class="fab" id="newPlaylistBtn" aria-label="Nový playlist">+</button>';
  html += '</div>';
  view.innerHTML = html;

  view.querySelectorAll('[data-open-playlist]').forEach(function(el){
    el.onclick = function(){ push({name:'playlist-detail', id: el.dataset.openPlaylist}); };
  });
  document.getElementById('newPlaylistBtn').onclick = function(){
    promptDialog('Nový playlist', 'Názov playlistu', '').then(function(name){
      if (!name) return;
      Store.putPlaylist({id: uid('p'), name:name.trim(), songIds:[], createdAt: Date.now()}).then(reloadData).then(render);
    });
  };
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
  html += '<button class="btn btn-primary" id="addSongsBtn">➕ Pridať piesne</button>';
  html += '<button class="btn btn-secondary" id="renameBtn">✏️ Premenovať</button>';
  html += '</div>';

  if (songs.length === 0){
    html += '<div class="empty-state"><span class="big">🎵</span>Tento playlist je zatiaľ prázdny.</div>';
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
    el.onclick = function(){ push({name:'song-detail', id: el.dataset.openSong}); };
  });
  view.querySelectorAll('[data-remove-song]').forEach(function(el){
    el.onclick = function(e){
      e.stopPropagation();
      var songId = el.dataset.removeSong;
      p.songIds = p.songIds.filter(function(id){ return id!==songId; });
      Store.putPlaylist(p).then(reloadData).then(render);
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
  function body(){
    var normQ = normalizeStr(query);
    var list = App.songs.filter(function(s){ return !normQ || normalizeStr(s.title).indexOf(normQ)>=0; });
    var html = '<div class="sheet-title">Pridať piesne do „'+escapeHtml(p.name)+'“</div>';
    html += '<div class="searchbox" style="margin-bottom:10px;">🔍 <input id="pickerSearch" type="text" placeholder="Hľadať pieseň…" value="'+escapeHtml(query)+'"></div>';
    if (list.length===0){
      html += '<div class="hint">Žiadne piesne nenájdené.</div>';
    } else {
      list.forEach(function(s){
        var checked = p.songIds.indexOf(s.id)>=0 ? 'checked':'';
        html += '<label class="checkrow"><input type="checkbox" data-song="'+s.id+'" '+checked+'><span class="label">'+escapeHtml(s.title)+'</span></label>';
      });
    }
    html += '<button class="btn btn-primary btn-block" id="doneAddSongs" style="margin-top:10px;">Hotovo</button>';
    return html;
  }
  var close = showSheet(body(), wire);
  function wire(root){
    root.querySelectorAll('[data-song]').forEach(function(cb){
      cb.onchange = function(){
        var idx = p.songIds.indexOf(cb.dataset.song);
        if (cb.checked && idx<0) p.songIds.push(cb.dataset.song);
        if (!cb.checked && idx>=0) p.songIds.splice(idx,1);
        Store.putPlaylist(p).then(reloadData);
      };
    });
    var search = root.querySelector('#pickerSearch');
    search.oninput = debounce(function(){ query = search.value; refresh(); }, 150);
    root.querySelector('#doneAddSongs').onclick = function(){ closeSheet(); render(); };
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
  html += '<button class="btn btn-secondary btn-block" id="addSongBtn">➕ Pridať jednu pieseň</button>';
  html += '<button class="btn btn-secondary btn-block" id="importBtn" style="margin-top:10px;">📥 Hromadný import (CSV / Excel)</button>';
  html += '<input type="file" id="csvFile" accept=".csv,text/csv" hidden>';
  html += '<div class="btn-row">';
  html += '<button class="btn btn-secondary" id="templateBtn" style="flex:1;">📄 Stiahnuť šablónu</button>';
  html += '<button class="btn btn-secondary" id="exportBtn" style="flex:1;">💾 Exportovať všetko</button>';
  html += '</div>';
  html += '<div class="hint">Šablóna obsahuje stĺpce <b>Nazov</b>, <b>Tagy</b>, <b>Text</b>. Viac tagov v jednej bunke oddeľ bodkočiarkou (napr. „Milostné; Tanečné“) — nové tagy sa pri importe vytvoria automaticky. Piesne s rovnakým názvom sa aktualizujú, nové sa pridajú.</div>';
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
  html += '<button class="btn btn-secondary btn-block" id="newTagBtn" style="margin-top:10px;">+ Nový tag</button>';

  html += '<div class="section-title" style="margin-top:26px;">Všetky piesne ('+App.songs.length+')</div>';
  if (App.songs.length === 0){
    html += '<div class="empty-state"><span class="big">🎻</span>Zatiaľ žiadne piesne.</div>';
  } else {
    App.songs.forEach(function(s){
      html += '<div class="song-card" data-edit-song="'+s.id+'">';
      html += '<div class="meta"><div class="song-title">'+escapeHtml(s.title)+'</div>';
      var tagNames = tagNamesForSong(s);
      if (tagNames.length) html += '<div class="song-sub">'+escapeHtml(tagNames.join(' · '))+'</div>';
      html += '</div><div class="chev">✏️</div></div>';
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
    var reader = new FileReader();
    reader.onload = function(){
      try {
        var result = importCsv(reader.result);
        reloadData().then(function(){
          render();
          document.getElementById('importSummary').innerHTML =
            '<div class="import-summary">Import dokončený z „'+escapeHtml(file.name)+'“:\n'+
            '➕ Pridané: '+result.added+'\n'+
            '🔄 Aktualizované: '+result.updated+'\n'+
            (result.skipped ? '⚠️ Preskočené (bez názvu): '+result.skipped+'\n' : '') +
            '📚 Spolu v knižnici: '+App.songs.length+'</div>';
        });
      } catch(err){
        toast('Import zlyhal: ' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
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
  var rows = parseCsv(text);
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
  overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });
  function close(){ if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
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
  b.addEventListener('click', function(){ resetTab(b.dataset.tab); });
});
backBtn.addEventListener('click', pop);
window.appGoBack = pop; // called from Android's hardware/gesture back button

/* ------------------------------------------------------------------ init */

openDB().then(Store.seedIfEmpty).then(Store.migrateCategoriesToTags).then(reloadData).then(render).catch(function(err){
  document.getElementById('view').innerHTML = '<div class="empty-state">Chyba pri načítaní databázy: '+escapeHtml(err.message||String(err))+'</div>';
});

})();
