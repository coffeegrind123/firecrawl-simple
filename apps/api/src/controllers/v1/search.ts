import { Response } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  RequestWithAuth,
  SearchRequest,
  SearchResponse,
  searchRequestSchema,
  legacyScrapeOptions,
  legacyDocumentConverter,
} from "./types";
import { SearchEngineManager } from "../../lib/search-engines";
import { addScrapeJobRaw, waitForJob } from "../../services/queue-jobs";
import { getJobPriority } from "../../lib/job-priority";
import { PlanType } from "../../types";

/**
 * @openapi
 * /v1/search:
 *   post:
 *     tags:
 *       - Search
 *     summary: Search the web and optionally scrape content
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: The search query
 *                 example: "Samsung Galaxy S25 specs"
 *               region:
 *                 type: string
 *                 enum: ["us-en", "uk-en", "ca-en", "au-en", "de-de", "fr-fr", "es-es", "it-it", "jp-jp", "kr-kr", "cn-zh"]
 *                 default: "us-en"
 *                 description: Search region and language
 *               safesearch:
 *                 type: string
 *                 enum: ["on", "moderate", "off"]
 *                 default: "moderate"
 *                 description: Safe search setting
 *               timelimit:
 *                 type: string
 *                 enum: ["d", "w", "m", "y"]
 *                 description: Time limit for results (day, week, month, year)
 *               maxResults:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 50
 *                 default: 8
 *                 description: Maximum number of results to return
 *               page:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *                 description: Page number for pagination
 *               scrapeOptions:
 *                 type: object
 *                 description: Optional scraping options to extract content from found URLs
 *                 properties:
 *                   formats:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum: ["markdown", "rawHtml", "screenshot"]
 *                     default: ["markdown"]
 *                     description: Content formats to extract
 *     responses:
 *       200:
 *         description: Search results with optional scraped content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 query:
 *                   type: string
 *                   example: "Samsung Galaxy S25 specs"
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       title:
 *                         type: string
 *                         example: "Samsung Galaxy S25 Ultra - Full Specifications"
 *                       href:
 *                         type: string
 *                         format: uri
 *                         example: "https://www.gsmarena.com/samsung_galaxy_s25_ultra-13270.php"
 *                       body:
 *                         type: string
 *                         example: "The Samsung Galaxy S25 Ultra features a 6.8-inch Dynamic AMOLED display..."
 *                       snippet:
 *                         type: string
 *                         example: "The Samsung Galaxy S25 Ultra features a 6.8-inch Dynamic AMOLED display, Snapdragon 8 Gen 3 processor..."
 *                       content:
 *                         type: object
 *                         description: Scraped content (only present if scrapeOptions provided)
 *                         properties:
 *                           markdown:
 *                             type: string
 *                           rawHtml:
 *                             type: string
 *                           screenshot:
 *                             type: string
 *                 page:
 *                   type: integer
 *                   example: 1
 *                 total:
 *                   type: integer
 *                   example: 8
 *                 search_id:
 *                   type: string
 *                   example: "search_123456789"
 *       400:
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Query is required"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Search service temporarily unavailable"
 */
export async function searchController(
  req: RequestWithAuth<{}, SearchResponse, SearchRequest>,
  res: Response<SearchResponse>
) {
  try {
    req.body = searchRequestSchema.parse(req.body);

    const { query, region, safesearch, timelimit, maxResults, page, scrapeOptions } = req.body;
    const searchId = uuidv4();

    // Initialize search engine manager
    const searchManager = new SearchEngineManager();

    // Perform the search
    const searchResults = await searchManager.search(
      query,
      region,
      safesearch,
      timelimit,
      page,
      maxResults
    );

    let results = searchResults.map(result => ({
      title: result.title,
      href: result.href,
      body: result.body,
      snippet: result.snippet
    }));

    // If scrapeOptions provided, scrape content from found URLs
    if (scrapeOptions && searchResults.length > 0) {
      const scrapingPromises = searchResults.slice(0, Math.min(6, searchResults.length)).map(async (result, index) => {
        try {
          const pageOptions = legacyScrapeOptions(scrapeOptions);
          const jobPriority = await getJobPriority({
            plan: req.auth.plan as PlanType,
            team_id: req.auth.team_id,
            basePriority: 10,
          });

          const job = await addScrapeJobRaw(
            {
              url: result.href,
              mode: "single_urls",
              crawlerOptions: {},
              team_id: req.auth.team_id,
              pageOptions,
              origin: "search_api",
              is_scrape: true,
            },
            {},
            `search_${searchId}_${index}`,
            jobPriority
          );

          const docs = await waitForJob(job.id, 15000); // 15 sec timeout
          await job.remove();

          if (docs && docs.length > 0) {
            const doc = legacyDocumentConverter(docs[0]);
            return {
              ...result,
              content: doc
            };
          }
        } catch (error) {
          console.error(`Failed to scrape ${result.href}:`, error);
        }
        return result; // Return without content if scraping fails
      });

      const scrapedResults = await Promise.all(scrapingPromises);
      results = scrapedResults;
    }

    return res.status(200).json({
      success: true,
      query,
      results,
      page,
      total: results.length,
      search_id: req.body.origin?.includes("website") ? searchId : undefined,
    });

  } catch (error) {
    console.error("Search controller error:", error);
    
    if (error instanceof Error && error.message.includes("Query is required")) {
      return res.status(400).json({
        success: false,
        error: "Query is required"
      });
    }

    return res.status(500).json({
      success: false,
      error: "Search service temporarily unavailable"
    });
  }
}