import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc,
  updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
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

let user = null;
let clients = [];
let equipment = [];
let diagnostics = [];
let settings = {
  businessName:"Oasis Air Cleaner Services LLC",
  businessPhone:"787-664-3079",
  businessEmail:"",
  businessAddress:"",
  logoUrl:""
};

const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[<>&"']/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#039;'}[s]));
const todayPR = () => new Date().toLocaleDateString("es-PR");
const cleanFileName = v => String(v || "archivo").replace(/[^\w\-]+/g,"_").slice(0,50);

$("loginBtn").onclick = () => signInWithPopup(auth, provider).catch(e => alert(e.message));
$("logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async u => {
  user = u;
  $("authScreen").classList.toggle("hidden", !!u);
  $("app").classList.toggle("hidden", !u);
  if (u) await boot();
});

async function boot(){
  await loadSettings();
  setupTabs();
  setupNextVisit();
  await loadAll();
  bindUI();
}

function setupTabs(){
  document.querySelectorAll(".tab").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $(btn.dataset.page).classList.add("active");
    };
  });
}

function bindUI(){
  $("newClientBtn").onclick = openClientDialog;
  $("clientQuickBtn").onclick = openClientDialog;
  $("openClientFromDiagnostic").onclick = openClientDialog;
  $("settingsBtn").onclick = () => $("settingsDialog").showModal();
  document.querySelectorAll(".close-dialog").forEach(b => b.onclick = () => $("clientDialog").close());
  document.querySelectorAll(".close-settings").forEach(b => b.onclick = () => $("settingsDialog").close());
  document.querySelectorAll(".close-detail").forEach(b => b.onclick = () => $("detailDialog").close());
  $("cancelEditBtn").onclick = clearDiagnosticForm;
}

async function loadAll(){
  clients = await getCol("clients");
  equipment = await getCol("equipment");
  diagnostics = await getCol("diagnostics");
  renderAll();
}

async function getCol(name){
  const snap = await getDocs(collection(db,"users",user.uid,name));
  return snap.docs.map(d => ({id:d.id,...d.data()}));
}

async function loadSettings(){
  const snap = await getDoc(doc(db,"users",user.uid,"settings","main"));
  if (snap.exists()) settings = {...settings,...snap.data()};
  const f = $("settingsForm");
  f.businessName.value = settings.businessName || "";
  f.businessPhone.value = settings.businessPhone || "";
  f.businessEmail.value = settings.businessEmail || "";
  f.businessAddress.value = settings.businessAddress || "";
}

$("settingsForm").onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  let logoUrl = settings.logoUrl || "";
  if ($("logoFile").files[0]) {
    const r = ref(storage,`users/${user.uid}/settings/logo_${Date.now()}`);
    await uploadBytes(r,$("logoFile").files[0]);
    logoUrl = await getDownloadURL(r);
  }
  settings = {
    businessName:f.businessName.value,
    businessPhone:f.businessPhone.value,
    businessEmail:f.businessEmail.value,
    businessAddress:f.businessAddress.value,
    logoUrl
  };
  await setDoc(doc(db,"users",user.uid,"settings","main"),settings,{merge:true});
  $("settingsDialog").close();
};

function renderAll(){
  renderSelects();
  renderKpis();
  renderDashboard();
  renderClients();
  renderEquipment();
}

function clientDiagnostics(clientId){ return diagnostics.filter(d => d.clientId === clientId); }
function clientEquipment(clientId){ return equipment.filter(e => e.clientId === clientId); }
function equipmentDiagnostics(equipmentId){ return diagnostics.filter(d => d.equipmentId === equipmentId); }

function avgHealth(items){
  const scores = items.map(x => Number(x.healthScore || 0)).filter(x => x > 0);
  return scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;
}

function status(score){
  score = Number(score || 0);
  if (score >= 82) return {label:"Excelente", cls:"ok", color:[69,220,131]};
  if (score >= 62) return {label:"Atención preventiva", cls:"warn", color:[255,211,90]};
  return {label:"Riesgo operativo", cls:"danger", color:[255,93,115]};
}

function life(score, count=1){
  if (score >= 88 && count >= 2) return "Vida estable";
  if (score >= 78) return "Buen estado";
  if (score >= 62) return "Atención preventiva";
  return "Riesgo operativo";
}

function renderKpis(){
  $("kpiClients").textContent = clients.length;
  $("kpiEquipment").textContent = equipment.length;
  $("kpiHealth").textContent = diagnostics.length ? avgHealth(diagnostics) : "—";
}

function renderDashboard(){
  const grid = $("dashboardGrid");
  grid.innerHTML = "";
  if (!clients.length) {
    grid.innerHTML = `<article class="client-card"><h3>Sin expedientes</h3><p>Crea un cliente y registra el primer equipo.</p></article>`;
    return;
  }
  clients.slice(0,6).forEach(c => grid.appendChild(clientCard(c)));
}

function renderClients(){
  const q = ($("clientSearch").value || "").toLowerCase();
  const list = $("clientList");
  list.innerHTML = "";
  clients
    .filter(c => JSON.stringify(c).toLowerCase().includes(q))
    .forEach(c => list.appendChild(clientCard(c)));
}
$("clientSearch").oninput = renderClients;

function clientCard(c){
  const ds = clientDiagnostics(c.id);
  const eqs = clientEquipment(c.id);
  const avg = avgHealth(ds);
  const st = status(avg);
  const article = document.createElement("article");
  article.className = "client-card";
  article.innerHTML = `
    <div class="client-head">
      <div>
        <span class="brand-kicker">Expediente</span>
        <h3>${esc(c.name || "Cliente")}</h3>
        <p>${esc(c.phone || "")}</p>
        <p>${esc(c.address || "")}</p>
      </div>
      <div class="score-badge ${st.cls}">
        <strong>${avg || "—"}</strong>
        <small>Health</small>
      </div>
    </div>
    <div class="equipment-mini-grid">
      ${eqs.length ? eqs.map(e => equipmentMini(e)).join("") : `<div class="equipment-mini"><h4>Sin equipos</h4><p>Añade el primer diagnóstico.</p></div>`}
    </div>
    <div class="card-actions">
      <button class="small-btn" data-action="view-client" data-id="${c.id}">Expediente</button>
      <button class="small-btn" data-action="diagnose-client" data-id="${c.id}">Diagnóstico</button>
      <button class="small-btn" data-action="pdf-client" data-id="${c.id}">PDF Técnico</button>
      <button class="small-btn" data-action="edit-client" data-id="${c.id}">Editar</button>
      <button class="danger-btn" data-action="delete-client" data-id="${c.id}">Borrar</button>
    </div>
  `;
  article.onclick = handleCardAction;
  return article;
}

function equipmentMini(e){
  const ds = equipmentDiagnostics(e.id);
  const avg = avgHealth(ds) || Number(e.healthScore || 0);
  const st = status(avg);
  return `
    <div class="equipment-mini">
      <div class="equipment-mini-top">
        <h4>${esc(e.area || "Equipo")}</h4>
        <strong class="${st.cls}">${avg || "—"}</strong>
      </div>
      <p>${esc([e.brand,e.model,e.btu].filter(Boolean).join(" · "))}</p>
      <span class="life-pill ${st.cls}">${life(avg,ds.length)}</span>
    </div>`;
}

function renderEquipment(){
  const board = $("equipmentBoard");
  board.innerHTML = "";
  if (!equipment.length) {
    board.innerHTML = `<article class="equipment-card"><h3>Sin equipos</h3><p>Los equipos se crean desde Diagnóstico.</p></article>`;
    return;
  }
  equipment.forEach(e => {
    const c = clients.find(x => x.id === e.clientId) || {};
    const ds = equipmentDiagnostics(e.id);
    const avg = avgHealth(ds) || Number(e.healthScore || 0);
    const st = status(avg);
    const card = document.createElement("article");
    card.className = "equipment-card";
    card.innerHTML = `
      <span class="brand-kicker">${esc(c.name || "Cliente")}</span>
      <h3>${esc(e.area || "Equipo")}</h3>
      <p>${esc([e.brand,e.model,e.btu].filter(Boolean).join(" · "))}</p>
      <div class="score-badge ${st.cls}"><strong>${avg || "—"}</strong><small>${st.label}</small></div>
      <p>Próxima visita: ${esc(e.nextVisit || "Por coordinar")}</p>
      <div class="card-actions">
        <button class="small-btn" data-action="diagnose-equipment" data-id="${e.id}">Diagnosticar</button>
        <button class="small-btn" data-action="view-equipment" data-id="${e.id}">Historial</button>
      </div>`;
    card.onclick = handleCardAction;
    board.appendChild(card);
  });
}

function renderSelects(){
  $("clientSelect").innerHTML = `<option value="">Selecciona cliente</option>` + clients.map(c => `<option value="${c.id}">${esc(c.name)} · ${esc(c.phone||"")}</option>`).join("");
  fillEquipmentSelect();
}
$("clientSelect").onchange = fillEquipmentSelect;

function fillEquipmentSelect(){
  const clientId = $("clientSelect").value;
  const eqs = equipment.filter(e => !clientId || e.clientId === clientId);
  $("equipmentSelect").innerHTML = `<option value="">Nuevo equipo / seleccionar equipo</option>` + eqs.map(e => `<option value="${e.id}">${esc(e.area)} · ${esc(e.brand||"")} ${esc(e.btu||"")}</option>`).join("");
}

$("equipmentSelect").onchange = () => {
  const e = equipment.find(x => x.id === $("equipmentSelect").value);
  if (!e) return;
  const f = $("diagnosticForm");
  f.area.value = e.area || "";
  f.brand.value = e.brand || "";
  f.model.value = e.model || "";
  f.btu.value = e.btu || "";
  f.internalId.value = e.internalId || "";
};

function openClientDialog(c=null){
  const f = $("clientForm");
  f.clientId.value = c?.id || "";
  f.name.value = c?.name || "";
  f.phone.value = c?.phone || "";
  f.address.value = c?.address || "";
  $("clientDialog").showModal();
}

$("clientForm").onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const data = {name:f.name.value,phone:f.phone.value,address:f.address.value,updatedAt:serverTimestamp()};
  if (f.clientId.value) await updateDoc(doc(db,"users",user.uid,"clients",f.clientId.value),data);
  else await addDoc(collection(db,"users",user.uid,"clients"),{...data,createdAt:serverTimestamp()});
  $("clientDialog").close();
  await loadAll();
};

function setupNextVisit(){
  const interval = $("visitInterval");
  const next = $("nextVisit");
  const apply = () => {
    if (interval.value === "custom") return;
    const d = new Date();
    d.setMonth(d.getMonth()+Number(interval.value || 6));
    next.value = d.toISOString().slice(0,10);
  };
  interval.onchange = apply;
  apply();
  ["cooling","pressure","drain","evaporator","condenser"].forEach(n => {
    $("diagnosticForm").elements[n].oninput = updateScore;
  });
}

function updateScore(){ $("scorePreview").textContent = scoreFromForm(); }
function scoreFromForm(){
  const f = $("diagnosticForm");
  const names = ["cooling","pressure","drain","evaporator","condenser"];
  return Math.round(names.reduce((s,n)=>s+Number(f[n].value||0),0)/names.length);
}

async function uploadFiles(files,folder){
  const urls = [];
  for (const file of Array.from(files||[])) {
    const r = ref(storage,`users/${user.uid}/${folder}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g,"_")}`);
    await uploadBytes(r,file);
    urls.push(await getDownloadURL(r));
  }
  return urls;
}

$("diagnosticForm").onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  if (!f.clientId.value) return alert("Selecciona o crea un cliente.");

  let equipmentId = f.equipmentId.value;
  const healthScore = scoreFromForm();
  const eqData = {
    clientId:f.clientId.value,
    area:f.area.value || "Equipo",
    brand:f.brand.value,
    model:f.model.value,
    btu:f.btu.value,
    internalId:f.internalId.value,
    healthScore,
    nextVisit:f.nextVisit.value,
    updatedAt:serverTimestamp()
  };

  if (equipmentId) {
    await updateDoc(doc(db,"users",user.uid,"equipment",equipmentId),eqData);
  } else {
    const eqRef = await addDoc(collection(db,"users",user.uid,"equipment"),{...eqData,createdAt:serverTimestamp()});
    equipmentId = eqRef.id;
  }

  const beforeUrls = await uploadFiles($("beforePhotos").files,"before");
  const afterUrls = await uploadFiles($("afterPhotos").files,"after");

  const diag = {
    clientId:f.clientId.value,
    equipmentId,
    serviceType:f.serviceType.value,
    technician:f.technician.value,
    visitInterval:f.visitInterval.value,
    visitIntervalLabel:f.visitInterval.selectedOptions[0].textContent,
    nextVisit:f.nextVisit.value,
    nextVisitReason:f.nextVisitReason.value,
    healthScore,
    metrics:{
      cooling:Number(f.cooling.value),pressure:Number(f.pressure.value),drain:Number(f.drain.value),
      evaporator:Number(f.evaporator.value),condenser:Number(f.condenser.value)
    },
    notes:f.notes.value,
    recommendations:f.recommendations.value,
    beforeUrls,afterUrls,
    createdAtText:todayPR(),
    createdAt:serverTimestamp()
  };

  if ($("editingDiagnosticId").value) await updateDoc(doc(db,"users",user.uid,"diagnostics",$("editingDiagnosticId").value),diag);
  else await addDoc(collection(db,"users",user.uid,"diagnostics"),diag);

  clearDiagnosticForm();
  await loadAll();
  document.querySelector('[data-page="dashboardPage"]').click();
};

function clearDiagnosticForm(){
  $("diagnosticForm").reset();
  $("editingDiagnosticId").value = "";
  $("saveDiagnosticBtn").textContent = "Guardar diagnóstico";
  $("cancelEditBtn").classList.add("hidden");
  $("visitInterval").value = "6";
  setupNextVisit();
  updateScore();
}

async function handleCardAction(e){
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  e.stopPropagation();
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === "edit-client") openClientDialog(clients.find(c=>c.id===id));
  if (action === "delete-client") await deleteClient(id);
  if (action === "diagnose-client") startDiagnosticForClient(id);
  if (action === "diagnose-equipment") startDiagnosticForEquipment(id);
  if (action === "view-client") openClientDetail(id);
  if (action === "view-equipment") openEquipmentDetail(id);
  if (action === "pdf-client") await generateClientPDF(id);
}

async function deleteClient(id){
  if (!confirm("¿Borrar cliente? Esto no borra archivos de Storage, pero elimina el expediente visible.")) return;
  await deleteDoc(doc(db,"users",user.uid,"clients",id));
  await loadAll();
}

function startDiagnosticForClient(id){
  document.querySelector('[data-page="diagnosticPage"]').click();
  $("clientSelect").value = id;
  fillEquipmentSelect();
}

function startDiagnosticForEquipment(id){
  const e = equipment.find(x=>x.id===id);
  if (!e) return;
  document.querySelector('[data-page="diagnosticPage"]').click();
  $("clientSelect").value = e.clientId;
  fillEquipmentSelect();
  $("equipmentSelect").value = id;
  $("equipmentSelect").onchange();
}

function openClientDetail(id){
  const c = clients.find(x=>x.id===id);
  const eqs = clientEquipment(id);
  const ds = clientDiagnostics(id);
  const avg = avgHealth(ds);
  $("detailContent").innerHTML = `
    <h2>${esc(c.name)}</h2>
    <p>${esc(c.phone||"")} · ${esc(c.address||"")}</p>
    <div class="detail-grid">
      <div class="detail-box"><h3>Health general</h3><p>${avg || "—"}/100</p></div>
      <div class="detail-box"><h3>Equipos</h3><p>${eqs.length}</p></div>
      <div class="detail-box"><h3>Visitas</h3><p>${ds.length}</p></div>
    </div>
    <h3>Equipos</h3>
    ${eqs.map(e=>equipmentMini(e)).join("")}
    <h3>Historial</h3>
    <div class="timeline">${ds.map(d=>timelineItem(d)).join("")}</div>`;
  $("detailDialog").showModal();
}

function openEquipmentDetail(id){
  const e = equipment.find(x=>x.id===id);
  const ds = equipmentDiagnostics(id);
  $("detailContent").innerHTML = `
    <h2>${esc(e.area || "Equipo")}</h2>
    <p>${esc([e.brand,e.model,e.btu].filter(Boolean).join(" · "))}</p>
    <div class="timeline">${ds.map(d=>timelineItem(d)).join("")}</div>`;
  $("detailDialog").showModal();
}

function timelineItem(d){
  const st = status(d.healthScore);
  return `<div class="timeline-item">
    <strong>${esc(d.createdAtText || "")} · ${esc(d.serviceType || "")}</strong>
    <p class="${st.cls}">Health ${Number(d.healthScore||0)}/100 · ${st.label}</p>
    <p>Próxima: ${esc(d.nextVisit || "Por coordinar")}</p>
    <p>${esc(d.notes || "")}</p>
  </div>`;
}

async function generateClientPDF(id){
  const c = clients.find(x=>x.id===id);
  const eqs = clientEquipment(id);
  const ds = clientDiagnostics(id);
  const avg = avgHealth(ds);
  const st = status(avg);

  const pdf = new jsPDF({unit:"pt",format:"letter"});
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const m = 42;

  function bg(title){
    pdf.setFillColor(245,247,251); pdf.rect(0,0,W,H,"F");
    pdf.setFillColor(5,9,18); pdf.roundedRect(24,24,W-48,H-48,26,26,"F");
    pdf.setFillColor(12,24,45); pdf.roundedRect(m-6,m-6,W-(m*2)+12,H-(m*2)+12,20,20,"F");
    pdf.setTextColor(216,180,90); pdf.setFont("helvetica","bold"); pdf.setFontSize(9);
    pdf.text((settings.businessName||"Oasis Air Cleaner Services LLC").toUpperCase(),m,58);
    pdf.setTextColor(255,255,255); pdf.setFontSize(28); pdf.text(title,m,92);
  }

  bg("Expediente Técnico HVAC");
  let y = 130;
  pdf.setTextColor(255,255,255); pdf.setFontSize(18); pdf.text(c.name || "Cliente",m,y);
  pdf.setTextColor(210,218,230); pdf.setFontSize(10); pdf.text(`${c.phone||""} · ${c.address||""}`,m,y+18);

  pdf.setFillColor(...st.color); pdf.roundedRect(m,y+42,W-(m*2),60,16,16,"F");
  pdf.setTextColor(5,7,11); pdf.setFont("helvetica","bold"); pdf.setFontSize(12); pdf.text("HEALTH GENERAL",m+20,y+78);
  pdf.setFontSize(30); pdf.text(`${avg || "—"}/100`,W-165,y+82);

  y += 135;
  pdf.setTextColor(216,180,90); pdf.setFontSize(11); pdf.text("ESTADO DE VIDA POR EQUIPO",m,y); y+=24;

  eqs.forEach(e=>{
    const eds = equipmentDiagnostics(e.id);
    const eh = avgHealth(eds) || e.healthScore || 0;
    const es = status(eh);
    if (y > H-150){pdf.addPage();bg("Equipos");y=130;}
    pdf.setFillColor(22,38,64); pdf.roundedRect(m,y,W-(m*2),82,14,14,"F");
    pdf.setTextColor(255,255,255); pdf.setFontSize(13); pdf.text(e.area||"Equipo",m+16,y+25);
    pdf.setTextColor(210,218,230); pdf.setFontSize(10); pdf.text(`${e.brand||""} ${e.model||""} ${e.btu||""}`,m+16,y+44);
    pdf.setTextColor(...es.color); pdf.setFontSize(16); pdf.text(`${eh}/100`,W-105,y+35);
    pdf.setTextColor(210,218,230); pdf.setFontSize(9); pdf.text(`Próxima: ${e.nextVisit || "Por coordinar"}`,m+16,y+64);
    y += 96;
  });

  pdf.addPage(); bg("Historial Técnico"); y=130;
  ds.forEach(d=>{
    if (y > H-125){pdf.addPage();bg("Historial Técnico");y=130;}
    const e = equipment.find(x=>x.id===d.equipmentId) || {};
    pdf.setFillColor(22,38,64); pdf.roundedRect(m,y,W-(m*2),78,14,14,"F");
    pdf.setTextColor(216,180,90); pdf.setFontSize(10); pdf.text(`${d.createdAtText||""} · ${e.area||"Equipo"}`,m+16,y+22);
    pdf.setTextColor(245,247,251); pdf.text(`${d.serviceType||""} · Health ${d.healthScore||0}/100`,m+16,y+42);
    pdf.setTextColor(210,218,230); pdf.setFontSize(8.5); pdf.text(pdf.splitTextToSize(d.notes||"",W-(m*2)-32).slice(0,2),m+16,y+60);
    y += 92;
  });

  const blob = pdf.output("blob");
  const file = new File([blob],`Oasis-Expediente-${cleanFileName(c.name)}.pdf`,{type:"application/pdf"});
  if (navigator.canShare && navigator.canShare({files:[file]})){
    await navigator.share({title:"Expediente HVAC",text:"Expediente técnico HVAC",files:[file]});
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = file.name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
