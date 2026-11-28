import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, deleteField, query, orderBy, onSnapshot, serverTimestamp, increment, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBDp8u-KbrKGXTHCNMKAtb_L9GOiSur31g",
  authDomain: "agenda-magnus.firebaseapp.com",
  projectId: "agenda-magnus",
  storageBucket: "agenda-magnus.firebasestorage.app",
  messagingSenderId: "458471195421",
  appId: "1:458471195421:web:588b0569d8bd9f862f57f4",
  measurementId: "G-D797QZR31L"
};

const ADMIN_UIDS = new Set([
  "xCWYveQCqXfqQoZOixN7levgXOm1"
]);
const ADMIN_EMAILS = new Set([
  "magnus.dev.2000@gmail.com",
  "magnusdev.2000@gmail.com"
]);

javascript:(()=>{const url=location.href;const txt=document.body.innerText||"";const title=(document.querySelector("h1")?.innerText||document.title||"").replace(/\s*\|\s*OLX.*/i,"").trim();const phoneMatch=txt.match(/(?:\+?55\s*)?\(?0?[1-9]{2}\)?\s*9?\d{4}[-\s]?\d{4}/);const phone=phoneMatch?phoneMatch[0].trim():"";const locMatch=txt.match(/([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*)\s*[-–/]\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*)\s*,?\s*([A-Z]{2})\b/);const payload={canal:"OLX",linkOrigem:url,nome:title,telefone:phone,bairro:locMatch?locMatch[1]:"",cidade:locMatch?locMatch[2]:"",estado:locMatch?locMatch[3]:""};try{localStorage.setItem("magnus_olx_draft",JSON.stringify(payload));}catch(e){}navigator.clipboard?.writeText(JSON.stringify(payload,null,2)).catch(()=>{});alert("Capturado da OLX!\n\nNome/Título: "+(payload.nome||"-")+"\nTelefone (texto): "+(payload.telefone||"Não visível no texto (ver imagem)")+"\nLocal: "+[payload.bairro,payload.cidade,payload.estado].filter(Boolean).join(" / ")+"\n\nDados salvos e copiados. Abrindo o CRM...");window.open("https://jhordanmagno.github.io/pages/crm.html?olxDraft=1","_blank");})();

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "agendamagnus-db");

let currentUser = null;
let currentProfile = null;
let allCompanyLeads = [];
let allMembers = [];
let selectedLeadIds = new Set();
let unsubLeads = null;
let unsubTeam = null;
let chartStatus = null;
let chartSecondary = null;
let slaInterval = null;
let previousConfirmedCount = null;
let celebratedChampions = new Set();

const $ = (id) => document.getElementById(id);
const fmtBRL = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const todayISO = () => new Date().toISOString().slice(0, 10);
const normTxt = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const normalizeRole = (r) => {
  const val = String(r || "SDR").trim().toUpperCase();
  if (val === "ADMIN" || val === "DIRETOR" || val === "DIRETORIA") return "ADMIN";
  if (val === "GESTOR") return "GESTOR";
  return "SDR";
};

const roleLabel = (r) => {
  const norm = normalizeRole(r);
  if (norm === "ADMIN") return "DIRETOR (ADMIN)";
  if (norm === "GESTOR") return "GESTOR";
  return "SDR";
};

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3200);
}

function launchFireworks(championName = null) {
  if (championName) {
    celebratedChampions.add(championName);
    showToast(`🎆 PARABÉNS ${championName.toUpperCase()}! Venda PIX confirmada / Bônus atingido!`);
  }
  if (typeof confetti === "function") {
    const duration = 2800;
    const end = Date.now() + duration;
    (function frame() {
      confetti({ particleCount: 6, angle: 60, spread: 65, origin: { x: 0, y: 0.7 }, colors: ["#f5c542", "#22c55e", "#38bdf8", "#ffffff"] });
      confetti({ particleCount: 6, angle: 120, spread: 65, origin: { x: 1, y: 0.7 }, colors: ["#f5c542", "#22c55e", "#38bdf8", "#ffffff"] });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }
}

function getMillis(ts) {
  if (!ts) return Date.now();
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts === "number") return ts;
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? Date.now() : parsed;
}

function formatElapsed(ms) {
  const diff = Math.max(0, Date.now() - ms);
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${String(hrs).padStart(2, "0")}h`;
  if (hrs > 0) return `${String(hrs).padStart(2, "0")}h ${String(mins).padStart(2, "0")}m`;
  return `${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
}

function getSlaClass(ms, status) {
  if (["Fechado - Ganho", "Perdido"].includes(status)) return "sla-ok";
  const hours = (Date.now() - ms) / 3600000;
  if (hours >= 24) return "sla-late";
  if (hours >= 4) return "sla-warn";
  return "sla-ok";
}

function refreshLiveTimers() {
  document.querySelectorAll("[data-sla-ms]").forEach((el) => {
    const ms = Number(el.dataset.slaMs);
    const st = el.dataset.slaStatus;
    el.textContent = `⏱ ${formatElapsed(ms)} sem ação`;
    el.className = `sla-chip ${getSlaClass(ms, st)}`;
  });
}

function calcSdrCommission(proCount, essCount) {
  let comm = 0;
  if (proCount > 0) comm += Math.min(proCount, 22) * 17;
  if (proCount > 22) comm += Math.min(proCount - 22, 22) * 20;
  if (proCount >= 44) comm += 120;
  if (proCount > 44) comm += (proCount - 44) * 23;
  if (proCount >= 100) comm += 250;
  return comm + (essCount * 10);
}

function calcManagerEarnings(teamProCount, nSdrs = 5) {
  const t1 = 22 * nSdrs;
  const t2 = 44 * nSdrs;
  const t3 = 100 * nSdrs;
  let ov = 0;
  if (teamProCount > 0) ov += Math.min(teamProCount, t1) * 5.0;
  if (teamProCount > t1) ov += Math.min(teamProCount - t1, t2 - t1) * 6.5;
  if (teamProCount > t2) ov += (teamProCount - t2) * 7.5;
  let bon = 0;
  if (teamProCount >= t1) bon += 200;
  if (teamProCount >= t2) bon += 500;
  if (teamProCount >= t3) bon += 800;
  return ov + bon;
}

function getScopedLeads() {
  const role = normalizeRole(currentProfile.role);
  if (role === "ADMIN") return allCompanyLeads;
  if (role === "GESTOR") {
    return allCompanyLeads.filter((l) => (l.squadId || "") === currentProfile.squadId);
  }
  return allCompanyLeads.filter((l) => l.sdrUid === currentUser.uid);
}

// Autenticação
$("btn-google-login").onclick = async () => {
  $("login-error").textContent = "";
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { $("login-error").textContent = "Erro no login Google: " + e.message; }
};

$("btn-email-login").onclick = async () => {
  $("login-error").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-pass").value);
  } catch (e) {
    $("login-error").textContent = "E-mail ou senha inválidos.";
  }
};

$("btn-logout").onclick = () => signOut(auth);
$("btn-test-fireworks").onclick = () => launchFireworks(currentProfile?.nome || "Campeão");

onAuthStateChanged(auth, async (user) => {
  if (unsubLeads) unsubLeads();
  if (unsubTeam) unsubTeam();
  if (slaInterval) clearInterval(slaInterval);

  if (!user) {
    $("login-view").classList.remove("hidden");
    $("app-view").classList.add("hidden");
    return;
  }

  currentUser = user;
  const emailLower = (user.email || "").trim().toLowerCase();
  const memberRef = doc(db, "crm_users", user.uid);
  const memberSnap = await getDoc(memberRef);

  let inviteData = null;
  if (emailLower) {
    const inviteRef = doc(db, "crm_users", `email_${emailLower}`);
    const inviteSnap = await getDoc(inviteRef);
    if (inviteSnap.exists()) {
      inviteData = inviteSnap.data();
      await setDoc(memberRef, {
        ...inviteData,
        email: emailLower,
        ativo: true,
        updatedAt: serverTimestamp()
      }, { merge: true });
      await deleteDoc(inviteRef);
    }
  }

  const isMasterAdmin = ADMIN_UIDS.has(user.uid) || ADMIN_EMAILS.has(emailLower);

  if (isMasterAdmin) {
    const baseData = memberSnap.exists() ? memberSnap.data() : (inviteData || {});
    currentProfile = {
      nome: baseData.nome || user.displayName || "Diretoria",
      email: emailLower,
      code: baseData.code || "DIRETOR",
      role: "ADMIN",
      squadId: baseData.squadId || "TODOS",
      ativo: true
    };
    await setDoc(memberRef, { ...currentProfile, updatedAt: serverTimestamp() }, { merge: true });
  } else if (memberSnap.exists() && memberSnap.data().ativo !== false) {
    const d = memberSnap.data();
    currentProfile = { ...d, role: normalizeRole(d.role) };
  } else if (inviteData && inviteData.ativo !== false) {
    currentProfile = { ...inviteData, role: normalizeRole(inviteData.role) };
  } else {
    $("login-error").textContent = "Acesso não autorizado. Peça à Diretoria para cadastrar seu e-mail ou UID no CRM.";
    await signOut(auth);
    return;
  }

  const role = normalizeRole(currentProfile.role);
  const isAdmin = role === "ADMIN";
  const isGestor = role === "GESTOR";
  const canManage = isAdmin || isGestor;

  $("login-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  $("role-pill").textContent = `${roleLabel(role)} • ${currentProfile.squadId || "GERAL"}`;
  $("user-subtitle").textContent = `${currentProfile.nome} (${currentProfile.code || currentUser.email}) • Tempo real`;

  $("tab-btn-team").classList.toggle("hidden", !isAdmin);
  $("btn-export-csv").classList.toggle("hidden", !isAdmin);
  $("btn-bulk-delete").classList.toggle("hidden", !isAdmin);
  $("btn-test-fireworks").classList.toggle("hidden", !canManage);
  $("bulk-assign-bar").classList.toggle("hidden", !canManage);
  $("th-select-all").classList.toggle("hidden", !canManage);
  $("filter-sdr").classList.toggle("hidden", !canManage);
  $("modal-sdr-wrap").classList.toggle("hidden", !canManage);

  slaInterval = setInterval(refreshLiveTimers, 1000);
  startListeners();
});

function startListeners() {
  const qLeads = query(collection(db, "crm_leads"), orderBy("updatedAt", "desc"));
  unsubLeads = onSnapshot(qLeads, (snap) => {
    allCompanyLeads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allCompanyLeads.sort((a, b) => getMillis(b.lastActivityAt || b.updatedAt) - getMillis(a.lastActivityAt || a.updatedAt));

    const confirmedList = allCompanyLeads.filter((l) => l.status === "Fechado - Ganho" && l.pixConfirmado === true);
    if (previousConfirmedCount !== null && confirmedList.length > previousConfirmedCount) {
      const newest = confirmedList[0];
      launchFireworks(newest?.sdrNome || newest?.sdrCode || "Equipe");
    }
    previousConfirmedCount = confirmedList.length;

    const scoped = getScopedLeads();
    $("tab-leads-count").textContent = scoped.length;
    updateFilterSuggestions(scoped);
    renderArenaAndPodium();
    renderDashboard();
    renderDeleteRequestsBanner();
    renderLeads();
  }, (err) => {
    showToast("Erro ao sincronizar leads: " + err.message);
  });

  unsubTeam = onSnapshot(collection(db, "crm_users"), (snap) => {
    allMembers = snap.docs.map((d) => ({
      uid: d.id,
      ...d.data(),
      role: normalizeRole(d.data().role)
    }));
    populateSdrSelectors();
    if (normalizeRole(currentProfile.role) === "ADMIN") renderTeam();
    renderArenaAndPodium();
    renderDashboard();
    renderLeads();
  });
}

function updateFilterSuggestions(leads) {
  const fillDatalist = (id, values) => {
    const unique = [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))].sort();
    $(id).innerHTML = unique.map((v) => `<option value="${v.replace(/"/g, "&quot;")}"></option>`).join("");
  };
  fillDatalist("list-profissoes", leads.map((l) => l.profissao));
  fillDatalist("list-estados", leads.map((l) => l.estado));
  fillDatalist("list-cidades", leads.map((l) => l.cidade));
  fillDatalist("list-bairros", leads.map((l) => l.bairro));
}

function getAssignableMembers() {
  const role = normalizeRole(currentProfile.role);
  const active = allMembers.filter((m) => m.ativo !== false && !m.uid.startsWith("email_"));
  if (role === "ADMIN") return active;
  if (role === "GESTOR") {
    return active.filter((m) => (m.squadId || "") === currentProfile.squadId);
  }
  return [];
}

function populateSdrSelectors() {
  const members = getAssignableMembers();
  const opts = members.map((m) => `<option value="${m.uid}">${m.code || m.role} — ${m.nome} (${m.squadId || "GERAL"})</option>`).join("");

  $("bulk-sdr-select").innerHTML = `<option value="">-- Escolha o SDR de destino --</option>${opts}`;
  $("ld-sdr").innerHTML = opts || `<option value="${currentUser.uid}">${currentProfile.nome}</option>`;
  $("filter-sdr").innerHTML = `<option value="ALL">Todos os SDRs</option>${opts}`;
}

function buildLeaderboardStats() {
  const map = {};
  allMembers.filter((m) => m.ativo !== false && m.role === "SDR" && !m.uid.startsWith("email_")).forEach((m) => {
    map[m.uid] = {
      uid: m.uid,
      nome: m.nome,
      code: m.code || "SDR",
      squad: m.squadId || "-",
      leads: 0,
      calls: 0,
      teste: 0,
      proOk: 0,
      essOk: 0,
      aguardPix: 0
    };
  });

  allCompanyLeads.forEach((l) => {
    const uid = l.sdrUid || l.sdrNome || "sem_sdr";
    if (!map[uid]) {
      map[uid] = {
        uid,
        nome: l.sdrNome || l.sdrCode || "SDR",
        code: l.sdrCode || "SDR",
        squad: l.squadId || "-",
        leads: 0,
        calls: 0,
        teste: 0,
        proOk: 0,
        essOk: 0,
        aguardPix: 0
      };
    }
    map[uid].leads++;
    map[uid].calls += Number(l.callCount || 0);
    if (l.status === "App Instalado / Teste") map[uid].teste++;
    if (l.status === "Fechado - Ganho") {
      if (l.pixConfirmado) {
        if (l.plano === "PRO (R$ 79,90)") map[uid].proOk++;
        if (l.plano === "Essencial (R$ 34,90)") map[uid].essOk++;
      } else {
        map[uid].aguardPix++;
      }
    }
  });

  return Object.values(map).sort((a, b) => {
    const scoreB = (b.proOk * 100) + (b.essOk * 40) + b.calls;
    const scoreA = (a.proOk * 100) + (a.essOk * 40) + a.calls;
    return scoreB - scoreA;
  });
}

function getBonusMilestone(proOk) {
  if (proOk >= 100) return { label: "👑 META 100 PRO + SUPER BÔNUS R$ 250", hit: true };
  if (proOk >= 44) return { label: "🔥 META 44 PRO + BÔNUS R$ 120", hit: true };
  if (proOk >= 22) return { label: "⚡ FAIXA 2 DESTRAVADA (R$ 20/PRO)", hit: true };
  return { label: `Faltam ${22 - proOk} PRO p/ Faixa 2`, hit: false };
}

function renderArenaAndPodium() {
  const ranking = buildLeaderboardStats();
  const totalProEmpresa = ranking.reduce((s, x) => s + x.proOk, 0);
  const totalEssEmpresa = ranking.reduce((s, x) => s + x.essOk, 0);
  const fatConfirmadoEmpresa = (totalProEmpresa * 79.90) + (totalEssEmpresa * 34.90);

  $("company-live-meter").innerHTML = `
    <div><small style="color:var(--muted); font-size:10px; display:block;">PRO CONFIRMADOS (EMPRESA)</small><strong style="color:var(--gold); font-size:18px;">${totalProEmpresa}</strong></div>
    <div><small style="color:var(--muted); font-size:10px; display:block;">ESSENCIAL CONFIRMADOS</small><strong style="color:var(--blue); font-size:18px;">${totalEssEmpresa}</strong></div>
    <div><small style="color:var(--muted); font-size:10px; display:block;">FATURAMENTO PIX VALIDADO</small><strong style="color:var(--green); font-size:18px;">${fmtBRL(fatConfirmadoEmpresa)}</strong></div>
  `;

  const p1 = ranking[0] || { nome: "Aguardando 1º", code: "-", proOk: 0, essOk: 0, calls: 0 };
  const p2 = ranking[1] || { nome: "Aguardando 2º", code: "-", proOk: 0, essOk: 0, calls: 0 };
  const p3 = ranking[2] || { nome: "Aguardando 3º", code: "-", proOk: 0, essOk: 0, calls: 0 };

  const podiumOrder = [
    { medal: "🥈 2º LUGAR", cls: "rank-2", item: p2 },
    { medal: "🥇 1º LUGAR", cls: "rank-1", item: p1 },
    { medal: "🥉 3º LUGAR", cls: "rank-3", item: p3 }
  ];

  $("podium-container").innerHTML = podiumOrder.map(({ medal, cls, item }) => {
    const milestone = getBonusMilestone(item.proOk);
    const shouldGlow = milestone.hit || celebratedChampions.has(item.nome);
    return `
      <div class="podium-card ${cls} ${shouldGlow ? "celebrate-glow" : ""}">
        <div class="podium-medal">${medal}</div>
        <div class="podium-name ${shouldGlow ? "shine-name" : ""}">${item.nome}</div>
        <div class="podium-sales">${item.proOk} PRO <span style="font-size:13px; color:var(--blue);">+ ${item.essOk} Ess.</span></div>
        <div class="podium-meta">📞 ${item.calls} chamadas • ${item.squad || "GERAL"}</div>
        <div class="bonus-badge">${milestone.label}</div>
      </div>
    `;
  }).join("");
}

function renderDashboard() {
  const scopedLeads = getScopedLeads();
  const today = todayISO();
  const role = normalizeRole(currentProfile.role);
  const isSDR = role === "SDR";
  const isGestor = role === "GESTOR";

  const total = scopedLeads.length;
  const totalCalls = scopedLeads.reduce((s, l) => s + Number(l.callCount || 0), 0);
  const emTeste = scopedLeads.filter((l) => l.status === "App Instalado / Teste").length;
  const ganhos = scopedLeads.filter((l) => l.status === "Fechado - Ganho");
  const proConfirmado = ganhos.filter((l) => l.plano === "PRO (R$ 79,90)" && l.pixConfirmado).length;
  const essConfirmado = ganhos.filter((l) => l.plano === "Essencial (R$ 34,90)" && l.pixConfirmado).length;
  const aguardandoPix = ganhos.filter((l) => !l.pixConfirmado).length;
  const followHoje = scopedLeads.filter((l) => l.proximoFollowup && l.proximoFollowup <= today && !["Fechado - Ganho", "Perdido"].includes(l.status)).length;
  const fatConfirmado = (proConfirmado * 79.90) + (essConfirmado * 34.90);

  const scopeLabel = isSDR ? "Suas ligações" : isGestor ? `Equipe ${currentProfile.squadId}` : "Toda a empresa";
  const ganhoEst = isSDR
    ? calcSdrCommission(proConfirmado, essConfirmado)
    : calcManagerEarnings(proConfirmado, 5);

  const kpis = [
    { label: "Leads no Escopo", val: total, sub: scopeLabel, cls: "" },
    { label: "Chamadas Realizadas", val: totalCalls, sub: scopeLabel, cls: "purple" },
    { label: "Em Teste no App", val: emTeste, sub: "Aguardando conversão", cls: "blue" },
    { label: "PRO Confirmados (PIX)", val: proConfirmado, sub: `${aguardandoPix} aguardando PIX`, cls: "gold" },
    { label: "Essencial Confirmados", val: essConfirmado, sub: "PIX validado", cls: "blue" },
    { label: "Follow-ups Pendentes", val: followHoje, sub: "Vencidos ou hoje", cls: followHoje > 0 ? "red" : "" },
    isSDR
      ? { label: "Sua Comissão (PIX OK)", val: fmtBRL(ganhoEst), sub: "Baseada em PIX validados", cls: "green" }
      : { label: "Faturamento Validado", val: fmtBRL(fatConfirmado), sub: scopeLabel, cls: "green" }
  ];

  if (isGestor) {
    kpis.push({ label: "Ganho Est. Gestor (M1)", val: fmtBRL(ganhoEst), sub: "Sobre PRO confirmados", cls: "gold" });
  }

  $("kpi-container").innerHTML = kpis.map((k) => `
    <div class="kpi ${k.cls}">
      <small>${k.label}</small>
      <strong>${k.val}</strong>
      <div class="kpi-sub">${k.sub}</div>
    </div>
  `).join("");

  const statuses = ["Novo Lead", "Tentativa de Contato", "Em Conversa", "Vídeo/Demo Enviado", "App Instalado / Teste", "Fechado - Ganho", "Perdido"];
  const statusCounts = statuses.map((s) => scopedLeads.filter((l) => l.status === s).length);

  if (chartStatus) chartStatus.destroy();
  chartStatus = new Chart($("chart-status"), {
    type: "bar",
    data: {
      labels: statuses,
      datasets: [{
        label: "Leads",
        data: statusCounts,
        backgroundColor: ["#64748b", "#94a3b8", "#38bdf8", "#818cf8", "#f5c542", "#22c55e", "#ef5350"],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#9eb0c9", font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: "#9eb0c9", precision: 0 }, grid: { color: "#1d2842" } }
      }
    }
  });

  const ranking = buildLeaderboardStats();
  if (chartSecondary) chartSecondary.destroy();
  chartSecondary = new Chart($("chart-secondary"), {
    type: "bar",
    data: {
      labels: ranking.map((r) => r.nome),
      datasets: [
        { label: "PRO (PIX OK)", data: ranking.map((r) => r.proOk), backgroundColor: "#f5c542", borderRadius: 6 },
        { label: "Essencial (PIX OK)", data: ranking.map((r) => r.essOk), backgroundColor: "#38bdf8", borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#dbe4f3" } } },
      scales: {
        x: { ticks: { color: "#9eb0c9" }, grid: { display: false } },
        y: { ticks: { color: "#9eb0c9", precision: 0 }, grid: { color: "#1d2842" } }
      }
    }
  });

  $("squad-ranking-tbody").innerHTML = ranking.length ? ranking.map((v, idx) => {
    const milestone = getBonusMilestone(v.proOk);
    const isMe = v.uid === currentUser.uid;
    const canSeeComm = !isSDR || isMe;
    const est = calcSdrCommission(v.proOk, v.essOk);
    const posLabel = idx === 0 ? "🥇 1º" : idx === 1 ? "🥈 2º" : idx === 2 ? "🥉 3º" : `${idx + 1}º`;
    const glow = milestone.hit || celebratedChampions.has(v.nome);

    return `
      <tr style="${isMe ? "background:rgba(245,197,66,0.06);" : ""}">
        <td><strong>${posLabel}</strong></td>
        <td><strong class="${glow ? "shine-name" : ""}">${v.nome}</strong> <span class="sub-txt">(${v.code})</span></td>
        <td><span class="badge b-muted">${v.squad}</span></td>
        <td>${v.leads}</td>
        <td><span class="badge b-purple">📞 ${v.calls}</span></td>
        <td>${v.teste}</td>
        <td><strong style="color:var(--gold); font-size:14px;">${v.proOk}</strong></td>
        <td>${v.essOk}</td>
        <td>${v.aguardPix > 0 ? `<span class="badge b-red">${v.aguardPix}</span>` : "0"}</td>
        <td><span class="badge ${milestone.hit ? "b-green" : "b-muted"}">${milestone.label}</span></td>
        <td>${canSeeComm ? `<strong style="color:var(--green);">${fmtBRL(est)}</strong>` : `<span class="sub-txt">Privado</span>`}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="11" style="text-align:center;color:var(--muted);">Nenhuma movimentação registrada ainda.</td></tr>`;
}

function renderDeleteRequestsBanner() {
  const panel = $("delete-requests-panel");
  if (normalizeRole(currentProfile.role) !== "ADMIN") {
    panel.classList.add("hidden");
    return;
  }
  const pending = allCompanyLeads.filter((l) => l.deleteRequestStatus === "PENDING");
  if (!pending.length) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  $("del-req-count").textContent = pending.length;
  $("delete-requests-list").innerHTML = pending.map((l) => `
    <div class="delete-req-item">
      <div>
        <strong>${l.nome || "Sem nome"}</strong> <span class="sub-txt">(${l.telefone || "-"} • SDR: ${l.sdrNome || "-"} • ${l.squadId || "-"})</span>
        <div class="sub-txt" style="color:#fca5a5;">
          Solicitado por <strong>${l.deleteRequestedBy || "Gestor"}</strong> • Motivo: "${l.deleteRequestReason || "Não informado"}"
        </div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-red btn-sm" data-approve-del="${l.id}">✅ Aprovar e Apagar</button>
        <button class="btn btn-outline btn-sm" data-reject-del="${l.id}">❌ Recusar Pedido</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll("[data-approve-del]").forEach((b) => {
    b.onclick = () => approveOrDeleteLead(b.dataset.approveDel, true);
  });
  document.querySelectorAll("[data-reject-del]").forEach((b) => {
    b.onclick = () => rejectDeleteRequest(b.dataset.rejectDel);
  });
}

async function approveOrDeleteLead(leadId, isApproval = false) {
  const lead = allCompanyLeads.find((x) => x.id === leadId);
  const msg = isApproval
    ? `Aprovar pedido do Gestor e APAGAR permanentemente o lead "${lead?.nome || ""}"?`
    : `Tem certeza que deseja APAGAR permanentemente o lead "${lead?.nome || ""}"? Essa ação não pode ser desfeita.`;
  if (!confirm(msg)) return;
  await deleteDoc(doc(db, "crm_leads", leadId));
  selectedLeadIds.delete(leadId);
  showToast("🗑️ Lead apagado permanentemente pela Diretoria!");
}

async function rejectDeleteRequest(leadId) {
  await updateDoc(doc(db, "crm_leads", leadId), {
    deleteRequestStatus: deleteField(),
    deleteRequestReason: deleteField(),
    deleteRequestedBy: deleteField(),
    deleteRequestedAt: deleteField(),
    updatedAt: serverTimestamp()
  });
  showToast("❌ Pedido de exclusão recusado. Lead mantido no CRM.");
}

function renderLeads() {
  const scopedLeads = getScopedLeads();
  const term = normTxt($("filter-search").value);
  const fCanal = $("filter-canal").value;
  const fProf = normTxt($("filter-profissao").value);
  const fEstado = normTxt($("filter-estado").value);
  const fCidade = normTxt($("filter-cidade").value);
  const fBairro = normTxt($("filter-bairro").value);
  const st = $("filter-status").value;
  const pl = $("filter-plan").value;
  const sdrFilter = $("filter-sdr").value;

  const role = normalizeRole(currentProfile.role);
  const isAdmin = role === "ADMIN";
  const isGestor = role === "GESTOR";
  const canManage = isAdmin || isGestor;

  const filtered = scopedLeads.filter((l) => {
    if (st === "DEL_PENDING") {
      if (l.deleteRequestStatus !== "PENDING") return false;
    } else if (st !== "ALL" && l.status !== st) {
      return false;
    }
    if (pl !== "ALL" && l.plano !== pl) return false;
    if (fCanal !== "ALL" && (l.canal || "") !== fCanal) return false;
    if (fProf && !normTxt(l.profissao).includes(fProf)) return false;
    if (fEstado && !normTxt(l.estado).includes(fEstado)) return false;
    if (fCidade && !normTxt(l.cidade).includes(fCidade)) return false;
    if (fBairro && !normTxt(l.bairro).includes(fBairro)) return false;
    if (canManage && sdrFilter !== "ALL" && l.sdrUid !== sdrFilter) return false;
    if (!term) return true;
    return [l.nome, l.sexo, l.telefone, l.email, l.profissao, l.bairro, l.cidade, l.estado, l.sdrNome, l.linkOrigem, l.canal, l.observacao]
      .filter(Boolean).map(normTxt).join(" ").includes(term);
  });

  const assignable = getAssignableMembers();

  $("leads-tbody").innerHTML = filtered.length ? filtered.map((l) => {
    const waDigits = (l.telefone || "").replace(/\D/g, "");
    const waLink = waDigits ? `https://wa.me/55${waDigits.replace(/^55/, "")}` : "#";
    const stCls = l.status === "Fechado - Ganho" ? "b-green" : l.status === "Perdido" ? "b-red" : l.status === "App Instalado / Teste" ? "b-gold" : "b-blue";
    const pixBadge = l.status === "Fechado - Ganho"
      ? (l.pixConfirmado ? `<span class="badge b-green">PIX VALIDADO</span>` : `<span class="badge b-red">Aguardando PIX</span>`)
      : "";

    const hasDelPending = l.deleteRequestStatus === "PENDING";
    const delPendingBadge = hasDelPending
      ? `<div style="margin-top:4px;"><span class="badge b-red">⏳ Exclusão Solicitada</span><div class="sub-txt" style="color:#fca5a5;">Por ${l.deleteRequestedBy || "Gestor"}: ${l.deleteRequestReason || "-"}</div></div>`
      : "";

    const slaMs = getMillis(l.lastActivityAt || l.updatedAt || l.createdAt);
    const safeLink = l.linkOrigem && /^https?:\/\//i.test(l.linkOrigem) ? l.linkOrigem : "";
    const calls = Number(l.callCount || 0);
    const cityUf = [l.cidade, l.estado].filter(Boolean).join(" / ");
    const localStr = [l.bairro, cityUf].filter(Boolean).join(" • ");
    const sexoBadge = l.sexo && l.sexo !== "Não informado"
      ? `<span class="badge ${l.sexo === "Feminino" ? "b-purple" : "b-blue"}" style="margin-left:4px;">${l.sexo}</span>`
      : "";

    const transferSelect = canManage ? `
      <select class="input" style="padding:4px 6px; font-size:11px; margin-top:5px;" data-reassign="${l.id}">
        <option value="">⇄ Mover p/ outro SDR...</option>
        ${assignable.map((m) => `<option value="${m.uid}" ${m.uid === l.sdrUid ? "disabled" : ""}>${m.code || m.role} - ${m.nome}</option>`).join("")}
      </select>
    ` : "";

    let deleteActionHtml = "";
    if (isAdmin) {
      deleteActionHtml = hasDelPending
        ? `<button class="btn btn-red btn-sm" data-del-direct="${l.id}">✅ Aprovar Exclusão</button>
           <button class="btn btn-outline btn-sm" data-del-reject="${l.id}">❌ Recusar</button>`
        : `<button class="btn btn-red btn-sm" data-del-direct="${l.id}">🗑️ Excluir</button>`;
    } else if (isGestor) {
      deleteActionHtml = hasDelPending
        ? `<span class="badge b-muted" style="align-self:center;">Aguardando Diretoria</span>`
        : `<button class="btn btn-red btn-sm" data-del-req="${l.id}">🗑️ Solicitar Exclusão</button>`;
    }

    return `
      <tr class="${hasDelPending ? "row-del-pending" : ""}">
        ${canManage ? `<td><input type="checkbox" class="lead-chk" data-id="${l.id}" ${selectedLeadIds.has(l.id) ? "checked" : ""} /></td>` : ""}
        <td>
          <strong>${l.dataContato || "-"}</strong>
          <div class="sub-txt">Follow-up: ${l.proximoFollowup || "-"}</div>
          <div class="sla-chip ${getSlaClass(slaMs, l.status)}" data-sla-ms="${slaMs}" data-sla-status="${l.status}">
            ⏱ ${formatElapsed(slaMs)} sem ação
          </div>
        </td>
        <td>
          <strong>${l.nome || "-"}</strong>${sexoBadge}
          <div class="sub-txt">${l.profissao || "-"} • <span class="badge b-muted">${l.canal || "-"}</span></div>
          ${safeLink ? `<div style="margin-top:4px;"><a href="${safeLink}" target="_blank" rel="noopener" class="btn btn-blue btn-sm">🔗 Abrir Link Origem</a></div>` : (l.linkOrigem ? `<div class="sub-txt link-truncate" title="${l.linkOrigem}">${l.linkOrigem}</div>` : "")}
        </td>
        <td>
          <div>${l.telefone || "-"}</div>
          <div class="sub-txt">${l.email || ""}</div>
          <div class="sub-txt">${localStr}</div>
        </td>
        <td>
          <span class="badge b-purple" style="font-size:12px;">📞 ${calls}</span>
          <div style="margin-top:5px;">
            <button class="btn btn-outline btn-sm" data-add-call="${l.id}">+1 Chamada</button>
          </div>
        </td>
        <td>
          <span class="badge ${stCls}">${l.status || "-"}</span>
          <div class="sub-txt">${l.plano || "Não Fechou"}</div>
          ${delPendingBadge}
        </td>
        <td style="max-width:220px;">
          ${l.motivoPerda && l.motivoPerda !== "Não se aplica" ? `<div style="color:var(--red); font-size:12px; font-weight:600;">${l.motivoPerda}</div>` : ""}
          <div class="sub-txt" style="white-space:pre-wrap;">${l.observacao || "-"}</div>
        </td>
        <td>
          <div><strong>${l.sdrNome || l.sdrCode || "-"}</strong></div>
          <div class="sub-txt">${l.squadId || "-"} ${pixBadge}</div>
          ${l.pixComprovanteRef ? `<div class="sub-txt" style="color:var(--green);">Ref PIX: ${l.pixComprovanteRef}</div>` : ""}
          ${transferSelect}
        </td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" data-edit="${l.id}">Editar</button>
            ${waDigits ? `<a class="btn btn-green btn-sm" href="${waLink}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
            ${canManage && l.status === "Fechado - Ganho" ? `<button class="btn btn-gold btn-sm" data-pix="${l.id}">${l.pixConfirmado ? "Desmarcar PIX" : "✅ Validar PIX"}</button>` : ""}
            ${deleteActionHtml}
          </div>
        </td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="${canManage ? 9 : 8}" style="text-align:center;color:var(--muted);">Nenhum lead encontrado com os filtros selecionados.</td></tr>`;

  updateSelectionUI();

  if (canManage) {
    document.querySelectorAll(".lead-chk").forEach((chk) => {
      chk.onchange = () => {
        if (chk.checked) selectedLeadIds.add(chk.dataset.id);
        else selectedLeadIds.delete(chk.dataset.id);
        updateSelectionUI();
      };
    });

    document.querySelectorAll("[data-reassign]").forEach((sel) => {
      sel.onchange = async () => {
        const targetUid = sel.value;
        if (!targetUid) return;
        const target = allMembers.find((m) => m.uid === targetUid);
        if (!target) return;
        await updateDoc(doc(db, "crm_leads", sel.dataset.reassign), {
          sdrUid: target.uid,
          sdrNome: target.nome,
          sdrCode: target.code || "SDR",
          squadId: target.squadId || currentProfile.squadId || "SQUAD-01",
          lastActivityAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        showToast(`Lead transferido para ${target.nome} (contador zerado)!`);
      };
    });

    document.querySelectorAll("[data-pix]").forEach((b) => {
      b.onclick = async () => {
        const lead = allCompanyLeads.find((x) => x.id === b.dataset.pix);
        const nextState = !lead.pixConfirmado;
        let ref = lead.pixComprovanteRef || "";
        if (nextState) {
          const inputRef = prompt("Informe o ID ou referência do comprovante PIX (opcional):", ref);
          if (inputRef === null) return;
          ref = inputRef.trim();
        }
        await updateDoc(doc(db, "crm_leads", lead.id), {
          pixConfirmado: nextState,
          pixComprovanteRef: ref,
          pixValidatedBy: currentProfile.nome,
          lastActivityAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if (nextState) launchFireworks(lead.sdrNome || lead.sdrCode || "Equipe");
        else showToast("Validação PIX removida.");
      };
    });
  }

  document.querySelectorAll("[data-add-call]").forEach((b) => {
    b.onclick = async () => {
      await updateDoc(doc(db, "crm_leads", b.dataset.addCall), {
        callCount: increment(1),
        lastActivityAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      showToast("📞 Chamada registrada e contador SLA zerado!");
    };
  });

  document.querySelectorAll("[data-edit]").forEach((b) => {
    b.onclick = () => openModal(allCompanyLeads.find((x) => x.id === b.dataset.edit));
  });

  if (isAdmin) {
    document.querySelectorAll("[data-del-direct]").forEach((b) => {
      b.onclick = () => approveOrDeleteLead(b.dataset.delDirect, false);
    });
    document.querySelectorAll("[data-del-reject]").forEach((b) => {
      b.onclick = () => rejectDeleteRequest(b.dataset.delReject);
    });
  }

  if (isGestor) {
    document.querySelectorAll("[data-del-req]").forEach((b) => {
      b.onclick = async () => {
        const lead = allCompanyLeads.find((x) => x.id === b.dataset.delReq);
        const reason = prompt(`Informe o motivo para solicitar à Diretoria a exclusão de "${lead?.nome || ""}":`);
        if (reason === null) return;
        if (!reason.trim()) return showToast("Informe um motivo válido para enviar o pedido.");
        await updateDoc(doc(db, "crm_leads", lead.id), {
          deleteRequestStatus: "PENDING",
          deleteRequestReason: reason.trim(),
          deleteRequestedBy: currentProfile.nome || currentUser.email,
          deleteRequestedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        showToast("📩 Pedido de exclusão enviado para a Diretoria!");
      };
    });
  }
}

function updateSelectionUI() {
  $("selected-count").textContent = selectedLeadIds.size;
}

$("chk-select-all").onchange = (e) => {
  document.querySelectorAll(".lead-chk").forEach((chk) => {
    chk.checked = e.target.checked;
    if (e.target.checked) selectedLeadIds.add(chk.dataset.id);
    else selectedLeadIds.delete(chk.dataset.id);
  });
  updateSelectionUI();
};

async function assignLeadBatch(ids, targetUid) {
  const role = normalizeRole(currentProfile.role);
  if (role !== "ADMIN" && role !== "GESTOR") return;
  if (!targetUid) return showToast("Selecione o SDR de destino primeiro.");
  if (!ids.length) return showToast("Selecione pelo menos 1 lead.");
  const target = allMembers.find((m) => m.uid === targetUid);
  if (!target) return;

  const batch = writeBatch(db);
  ids.forEach((id) => {
    batch.update(doc(db, "crm_leads", id), {
      sdrUid: target.uid,
      sdrNome: target.nome,
      sdrCode: target.code || "SDR",
      squadId: target.squadId || currentProfile.squadId || "SQUAD-01",
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });
  await batch.commit();
  selectedLeadIds.clear();
  $("chk-select-all").checked = false;
  showToast(`${ids.length} lead(s) direcionado(s) para ${target.nome}!`);
}

$("btn-bulk-assign").onclick = () => assignLeadBatch([...selectedLeadIds], $("bulk-sdr-select").value);
$("btn-assign-all-filtered").onclick = () => {
  const visibleIds = [...document.querySelectorAll(".lead-chk")].map((c) => c.dataset.id);
  assignLeadBatch(visibleIds, $("bulk-sdr-select").value);
};

$("btn-bulk-delete").onclick = async () => {
  if (normalizeRole(currentProfile.role) !== "ADMIN") return;
  const ids = [...selectedLeadIds];
  if (!ids.length) return showToast("Selecione pelo menos 1 lead para excluir.");
  if (!confirm(`DIRETORIA: Deseja apagar permanentemente ${ids.length} lead(s) selecionado(s)?`)) return;
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(doc(db, "crm_leads", id)));
  await batch.commit();
  selectedLeadIds.clear();
  $("chk-select-all").checked = false;
  showToast(`🗑️ ${ids.length} lead(s) apagado(s) pela Diretoria!`);
};

// Modal Lead
function openModal(lead = null) {
  $("modal-title").textContent = lead ? "Editar Lead" : "Novo Lead";
  $("ld-id").value = lead?.id || "";
  $("ld-nome").value = lead?.nome || "";
  $("ld-sexo").value = lead?.sexo || "Não informado";
  $("ld-tel").value = lead?.telefone || "";
  $("ld-email").value = lead?.email || "";
  $("ld-prof").value = lead?.profissao || "";
  $("ld-bairro").value = lead?.bairro || "";
  $("ld-cidade").value = lead?.cidade || "";
  $("ld-uf").value = lead?.estado || "";
  $("ld-canal").value = lead?.canal || "Instagram";
  $("ld-link").value = lead?.linkOrigem || "";
  $("ld-sdr").value = lead?.sdrUid || currentUser.uid;
  $("ld-status").value = lead?.status || "Novo Lead";
  $("ld-plano").value = lead?.plano || "Não Fechou";
  $("ld-calls").value = Number(lead?.callCount || 0);
  $("ld-perda").value = lead?.motivoPerda || "Não se aplica";
  $("ld-data").value = lead?.dataContato || todayISO();
  $("ld-followup").value = lead?.proximoFollowup || "";
  $("ld-pix-ref").value = lead?.pixComprovanteRef || "";
  $("ld-obs").value = lead?.observacao || "";
  $("lead-modal").classList.remove("hidden");
}

$("btn-new-lead").onclick = () => openModal();
$("btn-close-modal").onclick = () => $("lead-modal").classList.add("hidden");
$("btn-cancel-modal").onclick = () => $("lead-modal").classList.add("hidden");

$("lead-form").onsubmit = async (e) => {
  e.preventDefault();
  const id = $("ld-id").value;
  const role = normalizeRole(currentProfile.role);
  const canManage = role === "ADMIN" || role === "GESTOR";
  const chosenUid = canManage && $("ld-sdr").value ? $("ld-sdr").value : currentUser.uid;
  const chosenMember = allMembers.find((m) => m.uid === chosenUid) || currentProfile;

  const payload = {
    nome: $("ld-nome").value.trim(),
    sexo: $("ld-sexo").value,
    telefone: $("ld-tel").value.trim(),
    email: $("ld-email").value.trim(),
    profissao: $("ld-prof").value.trim(),
    bairro: $("ld-bairro").value.trim(),
    cidade: $("ld-cidade").value.trim(),
    estado: $("ld-uf").value.trim().toUpperCase(),
    canal: $("ld-canal").value,
    linkOrigem: $("ld-link").value.trim(),
    status: $("ld-status").value,
    plano: $("ld-plano").value,
    callCount: Math.max(0, Number($("ld-calls").value || 0)),
    motivoPerda: $("ld-perda").value,
    dataContato: $("ld-data").value || todayISO(),
    proximoFollowup: $("ld-followup").value,
    pixComprovanteRef: $("ld-pix-ref").value.trim(),
    observacao: $("ld-obs").value.trim(),
    lastActivityAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (canManage || !id) {
    payload.sdrUid = chosenUid;
    payload.sdrNome = chosenMember.nome || currentUser.email;
    payload.sdrCode = chosenMember.code || "SDR";
    payload.squadId = chosenMember.squadId || currentProfile.squadId || "SQUAD-01";
  }

  try {
    if (id) {
      await updateDoc(doc(db, "crm_leads", id), payload);
      showToast("Lead atualizado e contador zerado!");
    } else {
      await addDoc(collection(db, "crm_leads"), {
        ...payload,
        pixConfirmado: false,
        createdAt: serverTimestamp()
      });
      showToast("Lead cadastrado!");
    }
    $("lead-modal").classList.add("hidden");
  } catch (err) {
    showToast("Erro ao salvar: " + err.message);
  }
};

// Equipe & Acessos
$("btn-save-member").onclick = async () => {
  if (normalizeRole(currentProfile.role) !== "ADMIN") return;
  const uid = $("tm-uid").value.trim();
  const nome = $("tm-nome").value.trim();
  const email = $("tm-email").value.trim().toLowerCase();
  const chosenRole = normalizeRole($("tm-role").value);

  if (!nome) return showToast("Informe o Nome Completo.");
  if (!uid && !email) return showToast("Informe o UID do Firebase ou o E-mail de acesso.");

  const existingByEmail = email ? allMembers.find((m) => (m.email || "").toLowerCase() === email && !m.uid.startsWith("email_")) : null;
  const docId = uid || (existingByEmail ? existingByEmail.uid : `email_${email}`);

  await setDoc(doc(db, "crm_users", docId), {
    nome,
    email,
    code: $("tm-code").value.trim() || (chosenRole === "ADMIN" ? "DIRETOR" : chosenRole),
    role: chosenRole,
    squadId: $("tm-squad").value.trim() || (chosenRole === "ADMIN" ? "TODOS" : "SQUAD-01"),
    ativo: true,
    updatedAt: serverTimestamp()
  }, { merge: true });

  $("tm-uid").value = ""; $("tm-nome").value = ""; $("tm-email").value = ""; $("tm-code").value = "";
  showToast(`✅ ${nome} salvo como ${roleLabel(chosenRole)}!`);
};

function renderTeam() {
  $("team-tbody").innerHTML = allMembers.map((m) => {
    const isPendingLogin = m.uid.startsWith("email_");
    const r = normalizeRole(m.role);
    return `
      <tr>
        <td><strong>${m.code || "-"}</strong> • ${m.nome || "-"}</td>
        <td>
          ${m.email || "-"}
          <div class="sub-txt">${isPendingLogin ? "⏳ Aguardando 1º login para vincular UID" : m.uid}</div>
        </td>
        <td>
          <select class="input" style="padding:5px 8px; font-size:12px; min-width:165px;" data-change-role="${m.uid}">
            <option value="ADMIN" ${r === "ADMIN" ? "selected" : ""}>DIRETOR (ADMIN)</option>
            <option value="GESTOR" ${r === "GESTOR" ? "selected" : ""}>GESTOR</option>
            <option value="SDR" ${r === "SDR" ? "selected" : ""}>SDR</option>
          </select>
        </td>
        <td>${m.squadId || "-"}</td>
        <td><span class="badge ${m.ativo !== false ? "b-green" : "b-red"}">${m.ativo !== false ? "Ativo" : "Inativo"}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-outline btn-sm" data-toggle="${m.uid}">${m.ativo !== false ? "Desativar" : "Ativar"}</button>
            <button class="btn btn-red btn-sm" data-del-member="${m.uid}">Remover</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll("[data-change-role]").forEach((sel) => {
    sel.onchange = async () => {
      const newRole = normalizeRole(sel.value);
      await updateDoc(doc(db, "crm_users", sel.dataset.changeRole), {
        role: newRole,
        updatedAt: serverTimestamp()
      });
      showToast(`Nível atualizado para ${roleLabel(newRole)}!`);
    };
  });

  document.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = async () => {
      const m = allMembers.find((x) => x.uid === b.dataset.toggle);
      await updateDoc(doc(db, "crm_users", m.uid), { ativo: m.ativo === false });
      showToast("Status alterado!");
    };
  });

  document.querySelectorAll("[data-del-member]").forEach((b) => {
    b.onclick = async () => {
      const m = allMembers.find((x) => x.uid === b.dataset.delMember);
      if (!confirm(`Remover acesso de "${m?.nome || ""}" do CRM?`)) return;
      await deleteDoc(doc(db, "crm_users", m.uid));
      showToast("Membro removido da equipe.");
    };
  });
}

// Exportar CSV para a Planilha da Diretoria
$("btn-export-csv").onclick = () => {
  const headers = ["Data", "Squad", "SDR", "Nome", "Sexo", "Telefone", "Email", "Profissao", "Bairro", "Cidade", "UF", "Canal", "LinkOrigem", "Chamadas", "Status", "Plano", "PixConfirmado", "RefPix", "MotivoPerda", "Followup", "Observacao"];
  const rows = allCompanyLeads.map((l) => [
    l.dataContato, l.squadId, l.sdrNome, l.nome, l.sexo || "Não informado", l.telefone, l.email, l.profissao, l.bairro, l.cidade, l.estado, l.canal, l.linkOrigem, l.callCount || 0, l.status, l.plano, l.pixConfirmado ? "Sim" : "Não", l.pixComprovanteRef, l.motivoPerda, l.proximoFollowup, (l.observacao || "").replace(/[\r\n]+/g, " ")
  ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";"));
  const blob = new Blob(["\uFEFF" + [headers.join(";"), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `crm_agenda_magnus_${todayISO()}.csv`;
  a.click();
};

// Navegação de Abas & Filtros
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    ["dashboard", "leads", "team"].forEach((id) => {
      $("tab-" + id).classList.toggle("hidden", t.dataset.tab !== id);
    });
  };
});

[
  "filter-search", "filter-sdr", "filter-canal",
  "filter-profissao", "filter-estado", "filter-cidade", "filter-bairro",
  "filter-status", "filter-plan"
].forEach((id) => {
  $(id).addEventListener("input", renderLeads);
  $(id).addEventListener("change", renderLeads);
});

$("btn-clear-filters").onclick = () => {
  $("filter-search").value = "";
  $("filter-sdr").value = "ALL";
  $("filter-canal").value = "ALL";
  $("filter-profissao").value = "";
  $("filter-estado").value = "";
  $("filter-cidade").value = "";
  $("filter-bairro").value = "";
  $("filter-status").value = "ALL";
  $("filter-plan").value = "ALL";
  renderLeads();
};
