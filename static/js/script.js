"use strict";

/* =====================================================
   CONFIG
===================================================== */

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyC8_haFdlIB2l8rNw2LoKn5_N9zaVr9nOs",
    authDomain: "conquercomputers-3736f.firebaseapp.com",
    databaseURL: "https://conquercomputers-3736f-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "conquercomputers-3736f",
    storageBucket: "conquercomputers-3736f.firebasestorage.app",
    messagingSenderId: "109606671010",
    appId: "1:109606671010:web:f6492869a27ee0cacffdfb",
    measurementId: "G-KXMDWQGXSX"
};

const GA_MEASUREMENT_ID = "G-KXMDWQGXSX";
const BUSINESS_PHONE = "971543433553";
const BUSINESS_EMAIL = "info@conquercomputers.com";

const PAGE_ROUTES = Object.freeze({
    home: "index.html",
    about: "about.html",
    services: "services.html",
    portfolio: "portfolio.html",
    careers: "careers.html",
    contact: "contact.html",
    login: "login.html"
});

/* =====================================================
   GOOGLE ANALYTICS EVENT FUNCTION
   GA script should load only from index.html <head>
===================================================== */

function trackEvent(eventName, params = {}) {
    if (typeof gtag === "function") {
        gtag("event", eventName, params);
    }
}

window.trackEvent = trackEvent;

/* =====================================================
   FIREBASE REALTIME VISITOR TRACKING
===================================================== */

window._fbReady = false;
window.updatePresencePage = null;

async function initFirebaseTracking() {
    try {
        const { initializeApp, getApps } = await import(
            "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"
        );

        const {
            getDatabase,
            ref,
            onValue,
            set,
            onDisconnect,
            push,
            serverTimestamp,
            runTransaction
        } = await import(
            "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"
        );

        const visitorApp =
            getApps().find(function (app) {
                return app.name === "visitor-tracking";
            }) || initializeApp(FIREBASE_CONFIG, "visitor-tracking");

        const db = getDatabase(visitorApp);

        const presenceListRef = ref(db, "presence");
        const myRef = push(presenceListRef);

        set(myRef, {
            connectedAt: serverTimestamp(),
            page: "home"
        });

        onDisconnect(myRef).remove();

        if (!sessionStorage.getItem("cc_counted")) {
            sessionStorage.setItem("cc_counted", "1");

            runTransaction(ref(db, "totalVisits"), function (currentValue) {
                return (currentValue || 0) + 1;
            });
        }

        onValue(presenceListRef, function (snapshot) {
            const count = snapshot.exists()
                ? Object.keys(snapshot.val()).length
                : 1;

            const liveCount = document.getElementById("liveCount");

            if (liveCount) {
                liveCount.textContent = count;
                liveCount.style.color = "";
            }
        });

        onValue(ref(db, "totalVisits"), function (snapshot) {
            const total = snapshot.val() || 0;
            const totalElement = document.getElementById("vwTotal");

            if (totalElement) {
                totalElement.textContent = total.toLocaleString() + " total visits";
            }
        });

        window.updatePresencePage = function (page) {
            set(myRef, {
                connectedAt: serverTimestamp(),
                page: page
            });
        };

        window._fbReady = true;

        console.log(
            "%c✓ Firebase visitor tracking active",
            "color:#52b82a;font-weight:bold"
        );
    } catch (error) {
        console.warn("Firebase visitor tracking not active:", error.message);

        const liveCount = document.getElementById("liveCount");
        const totalVisits = document.getElementById("vwTotal");

        if (liveCount) {
            liveCount.textContent = "—";
            liveCount.style.color = "var(--text3)";
        }

        if (totalVisits) {
            totalVisits.textContent = "Firebase not connected";
        }
    }
}

/* =====================================================
   CUSTOM CURSOR
===================================================== */

function initCursor() {
    const cursor = document.getElementById("cursor");
    const ring = document.getElementById("cursor-ring");

    if (!cursor || !ring) return;

    let mouseX = 0;
    let mouseY = 0;
    let ringX = 0;
    let ringY = 0;

    document.addEventListener("mousemove", function (event) {
        mouseX = event.clientX;
        mouseY = event.clientY;

        cursor.style.transform = `translate(${mouseX - 4}px, ${mouseY - 4}px)`;
    });

    function animateRing() {
        ringX += (mouseX - ringX) * 0.12;
        ringY += (mouseY - ringY) * 0.12;

        ring.style.transform = `translate(${ringX - 17}px, ${ringY - 17}px)`;

        requestAnimationFrame(animateRing);
    }

    animateRing();

    const hoverElements = document.querySelectorAll(
        "a, button, .service-card, .svc-full-card, .proj-card, .ci-item, .wf-item, .val-card, .testi-card, .pf-btn, .social-btn, #visitorWidget, .floating-whatsapp"
    );

    hoverElements.forEach(function (element) {
        element.addEventListener("mouseenter", function () {
            ring.style.borderColor = "rgba(200,200,200,0.45)";
            ring.style.scale = "1.7";
        });

        element.addEventListener("mouseleave", function () {
            ring.style.borderColor = "rgba(128,128,128,0.25)";
            ring.style.scale = "1";
        });
    });
}

/* =====================================================
   LOADER
===================================================== */

function initLoader() {
    const loader = document.getElementById("loader");

    function hideLoader() {
        if (!loader) return;

        loader.classList.add("hide");

        setTimeout(function () {
            loader.style.display = "none";
        }, 800);
    }

    if (document.readyState === "complete") {
        hideLoader();
        return;
    }

    window.addEventListener("load", function () {
        setTimeout(hideLoader, 700);
    });
}

/* =====================================================
   PAGE NAVIGATION
===================================================== */

let currentPage = null;

function getInitialPage() {
    const bodyPage = document.body && document.body.dataset ? document.body.dataset.page : "";
    const hashPage = window.location.hash.replace("#", "").trim();

    if (bodyPage && document.getElementById("page-" + bodyPage)) {
        return bodyPage;
    }

    if (hashPage && document.getElementById("page-" + hashPage)) {
        return hashPage;
    }

    return "home";
}

function showPage(name) {
    const newPage = document.getElementById("page-" + name);

    if (!newPage) {
        console.warn("Page not found:", name);
        return;
    }

    if (currentPage === name) {
        return;
    }

    if (!currentPage) {
        document.querySelectorAll(".page").forEach(function (page) {
            page.classList.remove("active", "exiting");
            page.style.display = "none";
        });
    }

    if (currentPage) {
        const oldPage = document.getElementById("page-" + currentPage);

        if (oldPage) {
            oldPage.classList.add("exiting");

            setTimeout(function () {
                oldPage.classList.remove("active", "exiting");
                oldPage.style.display = "none";
            }, 350);
        }
    }

    setTimeout(
        function () {
            newPage.style.display = "block";

            requestAnimationFrame(function () {
                newPage.classList.add("active");
                newPage.classList.remove("exiting");

                window.scrollTo({
                    top: 0,
                    behavior: "smooth"
                });
            });

            document
                .querySelectorAll(".nav-links a, #mobileNav a")
                .forEach(function (link) {
                    link.classList.toggle("active", link.dataset.page === name);
                });

            currentPage = name;

            recordPageVisit(name);
            observeReveal();

            trackEvent("page_section_view", {
                page_section: name,
                page_location: window.location.href
            });
        },
        currentPage ? 320 : 0
    );
}

function navigate(pageName) {
    const route = PAGE_ROUTES[pageName];
    const currentFile = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();

    if (route && currentFile !== route.toLowerCase()) {
        window.location.href = route;
        return;
    }

    showPage(pageName);
}

window.showPage = showPage;
window.navigate = navigate;

/* =====================================================
   MOBILE NAVIGATION
===================================================== */

function toggleMobileNav() {
    const nav = document.getElementById("mobileNav");
    const burger = document.getElementById("hamburger");

    if (!nav || !burger) return;

    const isOpen = nav.classList.contains("open");

    nav.classList.toggle("open", !isOpen);
    burger.classList.toggle("open", !isOpen);

    document.body.style.overflow = isOpen ? "" : "hidden";
}

function closeMobileNav() {
    const nav = document.getElementById("mobileNav");
    const burger = document.getElementById("hamburger");

    if (nav) nav.classList.remove("open");
    if (burger) burger.classList.remove("open");

    document.body.style.overflow = "";
}

window.toggleMobileNav = toggleMobileNav;
window.closeMobileNav = closeMobileNav;

/* =====================================================
   REVEAL ANIMATION
===================================================== */

function observeReveal() {
    const revealElements = document.querySelectorAll(
        ".reveal, .reveal-left, .reveal-right"
    );

    if (!revealElements.length) return;

    const observer = new IntersectionObserver(
        function (entries) {
            entries.forEach(function (entry, index) {
                if (entry.isIntersecting) {
                    setTimeout(function () {
                        entry.target.classList.add("visible");
                    }, index * 70);

                    observer.unobserve(entry.target);
                }
            });
        },
        {
            threshold: 0.1
        }
    );

    revealElements.forEach(function (element) {
        if (!element.classList.contains("visible")) {
            observer.observe(element);
        }
    });
}

/* =====================================================
   NAVBAR SCROLL
===================================================== */

function initNavbarScroll() {
    const navbar = document.getElementById("navbar");

    if (!navbar) return;

    window.addEventListener("scroll", function () {
        navbar.classList.toggle("scrolled", window.scrollY > 40);
    });
}

/* =====================================================
   PORTFOLIO FILTER
===================================================== */

function filterProj(button, category) {
    document.querySelectorAll(".pf-btn").forEach(function (btn) {
        btn.classList.remove("active");
    });

    if (button) {
        button.classList.add("active");
    }

    document.querySelectorAll(".proj-card").forEach(function (card) {
        const shouldShow = category === "all" || card.dataset.cat === category;

        card.style.opacity = shouldShow ? "1" : "0.15";
        card.style.transform = shouldShow ? "" : "scale(0.97)";
        card.style.transition = "all 0.3s ease";
    });

    trackEvent("portfolio_filter_click", {
        filter_category: category
    });
}

window.filterProj = filterProj;

/* =====================================================
   PUBLIC LEAD FORM SYSTEM
===================================================== */

function getCurrentPageName() {
    const bodyPage = document.body && document.body.dataset ? document.body.dataset.page : "";
    const activePage = document.querySelector(".page.active");

    if (bodyPage) {
        return bodyPage;
    }

    if (activePage && activePage.id) {
        return activePage.id.replace("page-", "");
    }

    return document.title || "Website";
}

function getUTMData() {
    const params = new URLSearchParams(window.location.search);

    return {
        utm_source: params.get("utm_source") || "",
        utm_medium: params.get("utm_medium") || "",
        utm_campaign: params.get("utm_campaign") || "",
        utm_term: params.get("utm_term") || "",
        utm_content: params.get("utm_content") || ""
    };
}

function showLeadToast(message, type = "success") {
    let toast = document.getElementById("leadToast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "leadToast";
        toast.className = "lead-toast";
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = "lead-toast show " + type;

    setTimeout(function () {
        toast.classList.remove("show");
    }, 4000);
}

function getFirestoreDB() {
    if (typeof firebase === "undefined") {
        console.warn("Firebase compat SDK not loaded.");
        return null;
    }

    if (typeof firebase.firestore !== "function") {
        console.warn("Firebase Firestore compat SDK not loaded.");
        return null;
    }

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }
    } catch (error) {
        if (!String(error.message).includes("already exists")) {
            throw error;
        }
    }

    return firebase.firestore();
}

async function saveLeadToFirestore(leadData) {
    const db = getFirestoreDB();

    if (!db) {
        throw new Error("Firestore not available.");
    }

    return db.collection("leads").add({
        ...leadData,
        status: "New",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

async function sendLeadEmail(leadData) {
    try {
        const response = await fetch("lead-handler.php", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(leadData)
        });

        return await response.json();
    } catch (error) {
        console.warn("Email notification failed:", error);

        return {
            success: false,
            message: "Email notification failed",
            whatsappUrl: ""
        };
    }
}

function validateLeadPhone(phone) {
    const cleaned = phone.replace(/\s+/g, "");

    return cleaned.length >= 8;
}

function getInputValue(id) {
    const element = document.getElementById(id);

    return element ? element.value.trim() : "";
}

async function handlePublicLeadSubmit(event) {
    event.preventDefault();

    const form = event.target;
    const submitBtn = document.getElementById("leadSubmitBtn");

    const firstName = getInputValue("leadFirstName");
    const lastName = getInputValue("leadLastName");
    const email = getInputValue("leadEmail");
    const phone = getInputValue("leadPhone");
    const service = getInputValue("leadService");
    const requirement = getInputValue("leadRequirement");

    if (!firstName || !phone || !service || !requirement) {
        showLeadToast("Please fill all required fields.", "error");
        return;
    }

    if (!validateLeadPhone(phone)) {
        showLeadToast("Please enter a valid phone number.", "error");
        return;
    }

    const leadData = {
        firstName: firstName,
        lastName: lastName,
        name: `${firstName} ${lastName}`.trim(),
        email: email,
        phone: phone,
        service: service,
        requirement: requirement,
        page: getCurrentPageName(),
        pageUrl: window.location.href,
        source: "Website",
        businessEmail: BUSINESS_EMAIL,
        ...getUTMData()
    };

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Sending...";
        }

        const emailResponse = await sendLeadEmail(leadData);

        try {
            await saveLeadToFirestore(leadData);
        } catch (firestoreError) {
            console.warn("Lead was saved by PHP handler, but Firestore save failed:", firestoreError);
            trackEvent("lead_firestore_error", {
                error_message: firestoreError.message || "Firestore save failed"
            });
        }

        if (emailResponse && emailResponse.whatsappUrl) {
            window.open(emailResponse.whatsappUrl, "_blank");
        }

        trackEvent("lead_form_submit", {
            form_name: "website_lead_form",
            service: service,
            page: leadData.page
        });

        showLeadToast("Thank you! Your inquiry has been submitted successfully.", "success");

        form.reset();
    } catch (error) {
        console.error("Lead submit error:", error);

        showLeadToast("Something went wrong. Please contact us on WhatsApp.", "error");

        trackEvent("lead_form_error", {
            error_message: error.message
        });
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Send Inquiry →";
        }
    }
}

function initPublicLeadForm() {
    const form = document.getElementById("publicLeadForm");

    if (!form) {
        return;
    }

    if (form.dataset.leadFormReady === "1") {
        return;
    }

    form.dataset.leadFormReady = "1";
    form.addEventListener("submit", handlePublicLeadSubmit);
}

function initContactPrefill() {
    const params = new URLSearchParams(window.location.search);
    const serviceName = params.get("service") || sessionStorage.getItem("conquer-prefill-service") || "";

    if (!serviceName) {
        return;
    }

    const serviceSelect = document.getElementById("leadService");
    const requirementBox = document.getElementById("leadRequirement");

    if (serviceSelect) {
        const hasOption = Array.from(serviceSelect.options).some(function (option) {
            return option.value === serviceName;
        });

        if (hasOption) {
            serviceSelect.value = serviceName;
        }
    }

    if (requirementBox && !requirementBox.value.trim()) {
        requirementBox.value = "Hi, I need more details about " + serviceName + ".";
    }

    sessionStorage.removeItem("conquer-prefill-service");
}

/* =====================================================
   WHATSAPP LEAD SYSTEM
===================================================== */

function buildWhatsAppLink(message) {
    const defaultMessage =
        "Hi Conquer Computers Team, I am interested in your IT services. Please contact me with more details and a quotation. Thank you.";

    const encodedMessage = encodeURIComponent(message || defaultMessage);

    return `https://wa.me/${BUSINESS_PHONE}?text=${encodedMessage}`;
}

function initWhatsAppButtons() {
    const whatsappButtons = document.querySelectorAll("[data-whatsapp-message]");

    whatsappButtons.forEach(function (button) {
        if (button.dataset.whatsappReady === "1") {
            return;
        }

        const message = button.getAttribute("data-whatsapp-message");

        button.href = buildWhatsAppLink(message);
        button.target = "_blank";
        button.rel = "noopener noreferrer";
        button.dataset.whatsappReady = "1";

        button.addEventListener("click", function () {
            trackEvent("whatsapp_click", {
                message: message,
                page: getCurrentPageName()
            });
        });
    });
}

/* =====================================================
   HERO IMAGE SLIDER
===================================================== */

function initHeroSlider() {
    const slider = document.querySelector("[data-hero-slider]");

    if (!slider) {
        return;
    }

    const slides = Array.from(slider.querySelectorAll(".hero-slide"));
    const dots = Array.from(slider.querySelectorAll(".hero-slider-dots span"));

    if (slides.length <= 1) {
        return;
    }

    let activeIndex = Math.max(0, slides.findIndex(function (slide) {
        return slide.classList.contains("active");
    }));

    function showSlide(nextIndex) {
        slides[activeIndex].classList.remove("active");
        if (dots[activeIndex]) dots[activeIndex].classList.remove("active");

        activeIndex = nextIndex % slides.length;

        slides[activeIndex].classList.add("active");
        if (dots[activeIndex]) dots[activeIndex].classList.add("active");
    }

    const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!prefersReducedMotion) {
        window.setInterval(function () {
            showSlide(activeIndex + 1);
        }, 4600);
    }
}

/* =====================================================
   THEME SWITCH
===================================================== */

function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute("data-theme");
    const nextTheme = currentTheme === "dark" ? "light" : "dark";

    html.setAttribute("data-theme", nextTheme);
    localStorage.setItem("conquer-theme", nextTheme);

    trackEvent("theme_toggle", {
        selected_theme: nextTheme
    });
}

function loadSavedTheme() {
    const savedTheme = localStorage.getItem("conquer-theme");

    if (savedTheme === "light" || savedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", savedTheme);
    }
}

window.toggleTheme = toggleTheme;

/* =====================================================
   VISITOR TRACKING COMPATIBILITY
===================================================== */

function initVisitorTracking() {
    if (!window._fbReady) {
        const liveCount = document.getElementById("liveCount");
        const totalVisits = document.getElementById("vwTotal");

        if (liveCount) {
            liveCount.textContent = "—";
            liveCount.style.color = "var(--text3)";
        }

        if (totalVisits) {
            totalVisits.textContent = "Firebase loading...";
        }
    }
}

function recordPageVisit(pageName) {
    if (typeof window.updatePresencePage === "function") {
        window.updatePresencePage(pageName);
    }
}

/* =====================================================
   GA4 EVENT TRACKING
===================================================== */

function initGAEventTracking() {
    document
        .querySelectorAll("[data-page], .nav-links a, #mobileNav a")
        .forEach(function (link) {
            if (link.dataset.gaReady === "1") {
                return;
            }

            link.dataset.gaReady = "1";

            link.addEventListener("click", function () {
                const pageName =
                    this.getAttribute("data-page") ||
                    this.textContent.trim().toLowerCase().replace(/\s+/g, "_") ||
                    "unknown_page";

                trackEvent("navigation_click", {
                    page_section: pageName,
                    page_location: window.location.href
                });
            });
        });

    document.querySelectorAll('a[href^="tel:"]').forEach(function (link) {
        if (link.dataset.phoneReady === "1") {
            return;
        }

        link.dataset.phoneReady = "1";

        link.addEventListener("click", function () {
            trackEvent("phone_click", {
                phone_number: this.getAttribute("href")
            });
        });
    });

    document
        .querySelectorAll('a[href*="wa.me"]:not([data-whatsapp-message]), a[href*="api.whatsapp.com"]:not([data-whatsapp-message])')
        .forEach(function (link) {
            if (link.dataset.waGaReady === "1") {
                return;
            }

            link.dataset.waGaReady = "1";

            link.addEventListener("click", function () {
                trackEvent("whatsapp_click", {
                    link_url: this.href,
                    page: getCurrentPageName()
                });
            });
        });

    document.querySelectorAll('a[href^="mailto:"]').forEach(function (link) {
        if (link.dataset.emailReady === "1") {
            return;
        }

        link.dataset.emailReady = "1";

        link.addEventListener("click", function () {
            trackEvent("email_click", {
                email: this.getAttribute("href")
            });
        });
    });

    document.querySelectorAll("form").forEach(function (form) {
        if (form.id === "publicLeadForm") {
            return;
        }

        if (form.dataset.formGaReady === "1") {
            return;
        }

        form.dataset.formGaReady = "1";

        form.addEventListener("submit", function () {
            trackEvent("contact_form_submit", {
                form_name: form.id || "website_contact_form"
            });
        });
    });
}

/* =====================================================
   INIT
===================================================== */

document.addEventListener("DOMContentLoaded", function () {
    loadSavedTheme();

    initCursor();
    initNavbarScroll();
    initFirebaseTracking();
    initWhatsAppButtons();
    initPublicLeadForm();
    initContactPrefill();
    initHeroSlider();
    initGAEventTracking();
    initLoader();
    initExitPopup();
    showPage(getInitialPage());
    initVisitorTracking();
});

/* =====================================================
   EXIT INTENT POPUP
===================================================== */

let exitPopupShown = false;

function showExitPopup() {
    if (exitPopupShown) return;

    const popup = document.getElementById("exitPopup");

    if (!popup) return;

    exitPopupShown = true;
    popup.classList.add("show");

    trackEvent("exit_popup_show", {
        page: getCurrentPageName()
    });
}

function closeExitPopup() {
    const popup = document.getElementById("exitPopup");

    if (popup) {
        popup.classList.remove("show");
    }
}

function initExitPopup() {
    document.addEventListener("mouseleave", function (event) {
        if (event.clientY <= 0) {
            showExitPopup();
        }
    });

    setTimeout(function () {
        if (window.innerWidth <= 768) {
            showExitPopup();
        }
    }, 25000);
}

window.closeExitPopup = closeExitPopup;

/* =====================================================
   SERVICE BUTTON ACTIONS
===================================================== */

function openWhatsAppLead(message) {
    const phoneNumber = "971543433553";
    const finalMessage = message || "Hi, I need IT service";
    const whatsappUrl = "https://wa.me/" + phoneNumber + "?text=" + encodeURIComponent(finalMessage);

    if (typeof trackEvent === "function") {
        trackEvent("whatsapp_click", {
            message: finalMessage,
            location: "service_card"
        });
    }

    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
}

function goToQuote(serviceName) {
    if (typeof trackEvent === "function") {
        trackEvent("get_quote_click", {
            service: serviceName,
            location: "service_card"
        });
    }

    if (serviceName) {
        sessionStorage.setItem("conquer-prefill-service", serviceName);
    }

    const target = PAGE_ROUTES.contact + (serviceName ? "?service=" + encodeURIComponent(serviceName) : "");
    window.location.href = target;
}