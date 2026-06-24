// seed-admin.js - Run this ONCE to create the admin user
// Usage: node seed-admin.js

const { MongoClient } = require("mongodb");
const { createHash, randomBytes } = require("crypto");
require("dotenv").config();

const ADMIN_EMAIL = "admin@arthub.com";
const ADMIN_PASSWORD = "Admin@123";
const ADMIN_NAME = "ArtHub Admin";

// Simple password hasher compatible with BetterAuth (scrypt/argon2)
// BetterAuth uses its own hashing - we'll set the role via direct DB insert
// and use the BetterAuth API to register then promote to admin

async function seed() {
  const client = new MongoClient(process.env.MONGO_URI);
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "arthub");
    const usersCollection = db.collection("user");

    // Check if admin already exists
    const existing = await usersCollection.findOne({ email: ADMIN_EMAIL });
    if (existing) {
      console.log("✅ Admin user already exists:", existing.email);
      console.log("   Ensuring role is 'admin'...");
      await usersCollection.updateOne(
        { email: ADMIN_EMAIL },
        { $set: { role: "admin" } }
      );
      console.log("✅ Role confirmed as admin.");
      return;
    }

    console.log("ℹ️  Admin user not found.");
    console.log("📝 Instructions:");
    console.log("   1. Register normally at http://localhost:3000/register");
    console.log(`      Email: ${ADMIN_EMAIL}`);
    console.log(`      Password: ${ADMIN_PASSWORD}`);
    console.log("   2. Then run this script again to promote to admin.");
    console.log("");
    console.log("   OR if you have already registered, run this to promote:");
    console.log("   The script will set role=admin if the account exists.");
  } finally {
    await client.close();
  }
}

seed().catch(console.error);
