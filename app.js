import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyD9LW4cEV6NPC5wi7Zxrj6UKu0FeSUJZCI",
  authDomain: "oasis-visit-card.firebaseapp.com",
  projectId: "oasis-visit-card",
  storageBucket: "oasis-visit-card.firebasestorage.app",
  messagingSenderId: "6930140490",
  appId: "1:6930140490:web:66fb3902d8cfe93e4085b3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app);
const storage = getStorage(app);

let currentUser = null;
let visitsCache = [];
let settings = {
  businessName: "Oasis Air Cleaner Services LLC",
  businessPhone: "787-664-3079",
  businessEmail: "",
  businessAddress: "",
  logoUrl: ""
};

const $ = (id) => document.getElementById(id);
const safe = (v) => String(v ?? "");
const cleanText = (v) => safe(v).replace(/[<>&"']/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#039;'}[s]));
const qrUrl = (text, size = 280) => `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;

$("loginBtn").onclick = async () => {
  try { await signInWithPopup(auth, provider); }
  catch (err) { alert(err.message); console.error(err); }
};

$("logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    $("authScreen").classList.remove("hidden");
    $("app").classList.add("hidden");
    return;
  }
  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
  await loadSettings();
  await loadVisits();
});

document.querySelectorAll(".tab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
  };
});

["cooling","pressure","drain","evaporator","condenser"].forEach(name => {
  $("visitForm").elements[name].addEventListener("input", updateHealthPreview);
});

function calculateHealthFromForm(){
  const fields = ["cooling","pressure","drain","evaporator","condenser"];
  return Math.round(fields.reduce((sum, f) => sum + Number($("visitForm").elements[f].value || 0), 0) / fields.length);
}
function updateHealthPreview(){ $("healthPreview").textContent = calculateHealthFromForm(); }
function statusFromScore(score){
  score = Number(score || 0);
  if (score >= 82) return { label:"Excelente", cls:"ok", color:"#44d17a" };
  if (score >= 62) return { label:"Atención preventiva", cls:"warn", color:"#ffcb47" };
  return { label:"Riesgo alto", cls:"danger", color:"#ff4d67" };
}

async function uploadFiles(files, folder){
  const urls = [];
  for (const file of Array.from(files || [])) {
    const cleanName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `users/${currentUser.uid}/${folder}/${Date.now()}_${cleanName}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    urls.push(await getDownloadURL(fileRef));
  }
  return urls;
}

$("visitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const btn = e.target.querySelector("button[type='submit']");
  btn.disabled = true;
  btn.textContent = "Guardando...";

  try {
    const fd = new FormData(e.target);
    const healthScore = calculateHealthFromForm();

    const beforeUrls = await uploadFiles($("beforePhotos").files, "visits/before");
    const afterUrls = await uploadFiles($("afterPhotos").files, "visits/after");

    const data = {
      clientName: safe(fd.get("clientName")),
      clientPhone: safe(fd.get("clientPhone")),
      clientAddress: safe(fd.get("clientAddress")),
      brand: safe(fd.get("brand")),
      model: safe(fd.get("model")),
      btu: safe(fd.get("btu")),
      serial: safe(fd.get("serial")),
      serviceType: safe(fd.get("serviceType")),
      technician: safe(fd.get("technician")),
      nextVisit: safe(fd.get("nextVisit")),
      notes: safe(fd.get("notes")),
      recommendations: safe(fd.get("recommendations")),
      healthScore,
      systemStatus: statusFromScore(healthScore).label,
      metrics: {
        cooling: Number(fd.get("cooling")),
        pressure: Number(fd.get("pressure")),
        drain: Number(fd.get("drain")),
        evaporator: Number(fd.get("evaporator")),
        condenser: Number(fd.get("condenser"))
      },
      beforeUrls,
      afterUrls,
      createdAt: serverTimestamp(),
      createdAtText: new Date().toLocaleDateString("es-PR")
    };

    await addDoc(collection(db, "users", currentUser.uid, "visits"), data);
    e.target.reset();
    updateHealthPreview();
    $("beforePhotos").value = "";
    $("afterPhotos").value = "";
    await loadVisits();
    document.querySelector('[data-tab="history"]').click();
  } catch (err) {
    alert("Error guardando visita: " + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar visita";
  }
});

async function loadSettings(){
  const snap = await getDoc(doc(db, "users", currentUser.uid, "settings", "main"));
  if (snap.exists()) settings = { ...settings, ...snap.data() };

  const sf = $("settingsForm");
  sf.businessName.value = settings.businessName || "";
  sf.businessPhone.value = settings.businessPhone || "";
  sf.businessEmail.value = settings.businessEmail || "";
  sf.businessAddress.value = settings.businessAddress || "";
}

async function loadVisits(){
  try {
    const q = query(collection(db, "users", currentUser.uid, "visits"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    visitsCache = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderVisits(visitsCache);
    renderClients(visitsCache);
    renderKpis(visitsCache);
  } catch (err) {
    alert("Error cargando historial: " + err.message);
  }
}

function renderKpis(visits){
  $("kpiVisits").textContent = visits.length;
  $("kpiClients").textContent = new Set(visits.map(v => (v.clientPhone || v.clientName || "").trim()).filter(Boolean)).size;
  $("kpiHealth").textContent = visits.length ? Math.round(visits.reduce((s,v)=>s+Number(v.healthScore||0),0)/visits.length) : "—";
}

function renderVisits(visits){
  const list = $("visitList");
  list.innerHTML = "";
  if (!visits.length) {
    list.innerHTML = `<div class="visit-card"><h3>Sin visitas</h3><p>Crea la primera tarjeta de servicio.</p></div>`;
    return;
  }
  visits.forEach(v => {
    const status = statusFromScore(v.healthScore);
    const card = document.createElement("article");
    card.className = "visit-card";
    card.innerHTML = `
      <h3>${cleanText(v.clientName || "Cliente")}</h3>
      <p>${cleanText(v.serviceType || "Servicio")} · ${cleanText(v.createdAtText || "")}</p>
      <p>${cleanText([v.brand, v.btu, v.serial].filter(Boolean).join(" · "))}</p>
      <span class="badge ${status.cls}">${Number(v.healthScore || 0)} · ${status.label}</span>
      <div class="card-actions">
        <button type="button" class="small-btn" data-action="pdf" data-id="${v.id}">PDF</button>
        <button type="button" class="small-btn" data-action="qr" data-id="${v.id}">QR</button>
        ${v.clientPhone ? `<button type="button" class="small-btn" data-action="wa" data-id="${v.id}">WhatsApp</button>` : ""}
      </div>`;
    list.appendChild(card);
  });
}

function renderClients(visits){
  const map = new Map();
  visits.forEach(v => {
    const key = (v.clientPhone || v.clientName || "").trim();
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  });

  const list = $("clientList");
  list.innerHTML = "";
  if (!map.size) {
    list.innerHTML = `<div class="visit-card"><h3>Sin clientes</h3><p>Los clientes aparecerán aquí automáticamente.</p></div>`;
    return;
  }

  map.forEach((items) => {
    const latest = items[0];
    const avg = Math.round(items.reduce((s,v)=>s+Number(v.healthScore||0),0)/items.length);
    const status = statusFromScore(avg);
    const card = document.createElement("article");
    card.className = "visit-card";
    card.innerHTML = `
      <h3>${cleanText(latest.clientName || "Cliente")}</h3>
      <p>${cleanText(latest.clientPhone || "")}</p>
      <p>${items.length} visita(s)</p>
      <span class="badge ${status.cls}">${avg} · ${status.label}</span>`;
    list.appendChild(card);
  });
}

$("visitList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const v = visitsCache.find(item => item.id === btn.dataset.id);
  if (!v) return alert("No se encontró la visita.");
  if (btn.dataset.action === "pdf") openPrintablePDF(v);
  if (btn.dataset.action === "qr") openQR(v);
  if (btn.dataset.action === "wa") sendWhatsApp(v);
});

$("searchInput").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase().trim();
  renderVisits(visitsCache.filter(v => JSON.stringify(v).toLowerCase().includes(term)));
});

$("settingsBtn").onclick = () => $("settingsDialog").showModal();
$("closeSettings").onclick = () => $("settingsDialog").close();

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const sf = $("settingsForm");
    let logoUrl = settings.logoUrl || "";
    if ($("logoFile").files[0]) {
      const fileRef = ref(storage, `users/${currentUser.uid}/settings/logo_${Date.now()}`);
      await uploadBytes(fileRef, $("logoFile").files[0]);
      logoUrl = await getDownloadURL(fileRef);
    }
    settings = {
      businessName: sf.businessName.value,
      businessPhone: sf.businessPhone.value,
      businessEmail: sf.businessEmail.value,
      businessAddress: sf.businessAddress.value,
      logoUrl
    };
    await setDoc(doc(db, "users", currentUser.uid, "settings", "main"), settings, { merge:true });
    $("settingsDialog").close();
  } catch (err) {
    alert("Error guardando configuración: " + err.message);
  }
});

function visitPublicUrl(v){
  return `${location.origin}${location.pathname}#visit-${v.id}`;
}

function openQR(v){
  const url = visitPublicUrl(v);
  const img = qrUrl(url, 360);
  const html = `<!doctype html><html><head><title>QR Oasis Visit Card</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{margin:0;background:#05070b;color:white;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center} .box{padding:28px} img{background:white;padding:18px;border-radius:24px;max-width:80vw} h1{margin:0 0 18px}.muted{color:#9aa3b2}</style>
  </head><body><div class="box"><h1>Oasis Visit Card</h1><img src="${img}"><p>${cleanText(v.clientName || "")}</p><p class="muted">${cleanText(v.brand || "")} ${cleanText(v.btu || "")}</p><button onclick="window.print()">Imprimir QR</button></div></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return alert("El navegador bloqueó la ventana. Permite pop-ups para esta página.");
  w.document.open(); w.document.write(html); w.document.close();
}

function sendWhatsApp(v){
  const phone = (v.clientPhone || "").replace(/\D/g, "");
  const finalPhone = phone.length === 10 ? "1" + phone : phone;
  const msg = `Saludos ${v.clientName || ""}, aquí tiene el resumen de su servicio Oasis Visit Card. Estado del sistema: ${v.healthScore || 0}/100 - ${v.systemStatus || ""}. Próxima visita: ${v.nextVisit || "por coordinar"}.`;
  window.open(`https://wa.me/${finalPhone}?text=${encodeURIComponent(msg)}`, "_blank");
}

function photoStrip(urls, title){
  if (!urls || !urls.length) return "";
  return `<h3>${title}</h3><div class="photos">${urls.slice(0,4).map(u => `<img src="${u}" />`).join("")}</div>`;
}

function openPrintablePDF(v){
  const status = statusFromScore(v.healthScore);
  const qr = qrUrl(visitPublicUrl(v), 160);
  const html = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<title>Oasis Visit Card</title>
<style>
@page{size:letter;margin:0}
*{box-sizing:border-box}
body{margin:0;background:#111;color:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.sheet{width:8.5in;min-height:11in;margin:0 auto;background:linear-gradient(135deg,#05070b,#101828 60%,#05070b);padding:.55in;position:relative}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid rgba(255,255,255,.14);padding-bottom:22px}
.brand small{display:block;color:#d8b45a;letter-spacing:.28em;font-weight:900;font-size:11px}.brand h1{font-size:36px;margin:8px 0 6px}.brand p{margin:0;color:#9aa3b2}
.logo{width:88px;height:88px;object-fit:contain;border-radius:18px;background:rgba(255,255,255,.06)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}.box{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);border-radius:20px;padding:18px}.box h2{font-size:12px;color:#d8b45a;letter-spacing:.12em;margin:0 0 12px;text-transform:uppercase}.row{margin:7px 0;color:#dfe6f2}.muted{color:#9aa3b2}
.score{margin-top:22px;border-radius:24px;padding:22px;background:${status.color};color:#05070b;display:flex;justify-content:space-between;align-items:center}.score strong{font-size:46px}.score span{font-weight:900;text-transform:uppercase}
.notes{margin-top:18px}.notes h3,.photos-title,h3{color:#d8b45a;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:18px 0 8px}.notes p{white-space:pre-wrap;line-height:1.55;color:#e7edf7}.photos{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.photos img{width:100%;height:105px;object-fit:cover;border-radius:14px;border:1px solid rgba(255,255,255,.12)}
.footer{position:absolute;left:.55in;right:.55in;bottom:.42in;display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid rgba(255,255,255,.14);padding-top:18px;color:#9aa3b2;font-size:12px}.qr{width:100px;background:white;padding:8px;border-radius:14px}
.printbar{position:fixed;top:12px;right:12px;z-index:20}.printbar button{border:0;border-radius:14px;background:#14b8ff;color:white;font-weight:900;padding:12px 16px;cursor:pointer}
@media print{.printbar{display:none}body{background:white}.sheet{margin:0}}
</style>
</head>
<body>
<div class="printbar"><button onclick="window.print()">Guardar / Imprimir PDF</button></div>
<section class="sheet">
  <div class="header">
    <div class="brand">
      <small>${cleanText(settings.businessName || "OASIS")}</small>
      <h1>Visit Card</h1>
      <p>Expediente visual de servicio</p>
    </div>
    ${settings.logoUrl ? `<img class="logo" src="${settings.logoUrl}">` : ""}
  </div>

  <div class="grid">
    <div class="box">
      <h2>Cliente</h2>
      <div class="row"><b>${cleanText(v.clientName || "—")}</b></div>
      <div class="row muted">${cleanText(v.clientPhone || "—")}</div>
      <div class="row muted">${cleanText(v.clientAddress || "—")}</div>
    </div>
    <div class="box">
      <h2>Equipo</h2>
      <div class="row">Marca: <b>${cleanText(v.brand || "—")}</b></div>
      <div class="row">Modelo: <b>${cleanText(v.model || "—")}</b></div>
      <div class="row">BTU: <b>${cleanText(v.btu || "—")}</b></div>
      <div class="row">Serial: <b>${cleanText(v.serial || "—")}</b></div>
    </div>
    <div class="box">
      <h2>Servicio</h2>
      <div class="row"><b>${cleanText(v.serviceType || "—")}</b></div>
      <div class="row muted">Fecha: ${cleanText(v.createdAtText || "—")}</div>
      <div class="row muted">Técnico: ${cleanText(v.technician || "—")}</div>
    </div>
    <div class="box">
      <h2>Próxima visita</h2>
      <div class="row"><b>${cleanText(v.nextVisit || "Por coordinar")}</b></div>
      <div class="row muted">Seguimiento preventivo</div>
    </div>
  </div>

  <div class="score">
    <div><span>Health Score</span><strong>${Number(v.healthScore || 0)}/100</strong></div>
    <div><span>${status.label}</span></div>
  </div>

  <div class="notes">
    <h3>Observaciones técnicas</h3>
    <p>${cleanText(v.notes || "—")}</p>
    <h3>Recomendaciones</h3>
    <p>${cleanText(v.recommendations || "—")}</p>
  </div>

  ${photoStrip(v.beforeUrls, "Fotos antes")}
  ${photoStrip(v.afterUrls, "Fotos después")}

  <div class="footer">
    <div>
      <b>${cleanText(settings.businessName || "Oasis Air Cleaner Services LLC")}</b><br>
      ${cleanText(settings.businessPhone || "")} ${cleanText(settings.businessEmail || "")}<br>
      ${cleanText(settings.businessAddress || "")}
    </div>
    <img class="qr" src="${qr}">
  </div>
</section>
</body>
</html>`;
  const w = window.open("", "_blank");
  if (!w) return alert("El navegador bloqueó la ventana. Permite pop-ups para esta página.");
  w.document.open(); w.document.write(html); w.document.close();
}
