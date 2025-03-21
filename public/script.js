document.addEventListener("DOMContentLoaded", () => {
    const generateBtn = document.getElementById("generateBtn");
    const downloadBtn = document.getElementById("downloadBtn");
    const numUUIDsInput = document.getElementById("numUUIDs");
    const loadingIndicator = document.getElementById("loading");
    const downloadLoadingIndicator = document.getElementById("downloadLoading");
    const statusDiv = document.getElementById("status");
    const logoutBtn = document.getElementById("logoutBtn");

    let generatedUUIDs = [];
    let countdownIntervalId; // To store the countdown interval

    // Reset page to its initial state
    function resetPage() {
        generatedUUIDs = [];
        downloadBtn.disabled = true;
        numUUIDsInput.value = 100;
        statusDiv.innerText = "";
        loadingIndicator.style.display = "none";
        downloadLoadingIndicator.style.display = "none";
        document.getElementById("updateStatus").innerText = "";
        document.getElementById("countdownTimer").innerText = "";
        if (countdownIntervalId) {
            clearInterval(countdownIntervalId);
        }
    }
    resetPage();

    // Generate UUIDs
    generateBtn.addEventListener("click", async () => {
        let numUUIDs = parseInt(numUUIDsInput.value);
        if (isNaN(numUUIDs) || numUUIDs <= 0) {
            alert("❌ Please enter a valid number.");
            return;
        }
        if (numUUIDs > 100000) {
            alert("⚠️ Maximum limit is 100,000 UUIDs. Please enter a smaller number.");
            return;
        }

        downloadBtn.disabled = true;
        loadingIndicator.style.display = "flex";
        statusDiv.innerText = "";

        try {
            const response = await fetch("/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ numUUIDs })
            });
            const data = await response.json();
            generatedUUIDs = data.uuids;
            loadingIndicator.style.display = "none";
            downloadBtn.disabled = false;
            statusDiv.innerText = `✅ Generated ${generatedUUIDs.length} UUIDs! Ready to download.`;
        } catch (error) {
            loadingIndicator.style.display = "none";
            statusDiv.innerText = "❌ Error generating UUIDs.";
        }
    });

    // Function to start countdown and update remaining UUIDs
    function startCountdown(expectedTotal) {
        let countdown = 20;
        // Clear any previous interval if exists
        if (countdownIntervalId) {
            clearInterval(countdownIntervalId);
        }
        countdownIntervalId = setInterval(async () => {
            document.getElementById("countdownTimer").innerText = `Next update in ${countdown} seconds`;
            
            if (countdown === 0) {
                try {
                    const res = await fetch("/db-info");
                    const data = await res.json();
                    const currentCount = parseInt(data.count) || 0;
                    const remaining = expectedTotal - currentCount;
                    document.getElementById("updateStatus").innerText = `Remaining UUIDs: ${remaining}`;
                } catch (error) {
                    console.error("Error updating UUID count:", error);
                }
                countdown = 20; // reset countdown
            } else {
                countdown--;
            }
        }, 1000);
    }

    // Download UUIDs
    downloadBtn.addEventListener("click", async () => {
        if (downloadBtn.disabled) return;
        statusDiv.innerText = "";
        downloadLoadingIndicator.style.display = "flex";

        // Get the snapshot of the current UUID count before new ones are added.
        let snapshotCount = 0;
        try {
            const snapshotResponse = await fetch("/db-info");
            const snapshotData = await snapshotResponse.json();
            snapshotCount = parseInt(snapshotData.count) || 0;
        } catch (error) {
            console.error("Error fetching snapshot count:", error);
        }
        
        // Get the number of UUIDs to be generated from the input
        const numUUIDs = parseInt(numUUIDsInput.value);
        // Calculate the expected total after the new batch is inserted.
        const expectedTotal = snapshotCount + numUUIDs;
        
        // Immediate update: Show the number that will be generated (i.e. expectedTotal - snapshotCount)
        document.getElementById("updateStatus").innerText = `Remaining UUIDs: ${expectedTotal - snapshotCount}`;
        
        // Start the countdown display that updates remaining UUIDs every 20 seconds
        startCountdown(expectedTotal);

        try {
            const response = await fetch("/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ uuids: generatedUUIDs })
            });
            if (response.ok) {
                const data = await response.json();
                window.location.href = data.downloadUrl;
                downloadLoadingIndicator.style.display = "none";
                statusDiv.innerText = "✅ File is ready for download!";
                setTimeout(() => {
                    resetPage();
                }, 3000);
            } else {
                throw new Error("Download failed");
            }
        } catch (error) {
            downloadLoadingIndicator.style.display = "none";
            alert("❌ Error downloading file.");
        }
    });

    // Get total UUID count
    document.getElementById("getTotalBtn").addEventListener("click", async () => {
        const response = await fetch("/db-info");
        const data = await response.json();
        document.getElementById("uuidCount").innerText = data.count || "0";
    });

    // Get last UUID by date
    document.getElementById("getLastUUIDBtn").addEventListener("click", async () => {
        const response = await fetch("/last-uuid");
        const data = await response.json();
        if (data.uuid) {
            document.getElementById("lastUUID").innerText = `${data.uuid} (Added on ${data.date} at ${data.time})`;
        } else {
            document.getElementById("lastUUID").innerText = "❌ No UUIDs found.";
        }
    });

    // Search UUID
    document.getElementById("searchUUIDBtn").addEventListener("click", async () => {
        const uuid = document.getElementById("searchUUID").value.trim();
        if (!uuid) {
            document.getElementById("searchUUIDResult").innerText = "❌ Please enter a UUID.";
            return;
        }
        const response = await fetch(`/search-by-uuid?uuid=${uuid}`);
        const data = await response.json();
        if (data.uuid) {
            document.getElementById("searchUUIDResult").innerText = `✅ Found: UUID=${data.uuid}, Date=${data.date}, Time=${data.time}`;
        } else {
            document.getElementById("searchUUIDResult").innerText = "❌ UUID not found.";
        }
    });

    // Logout handling
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            await fetch("/logout");
            window.location.href = "login.html";
        });
    }
});
