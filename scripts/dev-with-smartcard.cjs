const { spawn } = require("child_process");
const path = require("path");

const cwd = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function start(name, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[${name}] exited with signal ${signal}`);
      return;
    }
    console.log(`[${name}] exited with code ${code ?? 0}`);
  });
  return child;
}

const service = start("smartcard-service", process.execPath, ["scripts/thai-card-service.cjs"]);
const web = start("next-dev", npmCmd, ["run", "dev"]);

const shutdown = (signal) => {
  console.log(`[dev-with-smartcard] received ${signal}, shutting down...`);
  try {
    service.kill("SIGTERM");
  } catch {}
  try {
    web.kill("SIGTERM");
  } catch {}
  setTimeout(() => process.exit(0), 400);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

