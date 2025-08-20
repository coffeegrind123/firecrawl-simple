import axios, { AxiosResponse } from "axios";
import * as cheerio from "cheerio";

export interface SearchResult {
  title: string;
  href: string;
  body: string;
  snippet: string;
}

export interface SearchEngineOptions {
  proxy?: string;
  timeout?: number;
  userAgent?: string;
}

abstract class BaseSearchEngine {
  protected options: SearchEngineOptions;
  
  constructor(options: SearchEngineOptions = {}) {
    this.options = {
      timeout: 10000,
      userAgent: this.getRandomUserAgent(),
      ...options
    };
  }

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  abstract buildPayload(
    query: string,
    region: string,
    safesearch: string,
    timelimit?: string,
    page?: number
  ): Record<string, any>;

  abstract extractResults(html: string): SearchResult[];

  async search(
    query: string,
    region: string = "us-en",
    safesearch: string = "moderate",
    timelimit?: string,
    page: number = 1,
    maxResults: number = 10
  ): Promise<SearchResult[]> {
    try {
      const payload = this.buildPayload(query, region, safesearch, timelimit, page);
      const response = await this.makeRequest(payload);
      
      if (!response || response.status !== 200) {
        return [];
      }

      const results = this.extractResults(response.data);
      return results.slice(0, maxResults);
    } catch (error) {
      console.error(`Search engine error:`, error);
      return [];
    }
  }

  protected abstract makeRequest(payload: Record<string, any>): Promise<AxiosResponse>;
}

export class BraveSearchEngine extends BaseSearchEngine {
  private readonly searchUrl = "https://search.brave.com/search";

  buildPayload(
    query: string,
    region: string,
    safesearch: string,
    timelimit?: string,
    page: number = 1
  ): Record<string, any> {
    const payload: Record<string, any> = {
      q: query,
      source: "web"
    };

    if (timelimit) {
      const timeMap: Record<string, string> = {
        d: "pd",
        w: "pw", 
        m: "pm",
        y: "py"
      };
      payload.tf = timeMap[timelimit];
    }

    if (page > 1) {
      payload.offset = (page - 1).toString();
    }

    return payload;
  }

  protected async makeRequest(payload: Record<string, any>): Promise<AxiosResponse> {
    return axios.get(this.searchUrl, {
      params: payload,
      headers: {
        'User-Agent': this.options.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: this.options.timeout
    });
  }

  extractResults(html: string): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('div[data-type="web"]').each((_, element) => {
      const $element = $(element);
      
      const titleElement = $element.find('div:contains("title"), div:contains("sitename-container")').last();
      const title = titleElement.text().trim();
      
      const href = $element.find('a').first().attr('href') || '';
      
      const bodyElement = $element.find('div:contains("description")');
      const body = bodyElement.text().trim();
      
      if (title && href) {
        results.push({
          title,
          href,
          body,
          snippet: body.substring(0, 200)
        });
      }
    });

    return results;
  }
}

export class DuckDuckGoSearchEngine extends BaseSearchEngine {
  private readonly searchUrl = "https://html.duckduckgo.com/html/";

  buildPayload(
    query: string,
    region: string,
    safesearch: string,
    timelimit?: string,
    page: number = 1
  ): Record<string, any> {
    const payload: Record<string, any> = {
      q: query,
      b: "",
      l: region
    };

    if (page > 1) {
      payload.s = (10 + (page - 2) * 15).toString();
    }

    if (timelimit) {
      payload.df = timelimit;
    }

    return payload;
  }

  protected async makeRequest(payload: Record<string, any>): Promise<AxiosResponse> {
    return axios.post(this.searchUrl, payload, {
      headers: {
        'User-Agent': this.options.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: this.options.timeout
    });
  }

  extractResults(html: string): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('div.body').each((_, element) => {
      const $element = $(element);
      
      const title = $element.find('h2').text().trim();
      const href = $element.find('a').first().attr('href') || '';
      const body = $element.find('a').text().trim();
      
      if (title && href) {
        results.push({
          title,
          href,
          body,
          snippet: body.substring(0, 200)
        });
      }
    });

    return results;
  }
}

export class SearchEngineManager {
  private engines: BaseSearchEngine[];

  constructor(options: SearchEngineOptions = {}) {
    this.engines = [
      // Only use DuckDuckGo as requested
      new DuckDuckGoSearchEngine(options),
    ];
  }

  async search(
    query: string,
    region: string = "us-en",
    safesearch: string = "moderate",
    timelimit?: string,
    page: number = 1,
    maxResults: number = 10
  ): Promise<SearchResult[]> {
    // Try each engine in order until we get results
    for (const engine of this.engines) {
      try {
        const results = await engine.search(query, region, safesearch, timelimit, page, maxResults);
        if (results.length > 0) {
          return results;
        }
      } catch (error) {
        console.error(`Engine failed:`, error);
        continue; // Try next engine
      }
    }
    
    return []; // No engines returned results
  }

  async searchMultipleEngines(
    query: string,
    region: string = "us-en", 
    safesearch: string = "moderate",
    timelimit?: string,
    page: number = 1,
    maxResults: number = 10
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    const seenUrls = new Set<string>();

    // Search all engines in parallel
    const promises = this.engines.map(engine => 
      engine.search(query, region, safesearch, timelimit, page, maxResults)
        .catch(error => {
          console.error(`Engine failed:`, error);
          return [];
        })
    );

    const results = await Promise.all(promises);
    
    // Combine and deduplicate results
    for (const engineResults of results) {
      for (const result of engineResults) {
        if (!seenUrls.has(result.href)) {
          seenUrls.add(result.href);
          allResults.push(result);
        }
      }
    }

    return allResults.slice(0, maxResults);
  }
}