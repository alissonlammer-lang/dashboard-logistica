// api/dados.js
//
// Função serverless da Vercel que roda a query no BigQuery e devolve o
// resultado em CSV, pronto pra ser consumido pelo dashboard (mesmo formato
// que a aba do Google Sheets publicada gerava).
//
// Rota final, depois do deploy: https://SEU-PROJETO.vercel.app/api/dados
//
// Requer a variável de ambiente GCP_SERVICE_ACCOUNT_KEY (ver README-DEPLOY.md).

const { BigQuery } = require('@google-cloud/bigquery');

// ─────────────────────────────────────────────────────────────
// Mesma query fornecida — SVC agora inclui as 4 operações.
// Se precisar trocar o período ou os SVCs no futuro, é só editar aqui.
// ─────────────────────────────────────────────────────────────
const QUERY = `
WITH HISTORICO_CLUSTER AS (
  SELECT
    SVC,
    CLUSTER,
    XPT_HISTORICO
  FROM (
    SELECT
      SVC,
      CLUSTER,
      XPT AS XPT_HISTORICO,
      ROW_NUMBER() OVER (
        PARTITION BY SVC, CLUSTER
        ORDER BY QTD DESC
      ) AS RN
    FROM (
      SELECT
        SVC,
        CLUSTER,
        XPT,
        COUNT(*) AS QTD
      FROM \`meli-bi-data.WHOWNER.BT_BASEROTAS_LASTMILE\`
      WHERE
        SVC IN ('SPE1', 'SJP1', 'SSE1', 'SAL1')
        AND ROTA_PLAN IS NOT NULL
        AND CLUSTER IS NOT NULL
        AND XPT IS NOT NULL
      GROUP BY
        SVC,
        CLUSTER,
        XPT
    )
  )
  WHERE RN = 1
),
BASE_FINAL AS (
  SELECT
    A.* EXCEPT (DATA_FIM),
    CAST(B.SHP_LG_END_DATE_BRT AS DATE) AS DATA_FIM,
    B.NOT_DELIVERED_UNVISITED_ADDRESS,
    B.NOT_DELIVERED_BUYER_MOVED,
    B.NOT_DELIVERED_DAMAGED,
    B.NOT_DELIVERED_BUYER_REJECTED,
    B.NOT_DELIVERED_BAD_ADDRESS,
    B.NOT_DELIVERED_BUYER_ABSENT,
    B.NOT_DELIVERED_BUSINESS_CLOSED,
    B.NOT_DELIVERED_MISSROUTED,
    B.NOT_DELIVERED_INACCESSIBLE_ADDRESS,
    B.NOT_DELIVERED_MISSING,
    B.NOT_DELIVERED_STOLEN,
    B.SHP_LG_INIT_DATE_BRT,
    B.SHP_LG_END_DATE_BRT,
    COALESCE(
      A.XPT,
      CASE
        WHEN A.CLUSTER LIKE 'X%' THEN H.XPT_HISTORICO
        ELSE 'SVC'
      END,
      'SVC'
    ) AS BASE,
    C.ROUTE_ID AS ROTA_COM_RECLAMO,
    C.SHP_SHIPMENT_ID AS ID_COM_RECLAMO
  FROM \`meli-bi-data.WHOWNER.BT_BASEROTAS_LASTMILE\` A
  LEFT JOIN HISTORICO_CLUSTER H
    ON A.SVC = H.SVC
    AND A.CLUSTER = H.CLUSTER
  LEFT JOIN \`meli-bi-data.WHOWNER.BT_MLB_RTG_LAST_MILE\` B
    ON A.SHP_LG_ROUTE_ID = B.SHP_LG_ROUTE_ID
  LEFT JOIN \`meli-bi-data.WHOWNER.DM_SHP_LOGISTICS_CLAIMS\` C
    ON A.SHP_LG_ROUTE_ID = C.ROUTE_ID
  LEFT JOIN \`meli-bi-data.WHOWNER.BT_CM_CLAIMS_V1\` D
    ON C.SHP_SHIPMENT_ID = CAST(D.CLA_RESOURCE_ID AS NUMERIC)
  WHERE
    A.SVC IN ('SPE1', 'SJP1', 'SSE1', 'SAL1')
    AND CAST(A.DATA_INICIO AS DATE)
      BETWEEN DATE '2026-01-01' AND CURRENT_DATE()
)
SELECT
  SVC,
  DATA_INICIO,
  DATA_FIM,
  HORA_INICIO,
  HORA_FIM,
  EXTRACT(WEEK FROM CAST(DATA_INICIO AS DATE)) + 1 AS SEMANA,
  CASE FORMAT_DATE('%m', CAST(DATA_INICIO AS DATE))
    WHEN '01' THEN 'Jan' WHEN '02' THEN 'Fev' WHEN '03' THEN 'Mar'
    WHEN '04' THEN 'Abr' WHEN '05' THEN 'Mai' WHEN '06' THEN 'Jun'
    WHEN '07' THEN 'Jul' WHEN '08' THEN 'Ago' WHEN '09' THEN 'Set'
    WHEN '10' THEN 'Out' WHEN '11' THEN 'Nov' WHEN '12' THEN 'Dez'
  END AS MES,
  EXTRACT(YEAR FROM CAST(DATA_INICIO AS DATE)) AS ANO,
  SHP_LG_ROUTE_ID,
  SHP_LG_DRIVER_ID,
  CARRIER_NAME,
  PLATE,
  TIPO_VEICULO,
  CLUSTER,
  ROTA_PLAN,
  EXP_DRIVER,
  QTDE_PACOTES,
  QTDE_DESPACHADOS,
  QTDE_ENTREGUE,
  QTDE_PARADAS_BUYER,
  QTDE_PACOTES_BULKY,
  QTDE_PACOTE_VOLUMOSO,
  DELIVERED,
  DELIVERED_PLACE,
  STEM_OUT,
  STEM_IN,
  OZH_HOUR AS TEMPO_NA_ZONA_DE_ENTREGA,
  KM_PLAN,
  KM_REAL,
  ORH_PLAN,
  ORH_HOURS,
  orh_contrato,
  SPR_PLAN,
  SPR,
  BASE,
  CASE WHEN CICLO_FINAL IN ('AM1', 'CHP') THEN 'AM' ELSE 'PM' END AS CICLO,
  CICLO_FINAL,
  CASE WHEN ORH_HOURS <= orh_contrato THEN 1 ELSE 0 END AS ORHC,
  ROUND(SAFE_DIVIDE(QTDE_ENTREGUE, ORH_HOURS), 2) AS DPPH,
  CASE
    WHEN CAST(SHP_LG_END_DATE_BRT AS DATE) > CAST(SHP_LG_INIT_DATE_BRT AS DATE) THEN 'D+'
    WHEN SHP_LG_END_DATE_BRT IS NULL THEN 'D+'
    ELSE 'D0'
  END AS ENCERRAMENTO_D_MAIS,
  CASE WHEN ORH_HOURS > 12.00 THEN 1 ELSE 0 END AS Rotas_12h,
  CASE
    WHEN ORH_HOURS > 12.00 AND CAST(DATA_FIM AS DATE) > CAST(DATA_INICIO AS DATE) THEN 1
    ELSE 0
  END AS MAIOR12h_ENC_APOS_D0,
  CASE WHEN QTDE_DESPACHADOS - QTDE_ENTREGUE >= 20 THEN 1 ELSE 0 END AS maior_ou_igual_a_20,
  ROTAS_ENCERRADAS_21H,
  PACOTES_ENTREGUES_22H,
  EXTRACT(HOUR FROM HORA_INICIO) + EXTRACT(MINUTE FROM HORA_INICIO) / 60.0 AS HORA_FORMAT,
  CASE
    WHEN HORA_INICIO <= TIME '10:00:00' THEN 'INICIADA<10h'
    WHEN HORA_INICIO > TIME '10:00:00' AND HORA_INICIO <= TIME '12:00:00' THEN 'INICIADA_ENTRE10h_12h'
    WHEN HORA_INICIO > TIME '12:00:00' THEN 'INICIADA>12h'
  END AS HORA_FORMATADA,
  PRIMEIRO_CHECKPOINT_DT,
  ULTIMO_CHECKPOINT_DT,
  PICKED_UP,
  NOT_DELIVERED_UNVISITED_ADDRESS AS UNVISITED,
  NOT_DELIVERED_BUYER_MOVED AS BUYER_MOVED,
  NOT_DELIVERED_DAMAGED AS DAMAGED,
  NOT_DELIVERED_BUYER_REJECTED AS BUYER_REJECTED,
  NOT_DELIVERED_BAD_ADDRESS AS BAD_ADDRESS,
  NOT_DELIVERED_BUYER_ABSENT AS BUYER_ABSENT,
  NOT_DELIVERED_BUSINESS_CLOSED AS BUSINESS_CLOSED,
  NOT_DELIVERED_MISSROUTED AS MISSROUTED,
  NOT_DELIVERED_INACCESSIBLE_ADDRESS AS INACCESSIBLE_ADDRESS,
  NOT_DELIVERED_MISSING AS MISSING,
  PROBLEM_SOLVING,
  AT_STATION,
  AT_STATION_ADUANA,
  AT_STATION_PROBLEM_SOLVING,
  AT_STATION_DEV_BUYER,
  NOT_DELIVERED_STOLEN AS STOLEN,
  BLOCKED_BY_KEYWORD,
  OTHERS,
  TRANSFERRED,
  DESCONTEINERIZADOS_ONROUTE,
  OUTROS_INSUCESSOS_NAO_MAPEADOS,
  CLAIMS,
  ROTA_COM_RECLAMO,
  ID_COM_RECLAMO
FROM BASE_FINAL
ORDER BY DATA_INICIO DESC, SVC
`;

// BigQuery devolve campos DATE como string "YYYY-MM-DD" (ou {value:"YYYY-MM-DD"}
// dependendo da versão da lib) — o dashboard espera "DD/MM/YYYY".
function toBrDate(v) {
  if (v === null || v === undefined) return '';
  const s = (typeof v === 'object' && v.value !== undefined) ? v.value : v;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s);
}

function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.value !== undefined) return String(v.value);
  return String(v);
}

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const dateCols = new Set(['DATA_INICIO', 'DATA_FIM']);
  const esc = (s) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => esc(dateCols.has(h) ? toBrDate(row[h]) : cellToString(row[h])))
        .join(',')
    );
  }
  return lines.join('\n');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const credsRaw = process.env.GCP_SERVICE_ACCOUNT_KEY;
    if (!credsRaw) {
      res.status(500).json({
        error: 'GCP_SERVICE_ACCOUNT_KEY não configurada nas variáveis de ambiente do projeto na Vercel.',
      });
      return;
    }

    const credentials = JSON.parse(credsRaw);
    const bigquery = new BigQuery({
      projectId: credentials.project_id,
      credentials,
    });

    const [rows] = await bigquery.query({ query: QUERY });

    const csv = toCSV(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // Cache de borda: mantém a resposta "quente" por 30min, evitando rodar a
    // query no BigQuery a cada acesso do dashboard (economiza custo/tempo).
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    res.status(200).send(csv);
  } catch (err) {
    console.error('Erro ao consultar BigQuery:', err);
    res.status(500).json({ error: 'Falha ao consultar BigQuery', details: err.message });
  }
};
