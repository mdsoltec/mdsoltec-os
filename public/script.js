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
  updateDoc as fsUpdateDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

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

const page = document.body.dataset.page || "";
let firestoreNoticeShown = false;
let clientesCache = [];
let estoqueCache = [];
let produtosCache = [];
let editingPecaId = null;
let editingProdutoId = null;
let pdvCarrinho = [];

/* ── Cache de leitura + invalidação automática nas escritas ── */
const COLLECTION_CACHE_TTL_MS = 30000;
const collectionCache = new Map();    // nome -> { data, ts }
const collectionInFlight = new Map(); // nome -> Promise em andamento

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

document.addEventListener("DOMContentLoaded", async () => {
  ensurePdvNavigation();
  initNavigation();
  initMobileSidebar();
  const sessionReady = await initSessionControls();
  if (!sessionReady) return;
  initTopbar();
  initLogin();
  initNovaOS();
  initListarOS();
  initClientes();
  initEstoque();
  initDashboard();
  initFinanceiro();
  initRelatorios();
  initGarantias();
  initFichaTecnica();
  initConfiguracoes();
  initFuncionarios();
  initBuscaCliente();
  initExportarDados();
  initMensagens();
  initPDV();
  enhanceSelects();
});

function byId(id) {
  return document.getElementById(id);
}

function valueOf(id) {
  return byId(id)?.value?.trim() || "";
}

function setValue(id, value) {
  const element = byId(id);
  if (element) element.value = value ?? "";
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

function getAuthUserOnce(timeoutMs = 800) {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    unsubscribe = onAuthStateChanged(auth, (user) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(user);
    });
  });
}

async function restoreSessionFc function restoreSessionFromAuthUser(user) {
  if (!user?.email) return null;

  const profile = await findUserProfile(user.email);
  const session = {
    nome: profile?.nome || user.displayName || "Usuário",
    email: user.email,
    role: profile?.role || profile?.perfil || "atendente",
    cargo: profile?.cargo || "Usuário"
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

function composeAddress(data) {
  return [
    data?.endereco || data?.logradouro,
    daro,
    data?.cidade || data?.municipio,
    data?.estado || data?.uf
  ].filter(Boolean).join(", ");
}

function validateCpf(value) {
  const cpf = digitsOnly(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  const calcDigit = (base) => {
    const sum = base
      .split("")
      .reduce((acc, digit, index) => acc + Number(digit) * (base.length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calcDigit(cpf.slice(0, 9)) === Number(cpf[9]) &&
    calcDigit(cpf.slice(0, 10)) === Number(cpf[10]);
}

function validateCnpj(value) {
  const cnpj = digitsOnly(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const calcDigit = (base) => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split("").reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return calcDigit(cnpj.slice(0, 12)) === Number(cnpj[12]) &&
    calcDigit(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

function validateDocument(value) {
  const digits = digitsOnly(value);
  if (!digits) return { valid: true, type: "" };
  if (digits.length <= 11) return { valid: validateCpf(digits), type: "CPF" };
  return { valid: validateCnpj(digits), type: "CNPJ" };
}

async function fetchCnpjData(value) {
  const cnpj = digitsOnly(value);
  if (!validateCnpj(cnpj)) return null;

  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!response.ok) throw new Error("CNPJ não encontrado");
  return response.json();
}

function setStatusMessage(element, message, type = "muted") {
  if (!element) return;
  element.textContent = message;
  element.className = `field-status ${type}`;
}

function findClienteByName(name) {
  const normalized = normalizeText(name);
  if (!normalized) return null;

  const exact = clientesCache.find((cliente) => normalizeText(cliente.nome) === normalized);
  if (exact) return exact;

  const matches = clientesCache.filter((cliente) => normalizeText(cliente.nome).includes(normalized));
  return matches.length === 1 ? matches[0] : null;
}

function fillClienteNaOS(cliente) {
  if (!cliente) return;
  setValue("clienteInput", cliente.nome || "");
  setValue("whatsappInput", cliente.telefone || cliente.whatsapp || "");
  setValue("clienteCpfCnpjInput", cliente.cpfCnpj || cliente.documento || "");
  setValue("clienteEnderecoInput", composeAddress(cliente));
}

async function getCollectionData(name) {
  try {
    const snapshot = await getDocs(collection(db, name));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.error(`Erro ao carregar ${name}:`, error);
    showFirestoreNotice(error);
    return [];
  }
}

function showFirestoreNotice(error) {
  if (firestoreNoticeShown) return;
  firestoreNoticeShown = true;

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

function ensurePdvNavigation() {
  const estoqueLink = document.querySelector('.side-nav [data-route="estoque.html"]');
  if (estoqueLink && !document.querySelector('.side-nav [data-route="pdv.html"]')) {
    const pdvLink = document.createElement("a");
    pdvLink.className = "side-link";
    pdvLink.dataset.route = "pdv.html";
    pdvLink.href = "pdv.html";
    pdvLink.textContent = "PDV";
    estoqueLink.insertAdjacentElement("afterend", pdvLink);
  }

  const estoqueButton = byId("estoqueID");
  if (estoqueButton && !byId("pdvID")) {
    const pdvButton = document.createElement("button");
    pdvButton.id = "pdvID";
    pdvButton.type = "button";
    pdvButton.className = "top-action";
    pdvButton.textContent = "PDV";
    estoqueButton.insertAdjacentElement("afterend", pdvButton);
  }
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

function enhanceSelects() {
  document.querySelectorAll("select").forEach((select) => syncEnhancedSelect(select));

  document.addEventListener("click", (event) => {
    document.querySelectorAll(".custom-select-panel").forEach((panel) => {
      if (!panel.closest(".custom-select")?.contains(event.target)) panel.hidden = true;
    });
  });
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

function loginErrorMessage(error) {
  const map = {
    "auth/invalid-email": "E-mail inválido. Confira a digitação.",
    "auth/missing-password": "Informe a senha.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "Não há conta com este e-mail. Procure o administrador.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
    "auth/network-request-failed": "Sem conexão com o servidor. Verifique a internet.",
    "auth/user-disabled": "Esta conta foi desativada. Procure o administrador."
  };
  return map[error?.code] || "Não foi possível entrar. Tente novamente em instantes.";
}

function initLogin() {
  const loginForm = byId("loginForm");
  if (!loginForm) return;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = valueOf("loginEmail");
    const senha = byId("loginSenha")?.value || "";
    const status = byId("loginStatus");

    if (!email || !senha) {
      if (status) status.textContent = "Informe e-mail e senha.";
      return;
    }

    try {
      const credentials = await signInWithEmailAndPassword(auth, email, senha);
      const profile = await findUserProfile(credentials.user.email);
      setSession({
        nome: profile?.nome || credentials.user.displayName || "Usuário",
        email: credentials.user.email,
        role: profile?.role || profile?.perfil || "atendente",
        cargo: profile?.cargo || "Usuário"
      });
      window.location.href = "index.html";
      return;
    } catch (error) {
      console.warn("Login Firebase não concluído:", error);
      if (status) status.textContent = loginErrorMessage(error);
    }
  });

  // Recuperação de senha: envia o link oficial do Firebase Auth para o e-mail.
  const resetButton = byId("loginReset");
  resetButton?.addEventListener("click", async () => {
    const status = byId("loginStatus");
    const email = valueOf("loginEmail");
    if (status) status.textContent = "";
    if (!email) {
      if (status) status.textContent = "Digite seu e-mail acima e clique novamente para receber o link de redefinição.";
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      if (status) status.textContent = "Link de redefinição enviado. Verifique sua caixa de entrada (e o spam).";
    } catch (error) {
      console.warn("Redefinição de senha falhou:", error);
      if (status) status.textContent = loginErrorMessage(error);
    }
  });
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
  const configRef = doc(db, "config", "contadorOS");
  const configSnap = await getDoc(configRef);

  if (configSnap.exists()) {
    const numeroOS = configSnap.data().osCounter || 1;
    await updateDoc(configRef, { osCounter: numeroOS + 1 });
    return `OS #${numeroOS}`;
  }

  await setDoc(configRef, { osCounter: 2 });
  return "OS #1";
}

async function initNovaOS() {
  const osForm = byId("osForm");
  if (!osForm) return;

  await carregarDatalists();

  const params = new URLSearchParams(window.location.search);
  const osId = params.get("id");
  let originalOS = null;

  const updateTotal = () => {
    const valorPeca = parseCurrency(valueOf("valorPecaInput"));
    const maoObra = parseCurrency(valueOf("maoObraInput"));
    const total = valorPeca + maoObra;
    if (byId("valorTotal")) setValue("valorTotal", total ? total.toFixed(2) : "");
  };

  byId("valorPecaInput")?.addEventListener("input", updateTotal);
  byId("maoObraInput")?.addEventListener("input", updateTotal);

  const clienteInput = byId("clienteInput");
  const onClienteChange = async () => {
    const typedName = clienteInput?.value || "";
    if (!typedName.trim()) return;

    if (!clientesCache.length) clientesCache = await getCollectionData("clientes");
    fillClienteNaOS(findClienteByName(typedName));
  };
  clienteInput?.addEventListener("input", onClienteChange);
  clienteInput?.addEventListener("keyup", onClienteChange);
  clienteInput?.addEventListener("change", onClienteChange);
  clienteInput?.addEventListener("blur", onClienteChange);
  clienteInput?.addEventListener("focusout", onClienteChange);

  byId("gerarEntradaPdfBtn")?.addEventListener("click", () => {
    gerarPDFEntrada(getOSPayloadFromForm(originalOS), { print: false });
  });

  byId("imprimirEntradaBtn")?.addEventListener("click", () => {
    gerarPDFEntrada(getOSPayloadFromForm(originalOS), { print: true });
  });

  if (osId) {
    try {
      const osSnap = await getDoc(doc(db, "ordensServico", osId));
      if (osSnap.exists()) {
        originalOS = osSnap.data();
        setValue("clienteInput", originalOS.cliente || "");
        setValue("whatsappInput", originalOS.whatsapp || originalOS.telefone || "");
        setValue("clienteCpfCnpjInput", originalOS.clienteCpfCnpj || originalOS.cpfCnpj || "");
        setValue("clienteEnderecoInput", originalOS.clienteEndereco || "");
        setValue("aparelhoInput", originalOS.dispositivo || originalOS.aparelho || "");
        setValue("marcaModeloInput", originalOS.marcaModelo || originalOS.modelo || "");
        setValue("imeiInput", originalOS.imeiSerial || originalOS.imei || "");
        setValue("tecnicoInput", originalOS.tecnico || "Admin");
        setValue("descricaoProblema", originalOS.problema || originalOS.descricao || "");
        setValue("estadoFisicoInput", originalOS.estadoFisico || "");
        setValue("statusID", statusLabel(originalOS.status));
        setValue("garantiaOS", originalOS.garantiaDias || originalOS.garantiaPadrao || "");
        setValue("pecasInput", originalOS.pecas || "");
        setValue("valorPecaInput", originalOS.valorPeca || "");
        setValue("maoObraInput", originalOS.maoObra || "");
        setValue("valorTotal", originalOS.valor || "");
      }
    } catch (error) {
      console.error("Erro ao carregar OS para edição:", error);
      showFirestoreNotice(error);
    }
  }

  osForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = getOSPayloadFromForm(originalOS);

    try {
      let savedId = osId;
      let savedOS = payload;
      if (osId) {
        await updateDoc(doc(db, "ordensServico", osId), payload);
        savedOS = { id: osId, ...originalOS, ...payload };
        showToast("OS atualizada com sucesso!");
      } else {
        const numero = await gerarNumeroOS();
        const createdPayload = {
          ...payload,
          numero,
          criadoEm: new Date().toISOString()
        };
        const created = await addDoc(collection(db, "ordensServico"), {
          ...createdPayload
        });
        savedId = created.id;
        savedOS = {
          id: created.id,
          ...createdPayload
        };
        showToast("Ordem de Serviço salva com sucesso!");
      }

      if (!originalOS || statusLabel(originalOS.status) !== statusLabel(payload.status)) {
        await criarMensagemWhatsapp(savedOS, payload.status, { abrirAgora: !osId });
      }

      osForm.reset();
      window.location.href = "listar-os.html";
    } catch (error) {
      console.error("Erro ao salvar OS:", error);
      showToast("Erro ao salvar OS. Verifique o Firebase.");
      showFirestoreNotice(error);
    }
  });
}

function getOSPayloadFromForm(originalOS = null) {
  const valorPeca = parseCurrency(valueOf("valorPecaInput"));
  const maoObra = parseCurrency(valueOf("maoObraInput"));
  const totalCalculado = valorPeca + maoObra;
  const valor = totalCalculado || parseCurrency(valueOf("valorTotal"));

  const status = valueOf("statusID") || "Recebido";
  const wasFinished = isFinished(originalOS?.status);
  const isNowFinished = isFinished(status);

  return {
    numero: originalOS?.numero || "",
    cliente: valueOf("clienteInput"),
    whatsapp: valueOf("whatsappInput"),
    clienteCpfCnpj: valueOf("clienteCpfCnpjInput"),
    clienteEndereco: valueOf("clienteEnderecoInput"),
    dispositivo: valueOf("aparelhoInput"),
    marcaModelo: valueOf("marcaModeloInput"),
    imeiSerial: valueOf("imeiInput"),
    tecnico: valueOf("tecnicoInput") || (getSession()?.nome || "Admin"),
    problema: valueOf("descricaoProblema"),
    estadoFisico: valueOf("estadoFisicoInput"),
    status,
    garantiaDias: valueOf("garantiaOS"),
    pecas: valueOf("pecasInput"),
    valorPeca,
    maoObra,
    valor,
    data: originalOS?.data || todayBR(),
    finalizadoEm: isNowFinished ? (originalOS?.finalizadoEm || new Date().toISOString()) : (wasFinished ? originalOS?.finalizadoEm : ""),
    atualizadoEm: new Date().toISOString()
  };
}

function getWhatsappTemplate(status) {
  const normalized = normalizeText(statusLabel(status));
  const templates = {
    recebido: "Olá, {cliente}. Sua {numero} foi cadastrada na MDSoltec. Equipamento recebido: {equipamento}. Em breve iniciaremos a análise.",
    "em diagnostico": "Olá, {cliente}. Sua {numero} está em diagnóstico técnico. Avisaremos assim que houver orçamento ou conclusão.",
    "aguardando aprovacao": "Olá, {cliente}. O orçamento da {numero} está pronto para aprovação. Responda esta mensagem para confirmar ou tirar dúvidas.",
    "em reparo": "Olá, {cliente}. Sua {numero} foi aprovada e está em reparo.",
    "aguardando peca": "Olá, {cliente}. Sua {numero} está aguardando peça. Avisaremos assim que o reparo puder continuar.",
    "pronto para retirada": "Olá, {cliente}. Seu equipamento da {numero} está pronto para retirada na MDSoltec.",
    finalizado: "Olá, {cliente}. Sua {numero} foi finalizada. Obrigado por confiar na MDSoltec.",
    "sem reparo": "Olá, {cliente}. Após análise, sua {numero} foi encerrada sem reparo. Estamos à disposição para explicar o diagnóstico."
  };

  return templates[normalized] || "";
}

function buildWhatsappText(os, status = os?.status) {
  const template = getWhatsappTemplate(status);
  if (!template) return "";

  return template
    .replaceAll("{cliente}", os?.cliente || "cliente")
    .replaceAll("{numero}", os?.numero || "OS")
    .replaceAll("{equipamento}", [os?.dispositivo || os?.aparelho, os?.marcaModelo || os?.modelo].filter(Boolean).join(" ") || "equipamento")
    .replaceAll("{valor}", formatMoney(os?.valor || 0));
}

function whatsappLink(phone, text) {
  const phoneDigits = digitsOnly(phone);
  if (!phoneDigits || !text) return "";
  const withCountry = phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}

async function criarMensagemWhatsapp(os, status, options = {}) {
  const texto = buildWhatsappText(os, status);
  const link = whatsappLink(os?.whatsapp || os?.telefone, texto);
  if (!texto || !link) return null;

  const payload = {
    osId: os?.id || "",
    numero: os?.numero || "",
    cliente: os?.cliente || "",
    telefone: os?.whatsapp || os?.telefone || "",
    status: statusLabel(status),
    texto,
    link,
    enviado: false,
    criadoEm: new Date().toISOString()
  };

  const created = await addDoc(collection(db, "mensagensWhatsapp"), payload);

  if (options.abrirAgora && await confirmDialog("Abrir o WhatsApp para enviar a mensagem agora?", { title: "Mensagem criada", confirmText: "Abrir WhatsApp" })) {
    window.open(link, "_blank");
  }

  return { id: created.id, ...payload };
}

async function carregarDatalists() {
  const clientesList = byId("clientes");
  const aparelhosList = byId("aparelhos");
  const pecasList = byId("pecas");

  if (clientesList) {
    const clientes = await getCollectionData("clientes");
    clientesCache = clientes;
    clientesList.innerHTML = clientes
      .map((cliente) => `<option value="${escapeHtml(cliente.nome || "")}"></option>`)
      .join("");
  }

  if (aparelhosList || pecasList) {
    const estoque = await getCollectionData("estoque");
    estoqueCache = estoque;
    if (aparelhosList) {
      aparelhosList.innerHTML = estoque
        .map((peca) => `<option value="${escapeHtml(peca.marca || "")} ${escapeHtml(peca.modelo || "")}"></option>`)
        .join("");
    }

    if (pecasList) {
      pecasList.innerHTML = estoque
        .map((peca) => `<option value="${escapeHtml(peca.tipo || "")} ${escapeHtml(peca.modelo || "")}"></option>`)
        .join("");
    }
  }
}

function initListarOS() {
  const listaOS = byId("listaOS");
  if (!listaOS) return;

  const filtroCliente = byId("filtroCliente");
  const filtroStatus = byId("filtroStatus");

  const load = async () => {
    const ordens = await getCollectionData("ordensServico");
    renderOrdens(listaOS, ordens, filtroCliente?.value, filtroStatus?.value);
  };

  filtroCliente?.addEventListener("input", load);
  filtroStatus?.addEventListener("change", load);
  load();
}

function renderOrdens(container, ordens, clienteFiltro = "", statusFiltro = "") {
  const clienteTerm = normalizeText(clienteFiltro);
  const statusTerm = normalizeText(statusFiltro);
  const filtered = ordens
    .filter((os) => !clienteTerm || normalizeText(os.cliente).includes(clienteTerm))
    .filter((os) => !statusTerm || normalizeText(statusLabel(os.status)).includes(statusTerm))
    .sort((a, b) => (toDate(b.data)?.getTime() || 0) - (toDate(a.data)?.getTime() || 0));

  if (!filtered.length) {
    container.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhuma ordem encontrada.</td></tr>`;
    return;
  }

  container.innerHTML = filtered
    .map((os) => `
      <tr>
        <td>${escapeHtml(os.numero || `OS #${os.id.slice(0, 5)}`)}</td>
        <td>${escapeHtml(os.cliente || "-")}</td>
        <td>${escapeHtml(os.dispositivo || "-")}</td>
        <td><span class="status-pill ${statusClass(os.status)}">${escapeHtml(statusLabel(os.status))}</span></td>
        <td>${formatMoney(os.valor)}</td>
        <td>${formatDate(os.data)}</td>
        <td>
          <div class="actions-inline">
            <button type="button" class="btn btn-sm btn-secondary btn-outline-primary" data-edit="${os.id}">Editar</button>
            <button type="button" class="btn btn-sm btn-secondary btn-outline-secondary" data-entry-pdf="${os.id}">Entrada</button>
            <button type="button" class="btn btn-sm btn-secondary btn-outline-secondary" data-pdf="${os.id}">Garantia</button>
            <button type="button" class="btn btn-sm btn-secondary" data-print-pdf="${os.id}">Imprimir</button>
            <button type="button" class="btn btn-sm btn-danger btn-outline-danger" data-delete="${os.id}">Excluir</button>
          </div>
        </td>
      </tr>
    `)
    .join("");

  container.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `nova-os.html?id=${button.dataset.edit}`;
    });
  });

  container.querySelectorAll("[data-pdf]").forEach((button) => {
    button.addEventListener("click", () => gerarPDF(button.dataset.pdf, { print: false, tipo: "garantia" }));
  });

  container.querySelectorAll("[data-entry-pdf]").forEach((button) => {
    button.addEventListener("click", () => gerarPDF(button.dataset.entryPdf, { print: false, tipo: "entrada" }));
  });

  container.querySelectorAll("[data-print-pdf]").forEach((button) => {
    button.addEventListener("click", () => gerarPDF(button.dataset.printPdf, { print: true, tipo: "entrada" }));
  });

  container.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmDialog("A ordem de serviço será excluída definitivamente. Continuar?", { title: "Excluir OS", confirmText: "Excluir", danger: true }))) return;

      try {
        await deleteDoc(doc(db, "ordensServico", button.dataset.delete));
        const ordens = await getCollectionData("ordensServico");
        renderOrdens(container, ordens, byId("filtroCliente")?.value, byId("filtroStatus")?.value);
      } catch (error) {
        console.error("Erro ao excluir OS:", error);
        showToast("Erro ao excluir OS.");
        showFirestoreNotice(error);
      }
    });
  });
}

async function gerarPDF(osId, options = {}) {
  if (!window.jspdf?.jsPDF) {
    showToast("Biblioteca de PDF não carregada.");
    return;
  }

  const osSnap = await getDoc(doc(db, "ordensServico", osId));
  if (!osSnap.exists()) {
    showToast("OS não encontrada.");
    return;
  }

  const os = { id: osSnap.id, ...osSnap.data() };
  if (options.tipo === "entrada") {
    await gerarPDFEntrada(os, {
      ...options,
      filename: `${os.numero || "Entrada_OS"}.pdf`
    });
    return;
  }

  await gerarPDFGarantia(os, {
    ...options,
    filename: `${os.numero || "Garantia_OS"}.pdf`
  });
}

async function gerarPDFEntrada(os, options = {}) {
  if (!window.jspdf?.jsPDF) {
    showToast("Biblioteca de PDF não carregada.");
    return;
  }

  const config = await getCompanyConfig();
  const docPDF = new window.jspdf.jsPDF();
  const margin = 15;
  let y = await addPdfHeader(docPDF, margin, config);

  docPDF.setFontSize(16);
  docPDF.text(`Entrada de Equipamento ${os.numero || ""}`, margin, y);
  y += 10;

  y = addPdfSection(docPDF, "Cliente", [
    `Nome: ${os.cliente || "-"}`,
    `CPF/CNPJ: ${os.clienteCpfCnpj || os.cpfCnpj || "-"}`,
    `WhatsApp: ${os.whatsapp || os.telefone || "-"}`,
    `Endereço: ${os.clienteEndereco || "-"}`
  ], margin, y);

  y = addPdfSection(docPDF, "Equipamento recebido", [
    `Equipamento: ${os.dispositivo || os.aparelho || "-"}`,
    `Marca/Modelo: ${os.marcaModelo || os.modelo || "-"}`,
    `IMEI/Serial: ${os.imeiSerial || os.imei || "-"}`,
    `Estado/ acessórios: ${os.estadoFisico || "-"}`,
    `Defeito relatado: ${os.problema || os.descricao || "-"}`,
    `Data de entrada: ${formatDate(os.data)}`,
    `Atendente: ${os.tecnico || getSession()?.nome || "Admin"}`
  ], margin, y);

  y = addPdfSection(docPDF, "Declaração de entrada", [
    "Este documento comprova apenas o recebimento do equipamento para análise técnica.",
    "Valores, prazos e garantia serão definidos após diagnóstico, aprovação e conclusão do serviço.",
    "A empresa não se responsabiliza por dados armazenados no equipamento. Recomenda-se backup prévio."
  ], margin, y);

  y = ensurePdfSpace(docPDF, y, 245);
  docPDF.setFontSize(9);
  docPDF.text("Assinatura do Cliente: ______________________________________________", margin, y);
  y += 11;
  docPDF.text("Assinatura do Atendente: ____________________________________________", margin, y);

  finishPdf(docPDF, options, `${os.numero || "Entrada_OS"}.pdf`);
}

async function gerarPDFGarantia(os, options = {}) {
  if (!window.jspdf?.jsPDF) {
    showToast("Biblioteca de PDF não carregada.");
    return;
  }

  const config = await getCompanyConfig();
  const docPDF = new window.jspdf.jsPDF();
  const margin = 15;
  const garantiaDias = getWarrantyDays(os, config);
  const inicioGarantia = toDate(os.finalizadoEm || os.dataFinalizacao || os.data) || new Date();
  const fimGarantia = new Date(inicioGarantia);
  fimGarantia.setDate(fimGarantia.getDate() + garantiaDias);
  let y = await addPdfHeader(docPDF, margin, config);

  docPDF.setFontSize(16);
  docPDF.text(`Termo de Garantia ${os.numero || ""}`, margin, y);
  y += 10;

  y = addPdfSection(docPDF, "Resumo do serviço", [
    `Cliente: ${os.cliente || "-"}`,
    `Equipamento: ${os.dispositivo || os.aparelho || "-"}`,
    `Marca/Modelo: ${os.marcaModelo || os.modelo || "-"}`,
    `IMEI/Serial: ${os.imeiSerial || os.imei || "-"}`,
    `Serviço/peças: ${os.pecas || os.problema || "-"}`,
    `Valor da peça: ${formatMoney(os.valorPeca)}`,
    `Mão de obra: ${formatMoney(os.maoObra)}`,
    `Valor total: ${formatMoney(os.valor)}`,
    `Conclusão: ${formatDate(inicioGarantia)}`,
    `Garantia: ${garantiaDias} dias, válida até ${formatDate(fimGarantia)}`
  ], margin, y);

  y = addPdfSection(docPDF, "Cobertura da garantia", [
    "A garantia cobre exclusivamente os serviços realizados e as peças substituídas nesta OS.",
    `O prazo de ${garantiaDias} dias inicia na data de conclusão/retirada registrada no sistema.`,
    "A cobertura não se aplica a queda, oxidação, mau uso, violação, tentativa de reparo por terceiros ou danos posteriores à retirada."
  ], margin, y);

  y = addPdfSection(docPDF, "Normas e condições", [
    "1. O cliente deve apresentar este termo ou a OS para solicitar garantia.",
    "2. A garantia será analisada tecnicamente antes de qualquer substituição ou retrabalho.",
    "3. Dados armazenados no equipamento são de responsabilidade do cliente.",
    "4. Serviços adicionais não cobertos pela garantia serão orçados separadamente.",
    "5. O cliente declara estar ciente das condições de cobertura e exclusão acima."
  ], margin, y, 4.6);

  y = ensurePdfSpace(docPDF, y, 245);
  docPDF.setFontSize(9);
  docPDF.text("Assinatura do Cliente: ______________________________________________", margin, y);
  y += 11;
  docPDF.text("Assinatura do Técnico: ______________________________________________", margin, y);

  finishPdf(docPDF, options, `${os.numero || "Garantia_OS"}.pdf`);
}

async function getCompanyConfig() {
  try {
    const configSnap = await getDoc(doc(db, "config", "empresa"));
    return configSnap.exists() ? configSnap.data() : {};
  } catch (error) {
    console.warn("Configuração da empresa não carregada para PDF:", error);
    return {};
  }
}

function getWarrantyDays(os, config = {}) {
  const days = Number.parseInt(os?.garantiaDias || os?.garantiaPadrao || config.garantiaPadrao || 90, 10);
  return Number.isFinite(days) && days > 0 ? days : 90;
}

async function addPdfHeader(docPDF, margin, config = {}) {
  let y = 12;
  try {
    const logo = await imageToDataUrl("/assets/nova_logo.png");
    docPDF.addImage(logo, "PNG", margin, y, 30, 30);
  } catch (error) {
    console.warn("Logo não adicionada ao PDF:", error);
  }

  docPDF.setFontSize(10);
  docPDF.text(config.nome || "MDSoltec OS", 55, 20);
  docPDF.text("CNPJ: 63.588.021/0001-90", 55, 26);
  docPDF.text("Endereço: Servidão 1, Alto arroio - Imbituba/SC", 55, 32);
  docPDF.text(`Telefone: ${config.whatsapp || config.telefone || "(48) 99141-3923"} | Email: mdsoltec@gmail.com`, 55, 38);
  docPDF.line(margin, 45, 195, 45);
  return 58;
}

function addPdfSection(docPDF, title, lines, margin, y, lineHeight = 5.2) {
  y = ensurePdfSpace(docPDF, y, 260);
  docPDF.setFontSize(12);
  docPDF.text(title, margin, y);
  y += 7;
  docPDF.setFontSize(10);
  lines.forEach((line) => {
    y = addWrappedPdf(docPDF, line, margin + 2, y, 174, lineHeight);
  });
  return y + 5;
}

function addWrappedPdf(docPDF, text, x, currentY, width = 170, lineHeight = 5) {
  const lines = docPDF.splitTextToSize(String(text || "-"), width);
  lines.forEach((line) => {
    if (currentY > 282) {
      docPDF.addPage();
      currentY = 18;
    }
    docPDF.text(line, x, currentY);
    currentY += lineHeight;
  });
  return currentY;
}

function ensurePdfSpace(docPDF, y, maxY = 260) {
  if (y <= maxY) return y;
  docPDF.addPage();
  return 18;
}

function finishPdf(docPDF, options, fallbackName) {
  if (options.print) {
    docPDF.autoPrint();
    window.open(docPDF.output("bloburl"), "_blank");
    return;
  }

  docPDF.save(options.filename || fallbackName);
}

function imageToDataUrl(url) {
  return fetch(url)
    .then((response) => response.blob())
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }));
}

function initClientes() {
  const clienteForm = byId("form-cliente");
  const tabela = byId("clientesTabela");
  const cpfCnpjInput = byId("cpfCnpj");
  const cpfCnpjStatus = byId("cpfCnpjStatus");
  const validarDocumentoBtn = byId("validarDocumentoBtn");

  const validarDocumento = async (autoFill = false) => {
    const documento = cpfCnpjInput?.value || "";
    const result = validateDocument(documento);

    if (!digitsOnly(documento)) {
      setStatusMessage(cpfCnpjStatus, "", "muted");
      return true;
    }

    if (!result.valid) {
      setStatusMessage(cpfCnpjStatus, `${result.type || "Documento"} inválido.`, "danger");
      return false;
    }

    setStatusMessage(cpfCnpjStatus, `${result.type} válido.`, "success");

    if (autoFill && result.type === "CNPJ") {
      try {
        setStatusMessage(cpfCnpjStatus, "CNPJ válido. Buscando dados da empresa...", "muted");
        const data = await fetchCnpjData(documento);
        setValue("nome", data.razao_social || data.nome_fantasia || valueOf("nome"));
        setValue("email", data.email || valueOf("email"));
        setValue("telefone", data.ddd_telefone_1 || data.telefone || valueOf("telefone"));
        setValue("endereco", [data.logradouro, data.numero].filter(Boolean).join(", "));
        setValue("bairro", data.bairro || "");
        setValue("cidade", data.municipio || "");
        setValue("estado", data.uf || "");
        setStatusMessage(cpfCnpjStatus, "CNPJ validado e dados preenchidos.", "success");
      } catch (error) {
        console.warn("CNPJ não preenchido automaticamente:", error);
        setStatusMessage(cpfCnpjStatus, "CNPJ válido, mas não foi possível buscar os dados públicos.", "warning");
      }
    }

    return true;
  };

  cpfCnpjInput?.addEventListener("blur", () => validarDocumento(false));
  validarDocumentoBtn?.addEventListener("click", () => validarDocumento(true));

  if (clienteForm) {
    clienteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const documentoValido = await validarDocumento(false);
      if (!documentoValido) return;

      try {
        await addDoc(collection(db, "clientes"), {
          nome: valueOf("nome"),
          cpfCnpj: valueOf("cpfCnpj") || valueOf("cpf/cnpj"),
          telefone: valueOf("telefone"),
          email: valueOf("email"),
          endereco: valueOf("endereco"),
          bairro: valueOf("bairro"),
          cidade: valueOf("cidade"),
          estado: valueOf("estado"),
          criadoEm: new Date().toISOString()
        });

        showToast("Cliente cadastrado com sucesso!");
        clienteForm.reset();
        carregarClientes();
      } catch (error) {
        console.error("Erro ao cadastrar cliente:", error);
        showToast("Erro ao cadastrar cliente.");
        showFirestoreNotice(error);
      }
    });
  }

  if (tabela) carregarClientes();
}

async function carregarClientes() {
  const tabela = byId("clientesTabela");
  if (!tabela) return;

  const [clientes, ordens] = await Promise.all([
    getCollectionData("clientes"),
    getCollectionData("ordensServico")
  ]);
  clientesCache = clientes;

  if (!clientes.length) {
    tabela.innerHTML = `<tr><td colspan="5" class="empty-state">Nenhum cliente cadastrado.</td></tr>`;
    return;
  }

  tabela.innerHTML = clientes
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"))
    .map((cliente) => {
      const ordensCliente = ordens.filter((os) => normalizeText(os.cliente) === normalizeText(cliente.nome));
      const totalGasto = ordensCliente.reduce((sum, os) => sum + parseCurrency(os.valor), 0);
      const ultimaData = ordensCliente
        .map((os) => toDate(os.data))
        .filter(Boolean)
        .sort((a, b) => b - a)[0];

      return `
        <tr>
          <td>${escapeHtml(cliente.nome || "-")}</td>
          <td>${escapeHtml(cliente.telefone || "-")}</td>
          <td>${ordensCliente.length}</td>
          <td>${ultimaData ? ultimaData.toLocaleDateString("pt-BR") : "-"}</td>
          <td>${formatMoney(totalGasto)}</td>
        </tr>
      `;
    })
    .join("");
}

function getStockFormMode() {
  return valueOf("tipoCadastroEstoque") === "produto" ? "produto" : "peca";
}

function setStockFormMode(mode = "peca") {
  const normalized = mode === "produto" ? "produto" : "peca";
  const isProduct = normalized === "produto";
  const modeSelect = byId("tipoCadastroEstoque");
  const title = byId("estoqueFormTitle");
  const submitButton = byId("salvarPecaBtn");
  const tipoPeca = byId("tipoPeca");
  const marcaPeca = byId("marcaPeca");
  const modeloInput = byId("modeloPeca");
  const modeloLabel = byId("modeloPecaLabel");

  if (modeSelect) {
    modeSelect.value = normalized;
    updateCustomSelect(modeSelect);
  }

  document.querySelectorAll(".stock-piece-field").forEach((field) => {
    field.hidden = isProduct;
  });
  document.querySelectorAll(".stock-product-field").forEach((field) => {
    field.hidden = !isProduct;
  });

  if (tipoPeca) {
    tipoPeca.required = !isProduct;
    if (isProduct) tipoPeca.value = "";
    updateCustomSelect(tipoPeca);
  }
  if (marcaPeca) {
    marcaPeca.required = !isProduct;
    if (isProduct) marcaPeca.value = "";
    updateCustomSelect(marcaPeca);
  }
  if (modeloLabel) modeloLabel.textContent = isProduct ? "Nome do produto" : "Modelo";
  if (modeloInput) modeloInput.placeholder = isProduct ? "Ex: Cabo USB-C, película, fone..." : "Ex: Galaxy A10";
  if (title) title.textContent = isProduct ? "Novo Produto" : "Nova Peça";

  const editing = isProduct ? editingProdutoId : editingPecaId;
  if (submitButton) submitButton.textContent = `${editing ? "Atualizar" : "Salvar"} ${isProduct ? "Produto" : "Peça"}`;
}

function resetStockForm(mode = getStockFormMode()) {
  const form = byId("pecaForm");
  const cancelEdit = byId("cancelEditPeca");
  editingPecaId = null;
  editingProdutoId = null;
  form?.reset();
  setStockFormMode(mode);
  if (cancelEdit) cancelEdit.hidden = true;
}

function buildStockPayload(mode) {
  const custo = parseCurrency(valueOf("valor") || valueOf("valorPeca"));
  const venda = parseCurrency(valueOf("precoVendaPeca"));
  const base = {
    codigo: valueOf("codigoPeca"),
    quantidade: Number.parseInt(valueOf("quantidadePeca"), 10) || 0,
    minimo: Number.parseInt(valueOf("minimoPeca"), 10) || 0,
    fornecedor: valueOf("fornecedorPeca"),
    dataEntrada: valueOf("dataEntradaPeca"),
    custo,
    valor: custo,
    venda,
    atualizadoEm: new Date().toISOString()
  };

  if (mode === "produto") {
    return {
      ...base,
      nome: valueOf("modeloPeca"),
      categoria: valueOf("categoriaProduto"),
      classe: "produto"
    };
  }

  return {
    ...base,
    tipo: valueOf("tipoPeca"),
    marca: valueOf("marcaPeca"),
    modelo: valueOf("modeloPeca"),
    classe: "peca"
  };
}

function fillStockForm(item, mode) {
  setStockFormMode(mode);
  setValue("codigoPeca", item.codigo || "");
  setValue("tipoPeca", item.tipo || "");
  setValue("marcaPeca", item.marca || "");
  setValue("categoriaProduto", item.categoria || "");
  setValue("modeloPeca", mode === "produto" ? item.nome || item.modelo || "" : item.modelo || "");
  setValue("quantidadePeca", item.quantidade ?? 0);
  setValue("minimoPeca", item.minimo ?? 0);
  setValue("fornecedorPeca", item.fornecedor || "");
  setValue("dataEntradaPeca", item.dataEntrada || "");
  setValue("valor", getPartCost(item).toFixed(2));
  setValue("precoVendaPeca", getPartSale(item).toFixed(2));
  syncEnhancedSelect(byId("tipoPeca"));
  syncEnhancedSelect(byId("marcaPeca"));
  setStockFormMode(mode);

  const cancelEdit = byId("cancelEditPeca");
  if (cancelEdit) cancelEdit.hidden = false;
  byId("novo-produto")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function initEstoque() {
  const pecaForm = byId("pecaForm");
  const listaPecas = byId("listaPecas");
  const listaProdutos = byId("listaProdutos");
  const cancelEdit = byId("cancelEditPeca");
  const modeSelect = byId("tipoCadastroEstoque");
  const initialMode = window.location.hash === "#produtos-pdv" ? "produto" : "peca";

  setStockFormMode(initialMode);

  cancelEdit?.addEventListener("click", () => resetStockForm(getStockFormMode()));

  modeSelect?.addEventListener("change", () => {
    editingPecaId = null;
    editingProdutoId = null;
    if (cancelEdit) cancelEdit.hidden = true;
    setStockFormMode(modeSelect.value);
  });

  document.querySelectorAll("[data-stock-mode-link]").forEach((link) => {
    link.addEventListener("click", () => setStockFormMode(link.dataset.stockModeLink));
  });

  if (pecaForm) {
    pecaForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const mode = getStockFormMode();
      const isProduct = mode === "produto";
      const payload = buildStockPayload(mode);
      const collectionName = isProduct ? "produtos" : "estoque";
      const editingId = isProduct ? editingProdutoId : editingPecaId;

      try {
        if (editingId) {
          await updateDoc(doc(db, collectionName, editingId), payload);
          showToast(`${isProduct ? "Produto" : "Peça"} atualizado(a) com sucesso!`);
        } else {
          await addDoc(collection(db, collectionName), {
            ...payload,
            criadoEm: new Date().toISOString()
          });
          showToast(`${isProduct ? "Produto" : "Peça"} cadastrado(a) com sucesso!`);
        }

        resetStockForm(mode);
        await Promise.all([carregarPecas(), carregarProdutosEstoque()]);
      } catch (error) {
        console.error(`Erro ao salvar ${isProduct ? "produto" : "peça"}:`, error);
        showToast(`Erro ao salvar ${isProduct ? "produto" : "peça"}.`);
        showFirestoreNotice(error);
      }
    });
  }

  if (listaPecas) carregarPecas();
  if (listaProdutos) carregarProdutosEstoque();
}

async function carregarPecas() {
  const listaPecas = byId("listaPecas");
  if (!listaPecas) return;

  const pecas = (await getCollectionData("estoque")).filter((item) => item.classe !== "produto");
  estoqueCache = pecas;

  if (!pecas.length) {
    listaPecas.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhuma peça técnica cadastrada.</td></tr>`;
    return;
  }

  listaPecas.innerHTML = pecas
    .sort((a, b) => String(a.modelo || "").localeCompare(String(b.modelo || ""), "pt-BR"))
    .map((peca) => {
      const produto = [peca.tipo, peca.modelo].filter(Boolean).join(" ") || peca.marca || "Peça";
      const estoqueBaixo = Number(peca.minimo || 0) > 0 && Number(peca.quantidade || 0) <= Number(peca.minimo || 0);
      const custo = getPartCost(peca);
      const venda = getPartSale(peca);

      return `
        <tr>
          <td>${escapeHtml(produto)}</td>
          <td>${escapeHtml(peca.marca || peca.tipo || "-")}</td>
          <td><span class="status-pill ${estoqueBaixo ? "status-baixo" : ""}">${Number(peca.quantidade || 0)}</span></td>
          <td>${Number(peca.minimo || 0)}</td>
          <td>${formatMoney(custo)}</td>
          <td>${formatMoney(venda)}</td>
          <td>
            <div class="actions-inline">
              <button type="button" class="btn btn-sm btn-secondary" data-edit-peca="${peca.id}">Editar</button>
              <button type="button" class="btn btn-sm btn-danger" data-delete-peca="${peca.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  listaPecas.querySelectorAll("[data-delete-peca]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmDialog("A peça será excluída do estoque técnico. Continuar?", { title: "Excluir peça", confirmText: "Excluir", danger: true }))) return;
      await deleteDoc(doc(db, "estoque", button.dataset.deletePeca));
      carregarPecas();
    });
  });

  listaPecas.querySelectorAll("[data-edit-peca]").forEach((button) => {
    button.addEventListener("click", () => {
      const peca = pecas.find((item) => item.id === button.dataset.editPeca);
      if (!peca) return;

      editingPecaId = peca.id;
      editingProdutoId = null;
      fillStockForm(peca, "peca");
    });
  });
}

async function carregarProdutosEstoque() {
  const listaProdutos = byId("listaProdutos");
  if (!listaProdutos) return;

  const produtos = await getCollectionData("produtos");
  produtosCache = produtos;

  if (!produtos.length) {
    listaProdutos.innerHTML = `<tr><td colspan="7" class="empty-state">Nenhum produto de venda cadastrado.</td></tr>`;
    return;
  }

  listaProdutos.innerHTML = produtos
    .sort((a, b) => produtoLabel(a).localeCompare(produtoLabel(b), "pt-BR"))
    .map((produto) => {
      const estoqueBaixo = Number(produto.minimo || 0) > 0 && Number(produto.quantidade || 0) <= Number(produto.minimo || 0);
      const custo = getPartCost(produto);
      const venda = getPartSale(produto);

      return `
        <tr>
          <td>${escapeHtml(produtoLabel(produto))}</td>
          <td>${escapeHtml(produto.categoria || "-")}</td>
          <td><span class="status-pill ${estoqueBaixo ? "status-baixo" : ""}">${Number(produto.quantidade || 0)}</span></td>
          <td>${Number(produto.minimo || 0)}</td>
          <td>${formatMoney(custo)}</td>
          <td>${formatMoney(venda)}</td>
          <td>
            <div class="actions-inline">
              <button type="button" class="btn btn-sm btn-secondary" data-edit-produto="${produto.id}">Editar</button>
              <button type="button" class="btn btn-sm btn-danger" data-delete-produto="${produto.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  listaProdutos.querySelectorAll("[data-delete-produto]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!(await confirmDialog("O produto será excluído do estoque de venda. Continuar?", { title: "Excluir produto", confirmText: "Excluir", danger: true }))) return;
      await deleteDoc(doc(db, "produtos", button.dataset.deleteProduto));
      carregarProdutosEstoque();
    });
  });

  listaProdutos.querySelectorAll("[data-edit-produto]").forEach((button) => {
    button.addEventListener("click", () => {
      const produto = produtos.find((item) => item.id === button.dataset.editProduto);
      if (!produto) return;

      editingProdutoId = produto.id;
      editingPecaId = null;
      fillStockForm(produto, "produto");
    });
  });
}

function produtoLabel(item) {
  return item?.nome ||
    item?.descricao ||
    [item?.tipo, item?.marca, item?.modelo].filter(Boolean).join(" ") ||
    item?.codigo ||
    "Produto";
}

async function initPDV() {
  if (page !== "pdv") return;

  await carregarProdutosPDV();
  await carregarVendasPDV();
  renderCarrinhoPDV();

  byId("pdvAdicionar")?.addEventListener("click", adicionarItemPDV);
  byId("pdvFinalizar")?.addEventListener("click", finalizarVendaPDV);
  byId("pdvDesconto")?.addEventListener("input", renderCarrinhoPDV);
}

async function carregarProdutosPDV() {
  const select = byId("pdvProduto");
  if (!select) return;

  produtosCache = await getCollectionData("produtos");
  const produtos = produtosCache
    .filter((produto) => Number(produto.quantidade || 0) > 0)
    .sort((a, b) => produtoLabel(a).localeCompare(produtoLabel(b), "pt-BR"));

  select.innerHTML = produtos.length
    ? produtos.map((produto) => `
        <option value="${produto.id}">
          ${escapeHtml(produtoLabel(produto))} - ${formatMoney(getPartSale(produto))} (${Number(produto.quantidade || 0)} un.)
        </option>
      `).join("")
    : `<option value="">Nenhum produto disponível</option>`;

  syncEnhancedSelect(select);
}

function adicionarItemPDV() {
  const produtoId = valueOf("pdvProduto");
  const produto = produtosCache.find((item) => item.id === produtoId);
  const quantidade = Number.parseInt(valueOf("pdvQuantidade"), 10) || 1;
  if (!produto || quantidade <= 0) return;

  const emCarrinho = pdvCarrinho.find((item) => item.id === produto.id);
  const quantidadeAtual = emCarrinho?.quantidade || 0;
  const estoqueDisponivel = Number(produto.quantidade || 0);
  if (quantidadeAtual + quantidade > estoqueDisponivel) {
    showToast("Quantidade maior que o estoque disponível.");
    return;
  }

  if (emCarrinho) {
    emCarrinho.quantidade += quantidade;
  } else {
    pdvCarrinho.push({
      id: produto.id,
      codigo: produto.codigo || "",
      nome: produtoLabel(produto),
      quantidade,
      unitario: getPartSale(produto),
      custo: getPartCost(produto)
    });
  }

  setValue("pdvQuantidade", "1");
  renderCarrinhoPDV();
}

function renderCarrinhoPDV() {
  const tabela = byId("pdvItens");
  const totalEl = byId("pdvTotal");
  if (!tabela || !totalEl) return;

  const subtotal = pdvCarrinho.reduce((sum, item) => sum + item.unitario * item.quantidade, 0);
  const desconto = Math.min(parseCurrency(valueOf("pdvDesconto")), subtotal);
  const total = Math.max(subtotal - desconto, 0);

  totalEl.textContent = formatMoney(total);
  tabela.innerHTML = pdvCarrinho.length
    ? pdvCarrinho.map((item) => `
        <tr>
          <td>${escapeHtml(item.nome)}</td>
          <td>${item.quantidade}</td>
          <td>${formatMoney(item.unitario)}</td>
          <td>${formatMoney(item.unitario * item.quantidade)}</td>
          <td><button type="button" class="btn btn-sm btn-danger" data-remove-pdv="${item.id}">Remover</button></td>
        </tr>
      `).join("")
    : `<tr><td colspan="5" class="empty-state">Nenhum item no carrinho.</td></tr>`;

  tabela.querySelectorAll("[data-remove-pdv]").forEach((button) => {
    button.addEventListener("click", () => {
      pdvCarrinho = pdvCarrinho.filter((item) => item.id !== button.dataset.removePdv);
      renderCarrinhoPDV();
    });
  });
}

async function finalizarVendaPDV() {
  if (!pdvCarrinho.length) {
    showToast("Adicione pelo menos um produto.");
    return;
  }

  const subtotal = pdvCarrinho.reduce((sum, item) => sum + item.unitario * item.quantidade, 0);
  const desconto = Math.min(parseCurrency(valueOf("pdvDesconto")), subtotal);
  const total = Math.max(subtotal - desconto, 0);
  const venda = {
    codigo: `PDV-${Date.now().toString().slice(-8)}`,
    itens: pdvCarrinho.map((item) => ({ ...item })),
    subtotal,
    desconto,
    total,
    pagamento: valueOf("pdvPagamento") || "Dinheiro",
    larguraCupom: valueOf("pdvLarguraCupom") || "80mm",
    vendedor: getSession()?.nome || "Admin",
    status: "Finalizada",
    data: new Date().toISOString(),
    criadoEm: new Date().toISOString()
  };

  try {
    const vendaDoc = await addDoc(collection(db, "vendasPDV"), venda);
    await Promise.all(pdvCarrinho.map((item) => {
      const produto = produtosCache.find((produtoItem) => produtoItem.id === item.id);
      const novaQuantidade = Math.max(Number(produto?.quantidade || 0) - item.quantidade, 0);
      return updateDoc(doc(db, "produtos", item.id), {
        quantidade: novaQuantidade,
        atualizadoEm: new Date().toISOString()
      });
    }));

    const vendaFinal = { id: vendaDoc.id, ...venda };
    imprimirCupomPDV(vendaFinal);
    pdvCarrinho = [];
    setValue("pdvDesconto", "");
    renderCarrinhoPDV();
    await carregarProdutosPDV();
    await carregarVendasPDV();
    showToast("Venda finalizada com sucesso!");
  } catch (error) {
    console.error("Erro ao finalizar venda PDV:", error);
    showToast("Erro ao finalizar venda.");
    showFirestoreNotice(error);
  }
}

async function carregarVendasPDV() {
  const tabela = byId("pdvVendas");
  if (!tabela) return;

  const vendas = (await getCollectionData("vendasPDV"))
    .filter(isSaleActive)
    .sort((a, b) => (toDate(getSaleDate(b))?.getTime() || 0) - (toDate(getSaleDate(a))?.getTime() || 0));

  tabela.innerHTML = vendas.length
    ? vendas.slice(0, 8).map((venda) => `
        <tr>
          <td>${escapeHtml(venda.codigo || venda.id)}</td>
          <td>${formatDate(getSaleDate(venda))}</td>
          <td>${escapeHtml(venda.pagamento || "-")}</td>
          <td>${formatMoney(venda.total)}</td>
          <td><button type="button" class="btn btn-sm btn-secondary" data-cupom-pdv="${venda.id}">Imprimir</button></td>
        </tr>
      `).join("")
    : `<tr><td colspan="5" class="empty-state">Nenhuma venda registrada.</td></tr>`;

  tabela.querySelectorAll("[data-cupom-pdv]").forEach((button) => {
    button.addEventListener("click", () => {
      const venda = vendas.find((item) => item.id === button.dataset.cupomPdv);
      if (venda) imprimirCupomPDV(venda);
    });
  });
}

function imprimirCupomPDV(venda) {
  const larguraCupom = venda.larguraCupom || valueOf("pdvLarguraCupom") || "80mm";
  const padding = larguraCupom === "58mm" ? "4mm" : "6mm";
  const fontSize = larguraCupom === "58mm" ? "10px" : "11px";
  const linhas = (venda.itens || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.nome)}</td>
      <td>${item.quantidade}</td>
      <td>${formatMoney(item.unitario)}</td>
      <td>${formatMoney(item.quantidade * item.unitario)}</td>
    </tr>
  `).join("");

  const html = `
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <title>${escapeHtml(venda.codigo || "Cupom não fiscal")}</title>
      <style>
        @page { size: ${larguraCupom} auto; margin: 0; }
        * { box-sizing: border-box; }
        body { font-family: Consolas, "Courier New", monospace; width: ${larguraCupom}; margin: 0; padding: ${padding}; color: #000; }
        h1, h2, p { margin: 0 0 6px; }
        h1 { font-size: 15px; text-align: center; letter-spacing: 0; }
        h2 { font-size: 12px; text-align: center; font-weight: 700; }
        .line { border-top: 1px dashed #000; margin: 7px 0; }
        table { width: 100%; border-collapse: collapse; font-size: ${fontSize}; margin-top: 6px; }
        th, td { border-bottom: 1px dashed #999; padding: 3px 0; text-align: left; vertical-align: top; }
        th:first-child, td:first-child { max-width: ${larguraCupom === "58mm" ? "28mm" : "44mm"}; word-break: break-word; }
        td:nth-child(n+2), th:nth-child(n+2) { text-align: right; }
        .total { margin-top: 6px; font-size: 12px; font-weight: 700; text-align: right; }
        .note { margin-top: 8px; font-size: 9px; text-align: center; }
        @media print { body { width: ${larguraCupom}; } }
      </style>
    </head>
    <body>
      <h1>MDSoltec OS</h1>
      <h2>CUPOM NÃO FISCAL</h2>
      <p style="text-align:center">${escapeHtml(venda.codigo || "")}</p>
      <div class="line"></div>
      <p>Data: ${formatDate(getSaleDate(venda))}</p>
      <p>Pagamento: ${escapeHtml(venda.pagamento || "-")}</p>
      <p>Vendedor: ${escapeHtml(venda.vendedor || "-")}</p>
      <table>
        <thead><tr><th>Item</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="line"></div>
      <p class="total">Subtotal: ${formatMoney(venda.subtotal)}</p>
      <p class="total">Desconto: ${formatMoney(venda.desconto)}</p>
      <p class="total">Total: ${formatMoney(venda.total)}</p>
      <p class="note">SEM VALOR FISCAL<br>Documento interno de controle de venda.</p>
      <script>window.onload = () => { window.print(); };</script>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Permita pop-ups para imprimir o cupom.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

async function initMensagens() {
  if (page !== "mensagens") return;

  renderMessageTemplates();
  byId("refreshMensagens")?.addEventListener("click", carregarMensagensWhatsapp);
  byId("gerarPendentesMensagens")?.addEventListener("click", gerarMensagensPendentes);
  await carregarMensagensWhatsapp();
}

function renderMessageTemplates() {
  const container = byId("mensagensModelos");
  if (!container) return;

  const statuses = [
    "Recebido",
    "Em diagnóstico",
    "Aguardando aprovação",
    "Em reparo",
    "Aguardando peça",
    "Pronto para retirada",
    "Finalizado",
    "Sem reparo"
  ];

  container.innerHTML = statuses.map((status) => `
    <article class="message-card ${normalizeText(status).includes("aguardando") ? "warning" : ""}">
      <strong>${escapeHtml(status)}</strong><br>
      ${escapeHtml(buildWhatsappText({ cliente: "Cliente", numero: "OS #000", dispositivo: "Equipamento" }, status))}
    </article>
  `).join("");
}

async function carregarMensagensWhatsapp() {
  const tabela = byId("mensagensTabela");
  if (!tabela) return;

  const mensagens = (await getCollectionData("mensagensWhatsapp"))
    .sort((a, b) => (toDate(b.criadoEm)?.getTime() || 0) - (toDate(a.criadoEm)?.getTime() || 0));

  tabela.innerHTML = mensagens.length
    ? mensagens.slice(0, 30).map((mensagem) => `
        <tr>
          <td>${formatDate(mensagem.criadoEm)}</td>
          <td>${escapeHtml(mensagem.cliente || "-")}<br><small>${escapeHtml(mensagem.telefone || "")}</small></td>
          <td><span class="status-pill ${mensagem.enviado ? "status-ativo" : "status-garantia"}">${escapeHtml(mensagem.enviado ? "Enviada" : mensagem.status || "Pendente")}</span></td>
          <td>${escapeHtml(mensagem.texto || "-")}</td>
          <td>
            <div class="actions-inline">
              <button type="button" class="btn btn-sm btn-secondary" data-send-msg="${mensagem.id}">Enviar</button>
              <button type="button" class="btn btn-sm btn-secondary" data-done-msg="${mensagem.id}">Marcar enviada</button>
            </div>
          </td>
        </tr>
      `).join("")
    : `<tr><td colspan="5" class="empty-state">Nenhuma mensagem gerada ainda.</td></tr>`;

  tabela.querySelectorAll("[data-send-msg]").forEach((button) => {
    button.addEventListener("click", async () => {
      const mensagem = mensagens.find((item) => item.id === button.dataset.sendMsg);
      if (!mensagem?.link) return;
      window.open(mensagem.link, "_blank");
      await updateDoc(doc(db, "mensagensWhatsapp", mensagem.id), {
        enviado: true,
        enviadoEm: new Date().toISOString()
      });
      await carregarMensagensWhatsapp();
    });
  });

  tabela.querySelectorAll("[data-done-msg]").forEach((button) => {
    button.addEventListener("click", async () => {
      await updateDoc(doc(db, "mensagensWhatsapp", button.dataset.doneMsg), {
        enviado: true,
        enviadoEm: new Date().toISOString()
      });
      await carregarMensagensWhatsapp();
    });
  });
}

async function gerarMensagensPendentes() {
  const [ordens, mensagens] = await Promise.all([
    getCollectionData("ordensServico"),
    getCollectionData("mensagensWhatsapp")
  ]);

  const existentes = new Set(mensagens.map((mensagem) => `${mensagem.osId || ""}|${statusLabel(mensagem.status)}`));
  let criadas = 0;

  for (const os of ordens) {
    const status = statusLabel(os.status);
    const key = `${os.id}|${status}`;
    if (!os.whatsapp && !os.telefone) continue;
    if (!getWhatsappTemplate(status)) continue;
    if (existentes.has(key)) continue;

    await criarMensagemWhatsapp(os, status, { abrirAgora: false });
    existentes.add(key);
    criadas += 1;
  }

  showToast(criadas ? `${criadas} mensagem(ns) pendente(s) gerada(s).` : "Não há novas mensagens pendentes para gerar.");
  await carregarMensagensWhatsapp();
}

async function initDashboard() {
  if (page !== "dashboard") return;

  const [ordens, estoque, produtos, vendasPDV] = await Promise.all([
    getCollectionData("ordensServico"),
    getCollectionData("estoque"),
    getCollectionData("produtos"),
    getCollectionData("vendasPDV")
  ]);
  const custosEstoque = [...estoque, ...produtos];

  const monthSelect = byId("dashboardMonth");
  const selectedMonth = populateMonthSelect(
    monthSelect,
    [...ordens.map(getOSRevenueDate), ...custosEstoque.map(getPecaDate), ...vendasPDV.map(getSaleDate)]
  );
  const render = () => renderDashboardMonth(ordens, custosEstoque, vendasPDV, monthSelect?.value || selectedMonth);
  monthSelect?.addEventListener("change", render);
  render();
}

function renderDashboardMonth(ordens, estoque, vendasPDV, selectedMonth) {
  const ordensMes = ordens.filter((os) => isInMonth(os.data, selectedMonth));
  const ordensFinalizadasMes = ordens
    .filter((os) => isFinished(os.status))
    .filter((os) => isInMonth(getOSRevenueDate(os), selectedMonth));
  const vendasMes = vendasPDV
    .filter(isSaleActive)
    .filter((venda) => isInMonth(getSaleDate(venda), selectedMonth));
  const estoqueMes = estoque.filter((peca) => isInMonth(getPecaDate(peca), selectedMonth, true));
  const abertas = ordensMes.filter((os) => !isFinished(os.status));
  const concluidas = ordensFinalizadasMes;
  const faturamentoOS = ordensFinalizadasMes.reduce((sum, os) => sum + parseCurrency(os.valor), 0);
  const faturamentoPDV = vendasMes.reduce((sum, venda) => sum + parseCurrency(venda.total), 0);
  const faturamento = faturamentoOS + faturamentoPDV;
  const custoEstoque = estoqueMes.reduce((sum, peca) => sum + getPartCost(peca) * Number(peca.quantidade || 0), 0);
  const lucro = Math.max(faturamento - custoEstoque, 0);
  const atrasadas = abertas.filter((os) => {
    const data = toDate(os.data);
    if (!data) return false;
    const diffDays = (Date.now() - data.getTime()) / 86400000;
    return diffDays > 7 || normalizeText(os.status).includes("atraso");
  });

  setText("dashOpenOS", abertas.length);
  setText("dashOverdueOS", atrasadas.length);
  setText("dashRevenue", formatMoney(faturamento));
  setText("dashProfit", formatMoney(lucro));
  setText("dashDone", concluidas.length);
  setText("dashAvg", formatMoney(concluidas.length ? faturamento / concluidas.length : faturamento / Math.max(ordensMes.length, 1)));

  const receitaGrafico = [
    ...ordensFinalizadasMes.map((os) => ({ data: getOSRevenueDate(os), valor: os.valor })),
    ...vendasMes.map((venda) => ({ data: getSaleDate(venda), valor: venda.total }))
  ];
  renderRevenueChart(receitaGrafico, selectedMonth);
  renderStatusLegend(ordensMes);
  renderDashboardLists(ordensMes);
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function renderRevenueChart(receitas, selectedMonth = currentMonthKey()) {
  const chart = byId("revenueChart");
  if (!chart) return;

  const monthDates = [...new Map(receitas
    .map((item) => toDate(item.data))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime())
    .map((date) => [date.toLocaleDateString("pt-BR"), date])).values()];

  let days = monthDates.slice(-7);
  if (!days.length) {
    const [year, month] = String(selectedMonth || currentMonthKey()).split("-").map(Number);
    const reference = selectedMonth === currentMonthKey()
      ? new Date()
      : new Date(year || new Date().getFullYear(), month || new Date().getMonth(), 0);

    days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(reference);
      date.setDate(date.getDate() - (6 - index));
      return date;
    });
  }

  const values = days.map((date) => {
    const key = date.toLocaleDateString("pt-BR");
    return receitas
      .filter((item) => formatDate(item.data) === key)
      .reduce((sum, item) => sum + parseCurrency(item.valor), 0);
  });

  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = 40 + index * 110;
      const y = 190 - (value / max) * 150;
      return `${x},${y}`;
    })
    .join(" ");

  chart.innerHTML = `
    <svg viewBox="0 0 760 220" role="img" aria-label="Faturamento dos últimos 7 dias">
      <defs>
        <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00f03d" stop-opacity="0.32" />
          <stop offset="100%" stop-color="#00f03d" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      ${[0, 1, 2, 3, 4].map((line) => `<line x1="40" y1="${40 + line * 37}" x2="720" y2="${40 + line * 37}" stroke="#27312b" />`).join("")}
      ${days.map((day, index) => `<text x="${30 + index * 110}" y="212" fill="#9aa8a0" font-size="12">${day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</text>`).join("")}
      <polygon points="40,190 ${points} 700,190" fill="url(#lineFill)" />
      <polyline points="${points}" fill="none" stroke="#00f03d" stroke-width="4" />
      ${points.split(" ").map((point) => {
        const [x, y] = point.split(",");
        return `<circle cx="${x}" cy="${y}" r="5" fill="#07150d" stroke="#00f03d" stroke-width="3" />`;
      }).join("")}
    </svg>
  `;
}

function renderStatusLegend(ordens) {
  const legend = byId("statusLegend");
  if (!legend) return;

  const counts = ordens.reduce((acc, os) => {
    const label = statusLabel(os.status);
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const colors = ["#00d21e", "#3aa0ff", "#7fa36b", "#55d84f", "#f1cf00", "#ff9800"];
  const entries = Object.entries(counts);

  if (!entries.length) {
    legend.innerHTML = `<li class="empty-state">Sem ordens para exibir.</li>`;
    return;
  }

  legend.innerHTML = entries
    .map(([label, count], index) => `
      <li class="legend-item">
        <span><span class="legend-dot" style="background:${colors[index % colors.length]}"></span>${escapeHtml(label)}</span>
        <strong>${count}</strong>
      </li>
    `)
    .join("");
}

function renderDashboardLists(ordens) {
  const latest = byId("latestOS");
  const upcoming = byId("upcomingDeliveries");
  const ranking = byId("servicesRanking");

  const sorted = [...ordens].sort((a, b) => (toDate(b.data)?.getTime() || 0) - (toDate(a.data)?.getTime() || 0));

  if (latest) {
    latest.innerHTML = sorted.slice(0, 5).map((os) => `
      <tr>
        <td>${escapeHtml(os.numero || "-")}</td>
        <td>${formatDate(os.data)}</td>
        <td>${escapeHtml(os.cliente || "-")}</td>
        <td><span class="status-pill ${statusClass(os.status)}">${escapeHtml(statusLabel(os.status))}</span></td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="empty-state">Nenhuma OS cadastrada.</td></tr>`;
  }

  if (upcoming) {
    upcoming.innerHTML = sorted
      .filter((os) => !isFinished(os.status))
      .slice(0, 5)
      .map((os) => `
        <li class="compact-item">
          <span><strong>${escapeHtml(os.numero || "-")}</strong><br><small>${escapeHtml(os.cliente || "-")}</small></span>
          <strong>${formatDate(addDays(os.data, 1))}</strong>
        </li>
      `)
      .join("") || `<li class="empty-state">Nenhuma entrega pendente.</li>`;
  }

  if (ranking) {
    const counts = sorted.reduce((acc, os) => {
      const service = os.pecas || os.problema || "Serviço técnico";
      acc[service] = (acc[service] || 0) + 1;
      return acc;
    }, {});

    ranking.innerHTML = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count], index) => `
        <li class="rank-item">
          <span><span class="rank-number">${index + 1}</span>${escapeHtml(label)}</span>
          <strong>${count}</strong>
        </li>
      `)
      .join("") || `<li class="empty-state">Sem dados suficientes.</li>`;
  }
}

async function initFinanceiro() {
  if (page !== "financeiro") return;

  const [ordens, estoque, produtos, vendasPDV] = await Promise.all([
    getCollectionData("ordensServico"),
    getCollectionData("estoque"),
    getCollectionData("produtos"),
    getCollectionData("vendasPDV")
  ]);
  const custosEstoque = [...estoque, ...produtos];

  const monthSelect = byId("financeMonth");
  const selectedMonth = populateMonthSelect(
    monthSelect,
    [...ordens.map(getOSRevenueDate), ...custosEstoque.map(getPecaDate), ...vendasPDV.map(getSaleDate)]
  );
  const render = () => renderFinanceiroMonth(ordens, custosEstoque, vendasPDV, monthSelect?.value || selectedMonth);
  monthSelect?.addEventListener("change", render);
  render();
}

function renderFinanceiroMonth(ordens, estoque, vendasPDV, selectedMonth) {
  const ordensMes = ordens
    .filter((os) => isFinished(os.status))
    .filter((os) => isInMonth(getOSRevenueDate(os), selectedMonth));
  const vendasMes = vendasPDV
    .filter(isSaleActive)
    .filter((venda) => isInMonth(getSaleDate(venda), selectedMonth));
  const estoqueMes = estoque.filter((peca) => isInMonth(getPecaDate(peca), selectedMonth, true));
  const entradasOS = ordensMes.reduce((sum, os) => sum + parseCurrency(os.valor), 0);
  const entradasPDV = vendasMes.reduce((sum, venda) => sum + parseCurrency(venda.total), 0);
  const entradas = entradasOS + entradasPDV;
  const saidas = estoqueMes.reduce((sum, peca) => sum + getPartCost(peca) * Number(peca.quantidade || 0), 0);
  setText("financeEntradas", formatMoney(entradas));
  setText("financeSaidas", formatMoney(saidas));
  setText("financeLucro", formatMoney(entradas - saidas));

  const tabela = byId("financeTable");
  if (!tabela) return;

  const entradasRows = ordensMes.map((os) => ({
    data: getOSRevenueDate(os),
    descricao: `${os.pecas || "Serviço"} ${os.numero || ""}`.trim(),
    tipo: "Entrada",
    valor: parseCurrency(os.valor)
  }));
  const pdvRows = vendasMes.map((venda) => ({
    data: getSaleDate(venda),
    descricao: `PDV ${venda.codigo || venda.id || ""}`.trim(),
    tipo: "Entrada",
    valor: parseCurrency(venda.total)
  }));
  const saidasRows = estoqueMes.map((peca) => ({
    data: getPecaDate(peca),
    descricao: `Compra de ${produtoLabel(peca)}`.trim(),
    tipo: "Saída",
    valor: getPartCost(peca) * Number(peca.quantidade || 0)
  }));

  tabela.innerHTML = [...entradasRows, ...pdvRows, ...saidasRows]
    .sort((a, b) => (toDate(b.data)?.getTime() || 0) - (toDate(a.data)?.getTime() || 0))
    .slice(0, 12)
    .map((item) => `
      <tr>
        <td>${formatDate(item.data)}</td>
        <td>${escapeHtml(item.descricao)}</td>
        <td><span class="status-pill ${item.tipo === "Saída" ? "status-aprovacao" : ""}">${item.tipo}</span></td>
        <td>${formatMoney(item.valor)}</td>
      </tr>
    `)
    .join("") || `<tr><td colspan="4" class="empty-state">Nenhuma movimentação financeira.</td></tr>`;
}

async function initRelatorios() {
  if (page !== "relatorios") return;

  const ordens = await getCollectionData("ordensServico");
  const concluidasLista = ordens.filter((os) => isFinished(os.status));
  renderRanking("lucrativeServices", concluidasLista, (os) => os.pecas || os.problema || "Serviço técnico", (os) => parseCurrency(os.valor), true);
  renderRanking("brandsRanking", concluidasLista, (os) => String(os.marcaModelo || os.dispositivo || "Sem marca").split(" ")[0], () => 1, false);

  const total = concluidasLista.reduce((sum, os) => sum + parseCurrency(os.valor), 0);
  setText("reportAvgTicket", `Ticket médio: ${formatMoney(total / Math.max(concluidasLista.length, 1))}`);
  setText("reportApproval", `Taxa de finalização: ${Math.round((concluidasLista.length / Math.max(ordens.length, 1)) * 100)}%`);
}

function renderRanking(id, ordens, keyFn, valueFn, money) {
  const list = byId(id);
  if (!list) return;

  const grouped = ordens.reduce((acc, os) => {
    const key = keyFn(os);
    acc[key] = (acc[key] || 0) + valueFn(os);
    return acc;
  }, {});

  list.innerHTML = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value], index) => `
      <li class="rank-item">
        <span><span class="rank-number">${index + 1}</span>${escapeHtml(label)}</span>
        <strong>${money ? formatMoney(value) : value}</strong>
      </li>
    `)
    .join("") || `<li class="empty-state">Sem dados suficientes.</li>`;
}

async function initGarantias() {
  if (page !== "garantias") return;

  const tabela = byId("garantiasTabela");
  if (!tabela) return;

  const ordens = await getCollectionData("ordensServico");
  const config = await getCompanyConfig();
  const garantias = ordens
    .filter((os) => isFinished(os.status))
    .map((os) => {
      const inicio = toDate(os.finalizadoEm || os.dataFinalizacao || os.data) || new Date();
      const fim = addDays(inicio, getWarrantyDays(os, config));
      const dias = Math.ceil((fim.getTime() - Date.now()) / 86400000);
      const garantiaStatus = dias < 0
        ? "Expirada"
        : dias <= 7
          ? "Próxima do fim"
          : "Em garantia";
      return {
        ...os,
        inicio,
        fim,
        garantiaStatus
      };
    });

  tabela.innerHTML = garantias
    .map((os) => `
      <tr>
        <td>${escapeHtml(os.numero || "-")}</td>
        <td>${escapeHtml(os.cliente || "-")}</td>
        <td>${escapeHtml(os.pecas || os.problema || "-")}</td>
        <td>${formatDate(os.inicio)}</td>
        <td>${formatDate(os.fim)}</td>
        <td><span class="status-pill ${os.garantiaStatus === "Expirada" ? "status-atraso" : os.garantiaStatus === "Próxima do fim" ? "status-garantia" : "status-ativo"}">${os.garantiaStatus}</span></td>
        <td><button type="button" class="btn btn-sm btn-secondary" data-garantia-pdf="${os.id}">PDF garantia</button></td>
      </tr>
    `)
    .join("") || `<tr><td colspan="7" class="empty-state">Nenhuma garantia ativa.</td></tr>`;

  tabela.querySelectorAll("[data-garantia-pdf]").forEach((button) => {
    button.addEventListener("click", () => gerarPDF(button.dataset.garantiaPdf, { print: false, tipo: "garantia" }));
  });
}

function initFichaTecnica() {
  const form = byId("technicalForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await addDoc(collection(db, "fichasTecnicas"), {
        marca: valueOf("marcaFicha"),
        modelo: valueOf("modeloFicha"),
        defeitos: valueOf("defeitosFicha"),
        solucoes: valueOf("solucoesFicha"),
        criadoEm: new Date().toISOString()
      });
      showToast("Ficha técnica salva com sucesso!");
      form.reset();
    } catch (error) {
      console.error("Erro ao salvar ficha técnica:", error);
      showToast("Erro ao salvar ficha técnica.");
      showFirestoreNotice(error);
    }
  });
}

async function initConfiguracoes() {
  const form = byId("configForm");
  if (!form) return;

  const session = getSession() || DEFAULT_SESSION;
  const authUser = await getAuthUserOnce();
  setValue("topbarNome", session.nome || authUser?.displayName || "Admin");

  try {
    const configSnap = await getDoc(doc(db, "config", "empresa"));
    if (configSnap.exists()) {
      const config = configSnap.data();
      setValue("empresaNome", config.nome || "MDSoltec");
      setValue("empresaWhatsapp", config.whatsapp || config.telefone || config.celular || "");
      setValue("garantiaPadrao", config.garantiaPadrao || "90");
    }
  } catch (error) {
    console.warn("Configurações não carregadas:", error);
    showFirestoreNotice(error);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const whatsapp = valueOf("empresaWhatsapp");
    const displayName = valueOf("topbarNome") || session.nome || authUser?.displayName || "Admin";

    try {
      await setDoc(doc(db, "config", "empresa"), {
        nome: valueOf("empresaNome"),
        whatsapp,
        telefone: whatsapp,
        garantiaPadrao: valueOf("garantiaPadrao"),
        atualizadoEm: new Date().toISOString()
      }, { merge: true });

      try {
        await saveCurrentProfileName(displayName);
      } catch (profileError) {
        console.warn("Perfil local atualizado, mas o cadastro do usuário não foi sincronizado:", profileError);
        showFirestoreNotice(profileError);
      }

      showToast("Configurações salvas com sucesso!");
      refreshTopbarProfile();
      await carregarFuncionarios();
    } catch (error) {
      console.error("Erro ao salvar configurações:", error);
      showToast("Erro ao salvar configurações.");
      showFirestoreNotice(error);
    }
  });
}

async function saveCurrentProfileName(displayName) {
  const authUser = await getAuthUserOnce(300);
  const session = getSession() || DEFAULT_SESSION;
  const email = authUser?.email || session.email;
  const nextSession = {
    ...session,
    nome: displayName,
    email: email || session.email,
    cargo: session.cargo || (session.role === "admin" ? "Administrador" : "Usuário")
  };

  setSession(nextSession);
  if (!email) return;

  const existing = await findUserProfile(email);
  const payload = {
    nome: displayName,
    email,
    cargo: existing?.cargo || nextSession.cargo,
    ativo: existing?.ativo ?? true,
    atualizadoEm: new Date().toISOString()
  };

  if (existing?.id) {
    await updateDoc(doc(db, "usuarios", existing.id), payload);
    return;
  }

  await setDoc(doc(db, "usuarios", userDocId(email)), {
    ...payload,
    role: nextSession.role || "admin",
    criadoEm: new Date().toISOString()
  }, { merge: true });
}

function initFuncionarios() {
  const form = byId("funcionarioForm");
  const tabela = byId("funcionariosTabela");
  if (!form && !tabela) return;

  if (!hasPermission("configuracoes")) {
    form?.closest(".form-panel")?.remove();
    tabela?.closest(".table-panel")?.remove();
    return;
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      nome: valueOf("funcionarioNome"),
      email: valueOf("funcionarioEmail"),
      cargo: valueOf("funcionarioCargo"),
      role: valueOf("funcionarioPerfil") || "atendente",
      ativo: byId("funcionarioAtivo")?.checked ?? true,
      atualizadoEm: new Date().toISOString()
    };

    try {
      const existing = await findUserProfile(payload.email);
      if (existing?.id) {
        await updateDoc(doc(db, "usuarios", existing.id), payload);
        showToast("Funcionário atualizado. Se ele ainda não acessa, crie também o usuário no Firebase Auth.");
      } else {
        await setDoc(doc(db, "usuarios", userDocId(payload.email)), {
          ...payload,
          criadoEm: new Date().toISOString()
        }, { merge: true });
        showToast("Funcionário cadastrado. Crie também o usuário no Firebase Auth para login com senha real.");
      }

      form.reset();
      await carregarFuncionarios();
    } catch (error) {
      console.error("Erro ao cadastrar funcionário:", error);
      showToast("Erro ao cadastrar funcionário.");
      showFirestoreNotice(error);
    }
  });

  carregarFuncionarios();
}

async function carregarFuncionarios() {
  const tabela = byId("funcionariosTabela");
  if (!tabela) return;

  const [funcionarios, authUser] = await Promise.all([
    getCollectionData("usuarios"),
    getAuthUserOnce()
  ]);
  const session = getSession();
  const currentProfile = session || (authUser ? {
    nome: authUser.displayName || "Usuário",
    email: authUser.email,
    role: "atendente",
    cargo: "Usuário",
    ativo: true
  } : null);

  const lista = [...funcionarios];
  if (currentProfile?.email) {
    const exists = lista.some((funcionario) => normalizeText(funcionario.email) === normalizeText(currentProfile.email));
    if (!exists) {
      lista.push({
        id: "__current",
        nome: currentProfile.nome,
        email: currentProfile.email,
        cargo: currentProfile.cargo,
        role: currentProfile.role,
        ativo: true
      });
    }
  }

  if (!lista.length) {
    tabela.innerHTML = `<tr><td colspan="5" class="empty-state">Nenhum funcionário cadastrado.</td></tr>`;
    return;
  }

  tabela.innerHTML = lista
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"))
    .map((funcionario) => `
      <tr>
        <td>${escapeHtml(funcionario.nome || "-")}</td>
        <td>${escapeHtml(funcionario.email || "-")}</td>
        <td>${escapeHtml(funcionario.cargo || "-")}</td>
        <td><span class="status-pill">${escapeHtml(funcionario.role || funcionario.perfil || "atendente")}</span></td>
        <td>${funcionario.ativo === false ? "Inativo" : "Ativo"}</td>
      </tr>
    `)
    .join("");
}

function initBuscaCliente() {
  const buscaInput = byId("buscaCliente");
  const resultadoBusca = byId("resultadoBusca");
  const formBusca = byId("formBuscaCliente");
  if (!buscaInput || !resultadoBusca || !formBusca) return;

  buscaInput.addEventListener("input", async () => {
    const termo = normalizeText(buscaInput.value.trim());
    if (termo.length < 3) {
      resultadoBusca.style.display = "none";
      resultadoBusca.innerHTML = "";
      return;
    }

    const clientes = await getCollectionData("clientes");
    const matches = clientes.filter((cliente) => {
      const nomeMatch = normalizeText(cliente.nome).includes(termo);
      const cpfMatch = String(cliente.cpfCnpj || "").replace(/\D/g, "").includes(termo.replace(/\D/g, ""));
      return nomeMatch || cpfMatch;
    });

    resultadoBusca.innerHTML = matches
      .map((cliente) => `
        <li class="compact-item">
          <span><strong>${escapeHtml(cliente.nome || "-")}</strong><br><small>${escapeHtml(cliente.cpfCnpj || "")}</small></span>
          <strong>${escapeHtml(cliente.telefone || "")}</strong>
        </li>
      `)
      .join("");
    resultadoBusca.style.display = matches.length ? "block" : "none";
  });

  document.addEventListener("click", (event) => {
    if (!formBusca.contains(event.target)) resultadoBusca.style.display = "none";
  });
}
 {
      const nomeMatch = normalizeText(cliente.nome).includes(termo);
      const cpfMatch = String(cliente.cpfCnpj || "").replace(/\D/g, "").includes(termo.replace(/\D/g, ""));
      return nomeMatch || cpfMatch;
    });

    resultadoBusca.innerHTML = matches
      .map((cliente) => `
        <li class="compact-item">
          <span><strong>${escapeHtml(cliente.nome || "-")}</strong><br><small>${escapeHtml(cliente.cpfCnpj || "")}</small></span>
          <strong>${escapeHtml(cliente.telefone || "")}</strong>
        </li>
      `)
      .join("");
    resultadoBusca.style.display = matches.length ? "block" : "none";
  });

  document.addEventListener("click", (event) => {
    if (!formBusca.contains(event.target)) resultadoBusca.style.display = "none";
  });
}

/* ── PWA: instalação na tela inicial do celular/PC e abertura rápida ── */
if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ── Versão centralizada: atualize só aqui (rodapé da sidebar) ── */
const APP_VERSION = "1.1.0";
document.querySelectorAll(".app-version").forEach((el) => {
  el.innerHTML = `MDSoltec OS ${APP_VERSION}<br>© ${new Date().getFullYear()} MDSoltec`;
});

/* ── Exportação CSV (backup local / direito de portabilidade LGPD) ── */
function csvCell(value) {
  return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
}

async function exportCollectionCSV(name) {
  // maxAgeMs 0 força releitura: a exportação precisa estar atualizada.
  const rows = await getCollectionData(name, { maxAgeMs: 0 });
  if (!rows.length) {
    showToast(`Nenhum registro em "${name}" para exportar.`);
    return;
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [columns, ...rows.map((row) => columns.map((column) => csvCell(row[column])))];
  // BOM + separador ";" para o Excel pt-BR abrir acentos e colunas certo.
  const csv = "\uFEFF" + lines.map((line) => line.join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mdsoltec-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function initExportarDados() {
  document.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Exportando…";
      try {
        await exportCollectionCSV(button.dataset.export);
      } catch (error) {
        console.error("Exportação falhou:", error);
        showToast("Não foi possível exportar agora. Verifique a conexão e tente de novo.");
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  });
}
