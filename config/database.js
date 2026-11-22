
// import { MongoClient } from "mongodb";
// import "dotenv/config";

// const client = new MongoClient(process.env.DB_URL);

// let db;

// export async function connectToDatabase() {
//   try {
//     if (!db) {
//       await client.connect();

//       db = client.db("rental-platform");

//       console.log("Successfully connected to MongoDB!");
//     }

//     return db;
//   } catch (error) {
//     console.error("MongoDB connection failed:", error);
//     throw error;
//   }
// }

// export function getDatabase() {
//   if (!db) {
//     throw new Error(
//       "Database is not connected. Call connectToDatabase() first."
//     );
//   }

//   return db;
// }

// export function getCollection(collectionName) {
//   return getDatabase().collection(collectionName);
// }

// export async function closeDatabaseConnection() {
//   await client.close();
//   db = null;
// }

import { MongoClient } from "mongodb";
import "dotenv/config";

if (!process.env.DB_URL) {
  throw new Error("DB_URL environment variable is missing");
}

const client = new MongoClient(process.env.DB_URL);

let db = null;
let connectionPromise = null;

export async function connectToDatabase() {
  if (db) return db;

  if (!connectionPromise) {
    connectionPromise = (async () => {
      try {
        await client.connect();

        db = client.db("rental-platform");

        await db.command({ ping: 1 });

        console.log("Successfully connected to MongoDB!");

        return db;
      } catch (error) {
        connectionPromise = null;
        db = null;

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

export async function closeDatabaseConnection() {
  await client.close();

  db = null;
  connectionPromise = null;
}
