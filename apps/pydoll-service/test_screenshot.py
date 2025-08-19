#!/usr/bin/env python3
"""
Test script for verifying screenshot functionality with virtual display.
"""

import asyncio
import base64
import json
import os
import time
from pathlib import Path

import requests


async def test_screenshot_service():
    """Test the screenshot functionality of the pydoll service."""
    
    # Test data
    test_url = "https://www.google.com"
    service_url = "http://localhost:3003"
    
    print(f"Testing screenshot functionality for: {test_url}")
    print(f"Service URL: {service_url}")
    
    # Check if service is running
    try:
        health_response = requests.get(f"{service_url}/health", timeout=10)
        if health_response.status_code != 200:
            print(f"Service health check failed: {health_response.status_code}")
            return False
        print("✓ Service is running")
    except requests.RequestException as e:
        print(f"✗ Failed to connect to service: {e}")
        return False
    
    # Test screenshot request
    test_data = {
        "url": test_url,
        "screenshot": True,
        "wait_after_load": 3000
    }
    
    try:
        print("Sending screenshot request...")
        start_time = time.time()
        
        response = requests.post(
            f"{service_url}/scrape",
            json=test_data,
            timeout=60
        )
        
        elapsed_time = time.time() - start_time
        print(f"Request completed in {elapsed_time:.2f}s")
        
        if response.status_code != 200:
            print(f"✗ Request failed with status: {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        result = response.json()
        
        # Check if we got content
        if not result.get("content"):
            print("✗ No page content returned")
            return False
        print(f"✓ Page content received ({len(result['content'])} characters)")
        
        # Check if we got a screenshot
        if not result.get("screenshot"):
            print("✗ No screenshot data returned")
            return False
        
        # Decode and save screenshot
        screenshot_data = result["screenshot"]
        try:
            screenshot_bytes = base64.b64decode(screenshot_data)
            
            # Save screenshot to file
            output_dir = Path("/app/screenshots")
            output_dir.mkdir(exist_ok=True)
            
            screenshot_path = output_dir / "test_screenshot.png"
            with open(screenshot_path, "wb") as f:
                f.write(screenshot_bytes)
            
            print(f"✓ Screenshot saved to {screenshot_path} ({len(screenshot_bytes)} bytes)")
            return True
            
        except Exception as e:
            print(f"✗ Failed to decode/save screenshot: {e}")
            return False
            
    except requests.RequestException as e:
        print(f"✗ Request failed: {e}")
        return False


if __name__ == "__main__":
    success = asyncio.run(test_screenshot_service())
    if success:
        print("\n✓ Screenshot test passed!")
        exit(0)
    else:
        print("\n✗ Screenshot test failed!")
        exit(1)