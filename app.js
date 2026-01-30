// --- BIOCHAIN V4 CONFIG ---
let provider, signer, contract;
let userAddress;
const PINATA_API_KEY = PINATA_JWT;

// --- INITIALIZATION ---
window.onload = () => {
    // Setup file drop zone
    setupDropZone();

    // Check wallet (Optional auto-connect)
    if (window.ethereum && window.ethereum.selectedAddress) {
        // connectWallet(); // Auto-connect if desired
    }
}

async function connectWallet() {
    if (!window.ethereum) return showToast("MetaMask not found!", "error");

    try {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = provider.getSigner();
        userAddress = await signer.getAddress();
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        showToast("Connected: " + userAddress.substring(0, 6) + "...");
        document.getElementById("wallet-display").innerText = userAddress.substring(0, 6) + "..." + userAddress.substring(38);

        // AUTH FLOW
        checkUserRole();

    } catch (e) {
        console.error(e);
        showToast("Connection failed", "error");
    }
}

async function checkUserRole() {
    // 1. Check Patient
    try {
        const p = await contract.patients(userAddress);
        if (p.isRegistered) {
            setupDashboard("patient", p);
            return;
        }
    } catch (e) { }

    // 2. Check Doctor
    try {
        const d = await contract.doctors(userAddress);
        if (d.isRegistered) {
            setupDashboard("doctor", d);
            return;
        }
    } catch (e) { }

    // 3. New User
    showScreen('screen-role-select');
}

// --- DASHBOARD SETUP ---
function setupDashboard(role, profile) {
    showScreen('app-dashboard');

    // Set Sidebar Info
    document.getElementById("sidebar-user-name").innerText = profile.name;
    document.getElementById("sidebar-user-role").innerText = role.toUpperCase();
    document.getElementById("sidebar-user-img").src = "https://gateway.pinata.cloud/ipfs/" + profile.profileHash;

    // Populate Widgets
    loadRecentActivity();

    // If Doctor, show My Patients link
    if (role === 'doctor') {
        document.getElementById("nav-patients").classList.remove("hidden");
    } else {
        document.getElementById("nav-patients").classList.add("hidden");
    }
}

// --- NAVIGATION ---
function navTo(viewId) {
    // 1. Hide all views
    document.querySelectorAll('.page-view').forEach(el => el.classList.add('hidden'));

    // 2. Show target
    document.getElementById(viewId).classList.remove('hidden');

    // 3. Update Header Title
    let title = "Dashboard";
    if (viewId === 'view-record') title = "My Medical Record";
    if (viewId === 'view-upload') title = "Upload Data";
    if (viewId === 'view-team') title = "Care Team";
    if (viewId === 'view-patients') title = "My Patients";
    if (viewId === 'view-patients') title = "My Patients";
    if (viewId === 'view-inbox') title = "Inbox";
    if (viewId === 'view-settings') title = "Settings";
    document.getElementById("header-title").innerText = title;

    // 4. Update Active Nav Link Style
    // 4. Update Active Nav Link Style
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const navMap = {
        'view-home': 'nav-link-home',
        'view-record': 'nav-link-record',
        'view-upload': 'nav-link-upload',
        'view-team': 'nav-link-team',
        'view-patients': 'nav-patients',
        'view-inbox': 'nav-link-inbox',
        'view-settings': 'nav-link-settings'
    };

    if (navMap[viewId]) {
        document.getElementById(navMap[viewId]).classList.add('active');
    }

    // 5. Trigger Data Loads
    if (viewId === 'view-record') loadMyRecord();
    if (viewId === 'view-inbox') loadInbox();
    if (viewId === 'view-team') loadCareTeam();
    if (viewId === 'view-patients') loadDoctorPatients();
}

// --- FEATURE: UPLOAD DATA ---
let selectedFile = null;

function setupDropZone() {
    const zone = document.getElementById("drop-zone");
    const input = document.getElementById("up-file");

    zone.onclick = () => input.click();

    input.onchange = () => {
        if (input.files[0]) {
            selectedFile = input.files[0];
            document.getElementById("file-name-display").innerText = "Selected: " + selectedFile.name;
        }
    };

    // Drag effects
    zone.ondragover = (e) => { e.preventDefault(); zone.style.borderColor = "var(--accent-cyan)"; };
    zone.ondragleave = () => { zone.style.borderColor = "var(--glass-border)"; };
    zone.ondrop = (e) => {
        e.preventDefault();
        zone.style.borderColor = "var(--glass-border)";
        if (e.dataTransfer.files[0]) {
            selectedFile = e.dataTransfer.files[0];
            document.getElementById("file-name-display").innerText = "Selected: " + selectedFile.name;
        }
    };
}

// --- UPLOAD FLOW: VALIDATION & CONFIRMATION ---
// --- UPLOAD FLOW: VALIDATION & CONFIRMATION ---
let pendingUploadData = null;
let editingFileHash = null; // Store hash when editing

async function initiateUpload() {
    const summary = document.getElementById("up-summary").value;
    const notes = document.getElementById("up-notes").value;
    const vitals = document.getElementById("up-vitals").value;
    const date = document.getElementById("up-date").value;

    // 1. Validation
    if (!summary.trim() || !notes.trim()) {
        showToast("Summary and Notes cannot be empty.", "error");
        return;
    }

    // 2. Store Data temporarilly
    pendingUploadData = { summary, notes, vitals, date, timestamp: Date.now() };

    // 3. Show Confirmation Modal
    document.getElementById("confirm-summary").innerText = summary;
    document.getElementById("confirm-notes").innerText = notes.substring(0, 50) + (notes.length > 50 ? "..." : "");
    document.getElementById("confirm-file").innerText = selectedFile ? selectedFile.name : "No file selected";

    document.getElementById("modal-confirm-upload").classList.remove("hidden");
}

async function confirmUpload() {
    closeModalAll();
    if (!pendingUploadData) return;

    const { summary, notes, vitals, date } = pendingUploadData;

    try {
        let fileHash = "";

        if (selectedFile) {
            showToast("Encrypting & Uploading File...", "info");
            fileHash = await uploadToPinata(selectedFile);
        } else if (editingFileHash) {
            // Keep previous file if editing and no new file selected
            fileHash = editingFileHash;
        }

        const metadata = {
            date: date || new Date().toISOString(),
            summary: summary,
            doctorNotes: notes,
            vitals: vitals,
            fileCID: fileHash,
            timestamp: Date.now()
        };

        showToast("Uploading Metadata...", "info");
        const blob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
        const metaHash = await uploadToPinata(new File([blob], "record.json"));

        showToast("Waiting for Blockchain Confirmation...", "info");
        const tx = await contract.uploadRecord(metaHash);
        showToast("Transaction sent! Waiting for block...", "info");
        await tx.wait();

        showToast("Record Uploaded Successfully!");
        navTo('view-record');
        pendingUploadData = null; // Clear

    } catch (e) {
        showToast("Upload Failed: " + e.message, "error");
        console.error(e);
    }
}


// --- DATA LOADING ---
async function loadMyRecord() {
    const container = document.getElementById("record-display-area");
    container.innerHTML = "<p>Loading blockchain record...</p>";
    try {
        const hash = await contract.viewMyRecord(); // Using Contract V3 function
        if (!hash) {
            container.innerHTML = "<p>No records found.</p>";
            return;
        }
        const data = await fetchIPFS(hash);


        // Show summary card on page
        // Sanitize data string for onClick
        const dataStr = JSON.stringify(data).replace(/'/g, "&#39;").replace(/"/g, "&quot;");

        // Show summary card on page
        container.innerHTML = `
            <div class="glass-row">
                <div class="info-col">
                    <strong>📄 Latest Medical Record</strong>
                    <small>${new Date(data.timestamp || Date.now()).toLocaleDateString()} | ${data.summary || 'Record'}</small>
                </div>
                <div class="action-row" style="display:flex; gap:10px; margin-top:10px;">
                    <button class="btn-primary" onclick='showRecordModal(${dataStr})'>View Full</button>
                    <button class="btn-secondary" onclick='editRecord(${dataStr})'>✏️ Edit</button>
                    <button class="btn-danger" onclick='deleteRecord()'>🗑️ Delete</button>
                </div>
            </div>
        `;
    } catch (e) {
        container.innerHTML = "<p>Error loading record.</p>";
    }
}

// --- EDIT / DELETE LOGIC ---
function editRecord(data) {
    // Populate Upload Form
    document.getElementById("up-summary").value = data.summary || "";
    document.getElementById("up-notes").value = data.doctorNotes || data.notes || "";
    document.getElementById("up-vitals").value = data.vitals || "";

    // Store existing hash to preserve it
    editingFileHash = data.fileCID || data.fileHash || "";

    // Switch to Upload View
    navTo('view-upload');
    showToast("Data loaded for editing.", "info");
}

async function deleteAccount() {
    if (!confirm("⚠️ DANGER: Are you sure you want to DELETE your account? This will erase your identity from the platform.")) return;

    try {
        showToast("Processing Account Deletion...", "info");
        const tx = await contract.deleteAccount();
        await tx.wait();

        showToast("Account Deleted. Goodbye.");
        setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
        showToast("Delete Failed: " + e.message, "error");
    }
}

async function deleteRecord() {
    if (!confirm("Are you sure you want to delete this record? This will remove it from the doctor's view.")) return;

    try {
        showToast("Sending Delete Transaction...", "info");
        const tx = await contract.uploadRecord(""); // Using empty string to clear
        await tx.wait();

        showToast("Record Deleted.", "success");
        loadMyRecord(); // Refresh
    } catch (e) {
        showToast("Delete Failed: " + e.message, "error");
    }
}

// --- HIRE DOCTOR LOGIC ---
function openHireModal() {
    document.getElementById("modal-hire-doctor").classList.remove("hidden");
    document.getElementById("hire-addr").value = "";
    document.getElementById("hire-doc-preview").classList.add("hidden");
    document.getElementById("btn-confirm-hire").classList.add("hidden");
}

let foundDoc = null;

async function checkDoctorProfile() {
    const addr = document.getElementById("hire-addr").value;
    const preview = document.getElementById("hire-doc-preview");

    if (addr.length !== 42 || !addr.startsWith("0x")) {
        preview.classList.add("hidden");
        return;
    }

    try {
        const doc = await contract.doctors(addr);
        if (doc.isRegistered) {
            foundDoc = { ...doc, address: addr };
            preview.innerHTML = `
                <div class="info-col">
                    <strong>✅ ${doc.name}</strong>
                    <small>${doc.hospital}</small>
                </div>
            `;
            preview.classList.remove("hidden");
            document.getElementById("btn-confirm-hire").classList.remove("hidden");
        } else {
            preview.innerHTML = "<small class='color-red'>Address is not a registered doctor.</small>";
            preview.classList.remove("hidden");
            document.getElementById("btn-confirm-hire").classList.add("hidden");
        }
    } catch (e) { console.error(e); }
}

async function confirmManualHire() {
    if (!foundDoc) return;
    try {
        showToast("Hiring Doctor... Please confirm in MetaMask.", "info");
        const tx = await contract.hireDoctor(foundDoc.address);
        await tx.wait();
        showToast("Doctor Hired Successfully!");
        closeModalAll();
        loadCareTeam();
    } catch (e) {
        showToast("Error Hiring: " + e.message, "error");
    }
}

// --- CARE TEAM LOGIC --- (Existing)
function toggleFamilyForm() {
    // document.getElementById("family-form").classList.toggle("hidden");
    showToast("Feature coming soon!", "info");
}

async function loadCareTeam() {
    const docList = document.getElementById("care-doctors-list");
    const famList = document.getElementById("care-family-list");

    // 1. Load Authorized Doctors (Via Treatment History)
    try {
        // contract.getTreatmentHistory returns a struct array
        const history = await contract.getTreatmentHistory(userAddress);
        const activeDocs = history.filter(h => h.isActive);

        if (activeDocs.length === 0) {
            docList.innerHTML = "<p class='text-muted'>No active doctors found.</p>";
        } else {
            docList.innerHTML = "";
            for (const doc of activeDocs) {
                // Fetch full profile for more info
                // const fullProfile = await contract.doctors(doc.doctorAddress); 
                // Optimization: Just pass address to viewProfile, no need to fetch all upfront

                const div = document.createElement("div");
                div.className = "list-item glass-row";
                div.innerHTML = `
                    <div class="info-col">
                        <strong>👨⚕️ ${doc.doctorName || 'Doctor'}</strong>
                        <small>${doc.doctorAddress.substring(0, 6)}...${doc.doctorAddress.substring(38)}</small>
                    </div>
                    <div class="action-row" style="display:flex; gap:5px;">
                        <button class="btn-secondary btn-small" onclick="viewDoctorProfile('${doc.doctorAddress}')">Info</button>
                        <button class="btn-danger btn-small" onclick="fireDoctor('${doc.doctorAddress}')">Revoke</button>
                    </div>
                `;
                docList.appendChild(div);
            }
        }
    } catch (e) {
        console.error("Doc Load Error", e);
        docList.innerHTML = "<p class='error-text'>Error loading doctors (Check Console).</p>";
    }

    // 2. Family Section (Placeholder)
    famList.innerHTML = "<p class='text-muted'>Family Access Module is under development.</p>";
}

// ... remove addFamily/removeFamily functions as they will fail ...

async function viewDoctorProfile(addr) {
    try {
        const d = await contract.doctors(addr);
        document.getElementById("info-doc-name").innerText = d.name;
        document.getElementById("info-doc-hosp").innerText = d.hospital;
        document.getElementById("info-doc-cont").innerText = d.contact;
        document.getElementById("info-doc-addr").innerText = addr;

        document.getElementById("modal-doc-info").classList.remove("hidden");
    } catch (e) { showToast("Could not fetch profile", "error"); }
}

async function fireDoctor(docAddr) {
    if (!confirm("⚠️ Are you sure you want to REVOKE access for this doctor? They will no longer see your records.")) return;
    try {
        showToast("Revoking Access...", "info");
        const tx = await contract.fireDoctor(docAddr);
        await tx.wait();
        showToast("Access Revoked Successfully.");
        loadCareTeam();
    } catch (e) { showToast(e.message, "error"); }
}

// --- ACTIVITY LOGIC ---
async function loadRecentActivity() {
    const feed = document.getElementById("activity-feed");
    feed.innerHTML = "<li>Loading blockchain events...</li>";

    try {
        // Query multiple event types
        const f1 = contract.filters.RecordUpdated(userAddress);
        const f2 = contract.filters.AccessGranted(userAddress);
        const f3 = contract.filters.AccessRevoked(userAddress);

        // Fetch parallel
        const [e1, e2, e3] = await Promise.all([
            contract.queryFilter(f1, -10000),
            contract.queryFilter(f2, -10000),
            contract.queryFilter(f3, -10000)
        ]);

        // Merge and Sort by blockNumber (descending)
        const allEvents = [...e1, ...e2, ...e3].sort((a, b) => b.blockNumber - a.blockNumber);

        feed.innerHTML = "";

        if (allEvents.length === 0) {
            feed.innerHTML = "<li>No recent blockchain activity.</li>";
            return;
        }

        // Take top 5 for widget
        for (const ev of allEvents.slice(0, 5)) {
            let msg = "Event";
            let icon = "⚡";

            if (ev.event === "RecordUpdated") { msg = "Medical Record Updated"; icon = "📄"; }
            if (ev.event === "AccessGranted") { msg = "Doctor Hired"; icon = "👨⚕️"; }
            if (ev.event === "AccessRevoked") { msg = "Doctor Revoked"; icon = "🚫"; }

            // Get timestamp (requires block fetch, expensive, so doing lazily or skipping for widget performance)
            // For widget, we'll just show Block Number to keep it fast, or fetch if needed. 
            // Let's try to fetch block for the top 3 at least.

            feed.innerHTML += `
                <li style="margin-bottom: 8px;">
                    <strong style="color:var(--accent-cyan);">${icon} ${msg}</strong><br>
                    <small class="text-muted">Block #${ev.blockNumber}</small>
                </li>`;
        }
    } catch (e) {
        console.warn("Activity Load Error", e);
        feed.innerHTML = "<li>System Ready (No events found)</li>";
    }
}

async function showHistoryModal() {
    document.getElementById("modal-history").classList.remove("hidden");
    const list = document.getElementById("full-history-list");
    list.innerHTML = "<p>Scanning Blockchain...</p>";

    try {
        // Query ALL events from deeper history
        const f1 = contract.filters.RecordUpdated(userAddress);
        const f2 = contract.filters.AccessGranted(userAddress);
        const f3 = contract.filters.AccessRevoked(userAddress);

        const [e1, e2, e3] = await Promise.all([
            contract.queryFilter(f1, -50000), // Deeper scan
            contract.queryFilter(f2, -50000),
            contract.queryFilter(f3, -50000)
        ]);

        const allEvents = [...e1, ...e2, ...e3].sort((a, b) => b.blockNumber - a.blockNumber);

        if (allEvents.length === 0) {
            list.innerHTML = "<p>No history found.</p>";
            return;
        }

        list.innerHTML = "";

        // For full history, we MUST show dates, so we fetch blocks
        // Be careful with rate limits if too many events
        for (const ev of allEvents) {
            const block = await ev.getBlock();
            const date = new Date(block.timestamp * 1000).toLocaleString();

            let msg = ev.event;
            let color = "white";

            if (ev.event === "RecordUpdated") { msg = "Uploaded New Record"; color = "#0ff"; }
            if (ev.event === "AccessGranted") { msg = `Hired Doctor (${ev.args.doctor.substring(0, 6)}...)`; color = "#0f0"; }
            if (ev.event === "AccessRevoked") { msg = `Fired Doctor (${ev.args.doctor.substring(0, 6)}...)`; color = "#f00"; }

            const item = document.createElement("div");
            item.className = "glass-row";
            item.style.marginBottom = "10px";
            item.innerHTML = `
                <div style="display:flex; justify-content:space-between;">
                    <strong style="color:${color}">${msg}</strong>
                    <small>${date}</small>
                </div>
                <small class="text-muted">Block: ${ev.blockNumber} | Tx: ${ev.transactionHash.substring(0, 10)}...</small>
            `;
            list.appendChild(item);
        }

    } catch (e) {
        console.error(e);
        list.innerHTML = "<p class='error-text'>Error loading history.</p>";
    }
}

// --- DOCTOR PORTAL LOGIC ---

async function loadDoctorPatients() {
    const list = document.getElementById("patients-list");
    list.innerHTML = "<p>Loading patients...</p>";

    try {
        const rawPatients = await contract.getMyPatients();
        // Deduplicate using Set
        const uniquePatients = [...new Set(rawPatients)];

        if (uniquePatients.length === 0) {
            list.innerHTML = "<p class='text-muted'>No patients assigned yet.</p>";
            return;
        }

        list.innerHTML = "";
        for (const pAddr of uniquePatients) {
            const pInfo = await contract.patients(pAddr);
            const div = document.createElement("div");
            div.className = "list-item glass-row";
            div.innerHTML = `
                <div class="info-col">
                    <strong>🏥 ${pInfo.name || 'Patient'}</strong>
                    <small>Age: ${pInfo.age || 'N/A'} | ${pAddr.substring(0, 6)}...</small>
                </div>
                <button class="btn-primary btn-small" onclick="viewPatientRecord('${pAddr}')">View Record</button>
            `;
            list.appendChild(div);
        }

    } catch (e) {
        console.error(e);
        list.innerHTML = "<p class='error-text'>Failed to load patients.</p>";
    }
}

// --- SHARED: SHOW RECORD MODAL ---
function showRecordModal(data) {
    const modal = document.getElementById("modal-view-record");
    const content = document.getElementById("record-modal-content");

    // Normalize data keys (handle both myRecord structure and patientRecord structure if different)
    // uploadRecord uses: summary, doctorNotes, vitals, fileCID, date/timestamp
    // viewPatientRecord might have different structure? Let's assume standardization.
    // If coming from IPFS standard created in uploadRecord:
    const notes = data.doctorNotes || data.notes || "No notes available.";
    const summary = data.summary || "Medical Record";
    const dateStr = new Date(data.date || data.timestamp || Date.now()).toLocaleString();
    const fileHash = data.fileCID || data.fileHash;

    content.innerHTML = `
        <div class="medical-report-card" style="border:none; box-shadow:none; padding:0;">
            <div class="report-header">
                <div class="report-title"><i class="fas fa-file-medical-alt"></i> Medical Report</div>
                <span class="report-meta">${dateStr}</span>
            </div>

            <div class="report-section">
                <span class="report-label">Diagnosis / Summary</span>
                <div class="report-value">${summary}</div>
            </div>

            <div class="report-section">
                <span class="report-label">Detailed Notes</span>
                <div class="report-value" style="white-space: pre-wrap;">${notes}</div>
            </div>

            <div class="report-section">
                <span class="report-label">Vitals / Other Info</span>
                <div class="report-value">${data.vitals || 'N/A'}</div>
            </div>

            ${fileHash ? `
            <div class="report-section">
                <span class="report-label">Attachments</span>
                <div class="attachment-box">
                    <i class="fas fa-paperclip color-cyan"></i>
                    <span>Medical_Attachment</span>
                    <a href="https://gateway.pinata.cloud/ipfs/${fileHash}" target="_blank" class="btn-download" style="margin-left: auto;">
                        <i class="fas fa-download"></i> Open
                    </a>
                </div>
            </div>` : ''}
        </div>
    `;

    modal.classList.remove("hidden");
}

function printReport() {
    window.print();
    // In a real app, generate PDF via library
}

// Update ViewPatientRecord to use Modal
async function viewPatientRecord(pAddr) {
    showToast("Fetching Patient Record...", "info");
    try {
        const ipfsHash = await contract.callStatic.accessPatientRecord(pAddr);
        if (!ipfsHash) return showToast("No records found.", "error");

        const url = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
        const res = await fetch(url);
        const data = await res.json();

        showRecordModal(data);

    } catch (e) {
        showToast("Access Denied or Error.", "error");
        console.error(e);
    }
}

function closePatientDetail() {
    document.getElementById("patient-detail-view").classList.add("hidden");
}

// --- REGISTRATION ---
function showRegistration(role) {
    if (role === 'patient') document.getElementById("modal-reg-patient").classList.remove("hidden");
    if (role === 'doctor') document.getElementById("modal-reg-doctor").classList.remove("hidden");
}

function closeModalAll() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.add("hidden"));
}

async function registerPatient() {
    const name = document.getElementById("reg-p-name").value;
    const age = document.getElementById("reg-p-age").value;
    const photo = document.getElementById("reg-p-photo").files[0];

    if (!name || !age || !photo) return showToast("Fill all fields", "error");

    try {
        const hash = await uploadToPinata(photo);
        const tx = await contract.registerPatient(name, age, hash);
        await tx.wait();
        showToast("Registered! Reloading...");
        setTimeout(() => location.reload(), 2000);
    } catch (e) { showToast(e.message, "error"); }
}

async function registerDoctor() {
    const name = document.getElementById("reg-d-name").value;
    const hosp = document.getElementById("reg-d-hosp").value;
    const cont = document.getElementById("reg-d-cont").value;
    const photo = document.getElementById("reg-d-photo").files[0];

    if (!name || !photo) return showToast("Fill all fields", "error");

    try {
        const hash = await uploadToPinata(photo);
        const tx = await contract.registerDoctor(name, hosp, cont, hash);
        await tx.wait();
        showToast("Registered! Reloading...");
        setTimeout(() => location.reload(), 2000);
    } catch (e) { showToast(e.message, "error"); }
}


// --- UTILS ---
function showScreen(id) {
    document.querySelectorAll('section, .dashboard-container').forEach(el => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    if (id === 'screen-login' || id === 'screen-role-select') {
        document.getElementById(id).classList.add('active'); // Ensure flex display
    }
}

function showToast(msg, type = "success") {
    const box = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerText = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

async function uploadToPinata(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pinataOptions', JSON.stringify({ cidVersion: 0 }));

    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: { Authorization: `Bearer ${PINATA_API_KEY}` },
        body: formData
    });
    return (await res.json()).IpfsHash;
}

// --- SEARCH & FILTER LOGIC ---
function filterList(inputId, listId) {
    const filter = document.getElementById(inputId).value.toLowerCase();
    const list = document.getElementById(listId);
    const items = list.getElementsByClassName("list-item");
    let hasVisible = false;

    // Remove any existing "No match" message
    const existingMsg = document.getElementById(listId + "-no-match");
    if (existingMsg) existingMsg.remove();

    for (let i = 0; i < items.length; i++) {
        const textToSearch = items[i].innerText.toLowerCase();
        if (textToSearch.includes(filter)) {
            items[i].classList.remove("hidden");
            hasVisible = true;
        } else {
            items[i].classList.add("hidden");
        }
    }

    // Show "No match found" if empty
    if (!hasVisible && filter !== "") {
        const msg = document.createElement("p");
        msg.id = listId + "-no-match";
        msg.className = "text-muted text-center mt-10";
        msg.innerText = "No match found.";
        list.appendChild(msg);
    }
}

async function lookupPatient() {
    const addr = document.getElementById("lookup-new-patient").value;
    const resultDiv = document.getElementById("lookup-result");

    if (!ethers.utils.isAddress(addr)) return showToast("Invalid Wallet Address", "error");

    resultDiv.innerHTML = "Checking...";
    resultDiv.classList.remove("hidden");

    try {
        const pInfo = await contract.patients(addr);
        if (!pInfo.isRegistered) {
            resultDiv.innerHTML = "<p class='text-danger'>Address is not a registered patient.</p>";
            return;
        }

        resultDiv.innerHTML = `
            <div class="glass-row" style="background:rgba(255,255,255,0.1);">
                <div class="info-col">
                    <strong>${pInfo.name}</strong>
                    <small>${pInfo.age} | ${addr.substring(0, 6)}...</small>
                </div>
                <button class="btn-primary btn-small" onclick="viewPatientRecord('${addr}')">View Record</button>
            </div>
        `;

    } catch (e) {
        console.error(e);
        resultDiv.innerHTML = "<p class='error-text'>Lookup failed.</p>";
    }
}

async function fetchIPFS(hash) {
    const res = await fetch(`https://gateway.pinata.cloud/ipfs/${hash}`);
    return await res.json();
}

// --- HAPPY VIBE THEMES ---
const themes = [
    {
        name: "Midnight Blue",
        bg: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
        cyan: "#06b6d4",
        blue: "#3b82f6"
    },
    {
        name: "Cyber Punk",
        bg: "linear-gradient(135deg, #2e022d 0%, #0f172a 100%)",
        cyan: "#d946ef", // Pinkish
        blue: "#8b5cf6"  // Purple
    },
    {
        name: "Deep Forest",
        bg: "linear-gradient(135deg, #022c22 0%, #064e3b 100%)",
        cyan: "#34d399", // Emerald
        blue: "#10b981"
    },
    {
        name: "Sunset Vibes",
        bg: "linear-gradient(135deg, #4c0519 0%, #7f1d1d 100%)",
        cyan: "#fbbf24", // Amber
        blue: "#f87171"  // Red
    },
    {
        name: "Oceanic",
        bg: "linear-gradient(135deg, #0c4a6e 0%, #0369a1 100%)",
        cyan: "#7dd3fc",
        blue: "#38bdf8"
    },
    {
        name: "Royal Velvet",
        bg: "linear-gradient(135deg, #2e1065 0%, #4c1d95 100%)",
        cyan: "#a78bfa",
        blue: "#8b5cf6"
    },
    {
        name: "Charcoal & Gold",
        bg: "linear-gradient(135deg, #18181b 0%, #27272a 100%)",
        cyan: "#facc15",
        blue: "#fbbf24"
    },
    {
        name: "Crimson Night",
        bg: "linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)",
        cyan: "#fca5a5",
        blue: "#f87171"
    },
    {
        name: "Northern Lights",
        bg: "linear-gradient(135deg, #0f172a 0%, #042f2e 100%)",
        cyan: "#2dd4bf",
        blue: "#38bdf8"
    },
    {
        name: "Space Ranger",
        bg: "linear-gradient(135deg, #020617 0%, #172554 100%)",
        cyan: "#93c5fd",
        blue: "#60a5fa"
    }
];

function toggleHappyVibe() {
    const r = Math.floor(Math.random() * themes.length);
    const t = themes[r];

    document.documentElement.style.setProperty('--bg-gradient', t.bg);
    document.documentElement.style.setProperty('--accent-cyan', t.cyan);
    document.documentElement.style.setProperty('--accent-blue', t.blue);

    showToast(`Current Vibe: ${t.name} ✨`);
}