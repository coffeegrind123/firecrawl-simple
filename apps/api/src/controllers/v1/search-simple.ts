import { Response } from "express";
import { RequestWithAuth } from "./types";
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
 * Simple search endpoint using firecrawl-simple's normal scraping approach
 * Scrapes DuckDuckGo search results using the same method as any other website
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

    // Build DuckDuckGo search URL with query parameters
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    // Use firecrawl-simple's normal scraping approach to get search results
    const pageOptions: PageOptions = {
      includeMarkdown: true,
      includeRawHtml: false,
      includeExtract: false,
      waitFor: 2000, // Wait for page to load
      screenshot: false,
      fullPageScreenshot: false
    };

    // Scrape the DuckDuckGo search page using firecrawl-simple's standard approach
    const document = await scrapeSingleUrl(searchUrl, pageOptions);
    
    console.log(`[Search] Scraped DuckDuckGo page, content length: ${document.markdown?.length || 0}`);

    // Extract search results from the scraped content
    const results = extractSearchResults(document.markdown || "", maxResults);
    
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
 * Extract search results from DuckDuckGo markdown content
 * Parses the cleaned markdown that firecrawl-simple generated from the search page
 */
function extractSearchResults(markdown: string, maxResults: number) {
  const results: Array<{
    title: string;
    href: string;
    body: string;
    snippet: string;
  }> = [];

  try {
    const lines = markdown.split('\n');
    let currentResult: any = null;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Look for result titles (markdown links)
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
      // Look for snippet text (content lines)
      else if (trimmedLine && !trimmedLine.startsWith('[') && !trimmedLine.startsWith('#') && currentResult) {
        if (!currentResult.snippet && trimmedLine.length > 10) {
          currentResult.snippet = trimmedLine;
          currentResult.body = trimmedLine;
        }
      }
    }
    
    // Add the last result
    if (currentResult && currentResult.title && currentResult.href && results.length < maxResults) {
      results.push(currentResult);
    }
    
    console.log(`[Search Parser] Extracted ${results.length} search results from markdown`);
  } catch (error) {
    console.error("Error extracting search results:", error);
  }

  return results;
}