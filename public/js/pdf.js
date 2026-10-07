/* ── MDSoltec OS · geração de PDF (entrada, garantia, QR do portal) ── */

import {
  db, doc, formatDate, formatMoney, getSession, getWarrantyDays, showToast,
  syncConsultaPublica, toDate
} from "./core.js";

async function desenharQRConsulta(docPDF, os, margin, y) {
  let codigo = os.codigoConsulta;
  if (!codigo && os.id) codigo = await syncConsultaPublica(os);
  if (!codigo || typeof QRCode === "undefined") return y + 6;

  const url = `${window.location.origin}/consulta.html?c=${codigo}`;
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-9999px;top:0;";
  document.body.appendChild(holder);
  let dataUrl = "";
  try {
    await new Promise((resolve) => {
      new QRCode(holder, { text: url, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
      setTimeout(resolve, 120);
    });
    const canvas = holder.querySelector("canvas");
    if (canvas) dataUrl = canvas.toDataURL("image/png");
  } finally {
    holder.remove();
  }
  if (!dataUrl) return y + 6;

  docPDF.addImage(dataUrl, "PNG", margin, y, 22, 22);
  docPDF.setFontSize(9);
  docPDF.text("Acompanhe o andamento da sua OS:", margin + 26, y + 7);
  docPDF.setFontSize(8);
  docPDF.text(`Código: ${codigo}`, margin + 26, y + 13);
  docPDF.text(url.replace(/^https?:\/\//, ""), margin + 26, y + 19, { maxWidth: 150 });
  return y + 26;
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
  y = await desenharQRConsulta(docPDF, os, margin, y) + 4;
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


export {
  gerarPDF,
  gerarPDFEntrada,
  gerarPDFGarantia,
  getCompanyConfig,
  desenharQRConsulta,
  addPdfHeader,
  addPdfSection,
  addWrappedPdf,
  ensurePdfSpace,
  finishPdf,
  imageToDataUrl
};
