'use strict';

/* =====================================================================
   app.js - JS cho cả 3 tab (tách thành nhiều file sau cũng được)
   Cấu trúc:  Tiện ích  ->  Tab 1 Phân trang  ->  Tab 2 Infinite scroll  ->  Tab 3 Chatbot  ->  Điều hướng tab
   ===================================================================== */

const API = 'api/';
const DOMAINS = [
  'github.com', 'medium.com', 'nytimes.com', 'arxiv.org', 'blog.example.com',
  'dev.to', 'youtube.com', 'wikipedia.org', 'substack.com', 'news.ycombinator.com',
];
const SLOW_MS = 200; // truy vấn chậm hơn mức này sẽ được tô đỏ

/* ---------------------------------------------------------------------
   TIỆN ÍCH
   --------------------------------------------------------------------- */
const nf = new Intl.NumberFormat('vi-VN');
const $ = (selector, root = document) => root.querySelector(selector);

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url) ? url : '#';
}

function ago(seconds) {
  if (seconds < 60) return 'vừa xong';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' phút trước';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' giờ trước';
  const days = Math.floor(hours / 24);
  if (days < 30) return days + ' ngày trước';
  if (days < 365) return Math.floor(days / 30) + ' tháng trước';
  return Math.floor(days / 365) + ' năm trước';
}

const BAR_MAX_MS = 600; // thanh đo đầy khi chậm bằng mức này

const ICON_UP = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 3l5.5 9h-11z"/></svg>';
const ICON_CHAT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3h11v7.5H7L4.5 13v-2.5h-2z"/></svg>';

// Mỗi chủ đề một màu nhãn cố định để mắt nhận ra nhanh
const TOPIC_HUES = {
  Rust: 18, Python: 215, Go: 175, JavaScript: 48, PostgreSQL: 255,
  MySQL: 330, AI: 285, Linux: 95, Security: 0, Startups: 140,
};

function tagHTML(topic) {
  return `<span class="tag" style="--h:${TOPIC_HUES[topic] ?? 220}">${esc(topic)}</span>`;
}

function fillDomains(select) {
  select.insertAdjacentHTML('beforeend', DOMAINS.map((d) => `<option>${esc(d)}</option>`).join(''));
}

/**
 * Dải ô số liệu. Ô có `ms` hiện thanh đo độ trễ (đỏ nếu chậm); ô còn lại chỉ hiện giá trị.
 */
function statStrip(items) {
  return items.map((it) => {
    if (it.ms === undefined) {
      return `<div class="stat"><span class="stat-label">${esc(it.label)}</span>` +
        `<span class="stat-value">${esc(it.value)}</span></div>`;
    }
    const width = Math.max(3, Math.min(100, (it.ms / BAR_MAX_MS) * 100));
    return `<div class="stat${it.ms > SLOW_MS ? ' slow' : ''}"><span class="stat-label">${esc(it.label)}</span>` +
      `<span class="stat-value">${nf.format(it.ms)}<small>ms</small></span>` +
      `<span class="bar"><i style="width:${width}%"></i></span></div>`;
  }).join('');
}

function skeletons(count) {
  return Array.from({ length: count }, () => '<li class="skeleton"><i></i><i></i></li>').join('');
}

function storyHTML(s, rank) {
  return `
    <li class="story">
      <span class="rank">${nf.format(rank)}</span>
      <div class="body">
        <a class="title" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>
        <div class="meta">
          ${tagHTML(s.topic)}
          <span class="pts">${ICON_UP}${nf.format(s.points)}</span>
          <span>${ICON_CHAT}${nf.format(s.num_comments)}</span>
          <span>${esc(s.domain)}</span>
          <span>${esc(s.author)}</span>
          <span>${ago(s.age_s)}</span>
        </div>
      </div>
    </li>`;
}

/** fetch JSON + đo thời gian khứ hồi (round trip) phía trình duyệt. */
async function getJSON(url, options) {
  const start = performance.now();
  const res = await fetch(url, options);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Máy chủ trả về dữ liệu không hợp lệ (kiểm tra PHP có báo lỗi không).');
  }
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Lỗi HTTP ' + res.status);
  }
  data._rtt = Math.round(performance.now() - start);
  return data;
}

/* ---------------------------------------------------------------------
   TAB 1 - PHÂN TRANG TRUYỀN THỐNG (offset.php)
   --------------------------------------------------------------------- */
function initPagination() {
  const sortSel = $('#pg-sort');
  const domainSel = $('#pg-domain');
  const perSel = $('#pg-per');
  const list = $('#pg-list');
  const pager = $('#pg-pager');
  const metrics = $('#pg-metrics');
  const sqlBox = $('#pg-sql');
  const jumpForm = $('#pg-jump');
  const jumpInput = $('#pg-jump-input');

  let current = 1;
  let totalPages = 1;
  let requestId = 0;
  let firstLoad = true;

  fillDomains(domainSel);

  function pageWindow(cur, total) {
    const keep = new Set([1, total]);
    for (let p = cur - 2; p <= cur + 2; p++) {
      if (p >= 1 && p <= total) keep.add(p);
    }
    const sorted = [...keep].sort((a, b) => a - b);
    const out = [];
    sorted.forEach((p, i) => {
      if (i > 0 && p - sorted[i - 1] > 1) out.push('…');
      out.push(p);
    });
    return out;
  }

  function renderPager(cur, total) {
    const btn = (label, page, extra = '') =>
      `<button type="button" data-page="${page}" ${extra}>${label}</button>`;
    let html = btn('Trước', cur - 1, cur <= 1 ? 'disabled' : '');
    pageWindow(cur, total).forEach((p) => {
      html += p === '…'
        ? '<span class="gap" aria-hidden="true">…</span>'
        : btn(nf.format(p), p, p === cur ? 'aria-current="page"' : '');
    });
    html += btn('Sau', cur + 1, cur >= total ? 'disabled' : '');
    pager.innerHTML = html;
  }

  function render(d) {
    current = d.page;
    totalPages = d.total_pages;
    list.innerHTML = d.items.map((s, i) => storyHTML(s, d.offset + i + 1)).join('')
      || '<li class="status">Không có bài nào khớp bộ lọc.</li>';

    metrics.innerHTML = statStrip([
      { label: 'Trang', value: `${nf.format(d.page)}/${nf.format(d.total_pages)}` },
      { label: 'Tổng số bài', value: nf.format(d.total) },
      { label: 'OFFSET', value: nf.format(d.offset) },
      { label: 'Đếm tổng (COUNT)', ms: d.count_ms },
      { label: 'Lấy trang', ms: d.query_ms },
      { label: 'Tổng cả mạng', ms: d._rtt },
    ]);
    sqlBox.textContent = d.sql;
    renderPager(d.page, d.total_pages);
    jumpInput.max = d.total_pages;
  }

  async function load(page) {
    const myRequest = ++requestId;
    list.classList.add('loading');
    if (firstLoad) list.innerHTML = skeletons(8);
    const params = new URLSearchParams({
      page, per_page: perSel.value, sort: sortSel.value, domain: domainSel.value,
    });
    try {
      const data = await getJSON(API + 'offset.php?' + params);
      if (myRequest !== requestId) return; // đã có yêu cầu mới hơn
      render(data);
      if (!firstLoad) list.scrollIntoView({ block: 'start' });
      firstLoad = false;
    } catch (err) {
      if (myRequest === requestId) {
        metrics.innerHTML = '<p class="error">Lỗi: ' + esc(err.message) + '</p>';
        if (firstLoad) list.innerHTML = '';
      }
    } finally {
      if (myRequest === requestId) list.classList.remove('loading');
    }
  }

  pager.addEventListener('click', (e) => {
    const target = e.target.closest('button[data-page]');
    if (target && !target.disabled) load(Number(target.dataset.page));
  });

  jumpForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const page = Math.max(1, Math.floor(Number(jumpInput.value) || 0));
    if (page) load(page);
  });

  [sortSel, domainSel, perSel].forEach((el) => el.addEventListener('change', () => load(1)));

  load(1);
}

/* ---------------------------------------------------------------------
   TAB 2 - INFINITE SCROLL (cursor.php)
   --------------------------------------------------------------------- */
function initInfinite() {
  const sortSel = $('#is-sort');
  const domainSel = $('#is-domain');
  const list = $('#is-list');
  const status = $('#is-status');
  const sentinel = $('#is-sentinel');
  const metrics = $('#is-metrics');
  const sqlBox = $('#is-sql');
  const toTop = $('#is-top');
  const panel = $('#panel-infinite');

  const state = { cursor: null, hasMore: true, loading: false, loaded: 0, generation: 0 };

  fillDomains(domainSel);

  async function loadMore() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    const generation = state.generation;
    status.innerHTML = '<span class="spinner"></span>Đang tải…';
    if (!state.loaded) list.innerHTML = skeletons(8);

    const params = new URLSearchParams({ limit: 20, sort: sortSel.value, domain: domainSel.value });
    if (state.cursor) params.set('cursor', state.cursor);

    try {
      const data = await getJSON(API + 'cursor.php?' + params);
      if (generation !== state.generation) return; // người dùng đã đổi bộ lọc

      if (!state.loaded) list.innerHTML = ''; // bỏ skeleton
      list.insertAdjacentHTML(
        'beforeend',
        data.items.map((s, i) => storyHTML(s, state.loaded + i + 1)).join('')
      );
      state.loaded += data.items.length;
      state.cursor = data.next_cursor;
      state.hasMore = data.has_more;

      const domNodes = list.getElementsByTagName('*').length;
      metrics.innerHTML = statStrip([
        { label: 'Đã tải', value: nf.format(state.loaded) + ' bài' },
        { label: 'Phần tử DOM', value: nf.format(domNodes) },
        { label: 'Lấy 20 bài', ms: data.query_ms },
        { label: 'Tổng cả mạng', ms: data._rtt },
      ]);
      sqlBox.textContent = data.sql;

      if (!state.loaded) {
        status.textContent = 'Không có bài nào khớp bộ lọc.';
      } else if (!state.hasMore) {
        status.textContent = 'Đã hết danh sách.';
      } else {
        status.textContent = '';
      }

      // Gắn lại observer: nếu sentinel vẫn còn trong tầm nhìn thì tải tiếp ngay
      observer.unobserve(sentinel);
      observer.observe(sentinel);
    } catch (err) {
      if (generation === state.generation) {
        if (!state.loaded) list.innerHTML = '';
        status.innerHTML = `Không tải được: ${esc(err.message)} <button type="button" class="retry">Thử lại</button>`;
      }
    } finally {
      if (generation === state.generation) state.loading = false;
    }
  }

  function reset() {
    state.generation++;
    state.cursor = null;
    state.hasMore = true;
    state.loading = false;
    state.loaded = 0;
    list.innerHTML = '';
    status.textContent = '';
    window.scrollTo({ top: 0 });
    loadMore();
  }

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
  }, { rootMargin: '400px' });
  observer.observe(sentinel);

  status.addEventListener('click', (e) => {
    if (e.target.closest('.retry')) loadMore();
  });

  [sortSel, domainSel].forEach((el) => el.addEventListener('change', reset));

  toTop.addEventListener('click', () => window.scrollTo({ top: 0 }));
  window.addEventListener('scroll', () => {
    toTop.hidden = panel.hidden || window.scrollY < 800;
  }, { passive: true });

  loadMore();
}

/* ---------------------------------------------------------------------
   TAB 3 - CHATBOT (chat.php)
   --------------------------------------------------------------------- */
function initChat() {
  const log = $('#chat-log');
  const form = $('#chat-form');
  const input = $('#chat-input');

  let state = null; // ngữ cảnh truy vấn trước, để hiểu "Xem thêm"
  let busy = false;

  const welcomeChips = [
    'Top bài Rust tuần này',
    'Bài mới nhất về PostgreSQL',
    'Bài trên github.com điểm cao nhất',
    'Tìm: scale performance',
    'Thống kê theo chủ đề',
  ];

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function addUser(text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    wrap.append(bubble);
    log.append(wrap);
    scrollDown();
  }

  function addBot(data) {
    const wrap = document.createElement('div');
    wrap.className = 'msg bot';

    let html = '<span class="avatar" aria-hidden="true">HN</span><div class="stack">' +
      '<div class="bubble"><span class="text"></span>';

    if (data.items && data.items.length) {
      html += '<ul class="result-list">' + data.items.map((s) => `
        <li>
          <a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>
          <div class="meta">
            ${tagHTML(s.topic)}
            <span class="pts">${ICON_UP}${nf.format(s.points)}</span>
            <span>${ICON_CHAT}${nf.format(s.num_comments)}</span>
            <span>${esc(s.domain)}</span>
            <span>${ago(s.age_s)}</span>
          </div>
        </li>`).join('') + '</ul>';
    }

    if (data.table && data.table.length) {
      html += '<table class="stat-table"><tbody>' +
        data.table.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join('') +
        '</tbody></table>';
    }
    html += '</div>';

    if (data.query_ms !== null && data.query_ms !== undefined) {
      html += `<div class="note">Truy vấn ${nf.format(data.query_ms)} ms · tổng ${nf.format(data._rtt || 0)} ms</div>`;
    }

    if (data.suggestions && data.suggestions.length) {
      html += '<div class="chips">' +
        data.suggestions.map((s) => `<button type="button" class="chip">${esc(s)}</button>`).join('') +
        '</div>';
    }

    wrap.innerHTML = html + '</div>';
    $('.text', wrap).textContent = data.reply || '';
    log.append(wrap);
    scrollDown();
  }

  function addTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'msg bot typing';
    wrap.setAttribute('aria-label', 'Bot đang trả lời');
    wrap.innerHTML = '<span class="avatar" aria-hidden="true">HN</span>' +
      '<div class="stack"><div class="bubble"><i></i><i></i><i></i></div></div>';
    log.append(wrap);
    scrollDown();
    return wrap;
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;

    busy = true;
    log.querySelectorAll('.chips').forEach((c) => c.remove()); // chỉ giữ gợi ý ở tin mới nhất
    addUser(text);
    input.value = '';
    const typing = addTyping();

    try {
      const data = await getJSON(API + 'chat.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, state }),
      });
      typing.remove();
      state = data.state;
      addBot(data);
    } catch (err) {
      typing.remove();
      addBot({ reply: 'Có lỗi: ' + err.message, suggestions: ['Thử lại: ' + text] });
    } finally {
      busy = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });

  log.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const text = chip.textContent;
    send(text.startsWith('Thử lại: ') ? text.slice('Thử lại: '.length) : text);
  });

  addBot({
    reply: 'Chào bạn! Thay vì cuộn qua 1.000.000 bài, hãy nói mình biết bạn cần gì. Chọn một gợi ý hoặc tự gõ.',
    suggestions: welcomeChips,
  });
}

/* ---------------------------------------------------------------------
   ĐIỀU HƯỚNG TAB (mỗi tab chỉ khởi tạo khi mở lần đầu -> không tốn request thừa)
   --------------------------------------------------------------------- */
const themeBtn = $('#theme-toggle');
const themeLabel = $('#theme-label');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function currentTheme() {
  return document.documentElement.dataset.theme || (prefersDark.matches ? 'dark' : 'light');
}
function paintThemeLabel() {
  themeLabel.textContent = currentTheme() === 'dark' ? 'Chế độ sáng' : 'Chế độ tối';
}
themeBtn.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('hn-theme', next); } catch { /* bỏ qua */ }
  paintThemeLabel();
});
prefersDark.addEventListener('change', paintThemeLabel);
paintThemeLabel();

const tabs = [...document.querySelectorAll('.tab')];
const initializers = { pagination: initPagination, infinite: initInfinite, chat: initChat };
const started = {};

function selectTab(tab) {
  tabs.forEach((t) => {
    const active = t === tab;
    t.setAttribute('aria-selected', String(active));
    t.tabIndex = active ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !active;
  });
  document.getElementById('is-top').hidden = true;
  window.scrollTo({ top: 0 });

  const key = tab.id.replace('tab-', '');
  if (!started[key]) {
    started[key] = true;
    initializers[key]();
  }
  history.replaceState(null, '', '#' + key);
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!move) return;
    const next = tabs[(i + move + tabs.length) % tabs.length];
    next.focus();
    selectTab(next);
  });
});

selectTab(tabs.find((t) => '#' + t.id.replace('tab-', '') === location.hash) || tabs[0]);
