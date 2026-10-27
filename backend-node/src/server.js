
require("dotenv").config({
  path: require("node:path").resolve(__dirname, "../.env")
});

const app = require("./app");

const connectDB = require("./config/db");
const {
  startCheckoutRecoveryWorker,
  stopCheckoutRecoveryWorker
} = require("./services/checkoutRecoveryService");

const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  console.warn(JSON.stringify({
    event: "configuration_missing",
    variable: "JWT_SECRET",
    message: "Login requests will return 503 until JWT_SECRET is configured"
  }));
}

let server;
let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ event: "server_shutdown_started", signal }));
  const closeServer = server
    ? new Promise((resolve) => server.close(resolve))
    : Promise.resolve();
  await stopCheckoutRecoveryWorker();
  await closeServer;
  await require("mongoose").disconnect();
  process.exitCode = 0;
};

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

connectDB().then(() => {
  startCheckoutRecoveryWorker();
  server = app.listen(PORT, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "server_listening", port: PORT }));
  });
}).catch((error) => {
  console.error(JSON.stringify({
    event: "server_startup_failed",
    errorCode: String(error.code || error.name || "STARTUP_ERROR").slice(0, 80)
  }));
  process.exitCode = 1;
});