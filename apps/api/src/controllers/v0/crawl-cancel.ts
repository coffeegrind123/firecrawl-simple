import { Request, Response } from "express";
import { authenticateUser } from "../auth";
import { RateLimiterMode } from "../../../src/types";
import { Logger } from "../../../src/lib/logger";
import { getCrawl, saveCrawl } from "../../../src/lib/crawl-redis";
import { configDotenv } from "dotenv";
configDotenv();

export async function crawlCancelController(req: Request, res: Response) {
  try {
    const { success, team_id, error, status } = await authenticateUser(
      req,
      res,
      RateLimiterMode.CrawlStatus
    );
    if (!success) {
      return res.status(status || 401).json({ error });
    }

    const sc = await getCrawl(req.params.jobId);
    if (!sc) {
      return res.status(404).json({ error: "Job not found" });
    }

    try {
      sc.cancelled = true;
      await saveCrawl(req.params.jobId, sc);
    } catch (error) {
      Logger.error(error);
    }

    res.json({
      status: "cancelled",
    });
  } catch (error) {
    Logger.error(error);
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
