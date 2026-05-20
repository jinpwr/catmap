/* ═══════════════════════════════════════════════════════════
   Boardflow — app.js  (updated)
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Helpers ── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ── State ── */
  const state = {
    elements: {},
    connections: [],
    mode: 'select',
    selected: [],
    lineInstances: {},
    connectStep: 0,
    connectFirst: null,
    panzoom: null,
    activeColor: '#4F7FFF',
  };

  /* ── DOM refs ── */
  const canvasContainer = $('#canvas-container');
  const canvas = $('#canvas');
  const colorPicker = $('#color-picker');
  const statusMode = $('#status-mode');
  const statusZoom = $('#status-zoom');
  const statusHint = $('#status-hint');
  const contextMenu = $('#context-menu');
  const connectionOverlay = $('#connection-overlay');
  const connectionBanner = $('.connection-banner');

  /* ════════════════════════════════════
     PANZOOM SETUP
  ════════════════════════════════════ */
  function initPanzoom() {
    const pz = window.Panzoom(canvas, {
      maxScale: 3,
      minScale: 0.2,
      step: 0.08,
      canvas: true,
      contain: false,
      excludeClass: 'no-pan',
    });
    state.panzoom = pz;

    canvasContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      pz.zoomWithWheel(e);
      updateZoomStatus();
      scheduleLineUpdate();
    }, { passive: false });

    let spaceDown = false;
    let midDrag = false;
    let midStart = null;
    let panStartXY = null;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.target.isContentEditable && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        spaceDown = true;
        canvasContainer.style.cursor = 'grab';
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        spaceDown = false;
        canvasContainer.style.cursor = '';
      }
    });

    canvasContainer.addEventListener('mousedown', (e) => {
      if (e.button === 1 || spaceDown) {
        e.preventDefault();
        midDrag = true;
        midStart = { x: e.clientX, y: e.clientY };
        panStartXY = { x: pz.getPan().x, y: pz.getPan().y };
        canvasContainer.classList.add('panning');
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!midDrag || !midStart) return;
      const dx = e.clientX - midStart.x;
      const dy = e.clientY - midStart.y;
      pz.pan(panStartXY.x + dx, panStartXY.y + dy);
      scheduleLineUpdate();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 1 || midDrag) {
        midDrag = false;
        midStart = null;
        panStartXY = null;
        canvasContainer.classList.remove('panning');
      }
    });

    pz.zoom(1, { animate: false });
    updateZoomStatus();
  }

  function updateZoomStatus() {
    if (!state.panzoom) return;
    const s = state.panzoom.getScale();
    statusZoom.textContent = Math.round(s * 100) + '%';
  }

  /* ════════════════════════════════════
     CANVAS CLICK → spawn element
  ════════════════════════════════════ */
  canvasContainer.addEventListener('click', (e) => {
    if (e.target !== canvasContainer && e.target !== canvas) return;
    if (state.mode === 'select') { clearSelection(); return; }
    if (state.mode === 'line') return;
    const pos = canvasPoint(e.clientX, e.clientY);
    if (state.mode === 'card') spawnCard(pos.x, pos.y);
    if (state.mode === 'text') spawnText(pos.x, pos.y);
    setMode('select');
  });

  function canvasPoint(clientX, clientY) {
    const pz = state.panzoom;
    const scale = pz.getScale();
    const pan = pz.getPan();
    const rect = canvasContainer.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / scale,
      y: (clientY - rect.top - pan.y) / scale,
    };
  }

  /* ════════════════════════════════════
     MODE MANAGEMENT
  ════════════════════════════════════ */
  function setMode(mode) {
    state.mode = mode;
    $$('.tool-btn').forEach(b => b.classList.remove('active'));
    const btn = $(`[data-mode="${mode}"]`);
    if (btn) btn.classList.add('active');

    const modeLabels = {
      select: '● Select',
      card: '◆ Card',
      text: '◎ Text',
      line: '⟜ Connect',
    };
    statusMode.textContent = modeLabels[mode] || '● Select';

    if (mode === 'line') {
      startConnectionMode();
    } else {
      canvasContainer.classList.remove('connect-mode');
    }
  }

  $('#btn-select').addEventListener('click', () => setMode('select'));
  $('#btn-card').addEventListener('click', () => {
    setMode('card');
    statusHint.textContent = 'Click on canvas to place card';
  });
  $('#btn-text').addEventListener('click', () => {
    setMode('text');
    statusHint.textContent = 'Click on canvas to place text';
  });
  $('#btn-line').addEventListener('click', () => setMode('line'));

  document.addEventListener('keydown', (e) => {
    if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
    if (e.key === 'v' || e.key === 'V') setMode('select');
    if (e.key === 'c' || e.key === 'C') { setMode('card'); statusHint.textContent = 'Click on canvas to place card'; }
    if (e.key === 't' || e.key === 'T') { setMode('text'); statusHint.textContent = 'Click on canvas to place text'; }
    if (e.key === 'l' || e.key === 'L') setMode('line');
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    if (e.key === 'Escape') {
      clearSelection();
      setMode('select');
      cancelConnectionMode();
      hideContextMenu();
    }
  });

  /* ════════════════════════════════════
     LIGHT / DARK MODE TOGGLE
  ════════════════════════════════════ */
  let isLightMode = false;
  const themeIconDark = $('#theme-icon-dark');
  const themeIconLight = $('#theme-icon-light');
  const themeLabel = $('#theme-label');

  $('#btn-theme').addEventListener('click', () => {
    isLightMode = !isLightMode;
    document.body.classList.toggle('light-mode', isLightMode);
    if (isLightMode) {
      themeIconDark.style.display = 'none';
      themeIconLight.style.display = '';
      themeLabel.textContent = 'Dark';
    } else {
      themeIconDark.style.display = '';
      themeIconLight.style.display = 'none';
      themeLabel.textContent = 'Light';
    }
  });

  /* ════════════════════════════════════
     EXPORT AS PDF
  ════════════════════════════════════ */
  $('#export-pdf-btn').addEventListener('click', async () => {
    const btn = $('#export-pdf-btn');
    const origText = btn.innerHTML;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2"/></svg> Exporting…`;
    btn.disabled = true;

    try {
      // Temporarily show the canvas at scale 1 for capture
      const pz = state.panzoom;
      const scale = pz.getScale();
      const pan = pz.getPan();

      // Find bounding box of all elements
      const els = Object.values(state.elements);
      if (els.length === 0) { alert('Nothing to export!'); return; }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      els.forEach(s => {
        minX = Math.min(minX, s.x);
        minY = Math.min(minY, s.y);
        maxX = Math.max(maxX, s.x + (s.w || 240));
        maxY = Math.max(maxY, s.y + (s.h || 160));
      });
      const padding = 60;
      minX -= padding; minY -= padding; maxX += padding; maxY += padding;
      const bw = maxX - minX, bh = maxY - minY;

      // Pan/zoom canvas to fit the bounding box in the viewport
      const vw = canvasContainer.clientWidth;
      const vh = canvasContainer.clientHeight;
      const fitScale = Math.min(vw / bw, vh / bh, 1.5);
      pz.zoom(fitScale, { animate: false });
      pz.pan(-minX * fitScale + (vw - bw * fitScale) / 2, -minY * fitScale + (vh - bh * fitScale) / 2, { animate: false });
      scheduleLineUpdate();

      await new Promise(r => setTimeout(r, 400));

      const captureEl = canvasContainer;
      const canvasEl = await html2canvas(captureEl, {
        backgroundColor: isLightMode ? '#f0f0f4' : '#0f0f11',
        scale: 2,
        useCORS: true,
        logging: false,
      });

      // Restore pan/zoom
      pz.zoom(scale, { animate: false });
      pz.pan(pan.x, pan.y, { animate: false });
      scheduleLineUpdate();

      const imgData = canvasEl.toDataURL('image/png');
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: canvasEl.width > canvasEl.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvasEl.width, canvasEl.height],
      });
      pdf.addImage(imgData, 'PNG', 0, 0, canvasEl.width, canvasEl.height);
      pdf.save('boardflow-export.pdf');
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed. See console for details.');
    } finally {
      btn.innerHTML = origText;
      btn.disabled = false;
    }
  });

  /* ════════════════════════════════════
     SPAWN CARD
  ════════════════════════════════════ */
  function spawnCard(x, y, data = null) {
    const id = data?.id || uid();
    const elData = data || {
      id, type: 'card',
      x: x + 16, y: y + 16,
      w: 240, h: 160,
      color: state.activeColor,
      title: '',
      tags: [],
      content: '',
    };
    // Migrate old string tags to array
    if (typeof elData.tags === 'string') {
      elData.tags = elData.tags ? elData.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    }
    if (!data) state.elements[id] = elData;

    const el = document.createElement('div');
    el.className = 'board-card no-pan';
    el.style.borderColor = elData.color;
    el.dataset.id = id;
    el.style.cssText = `left:${elData.x}px;top:${elData.y}px;width:${elData.w}px;height:${elData.h}px;`;

    el.innerHTML = `
      <div class="card-header" style="background:${colorToHeaderBg(elData.color)}">
        <button class="fold-toggle">−</button>
        <div class="card-title" contenteditable="true" spellcheck="false">${escHtml(elData.title)}</div>
      </div>
      <div class="card-tags" data-tags-container></div>
      <div class="card-body no-pan" contenteditable="true" spellcheck="false">${escHtml(elData.content)}</div>
      <div class="resize-handle" data-resize="true"></div>
    `;

    canvas.appendChild(el);

    // Render tags
    renderTags(el, elData.tags);

    setupCardInteract(el);
    setupCardEvents(el);

    // Title & body events
    el.querySelectorAll('.card-title, .card-body').forEach(ed => {
      ed.addEventListener('mousedown', e => e.stopPropagation());
      ed.addEventListener('click', e => e.stopPropagation());
      ed.addEventListener('input', () => saveElementContent(id));
      ed.addEventListener('blur', () => saveElementContent(id));
    });

    const foldBtn = el.querySelector('.fold-toggle');
    foldBtn.addEventListener('click',(e)=>{e.stopPropagation();el.classList.toggle('folded');foldBtn.textContent=el.classList.contains('folded')?'+':'−';scheduleLineUpdate();});
    return el;
  }

  /* ── TAG RENDERING & COMMA-SPLIT ── */
  function renderTags(cardEl, tagsArr) {
    const container = cardEl.querySelector('[data-tags-container]');
    container.innerHTML = '';

    tagsArr.forEach((tag, i) => {
      const span = makeTagEl(tag);
      container.appendChild(span);
      setupTagEvents(span, cardEl, i);
    });

    // Add placeholder tag for new input
    const addTag = makeTagEl('');
    container.appendChild(addTag);
    setupTagEvents(addTag, cardEl, tagsArr.length);
  }

  function makeTagEl(text) {
    const span = document.createElement('span');
    span.className = 'card-tag';
    span.contentEditable = 'true';
    span.spellcheck = false;
    span.innerText = text;
    return span;
  }

  function setupTagEvents(span, cardEl, idx) {
    span.addEventListener('mousedown', e => e.stopPropagation());
    span.addEventListener('click', e => e.stopPropagation());

    span.addEventListener('keydown', (e) => {
      if (e.key === ',') {
        e.preventDefault();
        const val = span.innerText.trim();
        if (val) {
          commitTagInput(cardEl, span, val);
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        span.blur();
      }
      if ((e.key === 'Backspace') && span.innerText === '') {
        e.preventDefault();
        deleteTagEl(cardEl, span);
      }
    });

    span.addEventListener('blur', () => {
      const val = span.innerText.trim();
      // If empty and not the only tag, remove it (unless it's the placeholder)
      const id = cardEl.dataset.id;
      const s = state.elements[id];
      if (!s) return;
      const allTags = [...cardEl.querySelectorAll('[data-tags-container] .card-tag')];
      const myIdx = allTags.indexOf(span);
      if (val === '' && myIdx < s.tags.length) {
        // It was an existing tag now cleared — remove it
        s.tags.splice(myIdx, 1);
        renderTags(cardEl, s.tags);
      } else if (val !== '' && myIdx >= s.tags.length) {
        // It was the placeholder with text — add as new tag
        s.tags.push(val.toLowerCase());
        renderTags(cardEl, s.tags);
      } else if (val !== '') {
        // Update existing
        s.tags[myIdx] = val.toLowerCase();
      }
      saveState();
    });
  }

  function commitTagInput(cardEl, span, val) {
    const id = cardEl.dataset.id;
    const s = state.elements[id];
    if (!s) return;
    const allTags = [...cardEl.querySelectorAll('[data-tags-container] .card-tag')];
    const myIdx = allTags.indexOf(span);
    if (myIdx >= s.tags.length) {
      s.tags.push(val.toLowerCase());
    } else {
      s.tags[myIdx] = val.toLowerCase();
    }
    renderTags(cardEl, s.tags);
    // Focus the new placeholder tag
    const newPlaceholder = cardEl.querySelector('[data-tags-container] .card-tag:last-child');
    if (newPlaceholder) {
      setTimeout(() => newPlaceholder.focus(), 0);
    }
    saveState();
  }

  function deleteTagEl(cardEl, span) {
    const id = cardEl.dataset.id;
    const s = state.elements[id];
    if (!s) return;
    const allTags = [...cardEl.querySelectorAll('[data-tags-container] .card-tag')];
    const myIdx = allTags.indexOf(span);
    if (myIdx < s.tags.length) {
      s.tags.splice(myIdx, 1);
      renderTags(cardEl, s.tags);
      // Focus previous tag or placeholder
      const newTags = [...cardEl.querySelectorAll('[data-tags-container] .card-tag')];
      const focusEl = newTags[Math.max(0, myIdx - 1)] || newTags[0];
      if (focusEl) setTimeout(() => focusEl.focus(), 0);
    }
    saveState();
  }

  function colorToHeaderBg(color) { return hexToRgba(color, 0.12); }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function saveElementContent(id) {
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    const s = state.elements[id];
    if (!s) return;
    if (s.type === 'card') {
      s.title = el.querySelector('.card-title')?.innerText || '';
      // tags are saved via tag events
      s.content = el.querySelector('.card-body')?.innerText || '';
    } else if (s.type === 'text') {
      s.content = el.innerText || '';
    }
    saveState();
  }

  /* ════════════════════════════════════
     SPAWN TEXT
  ════════════════════════════════════ */
  function spawnText(x, y, data = null) {
    const id = data?.id || uid();
    const elData = data || {
      id, type: 'text',
      x: x + 16, y: y + 16,
      w: 200, h: 40,
      color: state.activeColor,
      content: '',
    };
    if (!data) state.elements[id] = elData;

    const el = document.createElement('div');
    el.className = 'board-text no-pan';
    el.dataset.id = id;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.style.cssText = `left:${elData.x}px;top:${elData.y}px;min-width:${elData.w}px;color:${elData.color};`;
    el.innerText = elData.content;

    canvas.appendChild(el);
    setupTextInteract(el);
    setupTextEvents(el);

    el.addEventListener('input', () => saveElementContent(id));
    el.addEventListener('blur', () => saveElementContent(id));

    if (!data) {
      setTimeout(() => { el.focus(); }, 50);
    }
    return el;
  }

  /* ════════════════════════════════════
     INTERACT.JS — DRAG & RESIZE
     Cards: draggable from ANYWHERE (including contenteditable areas)
     using a mousedown→mousemove manual drag approach for full-element drag
  ════════════════════════════════════ */
  function setupCardInteract(el) {
    const id = el.dataset.id;

    // Manual full-card drag (ignores nothing — even contenteditable regions)
    let dragging = false;
    let dragStartClient = null;
    let dragStartPos = null;
    let clickNotDrag = false;

    el.addEventListener('mousedown', (e) => {
      // Ignore resize handle
      if (e.target.dataset && e.target.dataset.resize) return;
      // Don't initiate drag if user is clicking into a focused editable area already focused
      if (e.target.isContentEditable && document.activeElement === e.target) return;

      dragStartClient = { x: e.clientX, y: e.clientY };
      const s = state.elements[id];
      dragStartPos = { x: s.x, y: s.y };
      clickNotDrag = true;

      const onMove = (me) => {
        const dx = me.clientX - dragStartClient.x;
        const dy = me.clientY - dragStartClient.y;
        if (!dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
          dragging = true;
          clickNotDrag = false;
          el.classList.add('dragging');
          el.style.boxShadow = `0 0 0 2px ${s.color}55, 0 0 32px ${s.color}88`;
          el.style.boxShadow = `0 0 0 2px ${s.color}55, 0 0 32px ${s.color}88`;
          bringToFront(el);
          // Blur any focused editable inside so it stops being editable mid-drag
          const focused = el.querySelector(':focus');
          if (focused) focused.blur();
        }
        if (dragging) {
          const scale = state.panzoom.getScale();
          const s = state.elements[id];
          s.x = dragStartPos.x + dx / scale;
          s.y = dragStartPos.y + dy / scale;
          el.style.left = s.x + 'px';
          el.style.top = s.y + 'px';
          scheduleLineUpdate();
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragging) {
          el.classList.remove('dragging');
          el.style.boxShadow='';
          dragging = false;
          saveState();
          scheduleLineUpdate();
        }
        dragStartClient = null;
        dragStartPos = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Resize via interact
    interact(el)
      .resizable({
        edges: { right: true, bottom: true, bottomRight: '.resize-handle' },
        listeners: {
          move(e) {
            const s = state.elements[id];
            if (!s) return;
            s.w = Math.max(180, e.rect.width);
            s.h = Math.max(100, e.rect.height);
            el.style.width = s.w + 'px';
            el.style.height = s.h + 'px';
            scheduleLineUpdate();
          },
          end() { saveState(); },
        },
        modifiers: [interact.modifiers.restrictSize({ min: { width: 180, height: 100 } })],
      });
  }

  function setupTextInteract(el) {
    const id = el.dataset.id;

    let dragging = false;
    let dragStartClient = null;
    let dragStartPos = null;

    el.addEventListener('mousedown', (e) => {
      if (document.activeElement === el) return; // already editing

      dragStartClient = { x: e.clientX, y: e.clientY };
      const s = state.elements[id];
      dragStartPos = { x: s.x, y: s.y };

      const onMove = (me) => {
        const dx = me.clientX - dragStartClient.x;
        const dy = me.clientY - dragStartClient.y;
        if (!dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
          dragging = true;
          el.classList.add('dragging');
          bringToFront(el);
          el.blur();
        }
        if (dragging) {
          const scale = state.panzoom.getScale();
          const s = state.elements[id];
          s.x = dragStartPos.x + dx / scale;
          s.y = dragStartPos.y + dy / scale;
          el.style.left = s.x + 'px';
          el.style.top = s.y + 'px';
          scheduleLineUpdate();
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragging) {
          el.classList.remove('dragging');
          el.style.boxShadow='';
          dragging = false;
          saveState();
          scheduleLineUpdate();
        }
        dragStartClient = null;
        dragStartPos = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ════════════════════════════════════
     SELECTION
  ════════════════════════════════════ */
  function setupCardEvents(el) {
    el.addEventListener('mousedown', (e) => {
      if (e.target.dataset && e.target.dataset.resize) return;
      handleElementClick(el, e);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!state.selected.includes(el.dataset.id)) {
        handleElementClick(el, { shiftKey: false });
      }
      showContextMenu(e.clientX, e.clientY);
    });
  }

  function setupTextEvents(el) {
    el.addEventListener('mousedown', (e) => {
      handleElementClick(el, e);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!state.selected.includes(el.dataset.id)) {
        handleElementClick(el, { shiftKey: false });
      }
      showContextMenu(e.clientX, e.clientY);
    });
  }

  function handleElementClick(el, e) {
    const id = el.dataset.id;

    if (state.mode === 'line') {
      handleConnectionClick(id);
      return;
    }

    if (e.shiftKey) {
      if (state.selected.includes(id)) {
        state.selected = state.selected.filter(s => s !== id);
        el.classList.remove('selected');
      } else {
        if (state.selected.length < 2) {
          state.selected.push(id);
          el.classList.add('selected');
        }
      }
    } else {
      clearSelection();
      state.selected = [id];
      el.classList.add('selected');
    }

    updateSelectionHint();
  }

  function clearSelection() {
    state.selected = [];
    $$('.board-card.selected, .board-text.selected').forEach(el => el.classList.remove('selected'));
    updateSelectionHint();
  }

  function updateSelectionHint() {
    const n = state.selected.length;
    if (n === 0) statusHint.textContent = 'Shift+click to multi-select · Right-click to connect';
    else if (n === 1) statusHint.textContent = 'Shift+click another to multi-select · Right-click for options';
    else if (n === 2) statusHint.textContent = '2 selected — Right-click to connect';
  }

  function bringToFront(el) {
    const all = $$('.board-card, .board-text');
    const maxZ = all.reduce((m, e) => Math.max(m, parseInt(e.style.zIndex || 0)), 0);
    el.style.zIndex = maxZ + 1;
  }

  /* ════════════════════════════════════
     CONTEXT MENU
  ════════════════════════════════════ */
  canvasContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (e.target === canvasContainer || e.target === canvas) {
      showContextMenu(e.clientX, e.clientY);
    }
  });

  function showContextMenu(x, y) {
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.remove('hidden');
    const canConnect = state.selected.length === 2;
    $('#ctx-connect').style.display = canConnect ? '' : 'none';
    setTimeout(() => {
      document.addEventListener('click', hideContextMenu, { once: true });
    }, 0);
  }

  function hideContextMenu() { contextMenu.classList.add('hidden'); }

  $('#ctx-connect').addEventListener('click', () => {
    hideContextMenu();
    if (state.selected.length === 2) createConnection(state.selected[0], state.selected[1]);
  });
  $('#ctx-delete').addEventListener('click', () => { hideContextMenu(); deleteSelected(); });
  $('#ctx-cancel').addEventListener('click', () => { hideContextMenu(); });

  /* ════════════════════════════════════
     CONNECTION MODE
  ════════════════════════════════════ */
  function startConnectionMode() {
    state.connectStep = 1;
    state.connectFirst = null;
    canvasContainer.classList.add('connect-mode');
    connectionOverlay.classList.remove('hidden');
    connectionBanner.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="3" cy="3" r="2" fill="currentColor" opacity="0.7"/>
        <circle cx="13" cy="13" r="2" fill="currentColor" opacity="0.7"/>
        <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>
      </svg>
      Connection Mode — click first element
      <button id="cancel-connect-mode">✕ Cancel</button>
    `;
    $('#cancel-connect-mode').addEventListener('click', cancelConnectionMode);
  }

  function cancelConnectionMode() {
    state.connectStep = 0;
    state.connectFirst = null;
    canvasContainer.classList.remove('connect-mode');
    connectionOverlay.classList.add('hidden');
    $$('.connect-source').forEach(el => el.classList.remove('connect-source'));
    if (state.mode === 'line') setMode('select');
  }

  function handleConnectionClick(id) {
    if (state.connectStep === 1) {
      state.connectFirst = id;
      state.connectStep = 2;
      const el = canvas.querySelector(`[data-id="${id}"]`);
      if (el) el.classList.add('connect-source');
      connectionBanner.classList.add('second-click');
      connectionBanner.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="3" cy="3" r="2" fill="currentColor" opacity="0.7"/>
          <circle cx="13" cy="13" r="2" fill="currentColor" opacity="0.7"/>
          <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>
        </svg>
        Now click the second element
        <button id="cancel-connect-mode">✕ Cancel</button>
      `;
      $('#cancel-connect-mode').addEventListener('click', cancelConnectionMode);
    } else if (state.connectStep === 2 && id !== state.connectFirst) {
      createConnection(state.connectFirst, id);
      cancelConnectionMode();
    }
  }

  /* ════════════════════════════════════
     LEADER LINE CONNECTIONS
  ════════════════════════════════════ */
  function createConnection(fromId, toId) {
    const exists = state.connections.find(
      c => (c.fromId === fromId && c.toId === toId) || (c.fromId === toId && c.toId === fromId)
    );
    if (exists) return;
    const connId = uid();
    state.connections.push({ id: connId, fromId, toId, color: '#000000' });
    drawLine(connId, fromId, toId, '#000000');
    saveState();
  }

  function drawLine(connId, fromId, toId, color) {
    const fromEl = canvas.querySelector(`[data-id="${fromId}"]`);
    const toEl = canvas.querySelector(`[data-id="${toId}"]`);
    if (!fromEl || !toEl) return;
    if (state.lineInstances[connId]) {
      try { state.lineInstances[connId].remove(); } catch(e) {}
      delete state.lineInstances[connId];
    }
    try {
      const line = new LeaderLine(fromEl, toEl, {
        color: color || '#000000',
        size: 2,
        path: 'straight',
        startPlug: 'disc',
        endPlug: 'disc',
        startPlugSize: 1.5,
        endPlugSize: 1.8,
        
      });
      state.lineInstances[connId] = line;
    } catch (e) { console.warn('LeaderLine error:', e); }
  }

  function redrawAllLines() {
    state.connections.forEach(conn => {
      if (state.lineInstances[conn.id]) {
        try { state.lineInstances[conn.id].position(); } catch(e) {}
      }
    });
  }

  let lineUpdateTimer = null;
  function scheduleLineUpdate() {
    if (lineUpdateTimer) cancelAnimationFrame(lineUpdateTimer);
    lineUpdateTimer = requestAnimationFrame(redrawAllLines);
  }

  function removeConnectionsForElement(id) {
    const toRemove = state.connections.filter(c => c.fromId === id || c.toId === id);
    toRemove.forEach(conn => {
      if (state.lineInstances[conn.id]) {
        try { state.lineInstances[conn.id].remove(); } catch(e) {}
        delete state.lineInstances[conn.id];
      }
    });
    state.connections = state.connections.filter(c => c.fromId !== id && c.toId !== id);
  }

  /* ════════════════════════════════════
     DELETE
  ════════════════════════════════════ */
  $('#btn-delete').addEventListener('click', deleteSelected);

  function deleteSelected() {
    state.selected.forEach(id => deleteElement(id));
    state.selected = [];
    saveState();
    updateSelectionHint();
  }

  function deleteElement(id) {
    removeConnectionsForElement(id);
    const el = canvas.querySelector(`[data-id="${id}"]`);
    if (el) el.remove();
    delete state.elements[id];
  }

  $('#btn-clear').addEventListener('click', () => {
    if (!confirm('Clear the entire board? This cannot be undone.')) return;
    Object.values(state.lineInstances).forEach(line => { try { line.remove(); } catch(e) {} });
    state.lineInstances = {};
    state.connections = [];
    state.elements = {};
    state.selected = [];
    canvas.innerHTML = '';
    saveState();
  });

  /* ════════════════════════════════════
     COLOR
  ════════════════════════════════════ */
  colorPicker.addEventListener('input', (e) => {
    state.activeColor = e.target.value;
    applyColorToSelected(e.target.value);
    clearSwatchActive();
  });

  $$('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const color = sw.dataset.color;
      state.activeColor = color;
      colorPicker.value = color;
      applyColorToSelected(color);
      clearSwatchActive();
      sw.classList.add('active-swatch');
    });
  });

  function clearSwatchActive() { $$('.swatch').forEach(s => s.classList.remove('active-swatch')); }

  function applyColorToSelected(color) {
    state.selected.forEach(id => {
      const s = state.elements[id];
      if (!s) return;
      s.color = color;
      if (s.type === 'card') {
        const el = canvas.querySelector(`[data-id="${id}"]`);
        if (el) {
          el.querySelector('.card-header').style.background = colorToHeaderBg(color);
          el.style.borderColor = color;
        }
      } else if (s.type === 'text') {
        const el = canvas.querySelector(`[data-id="${id}"]`);
        if (el) el.style.color = color;
      }
    });
    state.connections.forEach(conn => {
      if (state.selected.includes(conn.fromId) || state.selected.includes(conn.toId)) {
        conn.color = color;
        if (state.lineInstances[conn.id]) {
          try { state.lineInstances[conn.id].color = color; } catch(e) {}
        }
      }
    });
    saveState();
  }

  /* ════════════════════════════════════
     PERSISTENCE
  ════════════════════════════════════ */
  const STORAGE_KEY = 'boardflow_v3';

  function saveState() {
    const data = {
      elements: state.elements,
      connections: state.connections.map(c => ({ id: c.id, fromId: c.fromId, toId: c.toId, color: c.color })),
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.elements) {
        Object.entries(data.elements).forEach(([id, el]) => {
          state.elements[id] = el;
          if (el.type === 'card') spawnCard(0, 0, el);
          if (el.type === 'text') spawnText(0, 0, el);
        });
      }
      if (data.connections) {
        data.connections.forEach(conn => {
          state.connections.push(conn);
          setTimeout(() => drawLine(conn.id, conn.fromId, conn.toId, conn.color), 100);
        });
      }
    } catch(e) { console.warn('localStorage load failed:', e); }
  }

  /* ════════════════════════════════════
     BOOT
  ════════════════════════════════════ */
  function boot() {
    initPanzoom();
    loadState();
    setMode('select');

    const pz = state.panzoom;
    const rect = canvasContainer.getBoundingClientRect();
    pz.pan(rect.width / 2 - 2000, rect.height / 2 - 2000, { animate: false });

    if (Object.keys(state.elements).length === 0) {
      setTimeout(() => {
        const cx = 2000, cy = 2000;
        const welcomeId = uid();
        const s = {
          id: welcomeId,
          type: 'card',
          x: cx - 130, y: cy - 90,
          w: 280, h: 200,
          color: '#4F7FFF',
          title: 'Welcome to Boardflow',
          tags: ['start', 'here'],
          content: 'Drag to move · Scroll to zoom · V/C/T/L for tools',
        };
        state.elements[welcomeId] = s;
        spawnCard(0, 0, s);
        saveState();
      }, 200);
    }

    setInterval(redrawAllLines, 200);
  }


  /* drag select */
  let selectionBox=null,selectStart=null;
  canvasContainer.addEventListener('mousedown',(e)=>{
    if(e.target!==canvas&&e.target!==canvasContainer)return;
    if(state.mode!=='select')return;
    selectStart=canvasPoint(e.clientX,e.clientY);
    selectionBox=document.createElement('div');
    selectionBox.className='selection-box';
    canvas.appendChild(selectionBox);
    const move=(me)=>{
      const p=canvasPoint(me.clientX,me.clientY);
      const x=Math.min(selectStart.x,p.x),y=Math.min(selectStart.y,p.y);
      const w=Math.abs(selectStart.x-p.x),h=Math.abs(selectStart.y-p.y);
      Object.assign(selectionBox.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
    };
    const up=(me)=>{
      const rect=selectionBox.getBoundingClientRect();
      clearSelection();
      $$('.board-card,.board-text').forEach(el=>{
        const r=el.getBoundingClientRect();
        if(!(r.right<rect.left||r.left>rect.right||r.bottom<rect.top||r.top>rect.bottom)){
          state.selected.push(el.dataset.id);el.classList.add('selected');
        }
      });
      updateSelectionHint();
      selectionBox.remove();selectionBox=null;
      document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
    };
    document.addEventListener('mousemove',move);
    document.addEventListener('mouseup',up);
  });

  boot();

})();
