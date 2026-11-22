
import { MongoClient } from "mongodb";
import "dotenv/config";

const DB_NAME = process.env.DB_NAME || "rental-platform";

let client = null;
let db = null;
let connectionPromise = null;

/**
 * Connects to MongoDB using a cached promise so that concurrent requests
 * (e.g. several Vercel invocations on cold start) share a single connection
 * instead of racing each other.
 */
export async function connectToDatabase() {
  if (db) {
    return db;
  }

  if (!connectionPromise) {
    connectionPromise = (async () => {
      try {
        const uri = process.env.DB_URL;

        if (!uri) {
          throw new Error("DB_URL environment variable is missing");
        }

        if (!client) {
          client = new MongoClient(uri);
        }

        await client.connect();

        const connectedDb = client.db(DB_NAME);

        // Verify the connection is actually alive before handing it out
        await connectedDb.command({ ping: 1 });

        db = connectedDb;

        console.log("Successfully connected to MongoDB!");

        return db;
      } catch (error) {
        // Reset the cache so the next request retries the connection
        connectionPromise = null;
        db = null;

        // Discard the failed client so the retry starts completely fresh
        if (client) {
          try {
            await client.close();
          } catch {
            // Ignore cleanup errors — the connection error is reported below
          }
          client = null;
        }

        console.error("MongoDB connection failed:", error);
        throw error;
      }
    })();
  }

  return connectionPromise;
}

export function getDatabase() {
  if (!db) {
    throw new Error(
      "Database is not connected. Call connectToDatabase() first."
    );
  }

  return db;
}

export function getCollection(collectionName) {
  return getDatabase().collection(collectionName);
}

export function isDatabaseConnected() {
  return Boolean(db);
}

/**
 * Probes MongoDB with a ping and fails fast if it does not answer in time,
 * so health checks never hang for the driver's full server-selection timeout.
 */
export async function pingDatabase(timeoutMs = 5000) {
  const ping = (async () => {
    const connectedDb = await connectToDatabase();
    await connectedDb.command({ ping: 1 });
  })();

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`Database ping timed out after ${timeoutMs}ms`)
        ),
      timeoutMs
    );

    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });

  try {
    await Promise.race([ping, timeout]);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export async function closeDatabaseConnection() {
  if (client) {
    await client.close();
  }

  client = null;
  db = null;
  connectionPromise = null;
}
