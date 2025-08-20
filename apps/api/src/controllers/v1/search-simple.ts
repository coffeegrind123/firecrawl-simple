import { Response } from "express";
import { RequestWithAuth } from "./types";

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
 * Simple search endpoint that firesearch can call
 * This is just a placeholder that returns mock data for now
 * In production, this would call actual search APIs
 */
export async function simpleSearchController(
  req: RequestWithAuth<{}, SimpleSearchResponse, SimpleSearchRequest>,
  res: Response<SimpleSearchResponse>
) {
  try {
    const { query, maxResults = 5 } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        query: query || '',
        results: []
      });
    }

    // For now, return mock results
    // TODO: Implement actual search API calls (DuckDuckGo, Google, etc.)
    const mockResults = [
      {
        title: "Sample Result 1",
        href: "https://example.com/1",
        body: "Sample content for the search query",
        snippet: "Sample snippet..."
      },
      {
        title: "Sample Result 2", 
        href: "https://example.com/2",
        body: "More sample content",
        snippet: "Another snippet..."
      }
    ].slice(0, maxResults);

    return res.status(200).json({
      success: true,
      query,
      results: mockResults
    });

  } catch (error) {
    console.error("Simple search error:", error);
    
    return res.status(500).json({
      success: false,
      query: req.body?.query || '',
      results: []
    });
  }
}