const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const app = express();
const cors = require("cors")


const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const PORT = process.env.PORT || 4000;
const uri = process.env.MONGODB_URI;
app.use(cors());
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

        app.get("/", (req, res) => {
            res.send("Server is Running now");
        });

        app.get("/tutors", async (req, res) => {
            try {
                const tutors = await tutorsCollection.find({}).toArray();
                res.status(200).json(tutors);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to fetch tutors" });
            }
        });

        app.post("/tutors", async (req, res) => {
            try {
                const tutorsData = req.body;

                const result = await tutorsCollection.insertOne(tutorsData);

                res.status(201).json(result);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to insert tutor" });
            }
        });

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

        app.listen(PORT, () => {
            console.log(`🚀 Server running on PORT ${PORT}`);
        });
    } catch (error) {
        console.error(error);
    }
}

run();