const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(express.json({ limit: "100mb" }));

// --- Session & Authentication Middleware ---
app.use(
    session({
        secret: "secure-session",
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 5 * 60 * 60 * 1000 },
    })
);

// Updated authentication middleware to avoid infinite redirect loop
app.use((req, res, next) => {
    if (!req.session.user) {
        const allowedPaths = ["/login.html", "/login", "/logout", "/protected"];
        // Allow access to allowed paths and static assets
        if (
            allowedPaths.includes(req.path) ||
            req.path.endsWith(".js") ||
            req.path.endsWith(".css") ||
            req.path.endsWith(".png") ||
            req.path.endsWith(".jpg")
        ) {
            return next();
        }
        return res.redirect("/login.html");
    }
    next();
});

// --- Create "temp" folder if it doesn't exist ---
const tempFolder = path.join(__dirname, "temp");
if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder);
}

// --- SQLite Database Connection ---
const db = new sqlite3.Database("database.sqlite", (err) => {
    if (err) {
        console.error("❌ Database connection error:", err.message);
    } else {
        console.log("✅ Connected to SQLite database.");
        db.run(`CREATE TABLE IF NOT EXISTS uuids (
            id TEXT PRIMARY KEY,
            date TEXT,
            time TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`);
    }
});

// --- Serve Login Page ---
app.get("/login.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// --- Serve Main (Index) Page (only if authenticated) ---
app.get("/", (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login.html");
    }
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- Serve static files ---
app.use(express.static("public"));

// --- UUID Generation Logic ---
const generateUUIDs = async (numUUIDs) => {
    const generatedUUIDs = new Set();
    return new Promise((resolve) => {
        db.all("SELECT id FROM uuids", [], (err, rows) => {
            if (err) {
                console.error("❌ Error checking database:", err);
                resolve([]);
                return;
            }
            const existingUUIDs = new Set(rows.map(row => row.id));
            while (generatedUUIDs.size < numUUIDs) {
                let newUUID;
                do {
                    newUUID = uuidv4();
                } while (existingUUIDs.has(newUUID) || generatedUUIDs.has(newUUID));
                generatedUUIDs.add(newUUID);
            }
            resolve(Array.from(generatedUUIDs));
        });
    });
};

// --- Insert UUIDs in Database ---
// Updated to use INSERT OR IGNORE to avoid infinite loops on duplicates.
const insertUUIDsBatch = async (uuids) => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("INSERT OR IGNORE INTO uuids (id, date, time) VALUES (?, ?, ?)");
        const now = new Date();
        const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
        const timeStr = now.toTimeString().split(" ")[0]; // HH:MM:SS

        Promise.all(
            uuids.map((uuid) => {
                return new Promise((innerResolve) => {
                    stmt.run(uuid, dateStr, timeStr, function (err) {
                        if (err) {
                            console.error("❌ Error inserting UUID:", err);
                        }
                        innerResolve();
                    });
                });
            })
        )
        .then(() => {
            stmt.finalize(resolve);
        })
        .catch(reject);
    });
};

// --- Generate UUID Route ---
app.post("/generate", async (req, res) => {
    const numUUIDs = parseInt(req.body.numUUIDs);
    if (isNaN(numUUIDs) || numUUIDs <= 0) {
        return res.status(400).json({ error: "Invalid number of UUIDs." });
    }
    if (numUUIDs > 100000) {
        return res.status(400).json({ error: "⚠️ Maximum limit is 100,000 UUIDs." });
    }
    try {
        const uuids = await generateUUIDs(numUUIDs);
        res.json({ uuids });
    } catch (err) {
        console.error("❌ Error generating UUIDs:", err);
        res.status(500).json({ error: "Error generating UUIDs." });
    }
});

// --- CSV Download Route ---
app.post("/download", async (req, res) => {
    const uuids = req.body.uuids;
    const numUUIDs = uuids.length;
    if (!uuids || !Array.isArray(uuids) || numUUIDs === 0) {
        return res.status(400).json({ error: "Invalid UUID list." });
    }
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toTimeString().split(" ")[0].replace(/:/g, "_");
    const randomStr = Math.random().toString(36).substring(2, 5);
    const csvFilename = `uuids_${numUUIDs}_d_${dateStr}_t_${timeStr}_${randomStr}.csv`;
    const csvPath = path.join(tempFolder, csvFilename);

    await insertUUIDsBatch(uuids);

    const csvWriter = createCsvWriter({
        path: csvPath,
        header: [
            { id: "full", title: "Full UUID" },
            { id: "first8", title: "First 8 Chars" },
            { id: "first3", title: "First 3 Chars" }
        ]
    });

    const csvData = uuids.map((uuid) => ({
        full: uuid,
        first8: uuid.substring(0, 8),
        first3: uuid.substring(0, 3)
    }));

    await csvWriter.writeRecords(csvData);
    res.json({ downloadUrl: `/download-file/${csvFilename}` });
});

// --- Serve CSV File & Delete after download ---
app.get("/download-file/:filename", (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(tempFolder, filename);
    res.download(filePath, filename, (err) => {
        if (err) {
            console.error("❌ Error sending file:", err);
        } else {
            fs.unlink(filePath, (err) => {
                if (err) console.error("❌ Error deleting file:", err);
            });
        }
    });
});

// --- Database Info Route ---
app.get("/db-info", (req, res) => {
    db.get("SELECT COUNT(*) AS count FROM uuids", [], (err, row) => {
        if (err) {
            console.error("❌ Error fetching UUID count:", err);
            return res.status(500).json({ error: "Error fetching database info." });
        }
        res.json({ count: row.count });
    });
});

// --- Get Last UUID Route ---
app.get("/last-uuid", (req, res) => {
    db.get("SELECT id, date, time FROM uuids ORDER BY ROWID DESC LIMIT 1", [], (err, row) => {
        if (err) {
            console.error("❌ Error fetching last UUID:", err);
            return res.status(500).json({ error: "Error fetching last UUID." });
        }
        if (row) {
            res.json({ uuid: row.id, date: row.date, time: row.time });
        } else {
            res.json({ uuid: null });
        }
    });
});

// --- Search UUID Route ---
app.get("/search-by-uuid", (req, res) => {
    const { uuid } = req.query;
    if (!uuid) {
        return res.status(400).json({ error: "❌ UUID parameter is required." });
    }
    db.get("SELECT id, date, time FROM uuids WHERE LOWER(id) = LOWER(?)", [uuid], (err, row) => {
        if (err) {
            console.error("❌ Error searching UUID:", err);
            return res.status(500).json({ error: "Error searching UUID." });
        }
        if (row) {
            res.json({ uuid: row.id, date: row.date, time: row.time });
        } else {
            res.json({ uuid: null });
        }
    });
});

// --- Login Route ---
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ error: "Database error" });
        if (!user) return res.status(401).json({ error: "Invalid username or password" });
        bcrypt.compare(password, user.password, (err, match) => {
            if (err) return res.status(500).json({ error: "Error validating password" });
            if (!match) return res.status(401).json({ error: "Invalid username or password" });
            req.session.user = { id: user.id, username: user.username };
            res.json({ success: true });
        });
    });
});

// --- Logout Route ---
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login.html");
});

// --- Protected Route ---
app.get("/protected", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    res.json({ message: "User is authenticated", user: req.session.user });
});

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
