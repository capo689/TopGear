import { startCommonsIngest } from "./server.js";

const port = Number(process.env.PORT ?? 4610);
startCommonsIngest({ port }).then((ingest) => {
  process.stdout.write(`commons-ingest (stub) listening on ${ingest.url}\n`);
  const shutdown = () => void ingest.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
