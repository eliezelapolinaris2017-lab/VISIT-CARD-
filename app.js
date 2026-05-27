let app, auth, db, storage, currentUser, currentVisitId = null, settings = {};
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const today = () => new Date().toISOString().slice(0,10);

function moneySafeText(v){ return String(v || '').replace(/[<>]/g,''); }
function uidPath(){ return `users/${currentUser.uid}/oasis_visit_card`; }

try {
  app = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
} catch (e) {
  console.error(e);
  alert('Falta configurar firebase-config.js');
}

$('#loginBtn').onclick = login;
$('#heroLoginBtn').onclick = login;
$('#logoutBtn').onclick = () => auth.signOut();
$('#resetBtn').onclick = () => { $('#visitForm').reset(); currentVisitId=null; $('#pdfBtn').disabled=true; calcScore(); };

function login(){ auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }

auth.onAuthStateChanged(async user => {
  currentUser = user;
  const on = !!user;
  $('#lockedView').classList.toggle('hidden', on);
  $('#appView').classList.toggle('hidden', !on);
  $('#loginBtn').classList.toggle('hidden', on);
  $('#logoutBtn').classList.toggle('hidden', !on);
  $('#userLabel').textContent = on ? (user.displayName || user.email) : 'Sin conexión';
  if(on){ await loadSettings(); listenVisits(); }
});

$$('.nav').forEach(btn => btn.onclick = () => {
  $$('.nav').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#' + btn.dataset.view).classList.remove('hidden');
});

['cooling','pressure','drain','evaporator','condenser'].forEach(name => {
  document.addEventListener('input', e => { if(e.target.name === name) calcScore(); });
});
function calcScore(){
  const f = new FormData($('#visitForm'));
  const vals = ['cooling','pressure','drain','evaporator','condenser'].map(k => Number(f.get(k) || 0));
  const score = Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
  $('#scoreValue').textContent = score;
  $('#scoreText').textContent = score >= 85 ? 'Excelente' : score >= 65 ? 'Atención preventiva' : 'Riesgo alto';
  $('#scoreText').style.color = score >= 85 ? 'var(--ok)' : score >= 65 ? 'var(--warn)' : 'var(--danger)';
  return score;
}
calcScore();

$('#settingsForm').onsubmit = async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const file = $('#logoFile').files[0];
  if(file){ data.logoUrl = await uploadFile(file, 'settings/logo'); }
  await db.doc(`${uidPath()}/settings/main`).set(data, {merge:true});
  settings = {...settings, ...data};
  alert('Configuración guardada');
};

async function loadSettings(){
  const snap = await db.doc(`${uidPath()}/settings/main`).get();
  settings = snap.exists ? snap.data() : { businessName:'Oasis Air Cleaner Services LLC', businessPhone:'787-664-3079' };
  const form = $('#settingsForm');
  Object.entries(settings).forEach(([k,v]) => { if(form.elements[k]) form.elements[k].value = v || ''; });
}

async function uploadFile(file, folder){
  const ref = storage.ref(`${uidPath()}/${folder}/${Date.now()}-${file.name}`);
  await ref.put(file);
  return await ref.getDownloadURL();
}

async function uploadMany(files, folder){
  const out = [];
  for(const file of files) out.push(await uploadFile(file, folder));
  return out;
}

$('#visitForm').onsubmit = async e => {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(e.target).entries());
  const score = calcScore();
  const doc = {
    ...raw,
    score,
    status: score >= 85 ? 'Excelente' : score >= 65 ? 'Atención preventiva' : 'Riesgo alto',
    date: today(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    beforePhotos: await uploadMany($('#beforePhotos').files, 'visits/before'),
    afterPhotos: await uploadMany($('#afterPhotos').files, 'visits/after')
  };
  const ref = await db.collection(`${uidPath()}/visits`).add(doc);
  currentVisitId = ref.id;
  $('#pdfBtn').disabled = false;
  alert('Visit Card guardada');
};

$('#pdfBtn').onclick = async () => {
  if(!currentVisitId) return;
  const snap = await db.doc(`${uidPath()}/visits/${currentVisitId}`).get();
  await generatePdf(snap.id, snap.data());
};

function listenVisits(){
  db.collection(`${uidPath()}/visits`).orderBy('updatedAt','desc').limit(80).onSnapshot(snap => {
    window.__visits = snap.docs.map(d => ({id:d.id, ...d.data()}));
    renderHistory();
  });
}
$('#searchInput').oninput = renderHistory;

function renderHistory(){
  const q = ($('#searchInput').value || '').toLowerCase();
  const list = (window.__visits || []).filter(v => JSON.stringify(v).toLowerCase().includes(q));
  $('#historyList').innerHTML = list.map(v => `
    <article class="visit-item">
      <div>
        <h3>${moneySafeText(v.clientName)}</h3>
        <div class="visit-meta">${moneySafeText(v.date)} · ${moneySafeText(v.brand)} ${moneySafeText(v.btu)} · ${moneySafeText(v.serviceType)}</div>
        <div class="thumbs">${[...(v.beforePhotos||[]), ...(v.afterPhotos||[])].slice(0,5).map(src=>`<img src="${src}" alt="foto">`).join('')}</div>
      </div>
      <div>
        <span class="pill">${v.score || 0} · ${moneySafeText(v.status)}</span><br><br>
        <button class="btn secondary" onclick="downloadVisitPdf('${v.id}')">PDF</button>
      </div>
    </article>`).join('') || '<p class="muted">No hay visitas registradas.</p>';
}

window.downloadVisitPdf = async (id) => {
  const snap = await db.doc(`${uidPath()}/visits/${id}`).get();
  await generatePdf(id, snap.data());
};

async function loadImage(url){
  return new Promise(resolve => {
    if(!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img,0,0);
      resolve(c.toDataURL('image/jpeg', .85));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function generateQrData(id){
  const url = `${location.origin}${location.pathname}?visit=${id}`;
  $('#qrHolder').innerHTML = '';
  new QRCode($('#qrHolder'), {text:url,width:150,height:150});
  await new Promise(r => setTimeout(r,200));
  const img = $('#qrHolder img') || $('#qrHolder canvas');
  return img?.src || img?.toDataURL?.('image/png');
}

async function generatePdf(id, v){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt', format:'letter'});
  const W = doc.internal.pageSize.getWidth();
  const logo = await loadImage(settings.logoUrl);
  const qr = await generateQrData(id);
  const before = await loadImage((v.beforePhotos||[])[0]);
  const after = await loadImage((v.afterPhotos||[])[0]);

  doc.setFillColor(5,7,11); doc.rect(0,0,W,792,'F');
  doc.setFillColor(15,24,39); doc.roundedRect(36,32,W-72,120,20,20,'F');
  if(logo) doc.addImage(logo,'JPEG',52,48,58,58);
  doc.setTextColor(255,255,255); doc.setFontSize(24); doc.text(settings.businessName || 'Oasis Air Cleaner Services LLC', logo?124:52,70);
  doc.setTextColor(180,190,205); doc.setFontSize(10); doc.text(`${settings.businessPhone||''} ${settings.businessEmail? '· '+settings.businessEmail:''}`, logo?124:52,91);
  doc.setTextColor(201,164,93); doc.setFontSize(13); doc.text('OASIS VISIT CARD', 52,128);
  if(qr) doc.addImage(qr,'PNG',W-130,52,70,70);

  doc.setFillColor(255,255,255); doc.roundedRect(36,174,W-72,150,18,18,'F');
  doc.setTextColor(10,14,22); doc.setFontSize(18); doc.text(v.clientName || 'Cliente',52,206);
  doc.setFontSize(10); doc.setTextColor(85,95,110);
  doc.text(`Teléfono: ${v.phone||'-'}`,52,228); doc.text(`Dirección: ${v.address||'-'}`,52,244,{maxWidth:300});
  doc.text(`Servicio: ${v.serviceType||'-'}`,52,270); doc.text(`Técnico: ${v.technician||'-'}`,52,286);
  doc.setFillColor(v.score>=85?45: v.score>=65?255:255, v.score>=85?227:209, v.score>=85?140: v.score>=65?102:103);
  doc.roundedRect(W-170,204,100,72,14,14,'F');
  doc.setTextColor(5,7,11); doc.setFontSize(30); doc.text(String(v.score||0), W-142,246);
  doc.setFontSize(9); doc.text(v.status || 'Estado', W-154,264,{maxWidth:85,align:'center'});

  doc.setFillColor(17,28,45); doc.roundedRect(36,346,W-72,96,18,18,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(14); doc.text('Equipo',52,374);
  doc.setTextColor(185,196,210); doc.setFontSize(10);
  doc.text(`Marca: ${v.brand||'-'}`,52,397); doc.text(`Modelo: ${v.model||'-'}`,190,397); doc.text(`BTU: ${v.btu||'-'}`,330,397); doc.text(`Serial: ${v.serial||'-'}`,52,418);

  doc.setTextColor(255,255,255); doc.setFontSize(14); doc.text('Evidencia',52,474);
  if(before) doc.addImage(before,'JPEG',52,492,220,145); else { doc.setDrawColor(90); doc.roundedRect(52,492,220,145,14,14); }
  if(after) doc.addImage(after,'JPEG',304,492,220,145); else { doc.setDrawColor(90); doc.roundedRect(304,492,220,145,14,14); }
  doc.setTextColor(201,164,93); doc.setFontSize(10); doc.text('ANTES',52,656); doc.text('DESPUÉS',304,656);

  doc.setTextColor(255,255,255); doc.setFontSize(13); doc.text('Observaciones técnicas',52,694);
  doc.setTextColor(190,200,214); doc.setFontSize(10); doc.text(v.notes || '-',52,714,{maxWidth:492});
  doc.setTextColor(201,164,93); doc.text(`Próxima visita: ${v.nextVisit || '-'}   Garantía: ${v.warranty || '-'}`,52,760);
  doc.save(`Oasis-Visit-Card-${(v.clientName||'cliente').replace(/\s+/g,'-')}.pdf`);
}
