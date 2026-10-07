# MDSoltec OS

Sistema de gestão para assistência técnica: ordens de serviço, clientes,
estoque, PDV, financeiro, garantias e relatórios. Front estático
(HTML/CSS/JS puro, sem build) + **Firebase** (Hosting, Auth e Firestore),
publicado automaticamente a cada push na `main`.

Site: **https://ods-mdsoltec.web.app**

## Estrutura

```
├─ public/                  ← site (publicado no Firebase Hosting)
│  ├─ index.html            ← dashboard
│  ├─ *.html                ← páginas do sistema (12 no total)
│  ├─ login.html            ← acesso (Firebase Auth, e-mail/senha)
│  ├─ script.js             ← aplicação inteira (módulo ES único)
│  ├─ style.css             ← tema escuro/verde
│  ├─ manifest.webmanifest  ← PWA (instalável no celular/PC)
│  ├─ sw.js                 ← cache network-first (suba o VERSION ao publicar)
│  └─ assets/               ← logo WebP + ícones/favicon gerados do logo
├─ firestore.rules          ← regras do Firestore (EXIGEM LOGIN)
├─ firestore.indexes.json
└─ .github/workflows/       ← deploy automático (hosting + rules)
```

## ⚠️ Deploy e regras do Firestore

O workflow publica **hosting + firestore:rules** a cada push na `main`
(precisa do secret `FIREBASE_TOKEN`). As regras atuais **exigem usuário
autenticado** para ler/escrever qualquer coleção — antes, o banco estava
em modo teste aberto (exposto sem login: clientes com CPF/CNPJ, estoque,
financeiro).

**Ao publicar este commit, qualquer acesso sem login é bloqueado na hora.**
Se houver script/integração externa lendo o banco direto, migre-a para
uma conta de serviço antes do merge. Para publicar só o site:

```bash
firebase deploy --only hosting
```

Para validar as regras antes, rode o emulador:

```bash
firebase emulators:start --only firestore
```

## Desenvolvimento local

```bash
python3 -m http.server 8080 --directory public
# abra http://localhost:8080  (service worker só ativa em https/localhost)
```

Configure o Firebase local (opcional, para emulador de Firestore) em
`firebase.json`. Login e banco de produção: usar apenas via site publicado
ou `firebase use <projeto>` correto.

## Recursos 1.3.0

- **Robustez**: número de OS via `runTransaction` (sem duplicar) e venda do
  PDV atômica (venda + baixa de estoque numa transação só). Exclusões são
  **soft-delete** com Lixeira em Configurações (restaurar/apagar de vez).
- **Fotos da OS**: anexe fotos do aparelho (antes/depois) — compressão no
  navegador (≤1280px), upload no Firebase Storage (`ordens/<id>/`), limite
  de 10 por OS. Requer Storage ativo no console Firebase.
- **Portal do cliente**: página pública `consulta.html` consulta o status
  pelo código impresso no termo de garantia (com **QR Code**). O sistema
  espelha em `consultasPublicas/` só dados não sensíveis (sem CPF,
  endereço, telefone ou valores) — única coleção com leitura pública nas
  regras. O código é gerado no primeiro salvar da OS.

## Melhorias aplicadas (1.1.0)

- **Segurança** — regras por coleção com `request.auth != null`, default-deny
  para coleções novas; workflow publica as regras junto com o site.
- **Custo Firestore** — `getCollectionData` com cache de 30s + dedupe de
  chamadas simultâneas; toda escrita invalida o cache da coleção (a busca
  de cliente não reler a coleção inteira a cada tecla).
- **Performance** — logo de 268 KB → 4,9 KB (WebP 232px), favicon de 32px,
  apple-touch-icon, preconnect (gstatic/firestore), `width/height` no logo.
- **PWA** — manifest + service worker: instalável no celular da loja e
  abre com último cache quando falta internet.
- **UX/a11y** — login com "Esqueci minha senha" e erros claros; 404 em
  pt-BR; exportação de CSV (backup/LGPD) em Configurações; `aria-hidden`
  nos ícones decorativos; `thead` na tabela do dashboard.

## Próximos passos sugeridos (roadmap)

1. **Perfis no servidor**: custom claims do Auth para reforçar
   admin/técnico/atendente/financeiro (hoje o controle é só na interface).
2. **Tempo real**: migrar listagens de `getDocs` para `onSnapshot`
   (duas pessoas na mesma OS veem a mudança sem F5).
3. **Dividir o script.js** (102 KB) em módulos por página.
4. **Atualizar o SDK Firebase** 9.23 → 11.x quando houver janela de teste.
5. Consultas paginadas nas listagens (`orderBy` + `limit`) quando as
   coleções passarem de algumas centenas de documentos.
