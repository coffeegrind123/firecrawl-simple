import axios from "axios";
import { generateRequestParams } from "../single_url";
import { universalTimeout } from "../global";
import { Logger } from "../../../lib/logger";

/**
 * Scrapes a URL with Playwright
 * @param url The URL to scrape
 * @param waitFor The time to wait for the page to load
 * @param headers The headers to send with the request
 * @param pageOptions The options for the page
 * @returns The scraped content
 */
export async function scrapeWithPlaywright(
  url: string,
  waitFor: number = 0,
  headers?: Record<string, string>,
  screenshot?: boolean,
  fullPageScreenshot?: boolean
): Promise<{ content: string; pageStatusCode?: number; pageError?: string; screenshot?: string }> {
  const logParams = {
    url,
    scraper: "playwright",
    success: false,
    response_code: null,
    time_taken_seconds: null,
    error_message: null,
    html: "",
    startTime: Date.now(),
  };

  try {
    const reqParams = await generateRequestParams(url);
    const waitParam = reqParams["params"]?.wait ?? waitFor;

    const response = await axios.post(
      process.env.PLAYWRIGHT_MICROSERVICE_URL,
      {
        url: url,
        wait_after_load: waitParam,
        headers: headers,
        screenshot: screenshot || false,
        full_page_screenshot: fullPageScreenshot || false,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: universalTimeout + waitParam,
        transformResponse: [(data) => data],
      }
    );

    if (response.status !== 200) {
      Logger.debug(
        `⛏️ Playwright: Failed to fetch url: ${url} | status: ${response.status}, error: ${response.data?.pageError}`
      );
      logParams.error_message = response.data?.pageError;
      logParams.response_code = response.data?.pageStatusCode;
      return {
        content: "",
        pageStatusCode: response.data?.pageStatusCode,
        pageError: response.data?.pageError,
        screenshot: undefined,
      };
    }

    const textData = response.data;
    try {
      const data = JSON.parse(textData);
      const html = data.content;
      logParams.success = true;
      logParams.html = html;
      logParams.response_code = data.pageStatusCode;
      logParams.error_message = data.pageError;
      return {
        content: html ?? "",
        pageStatusCode: data.pageStatusCode,
        pageError: data.pageError,
        screenshot: data.screenshot,
      };
    } catch (jsonError) {
      logParams.error_message = jsonError.message || jsonError;
      Logger.debug(
        `⛏️ Playwright: Error parsing JSON response for url: ${url} | Error: ${jsonError}`
      );
      return {
        content: "",
        pageStatusCode: null,
        pageError: logParams.error_message,
        screenshot: undefined,
      };
    }
  } catch (error) {
    if (error.code === "ECONNABORTED") {
      logParams.error_message = "Request timed out";
      Logger.debug(`⛏️ Playwright: Request timed out for ${url}`);
    } else {
      logParams.error_message = error.message || error;
      Logger.debug(
        `⛏️ Playwright: Failed to fetch url: ${url} | Error: ${error}`
      );
    }
    return {
      content: "",
      pageStatusCode: null,
      pageError: logParams.error_message,
      screenshot: undefined,
    };
  } finally {
    const endTime = Date.now();
    logParams.time_taken_seconds = (endTime - logParams.startTime) / 1000;
  }
}
