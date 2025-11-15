import OpenAI from "openai";
import mysql from "mysql2/promise";

// 0. Cliente OpenAI local
const client = new OpenAI({
  apiKey: "dummy", // obligatorio para la librería, aunque tu server local no la use
  baseURL: "http://192.168.0.30:1234/v1"
});

// 1. Conexión a MySQL
const pool = await mysql.createPool({
  host: "localhost",
  port: 3306,
  user: "manolitoGPT",
  password: "manolitoGPT",
  database: "RDP_DAILY" 
});

// 2. Descripción del esquema (puedes afinarla todo lo que quieras)
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

// 3. Función que pide al modelo las queries SQL necesarias
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

  // Parsear el JSON que nos devuelve el modelo
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("Error al parsear el JSON devuelto por el modelo:\n", content);
    throw err;
  }

  if (!parsed.queries || !Array.isArray(parsed.queries)) {
    throw new Error("El JSON no contiene un array 'queries'.");
  }

  // Filtrar para asegurar que sean solo SELECT por seguridad
  const queries = parsed.queries.filter((q: any) => {
    const sql: string = (q.sql || "").trim().toUpperCase();
    return sql.startsWith("SELECT");
  });

  return queries;
}

// 4. Ejecutar las queries y devolver resultados
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

// 5. Pedir al modelo que responda al usuario usando los resultados
async function responderConResultados(pregunta: string, resultados: any) {
  const stream = await client.chat.completions.create({
    model: "openai/gpt-oss-20b",
    stream: true,
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
${JSON.stringify(resultados, null, 2)}
        `.trim()
      }
    ]
  });

  // Streaming en consola
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      process.stdout.write(delta);
    }
  }
  process.stdout.write("\n");
}

// 6. Bucle de chat sencillo
console.log("--ManolitoDB Chat--");
console.log("Escribe 'salir' para terminar.\n");

while (true) {
  const pregunta = prompt("Tú: ");
  if (!pregunta || pregunta.trim().toLowerCase() === "salir") {
    break;
  }

  try {
    console.log("\n[Generando SQL desde la pregunta...]\n");
    const queries = await generarSQLDesdePregunta(pregunta);

    console.log("[Consultas generadas por la IA:]");
    queries.forEach((q, i) => {
      console.log(`\n#${i + 1} ${q.description}\n${q.sql}\n`);
    });

    console.log("[Ejecutando consultas en MySQL...]\n");
    const resultados = await ejecutarQueries(queries);

    console.log("[Respuesta de la IA basada en los datos:]\n");
    await responderConResultados(pregunta, resultados);
  } catch (err) {
    console.error("Error en el proceso:", err);
  }
}

// 7. Cerrar pool al salir
await pool.end();
