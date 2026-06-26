const dns = require("dns");
dns.setServers(["8.8.8.8"], ["8.8.4.4"]);
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
dotenv.config();

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-internal-secret"]
}));
app.use(express.json());

const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "dev-internal-secret";

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized: Token format invalid" });
  }
  try {
    const JWKS = createRemoteJWKSet(
      new URL(`${CLIENT_URL}/api/auth/jwks`)
    );
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.warn(`[verifyToken] Rejected: ${error.code || error.message}`);
    return res.status(401).json({ message: "Unauthorized: Token validation failed" });
  }
};

// Middleware for server-to-server calls
const verifyInternalOrToken = async (req, res, next) => {
  const internalSecret = req.headers['x-internal-secret'];
  if (internalSecret && internalSecret === INTERNAL_API_SECRET) {
    return next();
  }
  return verifyToken(req, res, next);
};
const uri = process.env.MONGO_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    // await client.connect();

    // Database and Collections
    const db = client.db(process.env.DB_NAME || 'arthub');
    const artistsCollection = db.collection('artists');
    const artworksCollection = db.collection('artworks');
    const usersCollection = db.collection('user');
    const purchaseCollection = db.collection('purchases');
    const paymentCollection = db.collection('payments');
    const commentsCollection = db.collection('comments');

    // ARTIST ROUTES
    app.get('/api/artist/:email', async (req, res) => {
      const { email } = req.params;
      const result = await artistsCollection.findOne({ artistEmail: email });
      res.send(result || {});
    });

    app.post('/api/artists', verifyToken, async (req, res) => {
      const { artistName, avatar, portfolioWebsite, bio, artistEmail } = req.body;
      const addData = {
        artistName,
        avatar,
        portfolioWebsite,
        bio,
        artistEmail,
        createdAt: new Date(),
        status: 'active',
      };
      const result = await artistsCollection.insertOne(addData);
      res.send(result);
    });

    app.patch('/api/artists/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      const { artistName, avatar, portfolioWebsite, bio, artistEmail } = req.body;

      const updateData = {
        artistName,
        avatar,
        portfolioWebsite,
        bio,
        artistEmail,
      };

      const result = await artistsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { ...updateData } }
      );
      res.send(result);
    });

    // ARTWORK ROUTES
    app.get('/api/artworks', async (req, res) => {
      const search = req.query.search;
      const category = req.query.category;
      const minPrice = req.query.minPrice;
      const maxPrice = req.query.maxPrice;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;
      const query = {};

      if (search) {
        query.$or = [
          { title: { $regex: search, $options: 'i' } },
          { artistEmail: { $regex: search, $options: 'i' } },
          { artistName: { $regex: search, $options: 'i' } }
        ];
      }

      if (category) {
        query.category = { $in: category.split(',') };
      }

      if (minPrice || maxPrice) {
        query.price = {};
        if (minPrice && !isNaN(minPrice)) query.price.$gte = parseFloat(minPrice);
        if (maxPrice && !isNaN(maxPrice)) query.price.$lte = parseFloat(maxPrice);
      }

      const totalItems = await artworksCollection.countDocuments(query);
      const totalPages = Math.ceil(totalItems / limit);
      const skip = (page - 1) * limit;

      const artworks = await artworksCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();

      res.send({
        artworks,
        totalPages,
        totalItems,
        currentPage: page
      });
    });

    app.get('/api/single-artworks/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const result = await artworksCollection.findOne(query);
        if (!result) {
          return res.status(404).send({ error: "Artwork not found" });
        }
        res.send(result);
      } catch (error) {
        res.status(400).send({ error: "Invalid ID format" });
      }
    });

    app.get('/api/artworks/artist/:email', verifyToken, async (req, res) => {
      const { email } = req.params;
      const result = await artworksCollection.find({ artistEmail: email }).toArray();
      res.send(result);
    });

    app.post('/api/artworks', verifyToken, async (req, res) => {
      const data = req.body;
      if (data.price !== undefined) data.price = parseFloat(data.price);
      // Note: Subscription limits will be implemented here later per user request.

      const result = await artworksCollection.insertOne({
        ...data,
        status: 'available',
        createdAt: new Date()
      });
      res.send(result);
    });

    app.patch('/api/artworks/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;
      if (updateData.price !== undefined) updateData.price = parseFloat(updateData.price);

      const result = await artworksCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { ...updateData } }
      );
      res.send(result);
    });

    app.delete('/api/artworks/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      const result = await artworksCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // COMMENTS ROUTES
    app.get('/api/comments/:artworkId', async (req, res) => {
      const { artworkId } = req.params;
      const result = await commentsCollection.find({ artworkId }).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    app.post('/api/artworks/:id/comments', verifyToken, async (req, res) => {
      const { id } = req.params;
      const commentData = req.body;
      const { userEmail } = commentData;

      // Verify the user actually purchased the artwork
      const hasPurchased = await purchaseCollection.findOne({
        artworkId: id,
        buyerEmail: userEmail
      });

      if (!hasPurchased) {
        return res.status(403).send({ error: 'Only verified buyers can leave a comment.' });
      }

      const result = await commentsCollection.insertOne({
        ...commentData,
        artworkId: id,
        createdAt: new Date()
      });
      res.send(result);
    });

    app.patch('/api/comments/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      const { text } = req.body;
      const result = await commentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { comment: text, updatedAt: new Date() } }
      );
      res.send(result);
    });

    app.delete('/api/comments/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      const result = await commentsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // STRIPE CHECKOUT ROUTES
    app.post('/api/checkout/artwork', verifyToken, async (req, res) => {
      try {
        const { artworkId, artworkTitle, artistEmail, buyerEmail, amount, origin } = req.body;

        // 1. Check User Subscription and Limits
        const user = await usersCollection.findOne({ email: buyerEmail });
        if (!user) return res.status(404).send({ error: 'User not found' });

        const tier = user.subscriptionTier || 'free';
        const purchasesCount = await purchaseCollection.countDocuments({ buyerEmail });

        let limit = 3;
        if (tier === 'pro') limit = 9;
        if (tier === 'premium') limit = Infinity;

        if (purchasesCount >= limit) {
          return res.status(403).send({
            error: 'Purchase limit reached',
            message: `Your ${tier} subscription limits you to ${limit} artwork${limit === 1 ? '' : 's'}. You have already purchased ${purchasesCount}. Please upgrade your subscription to buy more.`
          });
        }

        // 2. Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          customer_email: buyerEmail,
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: { name: artworkTitle },
                unit_amount: Math.round(amount * 100),
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/artworks/${artworkId}?canceled=true`,
          metadata: {
            type: 'artwork',
            artworkId: artworkId.toString(),
            artworkTitle,
            artistEmail,
            buyerEmail,
            amount: amount.toString()
          }
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).send({ error: error.message });
      }
    });

    app.post('/api/checkout/subscription', verifyToken, async (req, res) => {
      try {
        const { buyerEmail, tier, origin } = req.body;

        let price = 0;
        if (tier === 'pro') price = 9.99;
        else if (tier === 'premium') price = 19.99;
        else return res.status(400).send({ error: 'Invalid subscription tier' });

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          customer_email: buyerEmail,
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: { name: `ArtHub ${tier.charAt(0).toUpperCase() + tier.slice(1)} Subscription` },
                unit_amount: Math.round(price * 100),
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/dashboard/user?canceled=true`,
          metadata: {
            type: 'subscription',
            tier,
            buyerEmail,
            amount: price.toString()
          }
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).send({ error: error.message });
      }
    });

    // PURCHASE & TRANSACTION ROUTES
    app.get('/api/artworks/purchase/:email', verifyInternalOrToken, async (req, res) => {
      const { email } = req.params;
      try {
        const purchases = await purchaseCollection.aggregate([
          { $match: { buyerEmail: email } },
          { $addFields: { artworkObjId: { $toObjectId: "$artworkId" } } },
          {
            $lookup: {
              from: 'artworks',
              localField: 'artworkObjId',
              foreignField: '_id',
              as: 'artworkDetails'
            }
          },
          {
            $addFields: {
              artworkImage: { $arrayElemAt: ["$artworkDetails.image", 0] },
              artistName: { $arrayElemAt: ["$artworkDetails.artistName", 0] }
            }
          },
          {
            $project: {
              artworkDetails: 0,
              artworkObjId: 0
            }
          }
        ]).toArray();
        res.send(purchases);
      } catch (error) {
        console.error("Error fetching purchases:", error);
        res.status(500).send({ error: "Failed to fetch collection" });
      }
    });

    app.post('/api/artworks/purchase', verifyInternalOrToken, async (req, res) => {
      const { amount, artworkId, artworkTitle, artistEmail, buyerEmail, paymentType, transactionId, paymentStatus } = req.body;

      const purchaseData = {
        artworkId,
        artworkTitle,
        artistEmail,
        buyerEmail,
        amount,
        transactionId,
        paymentStatus,
        purchaseDate: new Date(),
      };

      // Prevent duplicate purchases via transaction ID
      const isPurchaseExist = await purchaseCollection.findOne({ transactionId });
      if (isPurchaseExist) {
        return res.status(200).send({ message: 'Already paid' });
      }

      const purchaseRes = await purchaseCollection.insertOne(purchaseData);

      // Mark artwork as sold
      await artworksCollection.updateOne(
        { _id: new ObjectId(artworkId) },
        { $set: { status: 'sold' } }
      );

      const paymentData = {
        userEmail: buyerEmail,
        amount,
        transactionId,
        paymentStatus,
        paymentType,
        paymentFor: 'artwork_purchase',
        paidAt: new Date(),
      };

      await paymentCollection.insertOne(paymentData);
      res.send(purchaseRes);
    });

    // USER / SUBSCRIPTION ROUTES
    app.patch('/api/users/upgrade-subscription/:email', verifyInternalOrToken, async (req, res) => {
      const { email } = req.params;
      const { amount, transactionId, paymentStatus, paymentType, tier } = req.body;

      // Ensure tier is valid (pro or premium)
      const validTier = tier === 'premium' ? 'premium' : 'pro';

      const result = await usersCollection.updateOne(
        { email },
        {
          $set: {
            subscriptionTier: validTier,
          },
        }
      );

      const paymentData = {
        userEmail: email,
        amount,
        transactionId,
        paymentStatus,
        paymentType,
        paymentFor: `subscription_${validTier}`,
        paidAt: new Date(),
      };

      await paymentCollection.insertOne(paymentData);
      res.send(result);
    });

    app.get('/api/payment/:email', verifyToken, async (req, res) => {
      const { email } = req.params;
      const result = await paymentCollection.find({ userEmail: email }).toArray();
      res.send(result);
    });

    app.get('/api/purchases/artist/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await purchaseCollection.find({ artistEmail: email }).sort({ purchaseDate: -1 }).toArray();
      res.send(result);
    });

    // Admin Routes for Dashboard
    app.get('/api/admin/analytics', verifyToken, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalArtists = await usersCollection.countDocuments({ role: 'artist' });
        const artworksSold = await artworksCollection.countDocuments({ status: 'sold' });

        const revenueAggregation = await paymentCollection.aggregate([
          { $group: { _id: null, totalRevenue: { $sum: { $toDouble: "$amount" } } } }
        ]).toArray();
        const totalRevenue = revenueAggregation.length > 0 ? revenueAggregation[0].totalRevenue : 0;

        // Sales Chart (Group by Date)
        const salesData = await paymentCollection.aggregate([
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$paidAt" } },
              revenue: { $sum: { $toDouble: "$amount" } }
            }
          },
          { $sort: { _id: 1 } },
          { $limit: 30 }
        ]).toArray();

        // Format for Recharts
        const formattedSalesData = salesData.map(item => ({
          date: item._id || 'Unknown',
          revenue: item.revenue
        }));

        // Category Chart (Group by Category)
        const categoryData = await artworksCollection.aggregate([
          { $match: { category: { $exists: true, $ne: "" } } },
          { $group: { _id: "$category", count: { $sum: 1 } } }
        ]).toArray();

        const formattedCategoryData = categoryData.map(item => ({
          name: item._id,
          value: item.count
        }));

        res.send({
          totalUsers,
          totalArtists,
          artworksSold,
          totalRevenue,
          salesData: formattedSalesData,
          categoryData: formattedCategoryData
        });
      } catch (error) {
        console.error("Analytics Error:", error);
        res.status(500).send({ error: 'Failed to fetch analytics' });
      }
    });

    app.get('/api/users', verifyToken, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.get('/api/users/:email', async (req, res) => {
      const { email } = req.params;
      const result = await usersCollection.findOne({ email });
      res.send(result || {});
    });

    app.patch('/api/users/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;
      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to update user' });
      }
    });

    app.patch('/api/users/update-profile/:email', verifyToken, async (req, res) => {
      const { email } = req.params;
      const updateData = req.body;
      try {
        const result = await usersCollection.updateOne(
          { email: email },
          { $set: updateData }
        );

        if (updateData.name || updateData.image) {
          const commentUpdate = {};
          if (updateData.name) commentUpdate.userName = updateData.name;
          if (updateData.image) commentUpdate.avatar = updateData.image;

          await commentsCollection.updateMany(
            { userEmail: email },
            { $set: commentUpdate }
          );
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to update user by email' });
      }
    });

    app.patch('/api/users/role/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;
      const query = { $or: [{ _id: id }] };
      try { query.$or.push({ _id: new ObjectId(id) }); } catch (e) { }

      const result = await usersCollection.updateOne(
        query,
        { $set: { role } }
      );
      res.send(result);
    });

    app.delete('/api/users/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      try {
        const query = { $or: [{ _id: id }] };
        try { query.$or.push({ _id: new ObjectId(id) }); } catch (e) { }

        await db.collection("session").deleteMany({ userId: id });

        const result = await usersCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to delete user' });
      }
    });

    // ADMIN SEED ROUTE
    app.post('/api/admin/promote', verifyToken, async (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).send({ error: 'Email required' });

      const result = await usersCollection.updateOne(
        { email },
        { $set: { role: 'admin' } }
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ error: 'User not found. Register first at /register.' });
      }
      res.send({ success: true, message: `${email} promoted to admin.` });
    });

    app.get('/api/transactions', verifyToken, async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });

    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Arthub Server is running!');
});

app.listen(port, () => {
  console.log(`Arthub Server listening on port ${port}`);
});
