import { SearchEngineManager, SearchResult } from "./search-engines";
import { addScrapeJobRaw, waitForJob } from "../services/queue-jobs";
import { legacyScrapeOptions, legacyDocumentConverter, Document } from "../controllers/v1/types";

export interface SearchQuery {
  query: string;
  intent: string;
  confidence: number;
}

export interface SearchSource {
  url: string;
  title: string;
  snippet: string;
  content?: string;
  relevance: number;
}

export interface AnswerValidation {
  question: string;
  isAnswered: boolean;
  confidence: number;
  sources: string[];
}

export interface SearchResponse {
  success: boolean;
  query: string;
  sources: SearchSource[];
  answers: AnswerValidation[];
  followUpQuestions?: string[];
  synthesizedResponse?: string;
  citations: string[];
}

export class SearchOrchestrator {
  private searchManager: SearchEngineManager;
  private readonly MAX_SEARCH_QUERIES = 12;
  private readonly MAX_SOURCES_PER_SEARCH = 4;
  private readonly MAX_SOURCES_TO_SCRAPE = 3;
  private readonly MIN_ANSWER_CONFIDENCE = 0.7;
  private readonly MAX_SEARCH_ATTEMPTS = 2;

  constructor() {
    this.searchManager = new SearchEngineManager();
  }

  async search(
    originalQuery: string,
    options: {
      maxQueries?: number;
      maxSources?: number;
      teamId: string;
      region?: string;
      safesearch?: string;
    }
  ): Promise<SearchResponse> {
    const { teamId, region = "us-en", safesearch = "moderate" } = options;
    
    try {
      // Step 1: Break down query into sub-questions
      const searchQueries = await this.decomposeQuery(originalQuery);
      
      // Step 2: Perform searches for each sub-question
      const allSources: SearchSource[] = [];
      const searchPromises = searchQueries.slice(0, this.MAX_SEARCH_QUERIES).map(async (searchQuery) => {
        const results = await this.searchManager.search(
          searchQuery.query,
          region,
          safesearch,
          undefined, // timelimit
          1, // page
          this.MAX_SOURCES_PER_SEARCH
        );
        
        return results.map(result => ({
          url: result.href,
          title: result.title,
          snippet: result.snippet,
          relevance: searchQuery.confidence
        }));
      });

      const searchResults = await Promise.all(searchPromises);
      allSources.push(...searchResults.flat());

      // Step 3: Remove duplicates and rank sources
      const uniqueSources = this.deduplicateAndRankSources(allSources);
      
      // Step 4: Scrape content from top sources
      const sourcesWithContent = await this.scrapeTopSources(
        uniqueSources.slice(0, this.MAX_SOURCES_TO_SCRAPE),
        teamId
      );

      // Step 5: Validate if questions are answered
      const answerValidations = await this.validateAnswers(searchQueries, sourcesWithContent);
      
      // Step 6: Check for retry needed
      const unansweredQuestions = answerValidations.filter(v => !v.isAnswered || v.confidence < this.MIN_ANSWER_CONFIDENCE);
      
      if (unansweredQuestions.length > 0) {
        // Step 7: Generate alternative search terms and retry
        const retryResults = await this.retryWithAlternativeTerms(unansweredQuestions, teamId, region, safesearch);
        sourcesWithContent.push(...retryResults);
      }

      // Step 8: Generate synthesized response
      const synthesizedResponse = await this.synthesizeResponse(originalQuery, sourcesWithContent);
      
      // Step 9: Generate follow-up questions
      const followUpQuestions = await this.generateFollowUpQuestions(originalQuery, sourcesWithContent);

      return {
        success: true,
        query: originalQuery,
        sources: sourcesWithContent,
        answers: answerValidations,
        followUpQuestions,
        synthesizedResponse,
        citations: this.generateCitations(sourcesWithContent)
      };

    } catch (error) {
      console.error("Search orchestration error:", error);
      return {
        success: false,
        query: originalQuery,
        sources: [],
        answers: [],
        citations: []
      };
    }
  }

  private async decomposeQuery(query: string): Promise<SearchQuery[]> {
    // Simple query decomposition - in a real implementation, this would use an LLM
    const commonPatterns = [
      { pattern: /compare (.*) and (.*)/, transform: (match: RegExpMatchArray) => [
        `${match[1]} specs features`,
        `${match[2]} specs features`, 
        `${match[1]} vs ${match[2]} comparison`
      ]},
      { pattern: /what is (.*)/, transform: (match: RegExpMatchArray) => [
        `${match[1]} definition explanation`,
        `${match[1]} overview guide`
      ]},
      { pattern: /how to (.*)/, transform: (match: RegExpMatchArray) => [
        `how to ${match[1]} tutorial`,
        `${match[1]} step by step guide`
      ]}
    ];

    for (const { pattern, transform } of commonPatterns) {
      const match = query.match(pattern);
      if (match) {
        const queries = transform(match);
        return queries.map((q, index) => ({
          query: q,
          intent: `sub_question_${index + 1}`,
          confidence: 0.8 - (index * 0.1)
        }));
      }
    }

    // Fallback: Use original query with related searches
    return [
      { query: query, intent: "primary", confidence: 1.0 },
      { query: `${query} guide`, intent: "guide", confidence: 0.7 },
      { query: `${query} explanation`, intent: "explanation", confidence: 0.6 }
    ];
  }

  private deduplicateAndRankSources(sources: SearchSource[]): SearchSource[] {
    const uniqueUrlsMap = new Map<string, SearchSource>();
    
    for (const source of sources) {
      const existing = uniqueUrlsMap.get(source.url);
      if (!existing || source.relevance > existing.relevance) {
        uniqueUrlsMap.set(source.url, source);
      }
    }

    return Array.from(uniqueUrlsMap.values())
      .sort((a, b) => b.relevance - a.relevance);
  }

  private async scrapeTopSources(sources: SearchSource[], teamId: string): Promise<SearchSource[]> {
    const scrapePromises = sources.map(async (source) => {
      try {
        const pageOptions = legacyScrapeOptions({
          formats: ["markdown"],
          includeTags: undefined,
          excludeTags: undefined,
          timeout: 30000,
          waitFor: 0,
          headers: undefined
        });

        const job = await addScrapeJobRaw(
          {
            url: source.url,
            mode: "single_urls",
            crawlerOptions: {},
            team_id: teamId,
            pageOptions,
            origin: "search_api",
            is_scrape: true,
          },
          {},
          `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          10 // priority
        );

        const docs = await waitForJob(job.id, 30000);
        await job.remove();

        if (docs && docs.length > 0) {
          const doc = legacyDocumentConverter(docs[0]);
          return {
            ...source,
            content: doc.markdown || doc.rawHtml || ""
          };
        }
      } catch (error) {
        console.error(`Failed to scrape ${source.url}:`, error);
      }

      return source; // Return without content if scraping fails
    });

    return Promise.all(scrapePromises);
  }

  private async validateAnswers(queries: SearchQuery[], sources: SearchSource[]): Promise<AnswerValidation[]> {
    return queries.map(query => {
      // Simple validation - check if any source content contains relevant keywords
      const relevantSources = sources.filter(source => {
        if (!source.content) return false;
        
        const queryWords = query.query.toLowerCase().split(' ');
        const content = source.content.toLowerCase();
        
        const matchingWords = queryWords.filter(word => 
          word.length > 3 && content.includes(word)
        );
        
        return matchingWords.length >= Math.ceil(queryWords.length * 0.5);
      });

      const confidence = relevantSources.length > 0 ? 
        Math.min(0.9, 0.5 + (relevantSources.length * 0.2)) : 0.1;

      return {
        question: query.query,
        isAnswered: confidence >= this.MIN_ANSWER_CONFIDENCE,
        confidence,
        sources: relevantSources.map(s => s.url)
      };
    });
  }

  private async retryWithAlternativeTerms(
    unansweredQuestions: AnswerValidation[],
    teamId: string,
    region: string,
    safesearch: string
  ): Promise<SearchSource[]> {
    const retryResults: SearchSource[] = [];
    
    for (const validation of unansweredQuestions.slice(0, 3)) { // Limit retries
      const alternativeQueries = this.generateAlternativeQueries(validation.question);
      
      for (const altQuery of alternativeQueries) {
        const results = await this.searchManager.search(altQuery, region, safesearch, undefined, 1, 2);
        
        const sources = results.map(result => ({
          url: result.href,
          title: result.title,
          snippet: result.snippet,
          relevance: 0.6 // Lower relevance for retry results
        }));

        const scrapedSources = await this.scrapeTopSources(sources, teamId);
        retryResults.push(...scrapedSources);
        
        if (retryResults.length >= 5) break; // Limit retry results
      }
    }

    return retryResults;
  }

  private generateAlternativeQueries(originalQuery: string): string[] {
    const alternatives = [
      `${originalQuery} MSRP cost`,
      `${originalQuery} pricing leak`,
      `${originalQuery} vs comparison`,
      `${originalQuery} review analysis`,
      `${originalQuery} specifications details`
    ];

    return alternatives.slice(0, 2); // Limit to 2 alternatives per query
  }

  private async synthesizeResponse(query: string, sources: SearchSource[]): Promise<string> {
    // Simple synthesis - in a real implementation, this would use an LLM
    const contentSections = sources
      .filter(s => s.content)
      .slice(0, 5)
      .map((source, index) => `[${index + 1}] ${source.title}: ${source.content?.substring(0, 300)}...`);

    return `Based on the search results for "${query}":\n\n${contentSections.join('\n\n')}`;
  }

  private async generateFollowUpQuestions(query: string, sources: SearchSource[]): Promise<string[]> {
    // Simple follow-up generation
    const followUps = [
      `What are the latest updates about ${query}?`,
      `How does ${query} compare to alternatives?`,
      `What are the pros and cons of ${query}?`
    ];

    return followUps.slice(0, 2);
  }

  private generateCitations(sources: SearchSource[]): string[] {
    return sources
      .filter(s => s.content)
      .map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`);
  }
}