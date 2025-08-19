import { Request, Response } from "express";
import { authenticateUser } from "../auth";
import { RateLimiterMode } from "../../../src/types";
import { addScrapeJobRaw } from "../../../src/services/queue-jobs";
import { createIdempotencyKey } from "../../../src/services/idempotency/create";
import {
  defaultCrawlPageOptions,
  defaultCrawlerOptions,
  defaultOrigin,
} from "../../../src/lib/default-values";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "../../../src/lib/logger";
import {
  addCrawlJob,
  addCrawlJobs,
  crawlToCrawler,
  lockURL,
  lockURLs,
  saveCrawl,
  StoredCrawl,
} from "../../../src/lib/crawl-redis";
import { getScrapeQueue } from "../../../src/services/queue-service";
import { checkAndUpdateURL } from "../../../src/lib/validateUrl";
import { getJobPriority } from "../../lib/job-priority";

export async function crawlController(req: Request, res: Response) {
  try {
    const { success, team_id, error, status, plan } = await authenticateUser(
      req,
      res,
      RateLimiterMode.Crawl
    );
    if (!success) {
      return res.status(status || 401).json({ error });
    }

    if (req.headers["x-idempotency-key"]) {
      try {
        createIdempotencyKey(req);
      } catch (error) {
        Logger.error(error);
        return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      }
    }

    const crawlerOptions = {
      ...defaultCrawlerOptions,
      ...req.body.crawlerOptions,
    };
    const pageOptions = { ...defaultCrawlPageOptions, ...req.body.pageOptions };

    if (Array.isArray(crawlerOptions.includes)) {
      for (const x of crawlerOptions.includes) {
        try {
          new RegExp(x);
        } catch (e) {
          return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    if (Array.isArray(crawlerOptions.excludes)) {
      for (const x of crawlerOptions.excludes) {
        try {
          new RegExp(x);
        } catch (e) {
          return res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    let url = req.body.url;
    if (!url) {
      return res.status(400).json({ error: "Url is required" });
    }
    if (typeof url !== "string") {
      return res.status(400).json({ error: "URL must be a string" });
    }
    try {
      url = checkAndUpdateURL(url).url;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      return res
        .status(e instanceof Error && e.message === "Invalid URL" ? 400 : 500)
        .json({ error: errorMessage });
    }

    const id = uuidv4();

    const sc: StoredCrawl = {
      originUrl: url,
      crawlerOptions,
      pageOptions,
      team_id,
      plan,
      createdAt: Date.now(),
    };

    const crawler = crawlToCrawler(id, sc);

    try {
      sc.robots = await crawler.getRobotsTxt();
    } catch (_) {}

    await saveCrawl(id, sc);

    const sitemap =
      sc.crawlerOptions?.ignoreSitemap ?? true
        ? null
        : await crawler.tryGetSitemap();

    if (sitemap !== null && sitemap.length > 0) {
      let jobPriority = 20;
      // If it is over 1000, we need to get the job priority,
      // otherwise we can use the default priority of 20
      if (sitemap.length > 1000) {
        // set base to 21
        jobPriority = await getJobPriority({ plan, team_id, basePriority: 21 });
      }
      const jobs = sitemap.map((x) => {
        Logger.debug(`Adding job from sitemap for ${x.url}`);

        const url = x.url;
        const uuid = uuidv4();
        return {
          name: uuid,
          data: {
            url,
            mode: "single_urls",
            crawlerOptions: crawlerOptions,
            team_id: team_id,
            pageOptions: pageOptions,
            origin: req.body.origin ?? defaultOrigin,
            crawl_id: id,
            sitemapped: true,
          },
          opts: {
            jobId: uuid,
            priority: jobPriority,
          },
        };
      });

      await lockURLs(
        id,
        jobs.map((x) => x.data.url)
      );
      await addCrawlJobs(
        id,
        jobs.map((x) => x.opts.jobId)
      );

      await getScrapeQueue().addBulk(jobs);
    } else {
      await lockURL(id, sc, url);

      const job = await addScrapeJobRaw(
        {
          url,
          mode: "single_urls",
          crawlerOptions: crawlerOptions,
          team_id: team_id,
          pageOptions: pageOptions,
          origin: req.body.origin ?? defaultOrigin,
          crawl_id: id,
        },
        {
          priority: 15, // prioritize request 0 of crawl jobs same as scrape jobs
        },
        uuidv4(),
        10
      );
      await addCrawlJob(id, job.id);
    }

    res.json({ jobId: id });
  } catch (error) {
    Logger.error(error);
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
