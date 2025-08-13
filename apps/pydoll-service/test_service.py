#!/usr/bin/env python3
"""
Simple test script for the pydoll service.
"""

import asyncio
import json
import aiohttp


async def test_pydoll_service():
    """Test the pydoll service endpoint."""
    test_url = "http://localhost:3003/scrape"
    
    payload = {
        "url": "https://example.com",
        "wait_after_load": 1000,
        "timeout": 30000
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                test_url,
                json=payload,
                headers={"Content-Type": "application/json"}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    print("✅ Test successful!")
                    print(f"Content length: {len(data.get('content', ''))}")
                    print(f"Status code: {data.get('pageStatusCode')}")
                    print(f"Error: {data.get('pageError')}")
                else:
                    print(f"❌ Test failed with status {response.status}")
                    text = await response.text()
                    print(f"Response: {text}")
                    
    except Exception as e:
        print(f"❌ Test failed with exception: {e}")


async def test_health_endpoint():
    """Test the health endpoint."""
    test_url = "http://localhost:3003/health"
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(test_url) as response:
                if response.status == 200:
                    data = await response.json()
                    print("✅ Health check successful!")
                    print(f"Response: {data}")
                else:
                    print(f"❌ Health check failed with status {response.status}")
                    
    except Exception as e:
        print(f"❌ Health check failed with exception: {e}")


async def main():
    print("Testing pydoll service...")
    await test_health_endpoint()
    await test_pydoll_service()


if __name__ == "__main__":
    asyncio.run(main())