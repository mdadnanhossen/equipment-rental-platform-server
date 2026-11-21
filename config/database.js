
import { MongoClient } from "mongodb";
import "dotenv/config";

const client = new MongoClient(process.env.DB_URL);

let db;

export async function connectToDatabase() {
  try {
    if (!db) {
      await client.connect();

      db = client.db("rental-platform");

      console.log("Successfully connected to MongoDB!");
    }

    return db;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    throw error;
  }
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

export async function closeDatabaseConnection() {
  await client.close();
  db = null;
}
