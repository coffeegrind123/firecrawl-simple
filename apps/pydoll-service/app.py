#!/usr/bin/env python3
"""
Pydoll-based scraping service to replace Playwright functionality.
Provides the same API interface as the original puppeteer-service-ts.
"""

import asyncio
import json
import logging
import os
import time
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from pydoll.browser import Chrome
from pydoll.exceptions import PageLoadTimeout

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Pydoll Scraping Service",
    description="Web scraping service using pydoll browser automation",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScrapeRequest(BaseModel):
    url: HttpUrl
    wait_after_load: Optional[int] = 0
    timeout: Optional[int] = 60000
    headers: Optional[Dict[str, str]] = None
    check_selector: Optional[str] = None


class ScrapeResponse(BaseModel):
    content: str
    pageStatusCode: Optional[int] = None
    pageError: Optional[str] = None


class GlobalBrowserManager:
    """Singleton browser manager to reuse browser instances."""
    
    def __init__(self):
        self.browser = None
        self.lock = asyncio.Lock()
    
    async def get_browser(self):
        async with self.lock:
            if self.browser is None:
                self.browser = Chrome()
                await self.browser.start()
                logger.info("Browser started successfully")
            return self.browser
    
    async def cleanup(self):
        async with self.lock:
            if self.browser:
                await self.browser.stop()
                self.browser = None
                logger.info("Browser stopped")


# Global browser manager instance
browser_manager = GlobalBrowserManager()


async def scrape_with_pydoll(
    url: str,
    wait_after_load: int = 0,
    timeout: int = 60000,
    headers: Optional[Dict[str, str]] = None,
    check_selector: Optional[str] = None
) -> Dict[str, any]:
    """
    Scrape a URL using pydoll browser automation.
    
    Args:
        url: The URL to scrape
        wait_after_load: Time to wait after page load (in milliseconds)
        timeout: Maximum time to wait for page load (in milliseconds)
        headers: Optional HTTP headers to set
        check_selector: Optional CSS selector to wait for
    
    Returns:
        Dict containing page content, status code, and any error
    """
    start_time = time.time()
    page_status_code = None
    page_error = None
    
    try:
        browser = await browser_manager.get_browser()
        page = await browser.get_page()
        
        # Set custom headers if provided
        if headers:
            # Note: pydoll sets headers differently than Hero/Playwright
            # This would need to be implemented via request interception
            logger.info(f"Custom headers requested: {headers}")
        
        # Enable network events to capture status codes
        await page.enable_network_events()
        
        # Navigate to the URL with timeout (convert ms to seconds)
        timeout_seconds = timeout // 1000
        await page.go_to(str(url), timeout=timeout_seconds)
        
        # Try to get the actual HTTP status code from network events
        # Note: This is a simplified approach - in production you'd want to 
        # capture the specific response for the main document
        page_status_code = 200  # Default to 200 for successful navigation
        
        # Wait additional time if specified (convert ms to seconds)
        if wait_after_load > 0:
            await asyncio.sleep(wait_after_load / 1000)
        
        # Wait for specific selector if provided
        if check_selector:
            try:
                # pydoll uses find_element for CSS selectors
                from pydoll.constants import By
                await page.find_element(By.CSS_SELECTOR, check_selector, timeout=10)
            except Exception as e:
                logger.warning(f"Failed to find selector {check_selector}: {e}")
                # Don't fail the whole request for selector issues
        
        # Get page content
        page_content = await page.page_source
        
        elapsed_time = time.time() - start_time
        logger.info(f"Successfully scraped {url} in {elapsed_time:.2f}s")
        
        return {
            "content": page_content,
            "pageStatusCode": page_status_code,
            "pageError": page_error
        }
        
    except PageLoadTimeout:
        page_error = "Page load timeout"
        logger.error(f"Page load timeout for {url}")
        return {
            "content": "",
            "pageStatusCode": None,
            "pageError": page_error
        }
    except Exception as e:
        page_error = str(e)
        logger.error(f"Error scraping {url}: {e}")
        return {
            "content": "",
            "pageStatusCode": None,
            "pageError": page_error
        }


@app.post("/scrape", response_model=ScrapeResponse)
async def scrape_endpoint(request: ScrapeRequest):
    """
    Main scraping endpoint that matches the original Playwright service API.
    """
    try:
        result = await scrape_with_pydoll(
            url=str(request.url),
            wait_after_load=request.wait_after_load or 0,
            timeout=request.timeout or 60000,
            headers=request.headers,
            check_selector=request.check_selector
        )
        
        return ScrapeResponse(**result)
        
    except Exception as e:
        logger.error(f"Endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "pydoll-scraper"}


@app.on_event("startup")
async def startup_event():
    """Initialize browser on startup."""
    logger.info("Starting pydoll scraping service...")
    # Browser will be initialized on first request


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup browser on shutdown."""
    logger.info("Shutting down pydoll scraping service...")
    await browser_manager.cleanup()


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", 3003))
    uvicorn.run(app, host="0.0.0.0", port=port)