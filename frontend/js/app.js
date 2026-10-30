/* CONFIG */

const CONFIG = {
  YIELD_KG_PER_HECTARE: 6000,
  CONTAINER_KG: 2500,
  MAP_CENTER: [10.9, 78.4],
  MAP_ZOOM: 7
};

const UNITS = {
  hectare: {sqft: 107639.1},
  acre: {sqft: 43560},
  veli: {sqft: 288000},
  maa: {sqft: 14400},
  kuli: {sqft: 144},
  cent: {sqft: 435.6},
  sqm: {sqft: 10.7639},
  sqft: {sqft: 1}
};

const SQFT_TO_HA = 9.290304e-6;

/* STATE */

const cache = {
  centers: [],
  bookings: [],
  messages: [],
  users: [],
  summary: null,
  system: null
};

let lang = 'en';
let session = null;
let currentPage = 'home';

let map;
let markerLayer;
let tempMarker;
let pendingLatLng = null;
let photoData = '';

let manualContainerCount = false;
let manualContainerType = false;
let userAuthMode = 'user';

const $ = id => document.getElementById(id);

const t = key =>
  (I18N[lang] && I18N[lang][key]) ||
  I18N.en[key] ||
  key;

const esc = value => String(value ?? '').replace(
  /[&<>"']/g,
  character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character])
);

const getCenters = () => cache.centers;
const getBookings = () => cache.bookings;
const getMessages = () => cache.messages;
const getUsers = () => cache.users;

const isAdmin = () => session && session.role === 'admin';
const isUser = () => session && session.role === 'user';

const centerName = center =>
  lang === 'ta' && center.nameTa
    ? center.nameTa
    : center.name;

/* LOAD DATA */

async function loadCenters() {
  cache.centers = await API.get('/api/centers');
}

async function loadBookings() {
  cache.bookings = session
    ? await API.get('/api/bookings')
    : [];
}

async function loadAdminData() {
  if (isAdmin()) {
    [
      cache.messages,
      cache.users,
      cache.summary,
      cache.system
    ] = await Promise.all([
      API.get('/api/messages'),
      API.get('/api/users'),
      API.get('/api/admin/summary'),
      API.get('/api/admin/system')
    ]);
  } else {
    cache.messages = [];
    cache.users = [];
    cache.summary = null;
    cache.system = null;
  }
}

async function loadAll() {
  await loadCenters();
  await loadBookings();
  await loadAdminData();
}

function showError(error) {
  let bar = $('srvErr');

  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'srvErr';
    bar.className = 'notice';
    bar.style.cssText = `
      position:fixed;
      top:70px;
      left:50%;
      transform:translateX(-50%);
      z-index:5000;
      max-width:92vw;
      box-shadow:0 8px 30px rgba(0,0,0,.2);
    `;
    document.body.appendChild(bar);
  }

  bar.textContent = location.protocol === 'file:'
    ? 'Open this site through the server at http://localhost:3000.'
    : error.message;

  if (error.network || location.protocol === 'file:') {
    const notice = $('connectionNotice');

    if (notice) {
      notice.hidden = false;
      notice.textContent =
        'Backend connection unavailable. Start Kurukalan with npm start ' +
        'and open the localhost address printed in the terminal.';
    }
  }

  bar.style.display = 'block';
  clearTimeout(bar._t);

  bar._t = setTimeout(() => {
    bar.style.display = 'none';
  }, 6000);
}

/* LANGUAGE */

function applyLang() {
  document.documentElement.lang = lang;
  document.body.classList.toggle('ta', lang === 'ta');

  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-ph]').forEach(element => {
    element.placeholder = t(element.dataset.i18nPh);
  });

  $('langBtn').textContent = lang === 'en' ? 'தமிழ்' : 'English';

  fillUnits();
  updateEstimate();
  renderUnitTable();
  renderUserBtn();
  renderMyBookings();
  renderCenters();
  renderAdmin();
  renderTeam();
}

function toggleLang() {
  lang = lang === 'en' ? 'ta' : 'en';
  applyLang();

  if (isUser()) {
    API.patch('/api/me', {lang}).catch(() => {});
  }
}

/* NAVIGATION */

function go(page) {
  currentPage = page;

  document.querySelectorAll('.page').forEach(element => {
    element.classList.remove('show');
  });

  $('page-' + page).classList.add('show');

  document.querySelectorAll('#menu button').forEach(button => {
    button.classList.toggle('active', button.dataset.page === page);
  });

  $('menu').classList.remove('open');
  window.scrollTo({top: 0});

  if (page === 'centers') {
    setTimeout(() => {
      initMap();
      if (map) map.invalidateSize();
    }, 50);
  }

  if (page === 'admin') renderAdmin();
  if (page === 'booking') renderMyBookings();

  observeReveal();
}

document.querySelectorAll('#menu button').forEach(button => {
  button.onclick = () => go(button.dataset.page);
});

/* LOGIN */

function onUserBtn() {
  if (!session) {
    openLogin();
    return;
  }

  if (!confirm(t('logout') + '?')) return;

  API.post('/api/logout')
    .catch(() => {})
    .then(() => {
      session = null;
      cache.bookings = [];
      cache.messages = [];
      cache.users = [];
      cache.summary = null;
      cache.system = null;

      document.getElementById('bookingEditor')?.remove();

      applyLang();
      go('home');
    });
}

function openLogin() {
  $('lMsg').className = 'msg';
  $('loginModal').classList.add('show');
}

function closeLogin() {
  $('loginModal').classList.remove('show');
}

function loginTab(which) {
  userAuthMode = which;

  $('signupFields').hidden = which !== 'signup';

  for (const id of ['lName', 'lMobile']) {
    $(id).required = which === 'signup';
    $(id).disabled = which !== 'signup';
  }

  $('tabSignup').classList.toggle('on', which === 'signup');
  $('tabUser').classList.toggle('on', which === 'user');
  $('tabAdmin').classList.toggle('on', which === 'admin');

  $('lOtp').value = '';

  $('verifyOtp').dataset.i18n =
    which === 'signup' ? 'verify_signup' : 'verify_otp';

  $('verifyOtp').textContent = t($('verifyOtp').dataset.i18n);

  $('userLogin').style.display = which !== 'admin' ? '' : 'none';
  $('adminLogin').style.display = which === 'admin' ? '' : 'none';

  $('lMsg').className = 'msg';
}

function showMsg(element, kind, text) {
  element.className = 'msg ' + kind;
  element.textContent = text;
}

$('sendOtp').onclick = async () => {
  const button = $('sendOtp');
  button.disabled = true;

  try {
    const fields = userAuthMode === 'signup'
      ? ['lName', 'lMobile', 'lEmail']
      : ['lEmail'];

    for (const id of fields) {
      if (!$(id).reportValidity()) return;
    }

    await API.post('/api/auth/otp/send', {
      email: $('lEmail').value.trim()
    });

    showMsg(
      $('lMsg'),
      'ok',
      lang === 'ta'
        ? 'OTP மின்னஞ்சலில் அனுப்பப்பட்டது. குறியீட்டை உள்ளிடவும்.'
        : 'Code sent. Check your email inbox or spam folder.'
    );

    $('lOtp').focus();
  } catch (error) {
    showMsg($('lMsg'), 'err', error.message);
  } finally {
    button.disabled = false;
  }
};

$('userLogin').onsubmit = async event => {
  event.preventDefault();
  $('verifyOtp').disabled = true;

  try {
    const credentials = {
      email: $('lEmail').value.trim(),
      code: $('lOtp').value.trim()
    };

    if (userAuthMode === 'signup') {
      credentials.name = $('lName').value.trim();
      credentials.mobile = $('lMobile').value.trim();
    }

    const endpoint = userAuthMode === 'signup'
      ? '/api/signup/user'
      : '/api/login/user';

    const me = await API.post(endpoint, credentials);

    session = me;

    if (me.lang) lang = me.lang;

    $('lOtp').value = '';

    await loadBookings();
    closeLogin();
    afterLogin();
  } catch (error) {
    showMsg($('lMsg'), 'err', error.message);
  } finally {
    $('verifyOtp').disabled = false;
  }
};

$('adminLogin').onsubmit = async event => {
  event.preventDefault();

  try {
    session = await API.post('/api/login/admin', {
      id: $('aId').value.trim(),
      password: $('aPass').value
    });

    $('aPass').value = '';

    await Promise.all([
      loadBookings(),
      loadAdminData()
    ]);

    closeLogin();
    afterLogin();
    go('admin');
  } catch (error) {
    showMsg(
      $('lMsg'),
      'err',
      error.status === 401 ? t('err_admin') : error.message
    );
  }
};

function afterLogin() {
  if (isUser()) {
    $('sName').value = session.name;
    $('sMobile').value = session.mobile || '';
  }

  applyLang();
}

function renderUserBtn() {
  $('uname').textContent = session ? session.name : t('login');
  $('userBtn').title = session ? t('logout') : t('login');

  $('loginNotice').style.display = isUser() ? 'none' : '';
  $('adminCenterPanel').style.display = isAdmin() ? '' : 'none';

  let adminButton = document.querySelector(
    '#menu [data-page="admin"]'
  );

  if (isAdmin() && !adminButton) {
    adminButton = document.createElement('button');
    adminButton.dataset.page = 'admin';
    adminButton.dataset.i18n = 'ad_title';
    adminButton.onclick = () => go('admin');

    $('menu').appendChild(adminButton);
  }

  if (!isAdmin() && adminButton) {
    adminButton.remove();
  }

  if (adminButton) {
    adminButton.textContent = t('ad_title');
  }
}

/* BOOKING CALCULATION */

function fillUnits() {
  const select = $('bUnit');
  const current = select.value || 'acre';

  select.innerHTML = Object.keys(UNITS).map(unit => `
    <option value="${unit}">${esc(t('u_' + unit))}</option>
  `).join('');

  select.value = current;
}

function calc(area, unit, capacity = CONFIG.CONTAINER_KG) {
  const hectares = area * UNITS[unit].sqft * SQFT_TO_HA;
  const kg = Math.round(hectares * CONFIG.YIELD_KG_PER_HECTARE);

  const containers = area > 0
    ? Math.max(1, Math.ceil(kg / capacity))
    : 0;

  return {kg, containers};
}

function updateEstimate(resetSelection = false) {
  if (resetSelection) {
    manualContainerCount = false;
    manualContainerType = false;
  }

  const area = parseFloat($('bArea').value) || 0;
  const unit = $('bUnit').value || 'acre';

  const harvest = calc(area, unit);
  const automaticCapacity = harvest.kg <= 2500 ? 2500 : 5000;
  const automatic = calc(area, unit, automaticCapacity);

  if (!manualContainerType) {
    $('bCapacity').value = String(automaticCapacity);
  }

  const capacity = Number($('bCapacity').value);
  const selectedEstimate = calc(area, unit, capacity);

  const chosenCount = manualContainerCount
    ? Number($('bContainer').value)
    : selectedEstimate.containers;

  const options = new Set(
    Array.from({length: 100}, (_, index) => index + 1)
  );

  if (chosenCount > 0 && chosenCount <= 1e6) {
    options.add(chosenCount);
  }

  if (
    selectedEstimate.containers > 0 &&
    selectedEstimate.containers <= 1e6
  ) {
    options.add(selectedEstimate.containers);
  }

  $('bContainer').innerHTML = Array.from(options)
    .sort((a, b) => a - b)
    .map(number => `
      <option value="${number}">${number}</option>
    `).join('');

  $('bContainer').value = String(chosenCount || 1);

  $('estimate').innerHTML = `
    <div>
      ${esc(t('est_paddy'))}:
      ${harvest.kg.toLocaleString('en-IN')} kg
    </div>
    <div>
      ${esc(t('auto_recommendation'))}:
      ${automatic.containers} ×
      ${esc(t(
        automaticCapacity === 5000
          ? 'container_100'
          : 'container_50'
      ))}
    </div>
    <small>
      ${esc(t('capacity_note').replace(
        '{kg}',
        capacity.toLocaleString('en-IN')
      ))}
    </small>
  `;
}

$('bUnit').onchange = () => updateEstimate(true);
$('bArea').oninput = () => updateEstimate(true);

$('bContainer').onchange = () => {
  manualContainerCount = true;
};

$('bCapacity').onchange = () => {
  manualContainerType = true;
  manualContainerCount = false;
  updateEstimate();
};

$('resetContainers').onclick = () => updateEstimate(true);

/* BOOKING PHOTO */

$('bPhoto').onchange = event => {
  const file = event.target.files[0];
  if (!file) return;

  photoData = '';
  $('photoPrev').style.display = 'none';

  const reader = new FileReader();

  reader.onload = () => {
    const image = new Image();

    image.onload = () => {
      const scale = Math.min(
        1,
        800 / Math.max(image.width, image.height)
      );

      const canvas = document.createElement('canvas');
      canvas.width = image.width * scale;
      canvas.height = image.height * scale;

      canvas.getContext('2d').drawImage(
        image,
        0,
        0,
        canvas.width,
        canvas.height
      );

      photoData = canvas.toDataURL('image/jpeg', 0.7);

      $('photoPrev').src = photoData;
      $('photoPrev').style.display = 'block';
    };

    image.onerror = () => {
      showMsg($('bMsg'), 'err', t('err_photo'));
    };

    image.src = reader.result;
  };

  reader.readAsDataURL(file);
};

$('bDate').min = new Date().toLocaleDateString('en-CA', {
  timeZone: 'Asia/Kolkata'
});

/* SUBMIT BOOKING */

$('bookingForm').onsubmit = async event => {
  event.preventDefault();

  const message = $('bMsg');

  if (!isUser()) {
    openLogin();
    return showMsg(message, 'err', t('err_login'));
  }

  const area = parseFloat($('bArea').value) || 0;

  if (area <= 0) {
    return showMsg(message, 'err', t('err_area'));
  }

  if (!photoData) {
    return showMsg(message, 'err', t('err_photo'));
  }

  try {
    await API.post('/api/bookings', {
      address: $('bAddress').value.trim(),
      photo: photoData,
      unit: $('bUnit').value,
      area,
      date: $('bDate').value,
      containers: Number($('bContainer').value),
      containerKg: Number($('bCapacity').value)
    });

    showMsg(message, 'ok', t('ok_booked'));

    $('bAddress').value = '';
    $('bPhoto').value = '';
    $('bDate').value = '';
    photoData = '';
    $('photoPrev').style.display = 'none';

    await loadBookings();
    renderMyBookings();
  } catch (error) {
    showMsg(message, 'err', error.message);
  }
};

function unitLabel(booking) {
  return `${booking.area} ${t('u_' + booking.unit)}`;
}

function centerById(id) {
  return getCenters().find(center => center.id === id);
}

/* CUSTOMER BOOKINGS */

function renderMyBookings() {
  const box = $('myBookings');

  if (!isUser()) {
    box.innerHTML = `
      <p class="sub">${esc(t('bk_login_notice'))}</p>
    `;
    return;
  }

  const bookings = getBookings().slice().reverse();

  if (!bookings.length) {
    box.innerHTML = `
      <p class="sub">${esc(t('no_bookings'))}</p>
    `;
    return;
  }

  box.innerHTML = `
    <div class="tbl-wrap">
      <table>
        <tr>
          <th>${t('th_photo')}</th>
          <th>${t('th_date')}</th>
          <th>${t('th_land')}</th>
          <th>${t('th_paddy')}</th>
          <th>${t('th_cont')}</th>
          <th>${t('th_status')}</th>
        </tr>
        ${bookings.map(booking => `
          <tr>
            <td>
              <img
                src="${esc(booking.photo)}"
                onclick="zoom(this.src)"
              >
            </td>
            <td>${esc(booking.date)}</td>
            <td>${esc(unitLabel(booking))}</td>
            <td>${booking.kg} kg</td>
            <td>
              ${booking.containers} ×
              ${t(
                (booking.containerKg || CONFIG.CONTAINER_KG) === 5000
                  ? 'container_100'
                  : 'container_50'
              )}
            </td>
            <td>
              <span class="tag ${esc(booking.status)}">
                ${esc(t(booking.status))}
              </span>
            </td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
}

function zoom(src) {
  $('lightImg').src = src;
  $('lightbox').classList.add('show');
}

/* LAND UNIT INFORMATION */

function renderUnitTable() {
  $('unitTable').innerHTML = `
    <tr>
      <th>${t('th_unit')}</th>
      <th>${t('th_acres')}</th>
      <th>${t('th_ha')}</th>
    </tr>
    ${Object.keys(UNITS).map(unit => {
      const hectares = UNITS[unit].sqft * SQFT_TO_HA;

      return `
        <tr>
          <td>${esc(t('u_' + unit))}</td>
          <td>${(hectares / 0.404686).toPrecision(4)}</td>
          <td>${hectares.toPrecision(4)}</td>
        </tr>
      `;
    }).join('')}
  `;
}

/* CENTERS MAP */

function initMap() {
  if (map) return;

  if (typeof L === 'undefined') {
    $('map').innerHTML = `
      <p style="padding:20px">
        Map could not load.
        Please check your internet connection and refresh.
      </p>
    `;
    return;
  }

  map = L.map('map').setView(
    CONFIG.MAP_CENTER,
    CONFIG.MAP_ZOOM
  );

  const tiles = L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 18,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution:
        'Imagery &copy; Esri, Vantor, Earthstar Geographics, and the GIS User Community'
    }
  ).addTo(map);

  const referenceOptions = {
    maxZoom: 18,
    referrerPolicy: 'strict-origin-when-cross-origin'
  };

  const roads = L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    {
      ...referenceOptions,
      zIndex: 2,
      attribution: 'Roads &copy; Esri and contributors'
    }
  ).addTo(map);

  const places = L.tileLayer(
    'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    {
      ...referenceOptions,
      zIndex: 3,
      attribution: 'Place names &copy; Esri and contributors'
    }
  ).addTo(map);

  L.control.layers(
    {},
    {
      'Road routes': roads,
      'Location names': places
    },
    {
      collapsed: false,
      position: 'topright'
    }
  ).addTo(map);

  let tileWarning;

  tiles.on('tileerror', () => {
    if (tileWarning) return;

    tileWarning = document.createElement('p');
    tileWarning.className = 'notice';
    tileWarning.textContent =
      'The background map is temporarily unavailable. ' +
      'Center images and the center list are still available.';

    $('map').before(tileWarning);
  });

  tiles.on('load', () => {
    const loaded = Object.values(tiles._tiles || {}).some(tile =>
      tile.el.complete && tile.el.naturalWidth > 0
    );

    if (loaded && tileWarning) {
      tileWarning.remove();
      tileWarning = null;
    }
  });

  markerLayer = L.layerGroup().addTo(map);

  map.on('click', event => {
    if (!isAdmin()) return;

    pendingLatLng = event.latlng;

    $('cLatLng').value =
      event.latlng.lat.toFixed(5) + ', ' +
      event.latlng.lng.toFixed(5);

    if (tempMarker) map.removeLayer(tempMarker);

    tempMarker = L.marker(event.latlng).addTo(map);
  });

  renderCenters();
}

function pinIcon(active) {
  return L.divIcon({
    className: 'center-marker ' + (active ? 'active' : 'inactive'),
    html: `
      <img
        src="assets/center-container.png"
        alt="${active ? 'Active storage center' : 'Inactive storage center'}"
      >
    `,
    iconSize: [64, 64],
    iconAnchor: [32, 52],
    popupAnchor: [0, -48]
  });
}

function popupHtml(center) {
  let html = `
    <div class="pop">
      <h4>${esc(centerName(center))}</h4>
      <p>
        ${esc(t('pop_district'))}: ${esc(center.district)}
      </p>
      <p>
        ${esc(t('pop_person'))}: <b>${esc(center.person)}</b>
      </p>
      <p>
        ${esc(t('pop_phone'))}:
        <b>
          <a href="tel:${esc(center.phone.replace(/\s/g, ''))}">
            ${esc(center.phone)}
          </a>
        </b>
      </p>
      <p>
        ${esc(t('pop_status'))}:
        <span class="tag ${center.franchise ? 'on' : 'off'}">
          ${t(center.franchise ? 'fr_on' : 'fr_off')}
        </span>
      </p>
  `;

  if (isAdmin()) {
    html += `
      <p>
        <button
          class="btn small"
          onclick="toggleFranchise(${center.id})"
        >${t(center.franchise ? 'revoke' : 'grant')}</button>

        <button
          class="btn small danger"
          onclick="deleteCenter(${center.id})"
        >${t('del')}</button>
      </p>
    `;
  }

  return html + '</div>';
}

function renderCenters() {
  const centers = getCenters();

  $('centerList').innerHTML = centers.map(center => `
    <div class="center-item" onclick="focusCenter(${center.id})">
      <h4>${esc(centerName(center))}</h4>
      <p>
        ${esc(center.district)} ·
        ${esc(center.person)} ·
        ${esc(center.phone)}
      </p>
    </div>
  `).join('');

  if (!markerLayer) return;

  markerLayer.clearLayers();

  centers.forEach(center => {
    const marker = L.marker(
      [center.lat, center.lng],
      {icon: pinIcon(center.franchise)}
    )
      .bindPopup(popupHtml(center))
      .addTo(markerLayer);

    marker.cid = center.id;
  });
}

function focusCenter(id) {
  const center = centerById(id);

  if (!center || !map) return;

  map.setView([center.lat, center.lng], 10);

  markerLayer.eachLayer(marker => {
    if (marker.cid === id) marker.openPopup();
  });

  $('map').scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });
}

async function toggleFranchise(id) {
  if (!isAdmin()) return;

  const center = centerById(id);
  if (!center) return;

  try {
    await API.patch('/api/centers/' + id, {
      franchise: !center.franchise
    });

    await loadCenters();

    if (map) map.closePopup();

    refreshCenters();
  } catch (error) {
    showError(error);
  }
}

async function deleteCenter(id) {
  if (!isAdmin() || !confirm(t('delete_confirm'))) return;

  try {
    await API.del('/api/centers/' + id);

    await Promise.all([
      loadCenters(),
      loadBookings(),
      loadAdminData()
    ]);

    if (map) map.closePopup();

    refreshCenters();
  } catch (error) {
    showError(error);
  }
}

function refreshCenters() {
  renderCenters();
  renderAdmin();
}

$('centerForm').onsubmit = async event => {
  event.preventDefault();

  if (!isAdmin()) return;

  if (!pendingLatLng) {
    return showMsg($('cMsg'), 'err', t('err_map'));
  }

  try {
    await API.post('/api/centers', {
      name: $('cName').value.trim(),
      nameTa: $('cNameTa').value.trim(),
      district: $('cDistrict').value.trim(),
      person: $('cPerson').value.trim(),
      phone: $('cPhone').value.trim(),
      lat: pendingLatLng.lat,
      lng: pendingLatLng.lng,
      franchise: $('cFranchise').checked
    });

    event.target.reset();
    $('cFranchise').checked = true;
    $('cLatLng').value = '';

    if (tempMarker) {
      map.removeLayer(tempMarker);
      tempMarker = null;
    }

    pendingLatLng = null;

    await Promise.all([
      loadCenters(),
      loadAdminData()
    ]);

    showMsg($('cMsg'), 'ok', t('ok_center'));
    refreshCenters();
  } catch (error) {
    showMsg($('cMsg'), 'err', error.message);
  }
};

/* SUPPORT */

async function loadSupportContact() {
  const contact = await API.get('/api/support/contact');

  const email =
    typeof contact.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)
      ? contact.email
      : '';

  const mobile = typeof contact.mobile === 'string'
    ? contact.mobile.replace(/[^+0-9]/g, '')
    : '';

  if (email) {
    $('supportEmail').textContent = email;
    $('supportEmail').href = 'mailto:' + encodeURIComponent(email);
    $('supportEmail').hidden = false;
    $('supportEmailPending').hidden = true;
  }

  if (/^\+?\d{10,15}$/.test(mobile)) {
    $('supportPhone').textContent = contact.mobile;
    $('supportPhone').href = 'tel:' + mobile;
    $('supportPhone').hidden = false;
    $('supportPhonePending').hidden = true;

    $('supportWhatsApp').href =
      'https://wa.me/' + mobile.replace(/\D/g, '');

    $('supportWhatsApp').hidden = false;
  }
}

$('supportForm').onsubmit = async event => {
  event.preventDefault();

  try {
    const result = await API.post('/api/messages', {
      name: $('sName').value.trim(),
      mobile: $('sMobile').value.trim(),
      text: $('sText').value.trim()
    });

    $('sText').value = '';

    showMsg(
      $('sMsg'),
      'ok',
      t(
        result.emailDelivery === 'sent'
          ? 'support_sent_email'
          : 'support_saved'
      )
    );
  } catch (error) {
    showMsg($('sMsg'), 'err', error.message);
  }
};

/* ADMIN DASHBOARD */

function renderAdmin() {
  if (!isAdmin()) return;

  if (cache.system) {
    const databaseText = cache.system.database.type === 'postgres'
      ? 'Cloud PostgreSQL: connected.'
      : 'Local SQLite: connected (not cloud storage).';

    const emailText = cache.system.email.configured
      ? 'configured; real delivery must be verified.'
      : 'not configured.';

    $('adminSystemStatus').textContent =
      databaseText + ' Email sending: ' + emailText;
  }

  if (cache.summary) {
    $('adSummary').innerHTML = [
      ['bookings', 'ad_bookings'],
      ['users', 'ad_users'],
      ['centers', 'ad_centers'],
      ['messages', 'ad_messages']
    ].map(([key, label]) => `
      <span>
        <b>${Number(cache.summary[key])}</b>
        ${esc(t(label))}
      </span>
    `).join('');
  }

  const bookings = getBookings().slice().reverse();

  $('adBookings').innerHTML = bookings.length
    ? `
      <table>
        <tr>
          <th>${t('th_photo')}</th>
          <th>${t('th_name')}</th>
          <th>${t('th_mobile')}</th>
          <th>${t('email_label')}</th>
          <th>${t('th_address')}</th>
          <th>${t('th_land')}</th>
          <th>${t('th_paddy')}</th>
          <th>${t('th_cont')}</th>
          <th>${t('th_date')}</th>
          <th>${t('th_center')}</th>
          <th>${t('th_status')}</th>
          <th>${t('th_action')}</th>
        </tr>
        ${bookings.map(booking => {
          const center = centerById(booking.centerId);

          return `
            <tr>
              <td>
                <img
                  src="${esc(booking.photo)}"
                  onclick="zoom(this.src)"
                >
              </td>
              <td>${esc(booking.name)}</td>
              <td>${esc(booking.mobile || '—')}</td>
              <td>${esc(booking.email || '—')}</td>
              <td>${esc(booking.address)}</td>
              <td>${esc(unitLabel(booking))}</td>
              <td>${booking.kg} kg</td>
              <td>
                ${booking.containers} ×
                ${t(
                  (booking.containerKg || CONFIG.CONTAINER_KG) === 5000
                    ? 'container_100'
                    : 'container_50'
                )}
              </td>
              <td>${esc(booking.date)}</td>
              <td>${center ? esc(centerName(center)) : '—'}</td>
              <td>
                <select onchange="setStatus(${booking.id}, this.value)">
                  ${['Pending', 'Confirmed', 'Rejected'].map(status => `
                    <option
                      value="${status}"
                      ${booking.status === status ? 'selected' : ''}
                    >${esc(t(status))}</option>
                  `).join('')}
                </select>
              </td>
              <td>
                <button
                  class="btn small"
                  onclick="editBooking(${booking.id})"
                >${lang === 'ta' ? 'திருத்து' : 'Edit'}</button>

                <button
                  class="btn small danger"
                  onclick="deleteBooking(${booking.id})"
                >${t('del')}</button>
              </td>
            </tr>
          `;
        }).join('')}
      </table>
    `
    : `<p class="sub">${esc(t('no_bookings'))}</p>`;

  $('adCenters').innerHTML = `
    <table>
      <tr>
        <th>${t('th_name')}</th>
        <th>${t('pop_district')}</th>
        <th>${t('pop_person')}</th>
        <th>${t('pop_phone')}</th>
        <th>${t('pop_status')}</th>
        <th>${t('th_action')}</th>
      </tr>
      ${getCenters().map(center => `
        <tr>
          <td>${esc(centerName(center))}</td>
          <td>${esc(center.district)}</td>
          <td>${esc(center.person)}</td>
          <td>${esc(center.phone)}</td>
          <td>
            <span class="tag ${center.franchise ? 'on' : 'off'}">
              ${t(center.franchise ? 'fr_on' : 'fr_off')}
            </span>
          </td>
          <td>
            <button
              class="btn small"
              onclick="toggleFranchise(${center.id})"
            >${t(center.franchise ? 'revoke' : 'grant')}</button>

            <button
              class="btn small danger"
              onclick="deleteCenter(${center.id})"
            >${t('del')}</button>
          </td>
        </tr>
      `).join('')}
    </table>
  `;

  const messages = getMessages().slice().reverse();

  $('adMessages').innerHTML = messages.length
    ? `
      <table>
        <tr>
          <th>${t('th_time')}</th>
          <th>${t('th_name')}</th>
          <th>${t('th_mobile')}</th>
          <th>${t('th_message')}</th>
          <th>${t('support_delivery')}</th>
        </tr>
        ${messages.map(message => `
          <tr>
            <td>${esc(new Date(message.createdAt).toLocaleString())}</td>
            <td>${esc(message.name)}</td>
            <td>${esc(message.mobile)}</td>
            <td>${esc(message.text)}</td>
            <td>${esc(message.emailDelivery || 'not_configured')}</td>
          </tr>
        `).join('')}
      </table>
    `
    : '<p class="sub">—</p>';

  const users = getUsers().slice().reverse();

  $('adUsers').innerHTML = users.length
    ? `
      <table>
        <tr>
          <th>${t('th_name')}</th>
          <th>${t('th_mobile')}</th>
          <th>${t('email_label')}</th>
          <th>${t('th_joined')}</th>
          <th>${t('th_last')}</th>
          <th>${t('th_nbook')}</th>
        </tr>
        ${users.map(user => `
          <tr>
            <td>${esc(user.name)}</td>
            <td>${esc(user.mobile || '—')}</td>
            <td>${esc(user.email || '—')}</td>
            <td>${esc(new Date(user.createdAt).toLocaleString())}</td>
            <td>${esc(new Date(user.lastLogin).toLocaleString())}</td>
            <td>${Number(user.bookings)}</td>
          </tr>
        `).join('')}
      </table>
    `
    : '<p class="sub">—</p>';
}

/* ADMIN BOOKING ACTIONS */

async function refreshBookingAdmin() {
  await Promise.all([
    loadBookings(),
    loadAdminData()
  ]);

  renderAdmin();
  renderMyBookings();
}

$('refreshAdmin').onclick = async () => {
  $('refreshAdmin').disabled = true;

  try {
    await refreshBookingAdmin();
  } catch (error) {
    showError(error);
  } finally {
    $('refreshAdmin').disabled = false;
  }
};

async function setStatus(id, status) {
  if (!isAdmin()) return;

  try {
    await API.patch('/api/bookings/' + id, {status});
    await refreshBookingAdmin();
  } catch (error) {
    showError(error);
    renderAdmin();
  }
}

async function deleteBooking(id) {
  if (!isAdmin()) return;

  const message = lang === 'ta'
    ? 'இந்த முன்பதிவை நிரந்தரமாக நீக்க வேண்டுமா?'
    : `Permanently delete booking #${id}? This also deletes its uploaded photo.`;

  if (!confirm(message)) return;

  try {
    await API.del('/api/bookings/' + id);
    await refreshBookingAdmin();
  } catch (error) {
    showError(error);
  }
}

function editBooking(id) {
  if (!isAdmin()) return;

  const booking = getBookings().find(item => item.id === id);
  if (!booking) return;

  document.getElementById('bookingEditor')?.remove();

  const dialog = document.createElement('dialog');
  dialog.id = 'bookingEditor';
  dialog.className = 'booking-editor';
  dialog.setAttribute('aria-labelledby', 'bookingEditorTitle');

  const field = (name, label, type, value, extra = '') => `
    <label>
      ${esc(label)}
      <input
        name="${name}"
        type="${type}"
        value="${esc(String(value))}"
        ${extra}
        required
      >
    </label>
  `;

  dialog.innerHTML = `
    <form>
      <h2 id="bookingEditorTitle">
        ${lang === 'ta' ? 'முன்பதிவைத் திருத்து' : 'Edit booking'} #${id}
      </h2>

      <p>
        ${esc(booking.name)} · ${esc(booking.email)}
        <br>
        Customer identity and photo stay attached to this booking.
      </p>

      ${field(
        'address',
        'Address',
        'text',
        booking.address,
        'maxlength="300"'
      )}

      <label>
        Land unit
        <select name="unit">
          ${Object.keys(UNITS).map(unit => `
            <option
              value="${unit}"
              ${unit === booking.unit ? 'selected' : ''}
            >${esc(t('u_' + unit))}</option>
          `).join('')}
        </select>
      </label>

      ${field(
        'area',
        'Land area',
        'number',
        booking.area,
        'min="0.000001" max="999999.999999" step="any"'
      )}

      <label>
        Container type
        <select name="containerKg">
          <option
            value="2500"
            ${(booking.containerKg || CONFIG.CONTAINER_KG) === 2500
              ? 'selected'
              : ''}
          >50 sacks — 2500 kg</option>

          <option
            value="5000"
            ${booking.containerKg === 5000 ? 'selected' : ''}
          >100 sacks — 5000 kg</option>
        </select>
      </label>

      ${field(
        'containers',
        'Container quantity',
        'number',
        booking.containers,
        'min="1" max="1000000" step="1"'
      )}

      ${field(
        'date',
        'Booking date',
        'date',
        booking.date
      )}

      <label>
        Status
        <select name="status">
          ${['Pending', 'Confirmed', 'Rejected'].map(status => `
            <option
              value="${status}"
              ${status === booking.status ? 'selected' : ''}
            >${esc(t(status))}</option>
          `).join('')}
        </select>
      </label>

      <p role="alert" class="editor-error"></p>

      <div class="editor-actions">
        <button type="button" class="btn secondary">
          ${lang === 'ta' ? 'ரத்து' : 'Cancel'}
        </button>
        <button type="submit" class="btn">
          ${lang === 'ta' ? 'சேமி' : 'Save changes'}
        </button>
      </div>
    </form>
  `;

  document.body.appendChild(dialog);

  dialog.addEventListener('close', () => {
    dialog.remove();
  });

  dialog.querySelector('[type="button"]').onclick = () => {
    dialog.close();
  };

  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const saveButton = form.querySelector('[type="submit"]');

    saveButton.disabled = true;
    dialog.querySelector('[role="alert"]').textContent = '';

    const data = Object.fromEntries(new FormData(form));

    ['area', 'containers', 'containerKg'].forEach(key => {
      data[key] = Number(data[key]);
    });

    try {
      await API.patch('/api/bookings/' + id, data);
      dialog.close();
      await refreshBookingAdmin();
    } catch (error) {
      if (dialog.isConnected) {
        dialog.querySelector('[role="alert"]').textContent =
          error.message;
      } else {
        showError(error);
      }
    } finally {
      saveButton.disabled = false;
    }
  };

  dialog.showModal();
}

/* TEAM */

const pName = person =>
  lang === 'ta' && person.nameTa
    ? person.nameTa
    : person.name;

function avatarHTML(person) {
  if (person.photo) {
    return `
      <div class="avatar">
        <img
          src="${esc(person.photo)}"
          alt="${esc(person.name)}"
        >
      </div>
    `;
  }

  return `
    <div
      class="avatar"
      style="background:linear-gradient(
        135deg,
        ${person.colors[0]},
        ${person.colors[1]}
      )"
    >${esc(person.initials)}</div>
  `;
}

function renderTeam() {
  document.querySelectorAll('[data-avatar="ceo"]').forEach(element => {
    element.innerHTML = avatarHTML(TEAM.ceo);
  });

  ['homeCeoName', 'aboutCeoName'].forEach(id => {
    const element = $(id);
    if (element) element.textContent = pName(TEAM.ceo);
  });

  $('crewStrip').innerHTML = TEAM.crew.slice(0, 5).map(person => `
    <div class="crew-mini" onclick="go('crew')">
      <div class="av">${avatarHTML(person)}</div>
      <b>${esc(pName(person))}</b>
      <small>${esc(t('role_' + person.role))}</small>
    </div>
  `).join('');

  $('crewGrid').innerHTML = TEAM.crew.map(person => `
    <div class="card member reveal in">
      <div class="av">${avatarHTML(person)}</div>
      <h3>${esc(pName(person))}</h3>
      <div class="role">${esc(t('role_' + person.role))}</div>
      <p>${esc(t('role_' + person.role + '_d'))}</p>
    </div>
  `).join('');

  observeReveal();
}

/* INITIALIZE */

let _sid = 0;

(async function init() {
  renderScenes();
  applyLang();
  observeReveal();

  try {
    const me = await API.get('/api/me');

    if (me.role) {
      session = me;

      if (me.role === 'user' && me.lang) {
        lang = me.lang;
      }
    }

    await Promise.all([
      loadAll(),
      loadSupportContact()
    ]);

    const notice = $('connectionNotice');
    if (notice) notice.hidden = true;
  } catch (error) {
    showError(error);
  }

  afterLogin();
})();
