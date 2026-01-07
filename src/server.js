const { createApp } = require("./app");
const { initDb } = require("./db/init");
const { PORT, NODE_ENV } = require("./config");

async function start() {
  await initDb();
  const app = createApp();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PUNCTOO demo v2 running (env=${NODE_ENV})`);
    console.log(`Listening on 0.0.0.0:${PORT}`);
    console.log(`Open /tags`);
  });
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
