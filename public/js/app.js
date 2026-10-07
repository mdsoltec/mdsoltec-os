/* ── MDSoltec OS · aplicação (páginas, formulários, tempo real) ── */

import {
  DEFAULT_SESSION, ROUTE_PERMISSIONS, addDays, addDoc, auth, byId, collection,
  confirmDialog, currentMonthKey, db, deleteDoc, digitsOnly, doc, escapeHtml,
  findUserProfile, formatDate, formatMoney, gerarNumeroOS, getCollectionData,
  getOSRevenueDate, getPartCost, getPartSale, getPecaDate, getSaleDate, getSession,
  getWarrantyDays, hasPermission, initIcons, initMobileSidebar, initNavigation,
  initSessionControls, initTopbar, invalidateCollection, isDeleted, isFinished, isInMonth,
  isSaleActive, normalizeRole, normalizeText, page, parseCurrency, populateMonthSelect,
  produtoLabel, refreshTopbarProfile, renderSkeleton, restoreDoc, routeFromHref,
  scheduleAfterSnapshots, setDoc, setSession, setText, showFirestoreNotice, showToast,
  softDeleteDoc, state, statusClass, statusLabel, storage, syncConsultaPublica, toDate,
  todayBR, updateDoc, userDocId, valueOf,
  fsRunTransaction,
  getDoc,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  syncEnhancedSelect,
  updateCustomSelect,
} from "./core.js";
import {
  gerarPDF, gerarPDFEntrada, getCompanyConfig
} from "./pdf.js";


document.addEventListener("DOMContentLoaded", async () => {
  ensurePdvNavigation();
  initNavigation();
  initIcons();
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
  initLixeira();
  initMensagens();
  initPDV();
  enhanceSelects();
});

function setValue(id, value) {
  const element = byId(id);
  if (element) element.value = value ?? "";
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

  const exact = state.clientesCache.find((cliente) => normalizeText(cliente.nome) === normalized);
  if (exact) return exact;

  const matches = state.clientesCache.filter((cliente) => normalizeText(cliente.nome).includes(normalized));
  return matches.length === 1 ? matches[0] : null;
}

function fillClienteNaOS(cliente) {
  if (!cliente) return;
  setValue("clienteInput", cliente.nome || "");
  setValue("whatsappInput", cliente.telefone || cliente.whatsapp || "");
  setValue("clienteCpfCnpjInput", cliente.cpfCnpj || cliente.documento || "");
  setValue("clienteEnderecoInput", composeAddress(cliente));
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

function enhanceSelects() {
  document.querySelectorAll("select").forEach((select) => syncEnhancedSelect(select));

  document.addEventListener("click", (event) => {
    document.querySelectorAll(".custom-select-panel").forEach((panel) => {
      if (!panel.closest(".custom-select")?.contains(event.target)) panel.hidden = true;
    });
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
      // O claim do token (definido no servidor via tools/set-user-role.js)
      // manda sobre o cadastro local — perfis não se alteram no navegador.
      const token = await credentials.user.getIdTokenResult();
      const role = token.claims?.role || profile?.role || profile?.perfil || "atendente";
      setSession({
        nome: profile?.nome || credentials.user.displayName || "Usuário",
        email: credentials.user.email,
        role,
        cargo: profile?.cargo || role
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

function compressImage(file, maxSize = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("decode"));
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("encode")), "image/jpeg", quality);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderFotosPreview() {
  const grid = byId("fotosPreview");
  if (!grid) return;
  const novas = state.fotosNovas.map((item, index) => `
    <figure class="foto-thumb">
      <img src="${item.previewUrl}" alt="Nova foto ${index + 1}">
      <button type="button" class="foto-remove" data-foto-nova="${index}" title="Remover">×</button>
    </figure>`);
  const existentes = state.fotosNaOS.map((foto) => `
    <figure class="foto-thumb ${state.fotosRemovidas.includes(foto.path) ? "is-removed" : ""}">
      <img src="${foto.url}" alt="Foto da OS" loading="lazy">
      <button type="button" class="foto-remove" data-foto-existente="${escapeHtml(foto.path)}" title="Remover">×</button>
    </figure>`);
  grid.innerHTML = existentes.join("") + novas.join("");
  if (!state.fotosNovas.length && !state.fotosNaOS.length) {
    grid.innerHTML = `<p class="field-status">Nenhuma foto anexada.</p>`;
  }
  grid.querySelectorAll("[data-foto-nova]").forEach((button) => {
    button.addEventListener("click", () => {
      state.fotosNovas.splice(Number(button.dataset.fotoNova), 1);
      renderFotosPreview();
    });
  });
  grid.querySelectorAll("[data-foto-existente]").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.fotoExistente;
      state.fotosRemovidas = state.fotosRemovidas.includes(path)
        ? state.fotosRemovidas.filter((p) => p !== path)
        : [...state.fotosRemovidas, path];
      renderFotosPreview();
    });
  });
}

function initFotosOS(originalOS) {
  const input = byId("fotosInput");
  if (!input) return;

  if (originalOS?.fotos?.length) {
    state.fotosNaOS = originalOS.fotos.filter((foto) => foto?.url && foto?.path);
    state.fotosRemovidas = [];
  }
  renderFotosPreview();

  input.addEventListener("change", () => {
    const files = [...(input.files || [])].filter((file) => file.type.startsWith("image/"));
    files.forEach((file) => {
      if (state.fotosNovas.length + state.fotosNaOS.length >= 10) return;
      state.fotosNovas.push({ file, previewUrl: URL.createObjectURL(file) });
    });
    input.value = "";
    if (state.fotosNovas.length + state.fotosNaOS.length >= 10) showToast("Limite de 10 fotos por OS.", "info");
    renderFotosPreview();
  });
}

async function uploadFotosOS(osId, { manter = true } = {}) {
  const referencias = manter ? state.fotosNaOS.filter((foto) => !state.fotosRemovidas.includes(foto.path)) : [];
  for (const item of state.fotosNovas) {
    const blob = await compressImage(item.file);
    const path = `ordens/${osId}/foto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(ref);
    referencias.push({ url, path, criadoEm: new Date().toISOString() });
  }
  for (const path of state.fotosRemovidas) {
    try { await deleteObject(storageRef(storage, path)); } catch (error) { console.warn("Foto já removida do Storage:", path); }
  }
  state.fotosNovas = [];
  state.fotosNaOS = referencias;
  state.fotosRemovidas = [];
  return referencias;
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

    if (!state.clientesCache.length) state.clientesCache = await getCollectionData("clientes");
    fillClienteNaOS(findClienteByName(typedName));
  };
  clienteInput?.addEventListener("input", onClienteChange);
  clienteInput?.addEventListener("keyup", onClienteChange);
  clienteInput?.addEventListener("change", onClienteChange);
  clienteInput?.addEventListener("blur", onClienteChange);
  clienteInput?.addEventListener("focusout", onClienteChange);

  if (!osId) initFotosOS(null);

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
        initFotosOS(originalOS);
      }
    } catch (error) {
      console.error("Erro ao carregar OS para edição:", error);
      showFirestoreNotice(error);
    }
  }

  osForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = getOSPayloadFromForm(originalOS);
    const submitButton = osForm.querySelector('[type="submit"]');
    const temFotos = state.fotosNovas.length > 0 || state.fotosRemovidas.length > 0;

    try {
      if (temFotos && submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = state.fotosNovas.length
          ? `Salvando e enviando ${state.fotosNovas.length} foto(s)…`
          : "Salvando…";
      }
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

      // Portal do cliente: publica/renova o espelho público com o status novo
      if (savedId) {
        const codigoConsulta = await syncConsultaPublica(savedOS);
        if (codigoConsulta) savedOS = { ...savedOS, codigoConsulta };
      }

      if (temFotos && savedId) {
        try {
          const fotos = await uploadFotosOS(savedId);
          await updateDoc(doc(db, "ordensServico", savedId), { fotos });
          savedOS = { ...savedOS, fotos };
        } catch (fotoError) {
          console.error("Falha ao enviar fotos:", fotoError);
          showToast("OS salva, mas houve falha ao enviar fotos. Abra a OS e tente de novo.", "error");
        }
      }

      if (!originalOS || statusLabel(originalOS.status) !== statusLabel(payload.status)) {
        await criarMensagemWhatsapp(savedOS, payload.status, { abrirAgora: !osId });
      }

      osForm.reset();
      window.location.href = "listar-os.html";
    } catch (error) {
      console.error("Erro ao salvar OS:", error);
      showToast("Erro ao salvar OS. Verifique o Firebase.", "error");
      showFirestoreNotice(error);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Salvar OS";
      }
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
    state.clientesCache = clientes;
    clientesList.innerHTML = clientes
      .map((cliente) => `<option value="${escapeHtml(cliente.nome || "")}"></option>`)
      .join("");
  }

  if (aparelhosList || pecasList) {
    const estoque = await getCollectionData("estoque");
    state.estoqueCache = estoque;
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
  renderSkeleton(listaOS, { cols: 7 });

  const filtroCliente = byId("filtroCliente");
  const filtroStatus = byId("filtroStatus");
  const btnMais = byId("carregarMaisOS");
  const info = byId("osCountInfo");
  const PAGE_SIZE = 50;

  let ordensCarregadas = [];
  let ultimoDoc = null;
  let totalOS = 0;

  const aplicarFiltros = () => renderOrdens(listaOS, ordensCarregadas, filtroCliente?.value, filtroStatus?.value);

  const atualizarRodape = () => {
    if (info) info.textContent = totalOS > ordensCarregadas.length
      ? `Mostrando ${ordensCarregadas.length} de ${totalOS} OS (mais recentes primeiro)`
      : `${ordensCarregadas.length} OS`;
    if (btnMais) btnMais.hidden = ordensCarregadas.length >= totalOS;
  };

  // Paginação no servidor: lê apenas 50 OS por vez (a mais recente primeiro).
  // Com 5 mil OS, a tela deixa de ler 5 mil documentos a cada visita.
  const carregar = async (reiniciar = true) => {
    try {
      if (reiniciar) { ordensCarregadas = []; ultimoDoc = null; }
      const base = [collection(db, "ordensServico"), where("excluidoEm", "==", null), orderBy("data", "desc")];
      const cursor = ultimoDoc ? [startAfter(ultimoDoc)] : [];
      const snap = await getDocs(query(...base, ...cursor, limit(PAGE_SIZE)));
      ordensCarregadas.push(...snap.docs.map((item) => ({ id: item.id, ...item.data() })));
      if (snap.docs.length) ultimoDoc = snap.docs[snap.docs.length - 1];
      aplicarFiltros();
      try {
        if (reiniciar) totalOS = (await getCountFromServer(collection(db, "ordensServico"))).data().count;
      } catch (_) { totalOS = ordensCarregadas.length; }
      atualizarRodape();
    } catch (error) {
      console.error("Erro ao carregar OS:", error);
      showFirestoreNotice(error);
    }
  };

  window.__rvReloadOrdens = () => carregar(true);

  filtroCliente?.addEventListener("input", aplicarFiltros);
  filtroStatus?.addEventListener("change", aplicarFiltros);
  btnMais?.addEventListener("click", () => carregar(false));
  carregar(true);

  // Tempo real: volta à primeira página quando algo muda no banco.
  scheduleAfterSnapshots(["ordensServico"], () => carregar(true));
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
        await softDeleteDoc(doc(db, "ordensServico", button.dataset.delete));
        showToast("OS movida para a lixeira (Configurações).", "success");
        if (typeof window.__rvReloadOrdens === "function") {
          window.__rvReloadOrdens();
        } else {
          const ordens = await getCollectionData("ordensServico");
          renderOrdens(container, ordens, byId("filtroCliente")?.value, byId("filtroStatus")?.value);
        }
      } catch (error) {
        console.error("Erro ao excluir OS:", error);
        showToast("Erro ao excluir OS.");
        showFirestoreNotice(error);
      }
    });
  });
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
  state.clientesCache = clientes;

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

  const editing = isProduct ? state.editingProdutoId : state.editingPecaId;
  if (submitButton) submitButton.textContent = `${editing ? "Atualizar" : "Salvar"} ${isProduct ? "Produto" : "Peça"}`;
}

function resetStockForm(mode = getStockFormMode()) {
  const form = byId("pecaForm");
  const cancelEdit = byId("cancelEditPeca");
  state.editingPecaId = null;
  state.editingProdutoId = null;
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
    state.editingPecaId = null;
    state.editingProdutoId = null;
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
      const editingId = isProduct ? state.editingProdutoId : state.editingPecaId;

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
  state.estoqueCache = pecas;

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
      await softDeleteDoc(doc(db, "estoque", button.dataset.deletePeca));
      showToast("Peça movida para a lixeira (Configurações).", "success");
      carregarPecas();
    });
  });

  listaPecas.querySelectorAll("[data-edit-peca]").forEach((button) => {
    button.addEventListener("click", () => {
      const peca = pecas.find((item) => item.id === button.dataset.editPeca);
      if (!peca) return;

      state.editingPecaId = peca.id;
      state.editingProdutoId = null;
      fillStockForm(peca, "peca");
    });
  });
}

async function carregarProdutosEstoque() {
  const listaProdutos = byId("listaProdutos");
  if (!listaProdutos) return;

  const produtos = await getCollectionData("produtos");
  state.produtosCache = produtos;

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
      await softDeleteDoc(doc(db, "produtos", button.dataset.deleteProduto));
      showToast("Produto movido para a lixeira (Configurações).", "success");
      carregarProdutosEstoque();
    });
  });

  listaProdutos.querySelectorAll("[data-edit-produto]").forEach((button) => {
    button.addEventListener("click", () => {
      const produto = produtos.find((item) => item.id === button.dataset.editProduto);
      if (!produto) return;

      state.editingProdutoId = produto.id;
      state.editingPecaId = null;
      fillStockForm(produto, "produto");
    });
  });
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

  state.produtosCache = await getCollectionData("produtos");
  const produtos = state.produtosCache
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
  const produto = state.produtosCache.find((item) => item.id === produtoId);
  const quantidade = Number.parseInt(valueOf("pdvQuantidade"), 10) || 1;
  if (!produto || quantidade <= 0) return;

  const emCarrinho = state.pdvCarrinho.find((item) => item.id === produto.id);
  const quantidadeAtual = emCarrinho?.quantidade || 0;
  const estoqueDisponivel = Number(produto.quantidade || 0);
  if (quantidadeAtual + quantidade > estoqueDisponivel) {
    showToast("Quantidade maior que o estoque disponível.");
    return;
  }

  if (emCarrinho) {
    emCarrinho.quantidade += quantidade;
  } else {
    state.pdvCarrinho.push({
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

  const subtotal = state.pdvCarrinho.reduce((sum, item) => sum + item.unitario * item.quantidade, 0);
  const desconto = Math.min(parseCurrency(valueOf("pdvDesconto")), subtotal);
  const total = Math.max(subtotal - desconto, 0);

  totalEl.textContent = formatMoney(total);
  tabela.innerHTML = state.pdvCarrinho.length
    ? state.pdvCarrinho.map((item) => `
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
      state.pdvCarrinho = state.pdvCarrinho.filter((item) => item.id !== button.dataset.removePdv);
      renderCarrinhoPDV();
    });
  });
}

async function finalizarVendaPDV() {
  if (!state.pdvCarrinho.length) {
    showToast("Adicione pelo menos um produto.");
    return;
  }

  const subtotal = state.pdvCarrinho.reduce((sum, item) => sum + item.unitario * item.quantidade, 0);
  const desconto = Math.min(parseCurrency(valueOf("pdvDesconto")), subtotal);
  const total = Math.max(subtotal - desconto, 0);
  const venda = {
    codigo: `PDV-${Date.now().toString().slice(-8)}`,
    itens: state.pdvCarrinho.map((item) => ({ ...item })),
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
    // Transação única: grava a venda e dá baixa no estoque com os valores
    // FRESCOS do banco (não do cache) — duas vendas simultâneas do mesmo
    // produto não podem mais vender o mesmo item duas vezes.
    const vendaRef = doc(collection(db, "vendasPDV"));
    const carrinho = [...state.pdvCarrinho];
    await fsRunTransaction(db, async (tx) => {
      const produtoSnaps = await Promise.all(carrinho.map((item) => tx.get(doc(db, "produtos", item.id))));
      tx.set(vendaRef, venda);
      carrinho.forEach((item, index) => {
        const snap = produtoSnaps[index];
        const atual = Number(snap?.data()?.quantidade || 0);
        tx.set(doc(db, "produtos", item.id), {
          quantidade: Math.max(atual - Number(item.quantidade || 0), 0),
          atualizadoEm: new Date().toISOString()
        }, { merge: true });
      });
    });
    invalidateCollection("vendasPDV", "produtos");
    const vendaDoc = { id: vendaRef.id };

    const vendaFinal = { id: vendaDoc.id, ...venda };
    imprimirCupomPDV(vendaFinal);
    state.pdvCarrinho = [];
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

  renderSkeleton(byId("latestOS"), { cols: 4 });
  renderSkeleton(byId("upcomingDeliveries"), { type: "list" });
  renderSkeleton(byId("servicesRanking"), { type: "list" });

  const monthSelect = byId("dashboardMonth");
  let lastMonth = "";
  let payload = null;

  const render = () => {
    if (!payload) return;
    renderDashboardMonth(payload.ordens, payload.custos, payload.vendas, monthSelect?.value || payload.fallback);
  };

  const refresh = async () => {
    const [ordens, estoque, produtos, vendasPDV] = await Promise.all([
      getCollectionData("ordensServico"),
      getCollectionData("estoque"),
      getCollectionData("produtos"),
      getCollectionData("vendasPDV")
    ]);
    const custosEstoque = [...estoque, ...produtos];
    const fallback = populateMonthSelect(
      monthSelect,
      [...ordens.map(getOSRevenueDate), ...custosEstoque.map(getPecaDate), ...vendasPDV.map(getSaleDate)]
    );
    if (lastMonth && [...(monthSelect?.options || [])].some((option) => option.value === lastMonth)) {
      monthSelect.value = lastMonth;
    }
    payload = { ordens, custos: custosEstoque, vendas: vendasPDV, fallback };
    render();
  };

  monthSelect?.addEventListener("change", () => { lastMonth = monthSelect.value; render(); });
  await refresh();

  // Tempo real: o painel reage a mudanças nas coleções sem F5,
  // preservando o mês selecionado no filtro.
  scheduleAfterSnapshots(["ordensServico", "estoque", "produtos", "vendasPDV"], refresh);
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

/* ── PWA: instalação na tela inicial do celular/PC e abertura rápida ── */
if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

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

/* ── Lixeira: restaura ou apaga de vez registros marcados como excluídos ── */
const TRASH_COLLECTIONS = ["ordensServico", "estoque", "produtos"];
const TRASH_LABELS = { ordensServico: "Ordem de Serviço", estoque: "Peça (estoque técnico)", produtos: "Produto (PDV)" };

function trashRecordLabel(name, record) {
  if (name === "ordensServico") return `${record.numero || "OS"} · ${record.cliente || "-"}`;
  return [record.tipo, record.marca, record.modelo, record.nome].filter(Boolean).join(" ") || record.id;
}

async function initLixeira() {
  const tabela = byId("lixeiraTabela");
  if (!tabela) return;

  const reload = async () => {
    const listas = await Promise.all(TRASH_COLLECTIONS.map(async (name) => {
      const rows = await getCollectionData(name, { maxAgeMs: 0 });
      return rows.filter((record) => isDeleted(record)).map((record) => ({ name, record }));
    }));
    const itens = listas.flat().sort((a, b) => String(b.record.excluidoEm || "").localeCompare(String(a.record.excluidoEm || "")));

    tabela.innerHTML = itens.length ? itens.map(({ name, record }) => `
      <tr>
        <td>${escapeHtml(TRASH_LABELS[name] || name)}</td>
        <td>${escapeHtml(trashRecordLabel(name, record))}</td>
        <td>${formatDate(record.excluidoEm)}</td>
        <td>
          <div class="actions-inline">
            <button type="button" class="btn btn-sm btn-secondary" data-trash-restore="${name}|${record.id}">Restaurar</button>
            <button type="button" class="btn btn-sm btn-danger" data-trash-purge="${name}|${record.id}">Apagar de vez</button>
          </div>
        </td>
      </tr>
    `).join("") : `<tr><td colspan="4" class="empty-state">A lixeira está vazia.</td></tr>`;

    tabela.querySelectorAll("[data-trash-restore]").forEach((button) => {
      button.addEventListener("click", async () => {
        const [name, id] = button.dataset.trashRestore.split("|");
        await restoreDoc(doc(db, name, id));
        showToast("Registro restaurado.", "success");
        reload();
      });
    });
    tabela.querySelectorAll("[data-trash-purge]").forEach((button) => {
      button.addEventListener("click", async () => {
        const [name, id] = button.dataset.trashPurge.split("|");
        if (!(await confirmDialog("Esta exclusão é PERMANENTE e não pode ser desfeita.", { title: "Apagar definitivamente", confirmText: "Apagar de vez", danger: true }))) return;
        await deleteDoc(doc(db, name, id));
        showToast("Registro apagado definitivamente.", "success");
        reload();
      });
    });
  };

  reload();
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

