import { Response } from "express";
import { RequestWithAuth } from "./types";
import axios from "axios";
import { scrapeSingleUrl } from "../../scraper/WebScraper/single_url";
import { PageOptions } from "../../lib/entities";

export interface SimpleSearchRequest {
  query: string;
  maxResults?: number;
  scrapeOptions?: {
    formats?: string[];
  };
}

export interface SimpleSearchResponse {
  success: boolean;
  query: string;
  results: Array<{
    title: string;
    href: string;
    body: string;
    snippet: string;
    content?: {
      markdown?: string;
      rawHtml?: string;
    };
  }>;
}

/**
 * Simple search endpoint using DuckDuckGo HTML search
 * Uses the same approach as the curl command - POST to DuckDuckGo then parse HTML
 */
export async function simpleSearchController(
  req: RequestWithAuth<{}, SimpleSearchResponse, SimpleSearchRequest>,
  res: Response<SimpleSearchResponse>
) {
  try {
    const { query, maxResults = 8 } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        query: query || '',
        results: []
      });
    }

    console.log(`[Search] Searching DuckDuckGo for: "${query}"`);

    // Use DuckDuckGo HTML search - same as your curl command
    const searchResponse = await axios.post('https://html.duckduckgo.com/html/', 
      `q=${encodeURIComponent(query)}&b=`, 
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://html.duckduckgo.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://html.duckduckgo.com',
          'Connection': 'keep-alive',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-User': '?1'
        },
        timeout: 10000
      }
    );

    // Use firecrawl-simple's existing scraping infrastructure to parse the search results
    const results = await parseSearchResultsWithFirecrawl(searchResponse.data, maxResults);
    
    console.log(`[Search] Found ${results.length} results for "${query}"`);

    return res.status(200).json({
      success: true,
      query,
      results
    });

  } catch (error) {
    console.error("Search error:", error);
    
    // Fallback to empty results on error
    return res.status(200).json({
      success: true,
      query: req.body?.query || '',
      results: []
    });
  }
}

/**
 * Parse DuckDuckGo HTML response using firecrawl-simple's existing scraping infrastructure
 * This leverages the same parsing, cleaning, and extraction that firecrawl-simple uses for all websites
 */
async function parseSearchResultsWithFirecrawl(html: string, maxResults: number) {
  const results: Array<{
    title: string;
    href: string;
    body: string;
    snippet: string;
  }> = [];

  try {
    // Use firecrawl-simple's scraping with the DuckDuckGo HTML content
    const pageOptions: PageOptions = {
      includeMarkdown: true,
      includeRawHtml: false,
      includeExtract: false,
      waitFor: undefined,
      screenshot: false,
      fullPageScreenshot: false
    };

    // Let firecrawl-simple parse and clean the HTML
    const document = await scrapeSingleUrl(
      "https://html.duckduckgo.com/html/", // Fake URL for context
      pageOptions,
      html // Pass our HTML content directly
    );

    console.log(`[Search Parser] Firecrawl extracted content length: ${document.markdown?.length || 0}`);

    // Now extract search results from the cleaned markdown/content
    // Parse the markdown to find search result patterns
    const markdown = document.markdown || "";
    const lines = markdown.split('\n');
    
    let currentResult: any = null;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Look for result titles (usually links)
      const linkMatch = trimmedLine.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (linkMatch && results.length < maxResults) {
        // Save previous result if exists
        if (currentResult && currentResult.title && currentResult.href) {
          results.push(currentResult);
        }
        
        // Start new result
        currentResult = {
          title: linkMatch[1],
          href: linkMatch[2],
          body: '',
          snippet: ''
        };
      }
      // Look for snippet text (non-link lines with content)
      else if (trimmedLine && !trimmedLine.startsWith('[') && !trimmedLine.startsWith('#') && currentResult) {
        if (!currentResult.snippet) {
          currentResult.snippet = trimmedLine;
          currentResult.body = trimmedLine;
        }
      }
    }
    
    // Add the last result
    if (currentResult && currentResult.title && currentResult.href && results.length < maxResults) {
      results.push(currentResult);
    }
    
    console.log(`[Search Parser] Extracted ${results.length} search results using firecrawl parsing`);
  } catch (error) {
    console.error("Error parsing search results with firecrawl:", error);
  }

  return results;
}