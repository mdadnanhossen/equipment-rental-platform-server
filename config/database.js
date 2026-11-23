
import { MongoClient } from "mongodb";
import "dotenv/config";

const DB_NAME = process.env.DB_NAME || "rental-platform";

let client = null;
let db = null;
let connectionPromise = null;

/**
 * Reports whether the cached client can still serve operations.
 *
 * A failed `client.connect()` leaves a non-null but CLOSED topology behind,
 * and the driver never recovers from that on its own: every later operation
 * then fails with `MongoTopologyClosedError: Topology is closed` for the rest
 * of the process lifetime. Detecting it here lets the next request rebuild the
 * connection instead of failing forever.
 */
function isClientHealthy() {
  if (!client || !db) {
    return false;
  }

  try {
    // Set by MongoClient.close() — that client can never be reused.
    if (client.s?.hasBeenClosed) {
      return false;
    }

    const topology = client.topology;

    if (topology && typeof topology.isConnected === "function" && !topology.isConnected()) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Connects to MongoDB using a cached promise so that concurrent requests
 * (e.g. several Vercel invocations on cold start) share a single connection
 * instead of racing each other.
 */
export async function connectToDatabase() {
  // Fast path: a verified, still-open connection.
  if (isClientHealthy()) {
    return db;
  }

  // The cached handle is missing or its topology was closed. Drop it before
  // reconnecting so every caller (including Better Auth's adapter, which is
  // recreated from `getDatabase()`) moves to the replacement together.
  db = null;

  if (client?.s?.hasBeenClosed) {
    // A closed MongoClient cannot be revived — only this reference dies; any
    // Db handed out earlier belongs to it and is replaced as well.
    client = null;
  }

  if (!connectionPromise) {
    const attempt = (async () => {
      try {
        const uri = process.env.DB_URL;

        if (!uri) {
          throw new Error("DB_URL environment variable is missing");
        }

        // Reuse the same MongoClient whenever possible. `connect()` is a
        // no-op while the topology is healthy and installs a fresh topology
        // when the previous attempt failed, so every Db already handed out
        // stays valid. Closing the client instead would invalidate them for
        // good (and, on a busy instance, races in-flight operations into
        // MongoTopologyClosedError).
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
        console.error("MongoDB connection failed:", error);
        throw error;
      }
    })();

    connectionPromise = attempt;

    // Clear the cache as soon as the attempt settles — on success AND on
    // failure. The promise is only a single-flight lock for concurrent
    // callers; the healthy check above is what keeps a warm connection.
    // Leaving a resolved promise cached forever would make every later
    // reconnect a no-op and `MongoTopologyClosedError` permanent.
    // Attaching the handlers also marks the rejection as handled, which
    // avoids an unhandled-rejection crash on Vercel.
    const clearLock = () => {
      if (connectionPromise === attempt) {
        connectionPromise = null;
      }
    };

    attempt.then(clearLock, clearLock);
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
  return Boolean(db) && isClientHealthy();
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
