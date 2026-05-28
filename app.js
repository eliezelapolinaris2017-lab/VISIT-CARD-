import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, query, orderBy, serverTimestamp, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm";

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

function setupNextVisitAutomation(){
  const interval = $("visitInterval");
  const nextVisit = $("nextVisit");
  const reason = $("nextVisitReason");
  if (!interval || !nextVisit) return;

  const apply = () => {
    if (interval.value === "custom") {
      nextVisit.disabled = false;
      if (!nextVisit.value) nextVisit.value = formatDate(new Date());
      if (reason) reason.placeholder = "Motivo del ajuste";
      return;
    }

    const months = Number(interval.value || 6);
    nextVisit.value = addMonths(new Date(), months);
    nextVisit.disabled = false;

    if (reason) {
      reason.placeholder = months < 6
        ? "Motivo del menor tiempo: comercial, alto uso, grasa, polvo, etc."
        : "Motivo del ajuste, si aplica";
    }
  };

  interval.removeEventListener("change", apply);
  interval.addEventListener("change", apply);
  apply();
}

function addMonths(date, months){
  const d = new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
  return formatDate(d);
}

function formatDate(date){
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}


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
  setupNextVisitAutomation();
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
      equipmentLocation: safe(fd.get("equipmentLocation")),
      brand: safe(fd.get("brand")),
      model: safe(fd.get("model")),
      btu: safe(fd.get("btu")),
      serial: safe(fd.get("serial")),
      serviceType: safe(fd.get("serviceType")),
      technician: safe(fd.get("technician")),
      visitInterval: safe(fd.get("visitInterval")),
      visitIntervalLabel: $("visitInterval")?.selectedOptions[0]?.textContent || "Residencial estándar — 6 meses",
      nextVisit: safe(fd.get("nextVisit")),
      nextVisitReason: safe(fd.get("nextVisitReason")),
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

    const editingId = $("editingId")?.value || "";
    if (editingId) {
      const original = visitsCache.find(x => x.id === editingId) || {};
      data.beforeUrls = beforeUrls.length ? beforeUrls : (original.beforeUrls || []);
      data.afterUrls = afterUrls.length ? afterUrls : (original.afterUrls || []);
      data.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "users", currentUser.uid, "visits", editingId), data);
    } else {
      await addDoc(collection(db, "users", currentUser.uid, "visits"), data);
    }

    clearVisitForm();
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
      <p>${cleanText([v.equipmentLocation || "Equipo", v.brand, v.btu].filter(Boolean).join(" · "))}</p>
      <p>Próxima visita: ${cleanText(v.nextVisit || "Por coordinar")}</p>
      <span class="badge ${status.cls}">${Number(v.healthScore || 0)} · ${status.label}</span>
      <div>
        <span class="meta-pill">${cleanText(v.visitIntervalLabel || "6 meses")}</span>
        ${v.nextVisitReason ? `<span class="meta-pill">Ajustado</span>` : ""}
      </div>
      <div class="card-actions">
        <button type="button" class="small-btn" data-action="view" data-id="${v.id}">Ver</button>
        <button type="button" class="small-btn" data-action="edit" data-id="${v.id}">Editar</button>
        <button type="button" class="small-btn" data-action="pdf" data-id="${v.id}">PDF</button>
        <button type="button" class="small-btn" data-action="qr" data-id="${v.id}">QR</button>
        ${v.clientPhone ? `<button type="button" class="small-btn" data-action="wa" data-id="${v.id}">WhatsApp</button>` : ""}
        <button type="button" class="danger-btn" data-action="delete" data-id="${v.id}">Borrar</button>
      </div>`;
    list.appendChild(card);
  });
}

function clientKey(v){
  const phone = (v.clientPhone || "").replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${String(v.clientName || "").trim().toLowerCase()}|addr:${String(v.clientAddress || "").trim().toLowerCase()}`;
}

function renderClients(visits){
  const map = new Map();

  visits.forEach(v => {
    const key = clientKey(v);
    if (!key || key === "name:|addr:") return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  });

  const groups = Array.from(map.entries()).map(([key, items]) => {
    return { key, items, latest: items[0] };
  }).sort((a,b) => String(a.latest.clientName || "").localeCompare(String(b.latest.clientName || "")));

  const list = $("clientList");
  list.innerHTML = "";

  if (!groups.length) {
    list.innerHTML = `<div class="visit-card"><h3>Sin clientes</h3><p>Los clientes aparecerán aquí automáticamente.</p></div>`;
    return;
  }

  groups.forEach(group => {
    const items = group.items;
    const latest = group.latest;
    const avg = Math.round(items.reduce((s,v)=>s+Number(v.healthScore||0),0)/items.length);
    const status = statusFromScore(avg);
    const nextDates = items.map(v => v.nextVisit).filter(Boolean).sort();
    const next = nextDates[0] || latest.nextVisit || "Por coordinar";

    const card = document.createElement("article");
    card.className = "visit-card client-master-card";
    card.innerHTML = `
      <h3>${cleanText(latest.clientName || "Cliente")}</h3>
      <p>${cleanText(latest.clientPhone || "")}</p>
      <p>${cleanText(latest.clientAddress || "")}</p>
      <p>${items.length} visita(s) registradas</p>
      <p>Próxima: ${cleanText(next)}</p>
      <span class="badge ${status.cls}">${avg} · ${status.label}</span>
      <div class="card-actions">
        <button type="button" class="small-btn" data-client-action="history" data-key="${cleanText(group.key)}">Ver historial</button>
        <button type="button" class="small-btn" data-client-action="pdf-history" data-key="${cleanText(group.key)}">PDF expediente</button>
      </div>
    `;
    list.appendChild(card);
  });
}

$("clientList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-client-action]");
  if (!btn) return;

  const key = btn.dataset.key;
  const visits = visitsCache.filter(v => clientKey(v) === key);

  if (!visits.length) return alert("No se encontró historial para este cliente.");

  if (btn.dataset.clientAction === "history") openClientHistory(visits);
  if (btn.dataset.clientAction === "pdf-history") await generateClientHistoryPDF(visits);
});

$("visitList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const v = visitsCache.find(item => item.id === btn.dataset.id);
  if (!v) return alert("No se encontró la visita.");
  if (btn.dataset.action === "view") openDetail(v);
  if (btn.dataset.action === "edit") editVisit(v);
  if (btn.dataset.action === "delete") deleteVisit(v);
  if (btn.dataset.action === "pdf") generateRealPDF(v);
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



function openClientHistory(visits){
  const latest = visits[0];
  const avg = Math.round(visits.reduce((s,v)=>s+Number(v.healthScore||0),0)/visits.length);
  const status = statusFromScore(avg);

  $("detailContent").innerHTML = `
    <h2>Expediente de cliente</h2>
    <p class="muted">${cleanText(latest.clientName || "Cliente")} · ${cleanText(latest.clientPhone || "")}</p>
    <span class="badge ${status.cls}">${avg} · Promedio Health</span>
    <div class="detail-grid">
      <div class="detail-box"><h3>Cliente</h3><p>${cleanText(latest.clientName || "—")}</p><p>${cleanText(latest.clientPhone || "—")}</p><p>${cleanText(latest.clientAddress || "—")}</p></div>
      <div class="detail-box"><h3>Resumen</h3><p>${visits.length} visita(s)</p><p>Última visita: ${cleanText(latest.createdAtText || "—")}</p><p>Próxima: ${cleanText(latest.nextVisit || "Por coordinar")}</p></div>
    </div>
    <h3>Historial de visitas</h3>
    <div class="history-timeline">
      ${visits.map(v => {
        const s = statusFromScore(v.healthScore);
        return `
          <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-card">
              <h4>${cleanText(v.createdAtText || "Sin fecha")} · ${cleanText(v.serviceType || "Servicio")}</h4>
              <p>${cleanText([v.brand, v.model, v.btu, v.serial].filter(Boolean).join(" · "))}</p>
              <p>Health: <b>${Number(v.healthScore || 0)}/100</b> · ${s.label}</p>
              <p>Próxima visita: ${cleanText(v.nextVisit || "Por coordinar")}</p>
              ${v.notes ? `<p><b>Obs:</b> ${cleanText(v.notes)}</p>` : ""}
              ${v.recommendations ? `<p><b>Rec:</b> ${cleanText(v.recommendations)}</p>` : ""}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
  $("detailDialog").showModal();
}

async function generateClientHistoryPDF(visits){
  if (!visits || !visits.length) return;

  try {
    const latest = visits[0];
    const avg = Math.round(visits.reduce((s,v)=>s+Number(v.healthScore||0),0)/visits.length);
    const status = statusFromScore(avg);

    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const m = 42;

    function header(title = "Expediente de Cliente"){
      pdf.setFillColor(245,247,251);
      pdf.rect(0,0,W,H,"F");
      pdf.setFillColor(7,12,24);
      pdf.roundedRect(28,28,W-56,H-56,24,24,"F");
      pdf.setFillColor(12,24,45);
      pdf.roundedRect(m-6,m-6,W-(m*2)+12,H-(m*2)+12,18,18,"F");

      pdf.setTextColor(216,180,90);
      pdf.setFont("helvetica","bold");
      pdf.setFontSize(9);
      pdf.text((settings.businessName || "Oasis Air Cleaner Services LLC").toUpperCase(), m, 58);

      pdf.setTextColor(255,255,255);
      pdf.setFontSize(26);
      pdf.text(title, m, 88);

      pdf.setTextColor(210,218,230);
      pdf.setFontSize(10);
      pdf.text("Historial técnico acumulado", m, 108);
    }

    header();

    let y = 140;

    drawPdfBox(pdf, m, y, 250, 116, "CLIENTE", [
      latest.clientName || "—",
      latest.clientPhone || "—",
      latest.clientAddress || "—"
    ]);

    drawPdfBox(pdf, m + 270, y, 250, 116, "RESUMEN", [
      `${visits.length} visita(s) registradas`,
      `Promedio Health: ${avg}/100`,
      `Última visita: ${latest.createdAtText || "—"}`,
      `Próxima: ${latest.nextVisit || "Por coordinar"}`
    ]);

    y += 142;

    const c = hexToRgb(status.color);
    pdf.setFillColor(c.r,c.g,c.b);
    pdf.roundedRect(m,y,W-(m*2),58,16,16,"F");
    pdf.setTextColor(5,7,11);
    pdf.setFont("helvetica","bold");
    pdf.setFontSize(11);
    pdf.text("ESTADO GENERAL DEL CLIENTE", m+20, y+35);
    pdf.setFontSize(28);
    pdf.text(`${avg}/100`, W-155, y+38);

    y += 90;

    pdf.setTextColor(216,180,90);
    pdf.setFont("helvetica","bold");
    pdf.setFontSize(11);
    pdf.text("HISTORIAL DE VISITAS", m, y);
    y += 24;

    for (let i = 0; i < visits.length; i++) {
      const v = visits[i];
      const s = statusFromScore(v.healthScore);

      if (y > H - 170) {
        pdf.addPage();
        header("Expediente de Cliente");
        y = 140;
      }

      pdf.setDrawColor(90,115,150);
      pdf.setFillColor(22,38,64);
      pdf.roundedRect(m, y, W-(m*2), 118, 14, 14, "FD");

      pdf.setTextColor(216,180,90);
      pdf.setFont("helvetica","bold");
      pdf.setFontSize(10);
      pdf.text(`${i+1}. ${v.createdAtText || "Sin fecha"} · ${v.serviceType || "Servicio"}`, m+16, y+24);

      pdf.setTextColor(245,247,251);
      pdf.setFontSize(10);
      pdf.text(wrap(pdf, `${v.brand || "—"} ${v.model || ""} ${v.btu || ""} · Serial: ${v.serial || "—"}`, W-(m*2)-32), m+16, y+44);

      pdf.setTextColor(210,218,230);
      pdf.text(`Health: ${Number(v.healthScore || 0)}/100 · ${s.label}`, m+16, y+64);
      pdf.text(`Próxima visita: ${v.nextVisit || "Por coordinar"}`, m+16, y+82);

      const obs = [v.notes ? `Obs: ${v.notes}` : "", v.recommendations ? `Rec: ${v.recommendations}` : ""].filter(Boolean).join("  |  ");
      if (obs) {
        pdf.setFontSize(8.5);
        pdf.text(wrap(pdf, obs, W-(m*2)-32).slice(0,2), m+16, y+101);
      }

      y += 132;
    }

    pdf.setDrawColor(255,255,255);
    pdf.setLineWidth(.3);
    pdf.line(m,H-92,W-m,H-92);

    pdf.setTextColor(210,218,230);
    pdf.setFont("helvetica","bold");
    pdf.setFontSize(9);
    pdf.text(settings.businessName || "Oasis Air Cleaner Services LLC", m, H-68);
    pdf.setFont("helvetica","normal");
    pdf.text(`${settings.businessPhone || ""} ${settings.businessEmail || ""}`, m, H-53);

    const fileName = `Oasis-Expediente-${cleanFileName(latest.clientName || "cliente")}.pdf`;
    const blob = pdf.output("blob");
    const file = new File([blob], fileName, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: "Expediente de Cliente",
        text: "Historial técnico de servicio",
        files: [file]
      });
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

  } catch (err) {
    console.error(err);
    alert("No se pudo generar el expediente PDF: " + err.message);
  }
}


function clearVisitForm(){
  const form = $("visitForm");
  form.reset();
  $("editingId").value = "";
  $("saveVisitBtn").textContent = "Guardar visita";
  $("cancelEditBtn").classList.add("hidden");
  $("visitInterval").value = "6";
  setupNextVisitAutomation();
  updateHealthPreview();
  $("beforePhotos").value = "";
  $("afterPhotos").value = "";
}

$("cancelEditBtn").onclick = clearVisitForm;
$("closeDetail").onclick = () => $("detailDialog").close();

function editVisit(v){
  const form = $("visitForm");
  $("editingId").value = v.id;
  form.clientName.value = v.clientName || "";
  form.clientPhone.value = v.clientPhone || "";
  form.clientAddress.value = v.clientAddress || "";
  form.equipmentLocation.value = v.equipmentLocation || "";
  form.brand.value = v.brand || "";
  form.model.value = v.model || "";
  form.btu.value = v.btu || "";
  form.serial.value = v.serial || "";
  form.serviceType.value = v.serviceType || "Mantenimiento Preventivo";
  form.technician.value = v.technician || "";
  $("visitInterval").value = v.visitInterval || "6";
  $("nextVisit").value = v.nextVisit || "";
  $("nextVisitReason").value = v.nextVisitReason || "";
  form.cooling.value = v.metrics?.cooling ?? v.healthScore ?? 85;
  form.pressure.value = v.metrics?.pressure ?? v.healthScore ?? 85;
  form.drain.value = v.metrics?.drain ?? v.healthScore ?? 85;
  form.evaporator.value = v.metrics?.evaporator ?? v.healthScore ?? 85;
  form.condenser.value = v.metrics?.condenser ?? v.healthScore ?? 85;
  form.notes.value = v.notes || "";
  form.recommendations.value = v.recommendations || "";
  $("saveVisitBtn").textContent = "Actualizar visita";
  $("cancelEditBtn").classList.remove("hidden");
  updateHealthPreview();
  document.querySelector('[data-tab="newVisit"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteVisit(v){
  const ok = confirm(`¿Borrar la visita de ${v.clientName || "este cliente"}? Esta acción no se puede deshacer.`);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "visits", v.id));
    await loadVisits();
  } catch (err) {
    alert("Error borrando visita: " + err.message);
  }
}

function openDetail(v){
  const status = statusFromScore(v.healthScore);
  $("detailContent").innerHTML = `
    <h2>${cleanText(v.clientName || "Cliente")}</h2>
    <p class="muted">${cleanText(v.serviceType || "Servicio")} · ${cleanText(v.createdAtText || "")}</p>
    <span class="badge ${status.cls}">${Number(v.healthScore || 0)} · ${status.label}</span>
    <div class="detail-grid">
      <div class="detail-box"><h3>Cliente</h3><p>${cleanText(v.clientPhone || "—")}</p><p>${cleanText(v.clientAddress || "—")}</p></div>
      <div class="detail-box"><h3>Equipo</h3><p>${cleanText(v.brand || "—")} ${cleanText(v.btu || "")}</p><p>Modelo: ${cleanText(v.model || "—")}</p><p>Serial: ${cleanText(v.serial || "—")}</p></div>
      <div class="detail-box"><h3>Próxima visita</h3><p>${cleanText(v.nextVisit || "Por coordinar")}</p><p>${cleanText(v.visitIntervalLabel || "Residencial estándar — 6 meses")}</p><p>${cleanText(v.nextVisitReason || "")}</p></div>
      <div class="detail-box"><h3>Técnico</h3><p>${cleanText(v.technician || "—")}</p></div>
      <div class="detail-box"><h3>Observaciones</h3><p>${cleanText(v.notes || "—")}</p></div>
      <div class="detail-box"><h3>Recomendaciones</h3><p>${cleanText(v.recommendations || "—")}</p></div>
    </div>
    ${(v.beforeUrls?.length || v.afterUrls?.length) ? `<h3>Fotos</h3><div class="photo-grid">${[...(v.beforeUrls||[]), ...(v.afterUrls||[])].slice(0,6).map(u=>`<img src="${u}">`).join("")}</div>` : ""}
  `;
  $("detailDialog").showModal();
}


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
      <div class="row muted">${cleanText(v.visitIntervalLabel || "Residencial estándar — 6 meses")}</div>
      ${v.nextVisitReason ? `<div class="row muted">Motivo: ${cleanText(v.nextVisitReason)}</div>` : ""}
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


async function getImageDataUrl(url){
  try {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function wrap(pdf, text, width){
  return pdf.splitTextToSize(String(text || "—"), width);
}

async function generateRealPDF(v){
  if (!v) return;

  try {
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const m = 42;
    const status = statusFromScore(v.healthScore || 0);

    pdf.setFillColor(245, 247, 251);
    pdf.rect(0, 0, W, H, "F");

    pdf.setFillColor(7, 12, 24);
    pdf.roundedRect(28, 28, W - 56, H - 56, 24, 24, "F");

    pdf.setFillColor(12, 24, 45);
    pdf.roundedRect(m - 6, m - 6, W - (m * 2) + 12, H - (m * 2) + 12, 18, 18, "F");

    pdf.setTextColor(216, 180, 90);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text((settings.businessName || "Oasis Air Cleaner Services LLC").toUpperCase(), m, 58);

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(30);
    pdf.text("Visit Card", m, 92);

    pdf.setTextColor(210, 218, 230);
    pdf.setFontSize(11);
    pdf.text("Expediente visual de servicio", m, 113);

    if (settings.logoUrl) {
      const logo = await getImageDataUrl(settings.logoUrl);
      if (logo) pdf.addImage(logo, "PNG", W - 135, 46, 82, 82, undefined, "FAST");
    }

    let y = 145;
    drawPdfBox(pdf, m, y, 250, 112, "CLIENTE", [
      v.clientName || "—",
      v.clientPhone || "—",
      v.clientAddress || "—"
    ]);
    drawPdfBox(pdf, m + 270, y, 250, 112, "EQUIPO", [
      `Marca: ${v.brand || "—"}`,
      `Modelo: ${v.model || "—"}`,
      `BTU: ${v.btu || "—"}`,
      `Serial: ${v.serial || "—"}`
    ]);

    y += 128;
    drawPdfBox(pdf, m, y, 250, 112, "SERVICIO", [
      v.serviceType || "—",
      `Fecha: ${v.createdAtText || "—"}`,
      `Técnico: ${v.technician || "—"}`
    ]);
    drawPdfBox(pdf, m + 270, y, 250, 112, "PRÓXIMA VISITA", [
      v.nextVisit || "Por coordinar",
      v.visitIntervalLabel || "Residencial estándar — 6 meses",
      v.nextVisitReason ? `Motivo: ${v.nextVisitReason}` : ""
    ].filter(Boolean));

    y += 135;
    const c = hexToRgb(status.color);
    pdf.setFillColor(c.r, c.g, c.b);
    pdf.roundedRect(m, y, W - (m * 2), 64, 16, 16, "F");
    pdf.setTextColor(5, 7, 11);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.text("HEALTH SCORE", m + 20, y + 38);
    pdf.setFontSize(34);
    pdf.text(`${Number(v.healthScore || 0)}/100`, m + 130, y + 43);
    pdf.setFontSize(12);
    pdf.text(status.label.toUpperCase(), W - 165, y + 38);

    y += 95;
    pdf.setTextColor(216, 180, 90);
    pdf.setFontSize(10);
    pdf.text("OBSERVACIONES TÉCNICAS", m, y);
    pdf.setTextColor(245, 247, 251);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.text(wrap(pdf, v.notes || "—", W - (m * 2)), m, y + 20);

    y += 80;
    pdf.setTextColor(216, 180, 90);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text("RECOMENDACIONES", m, y);
    pdf.setTextColor(245, 247, 251);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.text(wrap(pdf, v.recommendations || "—", W - (m * 2)), m, y + 20);

    y += 75;

    const allPhotos = [
      ...(v.beforeUrls || []).slice(0, 2),
      ...(v.afterUrls || []).slice(0, 2)
    ];

    if (allPhotos.length) {
      pdf.setTextColor(216, 180, 90);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("EVIDENCIA", m, y);
      y += 12;

      let x = m;
      for (const url of allPhotos) {
        const img = await getImageDataUrl(url);
        if (img) {
          pdf.addImage(img, "JPEG", x, y, 118, 78, undefined, "FAST");
          x += 128;
        }
      }
      y += 90;
    }

    const qr = await getImageDataUrl(qrUrl(visitPublicUrl(v), 220));
    if (qr) pdf.addImage(qr, "PNG", W - 128, H - 135, 86, 86);

    pdf.setDrawColor(255, 255, 255);
    pdf.setLineWidth(0.3);
    pdf.line(m, H - 115, W - m, H - 115);

    pdf.setTextColor(210, 218, 230);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(settings.businessName || "Oasis Air Cleaner Services LLC", m, H - 85);
    pdf.setFont("helvetica", "normal");
    pdf.text(`${settings.businessPhone || ""} ${settings.businessEmail || ""}`, m, H - 70);
    pdf.text(settings.businessAddress || "", m, H - 55);

    const fileName = `Oasis-Visit-Card-${cleanFileName(v.clientName || "cliente")}.pdf`;
    const blob = pdf.output("blob");
    const file = new File([blob], fileName, { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: "Oasis Visit Card",
        text: "Resumen de servicio",
        files: [file]
      });
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    console.error(err);
    alert("No se pudo generar el PDF real: " + err.message);
  }
}

function drawPdfBox(pdf, x, y, w, h, title, lines){
  pdf.setDrawColor(120, 145, 180);
  pdf.setFillColor(22, 38, 64);
  pdf.roundedRect(x, y, w, h, 14, 14, "FD");

  pdf.setTextColor(216, 180, 90);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(title, x + 14, y + 25);

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(10);
  let yy = y + 48;
  lines.forEach(line => {
    const wrapped = pdf.splitTextToSize(String(line || "—"), w - 28);
    pdf.text(wrapped.slice(0, 2), x + 14, yy);
    yy += wrapped.length > 1 ? 24 : 18;
  });
}

function hexToRgb(hex){
  const clean = String(hex || "#ffffff").replace("#", "");
  const num = parseInt(clean, 16);
  return { r:(num >> 16) & 255, g:(num >> 8) & 255, b:num & 255 };
}

function cleanFileName(str){
  return String(str || "archivo").replace(/[^\w\-]+/g, "_").slice(0, 50);
}


/* ===== EQUIPMENT LIFE REPORT OVERRIDES ===== */
function equipmentKey(v){
  const area = String(v.equipmentLocation || "").trim().toLowerCase();
  const brand = String(v.brand || "").trim().toLowerCase();
  const model = String(v.model || "").trim().toLowerCase();
  const btu = String(v.btu || "").trim().toLowerCase();
  if (area) return `area:${area}`;
  return `eq:${brand}|${model}|${btu || "na"}`;
}
function equipmentTitle(v){
  return v.equipmentLocation || [v.brand, v.btu].filter(Boolean).join(" ") || "Equipo sin área";
}
function lifeDiagnosis(score, visitCount){
  score = Number(score || 0);
  if (score >= 88 && visitCount >= 2) return { label:"Vida estable", tone:"ok", advice:"Mantener ciclo preventivo." };
  if (score >= 78) return { label:"Buen estado", tone:"ok", advice:"Seguimiento normal recomendado." };
  if (score >= 62) return { label:"Atención preventiva", tone:"warn", advice:"Conviene reducir el intervalo de mantenimiento." };
  return { label:"Riesgo operativo", tone:"danger", advice:"Requiere evaluación técnica prioritaria." };
}
function groupByClient(visits){
  const map = new Map();
  visits.forEach(v => {
    const key = clientKey(v);
    if (!key || key === "name:|addr:") return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  });
  return Array.from(map.entries()).map(([key, items]) => ({key, items, latest:items[0]}));
}
function groupEquipments(visits){
  const map = new Map();
  visits.forEach(v => {
    const key = equipmentKey(v);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  });
  return Array.from(map.entries()).map(([key, items]) => {
    const latest = items[0];
    const avg = Math.round(items.reduce((s,v)=>s+Number(v.healthScore||0),0)/items.length);
    const dx = lifeDiagnosis(avg, items.length);
    return { key, items, latest, avg, dx };
  }).sort((a,b) => String(equipmentTitle(a.latest)).localeCompare(String(equipmentTitle(b.latest))));
}
function renderClients(visits){
  const groups = groupByClient(visits).sort((a,b)=>String(a.latest.clientName||"").localeCompare(String(b.latest.clientName||"")));
  const list = $("clientList");
  list.innerHTML = "";
  if (!groups.length) {
    list.innerHTML = `<div class="visit-card"><h3>Sin clientes</h3><p>Los clientes aparecerán aquí automáticamente.</p></div>`;
    return;
  }
  groups.forEach(group => {
    const items = group.items;
    const latest = group.latest;
    const eqGroups = groupEquipments(items);
    const avg = Math.round(items.reduce((s,v)=>s+Number(v.healthScore||0),0)/items.length);
    const status = statusFromScore(avg);
    const card = document.createElement("article");
    card.className = "client-life-card";
    card.innerHTML = `
      <div class="client-life-head">
        <div>
          <span>Expediente</span>
          <h3>${cleanText(latest.clientName || "Cliente")}</h3>
          <p>${cleanText(latest.clientPhone || "")}</p>
          <p>${cleanText(latest.clientAddress || "")}</p>
        </div>
        <div class="life-score ${status.cls}">
          <strong>${avg}</strong><small>Health</small>
        </div>
      </div>
      <div class="equipment-grid">
        ${eqGroups.map(eq => `
          <div class="equipment-card ${eq.dx.tone}">
            <div class="equipment-top">
              <h4>${cleanText(equipmentTitle(eq.latest))}</h4>
              <strong>${eq.avg}/100</strong>
            </div>
            <p>${cleanText([eq.latest.brand, eq.latest.model, eq.latest.btu].filter(Boolean).join(" · "))}</p>
            <span>${eq.dx.label}</span>
            <small>${eq.items.length} visita(s) · Próxima: ${cleanText(eq.latest.nextVisit || "Por coordinar")}</small>
          </div>
        `).join("")}
      </div>
      <div class="card-actions">
        <button type="button" class="small-btn" data-client-action="history" data-key="${cleanText(group.key)}">Ver diagnóstico</button>
        <button type="button" class="small-btn" data-client-action="pdf-history" data-key="${cleanText(group.key)}">PDF vida equipos</button>
      </div>`;
    list.appendChild(card);
  });
}
function openClientHistory(visits){
  const latest = visits[0], eqGroups = groupEquipments(visits);
  const avg = Math.round(visits.reduce((s,v)=>s+Number(v.healthScore||0),0)/visits.length);
  const status = statusFromScore(avg);
  $("detailContent").innerHTML = `
    <h2>Diagnóstico de vida por equipo</h2>
    <p class="muted">${cleanText(latest.clientName || "Cliente")} · ${cleanText(latest.clientAddress || "")}</p>
    <span class="badge ${status.cls}">${avg} · Estado general</span>
    <div class="equipment-grid detail-equipment-grid">
      ${eqGroups.map(eq => `
        <div class="equipment-card ${eq.dx.tone}">
          <div class="equipment-top">
            <h4>${cleanText(equipmentTitle(eq.latest))}</h4>
            <strong>${eq.avg}/100</strong>
          </div>
          <p>${cleanText([eq.latest.brand, eq.latest.model, eq.latest.btu].filter(Boolean).join(" · "))}</p>
          <span>${eq.dx.label}</span>
          <small>${eq.dx.advice}</small>
        </div>`).join("")}
    </div>
    <h3>Historial técnico</h3>
    <div class="history-timeline">
      ${visits.map(v => {
        const s = statusFromScore(v.healthScore);
        return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-card">
          <h4>${cleanText(equipmentTitle(v))} · ${cleanText(v.createdAtText || "Sin fecha")}</h4>
          <p>${cleanText(v.serviceType || "Servicio")} · Health ${Number(v.healthScore || 0)}/100 · ${s.label}</p>
          <p>${cleanText([v.brand, v.model, v.btu].filter(Boolean).join(" · "))}</p>
          <p>Próxima visita: ${cleanText(v.nextVisit || "Por coordinar")}</p>
          ${v.notes ? `<p><b>Obs:</b> ${cleanText(v.notes)}</p>` : ""}
          ${v.recommendations ? `<p><b>Rec:</b> ${cleanText(v.recommendations)}</p>` : ""}
        </div></div>`;
      }).join("")}
    </div>`;
  $("detailDialog").showModal();
}
async function generateClientHistoryPDF(visits){
  if (!visits || !visits.length) return;
  try {
    const latest = visits[0], eqGroups = groupEquipments(visits);
    const avg = Math.round(visits.reduce((s,v)=>s+Number(v.healthScore||0),0)/visits.length);
    const status = statusFromScore(avg);
    const pdf = new jsPDF({ orientation:"portrait", unit:"pt", format:"letter" });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), m = 42;
    function pageBase(title){
      pdf.setFillColor(247,249,252); pdf.rect(0,0,W,H,"F");
      pdf.setFillColor(5,9,18); pdf.roundedRect(24,24,W-48,H-48,26,26,"F");
      pdf.setFillColor(12,24,45); pdf.roundedRect(m-6,m-6,W-(m*2)+12,H-(m*2)+12,20,20,"F");
      pdf.setTextColor(216,180,90); pdf.setFont("helvetica","bold"); pdf.setFontSize(9);
      pdf.text((settings.businessName || "Oasis Air Cleaner Services LLC").toUpperCase(), m, 58);
      pdf.setTextColor(255,255,255); pdf.setFontSize(25); pdf.text(title, m, 88);
      pdf.setTextColor(210,218,230); pdf.setFontSize(10); pdf.text("Diagnóstico de estado de vida por equipo", m, 108);
    }
    pageBase("Expediente de Equipos");
    let y = 140;
    drawPdfBox(pdf, m, y, 250, 116, "CLIENTE", [latest.clientName || "—", latest.clientPhone || "—", latest.clientAddress || "—"]);
    drawPdfBox(pdf, m+270, y, 250, 116, "RESUMEN", [`${eqGroups.length} equipo(s) identificado(s)`, `${visits.length} visita(s) registradas`, `Health general: ${avg}/100`, `Estado: ${status.label}`]);
    y += 145;
    const c = hexToRgb(status.color);
    pdf.setFillColor(c.r,c.g,c.b); pdf.roundedRect(m,y,W-(m*2),58,16,16,"F");
    pdf.setTextColor(5,7,11); pdf.setFont("helvetica","bold"); pdf.setFontSize(11);
    pdf.text("ESTADO GENERAL DE LA RESIDENCIA / LUGAR", m+20, y+35);
    pdf.setFontSize(28); pdf.text(`${avg}/100`, W-155, y+38);
    y += 88;
    pdf.setTextColor(216,180,90); pdf.setFont("helvetica","bold"); pdf.setFontSize(11);
    pdf.text("ESTADO DE VIDA POR EQUIPO", m, y); y += 20;
    for (const eq of eqGroups) {
      if (y > H - 160) { pdf.addPage(); pageBase("Expediente de Equipos"); y = 140; }
      const tone = statusFromScore(eq.avg), cc = hexToRgb(tone.color);
      pdf.setDrawColor(90,115,150); pdf.setFillColor(22,38,64); pdf.roundedRect(m, y, W-(m*2), 102, 16, 16, "FD");
      pdf.setFillColor(cc.r,cc.g,cc.b); pdf.roundedRect(W-128, y+18, 70, 36, 12, 12, "F");
      pdf.setTextColor(5,7,11); pdf.setFont("helvetica","bold"); pdf.setFontSize(14); pdf.text(`${eq.avg}`, W-104, y+42);
      pdf.setTextColor(255,255,255); pdf.setFontSize(13); pdf.text(equipmentTitle(eq.latest), m+18, y+28);
      pdf.setTextColor(210,218,230); pdf.setFontSize(10);
      pdf.text(wrap(pdf, [eq.latest.brand, eq.latest.model, eq.latest.btu].filter(Boolean).join(" · ") || "Equipo sin datos completos", W-210), m+18, y+48);
      pdf.text(`${eq.dx.label} · ${eq.items.length} visita(s) · Próxima: ${eq.latest.nextVisit || "Por coordinar"}`, m+18, y+70);
      pdf.text(wrap(pdf, eq.dx.advice, W-160), m+18, y+88);
      y += 116;
    }
    const fileName = `Oasis-Expediente-Equipos-${cleanFileName(latest.clientName || "cliente")}.pdf`;
    const blob = pdf.output("blob");
    const file = new File([blob], fileName, { type:"application/pdf" });
    if (navigator.canShare && navigator.canShare({ files:[file] })) {
      await navigator.share({ title:"Expediente de Equipos", text:"Diagnóstico de vida por equipo", files:[file] });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  } catch (err) {
    console.error(err);
    alert("No se pudo generar el expediente de equipos: " + err.message);
  }
}
