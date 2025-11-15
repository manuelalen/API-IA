import express from "express";
import cors from "cors";
import OpenAI from "openai";
import mysql from "mysql2/promise";
import path from "path";

const app = express();

// --- Configuración básica ---
app.use(cors());
app.use(express.json());

// Servir estáticos (frontend) desde carpeta "public"
const publicPath = path.join(process.cwd(), "public");
app.use(express.static(publicPath));

// --- Cliente OpenAI local ---
const client = new OpenAI({
  apiKey: "dummy", // obligatorio para la librería
  baseURL: "http://192.168.0.30:1234/v1"
});

// --- Pool MySQL ---
const pool = mysql.createPool({
  host: "localhost",
  port: 3306,
  user: "manolitoGPT",
  password: "manolitoGPT",
  database: "RDP_DAILY"
});

// --- Descripción del esquema para la IA ---
const schemaDescription = `
Tablas principales (MySQL):

D_RDP_TORNILLOS (
  FECHA DATE,
  COD_PLANTA INT,
  COD_TIPO_TORNILLO INT,
  COD_TURNO INT,
  COD_MAQUINA INT,
  COD_OPERARIO INT,
  CANTIDAD_PRODUCIDA INT,
  CANTIDAD_RECHAZADA INT,
  TIEMPO_MAQUINA_H DECIMAL(6,2),
  TIEMPO_PARADAS_H DECIMAL(6,2)
)

DIM_PLANTA (
  COD_PLANTA INT,
  NOMBRE_PLANTA VARCHAR,
  PAIS VARCHAR,
  PROVINCIA VARCHAR,
  CIUDAD VARCHAR
)

DIM_TIPO_TORNILLO (
  COD_TIPO_TORNILLO INT,
  DESCRIPCION VARCHAR,
  MATERIAL VARCHAR
)

DIM_TURNO (
  COD_TURNO INT,
  NOMBRE_TURNO VARCHAR
)
`;

// --- 1. La IA genera las queries SQL ---
async function generarSQLDesdePregunta(pregunta: string) {
  const res = await client.chat.completions.create({
    model: "openai/gpt-oss-20b",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `
Eres un asistente que traduce preguntas en español sobre producción de tornillos
a consultas SQL de MySQL. SOLO puedes usar SELECT (nunca INSERT, UPDATE, DELETE, DROP, etc.).

Devuelve EXCLUSIVAMENTE un JSON válido con este formato:

{
  "queries": [
    {
      "description": "explicación breve de qué calcula esta query",
      "sql": "SELECT ... "
    }
  ]
}

No incluyas texto fuera del JSON, ni explicaciones adicionales.
        `.trim()
      },
      {
        role: "user",
        content: `
Esquema de la base de datos:

${schemaDescription}

Pregunta del usuario:
${pregunta}
        `.trim()
      }
    ]
  });

  const content = res.choices[0].message.content;
  if (!content) {
    throw new Error("El modelo no devolvió contenido para las queries.");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("Error al parsear JSON devuelto por el modelo:\n", content);
    throw err;
  }

  if (!parsed.queries || !Array.isArray(parsed.queries)) {
    throw new Error("El JSON no contiene un array 'queries'.");
  }

  // Seguridad básica: solo SELECT
  const queries = parsed.queries.filter((q: any) => {
    const sql: string = (q.sql || "").trim().toUpperCase();
    return sql.startsWith("SELECT");
  });

  return queries as { description: string; sql: string }[];
}

// --- 2. Ejecutar queries en MySQL ---
async function ejecutarQueries(queries: { description: string; sql: string }[]) {
  const resultados: {
    description: string;
    sql: string;
    rows: any[];
  }[] = [];

  for (const q of queries) {
    try {
      const [rows] = await pool.query(q.sql);
      resultados.push({
        description: q.description,
        sql: q.sql,
        rows: rows as any[]
      });
    } catch (err) {
      resultados.push({
        description: `ERROR ejecutando: ${q.description}`,
        sql: q.sql,
        rows: [{ error: (err as any).message }]
      });
    }
  }

  return resultados;
}

// --- 3. IA genera respuesta final usando resultados ---
async function responderConResultados(pregunta: string, resultados: any) {
  const res = await client.chat.completions.create({
    model: "openai/gpt-oss-20b",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `
Eres un analista de datos de producción de tornillos.
Responde SIEMPRE en español, de forma muy concisa y clara.
Usa SOLO los datos proporcionados en las consultas y resultados.
Si algo no se puede responder con esos datos, dilo claramente.
        `.trim()
      },
      {
        role: "user",
        content: `
Pregunta original:
${pregunta}

Consultas ejecutadas y sus resultados (formato JSON):
${JSON.stringify(resultados)}
        `.trim()
      }
    ]
  });

  return res.choices[0].message.content ?? "";
}

// --- Endpoint del chat ---
app.post("/api/chat", async (req, res) => {
  const { message } = req.body as { message?: string };

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Falta 'message' en el body." });
  }

  try {
    const queries = await generarSQLDesdePregunta(message);
    const resultados = await ejecutarQueries(queries);
    const answer = await responderConResultados(message, resultados);

    res.json({
      answer,
      queries,
      resultados
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error procesando la pregunta." });
  }
});

// --- Levantar servidor ---
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 ManolitoDB Chat escuchando en http://localhost:${PORT}`);
});
