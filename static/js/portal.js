/* static/js/portal.js */

(function () {
    "use strict";

    /* =========================================================
       FIREBASE CONFIG
    ========================================================= */

    const PORTAL_FIREBASE_CONFIG = {
        apiKey: "AIzaSyC8_haFdlIB2l8rNw2LoKn5_N9zaVr9nOs",
        authDomain: "conquercomputers-3736f.firebaseapp.com",
        projectId: "conquercomputers-3736f",
        storageBucket: "conquercomputers-3736f.firebasestorage.app",
        messagingSenderId: "109606671010",
        appId: "1:109606671010:web:f6492869a27ee0cacffdfb"
    };

    const COMPANY_EMAIL = "info@conquercomputers.com";

    /* =========================================================
       FIREBASE INITIALIZATION
    ========================================================= */

    if (typeof firebase === "undefined") {
        alert("Firebase SDK is not loaded. Please check your HTML script links.");
        throw new Error("Firebase SDK is not loaded.");
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(PORTAL_FIREBASE_CONFIG);
    }

    const auth = firebase.auth();
    const db = firebase.firestore();
    const functions = typeof firebase.functions === "function" ? firebase.functions() : null;

    let currentUser = null;
    let currentProfile = null;
    let currentJobCardId = null;
    let currentJobCardOwnerUid = null;
    let generatedJobCardId = null;
    let currentDeliveryNoteId = null;
    let currentFinancialDocumentId = null;
    let currentFinancialDocumentType = "quotation";
    let currentSelectedJobCardData = null;
    let assignableStaffDirectory = [];
    let adminHistoryJobCards = [];
    const JOB_CARD_ID_PREFIX = "Conquer";
    const DELIVERY_ID_PREFIX = "Delivery";
    const FINANCIAL_DOCUMENT_PREFIXES = { quotation: "CQQ", invoice: "CQC" };
    const PORTAL_VIEW = document.body ? String(document.body.dataset.portalView || "") : "";
    const IS_LOGIN_PORTAL_PAGE = PORTAL_VIEW === "login";
    const IS_ADMIN_DASHBOARD_PAGE = PORTAL_VIEW === "admin";
    const IS_JOB_CARD_PORTAL_PAGE = PORTAL_VIEW === "job";

    /* =========================================================
       BASIC HELPERS
    ========================================================= */

    /* =========================================================
       PORTAL LIGHT / DARK THEME
    ========================================================= */

    function getStoredPortalTheme() {
        try {
            const savedTheme = localStorage.getItem("conquer-theme");
            return savedTheme === "light" || savedTheme === "dark" ? savedTheme : "";
        } catch (error) {
            return "";
        }
    }

    function setPortalTheme(theme) {
        const nextTheme = theme === "light" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", nextTheme);

        try {
            localStorage.setItem("conquer-theme", nextTheme);
        } catch (error) {
            // Theme switching still works when storage is unavailable.
        }

        const toggleButtons = document.querySelectorAll(".portal-theme-toggle");
        toggleButtons.forEach(function (button) {
            button.setAttribute("aria-pressed", nextTheme === "light" ? "true" : "false");
            button.setAttribute("title", nextTheme === "dark" ? "Switch to light theme" : "Switch to dark theme");
            button.setAttribute("aria-label", nextTheme === "dark" ? "Switch to light theme" : "Switch to dark theme");
        });

        if (typeof window.trackEvent === "function") {
            window.trackEvent("portal_theme_toggle", { selected_theme: nextTheme });
        }
    }

    function loadPortalTheme() {
        const savedTheme = getStoredPortalTheme();
        const currentTheme = document.documentElement.getAttribute("data-theme");
        setPortalTheme(savedTheme || (currentTheme === "light" ? "light" : "dark"));
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
        setPortalTheme(currentTheme === "dark" ? "light" : "dark");
    }


    function getElement(id) {
        return document.getElementById(id);
    }

    let pdfActionLoaderElement = null;
    let pdfActionLoaderStartedAt = 0;

    function ensurePDFActionLoader() {
        if (pdfActionLoaderElement) {
            return pdfActionLoaderElement;
        }

        const loader = document.createElement("div");
        loader.id = "pdfActionLoader";
        loader.setAttribute("role", "status");
        loader.setAttribute("aria-live", "polite");
        loader.setAttribute("aria-hidden", "true");
        loader.innerHTML = `
            <div class="pdf-action-bg"></div>
            <div class="pdf-action-card">
                <div class="pdf-action-logo">
                    <img src="images/logo.png" alt="Conquer Computers LLC">
                </div>
                <div class="pdf-action-spinner" aria-hidden="true"></div>
                <h3 id="pdfActionTitle">Preparing PDF...</h3>
                <p id="pdfActionText">Please wait while we create the job card.</p>
                <div class="pdf-action-progress" aria-hidden="true"><span></span></div>
            </div>
        `;

        document.body.appendChild(loader);
        pdfActionLoaderElement = loader;
        return loader;
    }

    function updatePDFActionLoader(title, text) {
        const loader = ensurePDFActionLoader();
        const titleElement = loader.querySelector("#pdfActionTitle");
        const textElement = loader.querySelector("#pdfActionText");

        if (titleElement) titleElement.textContent = title || "Processing...";
        if (textElement) textElement.textContent = text || "Please wait. This will only take a moment.";
    }

    function showPDFActionLoader(title, text) {
        const loader = ensurePDFActionLoader();
        updatePDFActionLoader(title, text);
        pdfActionLoaderStartedAt = Date.now();

        loader.style.display = "flex";
        loader.setAttribute("aria-hidden", "false");
        document.body.classList.add("pdf-action-active");

        // Let the overlay paint before canvas/PDF work starts, especially on mobile.
        return new Promise(function (resolve) {
            requestAnimationFrame(function () {
                loader.classList.add("is-visible");
                setTimeout(resolve, 80);
            });
        });
    }

    function hidePDFActionLoader() {
        const loader = pdfActionLoaderElement;
        if (!loader) return Promise.resolve();

        const visibleFor = Date.now() - pdfActionLoaderStartedAt;
        const waitTime = Math.max(0, 450 - visibleFor);

        return new Promise(function (resolve) {
            setTimeout(function () {
                loader.classList.remove("is-visible");
                loader.setAttribute("aria-hidden", "true");
                document.body.classList.remove("pdf-action-active");

                setTimeout(function () {
                    loader.style.display = "none";
                    resolve();
                }, 280);
            }, waitTime);
        });
    }

    function getValue(id) {
        const element = getElement(id);
        return element ? element.value.trim() : "";
    }

    function setValue(id, value) {
        const element = getElement(id);
        if (element) element.value = value || "";
    }

    function setText(id, value) {
        const element = getElement(id);
        if (element) element.innerText = value || "";
    }

    function generateJobCardId() {
        const digits = Math.floor(1000 + Math.random() * 9000);
        return `${JOB_CARD_ID_PREFIX}${digits}`;
    }

    async function createUniqueJobCardId() {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const id = generateJobCardId();
            const existing = await db.collection("jobCards").doc(id).get();

            if (!existing.exists) {
                return id;
            }
        }

        return `${JOB_CARD_ID_PREFIX}${Date.now().toString().slice(-6)}`;
    }

    function getActiveJobCardId() {
        const id = currentJobCardId || generatedJobCardId || getValue("jobId");
        return id && id !== "New" ? id : "";
    }

    function ensureJobCardIdForOutput() {
        let id = getActiveJobCardId();

        if (!id) {
            id = generateJobCardId();
            generatedJobCardId = id;
            setValue("jobId", id);
        }

        return id;
    }

    function prepareJobCardForOutput() {
        const id = ensureJobCardIdForOutput();
        const data = getCurrentFormDataForPreview();
        data.jobCardId = id;
        updatePDFPreview(data);
        return data;
    }

    function showMessage(id, message) {
        const element = getElement(id);
        if (element) element.innerText = message || "";
    }


    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
    }

    function normalizeAccountProfile(user, data) {
        const profile = data || {};
        const role = ["admin", "staff", "client"].includes(profile.role) ? profile.role : "client";
        const explicitStatus = String(profile.accountStatus || "").toLowerCase();
        let accountStatus = explicitStatus;

        if (!accountStatus) {
            accountStatus = profile.active === false || profile.allowed === false ? "pending" : "active";
        }

        const active = accountStatus === "active" && profile.active !== false;
        const allowed = active && profile.allowed !== false;
        const portalAccess = Object.assign({
            jobCard: true,
            delivery: false,
            complaint: false
        }, profile.portalAccess || {});

        return {
            uid: user ? user.uid : "",
            email: profile.email || (user ? user.email : ""),
            name: profile.name || (user && user.email ? user.email.split("@")[0] : "Client"),
            role: role,
            accountStatus: accountStatus,
            active: active,
            allowed: allowed,
            portalAccess: portalAccess
        };
    }

    function isAdminProfile() {
        return !!(currentProfile && currentProfile.role === "admin" && currentProfile.allowed);
    }

    function isClientProfile() {
        return !!(currentProfile && ["client", "staff"].includes(currentProfile.role) && currentProfile.allowed);
    }

    function isClientPortalAllowed(tab) {
        if (!isClientProfile()) return false;
        if (tab === "job") return currentProfile.portalAccess.jobCard !== false;
        if (tab === "delivery") return currentProfile.portalAccess.delivery === true;
        if (tab === "complaint") return currentProfile.portalAccess.complaint === true;
        return false;
    }

    function setVisible(id, isVisible, displayMode) {
        const element = getElement(id);
        if (!element) return;
        element.style.display = isVisible ? (displayMode || "block") : "none";
    }


    function redirectPortal(path) {
        const current = (window.location.pathname.split("/").pop() || "").toLowerCase();
        if (current !== String(path || "").toLowerCase()) {
            window.location.replace(path);
        }
    }

    function activatePortalShell(shellId, displayMode) {
        setVisible("portalGate", false);
        setVisible(shellId, true, displayMode || "grid");
    }

    function updateProfileSummary() {
        if (!currentProfile) return;
        const name = currentProfile.name || currentProfile.email || "Portal User";
        const email = currentProfile.email || (currentUser ? currentUser.email : "") || "—";
        const role = currentProfile.role || "client";
        const status = currentProfile.accountStatus || "active";
        setText("clientName", name);
        setText("dashboardProfileName", name);
        setText("dashboardProfileEmail", email);
        setText("profileSummaryName", name);
        setText("profileSummaryEmail", email);
        setText("profileSummaryRole", role.charAt(0).toUpperCase() + role.slice(1));
        setText("profileSummaryStatus", status.charAt(0).toUpperCase() + status.slice(1));
    }

    function switchAdminWorkspacePanel(panel) {
        const target = panel || "overview";
        document.querySelectorAll("[data-admin-panel]").forEach(function (section) {
            section.classList.toggle("active", section.dataset.adminPanel === target);
        });
        document.querySelectorAll("[data-admin-nav]").forEach(function (button) {
            button.classList.toggle("active", button.dataset.adminNav === target);
        });
    }

    function switchJobWorkspacePanel(panel) {
        const target = panel || "jobcards";
        document.querySelectorAll("[data-job-panel]").forEach(function (section) {
            section.classList.toggle("active", section.dataset.jobPanel === target);
        });
        document.querySelectorAll("[data-job-nav]").forEach(function (button) {
            button.classList.toggle("active", button.dataset.jobNav === target);
        });
    }

    function applyPortalAccessVisibility() {
        document.querySelectorAll("[data-portal-feature]").forEach(function (button) {
            const feature = button.dataset.portalFeature;
            const enabled = isClientPortalAllowed(feature);
            button.style.display = enabled ? "" : "none";
        });
        document.querySelectorAll("[data-portal-feature-panel]").forEach(function (panel) {
            const feature = panel.dataset.portalFeaturePanel;
            if (!isClientPortalAllowed(feature)) {
                panel.classList.remove("active");
            }
        });
    }

    function showPortalAccessMessage(message) {
        showMessage("authMessage", message || "");
    }

    function clearPortalState() {
        currentJobCardId = null;
        currentJobCardOwnerUid = null;
        generatedJobCardId = null;
        currentDeliveryNoteId = null;
        currentFinancialDocumentId = null;
        currentFinancialDocumentType = "quotation";
        currentSelectedJobCardData = null;
        currentProfile = null;
    }

    function updateAuthButtons(user) {
        const isLoggedIn = !!user;
        const text = isLoggedIn ? "Logout" : "Login";
        const aria = isLoggedIn ? "Logout" : "Login";

        ["headerAuthText", "mobileAuthText"].forEach(function (id) {
            setText(id, text);
        });

        ["headerAuthButton", "mobileAuthButton"].forEach(function (id) {
            const button = getElement(id);
            if (!button) return;

            button.setAttribute("aria-label", aria);
            button.classList.toggle("is-logout", isLoggedIn);
        });
    }

    function handleHeaderAuthClick(event) {
        stopButtonDefault(event);

        if (currentUser) {
            logoutUser(event);
            return;
        }

        if (typeof window.navigate === "function") {
            window.navigate("login");
        } else {
            window.location.hash = "login";
        }
    }

    function timestampToMillis(value) {
        if (!value) return 0;

        if (typeof value.toMillis === "function") {
            return value.toMillis();
        }

        if (typeof value.seconds === "number") {
            return value.seconds * 1000;
        }

        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    function getErrorMessage(error) {
        if (!error) return "Something went wrong.";

        if (error.code === "auth/api-key-not-valid") {
            return "Firebase API key is not valid. Please update Firebase config.";
        }

        if (error.code === "auth/email-already-in-use") {
            return "This email is already registered. Please login instead.";
        }

        if (error.code === "auth/invalid-email") {
            return "Please enter a valid email address.";
        }

        if (error.code === "auth/user-not-found") {
            return "No account found with this email. Please signup first.";
        }

        if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
            return "Incorrect email or password.";
        }

        if (error.code === "auth/weak-password") {
            return "Password should be at least 6 characters.";
        }

        if (error.code === "permission-denied") {
            return "Permission denied. Please check Firestore rules.";
        }

        if (error.code === "functions/not-found") {
            return "PDF email service is not available. Please check job-pdf-email-handler.php on cPanel.";
        }

        if (error.message && error.message.includes("requires an index")) {
            return "Firestore index is required. This updated code removes the index requirement. Upload this file and clear browser cache.";
        }

        return error.message || "Something went wrong.";
    }

    function stopButtonDefault(event) {
        if (!event) return null;

        if (typeof event.preventDefault === "function") {
            event.preventDefault();
        }

        if (typeof event.stopPropagation === "function") {
            event.stopPropagation();
        }

        return event.currentTarget || event.target || null;
    }

    function rememberScrollPosition() {
        return {
            x: window.scrollX || window.pageXOffset || 0,
            y: window.scrollY || window.pageYOffset || 0
        };
    }

    function restoreScrollPosition(position) {
        if (!position) return;

        requestAnimationFrame(function () {
            window.scrollTo(position.x, position.y);
        });

        setTimeout(function () {
            window.scrollTo(position.x, position.y);
        }, 250);
    }

    function setButtonBusy(button, isBusy, busyText) {
        if (!button || !button.tagName) return;

        if (isBusy) {
            if (!button.dataset.originalHtml) {
                button.dataset.originalHtml = button.innerHTML;
            }

            button.disabled = true;
            button.setAttribute("aria-busy", "true");
            button.innerHTML = busyText || "Processing...";
            return;
        }

        button.disabled = false;
        button.removeAttribute("aria-busy");

        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
            delete button.dataset.originalHtml;
        }
    }

    function isTouchMobileBrowser() {
        const ua = navigator.userAgent || "";
        const mobileUA = /Android|iPhone|iPad|iPod|Mobile|SamsungBrowser|CriOS|FxiOS|EdgiOS/i.test(ua);
        const smallTouchScreen = window.matchMedia && window.matchMedia("(max-width: 900px)").matches && navigator.maxTouchPoints > 0;
        return mobileUA || smallTouchScreen;
    }

    function isIOSBrowser() {
        const ua = navigator.userAgent || "";
        return /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function createSafeTextElement(tagName, text) {
        const element = document.createElement(tagName);
        element.textContent = text || "";
        return element;
    }

    /* =========================================================
       AUTH STATE / ROLE-BASED PAGE REDIRECTION
    ========================================================= */

    auth.onAuthStateChanged(async function (user) {
        currentUser = user;
        updateAuthButtons(user);

        const authBox = getElement("authBox");
        const portalBox = getElement("portalBox");

        if (!user) {
            if (IS_ADMIN_DASHBOARD_PAGE || IS_JOB_CARD_PORTAL_PAGE) {
                redirectPortal("login.html");
                return;
            }

            if (authBox) authBox.style.display = "block";
            if (portalBox) portalBox.style.display = "none";
            setVisible("clientPortalChooser", false);
            setVisible("adminDashboard", false);
            clearPortalState();
            return;
        }

        if (IS_LOGIN_PORTAL_PAGE && authBox) authBox.style.display = "none";
        if (portalBox && !IS_JOB_CARD_PORTAL_PAGE) portalBox.style.display = "none";
        setVisible("clientPortalChooser", false);
        if (!IS_ADMIN_DASHBOARD_PAGE) setVisible("adminDashboard", false);
        showPortalAccessMessage("");

        try {
            const userRef = db.collection("users").doc(user.uid);
            const userDoc = await userRef.get();

            if (!userDoc.exists) {
                currentProfile = normalizeAccountProfile(user, {
                    email: user.email || "",
                    name: user.email ? user.email.split("@")[0] : "Client",
                    role: "client",
                    accountStatus: "pending",
                    active: false,
                    allowed: false,
                    portalAccess: { jobCard: true, delivery: false, complaint: false }
                });

                try {
                    await userRef.set({
                        name: currentProfile.name,
                        email: currentProfile.email,
                        role: "client",
                        accountStatus: "pending",
                        active: false,
                        allowed: false,
                        portalAccess: currentProfile.portalAccess,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                } catch (createProfileError) {
                    console.warn("User profile auto-create failed:", createProfileError);
                }
            } else {
                currentProfile = normalizeAccountProfile(user, userDoc.data());
            }

            updateProfileSummary();

            if (!currentProfile.allowed || currentProfile.accountStatus !== "active") {
                showPortalAccessMessage("Access denied. Your account is not active yet. Please contact admin.");
                await auth.signOut();
                if (IS_ADMIN_DASHBOARD_PAGE || IS_JOB_CARD_PORTAL_PAGE) redirectPortal("login.html");
                if (authBox) authBox.style.display = "block";
                return;
            }

            if (isAdminProfile()) {
                if (IS_LOGIN_PORTAL_PAGE || IS_JOB_CARD_PORTAL_PAGE) {
                    redirectPortal("admin-dashboard.html");
                    return;
                }

                if (IS_ADMIN_DASHBOARD_PAGE) {
                    activatePortalShell("adminAppShell", "grid");
                    setVisible("adminDashboard", true);
                    switchAdminWorkspacePanel("overview");
                    await loadAdminUsers();
                    await loadAdminJobCards();
                    await loadAdminWorkflowJobCards();
                    await loadAdminSupportQueues();
                    await loadAdminAmcContracts();
                    await loadAdminInventoryItems();
                    await loadAdminCustomerDeviceHistory();
                    await loadFinancialDocuments("quotation");
                    await loadFinancialDocuments("invoice");
                    await loadAdminOverviewMetrics();
                    await loadAdminReportsAndAudit();
                    populateAdminCreateStaffSelect();
                    initialiseFinancialWorkspace();
                    resetAdminCreateJobCardForm();
                }
                return;
            }

            if (isClientProfile()) {
                if (IS_LOGIN_PORTAL_PAGE || IS_ADMIN_DASHBOARD_PAGE) {
                    redirectPortal("job-card-portal.html");
                    return;
                }

                if (IS_JOB_CARD_PORTAL_PAGE) {
                    activatePortalShell("jobAppShell", "grid");
                    if (portalBox) portalBox.style.display = "block";
                    switchJobWorkspacePanel("jobcards");
                    applyPortalAccessVisibility();
                    await loadJobCards();
                    if (isClientPortalAllowed("complaint")) await loadComplaints();
                    if (isClientPortalAllowed("delivery")) await loadDeliveryNotes();
                    mirrorJobCardList();
                }
                return;
            }

            showPortalAccessMessage("Access denied. Your account role is not permitted. Please contact admin.");
            await auth.signOut();
            if (IS_ADMIN_DASHBOARD_PAGE || IS_JOB_CARD_PORTAL_PAGE) redirectPortal("login.html");
            if (authBox) authBox.style.display = "block";
        } catch (error) {
            console.error("Auth loading error:", error);
            showPortalAccessMessage(getErrorMessage(error));
            if (IS_ADMIN_DASHBOARD_PAGE || IS_JOB_CARD_PORTAL_PAGE) {
                redirectPortal("login.html");
                return;
            }
            if (authBox) authBox.style.display = "block";
            if (portalBox) portalBox.style.display = "none";
        }
    });

    /* =========================================================
       SIGNUP
    ========================================================= */

    async function signupUser(event) {
        stopButtonDefault(event);

        const email = getValue("authEmail");
        const password = getValue("authPassword");
        const typedName = getValue("authName");
        const name = typedName || (email ? email.split("@")[0] : "Client");

        showMessage("authMessage", "");

        if (!email || !password) {
            showMessage("authMessage", "Please enter Mail ID and password.");
            return;
        }

        if (!isValidEmail(email)) {
            showMessage("authMessage", "Please enter a valid email address.");
            return;
        }

        try {
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            const result = await auth.createUserWithEmailAndPassword(email, password);

            await db.collection("users").doc(result.user.uid).set({
                name: name,
                email: email,
                role: "client",
                accountStatus: "pending",
                active: false,
                allowed: false,
                portalAccess: {
                    jobCard: true,
                    delivery: false,
                    complaint: false
                },
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            showMessage("authMessage", "Account request saved. Please contact admin for activation before portal access.");
        } catch (error) {
            console.error("Signup error:", error);
            showMessage("authMessage", getErrorMessage(error));
        }
    }

    /* =========================================================
       LOGIN
    ========================================================= */

    async function loginUser(event) {
        stopButtonDefault(event);

        const email = getValue("authEmail");
        const password = getValue("authPassword");

        showMessage("authMessage", "");

        if (!email || !password) {
            showMessage("authMessage", "Please enter Mail ID and password.");
            return;
        }

        if (!isValidEmail(email)) {
            showMessage("authMessage", "Please enter a valid email address.");
            return;
        }

        try {
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            await auth.signInWithEmailAndPassword(email, password);
            showMessage("authMessage", "Login authenticated. Checking your account access...");
        } catch (error) {
            console.error("Login error:", error);
            showMessage("authMessage", getErrorMessage(error));
        }
    }

    /* =========================================================
       LOGOUT
    ========================================================= */

    function logoutUser(event) {
        stopButtonDefault(event);
        showPortalAccessMessage("");
        auth.signOut();
    }

    /* =========================================================
       PORTAL TAB SWITCH
    ========================================================= */

    function getFirstAllowedClientPortal() {
        if (isClientPortalAllowed("job")) return "job";
        return "";
    }

    function switchPortalTab(tab) {
        if (!isClientPortalAllowed(tab)) {
            alert("This portal is not enabled for your account. Please contact admin.");
            return;
        }

        const tabs = document.querySelectorAll(".portal-tab");
        const panels = document.querySelectorAll(".portal-panel");

        tabs.forEach(function (btn) {
            btn.classList.toggle("active", btn.dataset.portalTab === tab);
            btn.hidden = !isClientPortalAllowed(btn.dataset.portalTab || "");
        });

        panels.forEach(function (panel) {
            panel.classList.toggle("active", panel.dataset.portalPanel === tab);
        });
    }

    function openClientPortal(tab) {
        const targetTab = isClientPortalAllowed(tab) ? tab : getFirstAllowedClientPortal();

        if (!targetTab) {
            showPortalAccessMessage("No client portals are currently enabled for this account. Please contact admin.");
            return;
        }

        switchPortalTab(targetTab);

        const portalBox = getElement("portalBox");
        if (portalBox) {
            portalBox.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    /* =========================================================
       SAVE / UPDATE JOB CARD
    ========================================================= */

    async function saveJobCard(event) {
        if (event) event.preventDefault();

        if (!currentUser) {
            alert("Please login first.");
            return;
        }

        if (!isClientPortalAllowed("job")) {
            alert("Job Card Portal is not enabled for this account.");
            return;
        }

        if (currentJobCardId && currentJobCardOwnerUid && currentJobCardOwnerUid !== currentUser.uid && !isAdminProfile()) {
            alert("Assigned job cards are view-only in this portal. Admin can update the master record and workflow.");
            return;
        }

        const previousJobCardId = currentJobCardId;
        let id = currentJobCardId || generatedJobCardId || getValue("jobId");

        if (!id || id === "New") {
            id = await createUniqueJobCardId();
        } else if (!currentJobCardId) {
            const existing = await db.collection("jobCards").doc(id).get();

            if (existing.exists) {
                id = await createUniqueJobCardId();
            }
        }

        currentJobCardId = id;
        generatedJobCardId = null;
        setValue("jobId", id);

        const data = {
            uid: currentUser.uid,
            createdVia: "portal",
            jobCardId: id,
            clientName: getElement("clientName") ? getElement("clientName").innerText : currentUser.email,

            orderDate: getValue("orderDate"),
            deliveryNote: getValue("deliveryNote"),
            estRef: getValue("estRef"),
            customerId: getValue("customerId"),
            despatchDate: getValue("despatchDate"),
            deliveryMethod: getValue("deliveryMethod"),

            clientPhone: getValue("clientPhone"),
            email: getValue("clientEmail") || (currentUser ? currentUser.email : ""),
            clientCompany: getValue("clientCompany"),
            clientAddress: getValue("clientAddress"),

            jobDescription: getValue("jobDescription"),
            workflowStatus: getValue("workflowStatus") || "New",
            jobPriority: getValue("jobPriority") || "Normal",
            jobDueDate: getValue("jobDueDate"),
            assignedStaffUid: "",
            assignedStaffEmail: "",
            assignedStaffName: getValue("assignedStaffName"),
            visitDate: getValue("scheduledVisitDate"),
            visitTime: getValue("scheduledVisitTime"),
            slaResponseBy: "",
            slaResolveBy: "",
            deviceType: getValue("deviceType"),
            deviceBrand: getValue("deviceBrand"),
            deviceModel: getValue("deviceModel"),
            deviceSerialNumber: getValue("deviceSerialNumber"),
            technicianName: getValue("technicianName"),
            checkedBy: getValue("checkedBy"),
            techDate: getValue("techDate"),
            checkedDate: getValue("checkedDate"),

            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (previousJobCardId) {
            // Preserve admin-managed workflow and assignment values from Firestore when staff/users update their own Job Card details.
            // This prevents an older browser state from accidentally removing a fresh admin assignment.
            try {
                const existingJobDoc = await db.collection("jobCards").doc(id).get();
                const existingJobData = existingJobDoc.exists ? (existingJobDoc.data() || {}) : (currentSelectedJobCardData || {});
                data.workflowStatus = existingJobData.workflowStatus || data.workflowStatus || "New";
                data.jobPriority = existingJobData.jobPriority || data.jobPriority || "Normal";
                data.jobDueDate = existingJobData.jobDueDate || data.jobDueDate || "";
                data.assignedStaffUid = existingJobData.assignedStaffUid || "";
                data.assignedStaffEmail = existingJobData.assignedStaffEmail || "";
                data.assignedStaffName = existingJobData.assignedStaffName || data.assignedStaffName || "";
                data.visitDate = existingJobData.visitDate || "";
                data.visitTime = existingJobData.visitTime || "";
                data.slaResponseBy = existingJobData.slaResponseBy || "";
                data.slaResolveBy = existingJobData.slaResolveBy || "";
            } catch (existingJobError) {
                console.warn("Unable to refresh admin-managed workflow values before Job Card save:", existingJobError);
                const fallbackData = currentSelectedJobCardData || {};
                data.workflowStatus = fallbackData.workflowStatus || data.workflowStatus || "New";
                data.jobPriority = fallbackData.jobPriority || data.jobPriority || "Normal";
                data.jobDueDate = fallbackData.jobDueDate || data.jobDueDate || "";
                data.assignedStaffUid = fallbackData.assignedStaffUid || "";
                data.assignedStaffEmail = fallbackData.assignedStaffEmail || "";
                data.assignedStaffName = fallbackData.assignedStaffName || data.assignedStaffName || "";
                data.visitDate = fallbackData.visitDate || "";
                data.visitTime = fallbackData.visitTime || "";
                data.slaResponseBy = fallbackData.slaResponseBy || "";
                data.slaResolveBy = fallbackData.slaResolveBy || "";
            }
        }

        if (!previousJobCardId) {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        }

        try {
            await db.collection("jobCards").doc(id).set(data, { merge: true });

            await syncWebsiteData("job_card", {
                reference: id,
                clientName: data.clientName,
                clientEmail: data.email,
                clientCompany: data.clientCompany,
                clientPhone: data.clientPhone,
                serviceDetails: data.jobDescription,
                status: previousJobCardId ? "Updated" : "Created"
            });

            currentJobCardId = id;
            currentJobCardOwnerUid = data.uid || currentUser.uid;
            currentSelectedJobCardData = Object.assign({}, currentSelectedJobCardData || {}, data);
            setValue("jobId", id);

            updatePDFPreview(data);
            await loadJobCards();
            await writeAuditLog(previousJobCardId ? "job_card_updated" : "job_card_saved", "jobCards", id, `Job card ${id} ${previousJobCardId ? "updated" : "created"} from portal.`, { workflowStatus: data.workflowStatus || "New" });

            alert("Job card saved successfully.");
        } catch (error) {
            console.error("Save job card error:", error);
            alert(getErrorMessage(error));
        }
    }

    /* =========================================================
       LOAD SAVED JOB CARDS
       NOTE:
       No orderBy here, so Firestore composite index is not required.
       Sorting is handled in JavaScript.
    ========================================================= */

    async function loadJobCards() {
        if (!currentUser) return;

        const list = getElement("jobCardList");
        if (!list) return;

        list.innerHTML = "Loading...";

        try {
            const recordMap = new Map();
            const ownSnapshot = await db.collection("jobCards")
                .where("uid", "==", currentUser.uid)
                .get();

            ownSnapshot.forEach(function (doc) {
                recordMap.set(doc.id, { id: doc.id, data: doc.data(), accessLabel: "Created by you" });
            });

            if (currentProfile && currentProfile.role === "staff") {
                const assignedSnapshot = await db.collection("jobCards")
                    .where("assignedStaffUid", "==", currentUser.uid)
                    .get();
                assignedSnapshot.forEach(function (doc) {
                    if (!recordMap.has(doc.id)) {
                        recordMap.set(doc.id, { id: doc.id, data: doc.data(), accessLabel: "Assigned to you" });
                    }
                });
            }

            const cards = Array.from(recordMap.values());
            cards.sort(function (a, b) {
                return timestampToMillis(b.data.updatedAt) - timestampToMillis(a.data.updatedAt);
            });

            list.innerHTML = "";
            if (!cards.length) {
                list.innerHTML = "<p>No job cards saved yet.</p>";
                mirrorJobCardList();
                return;
            }

            cards.forEach(function (card) {
                const data = card.data || {};
                const item = document.createElement("div");
                item.className = "saved-item";
                item.appendChild(createSafeTextElement("strong", data.clientCompany || data.jobCardId || "Job Card"));
                item.appendChild(createSafeTextElement("span", `${data.orderDate || "No Date"} | ${card.id}`));
                item.appendChild(createSafeTextElement("span", `${card.accessLabel} | ${data.workflowStatus || "New"} | ${data.assignedStaffName || "Unassigned"}`));
                item.setAttribute("role", "button");
                item.setAttribute("tabindex", "0");
                item.onclick = function () { openJobCard(card.id, data); switchJobWorkspacePanel("jobcards"); };
                item.onkeydown = function (event) {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openJobCard(card.id, data);
                        switchJobWorkspacePanel("jobcards");
                    }
                };
                list.appendChild(item);
            });
            mirrorJobCardList();
        } catch (error) {
            console.error("Load job cards error:", error);
            list.innerHTML = "<p>Unable to load job cards.</p>";
            alert(getErrorMessage(error));
        }
    }

    /* =========================================================
       OPEN EXISTING JOB CARD
    ========================================================= */

    function openJobCard(id, data) {
        currentJobCardId = id;
        currentJobCardOwnerUid = data && data.uid ? data.uid : (currentUser ? currentUser.uid : "");
        currentSelectedJobCardData = Object.assign({}, data || {});
        generatedJobCardId = null;

        setValue("jobId", id);
        setValue("orderDate", data.orderDate);
        setValue("deliveryNote", data.deliveryNote);
        setValue("estRef", data.estRef);
        setValue("customerId", data.customerId);
        setValue("despatchDate", data.despatchDate);
        setValue("deliveryMethod", data.deliveryMethod);

        setValue("clientPhone", data.clientPhone);
        setValue("clientEmail", data.email || "");
        setValue("clientCompany", data.clientCompany);
        setValue("clientAddress", data.clientAddress);

        setValue("jobDescription", data.jobDescription);
        setValue("workflowStatus", data.workflowStatus || "New");
        setValue("jobPriority", data.jobPriority || "Normal");
        setValue("jobDueDate", data.jobDueDate || "");
        setValue("assignedStaffName", data.assignedStaffName || "Unassigned");
        setValue("scheduledVisitDate", data.visitDate || "");
        setValue("scheduledVisitTime", data.visitTime || "");
        setValue("deviceType", data.deviceType || "");
        setValue("deviceBrand", data.deviceBrand || "");
        setValue("deviceModel", data.deviceModel || "");
        setValue("deviceSerialNumber", data.deviceSerialNumber || "");
        setValue("technicianName", data.technicianName);
        setValue("checkedBy", data.checkedBy);
        setValue("techDate", data.techDate);
        setValue("checkedDate", data.checkedDate);

        updatePDFPreview(data);
    }

    /* =========================================================
       PDF PREVIEW
    ========================================================= */

    function updatePDFPreview(data) {
        setText("pdfJobId", data.jobCardId || getActiveJobCardId() || "New");
        setText("pdfName", data.clientName || (currentUser ? currentUser.email : "[Name]"));
        setText("pdfCompany", data.clientCompany || "[Company Name]");
        setText("pdfAddress", data.clientAddress || "[Invoice / Shipping Address]");
        setText("pdfPhone", data.clientPhone || "[Phone Number]");

        setText("pdfOrderDate", data.orderDate || "");
        setText("pdfDeliveryNote", data.deliveryNote || "");
        setText("pdfEstRef", data.estRef || "");
        setText("pdfCustomerId", data.customerId || "");
        setText("pdfDespatchDate", data.despatchDate || "");
        setText("pdfDeliveryMethod", data.deliveryMethod || "");

        setText("pdfDescription", data.jobDescription || "");
        setText("pdfTechnician", data.technicianName || "");
        setText("pdfCheckedBy", data.checkedBy || "");
        setText("pdfTechDate", data.techDate || "");
        setText("pdfCheckedDate", data.checkedDate || "");
    }

    function getCurrentFormDataForPreview() {
        return {
            jobCardId: getActiveJobCardId() || "New",
            clientName: getElement("clientName") ? getElement("clientName").innerText : "",
            orderDate: getValue("orderDate"),
            deliveryNote: getValue("deliveryNote"),
            estRef: getValue("estRef"),
            customerId: getValue("customerId"),
            despatchDate: getValue("despatchDate"),
            deliveryMethod: getValue("deliveryMethod"),
            clientPhone: getValue("clientPhone"),
            email: getValue("clientEmail") || (currentUser ? currentUser.email : ""),
            clientCompany: getValue("clientCompany"),
            clientAddress: getValue("clientAddress"),
            jobDescription: getValue("jobDescription"),
            workflowStatus: getValue("workflowStatus") || "New",
            jobPriority: getValue("jobPriority") || "Normal",
            jobDueDate: getValue("jobDueDate"),
            assignedStaffName: getValue("assignedStaffName"),
            visitDate: getValue("scheduledVisitDate"),
            visitTime: getValue("scheduledVisitTime"),
            deviceType: getValue("deviceType"),
            deviceBrand: getValue("deviceBrand"),
            deviceModel: getValue("deviceModel"),
            deviceSerialNumber: getValue("deviceSerialNumber"),
            technicianName: getValue("technicianName"),
            checkedBy: getValue("checkedBy"),
            techDate: getValue("techDate"),
            checkedDate: getValue("checkedDate")
        };
    }

    function enableLivePDFPreview() {
        const fields = [
            "jobId",
            "orderDate",
            "deliveryNote",
            "estRef",
            "customerId",
            "despatchDate",
            "deliveryMethod",
            "clientPhone",
            "clientEmail",
            "clientCompany",
            "clientAddress",
            "jobDescription",
            "technicianName",
            "checkedBy",
            "techDate",
            "checkedDate"
        ];

        fields.forEach(function (id) {
            const field = getElement(id);

            if (field) {
                field.addEventListener("input", function () {
                    updatePDFPreview(getCurrentFormDataForPreview());
                });

                field.addEventListener("change", function () {
                    updatePDFPreview(getCurrentFormDataForPreview());
                });
            }
        });
    }

    /* =========================================================
       PDF EXPORT / PRINT - EXACT JOB CARD TEMPLATE
       Uses the same job card UI and scales it to one A4 page.
    ========================================================= */

    const PDF_PAGE_WIDTH = 794;
    const PDF_PAGE_HEIGHT = 1123;
    const JOB_CARD_WIDTH = 900;

    const PDF_EXPORT_CSS = `
        * {
            box-sizing: border-box !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }

        html,
        body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #111111 !important;
            font-family: Arial, Helvetica, sans-serif !important;
        }

        .pdf-export-page {
            width: 794px !important;
            height: 1123px !important;
            background: #ffffff !important;
            color: #111111 !important;
            margin: 0 auto !important;
            padding: 0 !important;
            overflow: hidden !important;
            position: relative !important;
            border: 0 !important;
            box-shadow: none !important;
        }

        #jobCardPDF,
        #jobCardPDFClone {
            width: 900px !important;
            min-height: 1120px !important;
            background: #ffffff !important;
            color: #111111 !important;
            margin: 0 !important;
            padding: 28px !important;
            border: 3px solid #111111 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            font-family: Arial, Helvetica, sans-serif !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            overflow: visible !important;
        }

        #jobCardPDF *,
        #jobCardPDFClone * {
            box-sizing: border-box !important;
            visibility: visible !important;
            opacity: 1 !important;
            filter: none !important;
            text-shadow: none !important;
            color: inherit;
        }

        #jobCardPDF .jc-header,
        #jobCardPDFClone .jc-header {
            display: flex !important;
            align-items: flex-start !important;
            justify-content: center !important;
            gap: 22px !important;
            text-align: center !important;
            border-bottom: 4px double #111111 !important;
            padding-bottom: 22px !important;
        }

        #jobCardPDF .jc-logo img,
        #jobCardPDFClone .jc-logo img {
            width: 90px !important;
            height: 90px !important;
            object-fit: contain !important;
        }

        #jobCardPDF .jc-header h2,
        #jobCardPDFClone .jc-header h2 {
            color: #17306d !important;
            letter-spacing: 1px !important;
            margin: 0 !important;
            font-size: 30px !important;
            line-height: 1.15 !important;
        }

        #jobCardPDF .jc-header h4,
        #jobCardPDF .jc-header p,
        #jobCardPDFClone .jc-header h4,
        #jobCardPDFClone .jc-header p {
            margin: 6px 0 !important;
            color: #111111 !important;
            font-weight: 700 !important;
            font-size: 13px !important;
            line-height: 1.25 !important;
        }

        #jobCardPDF .jc-title,
        #jobCardPDFClone .jc-title {
            font-size: 34px !important;
            font-weight: 900 !important;
            text-align: center !important;
            text-decoration: underline !important;
            margin: 35px 0 50px !important;
            color: #111111 !important;
        }

        #jobCardPDF .jc-main,
        #jobCardPDFClone .jc-main {
            display: grid !important;
            grid-template-columns: 1fr 360px !important;
            gap: 40px !important;
        }

        #jobCardPDF .jc-address h4,
        #jobCardPDF .jc-desc h4,
        #jobCardPDFClone .jc-address h4,
        #jobCardPDFClone .jc-desc h4 {
            display: block !important;
            background: #111e67 !important;
            color: #ffffff !important;
            padding: 8px !important;
            margin: 0 0 14px !important;
            font-size: 13px !important;
            line-height: 1.25 !important;
        }

        #jobCardPDF .jc-address-row,
        #jobCardPDFClone .jc-address-row {
            display: grid !important;
            grid-template-columns: 95px 1fr !important;
            gap: 8px !important;
            align-items: flex-start !important;
            margin: 8px 0 !important;
        }

        #jobCardPDF .jc-address-row span,
        #jobCardPDFClone .jc-address-row span {
            color: #111111 !important;
            font-size: 15px !important;
            font-weight: 800 !important;
            line-height: 1.35 !important;
        }

        #jobCardPDF .jc-address p,
        #jobCardPDFClone .jc-address p {
            margin: 0 !important;
            font-size: 16px !important;
            line-height: 1.35 !important;
            color: #111111 !important;
            white-space: pre-wrap !important;
            word-break: break-word !important;
        }

        #jobCardPDF .jc-details div,
        #jobCardPDFClone .jc-details div {
            display: grid !important;
            grid-template-columns: 145px 1fr !important;
            border: 1px solid #111111 !important;
            min-height: 34px !important;
            page-break-inside: avoid !important;
        }

        #jobCardPDF .jc-details span,
        #jobCardPDFClone .jc-details span {
            padding: 8px !important;
            text-align: right !important;
            border-right: 1px solid #111111 !important;
            color: #111111 !important;
            font-size: 13px !important;
            font-weight: 700 !important;
        }

        #jobCardPDF .jc-details b,
        #jobCardPDFClone .jc-details b {
            padding: 8px !important;
            font-weight: 400 !important;
            color: #111111 !important;
            font-size: 13px !important;
            word-break: break-word !important;
        }

        #jobCardPDF .jc-desc,
        #jobCardPDFClone .jc-desc {
            margin-top: 35px !important;
            border: 2px solid #111111 !important;
            min-height: 300px !important;
            page-break-inside: avoid !important;
        }

        #jobCardPDF .jc-desc p,
        #jobCardPDFClone .jc-desc p {
            padding: 18px !important;
            margin: 0 !important;
            font-size: 16px !important;
            line-height: 1.45 !important;
            white-space: pre-wrap !important;
            word-break: break-word !important;
            color: #111111 !important;
        }

        #jobCardPDF .jc-sign,
        #jobCardPDFClone .jc-sign {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 80px !important;
            margin-top: 90px !important;
            border-top: 2px solid #111111 !important;
            padding-top: 24px !important;
            page-break-inside: avoid !important;
        }

        #jobCardPDF .jc-sign span,
        #jobCardPDFClone .jc-sign span {
            display: block !important;
            border-bottom: 1px solid #111111 !important;
            min-height: 28px !important;
            color: #111111 !important;
        }

        #jobCardPDF .jc-sign b,
        #jobCardPDFClone .jc-sign b {
            display: block !important;
            margin-top: 8px !important;
            color: #111111 !important;
            font-size: 13px !important;
        }

        #jobCardPDF .jc-sign p,
        #jobCardPDFClone .jc-sign p {
            margin: 7px 0 0 !important;
            color: #111111 !important;
            font-size: 13px !important;
        }

        #jobCardPDF .jc-footer,
        #jobCardPDFClone .jc-footer {
            margin-top: 35px !important;
            text-align: center !important;
            font-size: 14px !important;
            line-height: 1.32 !important;
            color: #111111 !important;
            page-break-inside: avoid !important;
        }

        #jobCardPDF .jc-footer p,
        #jobCardPDFClone .jc-footer p {
            margin: 4px 0 !important;
            color: #111111 !important;
        }

        #jobCardPDF .jc-footer h3,
        #jobCardPDFClone .jc-footer h3 {
            font-size: 22px !important;
            margin: 8px 0 !important;
            color: #111111 !important;
        }

        #jobCardPDF img,
        #jobCardPDFClone img {
            max-width: 100% !important;
            height: auto !important;
        }
    `;

    function getPDFFileName() {
        return `Conquer-Job-Card-${getActiveJobCardId() || "new"}.pdf`;
    }

    function syncFormControlsToClone(source, clone) {
        const sourceControls = source.querySelectorAll("input, textarea, select");
        const cloneControls = clone.querySelectorAll("input, textarea, select");

        sourceControls.forEach(function (sourceControl, index) {
            const cloneControl = cloneControls[index];
            if (!cloneControl) return;

            if (sourceControl.tagName === "TEXTAREA") {
                cloneControl.value = sourceControl.value;
                cloneControl.textContent = sourceControl.value;
            } else if (sourceControl.tagName === "SELECT") {
                cloneControl.value = sourceControl.value;

                Array.from(cloneControl.options).forEach(function (option) {
                    option.removeAttribute("selected");

                    if (option.value === sourceControl.value) {
                        option.setAttribute("selected", "selected");
                    }
                });
            } else {
                cloneControl.value = sourceControl.value;
                cloneControl.setAttribute("value", sourceControl.value);

                if (sourceControl.checked) {
                    cloneControl.setAttribute("checked", "checked");
                } else {
                    cloneControl.removeAttribute("checked");
                }
            }
        });
    }

    function removeDuplicateIdsInsideClone(clone) {
        clone.querySelectorAll("[id]").forEach(function (element) {
            element.setAttribute("data-original-id", element.id);
            element.removeAttribute("id");
        });
    }

    function fitCloneToPage(page, clone) {
        clone.style.transform = "none";
        clone.style.left = "0px";
        clone.style.top = "0px";

        const pageWidth = PDF_PAGE_WIDTH;
        const pageHeight = PDF_PAGE_HEIGHT;
        const cloneWidth = clone.scrollWidth || JOB_CARD_WIDTH;
        const cloneHeight = clone.scrollHeight || 1120;
        const scale = Math.min(pageWidth / cloneWidth, pageHeight / cloneHeight, 1);
        const left = Math.max((pageWidth - (cloneWidth * scale)) / 2, 0);
        const top = Math.max((pageHeight - (cloneHeight * scale)) / 2, 0);

        clone.style.position = "absolute";
        clone.style.transformOrigin = "top left";
        clone.style.transform = `scale(${scale})`;
        clone.style.left = `${left}px`;
        clone.style.top = `${top}px`;

        return scale;
    }

    function createPDFExportPage() {
        const source = getElement("jobCardPDF") || document.getElementById("jobCardPDF");

        if (!source) {
            throw new Error("Job card preview section not found. Please check ID: jobCardPDF.");
        }

        const wrapper = document.createElement("div");
        wrapper.id = "pdfExportWrapper";

        /*
           Keep the export clone rendered but invisible to the user.
           Do not use display:none, visibility:hidden, or opacity:0 because canvas capture will be blank.
        */
        wrapper.style.position = "fixed";
        wrapper.style.left = "-10000px";
        wrapper.style.top = "0";
        wrapper.style.width = PDF_PAGE_WIDTH + "px";
        wrapper.style.height = PDF_PAGE_HEIGHT + "px";
        wrapper.style.background = "#ffffff";
        wrapper.style.color = "#111111";
        wrapper.style.zIndex = "1";
        wrapper.style.pointerEvents = "none";
        wrapper.style.overflow = "hidden";
        wrapper.style.contain = "layout style paint";
        wrapper.setAttribute("aria-hidden", "true");

        const style = document.createElement("style");
        style.innerHTML = PDF_EXPORT_CSS;

        const page = document.createElement("div");
        page.className = "pdf-export-page";

        const clone = source.cloneNode(true);
        clone.id = "jobCardPDFClone";

        syncFormControlsToClone(source, clone);
        removeDuplicateIdsInsideClone(clone);

        page.appendChild(clone);
        wrapper.appendChild(style);
        wrapper.appendChild(page);
        document.body.appendChild(wrapper);

        fitCloneToPage(page, clone);

        return {
            wrapper: wrapper,
            page: page,
            clone: clone
        };
    }

    async function waitForPDFRender(wrapper) {
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }

        const images = Array.from(wrapper.querySelectorAll("img"));

        await Promise.all(images.map(function (img) {
            if (img.complete && img.naturalWidth !== 0) {
                return Promise.resolve();
            }

            return new Promise(function (resolve) {
                img.onload = resolve;
                img.onerror = resolve;
            });
        }));

        await new Promise(function (resolve) {
            setTimeout(resolve, 700);
        });
    }

    async function generateJobPDFBlob() {
        prepareJobCardForOutput();

        if (!window.html2canvas) {
            throw new Error("html2canvas is not loaded. Please check the CDN script in index.html.");
        }

        if (!window.jspdf || !window.jspdf.jsPDF) {
            throw new Error("jsPDF is not loaded. Please check the CDN script in index.html.");
        }

        const pdfExport = createPDFExportPage();

        try {
            await waitForPDFRender(pdfExport.wrapper);

            const captureScale = isTouchMobileBrowser() ? 1.5 : 2;

            const canvas = await html2canvas(pdfExport.page, {
                scale: captureScale,
                useCORS: true,
                allowTaint: true,
                backgroundColor: "#ffffff",
                width: PDF_PAGE_WIDTH,
                height: PDF_PAGE_HEIGHT,
                windowWidth: PDF_PAGE_WIDTH,
                windowHeight: PDF_PAGE_HEIGHT,
                scrollX: 0,
                scrollY: 0,
                logging: false
            });

            if (!canvas || canvas.width <= 1 || canvas.height <= 1) {
                throw new Error("PDF capture failed. Canvas is empty.");
            }

            const imgData = canvas.toDataURL("image/png");
            const jsPDF = window.jspdf.jsPDF;

            const pdf = new jsPDF({
                orientation: "portrait",
                unit: "px",
                format: [PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT],
                compress: true
            });

            pdf.addImage(
                imgData,
                "PNG",
                0,
                0,
                PDF_PAGE_WIDTH,
                PDF_PAGE_HEIGHT
            );

            const pdfBlob = pdf.output("blob");

            if (!pdfBlob || pdfBlob.size < 1000) {
                throw new Error("Generated PDF is empty.");
            }

            return pdfBlob;

        } finally {
            if (pdfExport.wrapper && pdfExport.wrapper.parentNode) {
                pdfExport.wrapper.parentNode.removeChild(pdfExport.wrapper);
            }
        }
    }

    /* =========================================================
       DOWNLOAD PDF
    ========================================================= */

    async function savePDFBlobToDevice(pdfBlob, fileName) {
        const safeFileName = fileName || "Conquer-Job-Card.pdf";
        const file = typeof File === "function"
            ? new File([pdfBlob], safeFileName, { type: "application/pdf" })
            : null;

        if (
            file &&
            isTouchMobileBrowser() &&
            navigator.share &&
            navigator.canShare &&
            navigator.canShare({ files: [file] })
        ) {
            try {
                await navigator.share({
                    files: [file],
                    title: "Conquer Computers Job Card",
                    text: "Generated job card PDF"
                });
                return;
            } catch (shareError) {
                if (shareError && shareError.name === "AbortError") {
                    return;
                }

                console.warn("Mobile share failed, falling back to browser download:", shareError);
            }
        }

        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement("a");
        const supportsDownload = "download" in HTMLAnchorElement.prototype;

        link.href = url;
        link.download = safeFileName;
        link.rel = "noopener noreferrer";
        link.style.display = "none";

        document.body.appendChild(link);
        link.click();
        link.remove();

        if (!supportsDownload || isIOSBrowser()) {
            const opened = window.open(url, "_blank", "noopener,noreferrer");

            if (!opened) {
                alert("PDF is ready, but your browser blocked the download/open action. Please allow popups or use the Send PDF Email button.");
            }
        }

        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 8000);
    }

    async function downloadJobPDF(event) {
        const button = stopButtonDefault(event);
        const scrollPosition = rememberScrollPosition();

        try {
            await showPDFActionLoader("Preparing PDF...", "Creating a clean job card file. Please wait.");
            setButtonBusy(button, true, "Preparing PDF...");

            updatePDFActionLoader("Generating PDF...", "We are converting the job card into a printable PDF.");
            const pdfBlob = await generateJobPDFBlob();

            updatePDFActionLoader("Downloading PDF...", "Your job card PDF is ready. The download will start now.");
            await savePDFBlobToDevice(pdfBlob, getPDFFileName());
        } catch (error) {
            console.error("PDF download error:", error);
            alert("PDF download failed. " + getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
            await hidePDFActionLoader();
            restoreScrollPosition(scrollPosition);
        }
    }

    /* =========================================================
       PRINT PDF
    ========================================================= */

    function buildPrintHTML(printContent) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Job Card</title>
                <base href="${document.baseURI}">
                <style>
                    ${PDF_EXPORT_CSS}

                    @page {
                        size: A4 portrait;
                        margin: 0;
                    }

                    html,
                    body {
                        margin: 0 !important;
                        padding: 0 !important;
                        width: 210mm !important;
                        min-height: 297mm !important;
                        background: #ffffff !important;
                        overflow: hidden !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }

                    .pdf-export-page {
                        width: 210mm !important;
                        height: 297mm !important;
                        margin: 0 auto !important;
                        overflow: hidden !important;
                        background: #ffffff !important;
                    }

                    #jobCardPDFClone {
                        transform-origin: top left !important;
                    }

                    @media print {
                        html,
                        body {
                            width: 210mm !important;
                            min-height: 297mm !important;
                            overflow: hidden !important;
                        }

                        * {
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                        }
                    }
                </style>
            </head>
            <body>${printContent}</body>
            </html>
        `;
    }

    function printHTMLInHiddenFrame(printHTML) {
        return new Promise(function (resolve, reject) {
            const iframe = document.createElement("iframe");
            let cleaned = false;

            function cleanup() {
                if (cleaned) return;
                cleaned = true;

                setTimeout(function () {
                    if (iframe.parentNode) {
                        iframe.parentNode.removeChild(iframe);
                    }
                }, 1200);
            }

            iframe.setAttribute("title", "Print Job Card");
            iframe.style.position = "fixed";
            iframe.style.right = "0";
            iframe.style.bottom = "0";
            iframe.style.width = "0";
            iframe.style.height = "0";
            iframe.style.border = "0";
            iframe.style.opacity = "0";
            iframe.style.pointerEvents = "none";

            iframe.onload = function () {
                try {
                    const frameWindow = iframe.contentWindow;
                    const frameDocument = iframe.contentDocument || (frameWindow ? frameWindow.document : null);

                    if (!frameWindow || !frameDocument) {
                        throw new Error("Print frame could not be opened.");
                    }

                    const images = Array.from(frameDocument.querySelectorAll("img"));
                    Promise.all(images.map(function (img) {
                        if (img.complete && img.naturalWidth !== 0) {
                            return Promise.resolve();
                        }

                        return new Promise(function (imageResolve) {
                            img.onload = imageResolve;
                            img.onerror = imageResolve;
                        });
                    })).then(function () {
                        setTimeout(function () {
                            frameWindow.focus();
                            frameWindow.print();
                            cleanup();
                            resolve();
                        }, 350);
                    }).catch(function (imageError) {
                        cleanup();
                        reject(imageError);
                    });
                } catch (error) {
                    cleanup();
                    reject(error);
                }
            };

            document.body.appendChild(iframe);

            const frameDocument = iframe.contentWindow && iframe.contentWindow.document;
            if (!frameDocument) {
                cleanup();
                reject(new Error("Print frame is not available."));
                return;
            }

            frameDocument.open();
            frameDocument.write(printHTML);
            frameDocument.close();
        });
    }

    async function printJobPDF(event) {
        const button = stopButtonDefault(event);
        const scrollPosition = rememberScrollPosition();
        let pdfExport = null;

        try {
            await showPDFActionLoader("Preparing Print...", "Building the job card print layout. Please wait.");
            setButtonBusy(button, true, "Preparing Print...");

            updatePDFActionLoader("Preparing Print...", "Loading logo, fonts, and job card details.");
            prepareJobCardForOutput();
            pdfExport = createPDFExportPage();

            await waitForPDFRender(pdfExport.wrapper);

            const printContent = pdfExport.page.outerHTML;

            if (pdfExport.wrapper && pdfExport.wrapper.parentNode) {
                pdfExport.wrapper.parentNode.removeChild(pdfExport.wrapper);
            }

            pdfExport = null;
            updatePDFActionLoader("Opening Print Window...", "The browser print dialog will open now.");
            await printHTMLInHiddenFrame(buildPrintHTML(printContent));
        } catch (error) {
            console.error("Print error:", error);
            alert("Print failed. " + getErrorMessage(error));
        } finally {
            if (pdfExport && pdfExport.wrapper && pdfExport.wrapper.parentNode) {
                pdfExport.wrapper.parentNode.removeChild(pdfExport.wrapper);
            }

            setButtonBusy(button, false);
            await hidePDFActionLoader();
            restoreScrollPosition(scrollPosition);
        }
    }

    /* =========================================================
       BLOB TO BASE64
    ========================================================= */

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();

            reader.onloadend = function () {
                const result = reader.result || "";
                const base64 = result.toString().split(",")[1];

                if (!base64) {
                    reject(new Error("PDF Base64 conversion failed."));
                    return;
                }

                resolve(base64);
            };

            reader.onerror = function () {
                reject(new Error("Failed to convert PDF to Base64."));
            };

            reader.readAsDataURL(blob);
        });
    }

    /* =========================================================
       PRODUCTION BACKEND SYNC HELPERS
    ========================================================= */

    async function syncWebsiteData(eventType, payload) {
        try {
            await fetch("website-data-sync.php", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    eventType: eventType,
                    uid: currentUser ? currentUser.uid : "",
                    email: currentUser ? currentUser.email : "",
                    payload: payload || {},
                    pageUrl: window.location.href
                })
            });
        } catch (error) {
            console.warn("Website data sync skipped:", error);
        }
    }

    async function uploadComplaintFiles(complaintId, files) {
        if (!files || !files.length) {
            return { success: true, files: [] };
        }

        const formData = new FormData();
        formData.append("uid", currentUser ? currentUser.uid : "guest");
        formData.append("email", currentUser ? currentUser.email : "");
        formData.append("complaintId", complaintId);

        Array.from(files).slice(0, 5).forEach(function (file) {
            formData.append("complaintFiles[]", file);
        });

        const response = await fetch("complaint-upload-handler.php", {
            method: "POST",
            body: formData
        });

        const result = await response.json().catch(function () {
            return { success: false, message: "Invalid upload server response." };
        });

        if (!response.ok || !result.success) {
            throw new Error(result.message || "Complaint file upload failed.");
        }

        return result;
    }

    /* =========================================================
       SEND PDF EMAIL THROUGH CPANEL PHP HANDLER
    ========================================================= */

    async function sendJobPDFEmail(event) {
        const button = stopButtonDefault(event);
        const scrollPosition = rememberScrollPosition();

        if (!currentUser) {
            alert("Please login first.");
            return;
        }

        if (!currentJobCardId) {
            alert("Please save the job card first.");
            return;
        }

        try {
            await showPDFActionLoader("Preparing Email...", "Generating the job card PDF before sending it.");
            setButtonBusy(button, true, "Sending PDF...");

            updatePDFActionLoader("Generating PDF...", "Creating the job card attachment for email.");
            const pdfBlob = await generateJobPDFBlob();

            updatePDFActionLoader("Sending Email...", "Please wait while we send the PDF to the client and company email.");
            const pdfBase64 = await blobToBase64(pdfBlob);
            const data = getCurrentFormDataForPreview();

            const response = await fetch("job-pdf-email-handler.php", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    jobCardId: currentJobCardId,
                    documentNumber: currentJobCardId,
                    clientName: data.clientName || (currentUser ? currentUser.email : "Client"),
                    clientEmail: currentUser.email,
                    companyEmail: COMPANY_EMAIL,
                    serviceDetails: data.jobDescription || "Job card generated from client portal",
                    fileName: getPDFFileName(),
                    pdfBase64: pdfBase64
                })
            });

            const result = await response.json().catch(function () {
                return { success: false, message: "Invalid server response." };
            });

            if (!response.ok || !result.success) {
                throw new Error(result.message || "PDF email could not be sent.");
            }

            await syncWebsiteData("pdf_email", {
                reference: currentJobCardId,
                clientName: data.clientName || "Client",
                clientEmail: currentUser.email,
                fileName: getPDFFileName(),
                companySent: result.companySent ? "yes" : "no",
                clientSent: result.clientSent ? "yes" : "no"
            });

            alert(result.message || "PDF email sent successfully to your registered email and company email.");
        } catch (error) {
            console.error("Send PDF email error:", error);
            alert("PDF email could not be sent. " + getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
            await hidePDFActionLoader();
            restoreScrollPosition(scrollPosition);
        }
    }

    /* =========================================================
       SAVE COMPLAINT
    ========================================================= */

    async function saveComplaint(event) {
        if (event) event.preventDefault();

        if (!currentUser) {
            alert("Please login first.");
            return;
        }

        if (!isClientPortalAllowed("complaint")) {
            alert("Complaint Portal is not enabled for this account.");
            return;
        }

        const subject = getValue("complaintSubject");
        const type = getValue("complaintType");
        const details = getValue("complaintDetails");
        const fileInput = getElement("complaintFiles");
        const selectedFiles = fileInput && fileInput.files ? fileInput.files : [];

        if (!subject || !type || !details) {
            alert("Please fill all complaint fields.");
            return;
        }

        const complaintRef = db.collection("complaints").doc();
        let uploadResult = { success: true, files: [] };
        let uploadWarning = "";

        try {
            if (selectedFiles.length) {
                uploadResult = await uploadComplaintFiles(complaintRef.id, selectedFiles);
            }
        } catch (uploadError) {
            console.error("Complaint upload error:", uploadError);
            uploadWarning = " Complaint saved, but attachment upload failed: " + getErrorMessage(uploadError);
        }

        const data = {
            uid: currentUser.uid,
            email: currentUser.email,
            clientName: getElement("clientName") ? getElement("clientName").innerText : currentUser.email,
            complaintId: complaintRef.id,
            subject: subject,
            type: type,
            details: details,
            status: "Open",
            attachments: uploadResult.files || [],
            attachmentCount: uploadResult.files ? uploadResult.files.length : 0,
            uploadWarning: uploadWarning,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await complaintRef.set(data);

            await syncWebsiteData("complaint", {
                reference: complaintRef.id,
                clientName: data.clientName,
                clientEmail: data.email,
                subject: subject,
                type: type,
                details: details,
                status: "Open",
                attachmentCount: data.attachmentCount
            });

            const complaintForm = getElement("complaintForm");
            if (complaintForm) complaintForm.reset();

            await loadComplaints();
            await writeAuditLog("complaint_created", "complaints", complaintRef.id, `Complaint ${subject} created.`, { status: "Open", type: type });

            alert("Complaint registered successfully." + uploadWarning);
        } catch (error) {
            console.error("Save complaint error:", error);
            alert(getErrorMessage(error));
        }
    }

    /* =========================================================
       LOAD COMPLAINTS
       NOTE:
       No orderBy here, so Firestore composite index is not required.
    ========================================================= */

    async function loadComplaints() {
        if (!currentUser) return;

        const list = getElement("complaintList");
        if (!list) return;

        list.innerHTML = "Loading...";

        try {
            const snapshot = await db.collection("complaints")
                .where("uid", "==", currentUser.uid)
                .get();

            list.innerHTML = "";

            if (snapshot.empty) {
                list.innerHTML = "<p>No complaints registered yet.</p>";
                return;
            }

            const complaints = [];

            snapshot.forEach(function (doc) {
                complaints.push({
                    id: doc.id,
                    data: doc.data()
                });
            });

            complaints.sort(function (a, b) {
                return timestampToMillis(b.data.createdAt) - timestampToMillis(a.data.createdAt);
            });

            complaints.forEach(function (complaint) {
                const data = complaint.data;

                const item = document.createElement("div");
                item.className = "saved-item";

                const attachmentText = data.attachmentCount ? ` | Attachments: ${data.attachmentCount}` : "";

                item.appendChild(createSafeTextElement("strong", data.subject || "Complaint"));
                item.appendChild(createSafeTextElement("span", `${data.type || "General"} | Status: ${data.status || "Open"}${attachmentText}`));

                list.appendChild(item);
            });
        } catch (error) {
            console.error("Load complaints error:", error);
            list.innerHTML = "<p>Unable to load complaints.</p>";
            alert(getErrorMessage(error));
        }
    }

    /* =========================================================
       DELIVERY PORTAL
    ========================================================= */

    function generateDeliveryId() {
        const digits = Math.floor(1000 + Math.random() * 9000);
        return `${DELIVERY_ID_PREFIX}${digits}`;
    }

    async function createUniqueDeliveryId() {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const id = generateDeliveryId();
            const existing = await db.collection("deliveryNotes").doc(id).get();

            if (!existing.exists) {
                return id;
            }
        }

        return `${DELIVERY_ID_PREFIX}${Date.now().toString().slice(-6)}`;
    }

    async function saveDeliveryNote(event) {
        if (event) event.preventDefault();

        if (!currentUser) {
            alert("Please login first.");
            return;
        }

        if (!isClientPortalAllowed("delivery")) {
            alert("Delivery Portal is not enabled for this account.");
            return;
        }

        const recipient = getValue("deliveryPortalRecipient");
        const address = getValue("deliveryPortalAddress");
        const items = getValue("deliveryPortalItems");
        const deliveryDate = getValue("deliveryPortalDate");

        if (!recipient || !address || !items || !deliveryDate) {
            alert("Please fill all required delivery fields.");
            return;
        }

        let id = currentDeliveryNoteId || getValue("deliveryPortalId");

        if (!id) {
            id = await createUniqueDeliveryId();
        }

        const data = {
            uid: currentUser.uid,
            email: currentUser.email,
            deliveryId: id,
            deliveryDate: deliveryDate,
            reference: getValue("deliveryPortalReference"),
            status: getValue("deliveryPortalStatus") || "Pending",
            recipient: recipient,
            phone: getValue("deliveryPortalPhone"),
            address: address,
            details: items,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (!currentDeliveryNoteId) {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        }

        try {
            await db.collection("deliveryNotes").doc(id).set(data, { merge: true });
            currentDeliveryNoteId = id;
            setValue("deliveryPortalId", id);
            await syncWebsiteData("delivery_note", {
                reference: id,
                clientName: data.recipient,
                clientEmail: data.email,
                status: data.status,
                deliveryDate: data.deliveryDate
            });
            await loadDeliveryNotes();
            await writeAuditLog("delivery_note_saved", "deliveryNotes", id, `Delivery note ${id} saved.`, { status: data.status || "Pending" });
            alert("Delivery record saved successfully.");
        } catch (error) {
            console.error("Save delivery note error:", error);
            alert(getErrorMessage(error));
        }
    }

    async function loadDeliveryNotes() {
        if (!currentUser) return;

        const list = getElement("deliveryNoteList");
        if (!list) return;

        list.innerHTML = "Loading...";

        try {
            const snapshot = await db.collection("deliveryNotes")
                .where("uid", "==", currentUser.uid)
                .get();

            list.innerHTML = "";

            if (snapshot.empty) {
                list.innerHTML = "<p>No delivery records saved yet.</p>";
                return;
            }

            const records = [];
            snapshot.forEach(function (doc) {
                records.push({ id: doc.id, data: doc.data() });
            });

            records.sort(function (a, b) {
                return timestampToMillis(b.data.updatedAt) - timestampToMillis(a.data.updatedAt);
            });

            records.forEach(function (record) {
                const data = record.data;
                const item = document.createElement("div");
                item.className = "saved-item";
                item.setAttribute("role", "button");
                item.setAttribute("tabindex", "0");

                item.appendChild(createSafeTextElement("strong", data.recipient || "Delivery Record"));
                item.appendChild(createSafeTextElement("span", `${data.deliveryDate || "No Date"} | ${record.id} | ${data.status || "Pending"}`));

                item.onclick = function () {
                    openDeliveryNote(record.id, data);
                };

                item.onkeydown = function (keyboardEvent) {
                    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                        keyboardEvent.preventDefault();
                        openDeliveryNote(record.id, data);
                    }
                };

                list.appendChild(item);
            });
        } catch (error) {
            console.error("Load delivery notes error:", error);
            list.innerHTML = "<p>Unable to load delivery records.</p>";
            alert(getErrorMessage(error));
        }
    }

    function openDeliveryNote(id, data) {
        currentDeliveryNoteId = id;
        setValue("deliveryPortalId", id);
        setValue("deliveryPortalDate", data.deliveryDate);
        setValue("deliveryPortalReference", data.reference);
        setValue("deliveryPortalStatus", data.status || "Pending");
        setValue("deliveryPortalRecipient", data.recipient);
        setValue("deliveryPortalPhone", data.phone);
        setValue("deliveryPortalAddress", data.address);
        setValue("deliveryPortalItems", data.details);
    }

    /* =========================================================
       ADMIN USER ACCESS DASHBOARD
    ========================================================= */

    async function loadAdminUsers() {
        if (!isAdminProfile()) return;

        const list = getElement("adminUserList");
        const summary = getElement("adminUsersSummary");

        if (!list) return;
        list.innerHTML = "Loading registered users...";
        if (summary) summary.innerText = "";

        try {
            const snapshot = await db.collection("users").get();
            const users = [];

            snapshot.forEach(function (doc) {
                users.push({ uid: doc.id, profile: normalizeAccountProfile({ uid: doc.id, email: doc.data().email || "" }, doc.data()) });
            });

            users.sort(function (a, b) {
                return String(a.profile.email || a.profile.name || "").localeCompare(String(b.profile.email || b.profile.name || ""));
            });

            list.innerHTML = "";
            if (!users.length) {
                list.innerHTML = "<p>No registered users found.</p>";
                return;
            }

            if (summary) {
                const activeCount = users.filter(function (user) { return user.profile.accountStatus === "active"; }).length;
                const adminCount = users.filter(function (user) { return user.profile.role === "admin"; }).length;
                const staffCount = users.filter(function (user) { return user.profile.role === "staff"; }).length;
                summary.innerText = `${users.length} users loaded | ${activeCount} active | ${staffCount} staff | ${adminCount} admins`;
            }

            users.forEach(function (entry) {
                list.appendChild(createAdminUserRow(entry.uid, entry.profile));
            });
        } catch (error) {
            console.error("Admin user load error:", error);
            list.innerHTML = "<p>Unable to load registered users. Publish the updated Firestore admin rules and confirm your account has role=admin.</p>";
            if (summary) summary.innerText = getErrorMessage(error);
        }
    }

    function createAdminUserRow(uid, profile) {
        const row = document.createElement("div");
        row.className = "admin-user-row";

        const info = document.createElement("div");
        info.className = "admin-user-info";
        info.appendChild(createSafeTextElement("strong", profile.name || "Client"));
        info.appendChild(createSafeTextElement("span", profile.email || "No email"));

        const controls = document.createElement("div");
        controls.className = "admin-user-controls";

        const statusSelect = document.createElement("select");
        statusSelect.setAttribute("aria-label", "Account status");
        ["pending", "active", "blocked"].forEach(function (status) {
            const option = document.createElement("option");
            option.value = status;
            option.textContent = status.charAt(0).toUpperCase() + status.slice(1);
            option.selected = profile.accountStatus === status;
            statusSelect.appendChild(option);
        });

        const roleSelect = document.createElement("select");
        roleSelect.setAttribute("aria-label", "User role");
        ["client", "staff", "admin"].forEach(function (role) {
            const option = document.createElement("option");
            option.value = role;
            option.textContent = role.charAt(0).toUpperCase() + role.slice(1);
            option.selected = profile.role === role;
            roleSelect.appendChild(option);
        });

        const accessWrap = document.createElement("div");
        accessWrap.className = "admin-access-toggles";
        const deliveryLabel = document.createElement("label");
        const deliveryCheck = document.createElement("input");
        deliveryCheck.type = "checkbox";
        deliveryCheck.checked = profile.portalAccess && profile.portalAccess.delivery === true;
        deliveryLabel.appendChild(deliveryCheck);
        deliveryLabel.appendChild(createSafeTextElement("span", "Delivery"));
        const complaintLabel = document.createElement("label");
        const complaintCheck = document.createElement("input");
        complaintCheck.type = "checkbox";
        complaintCheck.checked = profile.portalAccess && profile.portalAccess.complaint === true;
        complaintLabel.appendChild(complaintCheck);
        complaintLabel.appendChild(createSafeTextElement("span", "Complaints"));
        accessWrap.appendChild(deliveryLabel);
        accessWrap.appendChild(complaintLabel);

        const saveButton = document.createElement("button");
        saveButton.className = "btn-outline admin-save-btn";
        saveButton.type = "button";
        saveButton.textContent = "Save Access";
        saveButton.onclick = function () {
            saveAdminUserAccess(uid, statusSelect.value, roleSelect.value, {
                delivery: deliveryCheck.checked,
                complaint: complaintCheck.checked
            }, saveButton);
        };

        controls.appendChild(statusSelect);
        controls.appendChild(roleSelect);
        controls.appendChild(accessWrap);
        controls.appendChild(saveButton);

        row.appendChild(info);
        row.appendChild(controls);
        return row;
    }

    async function saveAdminUserAccess(uid, accountStatus, role, portalAccessFlags, button) {
        if (!isAdminProfile()) return;

        setButtonBusy(button, true, "Saving...");

        try {
            const isActive = accountStatus === "active";
            await db.collection("users").doc(uid).set({
                role: ["admin", "staff", "client"].includes(role) ? role : "client",
                accountStatus: accountStatus,
                active: isActive,
                allowed: isActive,
                portalAccess: {
                    jobCard: true,
                    delivery: !!(portalAccessFlags && portalAccessFlags.delivery),
                    complaint: !!(portalAccessFlags && portalAccessFlags.complaint)
                },
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            await loadAdminUsers();
            await writeAuditLog("user_access_updated", "users", uid, `Portal access updated for ${uid}.`, { accountStatus: accountStatus, role: role });
        } catch (error) {
            console.error("Admin access update error:", error);
            alert(getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }



    /* =========================================================
       PHASE 1: OVERVIEW, WORKFLOW, CUSTOMER HISTORY, PASSWORD
    ========================================================= */

    async function loadAdminOverviewMetrics() {
        if (!isAdminProfile()) return;
        try {
            const results = await Promise.all([
                db.collection("users").get(),
                db.collection("jobCards").get(),
                db.collection("quotations").get(),
                db.collection("invoices").get(),
                db.collection("complaints").get(),
                db.collection("amcContracts").get(),
                db.collection("inventoryItems").get()
            ]);
            const users = results[0];
            const jobs = results[1];
            const quotations = results[2];
            const invoices = results[3];
            const complaints = results[4];
            const amcContracts = results[5];
            const inventory = results[6];
            const userRecords = [];
            users.forEach(function (doc) { userRecords.push(doc.data() || {}); });
            const jobRecords = [];
            jobs.forEach(function (doc) { jobRecords.push(doc.data() || {}); });
            const complaintRecords = [];
            complaints.forEach(function (doc) { complaintRecords.push(doc.data() || {}); });
            const amcRecords = [];
            amcContracts.forEach(function (doc) { amcRecords.push(doc.data() || {}); });
            const inventoryRecords = [];
            inventory.forEach(function (doc) { inventoryRecords.push(doc.data() || {}); });
            const today = startOfLocalDay(new Date());
            const pendingUsers = userRecords.filter(function (profile) { return String(profile.accountStatus || "pending") === "pending"; }).length;
            const activeStaff = userRecords.filter(function (profile) { return profile.role === "staff" && String(profile.accountStatus || "active") === "active" && profile.allowed !== false; }).length;
            const openJobs = jobRecords.filter(function (job) { return !["Closed", "Delivered"].includes(String(job.workflowStatus || "New")); }).length;
            const overdueJobs = jobRecords.filter(function (job) { return isJobSlaOverdue(job, today); }).length;
            const openComplaints = complaintRecords.filter(function (complaint) { return !["Resolved", "Closed"].includes(String(complaint.status || "Open")); }).length;
            const expiringAmc = amcRecords.filter(function (contract) { return getAmcHealth(contract).state === "expiring" || getAmcHealth(contract).state === "expired"; }).length;
            const lowStock = inventoryRecords.filter(function (item) { return Number(item.quantity || 0) <= Number(item.reorderLevel || 0); }).length;
            setText("metricTotalUsers", String(userRecords.length));
            setText("metricPendingUsers", String(pendingUsers));
            setText("metricOpenJobCards", String(openJobs));
            setText("metricQuotations", String(quotations.size));
            setText("metricInvoices", String(invoices.size));
            setText("metricStaff", String(activeStaff));
            setText("metricOverdueJobs", String(overdueJobs));
            setText("metricOpenComplaints", String(openComplaints));
            setText("metricExpiringAmc", String(expiringAmc));
            setText("metricLowStock", String(lowStock));
        } catch (error) {
            console.error("Admin overview metric load error:", error);
        }
    }

    function createWorkflowSelect(values, selectedValue, label) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", label || "Select");
        values.forEach(function (value) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            option.selected = String(selectedValue || "") === value;
            select.appendChild(option);
        });
        return select;
    }

    function createStaffAssignmentSelect(selectedUid, fallbackName) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", "Assigned staff");
        const unassigned = document.createElement("option");
        unassigned.value = "";
        unassigned.textContent = "Unassigned";
        select.appendChild(unassigned);
        let selectedExists = false;
        assignableStaffDirectory.forEach(function (staff) {
            const option = document.createElement("option");
            option.value = staff.uid;
            option.dataset.email = staff.email || "";
            option.dataset.name = staff.name || staff.email || "Staff";
            option.textContent = `${staff.name || staff.email || "Staff"}${staff.email ? ` · ${staff.email}` : ""}`;
            option.selected = staff.uid === selectedUid;
            if (option.selected) selectedExists = true;
            select.appendChild(option);
        });
        if (selectedUid && !selectedExists) {
            const legacyOption = document.createElement("option");
            legacyOption.value = selectedUid;
            legacyOption.dataset.email = "";
            legacyOption.dataset.name = fallbackName || "Assigned Staff";
            legacyOption.textContent = fallbackName || "Assigned Staff";
            legacyOption.selected = true;
            select.appendChild(legacyOption);
        }
        if (!selectedUid) unassigned.selected = true;
        return select;
    }

    async function loadAdminWorkflowJobCards() {
        if (!isAdminProfile()) return;
        const list = getElement("adminWorkflowJobCardList");
        const summary = getElement("adminWorkflowSummary");
        if (!list) return;
        list.innerHTML = "Loading workflow job cards...";
        if (summary) summary.innerText = "";
        try {
            await loadAssignableStaffDirectory();
            const snapshot = await db.collection("jobCards").get();
            const cards = [];
            snapshot.forEach(function (doc) { cards.push({ id: doc.id, data: doc.data() || {} }); });
            cards.sort(sortTimestampDescending);
            list.innerHTML = "";
            if (summary) {
                const assigned = cards.filter(function (card) { return !!card.data.assignedStaffUid; }).length;
                const open = cards.filter(function (card) { return !["Closed", "Delivered"].includes(String(card.data.workflowStatus || "New")); }).length;
                summary.innerText = `${cards.length} job cards | ${open} open | ${assigned} assigned | ${assignableStaffDirectory.length} active staff available`;
            }
            if (!cards.length) {
                list.innerHTML = "<p>No job cards available.</p>";
                return;
            }
            cards.forEach(function (record) {
                list.appendChild(createAdminWorkflowJobCardRow(record.id, record.data));
            });
        } catch (error) {
            console.error("Workflow job card load error:", error);
            list.innerHTML = "<p>Unable to load workflow job cards.</p>";
            if (summary) summary.innerText = getErrorMessage(error);
        }
    }

    function createAdminWorkflowJobCardRow(id, data) {
        const row = document.createElement("article");
        row.className = "workflow-jobcard-row";
        if (isJobSlaOverdue(data, startOfLocalDay(new Date()))) row.classList.add("is-overdue");
        const intro = document.createElement("div");
        intro.className = "workflow-jobcard-intro";
        intro.appendChild(createSafeTextElement("strong", data.jobCardId || id));
        intro.appendChild(createSafeTextElement("span", `${data.clientCompany || data.clientName || "Customer"} · ${data.email || "No email"}`));
        intro.appendChild(createSafeTextElement("small", data.jobDescription || "No job description"));
        const scheduleText = [data.visitDate ? `Visit ${data.visitDate}` : "", data.visitTime || "", data.slaResolveBy ? `Resolve by ${data.slaResolveBy.replace("T", " ")}` : ""].filter(Boolean).join(" · ");
        if (scheduleText) intro.appendChild(createSafeTextElement("small", scheduleText));
        if (isJobSlaOverdue(data, startOfLocalDay(new Date()))) intro.appendChild(createSafeTextElement("em", "SLA overdue"));

        const controls = document.createElement("div");
        controls.className = "workflow-jobcard-controls enhanced-workflow-controls";
        const status = createWorkflowSelect(["New", "Assigned", "In Progress", "Waiting for Parts", "Completed", "Delivered", "Closed"], data.workflowStatus || "New", "Workflow status");
        const priority = createWorkflowSelect(["Normal", "Low", "High", "Urgent"], data.jobPriority || "Normal", "Priority");
        const due = document.createElement("input");
        due.type = "date";
        due.value = data.jobDueDate || "";
        due.setAttribute("aria-label", "Expected completion date");
        const visitDate = document.createElement("input");
        visitDate.type = "date";
        visitDate.value = data.visitDate || "";
        visitDate.setAttribute("aria-label", "Scheduled visit date");
        const visitTime = document.createElement("input");
        visitTime.type = "time";
        visitTime.value = data.visitTime || "";
        visitTime.setAttribute("aria-label", "Scheduled visit time");
        const staff = createStaffAssignmentSelect(data.assignedStaffUid || "", data.assignedStaffName || "");
        const save = document.createElement("button");
        save.type = "button";
        save.className = "btn-outline admin-save-btn";
        save.textContent = "Save Workflow";
        save.onclick = function () { saveAdminJobCardWorkflow(id, status.value, priority.value, due.value, visitDate.value, visitTime.value, staff, save, data); };
        controls.appendChild(status);
        controls.appendChild(priority);
        controls.appendChild(due);
        controls.appendChild(visitDate);
        controls.appendChild(visitTime);
        controls.appendChild(staff);
        controls.appendChild(save);
        row.appendChild(intro);
        row.appendChild(controls);
        return row;
    }

    async function saveAdminJobCardWorkflow(id, workflowStatus, jobPriority, jobDueDate, visitDate, visitTime, staffSelect, button, priorData) {
        if (!isAdminProfile()) return;
        setButtonBusy(button, true, "Saving...");
        try {
            const selectedOption = staffSelect && staffSelect.selectedOptions ? staffSelect.selectedOptions[0] : null;
            const assignedStaffUid = staffSelect ? staffSelect.value : "";
            const assignedStaffEmail = selectedOption ? (selectedOption.dataset.email || "") : "";
            const assignedStaffName = selectedOption ? (selectedOption.dataset.name || selectedOption.textContent || "") : "";
            await db.collection("jobCards").doc(id).set({
                workflowStatus: workflowStatus || "New",
                jobPriority: jobPriority || "Normal",
                jobDueDate: jobDueDate || "",
                visitDate: visitDate || "",
                visitTime: visitTime || "",
                assignedStaffUid: assignedStaffUid || "",
                assignedStaffEmail: assignedStaffEmail || "",
                assignedStaffName: assignedStaffUid ? assignedStaffName : "",
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            const nextWorkflowData = Object.assign({}, priorData || {}, {
                workflowStatus: workflowStatus || "New",
                jobPriority: jobPriority || "Normal",
                jobDueDate: jobDueDate || "",
                visitDate: visitDate || "",
                visitTime: visitTime || "",
                assignedStaffName: assignedStaffUid ? assignedStaffName : ""
            });
            await writeAuditLog("job_workflow_updated", "jobCards", id, `Workflow updated for ${id}.`, { workflowStatus: workflowStatus || "New", jobPriority: jobPriority || "Normal", assignedStaffUid: assignedStaffUid || "" });
            if (workflowNotificationNeeded(priorData || {}, nextWorkflowData)) {
                await sendWorkflowStatusNotification(id, nextWorkflowData);
            }
            await Promise.all([loadAdminWorkflowJobCards(), loadAdminJobCards(), loadAdminOverviewMetrics(), loadAdminCustomerDeviceHistory(), loadAdminReportsAndAudit()]);
        } catch (error) {
            console.error("Save admin workflow error:", error);
            alert(getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }

    function historySearchNeedle() {
        return String(getValue("customerHistorySearch") || "").toLowerCase();
    }

    async function loadAdminCustomerDeviceHistory() {
        if (!isAdminProfile()) return;
        const summary = getElement("customerHistorySummary");
        if (summary) summary.innerText = "Loading service history...";
        try {
            const snapshot = await db.collection("jobCards").get();
            adminHistoryJobCards = [];
            snapshot.forEach(function (doc) { adminHistoryJobCards.push({ id: doc.id, data: doc.data() || {} }); });
            adminHistoryJobCards.sort(sortTimestampDescending);
            renderAdminCustomerDeviceHistory();
        } catch (error) {
            console.error("Customer/device history load error:", error);
            if (summary) summary.innerText = getErrorMessage(error);
        }
    }

    function filterAdminCustomerDeviceHistory() {
        renderAdminCustomerDeviceHistory();
    }

    function recordMatchesHistorySearch(record, needle) {
        if (!needle) return true;
        const data = record.data || {};
        return [
            record.id, data.jobCardId, data.clientName, data.clientCompany, data.email, data.clientPhone,
            data.customerId, data.workflowStatus, data.assignedStaffName, data.deviceType, data.deviceBrand,
            data.deviceModel, data.deviceSerialNumber, data.jobDescription
        ].join(" ").toLowerCase().includes(needle);
    }

    function renderAdminCustomerDeviceHistory() {
        const customerList = getElement("customerHistoryList");
        const deviceList = getElement("deviceHistoryList");
        const summary = getElement("customerHistorySummary");
        if (!customerList || !deviceList) return;
        const needle = historySearchNeedle();
        const filtered = adminHistoryJobCards.filter(function (record) { return recordMatchesHistorySearch(record, needle); });
        const customers = new Map();
        const devices = [];
        filtered.forEach(function (record) {
            const data = record.data || {};
            const customerKey = data.customerId || data.email || data.clientPhone || data.clientCompany || data.clientName || record.id;
            if (!customers.has(customerKey)) {
                customers.set(customerKey, {
                    key: customerKey,
                    name: data.clientName || "Customer",
                    company: data.clientCompany || "",
                    email: data.email || "",
                    phone: data.clientPhone || "",
                    jobs: [],
                    latestStatus: data.workflowStatus || "New"
                });
            }
            const customer = customers.get(customerKey);
            customer.jobs.push(data.jobCardId || record.id);
            if (data.deviceType || data.deviceBrand || data.deviceModel || data.deviceSerialNumber) {
                devices.push({ id: data.jobCardId || record.id, data: data });
            }
        });
        customerList.innerHTML = "";
        deviceList.innerHTML = "";
        const customerRecords = Array.from(customers.values());
        if (!customerRecords.length) customerList.innerHTML = "<p>No customer history found.</p>";
        customerRecords.forEach(function (customer) {
            const item = document.createElement("article");
            item.className = "history-item";
            item.appendChild(createSafeTextElement("strong", customer.company || customer.name || "Customer"));
            item.appendChild(createSafeTextElement("span", `${customer.email || "No email"} · ${customer.phone || "No phone"}`));
            item.appendChild(createSafeTextElement("span", `${customer.jobs.length} job card${customer.jobs.length === 1 ? "" : "s"} · Latest status: ${customer.latestStatus}`));
            item.appendChild(createSafeTextElement("small", `Records: ${customer.jobs.slice(0, 4).join(", ")}${customer.jobs.length > 4 ? "…" : ""}`));
            customerList.appendChild(item);
        });
        if (!devices.length) deviceList.innerHTML = "<p>No device metadata saved yet. New job cards can now capture device details.</p>";
        devices.forEach(function (device) {
            const data = device.data || {};
            const item = document.createElement("article");
            item.className = "history-item";
            item.appendChild(createSafeTextElement("strong", `${data.deviceType || "Device"} · ${data.deviceBrand || "Brand not set"}`));
            item.appendChild(createSafeTextElement("span", `${data.deviceModel || "Model not set"} · Serial: ${data.deviceSerialNumber || "Not set"}`));
            item.appendChild(createSafeTextElement("span", `${device.id} · ${data.clientCompany || data.clientName || "Customer"}`));
            deviceList.appendChild(item);
        });
        if (summary) summary.innerText = `${customerRecords.length} customer profile${customerRecords.length === 1 ? "" : "s"} and ${devices.length} device record${devices.length === 1 ? "" : "s"} shown from ${filtered.length} matching job card${filtered.length === 1 ? "" : "s"}.`;
    }

    function mirrorJobCardList() {
        const source = getElement("jobCardList");
        const mirror = getElement("jobCardListMirror");
        if (!source || !mirror) return;
        mirror.innerHTML = source.innerHTML;
        const sourceItems = Array.from(source.querySelectorAll(".saved-item"));
        const mirrorItems = Array.from(mirror.querySelectorAll(".saved-item"));
        mirrorItems.forEach(function (item, index) {
            const sourceItem = sourceItems[index];
            if (!sourceItem) return;
            item.setAttribute("role", "button");
            item.tabIndex = 0;
            item.onclick = function () { if (typeof sourceItem.onclick === "function") sourceItem.onclick(); };
            item.onkeydown = function (event) {
                if ((event.key === "Enter" || event.key === " ") && typeof sourceItem.onclick === "function") {
                    event.preventDefault();
                    sourceItem.onclick();
                }
            };
        });
    }

    async function changePortalPassword(event) {
        const button = stopButtonDefault(event);
        if (!currentUser || !currentUser.email) {
            showMessage("profilePasswordMessage", "Please login again before changing your password.");
            return;
        }
        const currentPassword = getValue("profileCurrentPassword");
        const newPassword = getValue("profileNewPassword");
        const confirmPassword = getValue("profileConfirmPassword");
        if (!currentPassword || !newPassword || !confirmPassword) {
            showMessage("profilePasswordMessage", "Please complete all password fields.");
            return;
        }
        if (newPassword.length < 6) {
            showMessage("profilePasswordMessage", "New password must contain at least 6 characters.");
            return;
        }
        if (newPassword !== confirmPassword) {
            showMessage("profilePasswordMessage", "New password and confirmation do not match.");
            return;
        }
        setButtonBusy(button, true, "Updating...");
        showMessage("profilePasswordMessage", "");
        try {
            const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPassword);
            await currentUser.reauthenticateWithCredential(credential);
            await currentUser.updatePassword(newPassword);
            setValue("profileCurrentPassword", "");
            setValue("profileNewPassword", "");
            setValue("profileConfirmPassword", "");
            showMessage("profilePasswordMessage", "Password updated successfully.");
        } catch (error) {
            console.error("Change password error:", error);
            showMessage("profilePasswordMessage", getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function sendPortalPasswordReset(event) {
        const button = stopButtonDefault(event);
        if (!currentUser || !currentUser.email) {
            showMessage("profilePasswordMessage", "Please login again before requesting a reset link.");
            return;
        }
        setButtonBusy(button, true, "Sending...");
        showMessage("profilePasswordMessage", "");
        try {
            await auth.sendPasswordResetEmail(currentUser.email);
            showMessage("profilePasswordMessage", `Password reset link sent to ${currentUser.email}.`);
        } catch (error) {
            console.error("Password reset email error:", error);
            showMessage("profilePasswordMessage", getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }

    /* =========================================================
       ADMIN JOB CARD -> QUOTATION / INVOICE WORKSPACE
    ========================================================= */

    function normaliseFinancialDocumentType(value) {
        return String(value || "quotation").toLowerCase() === "invoice" ? "invoice" : "quotation";
    }

    function financialCollectionName(type) {
        return normaliseFinancialDocumentType(type) === "invoice" ? "invoices" : "quotations";
    }

    function financialDocumentLabel(type) {
        return normaliseFinancialDocumentType(type) === "invoice" ? "TAX INVOICE" : "QUOTATION";
    }

    function formatMoney(value) {
        const number = Number(value || 0);
        return Number.isFinite(number) ? number.toFixed(2) : "0.00";
    }

    function todayInputValue() {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - offset).toISOString().slice(0, 10);
    }

    function formatDisplayDate(value) {
        if (!value) return "--/--/----";
        const parts = String(value).split("-");
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return value;
    }

    function getFinancialFormData() {
        const quantity = Math.max(0, Number(getValue("financialQuantity") || 0));
        const rate = Math.max(0, Number(getValue("financialRate") || 0));
        const vatPercent = Math.max(0, Number(getValue("financialVatPercent") || 0));
        const amount = quantity * rate;
        const vatAmount = amount * (vatPercent / 100);
        const total = amount + vatAmount;
        const documentType = normaliseFinancialDocumentType(getValue("financialDocumentType"));

        return {
            documentType: documentType,
            documentLabel: financialDocumentLabel(documentType),
            documentNumber: getValue("financialDocumentNumber"),
            documentDate: getValue("financialDocumentDate") || todayInputValue(),
            sourceJobCardId: getValue("financialSourceJobCardId"),
            customerName: getValue("financialCustomerName"),
            customerEmail: getValue("financialCustomerEmail"),
            company: getValue("financialCompany"),
            address: getValue("financialAddress"),
            description: getValue("financialDescription"),
            additionalNote: getValue("financialAdditionalNote"),
            quantity: quantity,
            rate: rate,
            vatPercent: vatPercent,
            approvalStatus: getValue("financialApprovalStatus") || "Draft",
            amount: amount,
            vatAmount: vatAmount,
            total: total,
            sourceOwnerUid: currentSelectedJobCardData && currentSelectedJobCardData.uid ? currentSelectedJobCardData.uid : ""
        };
    }

    function updateFinancialDocumentPreview(data) {
        const doc = data || getFinancialFormData();
        const documentNumber = doc.documentNumber || `${FINANCIAL_DOCUMENT_PREFIXES[doc.documentType] || "CQQ"}-000000`;
        const customerName = doc.customerName || "Customer Name";
        const company = doc.company || "Company Name";
        const address = doc.address || "Customer Address";
        const description = doc.description || "Service description";
        const additionalNote = doc.additionalNote || (doc.sourceJobCardId ? `Source Job Card: ${doc.sourceJobCardId}` : "Job card reference / note");

        setText("financialPdfTitle", doc.documentLabel || financialDocumentLabel(doc.documentType));
        setText("financialPdfNumber", documentNumber);
        setText("financialPdfDate", formatDisplayDate(doc.documentDate));
        setText("financialPdfCustomerName", customerName);
        setText("financialPdfCompany", company);
        setText("financialPdfAddress", address);
        setText("financialPdfDescription", description);
        setText("financialPdfAdditionalNote", additionalNote);
        setText("financialPdfQuantity", formatMoney(doc.quantity));
        setText("financialPdfRate", formatMoney(doc.rate));
        setText("financialPdfAmount", formatMoney(doc.amount));
        setText("financialPdfVatPercent", `${formatMoney(doc.vatPercent)}%`);
        setText("financialPdfVatAmount", formatMoney(doc.vatAmount));
        setText("financialPdfTotal", `AED${formatMoney(doc.total)}`);
        setText("financialAmountPreview", `AED${formatMoney(doc.amount)}`);
        setText("financialVatPreview", `AED${formatMoney(doc.vatAmount)}`);
        setText("financialTotalPreview", `AED${formatMoney(doc.total)}`);
    }

    function initialiseFinancialWorkspace() {
        const dateField = getElement("financialDocumentDate");
        if (dateField && !dateField.value) dateField.value = todayInputValue();

        const quantity = getElement("financialQuantity");
        if (quantity && !quantity.value) quantity.value = "1";

        const vat = getElement("financialVatPercent");
        if (vat && !vat.value) vat.value = "5";

        enableFinancialDocumentPreview();
        updateFinancialDocumentPreview(getFinancialFormData());
    }

    function enableFinancialDocumentPreview() {
        [
            "financialDocumentType", "financialDocumentNumber", "financialDocumentDate",
            "financialCustomerName", "financialCustomerEmail", "financialCompany",
            "financialAddress", "financialDescription", "financialAdditionalNote",
            "financialQuantity", "financialRate", "financialVatPercent", "financialApprovalStatus"
        ].forEach(function (id) {
            const field = getElement(id);
            if (!field || field.dataset.finPreviewBound === "yes") return;
            field.dataset.finPreviewBound = "yes";

            field.addEventListener("input", function () {
                updateFinancialDocumentPreview(getFinancialFormData());
            });
            field.addEventListener("change", function () {
                if (id === "financialDocumentType" && !currentFinancialDocumentId) {
                    currentFinancialDocumentType = normaliseFinancialDocumentType(field.value);
                }
                updateFinancialDocumentPreview(getFinancialFormData());
            });
        });
    }

    async function createUniqueFinancialDocumentNumber(type) {
        const safeType = normaliseFinancialDocumentType(type);
        const collection = financialCollectionName(safeType);
        const prefix = FINANCIAL_DOCUMENT_PREFIXES[safeType] || "CQQ";

        for (let attempt = 0; attempt < 8; attempt += 1) {
            const stamp = String(Date.now()).slice(-6);
            const random = String(Math.floor(Math.random() * 90) + 10);
            const id = `${prefix}-${stamp}${random}`;
            const existing = await db.collection(collection).doc(id).get();
            if (!existing.exists) return id;
        }

        return `${prefix}-${Date.now()}`;
    }

    async function prepareNewFinancialDocumentNumber() {
        if (!isAdminProfile()) return;
        currentFinancialDocumentId = null;
        const type = normaliseFinancialDocumentType(getValue("financialDocumentType"));
        const number = await createUniqueFinancialDocumentNumber(type);
        setValue("financialDocumentNumber", number);
        updateFinancialDocumentPreview(getFinancialFormData());
    }

    function sortTimestampDescending(a, b) {
        const aValue = a && a.data && a.data.updatedAt && typeof a.data.updatedAt.toMillis === "function" ? a.data.updatedAt.toMillis() : 0;
        const bValue = b && b.data && b.data.updatedAt && typeof b.data.updatedAt.toMillis === "function" ? b.data.updatedAt.toMillis() : 0;
        return bValue - aValue;
    }

    async function loadAdminJobCards() {
        if (!isAdminProfile()) return;
        const list = getElement("adminJobCardList");
        const summary = getElement("adminJobCardSummary");
        if (!list) return;

        list.innerHTML = "Loading all job cards...";
        if (summary) summary.innerText = "";

        try {
            const snapshot = await db.collection("jobCards").get();
            const cards = [];
            snapshot.forEach(function (doc) {
                cards.push({ id: doc.id, data: doc.data() || {} });
            });
            cards.sort(sortTimestampDescending);

            list.innerHTML = "";
            if (summary) summary.innerText = `${cards.length} job card${cards.length === 1 ? "" : "s"} available for conversion.`;

            if (!cards.length) {
                list.innerHTML = "<p>No job cards found.</p>";
                return;
            }

            cards.forEach(function (record) {
                const data = record.data;
                const item = document.createElement("div");
                item.className = "saved-item";
                item.setAttribute("role", "button");
                item.tabIndex = 0;
                item.appendChild(createSafeTextElement("strong", data.jobCardId || record.id));
                item.appendChild(createSafeTextElement("span", `${data.clientCompany || data.clientName || "Customer"} | ${data.email || "No customer email"}`));
                item.appendChild(createSafeTextElement("span", data.jobDescription || "No job description"));
                item.onclick = function () { prepareFinancialDocumentFromJobCard(record.id, data); };
                item.onkeydown = function (event) {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        prepareFinancialDocumentFromJobCard(record.id, data);
                    }
                };
                list.appendChild(item);
            });
        } catch (error) {
            console.error("Admin job card load error:", error);
            list.innerHTML = "<p>Unable to load all job cards. Publish the updated Firestore admin rules first.</p>";
            if (summary) summary.innerText = getErrorMessage(error);
        }
    }

    async function prepareFinancialDocumentFromJobCard(id, data) {
        if (!isAdminProfile()) return;
        currentFinancialDocumentId = null;
        currentFinancialDocumentType = normaliseFinancialDocumentType(getValue("financialDocumentType"));
        currentSelectedJobCardData = data || {};

        setValue("financialSourceJobCardId", data.jobCardId || id || "");
        setValue("financialCustomerName", data.clientName || "");
        setValue("financialCustomerEmail", data.email || "");
        setValue("financialCompany", data.clientCompany || "");
        setValue("financialAddress", data.clientAddress || "");
        setValue("financialDescription", data.jobDescription || "");
        setValue("financialAdditionalNote", data.jobCardId ? `Source Job Card: ${data.jobCardId}` : "");
        setValue("financialDocumentDate", todayInputValue());
        setValue("financialApprovalStatus", "Draft");
        if (!getValue("financialQuantity")) setValue("financialQuantity", "1");
        if (!getValue("financialVatPercent")) setValue("financialVatPercent", "5");

        await prepareNewFinancialDocumentNumber();
        updateFinancialDocumentPreview(getFinancialFormData());

        const form = getElement("financialDocumentForm");
        if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function saveFinancialDocument(event) {
        if (event) event.preventDefault();
        if (!isAdminProfile()) {
            alert("Only active admin accounts can save quotations and invoices.");
            return;
        }

        let data = getFinancialFormData();
        if (!data.sourceJobCardId) {
            alert("Select a source job card first.");
            return;
        }
        if (!data.customerName || !data.address || !data.description) {
            alert("Please fill customer name, address, and description.");
            return;
        }
        if (!data.documentNumber) {
            await prepareNewFinancialDocumentNumber();
            data = getFinancialFormData();
        }
        if (data.customerEmail && !isValidEmail(data.customerEmail)) {
            alert("Please enter a valid customer email address or leave it blank.");
            return;
        }

        if (currentFinancialDocumentId && data.documentType !== currentFinancialDocumentType) {
            currentFinancialDocumentId = null;
            await prepareNewFinancialDocumentNumber();
            data = getFinancialFormData();
        }

        const collection = financialCollectionName(data.documentType);
        const docId = data.documentNumber;
        currentFinancialDocumentId = docId;
        currentFinancialDocumentType = data.documentType;

        try {
            const payload = {
                uid: currentUser ? currentUser.uid : "",
                createdByUid: currentUser ? currentUser.uid : "",
                createdByEmail: currentUser ? currentUser.email : "",
                sourceJobCardId: data.sourceJobCardId,
                sourceOwnerUid: data.sourceOwnerUid || "",
                documentType: data.documentType,
                documentNumber: data.documentNumber,
                documentDate: data.documentDate,
                customerName: data.customerName,
                customerEmail: data.customerEmail,
                company: data.company,
                address: data.address,
                description: data.description,
                additionalNote: data.additionalNote,
                quantity: data.quantity,
                rate: data.rate,
                amount: data.amount,
                vatPercent: data.vatPercent,
                approvalStatus: data.approvalStatus || "Draft",
                vatAmount: data.vatAmount,
                total: data.total,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await db.collection(collection).doc(docId).set(payload, { merge: true });
            updateFinancialDocumentPreview(data);
            await syncWebsiteData(data.documentType, {
                reference: data.documentNumber,
                sourceJobCardId: data.sourceJobCardId,
                customerName: data.customerName,
                customerEmail: data.customerEmail,
                total: formatMoney(data.total)
            });
            await loadFinancialDocuments(data.documentType);
            await writeAuditLog("financial_document_saved", collection, docId, `${financialDocumentLabel(data.documentType)} ${docId} saved.`, { approvalStatus: data.approvalStatus || "Draft", total: formatMoney(data.total) });
            alert(`${financialDocumentLabel(data.documentType)} saved successfully.`);
        } catch (error) {
            console.error("Save financial document error:", error);
            alert(getErrorMessage(error));
        }
    }

    async function loadFinancialDocuments(type) {
        if (!isAdminProfile()) return;
        const safeType = normaliseFinancialDocumentType(type);
        const list = getElement(safeType === "invoice" ? "invoiceList" : "quotationList");
        if (!list) return;

        list.innerHTML = `Loading ${safeType}s...`;
        try {
            const snapshot = await db.collection(financialCollectionName(safeType)).get();
            const records = [];
            snapshot.forEach(function (doc) {
                records.push({ id: doc.id, data: doc.data() || {} });
            });
            records.sort(sortTimestampDescending);
            list.innerHTML = "";
            if (!records.length) {
                list.innerHTML = `<p>No ${safeType}s saved yet.</p>`;
                return;
            }

            records.forEach(function (record) {
                const data = record.data;
                const item = document.createElement("div");
                item.className = "saved-item";
                item.setAttribute("role", "button");
                item.tabIndex = 0;
                item.appendChild(createSafeTextElement("strong", data.documentNumber || record.id));
                item.appendChild(createSafeTextElement("span", `${data.customerName || "Customer"} | AED${formatMoney(data.total)}`));
                item.appendChild(createSafeTextElement("span", `Status: ${data.approvalStatus || "Draft"} | Source: ${data.sourceJobCardId || "No Job Card"}`));
                item.onclick = function () { openFinancialDocument(record.id, data, safeType); };
                item.onkeydown = function (event) {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openFinancialDocument(record.id, data, safeType);
                    }
                };
                list.appendChild(item);
            });
        } catch (error) {
            console.error("Load financial documents error:", error);
            list.innerHTML = `<p>Unable to load saved ${safeType}s.</p>`;
        }
    }

    function openFinancialDocument(id, data, type) {
        if (!isAdminProfile()) return;
        const safeType = normaliseFinancialDocumentType(type || data.documentType);
        currentFinancialDocumentId = id;
        currentFinancialDocumentType = safeType;
        currentSelectedJobCardData = { uid: data.sourceOwnerUid || "" };

        setValue("financialDocumentType", safeType);
        setValue("financialDocumentNumber", data.documentNumber || id);
        setValue("financialDocumentDate", data.documentDate || todayInputValue());
        setValue("financialSourceJobCardId", data.sourceJobCardId || "");
        setValue("financialCustomerName", data.customerName || "");
        setValue("financialCustomerEmail", data.customerEmail || "");
        setValue("financialCompany", data.company || "");
        setValue("financialAddress", data.address || "");
        setValue("financialDescription", data.description || "");
        setValue("financialAdditionalNote", data.additionalNote || "");
        setValue("financialQuantity", data.quantity != null ? data.quantity : "1");
        setValue("financialRate", data.rate != null ? data.rate : "0");
        setValue("financialVatPercent", data.vatPercent != null ? data.vatPercent : "5");
        setValue("financialApprovalStatus", data.approvalStatus || "Draft");
        updateFinancialDocumentPreview(getFinancialFormData());
    }

    function getFinancialPDFFileName() {
        const data = getFinancialFormData();
        const safeNumber = (data.documentNumber || "draft").replace(/[^A-Za-z0-9_.-]+/g, "-");
        const label = data.documentType === "invoice" ? "Invoice" : "Quotation";
        return `Conquer-${label}-${safeNumber}.pdf`;
    }

    const FINANCIAL_PDF_EXPORT_CSS = `
        #financialDocumentPDF,
        #financialDocumentPDFClone {
            width: 900px !important;
            min-height: 1120px !important;
            background: #ffffff !important;
            color: #111111 !important;
            margin: 0 !important;
            padding: 88px 54px 82px !important;
            overflow: hidden !important;
            position: relative !important;
            font-family: Georgia, 'Times New Roman', serif !important;
            border: 1px solid rgba(0, 0, 0, 0.08) !important;
        }

        #financialDocumentPDFClone .financial-top-band,
        #financialDocumentPDFClone .financial-bottom-band,
        #financialDocumentPDF .financial-top-band,
        #financialDocumentPDF .financial-bottom-band {
            position: absolute !important;
            left: 0 !important;
            width: 100% !important;
            height: 56px !important;
            background: #202126 !important;
            overflow: hidden !important;
        }
        #financialDocumentPDFClone .financial-top-band,
        #financialDocumentPDF .financial-top-band { top: 0 !important; }
        #financialDocumentPDFClone .financial-bottom-band,
        #financialDocumentPDF .financial-bottom-band { bottom: 0 !important; }

        #financialDocumentPDFClone .financial-corner,
        #financialDocumentPDF .financial-corner {
            position: absolute !important;
            width: 122px !important;
            height: 122px !important;
            border-radius: 50% !important;
            background: #d29437 !important;
            border: 4px solid #202126 !important;
        }
        #financialDocumentPDFClone .financial-top-band .financial-corner-left,
        #financialDocumentPDF .financial-top-band .financial-corner-left { left: -47px !important; top: -68px !important; }
        #financialDocumentPDFClone .financial-top-band .financial-corner-right,
        #financialDocumentPDF .financial-top-band .financial-corner-right { right: -47px !important; top: -68px !important; }
        #financialDocumentPDFClone .financial-bottom-band .financial-corner-left,
        #financialDocumentPDF .financial-bottom-band .financial-corner-left { left: -47px !important; bottom: -68px !important; }
        #financialDocumentPDFClone .financial-bottom-band .financial-corner-right,
        #financialDocumentPDF .financial-bottom-band .financial-corner-right { right: -47px !important; bottom: -68px !important; }

        #financialDocumentPDFClone .financial-header,
        #financialDocumentPDF .financial-header { display: grid !important; grid-template-columns: 154px 1fr 220px !important; align-items: start !important; gap: 18px !important; min-height: 138px !important; }
        #financialDocumentPDFClone .financial-logo img,
        #financialDocumentPDF .financial-logo img { width: 146px !important; height: 118px !important; object-fit: contain !important; border: 1px solid rgba(119, 116, 15, .35) !important; }
        #financialDocumentPDFClone .financial-company h2,
        #financialDocumentPDFClone .financial-header h3,
        #financialDocumentPDF .financial-company h2,
        #financialDocumentPDF .financial-header h3 { margin: 0 !important; color: #717300 !important; font-family: Georgia, 'Times New Roman', serif !important; font-weight: 700 !important; }
        #financialDocumentPDFClone .financial-company h2,
        #financialDocumentPDF .financial-company h2 { margin-top: 4px !important; font-size: 27px !important; }
        #financialDocumentPDFClone .financial-company p,
        #financialDocumentPDF .financial-company p { margin: 7px 0 !important; color: #111 !important; font-size: 15px !important; font-weight: 700 !important; line-height: 1.2 !important; }
        #financialDocumentPDFClone .financial-header h3,
        #financialDocumentPDF .financial-header h3 { text-align: right !important; font-size: 28px !important; line-height: 1.15 !important; text-transform: uppercase !important; }
        #financialDocumentPDFClone .financial-client-row,
        #financialDocumentPDF .financial-client-row { display: grid !important; grid-template-columns: 1fr 290px !important; gap: 32px !important; align-items: center !important; margin-top: 44px !important; min-height: 132px !important; }
        #financialDocumentPDFClone .financial-to h4,
        #financialDocumentPDF .financial-to h4 { margin: 0 0 12px !important; font-size: 26px !important; font-weight: 700 !important; color: #111 !important; }
        #financialDocumentPDFClone .financial-to p,
        #financialDocumentPDF .financial-to p { margin: 7px 0 !important; font-size: 17px !important; color: #111 !important; font-weight: 700 !important; line-height: 1.3 !important; white-space: pre-wrap !important; word-break: break-word !important; }
        #financialDocumentPDFClone .financial-meta,
        #financialDocumentPDF .financial-meta { display: grid !important; gap: 18px !important; font-size: 17px !important; }
        #financialDocumentPDFClone .financial-meta div,
        #financialDocumentPDF .financial-meta div { display: grid !important; grid-template-columns: 72px 1fr !important; gap: 14px !important; align-items: center !important; }
        #financialDocumentPDFClone .financial-meta span,
        #financialDocumentPDFClone .financial-total-line span,
        #financialDocumentPDF .financial-meta span,
        #financialDocumentPDF .financial-total-line span { color: #717300 !important; font-weight: 700 !important; }
        #financialDocumentPDFClone .financial-meta strong,
        #financialDocumentPDF .financial-meta strong { text-align: right !important; color: #111 !important; font-weight: 700 !important; }
        #financialDocumentPDFClone .financial-pill-row,
        #financialDocumentPDF .financial-pill-row { display: grid !important; grid-template-columns: 1fr 310px !important; gap: 32px !important; align-items: center !important; margin-top: 28px !important; }
        #financialDocumentPDFClone .financial-pill-row span,
        #financialDocumentPDF .financial-pill-row span { display: block !important; padding: 6px 18px 7px !important; border-radius: 999px !important; border: 2px solid #111 !important; background: #878900 !important; color: #111 !important; text-align: center !important; font-size: 15px !important; font-weight: 700 !important; }
        #financialDocumentPDFClone .financial-table,
        #financialDocumentPDF .financial-table { width: 100% !important; margin-top: 8px !important; border-collapse: collapse !important; table-layout: fixed !important; color: #111 !important; font-family: Georgia, 'Times New Roman', serif !important; }
        #financialDocumentPDFClone .financial-table th,
        #financialDocumentPDFClone .financial-table td,
        #financialDocumentPDF .financial-table th,
        #financialDocumentPDF .financial-table td { border-left: 1px solid #111 !important; border-right: 1px solid #111 !important; padding: 5px 8px !important; vertical-align: top !important; font-size: 16px !important; line-height: 1.25 !important; word-break: break-word !important; }
        #financialDocumentPDFClone .financial-table thead th,
        #financialDocumentPDF .financial-table thead th { background: #878900 !important; border-top: 2px solid #111 !important; border-bottom: 2px solid #111 !important; font-weight: 700 !important; text-align: center !important; padding-top: 4px !important; padding-bottom: 4px !important; }
        #financialDocumentPDFClone .financial-table th:nth-child(1), #financialDocumentPDFClone .financial-table td:nth-child(1),
        #financialDocumentPDF .financial-table th:nth-child(1), #financialDocumentPDF .financial-table td:nth-child(1) { width: 72px !important; text-align: center !important; }
        #financialDocumentPDFClone .financial-table th:nth-child(3), #financialDocumentPDFClone .financial-table td:nth-child(3),
        #financialDocumentPDF .financial-table th:nth-child(3), #financialDocumentPDF .financial-table td:nth-child(3) { width: 100px !important; text-align: center !important; }
        #financialDocumentPDFClone .financial-table th:nth-child(4), #financialDocumentPDFClone .financial-table td:nth-child(4),
        #financialDocumentPDFClone .financial-table th:nth-child(5), #financialDocumentPDFClone .financial-table td:nth-child(5),
        #financialDocumentPDF .financial-table th:nth-child(4), #financialDocumentPDF .financial-table td:nth-child(4),
        #financialDocumentPDF .financial-table th:nth-child(5), #financialDocumentPDF .financial-table td:nth-child(5) { width: 100px !important; text-align: right !important; }
        #financialDocumentPDFClone .financial-note-row td,
        #financialDocumentPDF .financial-note-row td { background: #e8e8e8 !important; border-top: 0 !important; border-bottom: 0 !important; }
        #financialDocumentPDFClone .financial-tax-row td,
        #financialDocumentPDF .financial-tax-row td { border-left: 0 !important; border-right: 0 !important; font-size: 16px !important; padding-top: 10px !important; }
        #financialDocumentPDFClone .financial-tax-row td:nth-child(2),
        #financialDocumentPDF .financial-tax-row td:nth-child(2) { padding-left: 16px !important; }
        #financialDocumentPDFClone .financial-bottom-row,
        #financialDocumentPDF .financial-bottom-row { display: grid !important; grid-template-columns: 1fr 290px !important; gap: 42px !important; align-items: end !important; min-height: 355px !important; margin-top: 26px !important; }
        #financialDocumentPDFClone .financial-bank-rule,
        #financialDocumentPDF .financial-bank-rule { width: 430px !important; max-width: 100% !important; height: 18px !important; border-top: 3px solid #717300 !important; border-bottom: 3px solid #717300 !important; margin-bottom: 12px !important; }
        #financialDocumentPDFClone .financial-bank p,
        #financialDocumentPDF .financial-bank p { margin: 10px 0 !important; color: #111 !important; font-size: 16px !important; line-height: 1.25 !important; font-weight: 700 !important; }
        #financialDocumentPDFClone .financial-total-sign,
        #financialDocumentPDF .financial-total-sign { display: grid !important; gap: 34px !important; justify-items: stretch !important; }
        #financialDocumentPDFClone .financial-total-line,
        #financialDocumentPDF .financial-total-line { display: grid !important; grid-template-columns: 1fr auto !important; gap: 18px !important; align-items: end !important; padding-bottom: 12px !important; border-bottom: 3px solid #717300 !important; position: relative !important; color: #111 !important; font-size: 18px !important; }
        #financialDocumentPDFClone .financial-total-line::after,
        #financialDocumentPDF .financial-total-line::after { content: '' !important; position: absolute !important; left: 66px !important; right: 0 !important; bottom: -14px !important; border-bottom: 3px solid #717300 !important; }
        #financialDocumentPDFClone .financial-total-line strong,
        #financialDocumentPDF .financial-total-line strong { color: #111 !important; font-weight: 700 !important; }
        #financialDocumentPDFClone .financial-signature,
        #financialDocumentPDF .financial-signature { text-align: center !important; color: #717300 !important; }
        #financialDocumentPDFClone .financial-stamp-placeholder,
        #financialDocumentPDF .financial-stamp-placeholder { min-height: 72px !important; padding: 20px 8px !important; border: 2px dashed rgba(113, 115, 0, 0.6) !important; color: rgba(113, 115, 0, 0.9) !important; font-size: 14px !important; font-weight: 700 !important; transform: rotate(-6deg) !important; }
        #financialDocumentPDFClone .financial-signature em,
        #financialDocumentPDF .financial-signature em { display: block !important; margin-top: 14px !important; font-size: 16px !important; font-style: italic !important; }
        #financialDocumentPDFClone .financial-footer,
        #financialDocumentPDF .financial-footer { position: absolute !important; left: 54px !important; right: 54px !important; bottom: 84px !important; text-align: center !important; }
        #financialDocumentPDFClone .financial-footer p,
        #financialDocumentPDF .financial-footer p { margin: 4px 0 !important; color: #717300 !important; font-size: 16px !important; font-style: italic !important; font-weight: 700 !important; }
    `;

    function createFinancialPDFExportPage() {
        const source = getElement("financialDocumentPDF") || document.getElementById("financialDocumentPDF");
        if (!source) throw new Error("Quotation / invoice preview not found.");

        const wrapper = document.createElement("div");
        wrapper.id = "financialPdfExportWrapper";
        wrapper.style.position = "fixed";
        wrapper.style.left = "-10000px";
        wrapper.style.top = "0";
        wrapper.style.width = PDF_PAGE_WIDTH + "px";
        wrapper.style.height = PDF_PAGE_HEIGHT + "px";
        wrapper.style.background = "#ffffff";
        wrapper.style.color = "#111111";
        wrapper.style.zIndex = "1";
        wrapper.style.pointerEvents = "none";
        wrapper.style.overflow = "hidden";
        wrapper.style.contain = "layout style paint";
        wrapper.setAttribute("aria-hidden", "true");

        const style = document.createElement("style");
        style.innerHTML = PDF_EXPORT_CSS + FINANCIAL_PDF_EXPORT_CSS;
        const page = document.createElement("div");
        page.className = "pdf-export-page";
        const clone = source.cloneNode(true);
        clone.id = "financialDocumentPDFClone";
        syncFormControlsToClone(source, clone);
        removeDuplicateIdsInsideClone(clone);
        page.appendChild(clone);
        wrapper.appendChild(style);
        wrapper.appendChild(page);
        document.body.appendChild(wrapper);
        fitCloneToPage(page, clone);
        return { wrapper: wrapper, page: page, clone: clone };
    }

    async function generateFinancialPDFBlob() {
        updateFinancialDocumentPreview(getFinancialFormData());
        if (!window.html2canvas) throw new Error("html2canvas is not loaded.");
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jsPDF is not loaded.");

        const pdfExport = createFinancialPDFExportPage();
        try {
            await waitForPDFRender(pdfExport.wrapper);
            const captureScale = isTouchMobileBrowser() ? 1.5 : 2;
            const canvas = await html2canvas(pdfExport.page, {
                scale: captureScale,
                useCORS: true,
                allowTaint: true,
                backgroundColor: "#ffffff",
                width: PDF_PAGE_WIDTH,
                height: PDF_PAGE_HEIGHT,
                windowWidth: PDF_PAGE_WIDTH,
                windowHeight: PDF_PAGE_HEIGHT,
                scrollX: 0,
                scrollY: 0,
                logging: false
            });
            if (!canvas || canvas.width <= 1 || canvas.height <= 1) throw new Error("PDF capture failed. Canvas is empty.");
            const imgData = canvas.toDataURL("image/png");
            const jsPDF = window.jspdf.jsPDF;
            const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT], compress: true });
            pdf.addImage(imgData, "PNG", 0, 0, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT);
            const pdfBlob = pdf.output("blob");
            if (!pdfBlob || pdfBlob.size < 1000) throw new Error("Generated PDF is empty.");
            return pdfBlob;
        } finally {
            if (pdfExport.wrapper && pdfExport.wrapper.parentNode) pdfExport.wrapper.parentNode.removeChild(pdfExport.wrapper);
        }
    }

    async function downloadFinancialPDF(event) {
        const button = stopButtonDefault(event);
        const scrollPosition = rememberScrollPosition();
        try {
            await showPDFActionLoader("Preparing PDF...", "Creating the quotation or invoice file. Please wait.");
            setButtonBusy(button, true, "Preparing PDF...");
            const pdfBlob = await generateFinancialPDFBlob();
            updatePDFActionLoader("Downloading PDF...", "Your PDF is ready. The download will start now.");
            await savePDFBlobToDevice(pdfBlob, getFinancialPDFFileName());
        } catch (error) {
            console.error("Financial PDF download error:", error);
            alert("PDF download failed. " + getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
            await hidePDFActionLoader();
            restoreScrollPosition(scrollPosition);
        }
    }

    function buildFinancialPrintHTML(printContent) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Quotation / Invoice</title>
                <base href="${document.baseURI}">
                <style>
                    ${PDF_EXPORT_CSS}
                    ${FINANCIAL_PDF_EXPORT_CSS}
                    @page { size: A4 portrait; margin: 0; }
                    html, body { margin: 0 !important; padding: 0 !important; width: 210mm !important; min-height: 297mm !important; background: #fff !important; overflow: hidden !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                    .pdf-export-page { width: 210mm !important; height: 297mm !important; margin: 0 auto !important; overflow: hidden !important; background: #fff !important; }
                    #financialDocumentPDFClone { transform-origin: top left !important; }
                </style>
            </head>
            <body>${printContent}</body>
            </html>`;
    }

    async function printFinancialPDF(event) {
        const button = stopButtonDefault(event);
        const scrollPosition = rememberScrollPosition();
        let pdfExport = null;
        try {
            await showPDFActionLoader("Preparing Print...", "Building the quotation or invoice print layout.");
            setButtonBusy(button, true, "Preparing Print...");
            updateFinancialDocumentPreview(getFinancialFormData());
            pdfExport = createFinancialPDFExportPage();
            await waitForPDFRender(pdfExport.wrapper);
            const printContent = pdfExport.page.outerHTML;
            if (pdfExport.wrapper && pdfExport.wrapper.parentNode) pdfExport.wrapper.parentNode.removeChild(pdfExport.wrapper);
            pdfExport = null;
            updatePDFActionLoader("Opening Print Window...", "The browser print dialog will open now.");
            await printHTMLInHiddenFrame(buildFinancialPrintHTML(printContent));
        } catch (error) {
            console.error("Financial print error:", error);
            alert("Print failed. " + getErrorMessage(error));
        } finally {
            if (pdfExport && pdfExport.wrapper && pdfExport.wrapper.parentNode) pdfExport.wrapper.parentNode.removeChild(pdfExport.wrapper);
            setButtonBusy(button, false);
            await hidePDFActionLoader();
            restoreScrollPosition(scrollPosition);
        }
    }

    async function sendFinancialPDFEmail(event) {
        const button = stopButtonDefault(event);
        const scrollPosition = rememberScrollPosition();
        if (!isAdminProfile()) {
            alert("Only active admin accounts can email quotations and invoices.");
            return;
        }

        let data = getFinancialFormData();
        if (!data.documentNumber || !data.sourceJobCardId) {
            alert("Please select a job card and save or generate the document number first.");
            return;
        }
        if (!data.customerEmail || !isValidEmail(data.customerEmail)) {
            alert("Please enter a valid customer email address before sending.");
            return;
        }

        try {
            await showPDFActionLoader("Preparing Email...", "Generating the quotation or invoice PDF before sending it.");
            setButtonBusy(button, true, "Sending PDF...");
            const pdfBlob = await generateFinancialPDFBlob();
            const pdfBase64 = await blobToBase64(pdfBlob);
            data = getFinancialFormData();
            updatePDFActionLoader("Sending Email...", "Please wait while we email the PDF to the customer and company.");

            const response = await fetch("job-pdf-email-handler.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentType: financialDocumentLabel(data.documentType),
                    jobCardId: data.sourceJobCardId,
                    documentNumber: data.documentNumber,
                    clientName: data.customerName,
                    clientEmail: data.customerEmail,
                    companyEmail: COMPANY_EMAIL,
                    serviceDetails: data.description,
                    fileName: getFinancialPDFFileName(),
                    pdfBase64: pdfBase64
                })
            });
            const result = await response.json().catch(function () { return { success: false, message: "Invalid server response." }; });
            if (!response.ok || !result.success) throw new Error(result.message || "PDF email could not be sent.");
            await syncWebsiteData("financial_pdf_email", {
                reference: data.documentNumber,
                documentType: data.documentType,
                sourceJobCardId: data.sourceJobCardId,
                customerName: data.customerName,
                customerEmail: data.customerEmail,
                fileName: getFinancialPDFFileName(),
                companySent: result.companySent ? "yes" : "no",
                clientSent: result.clientSent ? "yes" : "no"
            });
            alert(result.message || "PDF email sent successfully.");
        } catch (error) {
            console.error("Send financial PDF email error:", error);
            alert("PDF email could not be sent. " + getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
            await hidePDFActionLoader();
            restoreScrollPosition(scrollPosition);
        }
    }



    /* =========================================================
       PHASE 2 OPERATIONS: ADMIN JOB INTAKE, SUPPORT, AMC,
       INVENTORY, REPORTING, AUDIT, AND STATUS EMAILS
    ========================================================= */

    function startOfLocalDay(date) {
        const value = date instanceof Date ? new Date(date.getTime()) : new Date(date || Date.now());
        value.setHours(0, 0, 0, 0);
        return value;
    }

    function dateInputToMillis(value) {
        if (!value) return 0;
        const parsed = new Date(String(value).includes("T") ? value : `${value}T23:59:59`);
        return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }

    function isJobSlaOverdue(job, today) {
        const data = job || {};
        if (["Closed", "Delivered", "Completed"].includes(String(data.workflowStatus || "New"))) return false;
        const resolveAt = dateInputToMillis(data.slaResolveBy || data.jobDueDate || "");
        if (!resolveAt) return false;
        const base = today instanceof Date ? today.getTime() : Date.now();
        return resolveAt < base;
    }

    function isJobAtRisk(job) {
        const data = job || {};
        if (["Closed", "Delivered", "Completed"].includes(String(data.workflowStatus || "New"))) return false;
        const resolveAt = dateInputToMillis(data.slaResolveBy || data.jobDueDate || "");
        if (!resolveAt) return false;
        const hoursRemaining = (resolveAt - Date.now()) / 3600000;
        return hoursRemaining >= 0 && hoursRemaining <= 48;
    }

    function populateAdminCreateStaffSelect() {
        const select = getElement("adminJobAssignedStaff");
        if (!select) return;
        const selected = select.value || "";
        select.innerHTML = "";
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Unassigned";
        select.appendChild(empty);
        assignableStaffDirectory.forEach(function (staff) {
            const option = document.createElement("option");
            option.value = staff.uid || "";
            option.dataset.email = staff.email || "";
            option.dataset.name = staff.name || staff.email || "Staff";
            option.textContent = staff.name || staff.email || "Staff";
            option.selected = selected && selected === option.value;
            select.appendChild(option);
        });
    }

    function resetAdminCreateJobCardForm() {
        const form = getElement("adminJobCardCreateForm");
        if (form) form.reset();
        setValue("adminJobOrderDate", todayInputValue());
        setValue("adminJobPriority", "Normal");
        setValue("adminJobStatus", "New");
        setValue("adminJobSource", "Admin");
        showMessage("adminCreateJobCardMessage", "");
    }

    async function resolveAdminJobOwner(ownerEmail) {
        const email = String(ownerEmail || "").trim().toLowerCase();
        if (!email) return null;
        const snapshot = await db.collection("users").where("email", "==", email).limit(1).get();
        let match = null;
        snapshot.forEach(function (doc) {
            const profile = normalizeAccountProfile({ uid: doc.id, email: doc.data().email || email }, doc.data() || {});
            if (profile.allowed && profile.accountStatus === "active") {
                match = { uid: doc.id, profile: profile };
            }
        });
        return match;
    }

    async function adminCreateJobCard(event) {
        if (event) event.preventDefault();
        if (!isAdminProfile()) return;
        const customerName = getValue("adminJobCustomerName");
        const customerEmail = getValue("adminJobCustomerEmail");
        const address = getValue("adminJobAddress");
        const description = getValue("adminJobDescription");
        const orderDate = getValue("adminJobOrderDate") || todayInputValue();
        if (!customerName || !address || !description || !orderDate) {
            showMessage("adminCreateJobCardMessage", "Please complete customer name, address, job description, and order date.");
            return;
        }
        if (customerEmail && !isValidEmail(customerEmail)) {
            showMessage("adminCreateJobCardMessage", "Please enter a valid customer email or leave it blank.");
            return;
        }
        const button = event && event.currentTarget ? event.currentTarget.querySelector('button[type="submit"]') : null;
        setButtonBusy(button, true, "Creating...");
        showMessage("adminCreateJobCardMessage", "Creating job card...");
        try {
            await loadAssignableStaffDirectory();
            populateAdminCreateStaffSelect();
            const id = await createUniqueJobCardId();
            const ownerMatch = await resolveAdminJobOwner(getValue("adminJobOwnerEmail"));
            const staffSelect = getElement("adminJobAssignedStaff");
            const staffOption = staffSelect && staffSelect.selectedOptions ? staffSelect.selectedOptions[0] : null;
            const assignedStaffUid = staffSelect ? staffSelect.value : "";
            const assignedStaffEmail = staffOption ? (staffOption.dataset.email || "") : "";
            const assignedStaffName = staffOption ? (staffOption.dataset.name || staffOption.textContent || "") : "";
            const ownerUid = ownerMatch ? ownerMatch.uid : (currentUser ? currentUser.uid : "");
            const recordEmail = ownerMatch ? ownerMatch.profile.email : customerEmail;
            const payload = {
                uid: ownerUid,
                email: recordEmail || "",
                ownerAccountEmail: ownerMatch ? ownerMatch.profile.email : "",
                createdByUid: currentUser ? currentUser.uid : "",
                createdByEmail: currentUser ? currentUser.email : "",
                createdVia: "admin-dashboard",
                adminCreated: true,
                jobCardId: id,
                clientName: customerName,
                clientCompany: getValue("adminJobCompany"),
                clientPhone: getValue("adminJobPhone"),
                customerId: getValue("adminJobCustomerId"),
                clientAddress: address,
                jobDescription: description,
                orderDate: orderDate,
                jobDueDate: getValue("adminJobDueDate"),
                visitDate: getValue("adminJobVisitDate"),
                visitTime: getValue("adminJobVisitTime"),
                workflowStatus: getValue("adminJobStatus") || (assignedStaffUid ? "Assigned" : "New"),
                jobPriority: getValue("adminJobPriority") || "Normal",
                leadSource: getValue("adminJobSource") || "Admin",
                slaResponseBy: getValue("adminJobSlaResponseBy"),
                slaResolveBy: getValue("adminJobSlaResolveBy"),
                assignedStaffUid: assignedStaffUid || "",
                assignedStaffEmail: assignedStaffEmail || "",
                assignedStaffName: assignedStaffUid ? assignedStaffName : "",
                deviceType: getValue("adminJobDeviceType"),
                deviceBrand: getValue("adminJobDeviceBrand"),
                deviceModel: getValue("adminJobDeviceModel"),
                deviceSerialNumber: getValue("adminJobDeviceSerial"),
                partsUsed: getValue("adminJobPartsUsed"),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await db.collection("jobCards").doc(id).set(payload, { merge: true });
            await syncWebsiteData("admin_job_card", {
                reference: id,
                clientName: payload.clientName,
                clientEmail: payload.email,
                status: payload.workflowStatus,
                assignedStaffName: payload.assignedStaffName,
                source: payload.leadSource
            });
            await writeAuditLog("admin_job_card_created", "jobCards", id, `Admin created job card ${id}.`, { workflowStatus: payload.workflowStatus, leadSource: payload.leadSource });
            showMessage("adminCreateJobCardMessage", `Job card ${id} created successfully.`);
            resetAdminCreateJobCardForm();
            showMessage("adminCreateJobCardMessage", `Job card ${id} created successfully.`);
            await Promise.all([loadAdminJobCards(), loadAdminWorkflowJobCards(), loadAdminOverviewMetrics(), loadAdminCustomerDeviceHistory(), loadAdminReportsAndAudit()]);
        } catch (error) {
            console.error("Admin create job card error:", error);
            showMessage("adminCreateJobCardMessage", getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function loadAdminSupportQueues() {
        if (!isAdminProfile()) return;
        await Promise.all([loadAdminComplaints(), loadAdminDeliveryNotes()]);
    }

    function createStatusSelect(values, selectedValue, label) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", label || "Status");
        values.forEach(function (value) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            option.selected = String(selectedValue || "") === value;
            select.appendChild(option);
        });
        return select;
    }

    async function loadAdminComplaints() {
        if (!isAdminProfile()) return;
        const list = getElement("adminComplaintList");
        const summary = getElement("adminComplaintSummary");
        if (!list) return;
        list.innerHTML = "Loading complaints...";
        if (summary) summary.innerText = "";
        try {
            const snapshot = await db.collection("complaints").get();
            const records = [];
            snapshot.forEach(function (doc) { records.push({ id: doc.id, data: doc.data() || {} }); });
            records.sort(sortTimestampDescending);
            list.innerHTML = "";
            const open = records.filter(function (record) { return !["Resolved", "Closed"].includes(String(record.data.status || "Open")); }).length;
            if (summary) summary.innerText = `${records.length} complaint${records.length === 1 ? "" : "s"} | ${open} open`;
            if (!records.length) {
                list.innerHTML = "<p>No complaints found.</p>";
                return;
            }
            records.forEach(function (record) {
                const data = record.data;
                const row = document.createElement("article");
                row.className = "support-admin-row";
                const intro = document.createElement("div");
                intro.appendChild(createSafeTextElement("strong", data.subject || record.id));
                intro.appendChild(createSafeTextElement("span", `${data.clientName || data.email || "Customer"} · ${data.type || "General"}`));
                intro.appendChild(createSafeTextElement("small", data.details || "No details"));
                const controls = document.createElement("div");
                controls.className = "support-admin-controls";
                const status = createStatusSelect(["Open", "In Review", "Assigned", "Resolved", "Closed"], data.status || "Open", "Complaint status");
                const save = document.createElement("button");
                save.type = "button";
                save.className = "btn-outline admin-save-btn";
                save.textContent = "Save Status";
                save.onclick = function () { updateAdminComplaintStatus(record.id, status.value, save); };
                const convert = document.createElement("button");
                convert.type = "button";
                convert.className = "btn-outline admin-save-btn";
                convert.textContent = "Create Job Card";
                convert.onclick = function () { createJobCardFromComplaint(record.id, data, convert); };
                controls.appendChild(status);
                controls.appendChild(save);
                controls.appendChild(convert);
                row.appendChild(intro);
                row.appendChild(controls);
                list.appendChild(row);
            });
        } catch (error) {
            console.error("Admin complaint load error:", error);
            list.innerHTML = "<p>Unable to load complaints.</p>";
            if (summary) summary.innerText = getErrorMessage(error);
        }
    }

    async function updateAdminComplaintStatus(id, status, button) {
        if (!isAdminProfile()) return;
        setButtonBusy(button, true, "Saving...");
        try {
            await db.collection("complaints").doc(id).set({ status: status || "Open", updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            await syncWebsiteData("complaint_status", { reference: id, status: status || "Open" });
            await writeAuditLog("complaint_status_updated", "complaints", id, `Complaint ${id} marked ${status || "Open"}.`, { status: status || "Open" });
            await Promise.all([loadAdminComplaints(), loadAdminOverviewMetrics(), loadAdminReportsAndAudit()]);
        } catch (error) {
            console.error("Complaint status update error:", error);
            alert(getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function createJobCardFromComplaint(id, data, button) {
        if (!isAdminProfile()) return;
        setButtonBusy(button, true, "Creating...");
        try {
            const jobId = await createUniqueJobCardId();
            const payload = {
                uid: data.uid || (currentUser ? currentUser.uid : ""),
                email: data.email || "",
                createdByUid: currentUser ? currentUser.uid : "",
                createdByEmail: currentUser ? currentUser.email : "",
                createdVia: "complaint-conversion",
                complaintId: id,
                adminCreated: true,
                jobCardId: jobId,
                clientName: data.clientName || "Customer",
                clientAddress: data.address || "Address to be confirmed",
                jobDescription: `${data.subject || "Complaint"}: ${data.details || ""}`.trim(),
                orderDate: todayInputValue(),
                workflowStatus: "New",
                jobPriority: "High",
                leadSource: "Complaint",
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await db.collection("jobCards").doc(jobId).set(payload, { merge: true });
            await db.collection("complaints").doc(id).set({ linkedJobCardId: jobId, status: "Assigned", updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            await writeAuditLog("complaint_converted_to_job", "jobCards", jobId, `Complaint ${id} converted to ${jobId}.`, { complaintId: id });
            await syncWebsiteData("admin_job_card", { reference: jobId, clientName: payload.clientName, clientEmail: payload.email, source: "Complaint" });
            await Promise.all([loadAdminComplaints(), loadAdminJobCards(), loadAdminWorkflowJobCards(), loadAdminOverviewMetrics(), loadAdminReportsAndAudit()]);
            alert(`Job card ${jobId} created from complaint.`);
        } catch (error) {
            console.error("Complaint conversion error:", error);
            alert(getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function loadAdminDeliveryNotes() {
        if (!isAdminProfile()) return;
        const list = getElement("adminDeliveryList");
        const summary = getElement("adminDeliverySummary");
        if (!list) return;
        list.innerHTML = "Loading delivery notes...";
        if (summary) summary.innerText = "";
        try {
            const snapshot = await db.collection("deliveryNotes").get();
            const records = [];
            snapshot.forEach(function (doc) { records.push({ id: doc.id, data: doc.data() || {} }); });
            records.sort(sortTimestampDescending);
            list.innerHTML = "";
            const pending = records.filter(function (record) { return !["Delivered", "Closed"].includes(String(record.data.status || "Pending")); }).length;
            if (summary) summary.innerText = `${records.length} delivery note${records.length === 1 ? "" : "s"} | ${pending} pending`;
            if (!records.length) {
                list.innerHTML = "<p>No delivery notes found.</p>";
                return;
            }
            records.forEach(function (record) {
                const data = record.data;
                const row = document.createElement("article");
                row.className = "support-admin-row";
                const intro = document.createElement("div");
                intro.appendChild(createSafeTextElement("strong", data.deliveryId || record.id));
                intro.appendChild(createSafeTextElement("span", `${data.recipient || "Recipient"} · ${data.deliveryDate || "No date"}`));
                intro.appendChild(createSafeTextElement("small", data.reference ? `Reference: ${data.reference}` : (data.details || "No details")));
                const controls = document.createElement("div");
                controls.className = "support-admin-controls";
                const status = createStatusSelect(["Pending", "Ready", "Out for Delivery", "Delivered", "Closed"], data.status || "Pending", "Delivery status");
                const save = document.createElement("button");
                save.type = "button";
                save.className = "btn-outline admin-save-btn";
                save.textContent = "Save Status";
                save.onclick = function () { updateAdminDeliveryStatus(record.id, status.value, save); };
                controls.appendChild(status);
                controls.appendChild(save);
                row.appendChild(intro);
                row.appendChild(controls);
                list.appendChild(row);
            });
        } catch (error) {
            console.error("Admin delivery load error:", error);
            list.innerHTML = "<p>Unable to load delivery notes.</p>";
            if (summary) summary.innerText = getErrorMessage(error);
        }
    }

    async function updateAdminDeliveryStatus(id, status, button) {
        if (!isAdminProfile()) return;
        setButtonBusy(button, true, "Saving...");
        try {
            await db.collection("deliveryNotes").doc(id).set({ status: status || "Pending", updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            await syncWebsiteData("delivery_status", { reference: id, status: status || "Pending" });
            await writeAuditLog("delivery_status_updated", "deliveryNotes", id, `Delivery note ${id} marked ${status || "Pending"}.`, { status: status || "Pending" });
            await Promise.all([loadAdminDeliveryNotes(), loadAdminOverviewMetrics(), loadAdminReportsAndAudit()]);
        } catch (error) {
            console.error("Delivery status update error:", error);
            alert(getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }

    function resetAdminAmcForm() {
        const form = getElement("adminAmcForm");
        if (form) form.reset();
        setValue("adminAmcRecordId", "");
        setValue("adminAmcVisits", "1");
        showMessage("adminAmcMessage", "");
    }

    function getAmcHealth(contract) {
        const end = dateInputToMillis(contract && contract.endDate);
        const today = startOfLocalDay(new Date()).getTime();
        if (!end) return { state: "unknown", label: "No renewal date" };
        if (end < today) return { state: "expired", label: "Expired" };
        if (end - today <= 30 * 86400000) return { state: "expiring", label: "Expiring soon" };
        return { state: "active", label: "Active" };
    }

    async function saveAdminAmcContract(event) {
        if (event) event.preventDefault();
        if (!isAdminProfile()) return;
        const company = getValue("adminAmcCompany");
        const startDate = getValue("adminAmcStart");
        const endDate = getValue("adminAmcEnd");
        if (!company || !startDate || !endDate) {
            showMessage("adminAmcMessage", "Company, start date, and renewal date are required.");
            return;
        }
        const email = getValue("adminAmcEmail");
        if (email && !isValidEmail(email)) {
            showMessage("adminAmcMessage", "Please enter a valid AMC email or leave it blank.");
            return;
        }
        const button = event && event.currentTarget ? event.currentTarget.querySelector('button[type="submit"]') : null;
        setButtonBusy(button, true, "Saving...");
        try {
            const recordId = getValue("adminAmcRecordId") || `AMC-${Date.now()}`;
            const payload = {
                contractId: recordId,
                company: company,
                contactPerson: getValue("adminAmcContact"),
                email: email,
                phone: getValue("adminAmcPhone"),
                plan: getValue("adminAmcPlan") || "Basic",
                visitsPerMonth: Math.max(0, Number(getValue("adminAmcVisits") || 0)),
                startDate: startDate,
                endDate: endDate,
                coverage: getValue("adminAmcCoverage"),
                notes: getValue("adminAmcNotes"),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (!getValue("adminAmcRecordId")) payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection("amcContracts").doc(recordId).set(payload, { merge: true });
            await writeAuditLog("amc_contract_saved", "amcContracts", recordId, `AMC contract ${recordId} saved.`, { company: company, plan: payload.plan });
            showMessage("adminAmcMessage", `AMC contract ${recordId} saved.`);
            resetAdminAmcForm();
            showMessage("adminAmcMessage", `AMC contract ${recordId} saved.`);
            await Promise.all([loadAdminAmcContracts(), loadAdminOverviewMetrics(), loadAdminReportsAndAudit()]);
        } catch (error) {
            console.error("AMC save error:", error);
            showMessage("adminAmcMessage", getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function loadAdminAmcContracts() {
        if (!isAdminProfile()) return;
        const list = getElement("adminAmcList");
        const summary = getElement("adminAmcSummary");
        if (!list) return;
        list.innerHTML = "Loading AMC contracts...";
        try {
            const snapshot = await db.collection("amcContracts").get();
            const records = [];
            snapshot.forEach(function (doc) { records.push({ id: doc.id, data: doc.data() || {} }); });
            records.sort(sortTimestampDescending);
            list.innerHTML = "";
            const expiring = records.filter(function (record) { const state = getAmcHealth(record.data).state; return state === "expiring" || state === "expired"; }).length;
            if (summary) summary.innerText = `${records.length} contract${records.length === 1 ? "" : "s"} | ${expiring} due for renewal review`;
            if (!records.length) { list.innerHTML = "<p>No AMC contracts saved yet.</p>"; return; }
            records.forEach(function (record) {
                const data = record.data;
                const health = getAmcHealth(data);
                const item = document.createElement("article");
                item.className = `operations-record-row amc-${health.state}`;
                item.setAttribute("role", "button");
                item.tabIndex = 0;
                item.appendChild(createSafeTextElement("strong", data.company || record.id));
                item.appendChild(createSafeTextElement("span", `${data.plan || "Plan"} · Renewal ${data.endDate || "N/A"} · ${health.label}`));
                item.appendChild(createSafeTextElement("small", data.contactPerson || data.email || data.phone || "Open to edit"));
                item.onclick = function () { openAdminAmcContract(record.id, data); };
                item.onkeydown = function (evt) { if (evt.key === "Enter" || evt.key === " ") { evt.preventDefault(); openAdminAmcContract(record.id, data); } };
                list.appendChild(item);
            });
        } catch (error) {
            console.error("AMC load error:", error);
            list.innerHTML = "<p>Unable to load AMC contracts.</p>";
            if (summary) summary.innerText = getErrorMessage(error);
        }
    }

    function openAdminAmcContract(id, data) {
        setValue("adminAmcRecordId", id);
        setValue("adminAmcCompany", data.company || "");
        setValue("adminAmcContact", data.contactPerson || "");
        setValue("adminAmcEmail", data.email || "");
        setValue("adminAmcPhone", data.phone || "");
        setValue("adminAmcPlan", data.plan || "Basic");
        setValue("adminAmcVisits", data.visitsPerMonth != null ? data.visitsPerMonth : "1");
        setValue("adminAmcStart", data.startDate || "");
        setValue("adminAmcEnd", data.endDate || "");
        setValue("adminAmcCoverage", data.coverage || "");
        setValue("adminAmcNotes", data.notes || "");
        const form = getElement("adminAmcForm");
        if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function resetAdminInventoryForm() {
        const form = getElement("adminInventoryForm");
        if (form) form.reset();
        setValue("adminInventoryRecordId", "");
        setValue("adminInventoryQty", "0");
        setValue("adminInventoryReorder", "0");
        setValue("adminInventoryCost", "0");
        setValue("adminInventorySell", "0");
        showMessage("adminInventoryMessage", "");
    }

    async function saveAdminInventoryItem(event) {
        if (event) event.preventDefault();
        if (!isAdminProfile()) return;
        const sku = getValue("adminInventorySku");
        const name = getValue("adminInventoryName");
        if (!sku || !name) {
            showMessage("adminInventoryMessage", "SKU and item name are required.");
            return;
        }
        const button = event && event.currentTarget ? event.currentTarget.querySelector('button[type="submit"]') : null;
        setButtonBusy(button, true, "Saving...");
        try {
            const recordId = getValue("adminInventoryRecordId") || sku.replace(/[^A-Za-z0-9_.-]+/g, "-");
            const payload = {
                sku: sku,
                name: name,
                category: getValue("adminInventoryCategory"),
                quantity: Math.max(0, Number(getValue("adminInventoryQty") || 0)),
                reorderLevel: Math.max(0, Number(getValue("adminInventoryReorder") || 0)),
                unitCost: Math.max(0, Number(getValue("adminInventoryCost") || 0)),
                sellingPrice: Math.max(0, Number(getValue("adminInventorySell") || 0)),
                notes: getValue("adminInventoryNotes"),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (!getValue("adminInventoryRecordId")) payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection("inventoryItems").doc(recordId).set(payload, { merge: true });
            await writeAuditLog("inventory_item_saved", "inventoryItems", recordId, `Inventory item ${sku} saved.`, { quantity: payload.quantity, reorderLevel: payload.reorderLevel });
            showMessage("adminInventoryMessage", `Inventory item ${sku} saved.`);
            resetAdminInventoryForm();
            showMessage("adminInventoryMessage", `Inventory item ${sku} saved.`);
            await Promise.all([loadAdminInventoryItems(), loadAdminOverviewMetrics(), loadAdminReportsAndAudit()]);
        } catch (error) {
            console.error("Inventory save error:", error);
            showMessage("adminInventoryMessage", getErrorMessage(error));
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function loadAdminInventoryItems() {
        if (!isAdminProfile()) return;
        const list = getElement("adminInventoryList");
        const summary = getElement("adminInventorySummary");
        if (!list) return;
        list.innerHTML = "Loading inventory...";
        try {
            const snapshot = await db.collection("inventoryItems").get();
            const records = [];
            snapshot.forEach(function (doc) { records.push({ id: doc.id, data: doc.data() || {} }); });
            records.sort(function (a, b) { return String(a.data.name || a.id).localeCompare(String(b.data.name || b.id)); });
            list.innerHTML = "";
            const low = records.filter(function (record) { return Number(record.data.quantity || 0) <= Number(record.data.reorderLevel || 0); }).length;
            if (summary) summary.innerText = `${records.length} item${records.length === 1 ? "" : "s"} | ${low} low stock`;
            if (!records.length) { list.innerHTML = "<p>No inventory items saved yet.</p>"; return; }
            records.forEach(function (record) {
                const data = record.data;
                const lowStock = Number(data.quantity || 0) <= Number(data.reorderLevel || 0);
                const item = document.createElement("article");
                item.className = `operations-record-row${lowStock ? " low-stock" : ""}`;
                item.setAttribute("role", "button");
                item.tabIndex = 0;
                item.appendChild(createSafeTextElement("strong", `${data.sku || record.id} · ${data.name || "Item"}`));
                item.appendChild(createSafeTextElement("span", `Qty ${Number(data.quantity || 0)} · Reorder ${Number(data.reorderLevel || 0)}${lowStock ? " · LOW STOCK" : ""}`));
                item.appendChild(createSafeTextElement("small", data.category || data.notes || "Open to edit"));
                item.onclick = function () { openAdminInventoryItem(record.id, data); };
                item.onkeydown = function (evt) { if (evt.key === "Enter" || evt.key === " ") { evt.preventDefault(); openAdminInventoryItem(record.id, data); } };
                list.appendChild(item);
            });
        } catch (error) {
            console.error("Inventory load error:", error);
            list.innerHTML = "<p>Unable to load inventory items.</p>";
            if (summary) summary.innerText = getErrorMessage(error);
        }
    }

    function openAdminInventoryItem(id, data) {
        setValue("adminInventoryRecordId", id);
        setValue("adminInventorySku", data.sku || id);
        setValue("adminInventoryName", data.name || "");
        setValue("adminInventoryCategory", data.category || "");
        setValue("adminInventoryQty", data.quantity != null ? data.quantity : "0");
        setValue("adminInventoryReorder", data.reorderLevel != null ? data.reorderLevel : "0");
        setValue("adminInventoryCost", data.unitCost != null ? data.unitCost : "0");
        setValue("adminInventorySell", data.sellingPrice != null ? data.sellingPrice : "0");
        setValue("adminInventoryNotes", data.notes || "");
        const form = getElement("adminInventoryForm");
        if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function writeAuditLog(action, entityType, entityId, summary, metadata) {
        if (!currentUser || !currentProfile || !currentProfile.allowed) return;
        try {
            await db.collection("auditLogs").add({
                action: action || "event",
                entityType: entityType || "system",
                entityId: entityId || "",
                summary: summary || "Portal activity recorded.",
                metadata: metadata || {},
                actorUid: currentUser.uid || "",
                actorEmail: currentUser.email || "",
                actorRole: currentProfile.role || "client",
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.warn("Audit log write skipped:", error);
        }
    }

    async function loadAdminReportsAndAudit() {
        if (!isAdminProfile()) return;
        const riskList = getElement("adminRiskJobList");
        const auditList = getElement("adminAuditList");
        if (riskList) riskList.innerHTML = "Loading risk jobs...";
        if (auditList) auditList.innerHTML = "Loading audit activity...";
        try {
            const results = await Promise.all([
                db.collection("jobCards").get(),
                db.collection("complaints").get(),
                db.collection("quotations").get(),
                db.collection("invoices").get(),
                db.collection("inventoryItems").get(),
                db.collection("auditLogs").orderBy("createdAt", "desc").limit(80).get()
            ]);
            const jobs = [];
            results[0].forEach(function (doc) { jobs.push({ id: doc.id, data: doc.data() || {} }); });
            const complaints = [];
            results[1].forEach(function (doc) { complaints.push(doc.data() || {}); });
            const quotations = [];
            results[2].forEach(function (doc) { quotations.push(doc.data() || {}); });
            const invoices = [];
            results[3].forEach(function (doc) { invoices.push(doc.data() || {}); });
            const inventory = [];
            results[4].forEach(function (doc) { inventory.push(doc.data() || {}); });
            const audit = [];
            results[5].forEach(function (doc) { audit.push({ id: doc.id, data: doc.data() || {} }); });
            audit.sort(function (a, b) { return timestampToMillis(b.data.createdAt) - timestampToMillis(a.data.createdAt); });
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
            const jobsThisMonth = jobs.filter(function (record) { return String(record.data.orderDate || "").startsWith(monthKey); }).length;
            const completedJobs = jobs.filter(function (record) { return ["Completed", "Delivered", "Closed"].includes(String(record.data.workflowStatus || "")); }).length;
            const openComplaints = complaints.filter(function (item) { return !["Resolved", "Closed"].includes(String(item.status || "Open")); }).length;
            const quotationValue = quotations.reduce(function (sum, item) { return sum + Number(item.total || 0); }, 0);
            const invoiceValue = invoices.reduce(function (sum, item) { return sum + Number(item.total || 0); }, 0);
            const lowStock = inventory.filter(function (item) { return Number(item.quantity || 0) <= Number(item.reorderLevel || 0); }).length;
            setText("reportJobsThisMonth", String(jobsThisMonth));
            setText("reportCompletedJobs", String(completedJobs));
            setText("reportOpenComplaints", String(openComplaints));
            setText("reportQuotationValue", `AED${formatMoney(quotationValue)}`);
            setText("reportInvoiceValue", `AED${formatMoney(invoiceValue)}`);
            setText("reportLowStock", String(lowStock));
            if (riskList) {
                riskList.innerHTML = "";
                const risk = jobs.filter(function (record) { return isJobSlaOverdue(record.data, startOfLocalDay(new Date())) || isJobAtRisk(record.data); }).sort(sortTimestampDescending).slice(0, 20);
                if (!risk.length) {
                    riskList.innerHTML = "<p>No overdue or at-risk jobs.</p>";
                } else {
                    risk.forEach(function (record) {
                        const item = document.createElement("article");
                        item.className = `operations-record-row ${isJobSlaOverdue(record.data, startOfLocalDay(new Date())) ? "is-overdue" : "is-at-risk"}`;
                        item.appendChild(createSafeTextElement("strong", record.data.jobCardId || record.id));
                        item.appendChild(createSafeTextElement("span", `${record.data.clientName || record.data.clientCompany || "Customer"} · ${record.data.workflowStatus || "New"}`));
                        item.appendChild(createSafeTextElement("small", `Due ${record.data.slaResolveBy || record.data.jobDueDate || "Not set"}`));
                        riskList.appendChild(item);
                    });
                }
            }
            if (auditList) {
                auditList.innerHTML = "";
                if (!audit.length) {
                    auditList.innerHTML = "<p>No audit activity recorded yet.</p>";
                } else {
                    audit.slice(0, 30).forEach(function (record) {
                        const data = record.data;
                        const item = document.createElement("article");
                        item.className = "operations-record-row";
                        item.appendChild(createSafeTextElement("strong", data.summary || data.action || "Activity"));
                        item.appendChild(createSafeTextElement("span", `${data.actorEmail || "System"} · ${data.entityType || "system"}`));
                        item.appendChild(createSafeTextElement("small", data.entityId || record.id));
                        auditList.appendChild(item);
                    });
                }
            }
        } catch (error) {
            console.error("Admin reports load error:", error);
            if (riskList) riskList.innerHTML = "<p>Unable to load risk jobs.</p>";
            if (auditList) auditList.innerHTML = "<p>Unable to load audit activity.</p>";
        }
    }

    function workflowNotificationNeeded(previous, next) {
        const fields = ["workflowStatus", "jobPriority", "jobDueDate", "visitDate", "visitTime", "assignedStaffName"];
        return fields.some(function (field) {
            return String((previous || {})[field] || "") !== String((next || {})[field] || "");
        });
    }

    async function sendWorkflowStatusNotification(jobCardId, data) {
        if (!isAdminProfile()) return;
        const email = data && data.email ? String(data.email).trim() : "";
        if (!email || !isValidEmail(email)) return;
        try {
            const response = await fetch("workflow-notification-handler.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jobCardId: jobCardId,
                    customerName: data.clientName || data.clientCompany || "Customer",
                    customerEmail: email,
                    companyEmail: COMPANY_EMAIL,
                    workflowStatus: data.workflowStatus || "New",
                    priority: data.jobPriority || "Normal",
                    dueDate: data.jobDueDate || "",
                    visitDate: data.visitDate || "",
                    visitTime: data.visitTime || "",
                    assignedStaffName: data.assignedStaffName || ""
                })
            });
            const result = await response.json().catch(function () { return { success: false }; });
            if (response.ok && result.success) {
                await syncWebsiteData("workflow_notification", { reference: jobCardId, clientEmail: email, status: data.workflowStatus || "New" });
            }
        } catch (error) {
            console.warn("Workflow email notification skipped:", error);
        }
    }


    /* =========================================================
       DOM READY
    ========================================================= */

    document.addEventListener("DOMContentLoaded", function () {
        loadPortalTheme();
        enableLivePDFPreview();
        initialiseFinancialWorkspace();
    });

    /* =========================================================
       EXPORT FUNCTIONS FOR HTML onclick=""
    ========================================================= */

    window.toggleTheme = toggleTheme;
    window.handleHeaderAuthClick = handleHeaderAuthClick;
    window.signupUser = signupUser;
    window.loginUser = loginUser;
    window.logoutUser = logoutUser;
    window.switchPortalTab = switchPortalTab;
    window.openClientPortal = openClientPortal;
    window.saveJobCard = saveJobCard;
    window.loadJobCards = loadJobCards;
    window.openJobCard = openJobCard;
    window.downloadJobPDF = downloadJobPDF;
    window.printJobPDF = printJobPDF;
    window.sendJobPDFEmail = sendJobPDFEmail;
    window.saveDeliveryNote = saveDeliveryNote;
    window.loadDeliveryNotes = loadDeliveryNotes;
    window.openDeliveryNote = openDeliveryNote;
    window.saveComplaint = saveComplaint;
    window.loadComplaints = loadComplaints;
    window.loadAdminUsers = loadAdminUsers;
    window.loadAdminJobCards = loadAdminJobCards;
    window.loadAdminOverviewMetrics = loadAdminOverviewMetrics;
    window.refreshAdminDashboard = refreshAdminDashboard;
    window.loadAdminWorkflowJobCards = loadAdminWorkflowJobCards;
    window.loadAdminCustomerDeviceHistory = loadAdminCustomerDeviceHistory;
    window.filterAdminCustomerDeviceHistory = filterAdminCustomerDeviceHistory;
    window.switchAdminWorkspacePanel = switchAdminWorkspacePanel;
    window.switchJobWorkspacePanel = switchJobWorkspacePanel;
    window.mirrorJobCardList = mirrorJobCardList;
    window.changePortalPassword = changePortalPassword;
    window.sendPortalPasswordReset = sendPortalPasswordReset;
    window.saveFinancialDocument = saveFinancialDocument;
    window.prepareNewFinancialDocumentNumber = prepareNewFinancialDocumentNumber;
    window.downloadFinancialPDF = downloadFinancialPDF;
    window.printFinancialPDF = printFinancialPDF;
    window.sendFinancialPDFEmail = sendFinancialPDFEmail;
    window.loadFinancialDocuments = loadFinancialDocuments;
    window.applyPortalAccessVisibility = applyPortalAccessVisibility;
    window.populateAdminCreateStaffSelect = populateAdminCreateStaffSelect;
    window.resetAdminCreateJobCardForm = resetAdminCreateJobCardForm;
    window.adminCreateJobCard = adminCreateJobCard;
    window.loadAdminSupportQueues = loadAdminSupportQueues;
    window.loadAdminComplaints = loadAdminComplaints;
    window.loadAdminDeliveryNotes = loadAdminDeliveryNotes;
    window.saveAdminAmcContract = saveAdminAmcContract;
    window.resetAdminAmcForm = resetAdminAmcForm;
    window.loadAdminAmcContracts = loadAdminAmcContracts;
    window.openAdminAmcContract = openAdminAmcContract;
    window.saveAdminInventoryItem = saveAdminInventoryItem;
    window.resetAdminInventoryForm = resetAdminInventoryForm;
    window.loadAdminInventoryItems = loadAdminInventoryItems;
    window.openAdminInventoryItem = openAdminInventoryItem;
    window.loadAdminReportsAndAudit = loadAdminReportsAndAudit;

})();