const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

    // ==========================================
    // ARTIST ROUTES
    // ==========================================
    app.get('/api/artist/:email', async (req, res) => {
      const { email } = req.params;
      const result = await artistsCollection.findOne({ artistEmail: email });
      res.send(result);
    });

    app.post('/api/artists', async (req, res) => {
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

    app.patch('/api/artists/:id', async (req, res) => {
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

    // ==========================================
    // ARTWORK ROUTES
    // ==========================================
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
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await artworksCollection.findOne(query);
      res.send(result);
    });

    app.get('/api/artworks/artist/:email', async (req, res) => {
      const { email } = req.params;
      const result = await artworksCollection.find({ artistEmail: email }).toArray();
      res.send(result);
    });

    app.post('/api/artworks', async (req, res) => {
      const data = req.body;
      // Note: Subscription limits will be implemented here later per user request.
      
      const result = await artworksCollection.insertOne({
        ...data,
        status: 'available',
        createdAt: new Date()
      });
      res.send(result);
    });

    app.patch('/api/artworks/:id', async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;

      const result = await artworksCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { ...updateData } }
      );
      res.send(result);
    });

    app.delete('/api/artworks/:id', async (req, res) => {
      const { id } = req.params;
      const result = await artworksCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ==========================================
    // COMMENTS ROUTES
    // ==========================================
    app.get('/api/comments/:artworkId', async (req, res) => {
      const { artworkId } = req.params;
      const result = await commentsCollection.find({ artworkId }).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    app.post('/api/artworks/:id/comments', async (req, res) => {
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

    app.patch('/api/comments/:id', async (req, res) => {
      const { id } = req.params;
      const { text } = req.body;
      const result = await commentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { text, updatedAt: new Date() } }
      );
      res.send(result);
    });

    app.delete('/api/comments/:id', async (req, res) => {
      const { id } = req.params;
      const result = await commentsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ==========================================
    // PURCHASE & TRANSACTION ROUTES
    // ==========================================
    app.get('/api/artworks/purchase/:email', async (req, res) => {
      const { email } = req.params;
      const result = await purchaseCollection.find({ buyerEmail: email }).toArray();
      res.send(result);
    });

    app.post('/api/artworks/purchase', async (req, res) => {
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

    // ==========================================
    // USER / SUBSCRIPTION ROUTES
    // ==========================================
    app.patch('/api/users/upgrade-subscription/:email', async (req, res) => {
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

    app.get('/api/payment/:email', async (req, res) => {
      const { email } = req.params;
      const result = await paymentCollection.find({ userEmail: email }).toArray();
      res.send(result);
    });

    // Admin Routes for Dashboard
    app.get('/api/admin/analytics', async (req, res) => {
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

    app.get('/api/users', async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.patch('/api/users/role/:id', async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );
      res.send(result);
    });

    app.delete('/api/users/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to delete user' });
      }
    });

    // ==========================================
    // ADMIN SEED ROUTE (run once to create admin)
    // ==========================================
    app.post('/api/admin/promote', async (req, res) => {
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

    app.get('/api/transactions', async (req, res) => {
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
