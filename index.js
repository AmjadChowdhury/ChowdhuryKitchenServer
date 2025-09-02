// server.js
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: [
        'https://chowdhurykitchen-45f58.web.app',
        'https://chowdhurykitchen-45f58.firebaseapp.com',
        'http://localhost:5173'
    ],
}));
app.use(express.json());

// MongoDB Connection URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.g7yl3.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        const userCollection = client.db("ChowdhuryKitchen").collection("users");
        const menuCollection = client.db("ChowdhuryKitchen").collection("menu");
        const reviewsCollection = client.db("ChowdhuryKitchen").collection("reviews");
        const cartCollection = client.db("ChowdhuryKitchen").collection("carts");
        const paymentCollection = client.db("ChowdhuryKitchen").collection("payments");

        // JWT and middleware
        app.post("/jwt", (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCES_TOKEN_SECRET, {
                expiresIn: "1h",
            });
            res.send({ token });
        });

        const verifyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: "forbidden access" });
            }
            const token = req.headers.authorization.split(" ")[1];
            jwt.verify(token, process.env.ACCES_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: "forbidden access" });
                }
                req.decoded = decoded;
                next();
            });
        };

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === "admin";
            if (!isAdmin) {
                return res.status(403).send({ message: "forbidden access" });
            }
            next();
        };

        // Menu APIs
        app.get("/menu", async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        });
        app.get("/menu/:id", async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await menuCollection.findOne(filter);
            res.send(result);
        });
        app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
            const menuInfo = req.body;
            const result = await menuCollection.insertOne(menuInfo);
            res.send(result);
        });
        app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        });
        app.patch("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const item = req.body;
            console.log(req.body)
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    name: item.name,
                    recipe: item.recipe,
                    image: item.image,
                    price: item.price,
                    quantity: item.quantity,
                    category: item.category
                }
            };
            const result = await menuCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        // Reviews APIs
        app.get("/reviews", async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result);
        });
        app.post('/reviews', async (req, res) => {
            const review = req.body;
            const result = await reviewsCollection.insertOne(review);
            res.send(result);
        });

        // Users APIs
        app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });
        app.get("/users/admin/:email", verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: "Unauthorized access" });
            }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const admin = user?.role === "admin";
            res.send({ admin });
        });
        app.post("/users", async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "already exist", insertedId: null });
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        });
        app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = { $set: { role: "admin" } };
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });
        app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
        });

        // Carts APIs
        app.get("/carts", verifyToken, async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: "forbidden access" });
            }
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });
        app.post("/carts", async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.send(result);
        });
        app.delete("/carts/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });

        // Payment APIs
        app.post("/create-payment-intent", verifyToken, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            });
            res.send({ clientSecret: paymentIntent.client_secret });
        });
        app.get("/payments/:email", verifyToken, async (req, res) => {
            const query = { email: req.params.email };
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: "forbidden access" });
            }
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        });
        app.post("/payments", async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);
            const query = {
                _id: { $in: payment.cartId.map((id) => new ObjectId(id)) },
            };
            const deleteResult = await cartCollection.deleteMany(query);
            res.send({ paymentResult, deleteResult });
        });

        // Admin Stats & Order Stats APIs
        app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();
            const result = await paymentCollection.aggregate([{ $group: { _id: null, totalRevenue: { $sum: "$price" } } }]).toArray();
            const revenue = result.length > 0 ? result[0].totalRevenue : 0;
            res.send({ users, menuItems, orders, revenue });
        });

        app.get("/order-stats", async (req, res) => {
            const result = await paymentCollection
                .aggregate([
                    { $unwind: "$menuItemId" },
                    {
                        $lookup: {
                            from: "menu",
                            localField: "menuItemId",
                            foreignField: "_id",
                            as: "menuItems",
                        },
                    },
                    { $unwind: "$menuItems" },
                    {
                        $group: {
                            _id: "$menuItems.category",
                            quantity: { $sum: 1 },
                            revenue: { $sum: "$menuItems.price" },
                        },
                    },
                ])
                .toArray();
            res.send(result);
        });

     // Gemini setup
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ reply: "⚠️ Please enter a message." });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Prompt tuned for short, relevant answers
    const result = await model.generateContent(`
      You are a helpful assistant for "ChowdhuryKitchen".
      - If the question is about food or ChowdhuryKitchen: answer max in 2-3 lines, focusing on taste, quality, or menu.
      - If the question is about salad: answer 🥗 Fresh & healthy salads made from premium ingredients and also relavent answer.
      - If the question is about pizza: answer 🥗 🍕 Delicious, cheesy pizzas baked to perfection and also relavent answer.
      - If the question is about soup: answer 🥣 Warm, flavorful soups crafted with care and also relavent answer.
      - If the question is about dessert: answer 🍰 Irresistible desserts to sweeten your day and also relavent answer.
      - If the question is about dessert and price: answer 🍰 about desserts and amount of price in 200-300 tk to sweeten your day and also relavent answer.
      - If the question is general: answer briefly maximum (2-3 lines).
      Question: ${message}
    `);

    const reply = result?.response?.text() || "⚠️ No response from AI.";
    res.json({ reply });
  } catch (err) {
    console.error("❌ Gemini API Error:", err.message);
    res.status(500).json({ reply: "⚠️ Server error." });
  }
});



        app.get("/", (req, res) => {
            res.send("Server is running");
        });
    } finally {
        // Keeps the server running after setup
    }
}
run().catch(console.dir);
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});