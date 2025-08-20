import { Response } from "express";
import { RequestWithAuth } from "./types";
import axios from "axios";

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

    // Parse the HTML response to extract search results
    const results = parseSearchResults(searchResponse.data, maxResults);
    
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
 * Parse DuckDuckGo HTML response to extract search results
 */
function parseSearchResults(html: string, maxResults: number) {
  const results: Array<{
    title: string;
    href: string;
    body: string;
    snippet: string;
  }> = [];

  try {
    // Simple regex-based parsing of DuckDuckGo results
    // Look for result links and snippets
    const resultPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetPattern = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)<\/a>/gi;
    
    let match;
    let index = 0;
    
    // Extract links and titles
    while ((match = resultPattern.exec(html)) !== null && index < maxResults) {
      const href = match[1].startsWith('/') ? `https://duckduckgo.com${match[1]}` : match[1];
      const title = match[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      
      // Find corresponding snippet
      let snippet = '';
      const snippetMatch = snippetPattern.exec(html);
      if (snippetMatch) {
        snippet = snippetMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      }
      
      results.push({
        title,
        href,
        body: snippet,
        snippet
      });
      
      index++;
    }
  } catch (error) {
    console.error("Error parsing search results:", error);
  }

  return results;
}