var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/http.ts
var SESSION_COOKIE = "et_session";
var SESSION_MAX_AGE = 60 * 60 * 24 * 365;
var EXPENSE_PREFIX = "/expense";
function parsePath(pathname) {
  let prefix = "";
  let path = pathname;
  if (path === EXPENSE_PREFIX || path === `${EXPENSE_PREFIX}/`) {
    return { path: "/", prefix: EXPENSE_PREFIX };
  }
  if (path.startsWith(`${EXPENSE_PREFIX}/`)) {
    prefix = EXPENSE_PREFIX;
    path = path.slice(EXPENSE_PREFIX.length) || "/";
  }
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { path, prefix };
}
__name(parsePath, "parsePath");
function json(status, body) {
  return new Response(JSON.stringify(body) + "\n", {
    status,
    headers: { "content-type": "application/json" }
  });
}
__name(json, "json");
function jsonError(status, error, requestId2) {
  const payload = { error };
  if (requestId2) payload.request_id = requestId2;
  return json(status, payload);
}
__name(jsonError, "jsonError");
function noContent(headers) {
  return new Response(null, { status: 204, headers });
}
__name(noContent, "noContent");
function cookiePath(prefix) {
  return prefix ? `${prefix}/api` : "/api";
}
__name(cookiePath, "cookiePath");
function sessionCookie(secret, prefix, secure) {
  const parts = [
    `${SESSION_COOKIE}=${secret}`,
    `Path=${cookiePath(prefix)}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_MAX_AGE}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
__name(sessionCookie, "sessionCookie");
async function readJSON(request) {
  return await request.json();
}
__name(readJSON, "readJSON");
function nowUnix() {
  return Math.floor(Date.now() / 1e3);
}
__name(nowUnix, "nowUnix");
function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const len = Math.max(left.length, right.length, 1);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i++) {
    diff |= (left[i % left.length] ?? 0) ^ (right[i % right.length] ?? 0);
  }
  return diff === 0 && left.length === right.length && a.length > 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function bearerToken(header) {
  if (!header) return "";
  const prefix = "Bearer ";
  if (header.length <= prefix.length) return "";
  if (header.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return "";
  return header.slice(prefix.length).trim();
}
__name(bearerToken, "bearerToken");
function cookieValue(header, name) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=");
  }
  return "";
}
__name(cookieValue, "cookieValue");

// src/auth.ts
var FAIL_LIMIT = 10;
var failCounts = /* @__PURE__ */ new Map();
function clientIP(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown";
}
__name(clientIP, "clientIP");
function rateLimited(ip) {
  const now = Date.now();
  const rec = failCounts.get(ip);
  if (!rec || rec.resetAt < now) {
    failCounts.set(ip, { n: 1, resetAt: now + 6e4 });
    return false;
  }
  rec.n += 1;
  return rec.n > FAIL_LIMIT;
}
__name(rateLimited, "rateLimited");
function presentedSecret(request, secret) {
  const bearer = bearerToken(request.headers.get("authorization"));
  if (bearer && timingSafeEqual(bearer, secret)) return true;
  const cookie = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  return cookie !== "" && timingSafeEqual(cookie, secret);
}
__name(presentedSecret, "presentedSecret");
function requireSecret(request, env, requestId2) {
  if (presentedSecret(request, env.EXPENSE_SYNC_SECRET)) return null;
  if (rateLimited(clientIP(request))) {
    return jsonError(429, "too many auth failures", requestId2);
  }
  return jsonError(401, "unauthorized", requestId2);
}
__name(requireSecret, "requireSecret");
function loginConfigured(env) {
  return Boolean(env.LOGIN_USERNAME && env.LOGIN_PASSWORD);
}
__name(loginConfigured, "loginConfigured");
function loginOk(env, username, password) {
  return timingSafeEqual(username, env.LOGIN_USERNAME) && timingSafeEqual(password, env.LOGIN_PASSWORD);
}
__name(loginOk, "loginOk");
function issueSession(env, prefix, secure) {
  const headers = new Headers();
  headers.set("set-cookie", sessionCookie(env.EXPENSE_SYNC_SECRET, prefix, secure));
  return headers;
}
__name(issueSession, "issueSession");

// src/db.ts
async function first(stmt) {
  const row = await stmt.first();
  return row ?? null;
}
__name(first, "first");
async function all(stmt) {
  const res = await stmt.all();
  if (!res.success) throw new Error("d1 query failed");
  return res.results ?? [];
}
__name(all, "all");
async function run(stmt) {
  return stmt.run();
}
__name(run, "run");
async function nextServerVersion(db) {
  const row = await first(
    db.prepare("UPDATE sync_state SET current_version = current_version + 1 WHERE id = 1 RETURNING current_version")
  );
  if (row == null) throw new Error("sync_state missing");
  return row.current_version;
}
__name(nextServerVersion, "nextServerVersion");
async function currentServerVersion(db) {
  const row = await first(
    db.prepare("SELECT current_version FROM sync_state WHERE id = 1")
  );
  if (row == null) throw new Error("sync_state missing");
  return row.current_version;
}
__name(currentServerVersion, "currentServerVersion");
async function getPreferences(db) {
  const row = await first(
    db.prepare("SELECT currency, timezone, date_format FROM app_preferences WHERE id = 1")
  );
  if (row) return row;
  return { currency: "SGD", timezone: "Asia/Singapore", date_format: "2006-01-02" };
}
__name(getPreferences, "getPreferences");
async function savePreferences(db, prefs) {
  await run(
    db.prepare(
      "INSERT INTO app_preferences (id, currency, timezone, date_format) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET currency=excluded.currency, timezone=excluded.timezone, date_format=excluded.date_format"
    ).bind(prefs.currency, prefs.timezone, prefs.date_format)
  );
}
__name(savePreferences, "savePreferences");

// src/lww.ts
async function applyLWW(hooks, incoming, now) {
  if (hooks.normalize) incoming = hooks.normalize(incoming);
  const existing = await hooks.load(incoming);
  if (!existing) return hooks.create(incoming, now);
  const incomingTs = incoming.client_updated_at;
  const existingTs = hooks.existingClientUpdatedAt(existing);
  const apply = incomingTs > existingTs || incomingTs === existingTs && !hooks.equalState(existing, incoming);
  if (!apply) return existing;
  if (incoming.deleted_at != null) {
    if (hooks.existingDeleted(existing)) return existing;
    return hooks.softDelete(existing, incoming, now);
  }
  return hooks.update(existing, incoming, now);
}
__name(applyLWW, "applyLWW");
function deletedStateEqual(existingDeleted, incomingDeleted) {
  return existingDeleted === incomingDeleted;
}
__name(deletedStateEqual, "deletedStateEqual");
function nullableEqual(existing, incoming) {
  if (incoming == null) return existing == null;
  return existing != null && existing === incoming;
}
__name(nullableEqual, "nullableEqual");
function nullableStringEqual(existing, incoming) {
  if (incoming == null) return existing == null;
  return existing != null && existing === incoming;
}
__name(nullableStringEqual, "nullableStringEqual");

// src/categories.ts
function categoryFromRow(row) {
  const cat = {
    id: row.id,
    name: row.name,
    icon: row.icon,
    budget: row.budget,
    created_at: row.created_at,
    updated_at: row.updated_at,
    client_updated_at: row.client_updated_at
  };
  if (row.deleted_at != null) cat.deleted_at = row.deleted_at;
  return cat;
}
__name(categoryFromRow, "categoryFromRow");
async function getCategoryIncludingDeleted(db, id) {
  return first(db.prepare("SELECT * FROM categories WHERE id = ?").bind(id));
}
__name(getCategoryIncludingDeleted, "getCategoryIncludingDeleted");
async function getActiveCategory(db, id) {
  return first(db.prepare("SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL").bind(id));
}
__name(getActiveCategory, "getActiveCategory");
async function listCategories(db) {
  const rows = await all(
    db.prepare("SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name")
  );
  return rows.map(categoryFromRow);
}
__name(listCategories, "listCategories");
async function listCategoriesSince(db, since) {
  return all(db.prepare("SELECT * FROM categories WHERE server_version > ?").bind(since));
}
__name(listCategoriesSince, "listCategoriesSince");
async function listActiveCategoriesByName(db, name) {
  return all(
    db.prepare("SELECT * FROM categories WHERE name = ? AND deleted_at IS NULL ORDER BY created_at, id").bind(name)
  );
}
__name(listActiveCategoriesByName, "listActiveCategoriesByName");
async function resolveActiveCategoryID(db, id, name) {
  let categoryId = id;
  if (!categoryId && name) {
    const found = await listActiveCategoriesByName(db, name);
    if (found.length === 0) {
      throw new Error(`category ${JSON.stringify(name)} not found. Run 'expense category list' to see available categories`);
    }
    if (found.length > 1) {
      throw new Error(
        `category ${JSON.stringify(name)} is ambiguous; found ${found.length} active categories with that name, use category_id instead`
      );
    }
    categoryId = found[0].id;
  }
  if (!categoryId) throw new Error("category is required");
  const row = await getActiveCategory(db, categoryId);
  if (!row) throw new Error(`category ${JSON.stringify(categoryId)} not found`);
  return categoryId;
}
__name(resolveActiveCategoryID, "resolveActiveCategoryID");
async function createCategory(db, input, now) {
  if (!input.name) throw new Error("category name is required");
  const id = crypto.randomUUID();
  const row = await first(
    db.prepare(
      "INSERT INTO categories (id, name, icon, budget, created_at, updated_at, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).bind(id, input.name, input.icon, input.budget, now, now, now, null)
  );
  if (!row) throw new Error("creating category");
  return categoryFromRow(row);
}
__name(createCategory, "createCategory");
async function updateCategory(db, id, patch, now) {
  const existing = await getActiveCategory(db, id);
  if (!existing) throw Object.assign(new Error("category not found"), { status: 404 });
  const name = patch.name || existing.name;
  const icon = patch.icon || existing.icon;
  const budget = patch.budget !== void 0 ? patch.budget : existing.budget;
  await run(
    db.prepare(
      "UPDATE categories SET name = ?, icon = ?, budget = ?, updated_at = ?, client_updated_at = ? WHERE id = ?"
    ).bind(name, icon, budget, now, now, id)
  );
  const updated = await getActiveCategory(db, id);
  if (!updated) throw new Error("category not found");
  return categoryFromRow(updated);
}
__name(updateCategory, "updateCategory");
async function deleteCategory(db, id, now) {
  await run(
    db.prepare(
      "UPDATE categories SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    ).bind(now, now, now, id)
  );
}
__name(deleteCategory, "deleteCategory");
async function pushCategory(db, input, now) {
  if (!input.id) throw new Error("category id is required");
  const serverVersion = await nextServerVersion(db);
  const row = await applyLWW(
    {
      load: /* @__PURE__ */ __name((incoming) => getCategoryIncludingDeleted(db, incoming.id), "load"),
      existingClientUpdatedAt: /* @__PURE__ */ __name((c) => c.client_updated_at, "existingClientUpdatedAt"),
      existingDeleted: /* @__PURE__ */ __name((c) => c.deleted_at != null, "existingDeleted"),
      equalState: /* @__PURE__ */ __name((c, incoming) => c.name === incoming.name && c.icon === incoming.icon && nullableEqual(c.budget, incoming.budget ?? null) && deletedStateEqual(c.deleted_at != null, incoming.deleted_at != null), "equalState"),
      create: /* @__PURE__ */ __name(async (incoming, ts) => {
        const created = await first(
          db.prepare(
            "INSERT INTO categories (id, name, icon, budget, created_at, updated_at, client_updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
          ).bind(
            incoming.id,
            incoming.name,
            incoming.icon,
            incoming.budget ?? null,
            ts,
            ts,
            incoming.client_updated_at,
            incoming.deleted_at != null ? ts : null
          )
        );
        if (!created) throw new Error("creating category");
        return created;
      }, "create"),
      update: /* @__PURE__ */ __name(async (existing, incoming, ts) => {
        const updated = await first(
          db.prepare(
            "UPDATE categories SET name = ?, icon = ?, budget = ?, updated_at = ?, client_updated_at = ?, server_version = ? WHERE id = ? RETURNING *"
          ).bind(
            incoming.name,
            incoming.icon,
            incoming.budget ?? null,
            ts,
            incoming.client_updated_at,
            serverVersion,
            existing.id
          )
        );
        if (!updated) throw new Error("updating category");
        return updated;
      }, "update"),
      softDelete: /* @__PURE__ */ __name(async (existing, incoming, ts) => {
        const updated = await first(
          db.prepare(
            "UPDATE categories SET deleted_at = ?, updated_at = ?, client_updated_at = ?, server_version = ? WHERE id = ? RETURNING *"
          ).bind(ts, ts, incoming.client_updated_at, serverVersion, existing.id)
        );
        if (!updated) throw new Error("deleting category");
        return updated;
      }, "softDelete")
    },
    input,
    now
  );
  return categoryFromRow(row);
}
__name(pushCategory, "pushCategory");

// src/expenses.ts
function expenseFromRow(row, categoryName = row.category_name ?? "") {
  const exp = {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    category_id: row.category_id,
    category: categoryName,
    description: row.description,
    merchant: row.merchant,
    date: row.date,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
    client_updated_at: row.client_updated_at
  };
  if (row.deleted_at != null) exp.deleted_at = row.deleted_at;
  return exp;
}
__name(expenseFromRow, "expenseFromRow");
async function getExpenseIncludingDeleted(db, id) {
  return first(db.prepare("SELECT * FROM expenses WHERE id = ?").bind(id));
}
__name(getExpenseIncludingDeleted, "getExpenseIncludingDeleted");
async function getExpenseByID(db, id) {
  return first(db.prepare("SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL").bind(id));
}
__name(getExpenseByID, "getExpenseByID");
async function listExpensesSince(db, since) {
  return all(db.prepare("SELECT * FROM expenses WHERE server_version > ?").bind(since));
}
__name(listExpensesSince, "listExpensesSince");
async function listExpensesWindow(db, before, since, limit) {
  const rows = await all(
    db.prepare(
      `SELECT e.*, c.name AS category_name
         FROM expenses e
         LEFT JOIN categories c ON e.category_id = c.id
         WHERE e.deleted_at IS NULL AND e.date < ? AND e.date >= ?
         ORDER BY e.date DESC, e.created_at DESC, e.id DESC
         LIMIT ?`
    ).bind(before, since, limit)
  );
  return rows.map((row) => expenseFromRow(row, row.category_name ?? ""));
}
__name(listExpensesWindow, "listExpensesWindow");
async function sumExpensesWindow(db, before, since) {
  const row = await first(
    db.prepare(
      `SELECT CAST(COALESCE(SUM(amount), 0) AS INTEGER) AS total
         FROM expenses
         WHERE deleted_at IS NULL AND date >= ? AND date < ?`
    ).bind(since, before)
  );
  return row?.total ?? 0;
}
__name(sumExpensesWindow, "sumExpensesWindow");
async function createExpense(db, input, prefsCurrency, now) {
  if (input.amount <= 0) throw new Error("amount must be positive");
  const categoryId = await resolveActiveCategoryID(db, input.category_id, input.category ?? "");
  const currency = input.currency || prefsCurrency;
  const date = input.date || now;
  const id = input.id || crypto.randomUUID();
  const source = input.source || "cli";
  const clientUpdatedAt = input.client_updated_at || now;
  const row = await first(
    db.prepare(
      `INSERT INTO expenses (id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, client_updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(id, input.amount, currency, categoryId, input.description, input.merchant, date, source, now, now, clientUpdatedAt, null)
  );
  if (!row) throw new Error("creating expense");
  const cat = await getCategoryIncludingDeleted(db, categoryId);
  return expenseFromRow(row, cat?.name ?? "");
}
__name(createExpense, "createExpense");
async function updateExpense(db, id, patch, now) {
  const existing = await getExpenseByID(db, id);
  if (!existing) throw Object.assign(new Error("expense not found"), { status: 404 });
  const amount = patch.amount && patch.amount > 0 ? patch.amount : existing.amount;
  const currency = patch.currency || existing.currency;
  let categoryId = existing.category_id;
  if (patch.category) categoryId = await resolveActiveCategoryID(db, "", patch.category);
  else if (patch.category_id) categoryId = await resolveActiveCategoryID(db, patch.category_id, "");
  const description = patch.description || existing.description;
  const merchant = patch.merchant || existing.merchant;
  const date = patch.date && patch.date > 0 ? patch.date : existing.date;
  await run(
    db.prepare(
      "UPDATE expenses SET amount = ?, currency = ?, category_id = ?, description = ?, merchant = ?, date = ?, updated_at = ?, client_updated_at = ? WHERE id = ?"
    ).bind(amount, currency, categoryId, description, merchant, date, now, now, id)
  );
  return getExpense(db, id);
}
__name(updateExpense, "updateExpense");
async function getExpense(db, id) {
  const row = await getExpenseByID(db, id);
  if (!row) throw Object.assign(new Error("expense not found"), { status: 404 });
  const cat = await getCategoryIncludingDeleted(db, row.category_id);
  return expenseFromRow(row, cat?.name ?? "");
}
__name(getExpense, "getExpense");
async function deleteExpense(db, id, now) {
  await run(
    db.prepare(
      "UPDATE expenses SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    ).bind(now, now, now, id)
  );
}
__name(deleteExpense, "deleteExpense");
async function pushExpense(db, input, now) {
  if (!input.id) throw new Error("expense id is required");
  const serverVersion = await nextServerVersion(db);
  const row = await applyLWW(
    {
      load: /* @__PURE__ */ __name((incoming) => getExpenseIncludingDeleted(db, incoming.id), "load"),
      existingClientUpdatedAt: /* @__PURE__ */ __name((e) => e.client_updated_at, "existingClientUpdatedAt"),
      existingDeleted: /* @__PURE__ */ __name((e) => e.deleted_at != null, "existingDeleted"),
      normalize: /* @__PURE__ */ __name((incoming) => ({ ...incoming, source: incoming.source || "manual" }), "normalize"),
      equalState: /* @__PURE__ */ __name((e, incoming) => e.amount === incoming.amount && e.currency === incoming.currency && e.category_id === incoming.category_id && e.description === incoming.description && e.merchant === incoming.merchant && e.date === incoming.date && e.source === incoming.source && deletedStateEqual(e.deleted_at != null, incoming.deleted_at != null), "equalState"),
      create: /* @__PURE__ */ __name(async (incoming, ts) => {
        const created = await first(
          db.prepare(
            `INSERT INTO expenses (id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, client_updated_at, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
          ).bind(
            incoming.id,
            incoming.amount,
            incoming.currency,
            incoming.category_id,
            incoming.description,
            incoming.merchant,
            incoming.date,
            incoming.source || "manual",
            ts,
            ts,
            incoming.client_updated_at,
            incoming.deleted_at != null ? ts : null
          )
        );
        if (!created) throw new Error("creating expense");
        return created;
      }, "create"),
      update: /* @__PURE__ */ __name(async (existing, incoming, ts) => {
        const updated = await first(
          db.prepare(
            `UPDATE expenses SET amount = ?, currency = ?, category_id = ?, description = ?, merchant = ?, date = ?, source = ?, updated_at = ?, client_updated_at = ?, server_version = ?
               WHERE id = ? RETURNING *`
          ).bind(
            incoming.amount,
            incoming.currency,
            incoming.category_id,
            incoming.description,
            incoming.merchant,
            incoming.date,
            incoming.source || "manual",
            ts,
            incoming.client_updated_at,
            serverVersion,
            existing.id
          )
        );
        if (!updated) throw new Error("updating expense");
        return updated;
      }, "update"),
      softDelete: /* @__PURE__ */ __name(async (existing, incoming, ts) => {
        const updated = await first(
          db.prepare(
            "UPDATE expenses SET deleted_at = ?, updated_at = ?, client_updated_at = ?, server_version = ? WHERE id = ? RETURNING *"
          ).bind(ts, ts, incoming.client_updated_at, serverVersion, existing.id)
        );
        if (!updated) throw new Error("deleting expense");
        return updated;
      }, "softDelete")
    },
    input,
    now
  );
  const cat = await getCategoryIncludingDeleted(db, row.category_id);
  return expenseFromRow(row, cat?.name ?? "");
}
__name(pushExpense, "pushExpense");

// src/feedback.ts
var GITHUB_OWNER = "baggiiiie";
var GITHUB_REPO = "expense-tracking";
function extensionFromContentType(ct) {
  switch (ct) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    default:
      return ".png";
  }
}
__name(extensionFromContentType, "extensionFromContentType");
async function githubJSON(token, url, method, payload) {
  return fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "expense-tracking-worker",
      accept: "application/vnd.github+json",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
__name(githubJSON, "githubJSON");
async function submitFeedback(token, req) {
  if (!req.body.trim()) throw Object.assign(new Error("feedback body is required"), { status: 400 });
  const imageURLs = [];
  for (const [i, img] of (req.images ?? []).entries()) {
    const filename = `.feedback/images/${crypto.randomUUID().slice(0, 8)}-${i}${extensionFromContentType(img.contentType)}`;
    const resp = await githubJSON(
      token,
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filename}`,
      "PUT",
      { message: `feedback: upload image ${i + 1}`, content: img.data }
    );
    if (resp.status !== 201) {
      throw Object.assign(new Error(`failed to upload image ${i + 1}: GitHub API returned ${resp.status}`), {
        status: 502
      });
    }
    const result = await resp.json();
    if (result.content?.download_url) imageURLs.push(result.content.download_url);
  }
  let body = `**App:** Svelte web app

**Route:** \`${req.route}\`

`;
  if (req.version?.trim()) body += `**Build:** \`${req.version.trim()}\`

`;
  body += `**Submitted:** ${(/* @__PURE__ */ new Date()).toISOString()}

---

${req.body}`;
  if (imageURLs.length) {
    body += "\n\n---\n\n### Attached Images\n\n";
    imageURLs.forEach((url, i) => {
      body += `![image-${i + 1}](${url})

`;
    });
  }
  const issue = await githubJSON(token, `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, "POST", {
    title: `Feedback from ${req.route}`,
    body,
    labels: ["feedback"]
  });
  if (issue.status !== 201) {
    throw Object.assign(new Error(`failed to create issue: GitHub API returned ${issue.status}`), { status: 502 });
  }
}
__name(submitFeedback, "submitFeedback");

// src/time.ts
var TZ_OFFSETS = {
  UTC: 0,
  "Asia/Singapore": 8 * 3600
};
function timezoneOffsetSeconds(timezone) {
  return TZ_OFFSETS[timezone] ?? 8 * 3600;
}
__name(timezoneOffsetSeconds, "timezoneOffsetSeconds");
function startOfDayUnix(nowUnix2, timezone) {
  const offset = timezoneOffsetSeconds(timezone);
  const local = nowUnix2 + offset;
  const day = Math.floor(local / 86400) * 86400;
  return day - offset;
}
__name(startOfDayUnix, "startOfDayUnix");
function ymdInZone(unix, timezone) {
  const offset = timezoneOffsetSeconds(timezone);
  const d = new Date((unix + offset) * 1e3);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
__name(ymdInZone, "ymdInZone");
function unixAtMidnight(year, month, day, timezone) {
  const offset = timezoneOffsetSeconds(timezone);
  return Date.UTC(year, month - 1, day) / 1e3 - offset;
}
__name(unixAtMidnight, "unixAtMidnight");
function clampDay(year, month, day, timezone) {
  if (day < 1) day = 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) day = last;
  return unixAtMidnight(year, month, day, timezone);
}
__name(clampDay, "clampDay");
function nextRunDate(after, frequency, dayOfMonth, timezone) {
  const { year, month, day } = ymdInZone(after, timezone);
  const targetDay = dayOfMonth ?? day;
  if (frequency === "weekly") return after + 7 * 86400;
  if (frequency === "yearly") return clampDay(year + 1, month, targetDay, timezone);
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  return clampDay(nextYear, nextMonth, targetDay, timezone);
}
__name(nextRunDate, "nextRunDate");
var expenseDefaultWindow = 30 * 24 * 3600;
var expenseDefaultLimit = 100;
var expenseMaxLimit = 500;
function parseExpenseWindow(search, now) {
  const explicitBefore = search.has("before");
  const explicitSince = search.has("since");
  let before = now + 1;
  if (explicitBefore) {
    const parsed = Number(search.get("before"));
    if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, error: "invalid 'before' parameter" };
    before = parsed;
  }
  let since = now - expenseDefaultWindow;
  if (explicitSince) {
    const parsed = Number(search.get("since"));
    if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, error: "invalid 'since' parameter" };
    since = parsed;
  } else if (explicitBefore) {
    since = 0;
  }
  if (before <= since) return { ok: false, error: "'before' must be greater than 'since'" };
  let limit = expenseDefaultLimit;
  const raw = search.get("limit");
  if (raw) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false, error: "invalid 'limit' parameter" };
    limit = Math.min(parsed, expenseMaxLimit);
  }
  return { ok: true, window: { before, since, limit } };
}
__name(parseExpenseWindow, "parseExpenseWindow");

// src/uuid.ts
var NAMESPACE_OID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
__name(hexToBytes, "hexToBytes");
function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(bytesToHex, "bytesToHex");
async function uuidv5(name, namespace = NAMESPACE_OID) {
  const ns = hexToBytes(namespace.replace(/-/g, ""));
  const nameBytes = new TextEncoder().encode(name);
  const buf = new Uint8Array(ns.length + nameBytes.length);
  buf.set(ns);
  buf.set(nameBytes, ns.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", buf));
  hash[6] = hash[6] & 15 | 80;
  hash[8] = hash[8] & 63 | 128;
  const h = bytesToHex(hash.slice(0, 16));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
__name(uuidv5, "uuidv5");
async function recurringIDs(recurringExpenseId, occurrenceDate) {
  const key = `${recurringExpenseId}:${occurrenceDate}`;
  return {
    expenseId: await uuidv5(`expense:${key}`),
    runId: await uuidv5(`run:${key}`)
  };
}
__name(recurringIDs, "recurringIDs");

// src/recurring.ts
var recurringSelect = "id, amount, currency, category_id, description, merchant, frequency, day_of_month, start_date, end_date, next_run_date, last_run_date, created_at, updated_at, deleted_at, server_version, client_updated_at";
function recurringFromRow(row) {
  const r = {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    category_id: row.category_id,
    description: row.description,
    merchant: row.merchant,
    frequency: row.frequency,
    start_date: row.start_date,
    next_run_date: row.next_run_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    client_updated_at: row.client_updated_at
  };
  if (row.day_of_month != null) r.day_of_month = row.day_of_month;
  if (row.end_date != null) r.end_date = row.end_date;
  if (row.last_run_date != null) r.last_run_date = row.last_run_date;
  if (row.deleted_at != null) r.deleted_at = row.deleted_at;
  return r;
}
__name(recurringFromRow, "recurringFromRow");
async function getRecurring(db, id) {
  return first(db.prepare(`SELECT ${recurringSelect} FROM recurring_expenses WHERE id = ?`).bind(id));
}
__name(getRecurring, "getRecurring");
async function listRecurring(db) {
  const rows = await all(
    db.prepare(
      `SELECT ${recurringSelect} FROM recurring_expenses WHERE deleted_at IS NULL ORDER BY next_run_date`
    )
  );
  return rows.map(recurringFromRow);
}
__name(listRecurring, "listRecurring");
async function listRecurringSince(db, since) {
  const rows = await all(
    db.prepare(`SELECT ${recurringSelect} FROM recurring_expenses WHERE server_version > ?`).bind(since)
  );
  return rows.map(recurringFromRow);
}
__name(listRecurringSince, "listRecurringSince");
async function createRecurring(db, input, now) {
  if (input.amount <= 0) throw new Error("amount must be positive");
  if (!["weekly", "monthly", "yearly"].includes(input.frequency)) {
    throw new Error("frequency must be one of weekly, monthly, yearly");
  }
  if (!input.start_date) throw new Error("start_date is required");
  if (input.end_date != null && input.end_date < input.start_date) {
    throw new Error("end_date must be on or after start_date");
  }
  if (!input.currency) throw new Error("currency is required");
  const categoryId = await resolveActiveCategoryID(db, input.category_id, input.category ?? "");
  const id = crypto.randomUUID();
  await run(
    db.prepare(
      `INSERT INTO recurring_expenses (id, amount, currency, category_id, description, merchant, frequency, day_of_month, start_date, end_date, next_run_date, last_run_date, created_at, updated_at, client_updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      input.amount,
      input.currency,
      categoryId,
      input.description,
      input.merchant,
      input.frequency,
      input.day_of_month ?? null,
      input.start_date,
      input.end_date ?? null,
      input.start_date,
      null,
      now,
      now,
      now,
      null
    )
  );
  const row = await getRecurring(db, id);
  if (!row) throw new Error("creating recurring expense");
  return recurringFromRow(row);
}
__name(createRecurring, "createRecurring");
async function updateRecurring(db, id, patch, now) {
  const existing = await getRecurring(db, id);
  if (!existing || existing.deleted_at != null) {
    throw Object.assign(new Error("recurring expense not found"), { status: 404 });
  }
  const amount = patch.amount && patch.amount > 0 ? patch.amount : existing.amount;
  const currency = patch.currency || existing.currency;
  let categoryId = existing.category_id;
  if (patch.category_id) categoryId = await resolveActiveCategoryID(db, patch.category_id, "");
  else if (patch.category) categoryId = await resolveActiveCategoryID(db, "", patch.category);
  const description = patch.description || existing.description;
  const merchant = patch.merchant || existing.merchant;
  let frequency = existing.frequency;
  if (patch.frequency) {
    if (!["weekly", "monthly", "yearly"].includes(patch.frequency)) {
      throw new Error("frequency must be one of weekly, monthly, yearly");
    }
    frequency = patch.frequency;
  }
  const dayOfMonth = patch.day_of_month !== void 0 ? patch.day_of_month : existing.day_of_month;
  const startDate = patch.start_date && patch.start_date > 0 ? patch.start_date : existing.start_date;
  const endDate = patch.end_date !== void 0 ? patch.end_date : existing.end_date;
  if (endDate != null && endDate < startDate) throw new Error("end_date must be on or after start_date");
  await run(
    db.prepare(
      `UPDATE recurring_expenses SET amount=?, currency=?, category_id=?, description=?, merchant=?, frequency=?, day_of_month=?, start_date=?, end_date=?, next_run_date=?, last_run_date=?, updated_at=?, client_updated_at=?, deleted_at=? WHERE id=?`
    ).bind(
      amount,
      currency,
      categoryId,
      description,
      merchant,
      frequency,
      dayOfMonth,
      startDate,
      endDate,
      existing.next_run_date,
      existing.last_run_date,
      now,
      now,
      existing.deleted_at,
      id
    )
  );
  const updated = await getRecurring(db, id);
  if (!updated) throw new Error("recurring expense not found");
  return recurringFromRow(updated);
}
__name(updateRecurring, "updateRecurring");
async function deleteRecurring(db, id, now) {
  await run(
    db.prepare(
      "UPDATE recurring_expenses SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    ).bind(now, now, now, id)
  );
}
__name(deleteRecurring, "deleteRecurring");
async function materializeOne(db, r, today, now, timezone) {
  let next = r.next_run_date;
  let last = null;
  for (let guard = 0; next <= today && guard < 120; guard++) {
    if (r.end_date != null && next > r.end_date) break;
    const ids = await recurringIDs(r.id, next);
    await run(
      db.prepare(
        `INSERT OR IGNORE INTO expenses (id, amount, currency, category_id, description, merchant, date, source, created_at, updated_at, client_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'recurring', ?, ?, ?)`
      ).bind(
        ids.expenseId,
        r.amount,
        r.currency,
        r.category_id,
        r.description,
        r.merchant,
        next,
        now,
        now,
        now
      )
    );
    await run(
      db.prepare(
        "INSERT OR IGNORE INTO recurring_expense_runs (id, recurring_expense_id, expense_id, occurrence_date, created_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(ids.runId, r.id, ids.expenseId, next, now)
    );
    last = next;
    next = nextRunDate(next, r.frequency, r.day_of_month, timezone);
  }
  if (last == null) return;
  const serverVersion = await nextServerVersion(db);
  await run(
    db.prepare(
      "UPDATE recurring_expenses SET last_run_date = ?, next_run_date = ?, updated_at = ?, client_updated_at = ?, server_version = ? WHERE id = ?"
    ).bind(last, next, now, now, serverVersion, r.id)
  );
}
__name(materializeOne, "materializeOne");
async function materializeDueRecurring(db, now, timezone) {
  const today = startOfDayUnix(now, timezone);
  const rows = await all(
    db.prepare(
      `SELECT ${recurringSelect} FROM recurring_expenses
         WHERE deleted_at IS NULL AND next_run_date <= ? AND (end_date IS NULL OR end_date >= next_run_date)
         ORDER BY next_run_date LIMIT 500`
    ).bind(today)
  );
  for (const row of rows) {
    await materializeOne(db, recurringFromRow(row), today, now, timezone);
  }
}
__name(materializeDueRecurring, "materializeDueRecurring");
async function pushRecurring(db, input, now) {
  if (!input.id) throw new Error("recurring expense id is required");
  const serverVersion = await nextServerVersion(db);
  const row = await applyLWW(
    {
      load: /* @__PURE__ */ __name((incoming) => getRecurring(db, incoming.id), "load"),
      existingClientUpdatedAt: /* @__PURE__ */ __name((r) => r.client_updated_at, "existingClientUpdatedAt"),
      existingDeleted: /* @__PURE__ */ __name((r) => r.deleted_at != null, "existingDeleted"),
      equalState: /* @__PURE__ */ __name((r, incoming) => r.amount === incoming.amount && r.currency === incoming.currency && r.category_id === incoming.category_id && r.description === incoming.description && r.merchant === incoming.merchant && r.frequency === incoming.frequency && nullableEqual(r.day_of_month, incoming.day_of_month ?? null) && r.start_date === incoming.start_date && nullableEqual(r.end_date, incoming.end_date ?? null) && r.next_run_date === incoming.next_run_date && nullableEqual(r.last_run_date, incoming.last_run_date ?? null) && deletedStateEqual(r.deleted_at != null, incoming.deleted_at != null), "equalState"),
      create: /* @__PURE__ */ __name(async (incoming, ts) => {
        await run(
          db.prepare(
            `INSERT INTO recurring_expenses (id, amount, currency, category_id, description, merchant, frequency, day_of_month, start_date, end_date, next_run_date, last_run_date, created_at, updated_at, client_updated_at, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            incoming.id,
            incoming.amount,
            incoming.currency,
            incoming.category_id,
            incoming.description,
            incoming.merchant,
            incoming.frequency,
            incoming.day_of_month ?? null,
            incoming.start_date,
            incoming.end_date ?? null,
            incoming.next_run_date,
            incoming.last_run_date ?? null,
            ts,
            ts,
            incoming.client_updated_at,
            incoming.deleted_at != null ? ts : null
          )
        );
        const created = await getRecurring(db, incoming.id);
        if (!created) throw new Error("creating recurring expense");
        return created;
      }, "create"),
      update: /* @__PURE__ */ __name(async (existing, incoming, ts) => {
        const updated = await first(
          db.prepare(
            `UPDATE recurring_expenses SET amount=?, currency=?, category_id=?, description=?, merchant=?, frequency=?, day_of_month=?, start_date=?, end_date=?, next_run_date=?, last_run_date=?, updated_at=?, client_updated_at=?, server_version=?
               WHERE id=? RETURNING ${recurringSelect}`
          ).bind(
            incoming.amount,
            incoming.currency,
            incoming.category_id,
            incoming.description,
            incoming.merchant,
            incoming.frequency,
            incoming.day_of_month ?? null,
            incoming.start_date,
            incoming.end_date ?? null,
            incoming.next_run_date,
            incoming.last_run_date ?? null,
            ts,
            incoming.client_updated_at,
            serverVersion,
            existing.id
          )
        );
        if (!updated) throw new Error("updating recurring expense");
        return updated;
      }, "update"),
      softDelete: /* @__PURE__ */ __name(async (existing, incoming, ts) => {
        const updated = await first(
          db.prepare(
            `UPDATE recurring_expenses SET deleted_at=?, updated_at=?, client_updated_at=?, server_version=? WHERE id=? RETURNING ${recurringSelect}`
          ).bind(ts, ts, incoming.client_updated_at, serverVersion, existing.id)
        );
        if (!updated) throw new Error("deleting recurring expense");
        return updated;
      }, "softDelete")
    },
    input,
    now
  );
  return recurringFromRow(row);
}
__name(pushRecurring, "pushRecurring");

// src/wallet.ts
var walletSelect = "id, amount, currency, merchant, card_name, captured_at, source, status, linked_expense_id, created_at, updated_at, client_updated_at, server_version";
var ErrWalletSuggestionNotFound = Object.assign(new Error("wallet suggestion not found"), { status: 404 });
var ErrWalletSuggestionNotPending = Object.assign(new Error("wallet suggestion is not pending"), {
  status: 409
});
function walletFromRow(row) {
  const ws = {
    id: row.id,
    currency: row.currency,
    merchant: row.merchant,
    captured_at: row.captured_at,
    source: row.source,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    client_updated_at: row.client_updated_at,
    server_version: row.server_version
  };
  if (row.amount != null) ws.amount = row.amount;
  if (row.card_name) ws.card_name = row.card_name;
  if (row.linked_expense_id) ws.linked_expense_id = row.linked_expense_id;
  return ws;
}
__name(walletFromRow, "walletFromRow");
async function getWallet(db, id) {
  return first(db.prepare(`SELECT ${walletSelect} FROM wallet_suggestions WHERE id = ?`).bind(id));
}
__name(getWallet, "getWallet");
async function listWalletSince(db, since) {
  return all(
    db.prepare(`SELECT ${walletSelect} FROM wallet_suggestions WHERE server_version > ?`).bind(since)
  );
}
__name(listWalletSince, "listWalletSince");
async function listWalletByStatus(db, status) {
  const rows = await all(
    db.prepare(
      `SELECT ${walletSelect} FROM wallet_suggestions WHERE status = ? ORDER BY captured_at DESC, id DESC`
    ).bind(status || "pending")
  );
  return rows.map(walletFromRow);
}
__name(listWalletByStatus, "listWalletByStatus");
async function createWallet(db, input, now) {
  const id = input.id || crypto.randomUUID();
  const capturedAt = input.captured_at || now;
  const source = input.source || "shortcut";
  const clientUpdatedAt = input.client_updated_at || now;
  await run(
    db.prepare(
      `INSERT OR IGNORE INTO wallet_suggestions (
          id, amount, currency, merchant, card_name, captured_at, source, status,
          created_at, updated_at, client_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).bind(
      id,
      input.amount ?? null,
      input.currency,
      input.merchant,
      input.card_name ?? null,
      capturedAt,
      source,
      now,
      now,
      clientUpdatedAt
    )
  );
  const row = await getWallet(db, id);
  if (!row) throw new Error("creating wallet suggestion");
  return walletFromRow(row);
}
__name(createWallet, "createWallet");
async function dismissWallet(db, id, now) {
  const result = await run(
    db.prepare(
      `UPDATE wallet_suggestions SET status = 'dismissed', updated_at = ?, client_updated_at = ?
         WHERE id = ? AND status = 'pending'`
    ).bind(now, now, id)
  );
  if ((result.meta.changes ?? 0) !== 1) {
    const existing = await getWallet(db, id);
    if (!existing) throw ErrWalletSuggestionNotFound;
    throw ErrWalletSuggestionNotPending;
  }
  const row = await getWallet(db, id);
  if (!row) throw ErrWalletSuggestionNotFound;
  return walletFromRow(row);
}
__name(dismissWallet, "dismissWallet");
async function confirmWallet(db, id, expenseInput, prefsCurrency, now) {
  const pending = await getWallet(db, id);
  if (!pending) throw ErrWalletSuggestionNotFound;
  if (pending.status !== "pending") throw ErrWalletSuggestionNotPending;
  const expense = await createExpense(db, expenseInput, prefsCurrency, now);
  const result = await run(
    db.prepare(
      `UPDATE wallet_suggestions SET status = 'accepted', linked_expense_id = ?, updated_at = ?, client_updated_at = ?
         WHERE id = ? AND status = 'pending'`
    ).bind(expense.id, now, now, id)
  );
  if ((result.meta.changes ?? 0) !== 1) throw ErrWalletSuggestionNotPending;
  const row = await getWallet(db, id);
  if (!row) throw ErrWalletSuggestionNotFound;
  return { suggestion: walletFromRow(row), expense };
}
__name(confirmWallet, "confirmWallet");
async function pushWallet(db, input, now) {
  if (!input.id) throw new Error("wallet suggestion id is required");
  const existing = await getWallet(db, input.id);
  if (!existing) throw ErrWalletSuggestionNotFound;
  if (input.status !== "accepted" && input.status !== "dismissed") {
    throw new Error("wallet suggestion status must be accepted or dismissed");
  }
  if (input.status === "accepted" && input.linked_expense_id == null) {
    throw new Error("accepted wallet suggestion requires linked_expense_id");
  }
  if (input.status === "dismissed" && input.linked_expense_id != null) {
    throw new Error("dismissed wallet suggestion must not include linked_expense_id");
  }
  if (existing.client_updated_at > input.client_updated_at) return walletFromRow(existing);
  if (existing.client_updated_at === input.client_updated_at && existing.status === input.status && nullableStringEqual(existing.linked_expense_id, input.linked_expense_id ?? null)) {
    return walletFromRow(existing);
  }
  const serverVersion = await nextServerVersion(db);
  const updated = await first(
    db.prepare(
      `UPDATE wallet_suggestions SET status = ?, linked_expense_id = ?, updated_at = ?, client_updated_at = ?, server_version = ?
         WHERE id = ? RETURNING ${walletSelect}`
    ).bind(input.status, input.linked_expense_id ?? null, now, input.client_updated_at, serverVersion, input.id)
  );
  if (!updated) throw new Error("updating wallet suggestion");
  return walletFromRow(updated);
}
__name(pushWallet, "pushWallet");

// src/sync.ts
async function syncPull(db, sinceVersion) {
  const serverVersion = await currentServerVersion(db);
  const expenseRows = await listExpensesSince(db, sinceVersion);
  const categoryRows = await listCategoriesSince(db, sinceVersion);
  const recurring = await listRecurringSince(db, sinceVersion);
  const walletRows = await listWalletSince(db, sinceVersion);
  const included = /* @__PURE__ */ new Map();
  for (const row of categoryRows) included.set(row.id, categoryFromRow(row));
  for (const r of recurring) {
    if (included.has(r.category_id)) continue;
    const cat = await getCategoryIncludingDeleted(db, r.category_id);
    if (!cat) throw new Error(`loading category "${r.category_id}" for recurring expense "${r.id}"`);
    included.set(cat.id, categoryFromRow(cat));
  }
  const expenses = [];
  for (const row of expenseRows) {
    if (!included.has(row.category_id)) {
      const cat = await getCategoryIncludingDeleted(db, row.category_id);
      if (!cat) throw new Error(`loading category "${row.category_id}" for expense "${row.id}"`);
      included.set(cat.id, categoryFromRow(cat));
    }
    expenses.push(expenseFromRow(row, ""));
  }
  return {
    expenses,
    categories: [...included.values()],
    recurring_expenses: recurring,
    wallet_suggestions: walletRows.map(walletFromRow),
    server_version: serverVersion
  };
}
__name(syncPull, "syncPull");
async function syncPush(db, req, now) {
  const prefs = await getPreferences(db);
  const categoriesOut = [];
  const recurringOut = [];
  const expensesOut = [];
  const walletOut = [];
  const aliases = /* @__PURE__ */ new Map();
  for (const c of req.categories ?? []) {
    const cat = await pushCategory(db, c, now);
    categoriesOut.push(cat);
    aliases.set(c.id, cat.id);
  }
  for (const r of req.recurring_expenses ?? []) {
    const categoryId = aliases.get(r.category_id) ?? r.category_id;
    recurringOut.push(await pushRecurring(db, { ...r, category_id: categoryId }, now));
  }
  await materializeDueRecurring(db, now, prefs.timezone);
  for (const e of req.expenses ?? []) {
    const categoryId = aliases.get(e.category_id) ?? e.category_id;
    expensesOut.push(await pushExpense(db, { ...e, category_id: categoryId }, now));
  }
  for (const ws of req.wallet_suggestions ?? []) {
    walletOut.push(await pushWallet(db, ws, now));
  }
  return {
    expenses: expensesOut,
    categories: categoriesOut,
    recurring_expenses: recurringOut,
    wallet_suggestions: walletOut,
    server_version: await currentServerVersion(db)
  };
}
__name(syncPush, "syncPush");

// src/index.ts
function requestId(request) {
  return request.headers.get("cf-ray") || crypto.randomUUID();
}
__name(requestId, "requestId");
function statusOf(err) {
  if (err && typeof err === "object" && "status" in err && typeof err.status === "number") {
    return err.status;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.endsWith("not found") || msg.includes("not found")) return msg.includes("category") && !msg.includes("expense") ? 422 : 404;
  return 422;
}
__name(statusOf, "statusOf");
function fail(err, id) {
  const msg = err instanceof Error ? err.message : String(err);
  return jsonError(statusOf(err), msg, id);
}
__name(fail, "fail");
function isSecure(request) {
  const url = new URL(request.url);
  return url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}
__name(isSecure, "isSecure");
async function serveAssets(env, request, path, prefix) {
  const url = new URL(request.url);
  url.pathname = path;
  const assetRequest = new Request(url.toString(), request);
  const response = await env.ASSETS.fetch(assetRequest);
  if (path === "/service-worker.js" || path === "/sw.js") {
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-cache");
    headers.set("service-worker-allowed", prefix || "/");
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}
__name(serveAssets, "serveAssets");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === EXPENSE_PREFIX) {
      return Response.redirect(`${url.origin}${EXPENSE_PREFIX}/`, 301);
    }
    const { path, prefix } = parsePath(url.pathname);
    const id = requestId(request);
    const method = request.method;
    if ((method === "GET" || method === "HEAD") && (path === "/up" || path === "/api/health")) {
      return json(200, { status: "ok", build: env.BUILD_SHA ?? "unknown" });
    }
    if (method === "POST" && path === "/api/auth/login") {
      if (!loginConfigured(env)) return jsonError(500, "login not configured", id);
      let body;
      try {
        body = await readJSON(request);
      } catch {
        return jsonError(400, "invalid request body", id);
      }
      if (!loginOk(env, body.username ?? "", body.password ?? "")) {
        return jsonError(401, "invalid credentials", id);
      }
      return noContent(issueSession(env, prefix, isSecure(request)));
    }
    if (path === "/api" || path.startsWith("/api/")) {
      const authErr = requireSecret(request, env, id);
      if (authErr) return authErr;
      try {
        return await handleAPI(request, env, path, prefix, id);
      } catch (err) {
        return fail(err, id);
      }
    }
    if (method === "GET" || method === "HEAD") {
      return serveAssets(env, request, path, prefix);
    }
    return jsonError(404, "not found", id);
  }
};
async function handleAPI(request, env, path, prefix, id) {
  const method = request.method;
  const url = new URL(request.url);
  const db = env.DB;
  const now = nowUnix();
  if (method === "POST" && path === "/api/auth/exchange") {
    if (!presentedSecret(request, env.EXPENSE_SYNC_SECRET)) return jsonError(401, "unauthorized", id);
    return noContent(issueSession(env, prefix, isSecure(request)));
  }
  if (method === "GET" && path === "/api/preferences") {
    return json(200, await getPreferences(db));
  }
  if (method === "PUT" && path === "/api/preferences") {
    const body = await readJSON(request);
    const prefs = await getPreferences(db);
    if (body.currency != null) prefs.currency = body.currency;
    if (body.timezone != null) prefs.timezone = body.timezone;
    if (body.date_format != null) prefs.date_format = body.date_format;
    await savePreferences(db, prefs);
    return json(200, await getPreferences(db));
  }
  if (method === "GET" && path === "/api/sync/pull") {
    const sinceStr = url.searchParams.get("since");
    let since = 0;
    if (sinceStr) {
      since = Number(sinceStr);
      if (!Number.isFinite(since)) return jsonError(400, "invalid since parameter", id);
    }
    return json(200, await syncPull(db, since));
  }
  if (method === "POST" && path === "/api/sync/push") {
    return json(200, await syncPush(db, await readJSON(request), now));
  }
  if (path === "/api/expenses" && method === "POST") {
    const body = await readJSON(request);
    const prefs = await getPreferences(db);
    const created = await createExpense(
      db,
      {
        amount: body.amount,
        currency: body.currency ?? "",
        category_id: body.category_id,
        description: body.description ?? "",
        merchant: body.merchant ?? "",
        date: body.date ?? 0
      },
      prefs.currency,
      now
    );
    return json(201, created);
  }
  if (path === "/api/expenses" && method === "GET") {
    const parsed = parseExpenseWindow(url.searchParams, now);
    if (!parsed.ok) return jsonError(400, parsed.error, id);
    const rows = await listExpensesWindow(db, parsed.window.before, parsed.window.since, parsed.window.limit);
    const total = await sumExpensesWindow(db, parsed.window.before, parsed.window.since);
    const resp = { expenses: rows, count: rows.length, total };
    if (rows.length > 0) resp.next_before = rows[rows.length - 1].date;
    return json(200, resp);
  }
  const expenseMatch = path.match(/^\/api\/expenses\/([^/]+)$/);
  if (expenseMatch) {
    const expenseId = decodeURIComponent(expenseMatch[1]);
    if (method === "GET") return json(200, await getExpense(db, expenseId));
    if (method === "PUT") {
      const body = await readJSON(request);
      return json(200, await updateExpense(db, expenseId, body, now));
    }
    if (method === "DELETE") {
      await deleteExpense(db, expenseId, now);
      return noContent();
    }
  }
  if (path === "/api/categories" && method === "GET") {
    const categories = await listCategories(db);
    return json(200, { categories, count: categories.length });
  }
  if (path === "/api/categories" && method === "POST") {
    const body = await readJSON(request);
    return json(201, await createCategory(db, { name: body.name, icon: body.icon ?? "", budget: body.budget ?? null }, now));
  }
  const categoryMatch = path.match(/^\/api\/categories\/([^/]+)$/);
  if (categoryMatch) {
    const categoryId = decodeURIComponent(categoryMatch[1]);
    if (method === "PUT") {
      const body = await readJSON(request);
      return json(200, await updateCategory(db, categoryId, body, now));
    }
    if (method === "DELETE") {
      await deleteCategory(db, categoryId, now);
      return noContent();
    }
  }
  if (path === "/api/recurring-expenses" && method === "GET") {
    const rows = await listRecurring(db);
    return json(200, { recurring_expenses: rows, count: rows.length });
  }
  if (path === "/api/recurring-expenses" && method === "POST") {
    const body = await readJSON(request);
    return json(
      201,
      await createRecurring(
        db,
        {
          amount: body.amount,
          currency: body.currency,
          category_id: body.category_id ?? "",
          category: body.category,
          description: body.description ?? "",
          merchant: body.merchant ?? "",
          frequency: body.frequency,
          day_of_month: body.day_of_month,
          start_date: body.start_date,
          end_date: body.end_date
        },
        now
      )
    );
  }
  const recurringMatch = path.match(/^\/api\/recurring-expenses\/([^/]+)$/);
  if (recurringMatch) {
    const recurringId = decodeURIComponent(recurringMatch[1]);
    if (method === "PUT") {
      const body = await readJSON(request);
      return json(200, await updateRecurring(db, recurringId, body, now));
    }
    if (method === "DELETE") {
      await deleteRecurring(db, recurringId, now);
      return noContent();
    }
  }
  if (path === "/api/wallet-suggestions" && method === "POST") {
    const body = await readJSON(request);
    return json(
      201,
      await createWallet(
        db,
        {
          id: body.id,
          merchant: body.merchant ?? "",
          amount: body.amount,
          currency: body.currency ?? "",
          captured_at: body.captured_at ?? 0,
          card_name: body.card_name,
          source: body.source ?? "",
          client_updated_at: body.client_updated_at
        },
        now
      )
    );
  }
  if (path === "/api/wallet-suggestions" && method === "GET") {
    const rows = await listWalletByStatus(db, url.searchParams.get("status") ?? "pending");
    return json(200, { wallet_suggestions: rows, count: rows.length });
  }
  const confirmMatch = path.match(/^\/api\/wallet-suggestions\/([^/]+)\/confirm$/);
  if (confirmMatch && method === "POST") {
    const body = await readJSON(request);
    const prefs = await getPreferences(db);
    const result = await confirmWallet(
      db,
      decodeURIComponent(confirmMatch[1]),
      {
        id: body.id,
        amount: body.amount,
        currency: body.currency ?? "",
        category_id: body.category_id ?? "",
        category: body.category,
        description: body.description ?? "",
        merchant: body.merchant ?? "",
        date: body.date ?? 0,
        source: "wallet_suggestion",
        client_updated_at: body.client_updated_at
      },
      prefs.currency,
      now
    );
    return json(200, { wallet_suggestion: result.suggestion, expense: result.expense });
  }
  const dismissMatch = path.match(/^\/api\/wallet-suggestions\/([^/]+)\/dismiss$/);
  if (dismissMatch && method === "POST") {
    return json(200, await dismissWallet(db, decodeURIComponent(dismissMatch[1]), now));
  }
  if (method === "POST" && path === "/api/feedback") {
    if (!env.GITHUB_TOKEN) return jsonError(500, "feedback not configured", id);
    const body = await readJSON(request);
    await submitFeedback(env.GITHUB_TOKEN, body);
    return json(201, { status: "created" });
  }
  return jsonError(404, "not found", id);
}
__name(handleAPI, "handleAPI");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
