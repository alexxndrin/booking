const API_BASE = 'http://localhost:3000';
const TOKEN_KEY = 'booking_token';
const USER_KEY = 'booking_user';

const viewAuth = document.getElementById('view-auth');
const viewApp = document.getElementById('view-app');
const authMessage = document.getElementById('auth-message');
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const userLabel = document.getElementById('user-label');
const searchInput = document.getElementById('search');
const catalogStatus = document.getElementById('catalog-status');
const resourceList = document.getElementById('resource-list');
const panelCatalog = document.getElementById('panel-catalog');
const panelResource = document.getElementById('panel-resource');
const panelMine = document.getElementById('panel-mine');
const adminPanel = document.getElementById('admin-panel');
const navAdmin = document.getElementById('nav-admin');
const resourceTitle = document.getElementById('resource-title');
const resourceMeta = document.getElementById('resource-meta');
const availDate = document.getElementById('avail-date');
const availStatus = document.getElementById('avail-status');
const intervalList = document.getElementById('interval-list');
const formBooking = document.getElementById('form-booking');
const bookStart = document.getElementById('book-start');
const bookEnd = document.getElementById('book-end');
const bookPurpose = document.getElementById('book-purpose');
const purposeCount = document.getElementById('purpose-count');
const bookingMessage = document.getElementById('booking-message');
const btnBook = document.getElementById('btn-book');
const mineFilter = document.getElementById('mine-filter');
const mineStatus = document.getElementById('mine-status');
const mineList = document.getElementById('mine-list');
const adminTabBookings = document.getElementById('admin-tab-bookings');
const adminTabAudit = document.getElementById('admin-tab-audit');
const adminBookings = document.getElementById('admin-bookings');
const adminAudit = document.getElementById('admin-audit');
const adminBookingsStatus = document.getElementById('admin-bookings-status');
const adminBookingsList = document.getElementById('admin-bookings-list');
const adminAuditStatus = document.getElementById('admin-audit-status');
const adminAuditTableBody = document.querySelector('#admin-audit-table tbody');

let currentUser = null;
let selectedResource = null;
let searchTimer = null;
let idempotencyKey = null;
let idempotencyFingerprint = null;
let mineCache = [];

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function isAdminUser(user) {
  return Boolean(user && user.role === 'администратор');
}

function mskToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function formatMsk(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatMskTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function showBanner(el, text, ok) {
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('is-ok', Boolean(ok));
  el.classList.toggle('is-error', Boolean(text) && !ok);
}

function setAuthMode(isLogin) {
  formLogin.hidden = !isLogin;
  formRegister.hidden = isLogin;
  tabLogin.classList.toggle('is-active', isLogin);
  tabRegister.classList.toggle('is-active', !isLogin);
  tabLogin.setAttribute('aria-selected', String(isLogin));
  tabRegister.setAttribute('aria-selected', String(!isLogin));
  showBanner(authMessage, '', false);
}

function showApp(user) {
  currentUser = user;
  viewAuth.hidden = true;
  viewApp.hidden = false;
  userLabel.textContent = `${user.name} (${user.role})`;

  if (user.role === 'администратор') {
    adminPanel.style.display = 'block';
    navAdmin.hidden = false;
  } else {
    adminPanel.style.display = 'none';
    navAdmin.hidden = true;
  }

  showCatalog();
  loadResources('');
}

function logout(expired) {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  currentUser = null;
  adminPanel.style.display = 'none';
  navAdmin.hidden = true;
  viewApp.hidden = true;
  viewAuth.hidden = false;
  if (expired) {
    showBanner(authMessage, 'Сессия истекла. Выполните вход снова.', false);
  }
}

async function api(path, options = {}) {
  const { skipAuth = false, headers: extraHeaders, ...rest } = options;
  const url = apiUrl(path);
  const headers = {
    Accept: 'application/json',
    ...(extraHeaders || {}),
  };

  if (rest.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const token = localStorage.getItem(TOKEN_KEY);
  if (!skipAuth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  console.log('Запрос:', rest.method || 'GET', url);

  let response;
  try {
    response = await fetch(url, { ...rest, headers });
  } catch (err) {
    console.error('Сеть: не удалось выполнить fetch', url, err);
    const error = new Error('Нет сети. Данные формы сохранены, повторите отправку.');
    error.offline = true;
    throw error;
  }

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Ответ не JSON:', url, response.status, raw, err);
  }

  if (!response.ok) {
    console.error('Ошибка API:', url, response.status, data);
  }

  if (response.status === 401 && !skipAuth) {
    logout(true);
    throw new Error(data.message || 'Нет действительного JWT. Выполните вход.');
  }
  if (!response.ok) {
    throw new Error(data.message || `Ошибка запроса (${response.status}).`);
  }
  return data;
}

function timeSlots() {
  const slots = [];
  for (let minutes = 8 * 60; minutes <= 22 * 60; minutes += 30) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

function fillStartOptions() {
  bookStart.innerHTML = '';
  timeSlots()
    .filter((t) => t !== '22:00')
    .forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      bookStart.appendChild(opt);
    });
  fillEndOptions();
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fillEndOptions() {
  const startMin = toMinutes(bookStart.value || '08:00');
  const minEnd = startMin + 30;
  const maxEnd = Math.min(startMin + 240, 22 * 60);
  bookEnd.innerHTML = '';
  timeSlots()
    .filter((t) => {
      const m = toMinutes(t);
      return m >= minEnd && m <= maxEnd;
    })
    .forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      bookEnd.appendChild(opt);
    });
}

function bookingFingerprint() {
  return JSON.stringify({
    resourceId: selectedResource && selectedResource.id,
    date: availDate.value,
    start: bookStart.value,
    end: bookEnd.value,
    purpose: bookPurpose.value.trim(),
  });
}

function getIdempotencyKey() {
  const fp = bookingFingerprint();
  if (!idempotencyKey || idempotencyFingerprint !== fp) {
    idempotencyKey = crypto.randomUUID();
    idempotencyFingerprint = fp;
  }
  return idempotencyKey;
}

function setNav(activeId) {
  ['nav-catalog', 'nav-mine', 'nav-admin'].forEach((id) => {
    document.getElementById(id).classList.toggle('is-active', id === activeId);
  });
}

function showCatalog() {
  panelCatalog.hidden = false;
  panelResource.hidden = true;
  panelMine.hidden = true;
  if (!isAdminUser(currentUser)) {
    adminPanel.style.display = 'none';
  }
  setNav('nav-catalog');
}

function showMine() {
  panelCatalog.hidden = true;
  panelResource.hidden = true;
  panelMine.hidden = false;
  if (!isAdminUser(currentUser)) {
    adminPanel.style.display = 'none';
  }
  setNav('nav-mine');
  loadMine();
}

function showAdmin() {
  panelCatalog.hidden = true;
  panelResource.hidden = true;
  panelMine.hidden = true;
  adminPanel.style.display = 'block';
  setNav('nav-admin');
  openAdminBookings();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function login(loginValue, password) {
  return api('/api/auth/login', {
    method: 'POST',
    skipAuth: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginValue, password }),
  });
}

async function register(name, loginValue, password) {
  return api('/api/auth/register', {
    method: 'POST',
    skipAuth: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, login: loginValue, password }),
  });
}

async function loadResources(search) {
  catalogStatus.textContent = 'Загрузка каталога…';
  resourceList.innerHTML = '';
  try {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    const data = await api(`/api/resources${query}`);
    const items = data.items || [];
    if (items.length === 0) {
      catalogStatus.textContent = 'Подходящих переговорных не найдено.';
      return;
    }
    catalogStatus.textContent = `Найдено: ${items.length}`;
    items.forEach((room) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <h3>${escapeHtml(room.name)}</h3>
        <p class="muted">${escapeHtml(room.location)}</p>
        <p>${escapeHtml(room.description || '')}</p>
      `;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-primary';
      btn.textContent = 'Смотреть занятость';
      btn.addEventListener('click', () => openResource(room));
      li.appendChild(btn);
      resourceList.appendChild(li);
    });
  } catch (err) {
    console.error('Ошибка загрузки каталога:', err);
    catalogStatus.textContent = err.message;
  }
}

function openResource(room) {
  selectedResource = room;
  panelCatalog.hidden = true;
  panelMine.hidden = true;
  panelResource.hidden = false;
  resourceTitle.textContent = room.name;
  resourceMeta.textContent = `${room.location}. ${room.description || ''}`;
  availDate.min = mskToday();
  availDate.max = addDaysYmd(mskToday(), 30);
  if (!availDate.value) {
    availDate.value = mskToday();
  }
  fillStartOptions();
  showBanner(bookingMessage, '', false);
  loadAvailability();
}

async function loadAvailability() {
  if (!selectedResource || !availDate.value) {
    return;
  }
  availStatus.textContent = 'Загрузка занятости…';
  intervalList.innerHTML = '';
  try {
    const data = await api(
      `/api/resources/${selectedResource.id}/availability?date=${encodeURIComponent(availDate.value)}`
    );
    const intervals = data.intervals || [];
    if (intervals.length === 0) {
      availStatus.textContent = 'На эту дату активных броней нет.';
      return;
    }
    availStatus.textContent = `Занятые интервалы (${intervals.length}), время московское:`;
    intervals.forEach((item) => {
      const li = document.createElement('li');
      const start = formatMskTime(item.start_time || item.startTime);
      const end = formatMskTime(item.end_time || item.endTime);
      let text = `${start}–${end}`;
      if (isAdminUser(currentUser) && (item.owner_name || item.purpose)) {
        text += ` — ${item.owner_name || ''} ${item.purpose ? `(${item.purpose})` : ''}`;
      }
      li.textContent = text.trim();
      intervalList.appendChild(li);
    });
  } catch (err) {
    console.error('Ошибка загрузки занятости:', err);
    availStatus.textContent = err.message;
  }
}

function openAdminBookings() {
  adminTabBookings.classList.add('is-active');
  adminTabAudit.classList.remove('is-active');
  adminBookings.hidden = false;
  adminAudit.hidden = true;
  loadAllBookings();
}

function openAdminAudit() {
  adminTabAudit.classList.add('is-active');
  adminTabBookings.classList.remove('is-active');
  adminBookings.hidden = true;
  adminAudit.hidden = false;
  loadAuditLogs();
}

function normalizeBooking(row) {
  return {
    id: row.id,
    resourceName: row.resourceName || row.resource_name || 'Ресурс',
    ownerName: row.ownerName || row.owner_name || '',
    ownerLogin: row.ownerLogin || row.owner_login || '',
    startTime: row.startTime || row.start_time,
    endTime: row.endTime || row.end_time,
    purpose: row.purpose,
    status: row.status,
  };
}

async function loadAllBookings() {
  adminBookingsStatus.textContent = 'Загрузка всех бронирований…';
  adminBookingsList.innerHTML = '';
  try {
    const data = await api('/api/admin/bookings');
    const items = (data.items || data.bookings || []).map(normalizeBooking);
    if (items.length === 0) {
      adminBookingsStatus.textContent = 'Бронирований в системе нет.';
      return;
    }
    adminBookingsStatus.textContent = `Всего записей: ${items.length}. Нажмите карточку, чтобы отменить (нужна причина).`;
    items.forEach((booking) => {
      const li = document.createElement('li');
      li.style.cursor = 'pointer';
      li.innerHTML = `
        <h3>${escapeHtml(booking.resourceName)}</h3>
        <p>${formatMsk(booking.startTime)} – ${formatMskTime(booking.endTime)} (MSK)</p>
        <p>Владелец: ${escapeHtml(booking.ownerName)} (${escapeHtml(booking.ownerLogin)})</p>
        <p>Цель: ${escapeHtml(booking.purpose || '')}</p>
        <p>Статус: ${escapeHtml(booking.status)}</p>
        <p class="muted">ID: ${escapeHtml(booking.id)}</p>
      `;
      li.addEventListener('click', () => cancelByAdmin(booking));
      adminBookingsList.appendChild(li);
    });
  } catch (err) {
    console.error('Ошибка загрузки всех бронирований:', err);
    adminBookingsStatus.textContent = err.message;
  }
}

async function cancelByAdmin(booking) {
  const reason = window.prompt(
    `Отмена бронирования ${booking.id}.\nУкажите обязательную причину:`,
    ''
  );
  if (reason === null) {
    return;
  }
  const cancelReason = reason.trim();
  if (!cancelReason) {
    window.alert('Причина отмены обязательна.');
    return;
  }

  try {
    await api(`/api/bookings/${booking.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelReason }),
    });
    adminBookingsStatus.textContent = 'Запись отменена.';
    await loadAllBookings();
  } catch (err) {
    console.error('Ошибка административной отмены:', err);
    adminBookingsStatus.textContent = err.message;
  }
}

async function loadAuditLogs() {
  adminAuditStatus.textContent = 'Загрузка журнала аудита…';
  adminAuditTableBody.innerHTML = '';
  try {
    const data = await api('/api/admin/audit');
    const items = data.items || data.logs || data.events || [];
    if (items.length === 0) {
      adminAuditStatus.textContent = 'Записей аудита нет.';
      return;
    }
    adminAuditStatus.textContent = `Событий: ${items.length}`;
    items.forEach((row) => {
      const tr = document.createElement('tr');
      const actor = row.actor_name || row.actorName || row.actor_login || row.actor_id || '—';
      const objectLabel = [row.object_type || row.objectType, row.object_id || row.objectId]
        .filter(Boolean)
        .join(' ');
      tr.innerHTML = `
        <td>${escapeHtml(formatMsk(row.created_at || row.createdAt))}</td>
        <td>${escapeHtml(actor)}</td>
        <td>${escapeHtml(row.action)}</td>
        <td>${escapeHtml(objectLabel)}</td>
        <td>${escapeHtml(row.result)}</td>
        <td>${escapeHtml(row.request_id || row.requestId || '')}</td>
      `;
      adminAuditTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error('Ошибка загрузки аудита:', err);
    adminAuditStatus.textContent = err.message;
  }
}

async function submitAuth(kind, body, button) {
  showBanner(authMessage, '', false);
  button.disabled = true;
  try {
    const data = kind === 'login'
      ? await login(body.login, body.password)
      : await register(body.name, body.login, body.password);
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    showApp(data.user);
  } catch (err) {
    console.error(kind === 'login' ? 'Ошибка входа:' : 'Ошибка регистрации:', err);
    showBanner(authMessage, err.message, false);
  } finally {
    button.disabled = false;
  }
}

formLogin.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth(
    'login',
    {
      login: document.getElementById('login-login').value.trim(),
      password: document.getElementById('login-password').value,
    },
    document.getElementById('btn-login')
  );
});

formRegister.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth(
    'register',
    {
      name: document.getElementById('reg-name').value.trim(),
      login: document.getElementById('reg-login').value.trim(),
      password: document.getElementById('reg-password').value,
    },
    document.getElementById('btn-register')
  );
});

tabLogin.addEventListener('click', () => setAuthMode(true));
tabRegister.addEventListener('click', () => setAuthMode(false));
document.getElementById('btn-logout').addEventListener('click', () => logout(false));
document.getElementById('btn-back').addEventListener('click', showCatalog);
document.getElementById('nav-catalog').addEventListener('click', showCatalog);
document.getElementById('nav-mine').addEventListener('click', showMine);
navAdmin.addEventListener('click', showAdmin);
adminTabBookings.addEventListener('click', openAdminBookings);
adminTabAudit.addEventListener('click', openAdminAudit);

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadResources(searchInput.value.trim());
  }, 300);
});

availDate.addEventListener('change', loadAvailability);
bookStart.addEventListener('change', fillEndOptions);
bookPurpose.addEventListener('input', () => {
  purposeCount.textContent = `${bookPurpose.value.length} / 300`;
});

formBooking.addEventListener('submit', async (event) => {
  event.preventDefault();
  const purpose = bookPurpose.value.trim();
  if (purpose.length < 5 || purpose.length > 300) {
    showBanner(bookingMessage, 'Цель должна содержать от 5 до 300 символов.', false);
    return;
  }

  const key = getIdempotencyKey();
  btnBook.disabled = true;
  showBanner(bookingMessage, 'Отправка бронирования…', true);

  try {
    const data = await api('/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        resourceId: selectedResource.id,
        startTime: `${availDate.value}T${bookStart.value}:00+03:00`,
        endTime: `${availDate.value}T${bookEnd.value}:00+03:00`,
        purpose,
      }),
    });
    const booking = data.booking;
    idempotencyKey = null;
    idempotencyFingerprint = null;
    showBanner(
      bookingMessage,
      `Запись создана. Номер: ${booking.id}. ${selectedResource.name}, ${formatMsk(booking.startTime)}–${formatMskTime(booking.endTime)} (MSK).`,
      true
    );
    bookPurpose.value = '';
    purposeCount.textContent = '0 / 300';
    await loadAvailability();
  } catch (err) {
    console.error('Ошибка создания бронирования:', err);
    showBanner(bookingMessage, err.message, false);
  } finally {
    btnBook.disabled = false;
  }
});

function canCancel(booking) {
  return booking.status === 'Активно' && new Date(booking.startTime) > new Date();
}

function renderMine() {
  const filter = mineFilter.value;
  const items = mineCache.filter((b) => filter === 'all' || b.status === filter);
  mineList.innerHTML = '';
  if (items.length === 0) {
    mineStatus.textContent = 'Записей нет.';
    return;
  }
  mineStatus.textContent = `Показано: ${items.length}`;
  items.forEach((booking) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <h3>${escapeHtml(booking.resourceName)}</h3>
      <p>${formatMsk(booking.startTime)} – ${formatMskTime(booking.endTime)} (MSK)</p>
      <p>${escapeHtml(booking.purpose || '')}</p>
      <p>Статус: ${escapeHtml(booking.status)}</p>
    `;
    if (canCancel(booking)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-danger';
      btn.textContent = 'Отменить';
      btn.addEventListener('click', () => cancelMine(booking.id));
      li.appendChild(btn);
    }
    mineList.appendChild(li);
  });
}

async function loadMine() {
  mineStatus.textContent = 'Загрузка записей…';
  mineList.innerHTML = '';
  try {
    const data = await api('/api/bookings/my');
    mineCache = (data.items || data.bookings || []).map(normalizeBooking);
    renderMine();
  } catch (err) {
    console.error('Ошибка загрузки своих бронирований:', err);
    mineStatus.textContent = err.message;
  }
}

async function cancelMine(id) {
  if (!window.confirm('Отменить эту запись? Время освободится для других.')) {
    return;
  }
  try {
    await api(`/api/bookings/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    await loadMine();
  } catch (err) {
    console.error('Ошибка отмены бронирования:', err);
    mineStatus.textContent = err.message;
  }
}

mineFilter.addEventListener('change', renderMine);

(function init() {
  fillStartOptions();
  const token = localStorage.getItem(TOKEN_KEY);
  const rawUser = localStorage.getItem(USER_KEY);
  if (token && rawUser) {
    try {
      showApp(JSON.parse(rawUser));
      return;
    } catch (err) {
      console.error('Не удалось прочитать пользователя из localStorage:', err);
      logout(false);
    }
  }
  setAuthMode(true);
})();