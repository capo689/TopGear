import { startFixtureFarm } from "./server.js";

const port = Number(process.env.PORT ?? 4599);

startFixtureFarm({ port }).then((farm) => {
  process.stdout.write(`fixture-farm listening on ${farm.url}\n`);
  const shutdown = () => {
    void farm.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
