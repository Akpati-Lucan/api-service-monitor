import type { NextFunction, Request, Response } from "express";
import type { DatabaseApi } from "../db/database.js";
import type { AppConfig } from "../types/index.js";
import { authenticateBearer } from "./apiKeys.js";
import { UNRESTRICTED_AUTH } from "./access.js";

export function createAuthMiddleware({ db, config }: { db: DatabaseApi; config: AppConfig }) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (config.AUTH_MODE !== "enabled") {
        res.locals.auth = UNRESTRICTED_AUTH;
        next();
        return;
      }
      if (req.path === "/mcp" && !req.header("authorization")) {
        next();
        return;
      }
      res.locals.auth = authenticateBearer(db, req.header("authorization"));
      next();
    } catch (error) {
      next(error);
    }
  };
}
