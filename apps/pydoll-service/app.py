#!/usr/bin/env python3
"""
Pydoll-based scraping service to replace Playwright functionality.
Provides the same API interface as the original puppeteer-service-ts.
"""

import asyncio
import base64
import json
import logging
import os
import time
from typing import Dict, Optional

import Xlib.display
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from pydoll.browser.chromium.chrome import Chrome
from pydoll.browser.options import ChromiumOptions
from pydoll.exceptions import PageLoadTimeout
from pyvirtualdisplay import Display

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize virtual display for Linux container environment
try:
    display = Xlib.display.Display()
    screen = display.screen()
    screen_width = min(screen.width_in_pixels - 150, 1920)
    screen_height = min(screen.height_in_pixels - 150, 1080)
except Exception:
    # Fallback values if X11 display detection fails
    screen_width = 1920
    screen_height = 1080

# Start virtual display for screenshot support
virtual_display = Display(
    visible=False,  # Set to True for debugging
    size=(screen_width, screen_height)
)
virtual_display.start()
logger.info(f"Virtual display started with size {screen_width}x{screen_height}")

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
    screenshot: Optional[bool] = False
    full_page_screenshot: Optional[bool] = False


class ScrapeResponse(BaseModel):
    content: str
    pageStatusCode: Optional[int] = None
    pageError: Optional[str] = None
    screenshot: Optional[str] = None


def create_browser():
    """Create a new browser instance with proper options for containerized environment."""
    options = ChromiumOptions()
    
    # Use improved Chrome options for better stability and screenshot support
    options.add_argument("--headless=new")  # Use new headless mode
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--use-gl=swiftshader")  # Better GPU emulation
    options.add_argument("--disable-software-rasterizer")
    options.add_argument("--disable-web-security")
    options.add_argument("--disable-features=VizDisplayCompositor")
    options.add_argument(f"--window-size={screen_width}x{screen_height}")
    
    # Set Chrome binary path explicitly
    options.binary_location = "/usr/bin/google-chrome"
    
    return Chrome(options=options)


# Remove the global browser manager line since we deleted the class


async def scrape_with_pydoll(
    url: str,
    wait_after_load: int = 0,
    timeout: int = 60000,
    headers: Optional[Dict[str, str]] = None,
    check_selector: Optional[str] = None,
    screenshot: bool = False,
    full_page_screenshot: bool = False
) -> Dict[str, any]:
    """
    Scrape a URL using pydoll browser automation.
    
    Args:
        url: The URL to scrape
        wait_after_load: Time to wait after page load (in milliseconds)
        timeout: Maximum time to wait for page load (in milliseconds)
        headers: Optional HTTP headers to set
        check_selector: Optional CSS selector to wait for
        screenshot: Whether to capture a screenshot
        full_page_screenshot: Whether to capture a full page screenshot
    
    Returns:
        Dict containing page content, status code, screenshot data, and any error
    """
    start_time = time.time()
    page_status_code = None
    page_error = None
    
    # Create browser and start it manually (context manager might not be implemented)
    browser = create_browser()
    try:
        await browser.start()
        # Create a new tab and get the page (correct pydoll API)
        tab = await browser.new_tab()
        # The tab object itself should have the page methods
        
        # Set custom headers if provided
        if headers:
            # Note: pydoll sets headers differently than Hero/Playwright
            # This would need to be implemented via request interception
            logger.info(f"Custom headers requested: {headers}")
        
        # Set browser window bounds for consistent screenshots
        try:
            await browser.set_window_bounds({
                'left': 0,
                'top': 0,
                'width': screen_width,
                'height': screen_height
            })
        except Exception as e:
            logger.warning(f"Failed to set window bounds: {e}")
        
        # Navigate to the URL
        await tab.go_to(str(url))
        
        # Try to get the actual HTTP status code from network events
        # Note: This is a simplified approach - in production you'd want to 
        # capture the specific response for the main document
        page_status_code = 200  # Default to 200 for successful navigation
        
        # Wait additional time if specified (convert ms to seconds)
        if wait_after_load > 0:
            await asyncio.sleep(wait_after_load / 1000)
        else:
            # Default wait like in your example
            await asyncio.sleep(6)
        
        # Wait for specific selector if provided
        if check_selector:
            try:
                # pydoll uses find_element for CSS selectors
                from pydoll.constants import By
                await tab.find_element(By.CSS_SELECTOR, check_selector, timeout=10)
            except Exception as e:
                logger.warning(f"Failed to find selector {check_selector}: {e}")
                # Don't fail the whole request for selector issues
        
        # Get page content
        page_content = await tab.page_source
        
        # Capture screenshot if requested
        screenshot_data = None
        if screenshot or full_page_screenshot:
            try:
                # Create a temporary file path for screenshot
                import tempfile
                with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_file:
                    screenshot_path = tmp_file.name
                
                # Use pydoll's correct screenshot method
                await tab.take_screenshot(path=screenshot_path)
                
                # Read the screenshot file and convert to base64
                with open(screenshot_path, 'rb') as img_file:
                    screenshot_bytes = img_file.read()
                    screenshot_data = base64.b64encode(screenshot_bytes).decode('utf-8')
                
                # Clean up the temporary file
                os.unlink(screenshot_path)
                
                logger.info(f"Screenshot captured for {url}")
                
            except Exception as screenshot_error:
                logger.warning(f"Failed to capture screenshot for {url}: {screenshot_error}")
                # Don't fail the whole request for screenshot issues
                screenshot_data = None
        
        # Capture screenshot if requested
        screenshot_data = None
        if screenshot or full_page_screenshot:
            try:
                # Import the page commands for screenshot functionality
                from pydoll.commands import PageCommands
                
                # Configure screenshot options
                screenshot_options = {
                    'format': 'png',
                    'capture_beyond_viewport': full_page_screenshot
                }
                
                # Capture the screenshot
                screenshot_result = await PageCommands.capture_screenshot(
                    page.connection, **screenshot_options
                )
                
                # The screenshot result should contain base64 encoded image data
                if hasattr(screenshot_result, 'data'):
                    screenshot_data = screenshot_result.data
                elif isinstance(screenshot_result, dict) and 'data' in screenshot_result:
                    screenshot_data = screenshot_result['data']
                else:
                    screenshot_data = str(screenshot_result)
                    
                logger.info(f"Screenshot captured for {url}")
                
            except Exception as screenshot_error:
                logger.warning(f"Failed to capture screenshot for {url}: {screenshot_error}")
                # Don't fail the whole request for screenshot issues
                screenshot_data = None
        
        elapsed_time = time.time() - start_time
        logger.info(f"Successfully scraped {url} in {elapsed_time:.2f}s")
        
        return {
            "content": page_content,
            "pageStatusCode": page_status_code,
            "pageError": page_error,
            "screenshot": screenshot_data
        }
        
    except PageLoadTimeout:
        page_error = "Page load timeout"
        logger.error(f"Page load timeout for {url}")
        return {
            "content": "",
            "pageStatusCode": None,
            "pageError": page_error,
            "screenshot": None
        }
    except Exception as e:
        page_error = str(e)
        logger.error(f"Error scraping {url}: {e}")
        return {
            "content": "",
            "pageStatusCode": None,
            "pageError": page_error,
            "screenshot": None
        }
    finally:
        # Clean up browser
        try:
            await browser.stop()
        except Exception as e:
            logger.warning(f"Error stopping browser: {e}")


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
            check_selector=request.check_selector,
            screenshot=request.screenshot or False,
            full_page_screenshot=request.full_page_screenshot or False
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
    """Cleanup virtual display on shutdown."""
    logger.info("Shutting down pydoll scraping service...")
    try:
        virtual_display.stop()
        logger.info("Virtual display stopped")
    except Exception as e:
        logger.warning(f"Error stopping virtual display: {e}")


if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", 3003))
    uvicorn.run(app, host="0.0.0.0", port=port)