(function () {
    "use strict";

    if (window.firebase && window.firebase.__djangoCompat) {
        return;
    }

    const API_BASE = "/api";
    const apps = [];

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function randomId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID().replace(/-/g, "");
        }
        return "doc-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }

    function getCookie(name) {
        const cookies = document.cookie ? document.cookie.split(";") : [];
        for (const cookie of cookies) {
            const parts = cookie.trim().split("=");
            if (parts[0] === name) {
                return decodeURIComponent(parts.slice(1).join("="));
            }
        }
        return "";
    }

    async function request(path, options) {
        const init = Object.assign({ credentials: "same-origin" }, options || {});
        init.headers = Object.assign({}, init.headers || {});
        if (init.body && !(init.body instanceof FormData) && !init.headers["Content-Type"]) {
            init.headers["Content-Type"] = "application/json";
        }
        const csrf = getCookie("csrftoken");
        if (csrf) {
            init.headers["X-CSRFToken"] = csrf;
        }
        const response = await fetch(API_BASE + path, init);
        const text = await response.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch (error) {
            data = { success: false, message: text || response.statusText };
        }
        if (!response.ok || data.success === false) {
            const err = new Error(data.message || response.statusText || "Request failed.");
            err.code = data.code || (response.status === 403 ? "permission-denied" : "request-failed");
            err.response = data;
            throw err;
        }
        return data;
    }

    class Timestamp {
        constructor(date) {
            this._date = date instanceof Date ? date : new Date(date || Date.now());
            this.seconds = Math.floor(this._date.getTime() / 1000);
            this.nanoseconds = this._date.getMilliseconds() * 1000000;
        }

        toDate() {
            return new Date(this._date.getTime());
        }

        toMillis() {
            return this._date.getTime();
        }

        toJSON() {
            return this._date.toISOString();
        }
    }

    function looksLikeDate(value) {
        return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
    }

    function fromServer(value) {
        if (Array.isArray(value)) {
            return value.map(fromServer);
        }
        if (value && typeof value === "object") {
            const next = {};
            Object.keys(value).forEach(function (key) {
                next[key] = fromServer(value[key]);
            });
            return next;
        }
        if (looksLikeDate(value)) {
            return new Timestamp(value);
        }
        return value;
    }

    function toServer(value) {
        if (value && value.__serverTimestamp) {
            return { __serverTimestamp: true };
        }
        if (value instanceof Timestamp) {
            return value.toJSON();
        }
        if (Array.isArray(value)) {
            return value.map(toServer);
        }
        if (value && typeof value === "object") {
            const next = {};
            Object.keys(value).forEach(function (key) {
                next[key] = toServer(value[key]);
            });
            return next;
        }
        return value;
    }

    class CompatUser {
        constructor(payload) {
            this.uid = payload.uid;
            this.email = payload.email || "";
            this.displayName = payload.name || "";
            this._lastPassword = "";
        }

        async reauthenticateWithCredential(credential) {
            this._lastPassword = credential ? credential.password || "" : "";
            return { user: this };
        }

        async updatePassword(newPassword) {
            await request("/auth/password/change/", {
                method: "POST",
                body: JSON.stringify({
                    currentPassword: this._lastPassword,
                    newPassword: newPassword
                })
            });
            this._lastPassword = "";
            return true;
        }
    }

    class AuthCompat {
        constructor() {
            this.currentUser = null;
            this._listeners = [];
            this._ready = null;
            this._stateLoaded = false;
        }

        _setUser(payload) {
            this.currentUser = payload ? new CompatUser(payload) : null;
            this._stateLoaded = true;
            this._listeners.forEach((listener) => listener(this.currentUser));
            return this.currentUser;
        }

        async _ensureState() {
            if (!this._ready) {
                this._ready = request("/auth/state/", { method: "GET" })
                    .then((data) => this._setUser(data.user || null))
                    .catch(() => this._setUser(null));
            }
            return this._ready;
        }

        onAuthStateChanged(callback) {
            this._listeners.push(callback);
            if (this._stateLoaded) {
                callback(this.currentUser);
            } else {
                this._ensureState();
            }
            return () => {
                this._listeners = this._listeners.filter((item) => item !== callback);
            };
        }

        setPersistence() {
            return Promise.resolve();
        }

        async createUserWithEmailAndPassword(email, password) {
            const nameField = document.getElementById("authName");
            const data = await request("/auth/signup/", {
                method: "POST",
                body: JSON.stringify({
                    email: email,
                    password: password,
                    name: nameField ? nameField.value : ""
                })
            });
            return { user: this._setUser(data.user) };
        }

        async signInWithEmailAndPassword(email, password) {
            const data = await request("/auth/login/", {
                method: "POST",
                body: JSON.stringify({ email: email, password: password })
            });
            return { user: this._setUser(data.user) };
        }

        async signOut() {
            await request("/auth/logout/", { method: "POST", body: "{}" }).catch(function () {});
            this._ready = Promise.resolve(null);
            this._setUser(null);
        }

        async sendPasswordResetEmail(email) {
            await request("/auth/password/reset/", {
                method: "POST",
                body: JSON.stringify({ email: email })
            });
        }
    }

    class DocumentSnapshot {
        constructor(id, data, exists) {
            this.id = id;
            this.exists = !!exists;
            this._data = data || {};
        }

        data() {
            return fromServer(clone(this._data));
        }
    }

    class QuerySnapshot {
        constructor(docs) {
            this.docs = docs;
            this.size = docs.length;
            this.empty = docs.length === 0;
        }

        forEach(callback) {
            this.docs.forEach(callback);
        }
    }

    class DocumentReference {
        constructor(collectionName, id) {
            this.collectionName = collectionName;
            this.id = id || randomId();
        }

        async get() {
            const data = await request(`/firestore/${encodeURIComponent(this.collectionName)}/${encodeURIComponent(this.id)}/`, { method: "GET" });
            if (!data.exists) {
                return new DocumentSnapshot(this.id, {}, false);
            }
            return new DocumentSnapshot(this.id, data.document.data || {}, true);
        }

        async set(data, options) {
            const response = await request(`/firestore/${encodeURIComponent(this.collectionName)}/${encodeURIComponent(this.id)}/`, {
                method: "PUT",
                body: JSON.stringify({
                    data: toServer(data || {}),
                    merge: !!(options && options.merge)
                })
            });
            return response.document;
        }

        async update(data) {
            return this.set(data, { merge: true });
        }

        async delete() {
            await request(`/firestore/${encodeURIComponent(this.collectionName)}/${encodeURIComponent(this.id)}/`, { method: "DELETE" });
        }
    }

    class Query {
        constructor(collectionName, filters, order, limitValue) {
            this.collectionName = collectionName;
            this.filters = filters || [];
            this.order = order || null;
            this.limitValue = limitValue || 0;
        }

        where(field, op, value) {
            return new Query(this.collectionName, this.filters.concat([{ field: field, op: op, value: toServer(value) }]), this.order, this.limitValue);
        }

        orderBy(field, direction) {
            return new Query(this.collectionName, this.filters, { field: field, direction: direction || "asc" }, this.limitValue);
        }

        limit(value) {
            return new Query(this.collectionName, this.filters, this.order, Number(value) || 0);
        }

        async get() {
            const params = new URLSearchParams();
            if (this.filters.length) {
                params.set("where", JSON.stringify(this.filters));
            }
            if (this.order) {
                params.set("order_field", this.order.field);
                params.set("order_dir", this.order.direction);
            }
            if (this.limitValue) {
                params.set("limit", String(this.limitValue));
            }
            const suffix = params.toString() ? "?" + params.toString() : "";
            const data = await request(`/firestore/${encodeURIComponent(this.collectionName)}/${suffix}`, { method: "GET" });
            const docs = (data.documents || []).map((doc) => new DocumentSnapshot(doc.id, doc.data || {}, true));
            return new QuerySnapshot(docs);
        }
    }

    class CollectionReference extends Query {
        constructor(name) {
            super(name);
            this.id = name;
        }

        doc(id) {
            return new DocumentReference(this.collectionName, id || randomId());
        }

        async add(data) {
            const response = await request(`/firestore/${encodeURIComponent(this.collectionName)}/`, {
                method: "POST",
                body: JSON.stringify({ data: toServer(data || {}) })
            });
            return new DocumentReference(this.collectionName, response.id);
        }
    }

    class FirestoreCompat {
        collection(name) {
            return new CollectionReference(name);
        }
    }

    const authInstance = new AuthCompat();
    const firestoreInstance = new FirestoreCompat();
    const FieldValue = {
        serverTimestamp: function () {
            return { __serverTimestamp: true };
        }
    };

    function authFactory() {
        return authInstance;
    }
    authFactory.Auth = { Persistence: { LOCAL: "local" } };
    authFactory.EmailAuthProvider = {
        credential: function (email, password) {
            return { email: email, password: password };
        }
    };

    function firestoreFactory() {
        return firestoreInstance;
    }
    firestoreFactory.FieldValue = FieldValue;
    firestoreFactory.Timestamp = Timestamp;

    window.firebase = {
        __djangoCompat: true,
        apps: apps,
        initializeApp: function (config) {
            const app = { name: "[DEFAULT]", options: config || {} };
            if (!apps.length) {
                apps.push(app);
            }
            return apps[0];
        },
        auth: authFactory,
        firestore: firestoreFactory,
        functions: function () {
            return {};
        }
    };
})();
