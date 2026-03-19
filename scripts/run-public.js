import { spawn } from "child_process";
import process from "process";
import localtunnel from "localtunnel";

const port = Number(process.env.PORT || 3000);
const localUrl = `http://127.0.0.1:${port}/api/health`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(localUrl);
      if (response.ok) {
        return true;
      }
    } catch {
      // retry
    }

    await sleep(1000);
  }

  throw new Error("Il server locale non si e avviato in tempo.");
}

const server = spawn("node", ["src/index.js"], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: "0.0.0.0",
    PORT: String(port),
  },
});

let tunnel;

async function cleanup(code = 0) {
  if (tunnel) {
    await tunnel.close();
  }

  if (!server.killed) {
    server.kill();
  }

  process.exit(code);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

server.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code || 1);
  }
});

try {
  await waitForServer();
  tunnel = await localtunnel({ port });

  console.log("");
  console.log("Link pubblico HTTPS pronto:");
  console.log(tunnel.url);
  console.log("");
  console.log("Aprilo su iPhone in Safari.");
  console.log("Lascia questa finestra aperta: se la chiudi, il link smette di funzionare.");
  console.log("");

  tunnel.on("close", () => {
    console.log("Tunnel chiuso.");
    cleanup(0);
  });
} catch (error) {
  console.error("Errore avvio link pubblico:", error.message);
  cleanup(1);
}
