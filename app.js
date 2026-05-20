/* ═══════════════════════════════════════════════════════════════
   Boardflow — app.js
   SF font · PDF export · free-drag anywhere · independent lines
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ══════════════════════════════
     STORAGE
  ══════════════════════════════ */
  const BOARDS_KEY = 'boardflow_boards';
  const ACTIVE_KEY = 'boardflow_active';

  function loadAllBoards() {
    try { return JSON.parse(localStorage.getItem(BOARDS_KEY) || '{}'); } catch { return {}; }
  }
  function saveAllBoards(b) {
    try { localStorage.setItem(BOARDS_KEY, JSON.stringify(b)); } catch {}
  }
  function getActiveId() { return localStorage.getItem(ACTIVE_KEY) || null; }
  function setActiveId(id) { localStorage.setItem(ACTIVE_KEY, id); }

  /* ══════════════════════════════
     STATE
  ══════════════════════════════ */
  const S = {
    boardId: null,
    boardName: 'Untitled Board',
    elements: {},       // id → {type,x,y,w,h,color,title,tags,content}
    freeLines: {},      // id → {id,x1,y1,x2,y2,color,snapFrom,snapTo}
    leaderConns: [],    // [{id,fromId,toId,color}] — legacy leader-line connections kept
    leaderInst: {},     // connId → LeaderLine
    mode: 'select',
    selected: [],       // element ids
    selectedLine: null, // free line id
    activeColor: '#3B82F6',
    theme: 'dark',
    pz: null,
    // line-drawing state
    lineState: {
      active: false,
      phase: 0,       // 0=idle, 1=start placed, 2=done
      startX: 0, startY: 0,
      snapFromId: null,
    },
  };

  /* ══════════════════════════════
     DOM REFS
  ══════════════════════════════ */
  const canvasCont  = $('#canvas-container');
  const canvas      = $('#canvas');
  const statusMode  = $('#status-mode');
  const statusZoom  = $('#status-zoom');
  const statusHint  = $('#status-hint');
  const ctxMenu     = $('#context-menu');
  const lineOverlay = $('#line-overlay');
  const lineBanner  = $('#line-banner');
  const lineBannerTx = $('#line-banner-text');
  const previewLine = $('#preview-line');
  const boardNameEl = $('#board-name');
  const dashboard   = $('#dashboard');
  const dashGrid    = $('#dash-board-grid');

  /* ══════════════════════════════
     THEME
  ══════════════════════════════ */
  function applyTheme(t) {
    S.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark';
    $('#theme-icon-sun').style.display       = dark ? '' : 'none';
    $('#theme-icon-moon').style.display      = dark ? 'none' : '';
    $('#dash-theme-icon-sun').style.display  = dark ? '' : 'none';
    $('#dash-theme-icon-moon').style.display = dark ? 'none' : '';
    try { localStorage.setItem('boardflow_theme', t); } catch {}
    setTimeout(redrawAllLeaderLines, 60);
  }
  function toggleTheme() { applyTheme(S.theme === 'dark' ? 'light' : 'dark'); }
  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#dash-theme-toggle').addEventListener('click', toggleTheme);

  /* ══════════════════════════════
     PANZOOM
  ══════════════════════════════ */
  function initPanzoom() {
    const pz = window.Panzoom(canvas, {
      maxScale: 4, minScale: 0.15, step: 0.08,
      canvas: true, contain: false, excludeClass: 'no-pan',
    });
    S.pz = pz;

    canvasCont.addEventListener('wheel', e => {
      e.preventDefault();
      pz.zoomWithWheel(e);
      updateZoomStatus();
      scheduleLineUpdate();
    }, { passive: false });

    let spaceDown = false, midDrag = false, midStart = null, panStart = null;

    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && !e.target.isContentEditable && e.target.tagName !== 'INPUT') {
        e.preventDefault(); spaceDown = true;
        canvasCont.style.cursor = 'grab';
      }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'Space') { spaceDown = false; canvasCont.style.cursor = ''; }
    });

    canvasCont.addEventListener('mousedown', e => {
      if (e.button === 1 || spaceDown) {
        e.preventDefault(); midDrag = true;
        midStart = { x: e.clientX, y: e.clientY };
        panStart  = { x: pz.getPan().x, y: pz.getPan().y };
        canvasCont.classList.add('panning');
      }
    });
    document.addEventListener('mousemove', e => {
      if (!midDrag) return;
      pz.pan(panStart.x + e.clientX - midStart.x, panStart.y + e.clientY - midStart.y);
      scheduleLineUpdate();
    });
    document.addEventListener('mouseup', e => {
      if (midDrag || e.button === 1) {
        midDrag = false; midStart = null; panStart = null;
        canvasCont.classList.remove('panning');
      }
    });

    pz.zoom(1, { animate: false });
    updateZoomStatus();
  }

  function updateZoomStatus() {
    if (!S.pz) return;
    statusZoom.textContent = Math.round(S.pz.getScale() * 100) + '%';
  }

  function canvasPoint(cx, cy) {
    const scale = S.pz.getScale();
    const pan   = S.pz.getPan();
    const r     = canvasCont.getBoundingClientRect();
    return { x: (cx - r.left - pan.x) / scale, y: (cy - r.top - pan.y) / scale };
  }

  /* ══════════════════════════════
     MODE
  ══════════════════════════════ */
  const MODE_LABELS = { select:'● Select', card:'◆ Card', text:'◎ Text', line:'⟜ Line' };

  function setMode(mode) {
    S.mode = mode;
    $$('.tool-btn[data-mode]').forEach(b => b.classList.remove('active'));
    const btn = $(`[data-mode="${mode}"]`);
    if (btn) btn.classList.add('active');
    statusMode.textContent = MODE_LABELS[mode] || '● Select';

    if (mode === 'line') {
      startLineMode();
    } else {
      exitLineMode();
    }
    if (mode === 'select') {
      statusHint.textContent = 'Click to select · Drag anywhere to move · L for line tool';
    }
  }

  $('#btn-select').addEventListener('click', () => setMode('select'));
  $('#btn-card').addEventListener('click', () => {
    setMode('card'); statusHint.textContent = 'Click canvas to place card';
  });
  $('#btn-text').addEventListener('click', () => {
    setMode('text'); statusHint.textContent = 'Click canvas to place text';
  });
  $('#btn-line').addEventListener('click', () => setMode('line'));

  document.addEventListener('keydown', e => {
    if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
    if (e.key === 'v' || e.key === 'V') setMode('select');
    if (e.key === 'c' || e.key === 'C') { setMode('card'); statusHint.textContent = 'Click canvas to place card'; }
    if (e.key === 't' || e.key === 'T') { setMode('text'); statusHint.textContent = 'Click canvas to place text'; }
    if (e.key === 'l' || e.key === 'L') setMode('line');
    if (e.key === 'Delete') deleteSelected();
    if (e.key === 'Escape') { clearSelection(); setMode('select'); hideCtxMenu(); }
  });

  /* ══════════════════════════════
     CANVAS CLICK
  ══════════════════════════════ */
  canvasCont.addEventListener('click', e => {
    if (e.target !== canvasCont && e.target !== canvas) return;
    hideCtxMenu();

    if (S.mode === 'line') {
      const pos = canvasPoint(e.clientX, e.clientY);
      handleLineModeCanvasClick(pos.x, pos.y, null);
      return;
    }
    if (S.mode === 'select') { clearSelection(); return; }
    const pos = canvasPoint(e.clientX, e.clientY);
    if (S.mode === 'card') spawnCard(pos.x, pos.y);
    if (S.mode === 'text') spawnText(pos.x, pos.y);
    setMode('select');
  });

  canvasCont.addEventListener('mousemove', e => {
    if (S.mode !== 'line' || S.lineState.phase !== 1) return;
    // Show preview line
    const startPt = clientFromCanvas(S.lineState.startX, S.lineState.startY);
    showPreviewLine(startPt.x, startPt.y, e.clientX, e.clientY);
  });

  canvasCont.addEventListener('mousedown', e => {
    if (e.target === canvasCont || e.target === canvas) {
      if (document.activeElement && document.activeElement.isContentEditable) {
        document.activeElement.blur();
      }
    }
    hideCtxMenu();
  });

  canvasCont.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (e.target === canvasCont || e.target === canvas) {
      showCtxMenu(e.clientX, e.clientY);
    }
  });

  function clientFromCanvas(cx, cy) {
    const scale = S.pz.getScale();
    const pan   = S.pz.getPan();
    const r     = canvasCont.getBoundingClientRect();
    return {
      x: cx * scale + pan.x + r.left,
      y: cy * scale + pan.y + r.top,
    };
  }

  /* ══════════════════════════════
     FREE LINE MODE
  ══════════════════════════════ */
  function startLineMode() {
    S.lineState = { active: true, phase: 0, startX: 0, startY: 0, snapFromId: null };
    canvasCont.classList.add('line-mode');
    lineOverlay.classList.remove('hidden');
    lineBanner.classList.remove('phase2');
    lineBannerTx.textContent = 'Line mode — click on canvas or element to set start point';
    statusHint.textContent = 'Click to set start · Click again to set end · Snaps to cards & text';
  }

  function exitLineMode() {
    S.lineState.active = false;
    S.lineState.phase = 0;
    canvasCont.classList.remove('line-mode');
    lineOverlay.classList.add('hidden');
    hidePreviewLine();
    // remove source highlight
    $$('.line-source').forEach(el => el.classList.remove('line-source'));
  }

  $('#cancel-line-mode').addEventListener('click', () => setMode('select'));

  function handleLineModeCanvasClick(cx, cy, snapId) {
    if (S.lineState.phase === 0) {
      // Set start point
      S.lineState.startX = cx;
      S.lineState.startY = cy;
      S.lineState.snapFromId = snapId;
      S.lineState.phase = 1;
      lineBanner.classList.add('phase2');
      lineBannerTx.textContent = 'Now click to set the end point';
      if (snapId) {
        const el = canvas.querySelector(`[data-id="${snapId}"]`);
        if (el) el.classList.add('line-source');
      }
    } else if (S.lineState.phase === 1) {
      // Set end point → create line
      const lineId = uid();
      const ld = {
        id: lineId,
        x1: S.lineState.startX,
        y1: S.lineState.startY,
        x2: cx,
        y2: cy,
        color: S.activeColor,
        snapFromId: S.lineState.snapFromId || null,
        snapToId: snapId || null,
      };
      S.freeLines[lineId] = ld;
      renderFreeLine(ld);
      // reset
      $$('.line-source').forEach(el => el.classList.remove('line-source'));
      S.lineState.phase = 0;
      S.lineState.snapFromId = null;
      lineBanner.classList.remove('phase2');
      lineBannerTx.textContent = 'Line created! Click to start another, or press Escape to exit';
      hidePreviewLine();
      saveCurrentBoard();
    }
  }

  /* ══════════════════════════════
     RENDER FREE LINE (SVG)
  ══════════════════════════════ */
  function renderFreeLine(ld) {
    // Remove existing if redrawing
    const old = canvas.querySelector(`[data-line-id="${ld.id}"]`);
    if (old) old.remove();

    // Compute actual coordinates (snap to element center if snapped)
    const p1 = getLineEndpoint(ld, 'from');
    const p2 = getLineEndpoint(ld, 'to');

    const wrap = document.createElement('div');
    wrap.className = 'board-line-wrap no-pan';
    wrap.dataset.lineId = ld.id;

    // Size the wrapper to cover the line with padding
    const pad = 20;
    const minX = Math.min(p1.x, p2.x) - pad;
    const minY = Math.min(p1.y, p2.y) - pad;
    const maxX = Math.max(p1.x, p2.x) + pad;
    const maxY = Math.max(p1.y, p2.y) + pad;
    const W = maxX - minX, H = maxY - minY;

    wrap.style.cssText = `left:${minX}px;top:${minY}px;width:${W}px;height:${H}px;`;

    const lx1 = p1.x - minX, ly1 = p1.y - minY;
    const lx2 = p2.x - minX, ly2 = p2.y - minY;

    // Arrowhead
    const markId = `arrow-${ld.id}`;
    wrap.innerHTML = `
      <svg width="${W}" height="${H}" style="overflow:visible;display:block;">
        <defs>
          <marker id="${markId}" markerWidth="10" markerHeight="7"
            refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="${ld.color}" opacity="0.9"/>
          </marker>
        </defs>
        <line
          class="board-line-path"
          x1="${lx1}" y1="${ly1}" x2="${lx2}" y2="${ly2}"
          stroke="${ld.color}" stroke-width="2.2"
          marker-end="url(#${markId})"
        />
        <!-- Invisible fat hit area -->
        <line
          class="board-line-hit"
          x1="${lx1}" y1="${ly1}" x2="${lx2}" y2="${ly2}"
          stroke="transparent" stroke-width="14"
          style="cursor:pointer;pointer-events:stroke;"
        />
        <!-- Draggable endpoint circles -->
        <circle class="line-endpoint" cx="${lx1}" cy="${ly1}" r="5"
          fill="${ld.color}" stroke="white" stroke-width="1.5"
          data-ep="from" opacity="0.9"/>
        <circle class="line-endpoint" cx="${lx2}" cy="${ly2}" r="5"
          fill="${ld.color}" stroke="white" stroke-width="1.5"
          data-ep="to" opacity="0.9"/>
      </svg>`;

    canvas.appendChild(wrap);

    // Click on line body: select it
    wrap.querySelector('.board-line-hit').addEventListener('click', e => {
      e.stopPropagation();
      if (S.mode !== 'select') return;
      selectFreeLine(ld.id);
    });
    wrap.querySelector('.board-line-path').addEventListener('click', e => {
      e.stopPropagation();
      if (S.mode !== 'select') return;
      selectFreeLine(ld.id);
    });

    // Context menu on line
    wrap.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      selectFreeLine(ld.id);
      showCtxMenu(e.clientX, e.clientY);
    });

    // Drag endpoints
    setupEndpointDrag(wrap, ld, 'from');
    setupEndpointDrag(wrap, ld, 'to');

    // Click on element that is line-mode source: handle as line mode click
    wrap.addEventListener('mousedown', e => {
      if (S.mode === 'line') e.stopPropagation();
    });
  }

  function getLineEndpoint(ld, which) {
    const snapId = which === 'from' ? ld.snapFromId : ld.snapToId;
    if (snapId) {
      const el = canvas.querySelector(`[data-id="${snapId}"]`);
      if (el) {
        const s = S.elements[snapId];
        if (s) {
          return {
            x: s.x + (s.w || 100) / 2,
            y: s.y + (s.h || 40) / 2,
          };
        }
      }
      // Element gone: clear snap
      if (which === 'from') ld.snapFromId = null;
      else ld.snapToId = null;
    }
    return which === 'from' ? { x: ld.x1, y: ld.y1 } : { x: ld.x2, y: ld.y2 };
  }

  function setupEndpointDrag(wrap, ld, which) {
    const circle = wrap.querySelector(`[data-ep="${which}"]`);
    if (!circle) return;

    let dragging = false;
    let snapHighlight = null;

    circle.addEventListener('mousedown', e => {
      if (S.mode !== 'select') return;
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      selectFreeLine(ld.id);

      const onMove = ev => {
        const pos = canvasPoint(ev.clientX, ev.clientY);
        // Update coordinate
        if (which === 'from') { ld.x1 = pos.x; ld.y1 = pos.y; ld.snapFromId = null; }
        else { ld.x2 = pos.x; ld.y2 = pos.y; ld.snapToId = null; }

        // Check snap: find nearest element
        const nearest = findNearestElement(pos.x, pos.y, 40);
        if (snapHighlight && snapHighlight !== nearest) {
          const h = canvas.querySelector(`[data-id="${snapHighlight}"]`);
          if (h) h.classList.remove('line-source');
        }
        if (nearest) {
          const s = S.elements[nearest];
          // Snap to center
          const snap = { x: s.x + (s.w||100)/2, y: s.y + (s.h||40)/2 };
          if (which === 'from') { ld.x1 = snap.x; ld.y1 = snap.y; ld.snapFromId = nearest; }
          else { ld.x2 = snap.x; ld.y2 = snap.y; ld.snapToId = nearest; }
          const hel = canvas.querySelector(`[data-id="${nearest}"]`);
          if (hel) hel.classList.add('line-source');
          snapHighlight = nearest;
        } else {
          snapHighlight = null;
        }

        renderFreeLine(ld); // re-render in place
        selectFreeLine(ld.id);
      };
      const onUp = () => {
        dragging = false;
        if (snapHighlight) {
          const h = canvas.querySelector(`[data-id="${snapHighlight}"]`);
          if (h) h.classList.remove('line-source');
          snapHighlight = null;
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveCurrentBoard();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function findNearestElement(cx, cy, threshold) {
    let nearest = null, nearestDist = Infinity;
    Object.values(S.elements).forEach(el => {
      const ex = el.x + (el.w || 100) / 2;
      const ey = el.y + (el.h || 40) / 2;
      const dist = Math.hypot(cx - ex, cy - ey);
      if (dist < threshold && dist < nearestDist) {
        nearestDist = dist;
        nearest = el.id;
      }
    });
    return nearest;
  }

  function selectFreeLine(lineId) {
    // deselect elements
    clearSelection(true);
    S.selectedLine = lineId;
    // Highlight line
    $$('.board-line-path').forEach(p => p.classList.remove('selected-line'));
    const wrap = canvas.querySelector(`[data-line-id="${lineId}"]`);
    if (wrap) wrap.querySelector('.board-line-path')?.classList.add('selected-line');
    statusHint.textContent = 'Line selected — Delete to remove · Drag endpoints to reposition';
  }

  function updateAllSnappedLines() {
    // Re-render any free lines that are snapped to a moved element
    Object.values(S.freeLines).forEach(ld => {
      if (ld.snapFromId || ld.snapToId) renderFreeLine(ld);
    });
  }

  /* ══════════════════════════════
     SPAWN CARD
  ══════════════════════════════ */
  function spawnCard(cx, cy, data = null) {
    const id = data?.id || uid();
    if (!data) {
      data = {
        id, type: 'card',
        x: cx - 120, y: cy - 80,
        w: 250, h: 170,
        color: S.activeColor,
        title: '', tags: '', content: '',
      };
      S.elements[id] = data;
    } else {
      S.elements[id] = data;
    }

    const el = document.createElement('div');
    el.className = 'board-card no-pan';
    el.dataset.id = id;
    el.style.cssText = `left:${data.x}px;top:${data.y}px;width:${data.w}px;height:${data.h}px;`;

    el.innerHTML = `
      <div class="card-header" style="background:${hexRgba(data.color,0.13)}">
        <div class="card-header-dot" style="background:${data.color}"></div>
        <div class="card-title no-pan" contenteditable="true" spellcheck="false">${esc(data.title)}</div>
      </div>
      <div class="card-tags no-pan">
        <span class="card-tag" contenteditable="true" spellcheck="false">${esc(data.tags)}</span>
      </div>
      <div class="card-body no-pan" contenteditable="true" spellcheck="false">${esc(data.content)}</div>
      <div class="resize-handle no-pan" data-resize="true"></div>`;

    canvas.appendChild(el);
    setupElementDrag(el);
    setupCardResize(el);
    setupElementEvents(el);

    el.querySelectorAll('[contenteditable]').forEach(ce => {
      ce.addEventListener('input', () => syncData(id));
      ce.addEventListener('blur', () => { syncData(id); saveCurrentBoard(); });
    });

    return el;
  }

  /* ══════════════════════════════
     SPAWN TEXT
  ══════════════════════════════ */
  function spawnText(cx, cy, data = null) {
    const id = data?.id || uid();
    if (!data) {
      data = {
        id, type: 'text',
        x: cx - 60, y: cy - 14,
        w: 200, h: 40,
        color: S.activeColor, content: '',
      };
      S.elements[id] = data;
    } else {
      S.elements[id] = data;
    }

    const el = document.createElement('div');
    el.className = 'board-text no-pan';
    el.dataset.id = id;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.style.cssText = `left:${data.x}px;top:${data.y}px;min-width:${data.w}px;color:${data.color};`;
    el.innerText = data.content;

    canvas.appendChild(el);
    setupElementDrag(el);
    setupElementEvents(el);

    el.addEventListener('input', () => syncData(id));
    el.addEventListener('blur', () => { syncData(id); saveCurrentBoard(); });

    if (!data.content) setTimeout(() => el.focus(), 40);
    return el;
  }

  /* ══════════════════════════════
     INTERACT.JS — DRAG (full surface)
     Cards and text are draggable from ANY point.
     contenteditable areas still type when focused.
  ══════════════════════════════ */
  function setupElementDrag(el) {
    const id = el.dataset.id;
    const isCard = el.classList.contains('board-card');

    interact(el).draggable({
      // Only ignore resize handle; contenteditable areas drag unless they are focused
      ignoreFrom: '.resize-handle',
      // Allow dragging from contenteditable when not focused (i.e., mouse-down without focus)
      listeners: {
        start(event) {
          el.classList.add('dragging');
          bringToFront(el);
          // If dragging started from a contenteditable that isn't focused, blur it
          const target = event.target;
          if (target !== el && target.isContentEditable && document.activeElement !== target) {
            target.blur();
          }
        },
        move(e) {
          const s = S.elements[id];
          if (!s) return;
          const scale = S.pz.getScale();
          s.x += e.dx / scale;
          s.y += e.dy / scale;
          el.style.left = s.x + 'px';
          el.style.top  = s.y + 'px';
          scheduleLineUpdate();
          updateAllSnappedLines();
        },
        end() {
          el.classList.remove('dragging');
          scheduleLineUpdate();
          updateAllSnappedLines();
          saveCurrentBoard();
        },
      },
    });
  }

  function setupCardResize(el) {
    const id = el.dataset.id;
    interact(el).resizable({
      edges: { bottom: true, right: true, bottomRight: '.resize-handle' },
      listeners: {
        move(e) {
          const s = S.elements[id];
          if (!s) return;
          s.w = Math.max(180, e.rect.width);
          s.h = Math.max(100, e.rect.height);
          el.style.width  = s.w + 'px';
          el.style.height = s.h + 'px';
          scheduleLineUpdate();
          updateAllSnappedLines();
        },
        end() { saveCurrentBoard(); },
      },
      modifiers: [interact.modifiers.restrictSize({ min: { width: 180, height: 100 } })],
    });
  }

  /* ══════════════════════════════
     ELEMENT EVENTS (click / select)
  ══════════════════════════════ */
  function setupElementEvents(el) {
    el.addEventListener('mousedown', e => {
      if (e.target.dataset.resize || e.target.classList.contains('resize-handle')) return;

      if (S.mode === 'line') {
        // In line mode: clicking an element snaps to it
        e.stopPropagation();
        const id = el.dataset.id;
        const s = S.elements[id];
        const snapPt = { x: s.x + (s.w||100)/2, y: s.y + (s.h||40)/2 };
        handleLineModeCanvasClick(snapPt.x, snapPt.y, id);
        return;
      }

      // Selection logic — only on mousedown without active focus in a contenteditable
      const id = el.dataset.id;
      if (e.target.isContentEditable && document.activeElement === e.target) {
        // Already editing this field — allow text cursor, don't select element
        return;
      }

      if (e.shiftKey) {
        toggleSelectEl(id);
      } else {
        if (!S.selected.includes(id)) { clearSelection(); selectEl(id); }
      }
      updateSelectionHint();
    });

    el.addEventListener('click', e => {
      if (S.mode === 'line') return;
    });

    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const id = el.dataset.id;
      if (!S.selected.includes(id)) { clearSelection(); selectEl(id); }
      showCtxMenu(e.clientX, e.clientY);
    });
  }

  /* ══════════════════════════════
     SELECTION
  ══════════════════════════════ */
  function selectEl(id) {
    if (!S.selected.includes(id)) S.selected.push(id);
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add('selected');
    S.selectedLine = null;
    $$('.board-line-path').forEach(p => p.classList.remove('selected-line'));
  }
  function deselectEl(id) {
    S.selected = S.selected.filter(s => s !== id);
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.remove('selected');
  }
  function toggleSelectEl(id) {
    if (S.selected.includes(id)) deselectEl(id);
    else if (S.selected.length < 8) selectEl(id);
    updateSelectionHint();
  }
  function clearSelection(keepLineSelected = false) {
    [...S.selected].forEach(id => deselectEl(id));
    S.selected = [];
    if (!keepLineSelected) {
      S.selectedLine = null;
      $$('.board-line-path').forEach(p => p.classList.remove('selected-line'));
    }
    updateSelectionHint();
  }
  function updateSelectionHint() {
    const n = S.selected.length;
    if (n === 0 && !S.selectedLine) statusHint.textContent = 'Click to select · Drag anywhere to move · L for line tool';
    else if (n === 1) statusHint.textContent = 'Shift+click to multi-select · Delete to remove';
    else if (n > 1) statusHint.textContent = `${n} selected — Delete to remove all`;
  }
  function bringToFront(el) {
    const max = $$('.board-card,.board-text').reduce((m,e) => Math.max(m, parseInt(e.style.zIndex||0)), 0);
    el.style.zIndex = max + 1;
  }
  function syncData(id) {
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    const s = S.elements[id];
    if (!s) return;
    if (s.type === 'card') {
      s.title   = el.querySelector('.card-title')?.innerText || '';
      s.tags    = el.querySelector('.card-tag')?.innerText   || '';
      s.content = el.querySelector('.card-body')?.innerText  || '';
    } else {
      s.content = el.innerText || '';
    }
  }

  /* ══════════════════════════════
     CONTEXT MENU
  ══════════════════════════════ */
  function showCtxMenu(x, y) {
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top  = y + 'px';
    ctxMenu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', hideCtxMenu, { once: true }), 0);
  }
  function hideCtxMenu() { ctxMenu.classList.add('hidden'); }
  $('#ctx-delete').addEventListener('click', () => { hideCtxMenu(); deleteSelected(); });
  $('#ctx-cancel').addEventListener('click', hideCtxMenu);

  /* ══════════════════════════════
     DELETE
  ══════════════════════════════ */
  $('#btn-delete').addEventListener('click', deleteSelected);

  function deleteSelected() {
    if (S.selectedLine) {
      deleteFreeLine(S.selectedLine);
      S.selectedLine = null;
    }
    const ids = [...S.selected];
    ids.forEach(deleteElement);
    S.selected = [];
    saveCurrentBoard();
    updateSelectionHint();
  }

  function deleteElement(id) {
    // also remove any free lines snapped to this element
    Object.values(S.freeLines).forEach(ld => {
      if (ld.snapFromId === id) ld.snapFromId = null;
      if (ld.snapToId === id) ld.snapToId = null;
    });
    // remove legacy leader connections
    removeLeaderConnsFor(id);
    canvas.querySelector(`[data-id="${id}"]`)?.remove();
    delete S.elements[id];
  }

  function deleteFreeLine(lineId) {
    canvas.querySelector(`[data-line-id="${lineId}"]`)?.remove();
    delete S.freeLines[lineId];
    saveCurrentBoard();
  }

  /* ══════════════════════════════
     PREVIEW LINE (drawing mode)
  ══════════════════════════════ */
  function showPreviewLine(x1, y1, x2, y2) {
    previewLine.setAttribute('x1', x1);
    previewLine.setAttribute('y1', y1);
    previewLine.setAttribute('x2', x2);
    previewLine.setAttribute('y2', y2);
    previewLine.setAttribute('opacity', '0.75');
    previewLine.setAttribute('stroke', S.activeColor);
    previewLine.setAttribute('marker-end', `url(#preview-arrow)`);
  }
  function hidePreviewLine() {
    previewLine.setAttribute('opacity', '0');
  }

  /* ══════════════════════════════
     LEGACY LEADER LINES (kept for back-compat)
  ══════════════════════════════ */
  function drawLeaderLine(conn) {
    const fromEl = canvas.querySelector(`[data-id="${conn.fromId}"]`);
    const toEl   = canvas.querySelector(`[data-id="${conn.toId}"]`);
    if (!fromEl || !toEl) return;
    if (S.leaderInst[conn.id]) {
      try { S.leaderInst[conn.id].remove(); } catch {}
      delete S.leaderInst[conn.id];
    }
    try {
      const line = new LeaderLine(fromEl, toEl, {
        color: conn.color || '#3B82F6',
        size: 1.8,
        path: 'fluid',
        startPlug: 'disc', endPlug: 'arrow3',
        startPlugSize: 1.3, endPlugSize: 2.0,
      });
      S.leaderInst[conn.id] = line;
    } catch {}
  }
  function redrawAllLeaderLines() {
    S.leaderConns.forEach(c => {
      if (S.leaderInst[c.id]) {
        try { S.leaderInst[c.id].position(); } catch {}
      }
    });
  }
  function removeLeaderConnsFor(id) {
    const dead = S.leaderConns.filter(c => c.fromId === id || c.toId === id);
    dead.forEach(c => {
      if (S.leaderInst[c.id]) { try { S.leaderInst[c.id].remove(); } catch {} delete S.leaderInst[c.id]; }
    });
    S.leaderConns = S.leaderConns.filter(c => c.fromId !== id && c.toId !== id);
  }

  let _lineTimer = null;
  function scheduleLineUpdate() {
    if (_lineTimer) cancelAnimationFrame(_lineTimer);
    _lineTimer = requestAnimationFrame(redrawAllLeaderLines);
  }

  /* ══════════════════════════════
     COLOR
  ══════════════════════════════ */
  $('#color-picker').addEventListener('input', e => {
    S.activeColor = e.target.value;
    applyColorToSelected(e.target.value);
    $$('.swatch').forEach(s => s.classList.remove('active-swatch'));
  });
  $$('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const c = sw.dataset.color;
      S.activeColor = c;
      $('#color-picker').value = c;
      applyColorToSelected(c);
      $$('.swatch').forEach(s => s.classList.remove('active-swatch'));
      sw.classList.add('active-swatch');
    });
  });

  function applyColorToSelected(color) {
    S.selected.forEach(id => {
      const s = S.elements[id];
      if (!s) return;
      s.color = color;
      const el = canvas.querySelector(`[data-id="${id}"]`);
      if (!el) return;
      if (s.type === 'card') {
        el.querySelector('.card-header').style.background = hexRgba(color, 0.13);
        el.querySelector('.card-header-dot').style.background = color;
      } else {
        el.style.color = color;
      }
    });
    if (S.selectedLine && S.freeLines[S.selectedLine]) {
      S.freeLines[S.selectedLine].color = color;
      renderFreeLine(S.freeLines[S.selectedLine]);
      selectFreeLine(S.selectedLine);
    }
    saveCurrentBoard();
  }

  /* ══════════════════════════════
     PDF EXPORT
  ══════════════════════════════ */
  $('#btn-export-pdf').addEventListener('click', exportPDF);

  async function exportPDF() {
    // Show loading
    let loadingEl = $('#pdf-loading');
    if (!loadingEl) {
      loadingEl = document.createElement('div');
      loadingEl.id = 'pdf-loading';
      loadingEl.innerHTML = `<div class="pdf-spinner"></div><div class="pdf-loading-text">Generating PDF…</div>`;
      document.body.appendChild(loadingEl);
    }
    loadingEl.classList.remove('hidden');

    try {
      // Temporarily reset panzoom to 1:1 for capture
      const savedScale = S.pz.getScale();
      const savedPan   = S.pz.getPan();
      S.pz.zoom(1, { animate: false });
      S.pz.pan(0, 0, { animate: false });
      scheduleLineUpdate();
      await new Promise(r => setTimeout(r, 120)); // let DOM settle

      const htmlCanvas = await html2canvas(canvas, {
        backgroundColor: getComputedStyle(document.documentElement)
          .getPropertyValue('--bg').trim() || '#111113',
        scale: 1.5,
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: 6000,
        height: 6000,
        scrollX: 0, scrollY: 0,
        windowWidth: 6000, windowHeight: 6000,
        x: 0, y: 0,
      });

      // Restore pan/zoom
      S.pz.zoom(savedScale, { animate: false });
      S.pz.pan(savedPan.x, savedPan.y, { animate: false });
      scheduleLineUpdate();

      // Find bounding box of content
      const elements = Object.values(S.elements);
      const lines = Object.values(S.freeLines);
      if (elements.length === 0 && lines.length === 0) {
        loadingEl.classList.add('hidden');
        alert('Nothing to export — add some cards or text first.');
        return;
      }

      const pad = 60;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      elements.forEach(el => {
        minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
        maxX = Math.max(maxX, el.x + (el.w||240));
        maxY = Math.max(maxY, el.y + (el.h||160));
      });
      lines.forEach(ld => {
        minX = Math.min(minX, ld.x1, ld.x2); minY = Math.min(minY, ld.y1, ld.y2);
        maxX = Math.max(maxX, ld.x1, ld.x2); maxY = Math.max(maxY, ld.y1, ld.y2);
      });

      const cropX = Math.max(0, minX - pad);
      const cropY = Math.max(0, minY - pad);
      const cropW = Math.min((maxX - minX + pad*2) * 1.5, htmlCanvas.width  - cropX * 1.5);
      const cropH = Math.min((maxY - minY + pad*2) * 1.5, htmlCanvas.height - cropY * 1.5);

      // Crop canvas
      const cropped = document.createElement('canvas');
      cropped.width  = cropW;
      cropped.height = cropH;
      const ctx = cropped.getContext('2d');
      ctx.drawImage(htmlCanvas, cropX * 1.5, cropY * 1.5, cropW, cropH, 0, 0, cropW, cropH);

      // Build PDF (landscape or portrait depending on aspect ratio)
      const { jsPDF } = window.jspdf;
      const aspect = cropW / cropH;
      const orient = aspect > 1 ? 'l' : 'p';
      const pdf = new jsPDF({ orientation: orient, unit: 'px', format: [cropW, cropH] });
      pdf.addImage(cropped.toDataURL('image/png'), 'PNG', 0, 0, cropW, cropH);
      pdf.save(`${S.boardName || 'board'}.pdf`);

    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed. Please try again.');
    } finally {
      loadingEl.classList.add('hidden');
    }
  }

  /* ══════════════════════════════
     BOARD PERSISTENCE
  ══════════════════════════════ */
  function currentBoardData() {
    return {
      id: S.boardId,
      boardName: S.boardName,
      updatedAt: Date.now(),
      elements: S.elements,
      freeLines: S.freeLines,
      leaderConns: S.leaderConns.map(c => ({ id:c.id, fromId:c.fromId, toId:c.toId, color:c.color })),
    };
  }

  function saveCurrentBoard() {
    if (!S.boardId) return;
    const boards = loadAllBoards();
    boards[S.boardId] = currentBoardData();
    saveAllBoards(boards);
  }

  function loadBoard(boardId) {
    clearBoard();
    const boards = loadAllBoards();
    const data = boards[boardId];
    if (!data) return;
    S.boardId   = boardId;
    S.boardName = data.boardName || 'Untitled Board';
    boardNameEl.textContent = S.boardName;
    setActiveId(boardId);

    if (data.elements) {
      Object.values(data.elements).forEach(el => {
        if (el.type === 'card') spawnCard(0, 0, el);
        if (el.type === 'text') spawnText(0, 0, el);
      });
    }
    if (data.freeLines) {
      Object.values(data.freeLines).forEach(ld => {
        S.freeLines[ld.id] = ld;
        renderFreeLine(ld);
      });
    }
    // Legacy leader connections
    if (data.leaderConns) {
      data.leaderConns.forEach(conn => {
        S.leaderConns.push(conn);
        setTimeout(() => drawLeaderLine(conn), 100);
      });
    }
  }

  function clearBoard() {
    Object.values(S.leaderInst).forEach(l => { try { l.remove(); } catch {} });
    S.leaderInst  = {};
    S.leaderConns = [];
    S.elements    = {};
    S.freeLines   = {};
    S.selected    = [];
    S.selectedLine = null;
    canvas.innerHTML = '';
  }

  function createNewBoard() {
    const id = uid();
    const boards = loadAllBoards();
    boards[id] = { id, boardName: 'Untitled Board', updatedAt: Date.now(), elements: {}, freeLines: {}, leaderConns: [] };
    saveAllBoards(boards);
    return id;
  }

  /* ══════════════════════════════
     BOARD NAME
  ══════════════════════════════ */
  boardNameEl.addEventListener('blur', () => {
    S.boardName = boardNameEl.textContent.trim() || 'Untitled Board';
    boardNameEl.textContent = S.boardName;
    saveCurrentBoard();
  });
  boardNameEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); boardNameEl.blur(); }
  });

  /* ══════════════════════════════
     DASHBOARD
  ══════════════════════════════ */
  $('#btn-home').addEventListener('click', openDashboard);
  $('#dash-close').addEventListener('click', closeDashboard);

  function openDashboard() {
    saveCurrentBoard();
    renderDashboard();
    dashboard.classList.remove('hidden');
  }
  function closeDashboard() {
    dashboard.classList.add('hidden');
  }

  function renderDashboard() {
    const boards = loadAllBoards();
    const sorted = Object.values(boards).sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
    dashGrid.innerHTML = '';

    // New board
    const newCard = document.createElement('div');
    newCard.className = 'dash-new-card';
    newCard.innerHTML = `<div class="dash-new-plus">+</div><span>New Board</span>`;
    newCard.addEventListener('click', () => {
      const id = createNewBoard();
      closeDashboard();
      clearBoard();
      S.boardId = id; S.boardName = 'Untitled Board';
      boardNameEl.textContent = S.boardName;
      setActiveId(id);
      saveCurrentBoard();
      setTimeout(addWelcomeCard, 100);
    });
    dashGrid.appendChild(newCard);

    sorted.forEach(data => {
      const card = document.createElement('div');
      card.className = 'dash-board-card';
      const isActive = data.id === S.boardId;
      const elemCount = Object.keys(data.elements || {}).length;
      const date = data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : '—';

      const previewEl = document.createElement('div');
      previewEl.className = 'dash-card-preview';
      const elems = Object.values(data.elements || {}).slice(0, 5);
      if (!elems.length) {
        previewEl.innerHTML = '<span>Empty board</span>';
      } else {
        const xs = elems.map(e => e.x), ys = elems.map(e => e.y);
        const minX = Math.min(...xs), minY = Math.min(...ys);
        const maxX = Math.max(...elems.map(e => e.x + (e.w||180)));
        const maxY = Math.max(...elems.map(e => e.y + (e.h||100)));
        const sf = Math.min(200/(maxX-minX||1), 120/(maxY-minY||1), 0.4);
        elems.forEach(el => {
          const mini = document.createElement('div');
          mini.className = 'mini-card';
          mini.style.cssText = `left:${(el.x-minX)*sf+10}px;top:${(el.y-minY)*sf+5}px;width:${(el.w||180)*sf}px;height:${(el.h||100)*sf}px;`;
          if (el.type === 'card') {
            mini.innerHTML = `<div class="mini-card-header" style="background:${el.color||'#3B82F6'}"></div>${esc((el.title||'').slice(0,12))}`;
          } else {
            mini.style.cssText += `background:transparent;border:none;color:${el.color||'#e4e4ec'};`;
            mini.textContent = (el.content||'').slice(0, 10);
          }
          previewEl.appendChild(mini);
        });
      }

      const info = document.createElement('div');
      info.className = 'dash-card-info';
      info.innerHTML = `
        <div class="dash-card-name">${esc(data.boardName||'Untitled')}</div>
        <div class="dash-card-meta"><span>${elemCount} element${elemCount!==1?'s':''}</span><span>${date}</span></div>`;

      const delBtn = document.createElement('button');
      delBtn.className = 'dash-delete-btn';
      delBtn.innerHTML = '✕';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`Delete "${data.boardName||'Untitled'}"?`)) return;
        const all = loadAllBoards();
        delete all[data.id];
        saveAllBoards(all);
        card.remove();
        if (data.id === S.boardId) {
          const rem = Object.keys(all);
          if (rem.length) loadBoard(rem[0]);
          else {
            clearBoard();
            const nid = createNewBoard();
            S.boardId = nid; S.boardName = 'Untitled Board';
            boardNameEl.textContent = S.boardName;
            setActiveId(nid);
          }
        }
      });

      card.appendChild(previewEl);
      card.appendChild(info);
      card.appendChild(delBtn);
      if (isActive) { card.style.borderColor = 'var(--accent)'; }
      card.addEventListener('click', () => { closeDashboard(); if (data.id !== S.boardId) { saveCurrentBoard(); loadBoard(data.id); } });
      dashGrid.appendChild(card);
    });
  }

  /* ══════════════════════════════
     HELPERS
  ══════════════════════════════ */
  function hexRgba(hex, a) {
    if (!hex || hex.length < 7) return `rgba(59,130,246,${a})`;
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function addWelcomeCard() {
    const rect = canvasCont.getBoundingClientRect();
    const pos  = canvasPoint(rect.width/2, rect.height/2);
    const id   = uid();
    const data = {
      id, type: 'card',
      x: pos.x - 130, y: pos.y - 90,
      w: 270, h: 190,
      color: '#3B82F6',
      title: 'Welcome to Boardflow',
      tags: 'start here',
      content: 'V · C · T · L  for tools\nScroll to zoom · Middle-click to pan',
    };
    S.elements[id] = data;
    spawnCard(0, 0, data);
    saveCurrentBoard();
  }

  /* ══════════════════════════════
     BOOT
  ══════════════════════════════ */
  function boot() {
    applyTheme(localStorage.getItem('boardflow_theme') || 'dark');
    initPanzoom();

    const rect = canvasCont.getBoundingClientRect();
    S.pz.pan(rect.width/2 - 3000, rect.height/2 - 3000, { animate: false });

    const boards = loadAllBoards();
    let activeId = getActiveId();
    if (!activeId || !boards[activeId]) {
      const ids = Object.keys(boards);
      activeId = ids.length
        ? ids.sort((a,b) => (boards[b].updatedAt||0) - (boards[a].updatedAt||0))[0]
        : createNewBoard();
    }

    S.boardId = activeId;
    loadBoard(activeId);

    if (Object.keys(S.elements).length === 0) {
      setTimeout(addWelcomeCard, 150);
    }

    // Continuous leader line sync
    setInterval(redrawAllLeaderLines, 250);

    setMode('select');
    updateZoomStatus();
  }

  boot();

})();
