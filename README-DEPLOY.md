# Deploy: BigQuery → Vercel → Dashboard

Isso substitui o Google Sheets como fonte dos dados. O dashboard passa a
buscar direto de uma API sua, hospedada na Vercel, que consulta o BigQuery.

## 1. Criar a Service Account no Google Cloud (uma vez só)

1. Acesse https://console.cloud.google.com/iam-admin/serviceaccounts
   no projeto que tem acesso ao dataset `meli-bi-data.WHOWNER` (pode ser
   um projeto GCP diferente — o que importa é a permissão no dataset).
2. **Criar Service Account** → dê um nome, ex: `dashboard-bigquery-reader`.
3. Em **Papéis/Roles**, adicione:
   - `BigQuery Data Viewer` (ler os dados)
   - `BigQuery Job User` (rodar a query)
   - Se o dataset `meli-bi-data` for de outro projeto, pode ser necessário
     que alguém com acesso a ele conceda essas permissões especificamente
     nesse dataset (fale com quem administra o BigQuery da empresa).
4. Depois de criada, abra a service account → aba **Chaves/Keys** →
   **Adicionar chave** → **Criar nova chave** → tipo **JSON**.
   Isso baixa um arquivo `.json` — guarde ele, é a credencial.

⚠️ Esse arquivo JSON dá acesso de leitura ao BigQuery. Não sobe pro
GitHub, não compartilha por WhatsApp/e-mail. Só cola como variável de
ambiente na Vercel (próximo passo).

## 2. Configurar o projeto na Vercel

1. Suba esses 3 arquivos (`api/dados.js`, `vercel.json`, `package.json`)
   pra um repositório novo (GitHub/GitLab/Bitbucket) e conecte esse
   repositório num novo projeto na Vercel — ou use a CLI (`vercel deploy`)
   se preferir não usar Git.
2. No painel do projeto na Vercel → **Settings → Environment Variables**:
   - Nome: `GCP_SERVICE_ACCOUNT_KEY`
   - Valor: **cole o conteúdo inteiro do arquivo `.json`** da service
     account (o JSON completo, em uma linha só — copie e cole direto).
   - Marque pra valer em **Production** (e Preview se for testar antes).
3. Clique em **Deploy**.

## 3. Testar a API

Depois do deploy, abra no navegador:

```
https://SEU-PROJETO.vercel.app/api/dados
```

Se der certo, aparece o CSV com todas as colunas (SVC, DATA_INICIO,
DATA_FIM, SHP_LG_ROUTE_ID etc.), exatamente no mesmo formato que o
dashboard já espera.

Se der erro, a resposta traz uma mensagem explicando o motivo (ex:
variável de ambiente faltando, ou erro de permissão do BigQuery).

## 4. Apontar o dashboard pra essa API

No `index.html` do dashboard, troca a URL do Google Sheets:

```js
const REMOTE_CSV_URL = 'https://SEU-PROJETO.vercel.app/api/dados';
```

Pronto — o dashboard passa a ler direto do BigQuery via essa API, sem
depender de planilha nenhuma no meio.

## Sobre o `vercel.json` (cron)

O `vercel.json` inclui um cron que "esquenta" o cache da API de hora em
hora (das 6h às 23h, no minuto 10 — igual o esquema que o dashboard já
usa hoje). Ele não é obrigatório: o dashboard já busca a API sozinho no
mesmo horário. O cron só ajuda a resposta ficar mais rápida pro primeiro
usuário que acessar depois de cada hora (a API guarda a resposta em
cache de borda por 30 minutos, então evita rodar a query no BigQuery a
cada acesso).

⚠️ **Importante:** cron jobs com frequência de hora em hora exigem plano
**Vercel Pro** (ou superior). No plano gratuito (Hobby), a Vercel só
permite 1 execução por dia. Se vocês estiverem no plano gratuito, duas
opções:
- Simplesmente remover o `vercel.json` (a API funciona igual, só sem o
  "esquentamento" — a query roda no BigQuery na primeira vez que alguém
  acessa depois do cache expirar, o que já é rápido o suficiente na
  prática);
- Ou trocar o `schedule` pra `"10 6 * * *"` (uma vez por dia, às 6h10).

## Custo do BigQuery

Cada execução da query cobra pela quantidade de dados escaneados pelo
BigQuery (não pelo número de linhas retornadas). Como o filtro já limita
o período (desde `2026-01-01`) e os SVCs, o custo tende a ser previsível
e baixo — mas vale acompanhar em **BigQuery → Billing → Query history**
nas primeiras semanas pra confirmar que está dentro do esperado.
