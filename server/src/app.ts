import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "./config.js";
import type { DB } from "./db/database.js";
import { authenticate } from "./auth/auth.js";
import { errorHandler, HttpError } from "./lib/http.js";
import { authRouter } from "./routes/auth.js";
import { assetsRouter } from "./routes/assets.js";
import { costsRouter } from "./routes/costs.js";
import { adminRouter } from "./routes/admin.js";

/**
 * CSRF protection: cookie-authenticated state changes must declare a JSON body. Cross-site
 * HTML forms cannot send that content type without a CORS preflight (which is never granted);
 * together with SameSite=Lax cookies this blocks CSRF. Bearer-token clients carry no cookie.
 */
function requireJsonForMutations(req: Request, _res: Response, next: NextFunction) {
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  const bearer = req.headers.authorization?.startsWith("Bearer ");
  if (mutating && !bearer && !(req.headers["content-type"] ?? "").startsWith("application/json")) {
    return next(new HttpError(415, "Content-Type application/json erforderlich."));
  }
  next();
}

export function createApp(db: DB, config: Config) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
  app.use(
    helmet({
      // Without TLS (local evaluation) HSTS and upgrade-insecure-requests would break the UI.
      strictTransportSecurity: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: config.cookieSecure ? [] : null,
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  const api = express.Router();
  api.use(express.json({ limit: "12mb" }));
  api.use(requireJsonForMutations);
  api.use(authenticate(db, config));
  api.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  api.use(authRouter(db, config));
  api.use(assetsRouter(db));
  api.use(costsRouter(db, config));
  api.use(adminRouter(db));
  api.use((_req, _res, next) => next(new HttpError(404, "Endpunkt nicht gefunden.")));
  app.use("/api", api);

  // Resolve once: a relative STATIC_DIR would otherwise make res.sendFile throw.
  const staticDir = config.staticDir ? resolve(config.staticDir) : null;
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(join(staticDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
