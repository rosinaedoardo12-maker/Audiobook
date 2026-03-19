const SETTINGS_KEY = "audiobook-studio-settings";

const state = {
  file: null,
  extractedText: "",
  voices: {
    windows: [],
    edge: [],
  },
  deferredPrompt: null,
};

const elements = {
  pdfInput: document.getElementById("pdfInput"),
  dropzone: document.getElementById("dropzone"),
  providerSelect: document.getElementById("providerSelect"),
  voiceSelect: document.getElementById("voiceSelect"),
  rateInput: document.getElementById("rateInput"),
  volumeInput: document.getElementById("volumeInput"),
  rateValue: document.getElementById("rateValue"),
  volumeValue: document.getElementById("volumeValue"),
  textPreview: document.getElementById("textPreview"),
  statusBox: document.getElementById("statusBox"),
  generateButton: document.getElementById("generateButton"),
  downloadLink: document.getElementById("downloadLink"),
  clearButton: document.getElementById("clearButton"),
  bookTitle: document.getElementById("bookTitle"),
  pageCount: document.getElementById("pageCount"),
  wordCount: document.getElementById("wordCount"),
  charCount: document.getElementById("charCount"),
  titleInput: document.getElementById("titleInput"),
  voiceCount: document.getElementById("voiceCount"),
  healthStatus: document.getElementById("healthStatus"),
  installButton: document.getElementById("installButton"),
};

function setStatus(message, type = "info") {
  elements.statusBox.className = `status-box ${type}`;
  elements.statusBox.textContent = message;
}

function saveSettings() {
  const payload = {
    provider: elements.providerSelect.value,
    rate: elements.rateInput.value,
    volume: elements.volumeInput.value,
    voiceName: elements.voiceSelect.value,
  };

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function populateVoices() {
  const provider = elements.providerSelect.value;
  const voices = provider === "edge" ? state.voices.edge : state.voices.windows;
  const saved = readSettings();
  elements.voiceSelect.innerHTML = "";

  if (!voices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Nessuna voce trovata";
    elements.voiceSelect.append(option);
    return;
  }

  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent =
      provider === "edge"
        ? `${voice.localName || voice.label} · ${voice.locale} · ${voice.gender}`
        : `${voice.name} · ${voice.culture} · ${voice.gender}`;
    elements.voiceSelect.append(option);
  });

  const preferredVoice = saved.voiceName && voices.some((voice) => voice.name === saved.voiceName)
    ? saved.voiceName
    : voices[0].name;

  elements.voiceSelect.value = preferredVoice;
}

function syncProviderUi(showMessage = true) {
  elements.rateValue.textContent = elements.rateInput.value;
  elements.volumeValue.textContent = `${elements.volumeInput.value}%`;
  populateVoices();
  saveSettings();

  if (showMessage && elements.providerSelect.value === "edge") {
    setStatus(
      "Modalita gratuita attiva: Edge Neural usa internet ma non richiede API key e offre voci piu naturali.",
      "info"
    );
  }
}

function updateMetrics({ title = "Nessun file", pages = 0, words = 0, characters = 0 }) {
  elements.bookTitle.textContent = title;
  elements.pageCount.textContent = pages;
  elements.wordCount.textContent = words.toLocaleString("it-IT");
  elements.charCount.textContent = characters.toLocaleString("it-IT");
}

function restoreSettings() {
  const saved = readSettings();

  if (saved.provider) {
    elements.providerSelect.value = saved.provider;
  }

  if (saved.rate) {
    elements.rateInput.value = saved.rate;
  }

  if (saved.volume) {
    elements.volumeInput.value = saved.volume;
  }

  elements.rateValue.textContent = elements.rateInput.value;
  elements.volumeValue.textContent = `${elements.volumeInput.value}%`;
}

function updateInstallAvailability() {
  elements.installButton.classList.toggle("hidden", !state.deferredPrompt);
}

async function installApp() {
  if (!state.deferredPrompt) {
    return;
  }

  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice;
  state.deferredPrompt = null;
  updateInstallAvailability();
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/service-worker.js");
  } catch {
    setStatus("L'app funziona, ma il supporto offline non e stato registrato.", "info");
  }
}

async function loadVoices() {
  try {
    const [healthRes, voicesRes] = await Promise.all([
      fetch("/api/health"),
      fetch("/api/voices"),
    ]);

    const health = await healthRes.json();
    const voicesData = await voicesRes.json();

    state.voices.windows = voicesData.voices || [];
    state.voices.edge = voicesData.edgeVoices || [];
    populateVoices();

    const totalVoices = (state.voices.windows?.length || 0) + (state.voices.edge?.length || 0);
    elements.voiceCount.textContent = String(totalVoices);
    elements.healthStatus.textContent = health.ok ? "Online" : "Errore";

    if (voicesData.warnings?.length) {
      setStatus(voicesData.warnings.join(" "), "info");
    }
  } catch (error) {
    setStatus("Impossibile leggere le voci disponibili. Controlla che il server sia attivo.", "error");
    elements.healthStatus.textContent = "Offline";
  }
}

async function handleFile(file) {
  if (!file) {
    return;
  }

  if (file.type !== "application/pdf") {
    setStatus("Il file selezionato non e un PDF valido.", "error");
    return;
  }

  state.file = file;
  setStatus("Sto leggendo il PDF e preparando il testo...", "info");
  elements.downloadLink.classList.add("hidden");

  const formData = new FormData();
  formData.append("pdf", file);

  try {
    const response = await fetch("/api/extract-pdf", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Errore durante l'estrazione del PDF.");
    }

    state.extractedText = data.text;
    elements.textPreview.value = data.text;
    elements.titleInput.value = data.title;
    updateMetrics(data);
    setStatus("PDF letto correttamente. Puoi rivedere il testo e generare l'audio.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function generateAudiobook() {
  const text = elements.textPreview.value.trim();
  const provider = elements.providerSelect.value;
  const voiceName = elements.voiceSelect.value;
  const title = elements.titleInput.value.trim() || "audiolibro";

  if (!text) {
    setStatus("Manca il testo da convertire. Carica un PDF o incolla il contenuto.", "error");
    return;
  }

  if (!voiceName) {
    setStatus("Seleziona una voce prima di generare l'audio.", "error");
    return;
  }

  elements.generateButton.disabled = true;
  setStatus("Generazione audio in corso. Per testi lunghi potrebbero volerci alcuni secondi...", "info");

  try {
    const response = await fetch("/api/generate-audio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        provider,
        voiceName,
        title,
        rate: Number(elements.rateInput.value),
        volume: Number(elements.volumeInput.value),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Non sono riuscito a generare l'audio.");
    }

    elements.downloadLink.href = data.downloadUrl;
    elements.downloadLink.download = data.fileName;
    elements.downloadLink.classList.remove("hidden");
    setStatus("Audiolibro creato con successo. Ora puoi scaricarlo.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.generateButton.disabled = false;
  }
}

function clearWorkspace() {
  state.file = null;
  state.extractedText = "";
  elements.pdfInput.value = "";
  elements.textPreview.value = "";
  elements.titleInput.value = "";
  elements.downloadLink.classList.add("hidden");
  updateMetrics({});
  setStatus("Area ripulita. Puoi caricare un nuovo PDF.", "info");
}

elements.pdfInput.addEventListener("change", (event) => {
  handleFile(event.target.files?.[0]);
});

elements.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("dragging");
});

elements.dropzone.addEventListener("dragleave", () => {
  elements.dropzone.classList.remove("dragging");
});

elements.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("dragging");
  handleFile(event.dataTransfer.files?.[0]);
});

elements.rateInput.addEventListener("input", () => {
  elements.rateValue.textContent = elements.rateInput.value;
  saveSettings();
});

elements.volumeInput.addEventListener("input", () => {
  elements.volumeValue.textContent = `${elements.volumeInput.value}%`;
  saveSettings();
});

elements.providerSelect.addEventListener("change", () => syncProviderUi());
elements.voiceSelect.addEventListener("change", saveSettings);
elements.generateButton.addEventListener("click", generateAudiobook);
elements.clearButton.addEventListener("click", clearWorkspace);
elements.installButton.addEventListener("click", installApp);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredPrompt = event;
  updateInstallAvailability();
});

window.addEventListener("appinstalled", () => {
  state.deferredPrompt = null;
  updateInstallAvailability();
  setStatus("App installata correttamente sul dispositivo.", "success");
});

window.addEventListener("online", () => {
  setStatus("Connessione ripristinata. Puoi generare nuovi audiolibri.", "success");
});

window.addEventListener("offline", () => {
  setStatus("Sei offline. L'interfaccia resta disponibile, ma per generare audio serve internet.", "info");
});

restoreSettings();
loadVoices();
syncProviderUi(false);
registerServiceWorker();
updateInstallAvailability();
