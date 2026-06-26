/* static/js/portal-nav-guard.js
   Lightweight panel navigation fallback.
   It keeps sidebar panel switching responsive even if an inline handler is blocked,
   cached portal.js is out of sync, or a non-navigation portal task fails later. */
(function () {
    "use strict";

    function selectPanel(panelSelector, navSelector, target, fallback) {
        var selected = String(target || fallback || "");
        if (!selected) return;

        document.querySelectorAll(panelSelector).forEach(function (section) {
            section.classList.toggle("active", section.dataset.adminPanel === selected || section.dataset.jobPanel === selected);
        });

        document.querySelectorAll(navSelector).forEach(function (button) {
            button.classList.toggle("active", button.dataset.adminNav === selected || button.dataset.jobNav === selected);
        });
    }

    function switchAdminPanel(panel) {
        if (typeof window.switchAdminWorkspacePanel === "function") {
            window.switchAdminWorkspacePanel(panel);
        } else {
            selectPanel("[data-admin-panel]", "[data-admin-nav]", panel, "overview");
        }
    }

    function switchJobPanel(panel) {
        if (typeof window.switchJobWorkspacePanel === "function") {
            window.switchJobWorkspacePanel(panel);
        } else {
            selectPanel("[data-job-panel]", "[data-job-nav]", panel, "jobcards");
        }
    }

    function callWhenAvailable(name) {
        if (typeof window[name] === "function") {
            try {
                window[name]();
            } catch (error) {
                console.warn("Optional portal panel loader skipped:", name, error);
            }
        }
    }

    function runAdminPanelLoaders(panel) {
        switch (panel) {
            case "create-job":
                callWhenAvailable("populateAdminCreateStaffSelect");
                break;
            case "support":
                callWhenAvailable("loadAdminSupportQueues");
                break;
            case "amc":
                callWhenAvailable("loadAdminAmcContracts");
                break;
            case "inventory":
                callWhenAvailable("loadAdminInventoryItems");
                break;
            case "reports":
                callWhenAvailable("loadAdminReportsAndAudit");
                break;
            default:
                break;
        }
    }

    function runJobPanelLoaders(panel) {
        switch (panel) {
            case "records":
                callWhenAvailable("mirrorJobCardList");
                break;
            case "complaints":
                callWhenAvailable("loadComplaints");
                break;
            case "delivery":
                callWhenAvailable("loadDeliveryNotes");
                break;
            default:
                break;
        }
    }

    function handleAdminPanelClick(event) {
        var button = event.target.closest("[data-admin-nav], [data-admin-switch]");
        if (!button) return;
        var panel = button.dataset.adminNav || button.dataset.adminSwitch || "overview";
        switchAdminPanel(panel);
        runAdminPanelLoaders(panel);
    }

    function handleJobPanelClick(event) {
        var button = event.target.closest("[data-job-nav], [data-job-switch]");
        if (!button) return;
        var panel = button.dataset.jobNav || button.dataset.jobSwitch || "jobcards";
        switchJobPanel(panel);
        runJobPanelLoaders(panel);
    }

    function bindNavigationGuard() {
        var view = document.body ? String(document.body.dataset.portalView || "") : "";
        if (view === "admin") {
            document.addEventListener("click", handleAdminPanelClick);
        }
        if (view === "job") {
            document.addEventListener("click", handleJobPanelClick);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindNavigationGuard);
    } else {
        bindNavigationGuard();
    }
})();
