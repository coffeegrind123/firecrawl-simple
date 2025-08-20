#!/usr/bin/env python3
"""
Test script to verify screenshot functionality in the pydoll service.
"""

import asyncio
import json
import requests
import base64
import os

async def test_pydoll_service_screenshot():
    """Test the pydoll service screenshot functionality directly."""
    
    # Test URL
    test_url = "https://example.com"
    
    # Service endpoint
    endpoint = "http://localhost:3003/scrape"
    
    # Test data with screenshot enabled
    test_data = {
        "url": test_url,
        "wait_after_load": 1000,
        "timeout": 30000,
        "screenshot": True,
        "full_page_screenshot": False
    }
    
    print(f"Testing pydoll service screenshot at {endpoint}")
    print(f"URL: {test_url}")
    print(f"Request data: {json.dumps(test_data, indent=2)}")
    
    try:
        response = requests.post(
            endpoint,
            json=test_data,
            headers={"Content-Type": "application/json"},
            timeout=60
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Request successful!")
            print(f"Content length: {len(result.get('content', ''))}")
            print(f"Page status: {result.get('pageStatusCode')}")
            print(f"Page error: {result.get('pageError')}")
            
            screenshot_data = result.get('screenshot')
            if screenshot_data:
                print(f"✅ Screenshot captured! Length: {len(screenshot_data)}")
                
                # Try to save the screenshot to verify it's valid
                try:
                    # Remove data URL prefix if present
                    if screenshot_data.startswith('data:image'):
                        screenshot_data = screenshot_data.split(',')[1]
                    
                    # Decode base64
                    image_data = base64.b64decode(screenshot_data)
                    
                    # Save to file
                    with open('test_screenshot.png', 'wb') as f:
                        f.write(image_data)
                    
                    print("✅ Screenshot saved as test_screenshot.png")
                    print(f"Screenshot file size: {len(image_data)} bytes")
                    
                except Exception as e:
                    print(f"❌ Error processing screenshot: {e}")
            else:
                print("❌ No screenshot data returned")
                
        else:
            print(f"❌ Request failed with status {response.status_code}")
            print(f"Response: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection failed - is the pydoll service running?")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_pydoll_service_screenshot())