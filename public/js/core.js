/* ── MDSoltec OS · núcleo (Firebase, estado, cache, sessão, UI base) ── */

// Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc as fsAddDoc,
  getDocs,
  getDoc,
  setDoc as fsSetDoc,
  deleteDoc as fsDeleteDoc,
  doc,
  updateDoc as fsUpdateDoc,
  onSnapshot,
  runTransaction as fsRunTransaction,
  deleteField as fsDeleteField,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAvpMcRt5zNbfLlimqSGaPBeHqAFyDqIIQ",
  authDomain: "ods-mdsoltec.firebaseapp.com",
  projectId: "ods-mdsoltec",
  storageBucket: "ods-mdsoltec.firebasestorage.app",
  messagingSenderId: "488952740200",
  appId: "1:488952740200:web:b5904ed6ce194c9487bedd"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

const page = document.body.dataset.page || "";
/* ── Estado mutável compartilhado entre módulos ──
   ES modules têm imports somente-leitura, então o estado vivo da
   aplicação mora num único objeto exportado pelo core. */
const state = {
  firestoreNoticeShown: false,
  clientesCache: [],
  estoqueCache: [],
  produtosCache: [],
  editingPecaId: null,
  editingProdutoId: null,
  pdvCarrinho: [],
  fotosNovas: [],
  fotosNaOS: [],
  fotosRemovidas: []
};

/* ── Cache de leitura + invalidação automática nas escritas ── */
const COLLECTION_CACHE_TTL_MS = 30000;
const collectionInFlight = new Map(); // nome -> Promise em andamento
const collectionCache = new Map();    // nome -> { data, ts }
/* ── Exclusão suave: nada some de verdade ──
   Registros "excluídos" ganham excluidoEm/excluidoPor e deixam de
   aparecer em todas as telas; a Lixeira (Configurações) lista, restaura
   ou apaga definitivamente. */
function isDeleted(record) {
  return Boolean(record?.excluidoEm);
}
async function softDeleteDoc(ref) {
  const result = await updateDoc(ref, {
    excluidoEm: new Date().toISOString(),
    excluidoPor: getSession()?.email || ""
  });
  return result;
}
async function restoreDoc(ref) {
  return updateDoc(ref, { excluidoEm: fsDeleteField(), excluidoPor: fsDeleteField() });
}
function invalidateCollection(...names) {
  names.forEach((name) => {
    collectionCache.delete(name);
    collectionInFlight.delete(name);
  });
}

// Wrappers: qualquer escrita no app invalida o cache da coleção tocada,
// inclusive escritas futuras que usarem estes helpers.
function collectionIdOf(ref) {
  try { return ref.parent.id; } catch (error) { return ""; }
}
function addDoc(ref, data) {
  return fsAddDoc(ref, data).then((result) => { invalidateCollection(collectionIdOf(ref)); return result; });
}
function updateDoc(ref, data) {
  return fsUpdateDoc(ref, data).then((result) => { invalidateCollection(collectionIdOf(ref)); return result; });
}
function setDoc(ref, data, options) {
  const promise = options ? fsSetDoc(ref, data, options) : fsSetDoc(ref, data);
  return promise.then((result) => { invalidateCollection(collectionIdOf(ref)); return result; });
}
function deleteDoc(ref) {
  return fsDeleteDoc(ref).then((result) => { invalidateCollection(collectionIdOf(ref)); return result; });
}

const SESSION_KEY = "mdsoltecUser";
const SIGNED_OUT_KEY = "mdsoltecSignedOut";
const DISMISSED_NOTIFICATIONS_KEY = "mdsoltecDismissedNotifications";
const DEFAULT_SESSION = {
  nome: "Admin",
  email: "admin@mdsoltec.local",
  role: "admin",
  cargo: "Administrador"
};

const ROLE_PERMISSIONS = {
  admin: ["*"],
  tecnico: ["dashboard", "nova-os", "listar-os", "estoque", "garantias", "mensagens", "ficha-tecnica"],
  atendente: ["dashboard", "nova-os", "listar-os", "clientes", "mensagens", "pdv"],
  financeiro: ["dashboard", "listar-os", "financeiro", "relatorios", "pdv"]
};

const ROLE_LABELS = {
  admin: "Administrador",
  tecnico: "Técnico",
  atendente: "Atendente",
  financeiro: "Financeiro"
};

const ROUTE_PERMISSIONS = {
  "index.html": "dashboard",
  "nova-os.html": "nova-os",
  "listar-os.html": "listar-os",
  "clientes.html": "clientes",
  "estoque.html": "estoque",
  "pdv.html": "pdv",
  "financeiro.html": "financeiro",
  "relatorios.html": "relatorios",
  "garantias.html": "garantias",
  "mensagens.html": "mensagens",
  "ficha-tecnica.html": "ficha-tecnica",
  "configuracoes.html": "configuracoes"
};

function normalizeRole(value) {
  const role = normalizeText(value);
  if (role.includes("admin") || role.includes("administrador")) return "admin";
  if (role.includes("tecnic")) return "tecnico";
  if (role.includes("finance")) return "financeiro";
  if (role.includes("atendent")) return "atendente";
  return "atendente";
}

function routeFromHref(href) {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return "";
  try {
    const url = new URL(href, window.location.href);
    return url.pathname.split("/").pop() || "index.html";
  } catch (error) {
    return "";
  }
}

function byId(id) {
  return document.getElementById(id);
}

function valueOf(id) {
  return byId(id)?.value?.trim() || "";
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseCurrency(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return parseCurrency(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function getPartCost(peca) {
  return parseCurrency(
    peca?.custo ??
    peca?.valorCusto ??
    peca?.valorCompra ??
    peca?.precoCusto ??
    peca?.valor ??
    0
  );
}

function getPartSale(peca) {
  return parseCurrency(
    peca?.venda ??
    peca?.valorVenda ??
    peca?.precoVenda ??
    peca?.valor ??
    0
  );
}

function formatDate(value) {
  const date = toDate(value);
  return date ? date.toLocaleDateString("pt-BR") : "-";
}

function todayBR() {
  return new Date().toLocaleDateString("pt-BR");
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = String(value);
  const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(value, days) {
  const date = toDate(value) || new Date();
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function monthKeyFromDate(date) {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthKey() {
  return monthKeyFromDate(new Date());
}

function getMonthKey(value) {
  return monthKeyFromDate(toDate(value));
}

function formatMonthLabel(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!year || !month) return "Mês atual";
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric"
  });
}

function getPecaDate(peca) {
  return peca?.dataEntrada || peca?.criadoEm || peca?.atualizadoEm || "";
}

function getOSRevenueDate(os) {
  return os?.finalizadoEm || os?.dataFinalizacao || os?.concluidoEm || os?.dataConclusao || os?.data || "";
}

function getSaleDate(venda) {
  return venda?.data || venda?.criadoEm || venda?.atualizadoEm || "";
}

function isSaleActive(venda) {
  return normalizeText(venda?.status) !== "cancelada";
}

function isInMonth(value, selectedMonth, includeUndatedInCurrent = false) {
  const key = getMonthKey(value);
  if (key) return key === selectedMonth;
  return includeUndatedInCurrent && selectedMonth === currentMonthKey();
}

function populateMonthSelect(select, dateValues, selectedMonth = currentMonthKey()) {
  if (!select) return selectedMonth;

  const months = new Set([currentMonthKey()]);
  dateValues.forEach((value) => {
    const key = getMonthKey(value);
    if (key) months.add(key);
  });

  const sorted = [...months].sort((a, b) => b.localeCompare(a));
  select.innerHTML = sorted
    .map((key) => `<option value="${key}">${escapeHtml(formatMonthLabel(key))}</option>`)
    .join("");

  select.value = months.has(selectedMonth) ? selectedMonth : currentMonthKey();
  syncEnhancedSelect(select);
  return select.value;
}

function statusLabel(status) {
  const text = String(status || "Recebido").trim();
  const normalized = normalizeText(text);
  if (normalized.includes("andamento") || normalized.includes("diagnostico")) return "Em diagnóstico";
  if (normalized.includes("autoriz")) return "Aguardando aprovação";
  if (normalized.includes("peca")) return "Aguardando peça";
  if (normalized.includes("retirada") || normalized.includes("pronto")) return "Pronto para retirada";
  if (normalized.includes("final") || normalized.includes("conclu")) return "Finalizado";
  if (normalized.includes("reparo")) return "Em reparo";
  if (normalized.includes("aberta")) return "Aberta";
  return text;
}

function statusClass(status) {
  const normalized = normalizeText(statusLabel(status));
  if (normalized.includes("diagnostico")) return "status-diagnostico";
  if (normalized.includes("reparo")) return "status-reparo";
  if (normalized.includes("aprovacao")) return "status-aprovacao";
  if (normalized.includes("peca")) return "status-peca";
  if (normalized.includes("finalizado")) return "status-finalizada";
  if (normalized.includes("ativa")) return "status-ativo";
  if (normalized.includes("atraso")) return "status-atraso";
  return "status-recebido";
}

function isFinished(status) {
  const normalized = normalizeText(status);
  return normalized.includes("final") || normalized.includes("conclu") || normalized.includes("retirada");
}

function isOverdueOS(os) {
  if (isFinished(os.status)) return false;
  const data = toDate(os.data);
  if (!data) return false;
  return (Date.now() - data.getTime()) / 86400000 > 7 || normalizeText(os.status).includes("atraso");
}

function hasPermission(permission, session = getSession()) {
  if (!session) return false;
  const role = normalizeRole(session.role || session.perfil);
  const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.atendente;
  return permissions.includes("*") || permissions.includes(permission);
}

function getSession() {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) return { ...DEFAULT_SESSION, ...JSON.parse(stored) };
  } catch (error) {
    console.warn("Sessão local inválida:", error);
  }

  if (localStorage.getItem(SIGNED_OUT_KEY) === "true") return null;
  return null;
}

function setSession(profile) {
  const role = normalizeRole(profile?.role || profile?.perfil || DEFAULT_SESSION.role);
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    ...DEFAULT_SESSION,
    ...profile,
    role,
    cargo: profile?.cargo || ROLE_LABELS[role] || DEFAULT_SESSION.cargo
  }));
  localStorage.removeItem(SIGNED_OUT_KEY);
}

function getDismissedNotifications() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY) || "[]"));
  } catch (error) {
    console.warn("Notificações dispensadas inválidas:", error);
    return new Set();
  }
}

function dismissNotification(id) {
  if (!id) return;
  const dismissed = getDismissedNotifications();
  dismissed.add(id);
  localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify([...dismissed].slice(-120)));
}

function userDocId(email) {
  return encodeURIComponent(String(email || "usuario").toLowerCase());
}

async function restoreSessionFromAuthUser(user) {
  if (!user?.email) return null;

  const profile = await findUserProfile(user.email);
  let role = profile?.role || profile?.perfil || "atendente";
  try {
    const token = await user.getIdTokenResult();
    if (token.claims?.role) role = token.claims.role; // claim do servidor manda
  } catch (error) { console.warn("Claim de perfil indisponível:", error); }
  const session = {
    nome: profile?.nome || user.displayName || "Usuário",
    email: user.email,
    role,
    cargo: profile?.cargo || role
  };
  setSession(session);
  return session;
}

function refreshTopbarProfile() {
  const sessionRaw = getSession() || DEFAULT_SESSION;
  const session = { ...sessionRaw, role: normalizeRole(sessionRaw.role || sessionRaw.perfil) };
  const initial = (session.nome || "A").trim().charAt(0).toUpperCase();
  const avatar = document.querySelector(".profile-button .avatar");
  const name = document.querySelector(".profile-button .user-copy strong");
  const role = document.querySelector(".profile-button .user-copy small");

  if (avatar) avatar.textContent = initial;
  if (name) name.textContent = session.nome || "Admin";
  if (role) role.textContent = session.cargo || ROLE_LABELS[session.role] || "Usuário";
}

async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.warn("Logout Firebase ignorado:", error);
  }

  localStorage.removeItem(SESSION_KEY);
  localStorage.setItem(SIGNED_OUT_KEY, "true");
  window.location.href = "login.html";
}

async function getCollectionData(name, { maxAgeMs = COLLECTION_CACHE_TTL_MS } = {}) {
  // Cache em memória com TTL curto: evita reler a coleção INTEIRA a cada
  // tecla/interação (o Firestore cobra por documento lido). Escritas
  // invalidam automaticamente (wrappers abaixo); snapshots em tempo real
  // (listenCollection) também atualizam o cache, e entre eles a janela
  // máxima de obsolescência é o TTL.
  const cached = collectionCache.get(name);
  if (cached && Date.now() - cached.ts < maxAgeMs) return cached.data;

  const inFlight = collectionInFlight.get(name);
  if (inFlight) return inFlight; // dedupe de chamadas simultâneas

  const promise = (async () => {
    try {
      const snapshot = await getDocs(collection(db, name));
      const data = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((record) => !isDeleted(record));
      collectionCache.set(name, { data, ts: Date.now() });
      return data;
    } catch (error) {
      console.error(`Erro ao carregar ${name}:`, error);
      showFirestoreNotice(error);
      return [];
    } finally {
      collectionInFlight.delete(name);
    }
  })();

  collectionInFlight.set(name, promise);
  return promise;
}

/* ── Tempo real: mantém o cache atualizado e reage a mudanças ──
   Cada snapshot alimenta o cache (todas as telas que leem
   getCollectionData passam a ver o dado novo) e chama onChange.
   Erros ficam em console.warn: o app segue funcionando se o
   ouvinte for negado (ex.: sessão expirada). */
function listenCollection(name, onChange) {
  try {
    return onSnapshot(collection(db, name), (snapshot) => {
      const data = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((record) => !isDeleted(record));
      collectionCache.set(name, { data, ts: Date.now() });
      try { onChange?.(data); } catch (error) { console.warn(`Reação a mudanças em ${name} falhou:`, error); }
    }, (error) => console.warn(`Ouvinte ${name} indisponível:`, error.code || error));
  } catch (error) {
    console.warn(`Ouvinte ${name} não iniciado:`, error);
    return () => {};
  }
}

/* Agrupa rajadas de snapshots numa única atualização (debounce). */
function scheduleAfterSnapshots(names, run, delay = 500) {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    setTimeout(async () => {
      queued = false;
      try { await run(); } catch (error) { console.warn("Atualização em tempo real falhou:", error); }
    }, delay);
  };
  names.forEach((name) => listenCollection(name, schedule));
}

function showFirestoreNotice(error) {
  if (state.firestoreNoticeShown) return;
  state.firestoreNoticeShown = true;

  const container = document.querySelector(".page");
  if (!container) return;

  const notice = document.createElement("div");
  notice.className = "alert-box warning";
  notice.style.marginBottom = "16px";
  notice.innerHTML = `
    <strong>Firebase não respondeu.</strong>
    <div>Verifique as regras do Firestore e a conexão. O layout continua disponível.</div>
  `;

  const header = container.querySelector(".page-header");
  if (header?.nextSibling) {
    container.insertBefore(notice, header.nextSibling);
  } else {
    container.prepend(notice);
  }
}

function initNavigation() {
  const routes = {
    novaOS: "nova-os.html",
    listOS: "listar-os.html",
    clienteID: "clientes.html",
    estoqueID: "estoque.html",
    pdvID: "pdv.html",
    financeiroID: "financeiro.html"
  };

  Object.entries(routes).forEach(([id, url]) => {
    const button = byId(id);
    if (button) button.addEventListener("click", () => (window.location.href = url));
  });

  const file = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-route]").forEach((item) => {
    if (item.dataset.route === file) item.classList.add("is-active");
  });

  const activeButtonByFile = {
    "nova-os.html": "novaOS",
    "listar-os.html": "listOS",
    "clientes.html": "clienteID",
    "estoque.html": "estoqueID",
    "pdv.html": "pdvID",
    "financeiro.html": "financeiroID"
  };
  byId(activeButtonByFile[file])?.classList.add("is-active");
}

function initMobileSidebar() {
  const sidebar = document.querySelector(".app-sidebar");
  const topbar = document.querySelector(".topbar");
  if (!sidebar || !topbar || page === "login") return;

  if (!byId("sidebarToggle")) {
    const toggle = document.createElement("button");
    toggle.id = "sidebarToggle";
    toggle.type = "button";
    toggle.className = "sidebar-toggle";
    toggle.setAttribute("aria-label", "Abrir menu lateral");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = "<span></span><span></span><span></span>";
    topbar.prepend(toggle);
  }

  if (!byId("sidebarBackdrop")) {
    const backdrop = document.createElement("button");
    backdrop.id = "sidebarBackdrop";
    backdrop.type = "button";
    backdrop.className = "sidebar-backdrop";
    backdrop.setAttribute("aria-label", "Fechar menu lateral");
    document.body.appendChild(backdrop);
  }

  const toggle = byId("sidebarToggle");
  const backdrop = byId("sidebarBackdrop");
  const closeSidebar = () => {
    document.body.classList.remove("sidebar-open");
    sidebar.classList.remove("is-open");
    sidebar.style.transition = "";
    sidebar.style.transform = "";
    toggle?.setAttribute("aria-expanded", "false");
  };
  const openSidebar = () => {
    document.body.classList.add("sidebar-open");
    sidebar.classList.add("is-open");
    sidebar.style.transition = "none";
    sidebar.style.transform = "none";
    toggle?.setAttribute("aria-expanded", "true");
  };

  toggle?.addEventListener("click", () => {
    document.body.classList.contains("sidebar-open") ? closeSidebar() : openSidebar();
  });
  backdrop?.addEventListener("click", closeSidebar);
  sidebar.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeSidebar));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSidebar();
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeSidebar();
  });
}

async function initSessionControls() {
  const file = window.location.pathname.split("/").pop() || "index.html";
  let session = getSession();

  if (!session && localStorage.getItem(SIGNED_OUT_KEY) !== "true") {
    const authUser = await getAuthUserOnce(1200);
    if (authUser) session = await restoreSessionFromAuthUser(authUser);
  }

  if (page === "login") {
    if (session) {
      window.location.href = "index.html";
      return false;
    }

    return true;
  }

  if (!session) {
    window.location.href = "login.html";
    return false;
  }

  applyPermissions(session, file);
  return true;
}

function initTopbar() {
  const userMenu = document.querySelector(".user-menu");
  if (!userMenu || page === "login") return;

  const sessionRaw = getSession() || DEFAULT_SESSION;
  const session = { ...sessionRaw, role: normalizeRole(sessionRaw.role || sessionRaw.perfil) };
  const initial = (session.nome || "A").trim().charAt(0).toUpperCase();
  const canManageSettings = hasPermission("configuracoes", session);

  userMenu.innerHTML = `
    <div class="notification-wrap">
      <button id="notificationButton" class="notification-button" type="button" title="Notificações">
        <span id="notificationBadge" class="notification">0</span>
      </button>
      <div id="notificationPanel" class="dropdown-panel notification-panel" hidden></div>
    </div>
    <div class="profile-wrap">
      <button id="profileButton" class="profile-button" type="button" title="Menu do usuário">
        <span class="avatar">${escapeHtml(initial)}</span>
        <span class="user-copy"><strong>${escapeHtml(session.nome || "Admin")}</strong><small>${escapeHtml(session.cargo || ROLE_LABELS[session.role] || "Usuário")}</small></span>
      </button>
      <div id="profilePanel" class="dropdown-panel profile-panel" hidden>
        ${canManageSettings ? `
          <a href="configuracoes.html">Configurações</a>
          <a href="configuracoes.html#funcionarios">Funcionários e permissões</a>
        ` : ""}
        <button type="button" id="logoutButton">Deslogar</button>
      </div>
    </div>
  `;

  const notificationButton = byId("notificationButton");
  const notificationPanel = byId("notificationPanel");
  const profileButton = byId("profileButton");
  const profilePanel = byId("profilePanel");

  notificationButton?.addEventListener("click", () => {
    notificationPanel.hidden = !notificationPanel.hidden;
    if (profilePanel) profilePanel.hidden = true;
  });

  profileButton?.addEventListener("click", () => {
    profilePanel.hidden = !profilePanel.hidden;
    if (notificationPanel) notificationPanel.hidden = true;
  });

  byId("logoutButton")?.addEventListener("click", logout);

  document.addEventListener("click", (event) => {
    if (!userMenu.contains(event.target)) {
      if (notificationPanel) notificationPanel.hidden = true;
      if (profilePanel) profilePanel.hidden = true;
    }
  });

  loadSystemNotifications();

  // Tempo real: badge e painel de notificações se atualizam sozinhos.
  scheduleAfterSnapshots(["ordensServico", "estoque", "produtos"], loadSystemNotifications, 800);
}

async function loadSystemNotifications() {
  const badge = byId("notificationBadge");
  const panel = byId("notificationPanel");
  if (!badge || !panel) return;

  const [ordens, estoque, produtos] = await Promise.all([
    getCollectionData("ordensServico"),
    getCollectionData("estoque"),
    getCollectionData("produtos")
  ]);

  const itensEstoque = [
    ...estoque.map((item) => ({ ...item, tipoEstoque: "peça" })),
    ...produtos.map((item) => ({ ...item, tipoEstoque: "produto" }))
  ];
  const abertas = ordens.filter((os) => !isFinished(os.status));
  const atrasadas = ordens.filter(isOverdueOS);
  const estoqueAcabando = itensEstoque.filter((item) => Number(item.minimo || 0) > 0 && Number(item.quantidade || 0) <= Number(item.minimo || 0));
  const zeradas = itensEstoque.filter((item) => Number(item.quantidade || 0) <= 0);
  const notificationKey = (prefix, data) => `${prefix}:${data
    .map((item) => item.id || item.numero || produtoLabel(item) || "")
    .filter(Boolean)
    .sort()
    .join("|")}`;

  const items = [];
  if (atrasadas.length) items.push({ id: notificationKey("os-atrasadas", atrasadas), type: "danger", title: `${atrasadas.length} OS em atraso`, text: "Revise os atendimentos pendentes.", href: "listar-os.html" });
  if (abertas.length) items.push({ id: notificationKey("os-abertas", abertas), type: "success", title: `${abertas.length} OS aberta(s)`, text: "Há serviços em andamento.", href: "listar-os.html" });
  if (zeradas.length) items.push({ id: notificationKey("estoque-zero", zeradas), type: "danger", title: `${zeradas.length} item(ns) em falta`, text: zeradas.map((p) => produtoLabel(p)).slice(0, 2).join(", "), href: "estoque.html" });
  if (estoqueAcabando.length) items.push({ id: notificationKey("estoque-baixo", estoqueAcabando), type: "warning", title: `${estoqueAcabando.length} item(ns) acabando`, text: "Estoque igual ou abaixo do mínimo.", href: "estoque.html" });

  const dismissed = getDismissedNotifications();
  const session = getSession();
  const visibleItems = items.filter((item) => {
    const permission = ROUTE_PERMISSIONS[routeFromHref(item.href)];
    return !dismissed.has(item.id) && (!permission || hasPermission(permission, session));
  });

  badge.textContent = visibleItems.length;
  badge.classList.toggle("is-empty", !visibleItems.length);
  panel.innerHTML = visibleItems.length
    ? visibleItems.map((item) => `
        <a class="notification-item ${item.type}" href="${item.href}" data-notification-id="${encodeURIComponent(item.id)}">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.text)}</small>
        </a>
      `).join("")
    : `<div class="notification-item"><strong>Tudo certo</strong><small>Nenhum alerta importante agora.</small></div>`;

  panel.querySelectorAll("[data-notification-id]").forEach((link) => {
    link.addEventListener("click", () => dismissNotification(decodeURIComponent(link.dataset.notificationId || "")));
  });
}

/* ── Toasts: substituem showToast() com feedback visual não bloqueante ── */
function toastTypeFor(message) {
  const text = normalizeText(message);
  if (/(sucesso|salv|criad|cadastr|atualiz|enviad|concluid|exportad)/.test(text)) return "success";
  if (/(erro|invalid|nao foi possivel|nao possivel|preench|informe|ja existe|insuficient|sem conex|verifique)/.test(text)) return "error";
  return "info";
}

function showToast(message, type) {
  let host = document.querySelector(".rv-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "rv-toast-host";
    document.body.appendChild(host);
  }
  const toast = document.createElement("div");
  toast.className = `rv-toast ${type || toastTypeFor(message)}`;
  toast.setAttribute("role", "status");
  toast.innerHTML = `<span class="rv-toast-dot" aria-hidden="true"></span><p>${escapeHtml(message)}</p>`;
  host.appendChild(toast);
  while (host.children.length > 4) host.firstElementChild.remove();
  requestAnimationFrame(() => toast.classList.add("is-in"));
  setTimeout(() => {
    toast.classList.remove("is-in");
    setTimeout(() => toast.remove(), 300);
  }, 4200);
}

/* ── Modal de confirmação: substitui confirm() nativo ── */
function confirmDialog(message, { title = "Confirmar ação", confirmText = "Confirmar", cancelText = "Cancelar", danger = false } = {}) {
  return new Promise((resolve) => {
    document.querySelector(".rv-modal")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "rv-modal";
    backdrop.innerHTML = `
      <div class="rv-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="rv-modal-actions">
          <button type="button" class="btn btn-secondary" data-rv-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-rv-ok>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    const close = (value) => {
      backdrop.classList.remove("is-in");
      setTimeout(() => backdrop.remove(), 180);
      resolve(value);
    };
    backdrop.querySelector("[data-rv-ok]").addEventListener("click", () => close(true));
    backdrop.querySelector("[data-rv-cancel]").addEventListener("click", () => close(false));
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(false); });
    document.addEventListener("keydown", function esc(event) {
      if (event.key === "Escape") { document.removeEventListener("keydown", esc); close(false); }
    });
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("is-in"));
    backdrop.querySelector("[data-rv-ok]").focus();
  });
}

/* ── Ícones SVG: interface consistente, sem glyphs de texto soltos ── */
function svgIcon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const UI_ICONS = {
  dashboard: svgIcon('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  "nova-os": svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 12v6"/><path d="M9 15h6"/>'),
  "listar-os": svgIcon('<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>'),
  clientes: svgIcon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  estoque: svgIcon('<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>'),
  pdv: svgIcon('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>'),
  financeiro: svgIcon('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>'),
  relatorios: svgIcon('<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>'),
  garantias: svgIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  mensagens: svgIcon('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>'),
  "ficha-tecnica": svgIcon('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>'),
  configuracoes: svgIcon('<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>'),
  folder: svgIcon('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  clock: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
  banknote: svgIcon('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01"/><path d="M18 12h.01"/>'),
  trend: svgIcon('<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>'),
  check: svgIcon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>'),
  receipt: svgIcon('<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/>')
};

const METRIC_ICONS = {
  "OS abertas": "folder",
  "OS em atraso": "clock",
  "Faturamento mês": "banknote",
  "Lucro mês": "trend",
  "Serviços concluídos": "check",
  "Ticket médio": "receipt"
};

function initIcons() {
  if (page === "login") return;
  document.querySelectorAll(".side-link").forEach((link) => {
    if (link.querySelector(".side-ico")) return;
    const file = routeFromHref(link.getAttribute("href")).replace(".html", "");
    const icon = UI_ICONS[file === "index" ? "dashboard" : file];
    if (icon) link.insertAdjacentHTML("afterbegin", `<span class="side-ico" aria-hidden="true">${icon}</span>`);
  });
  document.querySelectorAll(".metric-card").forEach((card) => {
    const el = card.querySelector(".metric-icon");
    const label = card.querySelector(".metric-label")?.textContent.trim();
    const key = METRIC_ICONS[label];
    if (el && key) el.innerHTML = UI_ICONS[key];
  });
}

/* ── Skeletons: feedback de carregamento nas listas do banco ── */
function renderSkeleton(el, { cols = 4, rows = 4, type = "rows" } = {}) {
  if (!el || el.innerHTML.trim()) return;
  const cell = '<span class="rv-skeleton"></span>';
  if (type === "list") {
    el.innerHTML = Array.from({ length: rows }, () =>
      `<li class="compact-item"><span>${cell}<span class="rv-skeleton rv-skel-60"></span></span>${cell}</li>`
    ).join("");
    return;
  }
  el.innerHTML = Array.from({ length: rows }, () =>
    `<tr>${Array.from({ length: cols }, () => `<td>${cell}</td>`).join("")}</tr>`
  ).join("");
}

async function findUserProfile(email) {
  if (!email) return null;

  try {
    const usuarios = await getCollectionData("usuarios");
    const normalizedEmail = normalizeText(email);
    return usuarios.find((usuario) => {
      const candidates = [
        usuario.email,
        usuario.login,
        usuario.emailLogin,
        usuario.usuario,
        usuario.id?.includes("@") ? usuario.id : ""
      ];
      return candidates.some((candidate) => normalizeText(candidate) === normalizedEmail);
    }) || null;
  } catch (error) {
    console.warn("Perfil de usuário não carregado:", error);
    return null;
  }
}

async function gerarNumeroOS() {
  // Transação: dois atendentes criando OS ao mesmo tempo nunca recebem
  // o mesmo número (o Firestore serializa a leitura/escrita do contador).
  const configRef = doc(db, "config", "contadorOS");
  const numeroOS = await fsRunTransaction(db, async (tx) => {
    const configSnap = await tx.get(configRef);
    if (!configSnap.exists()) {
      tx.set(configRef, { osCounter: 2 });
      return 1;
    }
    const atual = Number(configSnap.data().osCounter || 1);
    tx.set(configRef, { osCounter: atual + 1 }, { merge: true });
    return atual;
  });
  invalidateCollection("config");
  return `OS #${numeroOS}`;
}

/* ── Portal do cliente: espelho público e seguro da OS ──
   Grava em consultasPublicas/{codigo} SOMENTE dados não sensíveis
   (sem CPF, endereço, telefone ou valores). O cliente consulta em
   /consulta.html pelo código impresso no termo (com QR Code). */
function gerarCodigoConsulta() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem I,O,0,1 (confusão)
  const bloco = () => Array.from({ length: 4 }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join("");
  return `${bloco()}-${bloco()}`;
}

async function syncConsultaPublica(os) {
  try {
    let codigo = os.codigoConsulta;
    if (!codigo) {
      codigo = gerarCodigoConsulta();
      await updateDoc(doc(db, "ordensServico", os.id), { codigoConsulta: codigo });
    }
    await setDoc(doc(db, "consultasPublicas", codigo), {
      numero: os.numero || "",
      status: statusLabel(os.status),
      cliente: (os.cliente || "").split(" ")[0] || "",
      dispositivo: os.dispositivo || os.aparelho || "",
      marcaModelo: os.marcaModelo || os.modelo || "",
      entrada: formatDate(os.data),
      atualizadoEm: formatDate(new Date().toISOString()),
      previsao: os.previsaoEntrega ? formatDate(os.previsaoEntrega) : ""
    }, { merge: true });
    return codigo;
  } catch (error) {
    console.warn("Portal do cliente não sincronizado:", error);
    return null;
  }
}

function getWarrantyDays(os, config = {}) {
  const days = Number.parseInt(os?.garantiaDias || os?.garantiaPadrao || config.garantiaPadrao || 90, 10);
  return Number.isFinite(days) && days > 0 ? days : 90;
}

function produtoLabel(item) {
  return item?.nome ||
    item?.descricao ||
    [item?.tipo, item?.marca, item?.modelo].filter(Boolean).join(" ") ||
    item?.codigo ||
    "Produto";
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

/* ── Versão centralizada: atualize só aqui (rodapé da sidebar) ── */
const APP_VERSION = "1.4.0";
document.querySelectorAll(".app-version").forEach((el) => {
  el.innerHTML = `MDSoltec OS ${APP_VERSION}<br>© ${new Date().getFullYear()} MDSoltec`;
});


function applyPermissions(session, file) {
  const role = normalizeRole(session.role || session.perfil);
  const normalizedSession = { ...session, role };
  const hideElement = (element) => {
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
    element.style.display = "none";
  };

  if (role === "admin") return;

  document.querySelectorAll("[data-route]").forEach((link) => {
    const permission = ROUTE_PERMISSIONS[link.dataset.route];
    if (permission && !hasPermission(permission, normalizedSession)) hideElement(link);
  });

  const buttonPermissions = {
    novaOS: "nova-os",
    listOS: "listar-os",
    clienteID: "clientes",
    estoqueID: "estoque",
    pdvID: "pdv",
    financeiroID: "financeiro"
  };

  Object.entries(buttonPermissions).forEach(([id, permission]) => {
    const button = byId(id);
    if (button && !hasPermission(permission, normalizedSession)) hideElement(button);
  });

  document.querySelectorAll("a[href]").forEach((link) => {
    const route = routeFromHref(link.getAttribute("href"));
    const permission = ROUTE_PERMISSIONS[route];
    if (permission && !hasPermission(permission, normalizedSession)) hideElement(link);
  });

  const currentPermission = ROUTE_PERMISSIONS[file];
  if (currentPermission && !hasPermission(currentPermission, normalizedSession)) {
    window.location.href = "index.html";
  }
}

function syncEnhancedSelect(select) {
  if (!select || select.dataset.native === "true") return;

  let wrapper = select.nextElementSibling?.classList?.contains("custom-select")
    ? select.nextElementSibling
    : null;

  if (!wrapper) {
    select.dataset.enhanced = "true";
    select.classList.add("native-select-hidden");
    wrapper = document.createElement("div");
    wrapper.className = "custom-select";
    wrapper.innerHTML = `
      <button type="button" class="custom-select-button"></button>
      <div class="custom-select-panel" hidden></div>
    `;
    select.insertAdjacentElement("afterend", wrapper);

    wrapper.querySelector(".custom-select-button").addEventListener("click", (event) => {
      event.stopPropagation();
      const panel = wrapper.querySelector(".custom-select-panel");
      document.querySelectorAll(".custom-select-panel").forEach((other) => {
        if (other !== panel) other.hidden = true;
      });
      panel.hidden = !panel.hidden;
    });

    select.addEventListener("change", () => updateCustomSelect(select));
  }

  const panel = wrapper.querySelector(".custom-select-panel");
  panel.innerHTML = Array.from(select.options).map((option) => `
    <button type="button" class="custom-select-option" data-value="${escapeHtml(option.value)}">
      ${escapeHtml(option.textContent.trim())}
    </button>
  `).join("");

  panel.querySelectorAll(".custom-select-option").forEach((optionButton) => {
    optionButton.addEventListener("click", () => {
      select.value = optionButton.dataset.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      panel.hidden = true;
    });
  });

  updateCustomSelect(select);
}

function updateCustomSelect(select) {
  const wrapper = select.nextElementSibling?.classList?.contains("custom-select")
    ? select.nextElementSibling
    : null;
  if (!wrapper) return;

  const selected = select.selectedOptions?.[0] || select.options?.[0];
  const button = wrapper.querySelector(".custom-select-button");
  if (button) button.textContent = selected?.textContent?.trim() || "Selecione";
  wrapper.querySelectorAll(".custom-select-option").forEach((optionButton) => {
    optionButton.classList.toggle("is-selected", optionButton.dataset.value === select.value);
  });
}

export {
  updateCustomSelect,
  syncEnhancedSelect,
  fsAddDoc,
  fsSetDoc,
  fsDeleteDoc,
  fsUpdateDoc,
  fsRunTransaction,
  fsDeleteField,
  getDoc,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  getStorage,
  storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  applyPermissions,
  state,
  APP_VERSION,
  COLLECTION_CACHE_TTL_MS,
  DEFAULT_SESSION,
  DISMISSED_NOTIFICATIONS_KEY,
  METRIC_ICONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROUTE_PERMISSIONS,
  SESSION_KEY,
  SIGNED_OUT_KEY,
  UI_ICONS,
  addDays,
  addDoc,
  app,
  auth,
  byId,
  collectionIdOf,
  confirmDialog,
  currentMonthKey,
  db,
  deleteDoc,
  digitsOnly,
  dismissNotification,
  escapeHtml,
  findUserProfile,
  firebaseConfig,
  formatDate,
  formatMoney,
  formatMonthLabel,
  gerarCodigoConsulta,
  gerarNumeroOS,
  getCollectionData,
  getDismissedNotifications,
  getMonthKey,
  getOSRevenueDate,
  getPartCost,
  getPartSale,
  getPecaDate,
  getSaleDate,
  getSession,
  getWarrantyDays,
  hasPermission,
  initIcons,
  initMobileSidebar,
  initNavigation,
  initSessionControls,
  initTopbar,
  invalidateCollection,
  isDeleted,
  isFinished,
  isInMonth,
  isOverdueOS,
  isSaleActive,
  listenCollection,
  loadSystemNotifications,
  logout,
  monthKeyFromDate,
  normalizeRole,
  normalizeText,
  page,
  parseCurrency,
  populateMonthSelect,
  produtoLabel,
  refreshTopbarProfile,
  renderSkeleton,
  restoreDoc,
  restoreSessionFromAuthUser,
  routeFromHref,
  scheduleAfterSnapshots,
  setDoc,
  setSession,
  setText,
  showFirestoreNotice,
  showToast,
  softDeleteDoc,
  statusClass,
  statusLabel,
  storage,
  svgIcon,
  syncConsultaPublica,
  toDate,
  toastTypeFor,
  todayBR,
  updateDoc,
  userDocId,
  valueOf,
  doc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getCountFromServer
};

