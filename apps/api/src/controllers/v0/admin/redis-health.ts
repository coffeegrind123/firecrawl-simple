import { Request, Response } from "express";
import Redis from "ioredis";
import { Logger } from "../../../lib/logger";
import { redisRateLimitClient } from "../../../services/rate-limiter";

export async function redisHealthController(req: Request, res: Response) {
  const retryOperation = async (operation: () => Promise<any>, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === retries) throw error;
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.warn(`Attempt ${attempt} failed: ${errorMessage}. Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before retrying
      }
    }
  };

  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not defined');
    }
    const queueRedis = new Redis(redisUrl);

    const testKey = "test";
    const testValue = "test";

    // Test queueRedis
    let queueRedisHealth;
    try {
      await retryOperation(() => queueRedis.set(testKey, testValue));
      queueRedisHealth = await retryOperation(() => queueRedis.get(testKey));
      await retryOperation(() => queueRedis.del(testKey));
    } catch (error) {
      Logger.error(`queueRedis health check failed: ${error}`);
      queueRedisHealth = null;
    }

    // Test redisRateLimitClient
    let redisRateLimitHealth;
    try {
      await retryOperation(() => redisRateLimitClient.set(testKey, testValue));
      redisRateLimitHealth = await retryOperation(() =>
        redisRateLimitClient.get(testKey)
      );
      await retryOperation(() => redisRateLimitClient.del(testKey));
    } catch (error) {
      Logger.error(`redisRateLimitClient health check failed: ${error}`);
      redisRateLimitHealth = null;
    }

    const healthStatus = {
      queueRedis: queueRedisHealth === testValue ? "healthy" : "unhealthy",
      redisRateLimitClient:
        redisRateLimitHealth === testValue ? "healthy" : "unhealthy",
    };

    if (
      healthStatus.queueRedis === "healthy" &&
      healthStatus.redisRateLimitClient === "healthy"
    ) {
      Logger.info("Both Redis instances are healthy");
      return res.status(200).json({ status: "healthy", details: healthStatus });
    } else {
      Logger.info(
        `Redis instances health check: ${JSON.stringify(healthStatus)}`
      );
      return res
        .status(500)
        .json({ status: "unhealthy", details: healthStatus });
    }
  } catch (error) {
    Logger.error(`Redis health check failed: ${error}`);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res
      .status(500)
      .json({ status: "unhealthy", message: errorMessage });
  }
}
