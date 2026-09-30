import pino from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.logLevel,
  ...(process.env.NODE_ENV === "development" && {
    transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
  }),
});
