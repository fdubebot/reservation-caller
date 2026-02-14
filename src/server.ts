import express from "express";
import { env } from "./config/env.js";
import { router } from "./api/routes.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(router);

app.listen(env.port, () => {
  console.log(`reservation-caller listening on :${env.port}`);
});
