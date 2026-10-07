#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   MDSoltec OS — define o perfil (custom claim "role") de um usuário.

   O controle de cargas no SERVIDOR usa este claim: as regras do
   Firestore só deixam gerenciar usuários/configurações com
   role == "admin". Use este script para conceder perfis:

     cd tools && npm install
     GOOGLE_APPLICATION_CREDENTIALS=/caminho/service-account.json \
       node set-user-role.js email@dominio [admin|tecnico|atendente|financeiro]

   A chave privada é gerada em: Console Firebase → Configurações do
   projeto → Contas de serviço → "Gerar nova chave privada".
   NUNCA versione esse arquivo JSON.

   Depois de rodar, a pessoa precisa SAIR E ENTRAR de novo no sistema
   (o claim viaja dentro do token de identidade, emitido no login).
   ════════════════════════════════════════════════════════════════════ */
const admin = require("firebase-admin");

const ROLES = ["admin", "tecnico", "atendente", "financeiro"];

async function main() {
  const [email, roleArg] = process.argv.slice(2);
  const role = (roleArg || "atendente").toLowerCase();

  if (!email || !ROLES.includes(role)) {
    console.log("Uso: node set-user-role.js <email> [admin|tecnico|atendente|financeiro]");
    console.log("Perfis válidos: " + ROLES.join(", "));
    process.exit(1);
  }

  admin.initializeApp(); // usa GOOGLE_APPLICATION_CREDENTIALS

  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { role });

  const claims = (await admin.auth().getUser(user.uid)).customClaims || {};
  console.log(`✓ ${email} agora tem role="${claims.role}".`);
  console.log("  Importante: sair e entrar de novo para o token pegar o claim novo.");
  process.exit(0);
}

main().catch((error) => {
  console.error("✖", error.message);
  process.exit(1);
});
