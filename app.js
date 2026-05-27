import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
const authScreen = $("authScreen");
const appScreen = $("app");
const form = $("visitForm");

$("loginBtn").onclick = async () => {
  try { await signInWithPopup(auth, provider); }
  catch (err) { alert(err.message); console.error(err); }
};

$("logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    return;
  }
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  await loadSettings();
  await loadVisits();
});

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
  });
});

["cooling","pressure","drain","evaporator","condenser"].forEach(name => {
  form.elements[name].addEventListener("input", updateHealthPreview);
});

function updateHealthPreview(){
  $("healthPreview").textContent = calculateHealthFromForm();
}

function calculateHealthFromForm(){
  const fields = ["cooling","pressure","drain","evaporator","condenser"];
  const total = fields.reduce((sum, field) => sum + Number(form.elements[field].value || 0), 0);
  return Math.round(total / fields.length);
}

function statusFromScore(score){
  if (score >= 82) return { label:"Excelente", cls:"ok" };
  if (score >= 62) return { label:"Atención preventiva", cls:"warn" };
  return { label:"Riesgo alto", cls:"danger" };
}

async function uploadFiles(files, folder){
  const urls = [];
  for (const file of files) {
    const cleanName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `users/${currentUser.uid}/${folder}/${Date.now()}_${cleanName}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    urls.push(await getDownloadURL(fileRef));
  }
  return urls;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const saveBtn = form.querySelector("button[type='submit']");
  saveBtn.disabled = true;
  saveBtn.textContent = "Guardando...";

  try {
    const fd = new FormData(form);
    const healthScore = calculateHealthFromForm();

    const beforeUrls = await uploadFiles($("beforePhotos").files, "visits/before");
    const afterUrls = await uploadFiles($("afterPhotos").files, "visits/after");

    const data = {
      clientName: fd.get("clientName") || "",
      clientPhone: fd.get("clientPhone") || "",
      clientAddress: fd.get("clientAddress") || "",
      brand: fd.get("brand") || "",
      model: fd.get("model") || "",
      btu: fd.get("btu") || "",
      serial: fd.get("serial") || "",
      serviceType: fd.get("serviceType") || "",
      technician: fd.get("technician") || "",
      nextVisit: fd.get("nextVisit") || "",
      notes: fd.get("notes") || "",
      recommendations: fd.get("recommendations") || "",
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
    form.reset();
    updateHealthPreview();
    $("beforePhotos").value = "";
    $("afterPhotos").value = "";
    await loadVisits();
    document.querySelector('[data-tab="history"]').click();
  } catch (err) {
    alert(err.message);
    console.error(err);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Guardar visita";
  }
});

async function loadSettings(){
  const refDoc = doc(db, "users", currentUser.uid, "settings", "main");
  const snap = await getDoc(refDoc);
  if (snap.exists()) settings = { ...settings, ...snap.data() };

  const sf = $("settingsForm");
  sf.businessName.value = settings.businessName || "";
  sf.businessPhone.value = settings.businessPhone || "";
  sf.businessEmail.value = settings.businessEmail || "";
  sf.businessAddress.value = settings.businessAddress || "";
}

async function loadVisits(){
  const q = query(collection(db, "users", currentUser.uid, "visits"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  visitsCache = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  renderVisits(visitsCache);
  renderClients(visitsCache);
  renderKpis(visitsCache);
}

function renderKpis(visits){
  $("kpiVisits").textContent = visits.length;
  $("kpiClients").textContent = new Set(visits.map(v => (v.clientPhone || v.clientName || "").trim()).filter(Boolean)).size;
  if (!visits.length) $("kpiHealth").textContent = "—";
  else $("kpiHealth").textContent = Math.round(visits.reduce((s,v)=>s+(v.healthScore||0),0)/visits.length);
}

function renderVisits(visits){
  const list = $("visitList");
  list.innerHTML = "";
  if (!visits.length) {
    list.innerHTML = `<div class="visit-card"><h3>Sin visitas</h3><p>Crea la primera tarjeta de servicio.</p></div>`;
    return;
  }

  visits.forEach(v => {
    const status = statusFromScore(v.healthScore || 0);
    const card = document.createElement("article");
    card.className = "visit-card";
    card.innerHTML = `
      <h3>${escapeHTML(v.clientName || "Cliente")}</h3>
      <p>${escapeHTML(v.serviceType || "Servicio")} · ${escapeHTML(v.createdAtText || "")}</p>
      <p>${escapeHTML([v.brand, v.btu, v.serial].filter(Boolean).join(" · "))}</p>
      <span class="badge ${status.cls}">${v.healthScore || 0} · ${status.label}</span>
      <div class="card-actions">
        <button class="small-btn" data-pdf="${v.id}">PDF</button>
        <button class="small-btn" data-qr="${v.id}">QR</button>
        ${v.clientPhone ? `<button class="small-btn" data-wa="${v.id}">WhatsApp</button>` : ""}
      </div>
    `;
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
    const avg = Math.round(items.reduce((s,v)=>s+(v.healthScore||0),0)/items.length);
    const status = statusFromScore(avg);
    const card = document.createElement("article");
    card.className = "visit-card";
    card.innerHTML = `
      <h3>${escapeHTML(latest.clientName || "Cliente")}</h3>
      <p>${escapeHTML(latest.clientPhone || "")}</p>
      <p>${items.length} visita(s)</p>
      <span class="badge ${status.cls}">${avg} · ${status.label}</span>
    `;
    list.appendChild(card);
  });
}

$("visitList").addEventListener("click", async (e) => {
  const pdfId = e.target.dataset.pdf;
  const qrId = e.target.dataset.qr;
  const waId = e.target.dataset.wa;

  if (pdfId) generatePDF(visitsCache.find(v => v.id === pdfId));
  if (qrId) showQR(visitsCache.find(v => v.id === qrId));
  if (waId) sendWhatsApp(visitsCache.find(v => v.id === waId));
});

$("searchInput").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase().trim();
  const filtered = visitsCache.filter(v => JSON.stringify(v).toLowerCase().includes(term));
  renderVisits(filtered);
});

$("settingsBtn").onclick = () => $("settingsDialog").showModal();
$("closeSettings").onclick = () => $("settingsDialog").close();

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sf = $("settingsForm");
  try {
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
    alert(err.message);
  }
});

function sendWhatsApp(v){
  const phone = (v.clientPhone || "").replace(/\D/g, "");
  const prPhone = phone.length === 10 ? "1" + phone : phone;
  const msg = `Saludos ${v.clientName || ""}, aquí tiene el resumen de su servicio Oasis Visit Card. Estado del sistema: ${v.healthScore || 0}/100 - ${v.systemStatus || ""}. Próxima visita: ${v.nextVisit || "por coordinar"}.`;
  window.open(`https://wa.me/${prPhone}?text=${encodeURIComponent(msg)}`, "_blank");
}

async function showQR(v){
  const payload = `${location.origin}${location.pathname}#visit-${v.id}`;
  const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 280 });
  const w = window.open("", "_blank");
  w.document.write(`<title>QR Oasis Visit Card</title><body style="background:#05070b;color:white;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center"><div><h1>Oasis Visit Card</h1><img src="${dataUrl}" style="background:white;padding:18px;border-radius:24px"><p>${escapeHTML(v.clientName || "")}</p></div></body>`);
}

async function generatePDF(v){
  if (!v) return;
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "pt", "letter");
  const W = pdf.internal.pageSize.getWidth();
  const margin = 42;
  const status = statusFromScore(v.healthScore || 0);

  pdf.setFillColor(5,7,11);
  pdf.rect(0,0,W,792,"F");

  pdf.setTextColor(216,180,90);
  pdf.setFont("helvetica","bold");
  pdf.setFontSize(11);
  pdf.text((settings.businessName || "OASIS").toUpperCase(), margin, 48);

  pdf.setTextColor(255,255,255);
  pdf.setFontSize(30);
  pdf.text("Oasis Visit Card", margin, 84);

  pdf.setTextColor(154,163,178);
  pdf.setFontSize(10);
  pdf.text(`Fecha: ${v.createdAtText || new Date().toLocaleDateString("es-PR")}`, margin, 105);

  if (settings.logoUrl) {
    try {
      const img = await imageToDataUrl(settings.logoUrl);
      pdf.addImage(img, "PNG", W-132, 38, 86, 86);
    } catch {}
  }

  drawBox(pdf, margin, 134, W-(margin*2), 95, "Cliente", [
    [v.clientName || "", v.clientPhone || ""],
    [v.clientAddress || "", ""]
  ]);

  drawBox(pdf, margin, 248, W-(margin*2), 95, "Equipo", [
    [`Marca: ${v.brand || "—"}`, `Modelo: ${v.model || "—"}`],
    [`BTU: ${v.btu || "—"}`, `Serial: ${v.serial || "—"}`]
  ]);

  pdf.setFillColor(status.cls === "ok" ? 68 : status.cls === "warn" ? 255 : 255, status.cls === "ok" ? 209 : status.cls === "warn" ? 203 : 77, status.cls === "ok" ? 122 : status.cls === "warn" ? 71 : 103);
  pdf.roundedRect(margin, 366, 190, 62, 16, 16, "F");
  pdf.setTextColor(5,7,11);
  pdf.setFontSize(22);
  pdf.setFont("helvetica","bold");
  pdf.text(`${v.healthScore || 0}/100`, margin+18, 396);
  pdf.setFontSize(9);
  pdf.text(status.label.toUpperCase(), margin+18, 414);

  pdf.setTextColor(255,255,255);
  pdf.setFontSize(13);
  pdf.text("Servicio", margin+220, 382);
  pdf.setTextColor(154,163,178);
  pdf.setFontSize(11);
  pdf.text(`${v.serviceType || "—"} · Técnico: ${v.technician || "—"}`, margin+220, 404);
  pdf.text(`Próxima visita: ${v.nextVisit || "Por coordinar"}`, margin+220, 421);

  drawTextBlock(pdf, margin, 462, "Observaciones técnicas", v.notes || "—");
  drawTextBlock(pdf, margin, 570, "Recomendaciones", v.recommendations || "—");

  const qr = await QRCode.toDataURL(`${location.origin}${location.pathname}#visit-${v.id}`, { margin: 1, width: 200 });
  pdf.addImage(qr, "PNG", W-140, 620, 86, 86);
  pdf.setTextColor(154,163,178);
  pdf.setFontSize(8);
  pdf.text("QR historial", W-124, 722);

  pdf.setFontSize(9);
  pdf.text(`${settings.businessPhone || ""}  ${settings.businessEmail || ""}`, margin, 738);
  pdf.text(settings.businessAddress || "", margin, 753);

  pdf.save(`Oasis-Visit-Card-${cleanFileName(v.clientName || "cliente")}.pdf`);
}

function drawBox(pdf, x, y, w, h, title, rows){
  pdf.setFillColor(255,255,255,0.06);
  pdf.setDrawColor(255,255,255,0.12);
  pdf.roundedRect(x,y,w,h,18,18,"S");
  pdf.setTextColor(216,180,90);
  pdf.setFont("helvetica","bold");
  pdf.setFontSize(10);
  pdf.text(title.toUpperCase(), x+18, y+24);
  pdf.setTextColor(245,247,251);
  pdf.setFontSize(11);
  let yy = y+50;
  rows.forEach(r => {
    pdf.text(String(r[0] || "—"), x+18, yy);
    if (r[1]) pdf.text(String(r[1]), x+w/2, yy);
    yy += 24;
  });
}

function drawTextBlock(pdf, x, y, title, text){
  pdf.setTextColor(216,180,90);
  pdf.setFont("helvetica","bold");
  pdf.setFontSize(11);
  pdf.text(title.toUpperCase(), x, y);
  pdf.setTextColor(245,247,251);
  pdf.setFont("helvetica","normal");
  pdf.setFontSize(10);
  const lines = pdf.splitTextToSize(text, 500);
  pdf.text(lines.slice(0, 7), x, y+22);
}

function imageToDataUrl(url){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img,0,0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function escapeHTML(str){
  return String(str || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function cleanFileName(str){
  return String(str).replace(/[^\w\-]+/g, "_").slice(0, 50);
}
