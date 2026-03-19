import express from "express";
import cors from "cors";
import multer from "multer";
import pdf from "pdf-parse";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { EdgeTTS, Constants } from "@andresaya/edge-tts";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const configuredGeneratedDir = process.env.GENERATED_DIR
  ? path.resolve(rootDir, process.env.GENERATED_DIR)
  : path.join(publicDir, "generated");
const generatedDir = configuredGeneratedDir;
const powerShellBin =
  process.env.POWERSHELL_PATH ||
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const edgeDefaultVoices = [
  "it-IT-ElsaNeural",
  "it-IT-IsabellaNeural",
  "it-IT-DiegoNeural",
  "it-IT-GiuseppeNeural",
  "en-US-JennyNeural",
  "en-US-AriaNeural",
];

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(express.static(publicDir));
app.use("/generated", express.static(generatedDir));

function normalizeText(text) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapePowerShell(value) {
  return value.replace(/'/g, "''");
}

function buildSafeSlug(title = "") {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return base || `audiobook-${Date.now()}`;
}

function splitTextForSpeech(text, maxChunkLength = 2600) {
  const normalized = normalizeText(text);

  if (normalized.length <= maxChunkLength) {
    return [normalized];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

    if (candidate.length <= maxChunkLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= maxChunkLength) {
      current = paragraph;
      continue;
    }

    const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
    let sentenceChunk = "";

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      const sentenceCandidate = sentenceChunk
        ? `${sentenceChunk} ${trimmedSentence}`
        : trimmedSentence;

      if (sentenceCandidate.length <= maxChunkLength) {
        sentenceChunk = sentenceCandidate;
        continue;
      }

      if (sentenceChunk) {
        chunks.push(sentenceChunk);
      }

      sentenceChunk = trimmedSentence;
    }

    if (sentenceChunk) {
      current = sentenceChunk;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function readWavData(buffer) {
  const headerSize = 44;

  if (buffer.length < headerSize) {
    throw new Error("File audio WAV non valido.");
  }

  return {
    header: buffer.subarray(0, headerSize),
    data: buffer.subarray(headerSize),
  };
}

function combineWavBuffers(buffers) {
  if (!buffers.length) {
    throw new Error("Nessun blocco audio da unire.");
  }

  const parts = buffers.map(readWavData);
  const baseHeader = Buffer.from(parts[0].header);
  const totalAudioBytes = parts.reduce((sum, part) => sum + part.data.length, 0);
  const merged = Buffer.concat(parts.map((part) => part.data), totalAudioBytes);

  baseHeader.writeUInt32LE(36 + totalAudioBytes, 4);
  baseHeader.writeUInt32LE(totalAudioBytes, 40);

  return Buffer.concat([baseHeader, merged]);
}

async function ensureFolders() {
  if (!existsSync(generatedDir)) {
    await fs.mkdir(generatedDir, { recursive: true });
  }
}

async function getInstalledVoices() {
  const script = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | ForEach-Object {
  $info = $_.VoiceInfo
  [PSCustomObject]@{
    name = $info.Name
    culture = $info.Culture.Name
    gender = $info.Gender.ToString()
    description = $info.Description
  }
}
$voices | ConvertTo-Json
`;

  const { stdout } = await execFileAsync(
    powerShellBin,
    ["-NoProfile", "-Command", script],
    { maxBuffer: 1024 * 1024 * 4 }
  );

  if (!stdout.trim()) {
    return [];
  }

  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function getEdgeVoices() {
  const tts = new EdgeTTS();
  const voices = await tts.getVoices();

  return voices
    .map((voice) => ({
      name: voice.ShortName,
      locale: voice.Locale,
      gender: voice.Gender,
      label: voice.FriendlyName || voice.ShortName,
      localName: voice.LocalName,
      priority:
        voice.Locale === "it-IT"
          ? 0
          : edgeDefaultVoices.includes(voice.ShortName)
            ? 1
            : 2,
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      if (a.locale !== b.locale) {
        return a.locale.localeCompare(b.locale);
      }

      return a.label.localeCompare(b.label);
    });
}

async function synthesizeWav({ text, voiceName, rate, volume, outputPath }) {
  const escapedText = escapePowerShell(text);
  const escapedVoice = escapePowerShell(voiceName);
  const escapedOutput = escapePowerShell(outputPath);
  const safeRate = Number.isFinite(rate) ? Math.max(-10, Math.min(10, rate)) : 0;
  const safeVolume = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 100;

  const script = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('${escapedVoice}')
$synth.Rate = ${safeRate}
$synth.Volume = ${safeVolume}
$synth.SetOutputToWaveFile('${escapedOutput}')
$synth.Speak('${escapedText}')
$synth.Dispose()
`;

  await execFileAsync(
    powerShellBin,
    ["-NoProfile", "-Command", script],
    { maxBuffer: 1024 * 1024 * 20 }
  );
}

function mergeBinaryBuffers(buffers) {
  if (!buffers.length) {
    throw new Error("Nessun blocco audio da unire.");
  }

  return Buffer.concat(buffers);
}

function toEdgeRate(value) {
  const safe = Math.max(-5, Math.min(5, Number(value) || 0));
  return `${safe * 10}%`;
}

function toEdgeVolume(value) {
  const safe = Math.max(20, Math.min(100, Number(value) || 100));
  return `${safe - 100}%`;
}

async function synthesizeEdgeMp3({
  text,
  voiceName,
  title,
  rate = 0,
  volume = 100,
}) {
  const chunks = splitTextForSpeech(text);
  const audioChunks = [];

  for (const chunk of chunks) {
    const tts = new EdgeTTS();

    await tts.synthesize(chunk, voiceName, {
      rate: toEdgeRate(rate),
      volume: toEdgeVolume(volume),
      outputFormat: Constants.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
    });

    audioChunks.push(tts.toBuffer());
  }

  const merged = mergeBinaryBuffers(audioChunks);
  const slug = buildSafeSlug(title);
  const filename = `${slug}-${Date.now()}.mp3`;
  const outputPath = path.join(generatedDir, filename);

  await fs.writeFile(outputPath, merged);

  return {
    fileName: filename,
    downloadUrl: `/generated/${filename}`,
    chunks: chunks.length,
  };
}

app.get("/api/health", async (_req, res) => {
  try {
    const [windowsVoices, edgeVoices] = await Promise.allSettled([
      getInstalledVoices(),
      getEdgeVoices(),
    ]);

    const windowsCount =
      windowsVoices.status === "fulfilled" ? windowsVoices.value.length : 0;
    const edgeCount = edgeVoices.status === "fulfilled" ? edgeVoices.value.length : 0;

    res.json({
      ok: true,
      voices: windowsCount + edgeCount,
      outputDir: generatedDir,
      providers: {
        windows: windowsVoices.status === "fulfilled",
        edge: edgeVoices.status === "fulfilled",
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Impossibile leggere le voci installate.",
      details: error.message,
    });
  }
});

app.get("/api/voices", async (_req, res) => {
  const [windowsVoices, edgeVoices] = await Promise.allSettled([
    getInstalledVoices(),
    getEdgeVoices(),
  ]);

  res.json({
    voices: windowsVoices.status === "fulfilled" ? windowsVoices.value : [],
    edgeVoices: edgeVoices.status === "fulfilled" ? edgeVoices.value : [],
    providers: {
      windows: windowsVoices.status === "fulfilled",
      edge: edgeVoices.status === "fulfilled",
    },
    warnings: [
      windowsVoices.status === "rejected" ? "Voci Windows non disponibili." : "",
      edgeVoices.status === "rejected"
        ? "Voci Edge Neural non disponibili. Controlla la connessione internet."
        : "",
    ].filter(Boolean),
  });
});

app.post("/api/extract-pdf", upload.single("pdf"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Carica un file PDF prima di continuare." });
  }

  if (req.file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "Il file deve essere un PDF." });
  }

  try {
    const parsed = await pdf(req.file.buffer);
    const cleanText = normalizeText(parsed.text || "");

    if (!cleanText) {
      return res.status(400).json({
        error: "Non ho trovato testo leggibile nel PDF. Prova con un PDF non scannerizzato.",
      });
    }

    res.json({
      title: req.file.originalname.replace(/\.pdf$/i, ""),
      text: cleanText,
      pages: parsed.numpages || 0,
      characters: cleanText.length,
      words: cleanText.split(/\s+/).filter(Boolean).length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Errore durante la lettura del PDF.",
      details: error.message,
    });
  }
});

app.post("/api/generate-audio", async (req, res) => {
  const {
    text,
    voiceName,
    provider = "edge",
    rate = 0,
    volume = 100,
    title = "audiolibro",
  } = req.body;

  if (!text || typeof text !== "string" || text.trim().length < 40) {
    return res.status(400).json({
      error: "Inserisci almeno un blocco di testo valido da convertire in audio.",
    });
  }

  if (!voiceName) {
    return res.status(400).json({ error: "Seleziona una voce." });
  }

  try {
    await ensureFolders();
    const normalizedText = normalizeText(text);

    if (provider === "edge") {
      const result = await synthesizeEdgeMp3({
        text: normalizedText,
        voiceName,
        title,
        rate: Number(rate),
        volume: Number(volume),
      });

      return res.json({
        message: "Audiolibro neural generato con successo.",
        fileName: result.fileName,
        downloadUrl: result.downloadUrl,
        chunks: result.chunks,
      });
    }

    const slug = buildSafeSlug(title);
    const filename = `${slug}-${Date.now()}.wav`;
    const outputPath = path.join(generatedDir, filename);

    await synthesizeWav({
      text: normalizedText,
      voiceName,
      rate: Number(rate),
      volume: Number(volume),
      outputPath,
    });

    return res.json({
      message: "Audiolibro generato con successo.",
      fileName: filename,
      downloadUrl: `/generated/${filename}`,
    });
  } catch (error) {
    res.status(500).json({
      error: "Errore durante la generazione dell'audio.",
      details: error.message,
    });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";

ensureFolders()
  .then(() => {
    app.listen(port, host, () => {
      const localUrl = `http://localhost:${port}`;
      console.log(`Audiobook Studio attivo su ${localUrl}`);
    });
  })
  .catch((error) => {
    console.error("Errore avvio cartelle:", error);
    process.exit(1);
  });
