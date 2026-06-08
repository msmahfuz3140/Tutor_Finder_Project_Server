const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");


const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const PORT = process.env.PORT || 4000;
const uri = process.env.MONGODB_URI;

// Allow all origins for this project (Vercel preview deployments need this)
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
if (!uri) {
    throw new Error("❌ MONGODB_URI missing in .env file");
}

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        await client.connect();
        console.log("✅ MongoDB Connected Successfully");

        const db = client.db("tutors-finder");
        const tutorsCollection = db.collection("tutors");
        const bookingsCollection = db.collection("bookings");

        // JWT verification middleware
        const verifyToken = (req, res, next) => {
            const authorization = req.headers.authorization;
            if (!authorization) {
                return res.status(401).json({ message: "unauthorized access" });
            }
            const token = authorization.split(" ")[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || "medi-queue-secret", (err, decoded) => {
                if (err) {
                    return res.status(403).json({ message: "forbidden access" });
                }
                req.decoded = decoded;
                next();
            });
        };

        // JWT token generation
        app.post("/jwt", (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET || "medi-queue-secret", { expiresIn: "3h" });
            res.status(200).json({ token });
        });

        app.get("/", (req, res) => {
            res.send("Server is Running now");
        });

        // Get tutors with filters
        app.get("/tutors", async (req, res) => {
            try {
                const { search, startDate, endDate, limit, email } = req.query;
                let query = {};

                if (search) {
                    query.tutorName = { $regex: search, $options: "i" };
                }

                if (startDate || endDate) {
                    query.sessionStart = {};
                    if (startDate) {
                        query.sessionStart.$gte = startDate;
                    }
                    if (endDate) {
                        query.sessionStart.$lte = endDate;
                    }
                }

                if (email) {
                    query.$or = [
                        { creatorEmail: email },
                        { email: email }
                    ];
                }

                let cursor = tutorsCollection.find(query);

                if (limit) {
                    cursor = cursor.limit(parseInt(limit));
                }

                const tutors = await cursor.toArray();
                res.status(200).json(tutors);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to fetch tutors" });
            }
        });

        // Get single tutor
        app.get("/tutors/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const tutor = await tutorsCollection.findOne({ _id: new ObjectId(id) });
                if (!tutor) {
                    return res.status(404).json({ error: "Tutor not found" });
                }
                res.status(200).json(tutor);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to fetch tutor" });
            }
        });

        // Insert tutor (Private)
        app.post("/tutors", verifyToken, async (req, res) => {
            try {
                const tutorsData = req.body;
                
                // Ensure data formats
                if (tutorsData.hourlyFee !== undefined) tutorsData.hourlyFee = Number(tutorsData.hourlyFee);
                if (tutorsData.totalSlot !== undefined) tutorsData.totalSlot = Number(tutorsData.totalSlot);

                // Add creator email from verified JWT token
                tutorsData.creatorEmail = req.decoded.email;

                const result = await tutorsCollection.insertOne(tutorsData);
                res.status(201).json(result);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to insert tutor" });
            }
        });

        // Update tutor (Private)
        app.put("/tutors/:id", verifyToken, async (req, res) => {
            try {
                const { id } = req.params;
                const updatedData = req.body;
                delete updatedData._id;

                if (updatedData.hourlyFee !== undefined) updatedData.hourlyFee = Number(updatedData.hourlyFee);
                if (updatedData.totalSlot !== undefined) updatedData.totalSlot = Number(updatedData.totalSlot);

                const result = await tutorsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedData }
                );
                res.status(200).json(result);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to update tutor" });
            }
        });

        // Delete tutor (Private)
        app.delete("/tutors/:id", verifyToken, async (req, res) => {
            try {
                const { id } = req.params;
                const result = await tutorsCollection.deleteOne({ _id: new ObjectId(id) });
                res.status(200).json(result);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to delete tutor" });
            }
        });

        // Book session (Private)
        app.post("/bookings", verifyToken, async (req, res) => {
            try {
                const bookingData = req.body;
                const { tutorId, studentEmail } = bookingData;

                const tutor = await tutorsCollection.findOne({ _id: new ObjectId(tutorId) });
                if (!tutor) {
                    return res.status(404).json({ error: "Tutor not found" });
                }

                if (Number(tutor.totalSlot) <= 0) {
                    return res.status(400).json({ error: "No available slots left" });
                }

                const currentDateStr = new Date().toISOString().split("T")[0];
                if (tutor.sessionStart && currentDateStr < tutor.sessionStart) {
                    return res.status(400).json({ error: "Booking is not available yet for this tutor" });
                }

                const newBooking = {
                    ...bookingData,
                    tutorId: new ObjectId(tutorId),
                    bookingStatus: "pending",
                    bookedAt: new Date().toISOString()
                };

                const result = await bookingsCollection.insertOne(newBooking);

                // Decrease slot count of tutor by 1
                await tutorsCollection.updateOne(
                    { _id: new ObjectId(tutorId) },
                    { $inc: { totalSlot: -1 } }
                );

                res.status(201).json(result);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to create booking" });
            }
        });

        // Get user bookings (Private)
        app.get("/bookings", verifyToken, async (req, res) => {
            try {
                const { email } = req.query;
                if (!email) {
                    return res.status(400).json({ error: "Email query parameter is required" });
                }
                if (req.decoded.email !== email) {
                    return res.status(403).json({ error: "Forbidden access" });
                }
                const bookings = await bookingsCollection.find({ studentEmail: email }).toArray();
                res.status(200).json(bookings);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to fetch bookings" });
            }
        });

        // Cancel booking (Private)
        app.patch("/bookings/:id", verifyToken, async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body;
                if (status !== "cancelled") {
                    return res.status(400).json({ error: "Invalid status update" });
                }

                const result = await bookingsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { bookingStatus: "cancelled" } }
                );
                res.status(200).json(result);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to cancel booking" });
            }
        });

        app.listen(PORT, () => {
            console.log(`🚀 Server running on PORT ${PORT}`);
        });
    } catch (error) {
        console.error(error);
    }
}

run();