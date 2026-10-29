const SCENES = {
  hero:   {sky:['#4aa8f0','#d6f1ff'], sun:[640,120,46,'#fff4b8'], hill:['#2f8f5b','#52b06a'], field:['#7fd04a','#238a3a'], row:'#166b2a', band:'#0f4d1e', clouds:true, palms:[90,330,640,300], boxes:false},
  green:  {sky:['#72c3f4','#eaf8ff'], sun:[600,100,40,'#fff6c9'], hill:['#3f9b5f','#69c07a'], field:['#86d654','#2f9a3f'], row:'#1b7430', band:'#145524', clouds:true, palms:[120,320], boxes:false},
  gold:   {sky:['#ff9a3c','#ffe7a0'], sun:[520,150,56,'#fff1b0'], hill:['#c98a2e','#e5ad4d'], field:['#f7c948','#cf8c12'], row:'#99640a', band:'#7a4d05', clouds:false, palms:[660,320], boxes:false},
  sunset: {sky:['#5a3fa4','#ff8a5c'], sun:[400,262,70,'#ffd98a'], hill:['#2c2a66','#493a86'], field:['#a6d34e','#3a7d2b'], row:'#2a6a22', band:'#1d4f18', clouds:true, palms:[110,330,690,330], boxes:false},
  store:  {sky:['#8dd3ff','#f4fbff'], sun:[680,90,36,'#fff7cf'], hill:['#4aa56a','#79c887'], field:['#8fd95a','#2f9a3f'], row:'#1b7430', band:'#145524', clouds:true, palms:[70,320], boxes:true}
};
function palm(x, y){
  let f = '';
  [-70,-40,-10,20,50,80].forEach(a => { const r = a * Math.PI / 180, ex = x + Math.sin(r) * 62, ey = y - 78 - Math.cos(r) * 22 + Math.abs(a) * .35;
    f += `<path d="M${x} ${y-78} Q ${x + Math.sin(r)*30} ${y-112} ${ex} ${ey}" stroke="#1d6b34" stroke-width="7" fill="none" stroke-linecap="round"/>`; });
  return `<path d="M${x} ${y} Q ${x+8} ${y-40} ${x+2} ${y-78}" stroke="#6b4a2b" stroke-width="9" fill="none" stroke-linecap="round"/>${f}`;
}
function sceneSVG(o){
  const id = 'sc' + (++_sid), W = 800, H = 500, vx = 400, hy = 292;
  let rows = '', bands = '', clouds = '', palms = '', boxes = '';
  for(let i = -14; i <= 14; i++) rows += `<line x1="${vx}" y1="${hy}" x2="${vx + i*115}" y2="${H}" stroke="${o.row}" stroke-width="${2.5 + Math.abs(i)*.18}" opacity=".5"/>`;
  for(let k = 1; k <= 8; k++){ const y = hy + Math.pow(k/8, 1.8) * (H - hy); bands += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="${o.band}" stroke-width="${1 + k*.8}" opacity=".22"/>`; }
  if(o.clouds) clouds = [[130,90,60],[330,60,45],[560,140,55]].map(c => `<g fill="#fff" opacity=".85"><ellipse cx="${c[0]}" cy="${c[1]}" rx="${c[2]}" ry="${c[2]*.32}"/><ellipse cx="${c[0]+c[2]*.5}" cy="${c[1]-8}" rx="${c[2]*.6}" ry="${c[2]*.3}"/></g>`).join('');
  for(let i = 0; i < o.palms.length; i += 2) palms += palm(o.palms[i], o.palms[i+1]);
  if(o.boxes) [[170,335,1],[330,352,1.15],[520,340,1.05]].forEach(b => {
    const w = 110*b[2], h = 62*b[2], x = b[0], y = b[1];
    boxes += `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#e9eef2" stroke="#9aa7b0" stroke-width="2"/>` +
      Array.from({length:7}, (_, j) => `<line x1="${x + 10 + j*(w-20)/6}" y1="${y+6}" x2="${x + 10 + j*(w-20)/6}" y2="${y+h-6}" stroke="#b5c0c8" stroke-width="3"/>`).join('') +
      `<rect x="${x}" y="${y}" width="${w}" height="9" fill="#2e7d4f"/><rect x="${x}" y="${y+h}" width="${w}" height="6" fill="rgba(0,0,0,.25)"/></g>`; });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.sky[0]}"/><stop offset="1" stop-color="${o.sky[1]}"/></linearGradient>
      <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.field[0]}"/><stop offset="1" stop-color="${o.field[1]}"/></linearGradient>
      <radialGradient id="${id}g"><stop offset="0" stop-color="${o.sun[3]}" stop-opacity=".95"/><stop offset="1" stop-color="${o.sun[3]}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#${id}s)"/>
    <circle cx="${o.sun[0]}" cy="${o.sun[1]}" r="${o.sun[2]*3}" fill="url(#${id}g)"/>
    <circle cx="${o.sun[0]}" cy="${o.sun[1]}" r="${o.sun[2]}" fill="${o.sun[3]}"/>
    ${clouds}
    <path d="M0 ${hy} C 100 ${hy-80}, 220 ${hy-40}, 330 ${hy-70} S 560 ${hy-100}, 800 ${hy-45} L800 ${hy} Z" fill="${o.hill[0]}"/>
    <path d="M0 ${hy} C 150 ${hy-40}, 300 ${hy-20}, 450 ${hy-42} S 700 ${hy-30}, 800 ${hy-12} L800 ${hy} Z" fill="${o.hill[1]}"/>
    <rect y="${hy}" width="${W}" height="${H-hy}" fill="url(#${id}f)"/>
    ${rows}${bands}${palms}${boxes}
  </svg>`;
}
function renderScenes(){
  document.querySelectorAll('.scene[data-scene]').forEach(el => { el.innerHTML = sceneSVG(SCENES[el.dataset.scene]); });
}

/* scroll-reveal animation */
let _io;
function observeReveal(){
  if(!('IntersectionObserver' in window)){ document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')); return; }
  _io = _io || new IntersectionObserver(es => es.forEach(e => { if(e.isIntersecting){ e.target.classList.add('in'); _io.unobserve(e.target); } }), {threshold:.12});
  document.querySelectorAll('.reveal:not(.in)').forEach(e => _io.observe(e));
}

/* =====================================================================
   START — ask the server who is logged in, then load data
   ===================================================================== */
