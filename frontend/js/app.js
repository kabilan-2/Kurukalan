
/* =====================================================================
   CONFIG  — developer: change these values later
   ===================================================================== */
const CONFIG = {
  YIELD_KG_PER_HECTARE: 6000, // 1 acre ≈ 2428 kg (the server re-calculates this itself)
  CONTAINER_KG: 2500,         // capacity of one container
  MAP_CENTER: [10.9, 78.4],   // Tamil Nadu
  MAP_ZOOM: 7
};

/* Land units → square feet per 1 unit (Tamil Nadu: 1 kuli = 144 sq ft, 1 maa = 100 kuli, 1 veli = 20 maa) */
const UNITS = {
  hectare: {sqft: 107639.1},
  acre:    {sqft: 43560},
  veli:    {sqft: 288000},
  maa:     {sqft: 14400},
  kuli:    {sqft: 144},
  cent:    {sqft: 435.6},
  sqm:     {sqft: 10.7639},
  sqft:    {sqft: 1}
};
const SQFT_TO_HA = 9.290304e-6;

/* =====================================================================
   TRANSLATIONS  (English / Tamil)
   ===================================================================== */
const cache = {centers:[], bookings:[], messages:[], users:[], summary:null, system:null};   // in-memory copy of what the server returned
async function loadCenters(){ cache.centers = await API.get('/api/centers'); }
async function loadBookings(){ cache.bookings = session ? await API.get('/api/bookings') : []; }
async function loadAdminData(){
  if(session && session.role === 'admin'){ [cache.messages, cache.users, cache.summary, cache.system] = await Promise.all([API.get('/api/messages'), API.get('/api/users'), API.get('/api/admin/summary'), API.get('/api/admin/system')]); }
  else { cache.messages = []; cache.users = []; }
}
async function loadAll(){ await loadCenters(); await loadBookings(); await loadAdminData(); }
function showError(e){
  let bar = document.getElementById('srvErr');
  if(!bar){ bar = document.createElement('div'); bar.id = 'srvErr'; bar.className = 'notice'; bar.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:5000;max-width:92vw;box-shadow:0 8px 30px rgba(0,0,0,.2)'; document.body.appendChild(bar); }
  bar.textContent = (location.protocol === 'file:') ? 'Open this site through the server (http://localhost:3000), not as a file.' : e.message;
  const notice = $('connectionNotice'); if(notice){notice.hidden=false;notice.textContent='Backend connection unavailable. Start Kurukalan with npm start and open the localhost address printed in the terminal. Live Server and opening index.html only preview the interface.';}
  bar.style.display = 'block'; clearTimeout(bar._t); bar._t = setTimeout(() => bar.style.display = 'none', 6000);
}

/* =====================================================================
   STATE
   ===================================================================== */
let lang = 'en';
let session = null;   // {role:'user'|'admin', name, mobile} — comes from the server (/api/me)
let currentPage = 'home';
let map, markerLayer, tempMarker, pendingLatLng = null, photoData = '';

const $ = id => document.getElementById(id);
const t = k => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const getCenters  = () => cache.centers;
const getBookings = () => cache.bookings;
const getMessages = () => cache.messages;
const getUsers = () => cache.users;
const isAdmin = () => session && session.role === 'admin';
const isUser  = () => session && session.role === 'user';
const centerName = c => (lang === 'ta' && c.nameTa) ? c.nameTa : c.name;

/* =====================================================================
   TRANSLATION
   ===================================================================== */
function applyLang(){
  document.documentElement.lang = lang;
  document.body.classList.toggle('ta', lang === 'ta');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $('langBtn').textContent = lang === 'en' ? 'தமிழ்' : 'English';
  fillUnits(); updateEstimate(); renderUnitTable();
  renderUserBtn(); renderMyBookings(); renderCenters(); renderAdmin(); renderTeam();
}
function toggleLang(){ lang = lang === 'en' ? 'ta' : 'en'; applyLang(); if(isUser()) API.patch('/api/me', {lang}).catch(() => {}); }

/* =====================================================================
   NAVIGATION
   ===================================================================== */
function go(page){
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('show'));
  $('page-' + page).classList.add('show');
  document.querySelectorAll('#menu button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('menu').classList.remove('open');
  window.scrollTo({top:0});
  if(page === 'centers') setTimeout(() => { initMap(); map && map.invalidateSize(); }, 50);
  if(page === 'admin') renderAdmin();
  if(page === 'booking') renderMyBookings();
  observeReveal();
}
document.querySelectorAll('#menu button').forEach(b => b.onclick = () => go(b.dataset.page));

/* =====================================================================
   LOGIN
   ===================================================================== */
function onUserBtn(){
  if(session){
    if(!confirm(t('logout') + '?')) return;
    API.post('/api/logout').catch(() => {}).then(() => { session = null; cache.bookings = []; cache.messages = []; cache.users = []; applyLang(); go('home'); });
  } else openLogin();
}
function openLogin(){ $('lMsg').className = 'msg'; $('loginModal').classList.add('show'); }
function closeLogin(){ $('loginModal').classList.remove('show'); }
let userAuthMode = 'user';
function loginTab(which){
  userAuthMode = which;
  $('signupFields').hidden = which !== 'signup';
  for (const id of ['lName','lMobile']) { $(id).required = which === 'signup'; $(id).disabled = which !== 'signup'; }
  $('tabSignup').classList.toggle('on', which === 'signup');
  $('lOtp').value = '';
  $('verifyOtp').dataset.i18n = which === 'signup' ? 'verify_signup' : 'verify_otp';
  $('verifyOtp').textContent = t($('verifyOtp').dataset.i18n);
  $('tabUser').classList.toggle('on', which === 'user');
  $('tabAdmin').classList.toggle('on', which === 'admin');
  $('userLogin').style.display  = which !== 'admin' ? '' : 'none';
  $('adminLogin').style.display = which === 'admin' ? '' : 'none';
  $('lMsg').className = 'msg';
}
function showMsg(el, kind, text){ el.className = 'msg ' + kind; el.textContent = text; }

$('sendOtp').onclick = async () => {
  const button = $('sendOtp'); button.disabled = true;
  try {
    for (const id of (userAuthMode === 'signup' ? ['lName','lMobile','lEmail'] : ['lEmail'])) if (!$(id).reportValidity()) return;
    await API.post('/api/auth/otp/send', {email:$('lEmail').value.trim()});
    showMsg($('lMsg'), 'ok', lang === 'ta' ? 'OTP மின்னஞ்சலில் அனுப்பப்பட்டது. குறியீட்டை உள்ளிடவும்.' : 'Code sent. Check your email inbox or spam folder.');
    $('lOtp').focus();
  } catch(err) { showMsg($('lMsg'), 'err', err.message); }
  finally { button.disabled = false; }
};
$('userLogin').onsubmit = async e => {
  e.preventDefault(); $('verifyOtp').disabled = true;
  try {
    const credentials = {email:$('lEmail').value.trim(), code:$('lOtp').value.trim()};
    if (userAuthMode === 'signup') { credentials.name = $('lName').value.trim(); credentials.mobile = $('lMobile').value.trim(); }
    const me = await API.post(userAuthMode === 'signup' ? '/api/signup/user' : '/api/login/user', credentials);
    session = me; if(me.lang) lang = me.lang;
    $('lOtp').value = ''; await loadBookings(); closeLogin(); afterLogin();
  } catch(err) { showMsg($('lMsg'), 'err', err.message); }
  finally { $('verifyOtp').disabled = false; }
};
$('adminLogin').onsubmit = async e => {
  e.preventDefault();
  try{
    session = await API.post('/api/login/admin', {id: $('aId').value.trim(), password: $('aPass').value});
    $('aPass').value = '';
    await Promise.all([loadBookings(), loadAdminData()]); closeLogin(); afterLogin(); go('admin');
  }catch(err){ showMsg($('lMsg'), 'err', err.status === 401 ? t('err_admin') : err.message); }
};
function afterLogin(){
  if(isUser()){ $('sName').value = session.name; $('sMobile').value = session.mobile || ''; }
  applyLang();
}
function renderUserBtn(){
  $('uname').textContent = session ? session.name : t('login');
  $('userBtn').title = session ? t('logout') : t('login');
  $('loginNotice').style.display = isUser() ? 'none' : '';
  $('adminCenterPanel').style.display = isAdmin() ? '' : 'none';
  // Admin menu item
  let adm = document.querySelector('#menu [data-page="admin"]');
  if(isAdmin() && !adm){
    adm = document.createElement('button'); adm.dataset.page = 'admin'; adm.dataset.i18n = 'ad_title'; adm.onclick = () => go('admin');
    $('menu').appendChild(adm);
  }
  if(!isAdmin() && adm) adm.remove();
  if(adm) adm.textContent = t('ad_title');
}

/* =====================================================================
   BOOKING — units, auto calculation, photo, submit
   ===================================================================== */
function fillUnits(){
  const sel = $('bUnit'), cur = sel.value || 'acre';
  sel.innerHTML = Object.keys(UNITS).map(u => `<option value="${u}">${esc(t('u_' + u))}</option>`).join('');
  sel.value = cur;
}
function calc(area, unit, capacity = CONFIG.CONTAINER_KG){
  const ha = area * UNITS[unit].sqft * SQFT_TO_HA;
  const kg = Math.round(ha * CONFIG.YIELD_KG_PER_HECTARE);
  const containers = area > 0 ? Math.max(1, Math.ceil(kg / capacity)) : 0;
  return {kg, containers};
}
let manualContainerCount = false, manualContainerType = false;
function updateEstimate(resetSelection = false){
  if(resetSelection) { manualContainerCount = false; manualContainerType = false; }
  const area = parseFloat($('bArea').value) || 0, unit = $('bUnit').value || 'acre';
  const harvest = calc(area, unit);
  const automaticCapacity = harvest.kg <= 2500 ? 2500 : 5000;
  const automatic = calc(area, unit, automaticCapacity);
  if (!manualContainerType) $('bCapacity').value = String(automaticCapacity);
  const capacity = Number($('bCapacity').value);
  const selectedEstimate = calc(area, unit, capacity);
  const chosenCount = manualContainerCount ? Number($('bContainer').value) : selectedEstimate.containers;
  // Common quantities plus the exact calculated value keep the dropdown bounded.
  const options = new Set(Array.from({length:100}, (_,i) => i+1));
  if(chosenCount > 0 && chosenCount <= 1e6) options.add(chosenCount);
  if(selectedEstimate.containers > 0 && selectedEstimate.containers <= 1e6) options.add(selectedEstimate.containers);
  $('bContainer').innerHTML = Array.from(options).sort((a,b)=>a-b).map(n => `<option value="${n}">${n}</option>`).join('');
  $('bContainer').value = String(chosenCount || 1);
  $('estimate').innerHTML =
    `<div>${esc(t('est_paddy'))}: ${harvest.kg.toLocaleString('en-IN')} kg</div>` +
    `<div>${esc(t('auto_recommendation'))}: ${automatic.containers} × ${esc(t(automaticCapacity === 5000 ? 'container_100' : 'container_50'))}</div>` +
    `<small>${esc(t('capacity_note').replace('{kg}', capacity.toLocaleString('en-IN')))}</small>`;
}
$('bUnit').onchange = () => updateEstimate(true);
$('bArea').oninput = () => updateEstimate(true);
$('bContainer').onchange = () => { manualContainerCount = true; };
$('bCapacity').onchange = () => { manualContainerType = true; manualContainerCount = false; updateEstimate(); };
$('resetContainers').onclick = () => updateEstimate(true);

// Photo: read, shrink to ~800px and keep as data URL
$('bPhoto').onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      photoData = c.toDataURL('image/jpeg', .7);
      $('photoPrev').src = photoData; $('photoPrev').style.display = 'block';
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
};
$('bDate').min = new Date().toISOString().slice(0,10);

$('bookingForm').onsubmit = async e => {
  e.preventDefault();
  const msg = $('bMsg');
  if(!isUser()){ openLogin(); return showMsg(msg, 'err', t('err_login')); }
  const area = parseFloat($('bArea').value) || 0;
  if(area <= 0) return showMsg(msg, 'err', t('err_area'));
  if(!photoData) return showMsg(msg, 'err', t('err_photo'));
  try{
    await API.post('/api/bookings', {
      address: $('bAddress').value.trim(),
      photo: photoData, unit: $('bUnit').value, area, date: $('bDate').value, containers:Number($('bContainer').value), containerKg:Number($('bCapacity').value)
    });
    showMsg(msg, 'ok', t('ok_booked'));
    $('bAddress').value = ''; $('bPhoto').value = ''; photoData = ''; $('photoPrev').style.display = 'none'; $('bDate').value = '';
    await loadBookings(); renderMyBookings();
  }catch(err){ showMsg(msg, 'err', err.message); }
};
function unitLabel(b){ return `${b.area} ${t('u_' + b.unit)}`; }
function centerById(id){ return getCenters().find(c => c.id === id); }
function renderMyBookings(){
  const box = $('myBookings');
  if(!isUser()){ box.innerHTML = `<p class="sub">${esc(t('bk_login_notice'))}</p>`; return; }
  const mine = getBookings().slice().reverse();
  if(!mine.length){ box.innerHTML = `<p class="sub">${esc(t('no_bookings'))}</p>`; return; }
  box.innerHTML = `<div class="tbl-wrap"><table><tr><th>${t('th_photo')}</th><th>${t('th_date')}</th><th>${t('th_land')}</th><th>${t('th_paddy')}</th><th>${t('th_cont')}</th><th>${t('th_status')}</th></tr>` +
    mine.map(b => `<tr><td><img src="${b.photo}" onclick="zoom(this.src)"></td><td>${esc(b.date)}</td><td>${esc(unitLabel(b))}</td><td>${b.kg} kg</td><td>${b.containers} × ${t((b.containerKg || CONFIG.CONTAINER_KG) === 5000 ? 'container_100' : 'container_50')}</td><td><span class="tag ${b.status}">${t(b.status)}</span></td></tr>`).join('') +
    '</table></div>';
}
function zoom(src){ $('lightImg').src = src; $('lightbox').classList.add('show'); }

/* =====================================================================
   INFORMATION — unit table
   ===================================================================== */
function renderUnitTable(){
  $('unitTable').innerHTML = `<tr><th>${t('th_unit')}</th><th>${t('th_acres')}</th><th>${t('th_ha')}</th></tr>` +
    Object.keys(UNITS).map(u => {
      const ha = UNITS[u].sqft * SQFT_TO_HA;
      return `<tr><td>${esc(t('u_' + u))}</td><td>${(ha / 0.404686).toPrecision(4)}</td><td>${ha.toPrecision(4)}</td></tr>`;
    }).join('');
}

/* =====================================================================
   CENTERS MAP
   ===================================================================== */
function initMap(){
  if(map) return;
  if(typeof L === 'undefined'){ $('map').innerHTML = '<p style="padding:20px">Map could not load. Please check your internet connection and refresh.</p>'; return; }
  map = L.map('map').setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
  const tiles = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom:18, referrerPolicy:'strict-origin-when-cross-origin',
    attribution:'Imagery &copy; Esri, Vantor, Earthstar Geographics, and the GIS User Community'
  }).addTo(map);
  // Transparent reference layers keep the satellite landscape visible.
  const referenceOptions = {maxZoom:18, referrerPolicy:'strict-origin-when-cross-origin'};
  const roads = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {...referenceOptions, zIndex:2, attribution:'Roads &copy; Esri and contributors'}).addTo(map);
  const places = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {...referenceOptions, zIndex:3, attribution:'Place names &copy; Esri and contributors'}).addTo(map);
  L.control.layers({}, {'Road routes':roads, 'Location names':places}, {collapsed:false, position:'topright'}).addTo(map);
  let tileWarning;
  tiles.on('tileerror', () => {
    if (tileWarning) return;
    tileWarning = document.createElement('p'); tileWarning.className = 'notice';
    tileWarning.textContent = 'The background map is temporarily unavailable. Center images and the center list are still available.';
    $('map').before(tileWarning);
  });
  tiles.on('load', () => {
    const loaded = Object.values(tiles._tiles || {}).some(tile => tile.el.complete && tile.el.naturalWidth > 0);
    if (loaded && tileWarning) { tileWarning.remove(); tileWarning = null; }
  });
  markerLayer = L.layerGroup().addTo(map);
  map.on('click', e => {
    if(!isAdmin()) return;
    pendingLatLng = e.latlng;
    $('cLatLng').value = e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);
    if(tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker(e.latlng).addTo(map);
  });
  renderCenters();
}
function pinIcon(on){
  return L.divIcon({className:'center-marker ' + (on ? 'active' : 'inactive'), html:'<img src="assets/center-container.png" alt="' + (on ? 'Active storage center' : 'Inactive storage center') + '">', iconSize:[64,64], iconAnchor:[32,52], popupAnchor:[0,-48]});
}
function popupHtml(c){
  let h = `<div class="pop"><h4>${esc(centerName(c))}</h4>
    <p> ${esc(t('pop_district'))}: ${esc(c.district)}</p>
    <p> ${esc(t('pop_person'))}: <b>${esc(c.person)}</b></p>
    <p> ${esc(t('pop_phone'))}: <b><a href="tel:${esc(c.phone.replace(/\s/g,''))}">${esc(c.phone)}</a></b></p>
    <p> ${esc(t('pop_status'))}: <span class="tag ${c.franchise ? 'on' : 'off'}">${t(c.franchise ? 'fr_on' : 'fr_off')}</span></p>`;
  if(isAdmin()) h += `<p><button class="btn small" onclick="toggleFranchise(${c.id})">${t(c.franchise ? 'revoke' : 'grant')}</button>
    <button class="btn small danger" onclick="deleteCenter(${c.id})">${t('del')}</button></p>`;
  return h + '</div>';
}
function renderCenters(){
  const list = getCenters();
  $('centerList').innerHTML = list.map(c => `<div class="center-item" onclick="focusCenter(${c.id})">
      <h4>${c.franchise ? '' : ''} ${esc(centerName(c))}</h4>
      <p>${esc(c.district)} · ${esc(c.person)} · ${esc(c.phone)}</p></div>`).join('');
  if(!markerLayer) return;
  markerLayer.clearLayers();
  list.forEach(c => L.marker([c.lat, c.lng], {icon: pinIcon(c.franchise)}).bindPopup(popupHtml(c)).addTo(markerLayer).cid = c.id);
}
function focusCenter(id){
  const c = centerById(id); if(!c || !map) return;
  map.setView([c.lat, c.lng], 10);
  markerLayer.eachLayer(m => { if(m.cid === id) m.openPopup(); });
  $('map').scrollIntoView({behavior:'smooth', block:'center'});
}
async function toggleFranchise(id){
  if(!isAdmin()) return;
  const c = getCenters().find(x => x.id === id); if(!c) return;
  try{ await API.patch('/api/centers/' + id, {franchise: !c.franchise}); await loadCenters(); map && map.closePopup(); refreshCenters(); }
  catch(err){ showError(err); }
}
async function deleteCenter(id){
  if(!isAdmin() || !confirm(t('delete_confirm'))) return;
  try{ await API.del('/api/centers/' + id); await Promise.all([loadCenters(), loadBookings()]); map && map.closePopup(); refreshCenters(); }
  catch(err){ showError(err); }
}
function refreshCenters(){ renderCenters(); renderAdmin(); }

$('centerForm').onsubmit = async e => {
  e.preventDefault();
  if(!isAdmin()) return;
  if(!pendingLatLng) return showMsg($('cMsg'), 'err', t('err_map'));
  try{
    await API.post('/api/centers', {name: $('cName').value.trim(), nameTa: $('cNameTa').value.trim(), district: $('cDistrict').value.trim(),
      person: $('cPerson').value.trim(), phone: $('cPhone').value.trim(), lat: pendingLatLng.lat, lng: pendingLatLng.lng, franchise: $('cFranchise').checked});
    e.target.reset(); $('cFranchise').checked = true; $('cLatLng').value = '';
    if(tempMarker){ map.removeLayer(tempMarker); tempMarker = null; } pendingLatLng = null;
    await loadCenters(); showMsg($('cMsg'), 'ok', t('ok_center')); refreshCenters();
  }catch(err){ showMsg($('cMsg'), 'err', err.message); }
};

/* =====================================================================
   SUPPORT FORM
   ===================================================================== */
async function loadSupportContact(){
  const contact = await API.get('/api/support/contact');
  const email = typeof contact.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) ? contact.email : '';
  const mobile = typeof contact.mobile === 'string' ? contact.mobile.replace(/[^+0-9]/g,'') : '';
  if(email){ $('supportEmail').textContent = email; $('supportEmail').href = 'mailto:' + encodeURIComponent(email); $('supportEmail').hidden = false; $('supportEmailPending').hidden = true; }
  if(/^\+?\d{10,15}$/.test(mobile)){
    $('supportPhone').textContent = contact.mobile; $('supportPhone').href = 'tel:' + mobile;
    $('supportPhone').hidden = false; $('supportPhonePending').hidden = true;
    $('supportWhatsApp').href = 'https://wa.me/' + mobile.replace(/\D/g,''); $('supportWhatsApp').hidden = false;
  }
}
$('supportForm').onsubmit = async e => {
  e.preventDefault();
  try{
    const result = await API.post('/api/messages', {name: $('sName').value.trim(), mobile: $('sMobile').value.trim(), text: $('sText').value.trim()});
    $('sText').value = ''; showMsg($('sMsg'), 'ok', t(result.emailDelivery === 'sent' ? 'support_sent_email' : 'support_saved'));
  }catch(err){ showMsg($('sMsg'), 'err', err.message); }
};

/* =====================================================================
   ADMIN DASHBOARD
   ===================================================================== */
function renderAdmin(){
  if(!isAdmin()) return;
  if(cache.system) $('adminSystemStatus').textContent = (cache.system.database.type === 'postgres' ? 'Cloud PostgreSQL: connected.' : 'Local SQLite: connected (not cloud storage).') + ' Email sending: ' + (cache.system.email.configured ? 'configured; real delivery must be verified.' : 'not configured.');
  if(cache.summary) $('adSummary').innerHTML = [['bookings','ad_bookings'],['users','ad_users'],['centers','ad_centers'],['messages','ad_messages']].map(([key,label]) => `<span><b>${Number(cache.summary[key])}</b>${esc(t(label))}</span>`).join('');
  const bookings = getBookings().slice().reverse();
  $('adBookings').innerHTML = bookings.length ?
    `<table><tr><th>${t('th_photo')}</th><th>${t('th_name')}</th><th>${t('th_mobile')}</th><th>${t('email_label')}</th><th>${t('th_address')}</th><th>${t('th_land')}</th><th>${t('th_paddy')}</th><th>${t('th_cont')}</th><th>${t('th_date')}</th><th>${t('th_center')}</th><th>${t('th_status')}</th></tr>` +
    bookings.map(b => { const c = centerById(b.centerId);
      return `<tr><td><img src="${b.photo}" onclick="zoom(this.src)"></td><td>${esc(b.name)}</td><td>${esc(b.mobile || '—')}</td><td>${esc(b.email || '—')}</td><td>${esc(b.address)}</td><td>${esc(unitLabel(b))}</td><td>${b.kg} kg</td><td>${b.containers} × ${t((b.containerKg || CONFIG.CONTAINER_KG) === 5000 ? 'container_100' : 'container_50')}</td><td>${esc(b.date)}</td><td>${c ? esc(centerName(c)) : '—'}</td>
      <td><select onchange="setStatus(${b.id}, this.value)">${['Pending','Confirmed','Rejected'].map(s => `<option value="${s}" ${b.status === s ? 'selected' : ''}>${t(s)}</option>`).join('')}</select></td></tr>`; }).join('') + '</table>'
    : `<p class="sub">${t('no_bookings')}</p>`;

  $('adCenters').innerHTML = `<table><tr><th>${t('th_name')}</th><th>${t('pop_district')}</th><th>${t('pop_person')}</th><th>${t('pop_phone')}</th><th>${t('pop_status')}</th><th>${t('th_action')}</th></tr>` +
    getCenters().map(c => `<tr><td>${esc(centerName(c))}</td><td>${esc(c.district)}</td><td>${esc(c.person)}</td><td>${esc(c.phone)}</td>
      <td><span class="tag ${c.franchise ? 'on' : 'off'}">${t(c.franchise ? 'fr_on' : 'fr_off')}</span></td>
      <td><button class="btn small" onclick="toggleFranchise(${c.id})">${t(c.franchise ? 'revoke' : 'grant')}</button> <button class="btn small danger" onclick="deleteCenter(${c.id})">${t('del')}</button></td></tr>`).join('') + '</table>';

  const msgs = getMessages().slice().reverse();
  $('adMessages').innerHTML = msgs.length ? `<table><tr><th>${t('th_time')}</th><th>${t('th_name')}</th><th>${t('th_mobile')}</th><th>${t('th_message')}</th><th>${t('support_delivery')}</th></tr>` +
    msgs.map(m => `<tr><td>${esc(new Date(m.createdAt).toLocaleString())}</td><td>${esc(m.name)}</td><td>${esc(m.mobile)}</td><td>${esc(m.text)}</td><td>${esc(m.emailDelivery || 'not_configured')}</td></tr>`).join('') + '</table>' : '<p class="sub">—</p>';

  const users = getUsers().slice().reverse();
  $('adUsers').innerHTML = users.length ? `<table><tr><th>${t('th_name')}</th><th>${t('th_mobile')}</th><th>${t('email_label')}</th><th>${t('th_joined')}</th><th>${t('th_last')}</th><th>${t('th_nbook')}</th></tr>` +
    users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.mobile || '—')}</td><td>${esc(u.email || '—')}</td><td>${esc(new Date(u.createdAt).toLocaleString())}</td><td>${esc(new Date(u.lastLogin).toLocaleString())}</td><td>${u.bookings}</td></tr>`).join('') + '</table>' : '<p class="sub">—</p>';
}
$('refreshAdmin').onclick = async () => {
  $('refreshAdmin').disabled = true;
  try { await Promise.all([loadBookings(),loadAdminData()]); renderAdmin(); }
  catch(error) { showError(error); }
  finally { $('refreshAdmin').disabled = false; }
};
async function setStatus(id, status){
  try{ await API.patch('/api/bookings/' + id, {status}); await loadBookings(); }catch(err){ showError(err); renderAdmin(); }
}

/* =====================================================================
   TEAM  — developer: edit names / roles / photos here.
   Put a photo URL or file path in `photo` (e.g. 'images/ceo.jpg') to replace the initials avatar.
   ===================================================================== */
const pName = p => (lang === 'ta' && p.nameTa) ? p.nameTa : p.name;

function avatarHTML(p){
  if(p.photo) return `<div class="avatar"><img src="${esc(p.photo)}" alt="${esc(p.name)}"></div>`;
  return `<div class="avatar" style="background:linear-gradient(135deg,${p.colors[0]},${p.colors[1]})">${esc(p.initials)}</div>`;
}
function renderTeam(){
  document.querySelectorAll('[data-avatar="ceo"]').forEach(el => el.innerHTML = avatarHTML(TEAM.ceo));
  ['homeCeoName','aboutCeoName'].forEach(id => { const el = $(id); if(el) el.textContent = pName(TEAM.ceo); });
  $('crewStrip').innerHTML = TEAM.crew.slice(0,5).map(p =>
    `<div class="crew-mini" onclick="go('crew')"><div class="av">${avatarHTML(p)}</div><b>${esc(pName(p))}</b><small>${esc(t('role_' + p.role))}</small></div>`).join('');
  $('crewGrid').innerHTML = TEAM.crew.map(p =>
    `<div class="card member reveal in"><div class="av">${avatarHTML(p)}</div><h3>${esc(pName(p))}</h3><div class="role">${esc(t('role_' + p.role))}</div><p>${esc(t('role_' + p.role + '_d'))}</p></div>`).join('');
  observeReveal();
}

/* =====================================================================
   ILLUSTRATED FIELD SCENES (SVG) — used as colourful images.
   To use real photos instead, replace a `.scene` element's content with an <img>.
   ===================================================================== */
let _sid = 0;
(async function init(){
  renderScenes(); applyLang(); observeReveal();
  try{
    const me = await API.get('/api/me');
    if(me.role){ session = me; if(me.role === 'user' && me.lang) lang = me.lang; }
    await Promise.all([loadAll(), loadSupportContact()]);
  }catch(e){ showError(e); }
  afterLogin();
})();
