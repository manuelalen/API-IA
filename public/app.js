const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("userInput");
const themeSwitch = document.getElementById("themeSwitch");

// --- Tema (dark/light) ---
function applyTheme(theme) {
  document.body.classList.remove("dark", "light");
  document.body.classList.add(theme);
  themeSwitch.checked = theme === "dark";
  localStorage.setItem("manolitodb-theme", theme);
}

const savedTheme = localStorage.getItem("manolitodb-theme") || "dark";
applyTheme(savedTheme);

themeSwitch.addEventListener("change", () => {
  applyTheme(themeSwitch.checked ? "dark" : "light");
});

// --- Utilidades UI ---
function addMessage(content, role = "assistant") {
  const div = document.createElement("div");
  div.classList.add("message", role);
  div.textContent = content;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addTyping() {
  const div = document.createElement("div");
  div.classList.add("message", "assistant");
  div.dataset.typing = "true";

  const span = document.createElement("span");
  span.classList.add("typing");
  span.innerHTML = `
    pensando
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  `;
  div.appendChild(span);

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  return div;
}

function removeTyping() {
  const typingEl = messagesEl.querySelector('[data-typing="true"]');
  if (typingEl) typingEl.remove();
}

// --- Mensaje de bienvenida ---
addMessage(
  "Soy tu asistente sobre la base de datos de producción de tornillos. Pregúntame cosas como “¿Qué planta produjo más tornillos ayer?” o “¿Cuántos tornillos rechazados hubo en Barcelona?”.",
  "assistant"
);

// --- Manejo del formulario ---
formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage(text, "user");
  inputEl.value = "";

  const typingEl = addTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: text })
    });

    removeTyping();

    if (!res.ok) {
      addMessage("Ha ocurrido un error al procesar tu pregunta.", "assistant");
      return;
    }

    const data = await res.json();
    addMessage(data.answer || "(Sin respuesta)", "assistant");

    // Si quieres ver cómo piensa (queries/resultados), puedes loguearlo:
    console.log("Queries generadas:", data.queries);
    console.log("Resultados:", data.resultados);
  } catch (err) {
    console.error(err);
    removeTyping();
    addMessage("Error de red o del servidor.", "assistant");
  }
});
