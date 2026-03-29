const MY_ACCOUNT_KEY = "my_x_account";
console.info("[XSweep] content.js 1.0.0 loaded");
const UNFOLLOW_KEY = "x_unfollow_settings_v4";

const UNFOLLOW_DEFAULTS = {
  unfollowAllSpeed: "slow",
  protectFollowBack: true,
  protectedAccounts: "",
  followerLimit: 5000,
  inactiveDays: 30
};

const SPEED_DELAYS = {
  fast: [100, 200],
  normal: [1000, 2000],
  slow: [2000, 4000],
  veryslow: [10000, 20000]
};

const runtimeState = {
  running: false,
  count: 0,
  target: 0,
  message: "Ready",
  myHandle: "",
  currentHandle: "",
  authToken: "",
  csrfToken: "",
  loadingUsers: false,
  previewLoading: false,
  previewOpen: false,
  unfollowUsers: [],
  filteredUsers: [],
  unfollowedSet: new Set(),
  nextCursor: -1
};

const ui = {
  anchor: null,
  root: null
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function textOf(el) {
  return (el?.innerText || el?.textContent || "").trim();
}

function extractHandleFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const candidate = String(parts[0] || "").trim();
  const reserved = new Set(["home", "explore", "messages", "notifications", "search", "compose", "settings", "i"]);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(candidate) || reserved.has(candidate.toLowerCase())) {
    return "";
  }
  return candidate.toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function parseProtectedAccounts(raw) {
  return new Set(
    String(raw || "")
      .split(/[\s,]+/)
      .map((item) => item.trim().replace(/^@+/, "").toLowerCase())
      .filter(Boolean)
  );
}

function daysSince(dateValue) {
  if (!dateValue) return null;
  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((Date.now() - time) / 86400000);
}

function formatCount(value) {
  return value == null ? "-" : Number(value).toLocaleString();
}

function formatDays(days) {
  if (days == null) return "Activity unknown";
  if (days <= 0) return "Active today";
  return `Inactive ${days}d`;
}

function getInactivePreset(value) {
  if (!value || value === 0) return "off";
  if (value === 7) return "7d";
  if (value === 30) return "30d";
  if (value === 90) return "90d";
  return "custom";
}

function getFollowerPreset(value) {
  if (!value || value === 0) return "off";
  if (value === 1000) return "lt1k";
  if (value === 5000) return "lt5k";
  return "custom";
}

function renderChoiceButton(group, value, label, current) {
  const selected = current === value ? " xur-choice-active" : "";
  return `<button class="xur-choice${selected}" data-choice-group="${escapeHtml(group)}" data-choice-value="${escapeHtml(value)}">${label}</button>`;
}

function normalizeUser(user) {
  const screenName = String(user?.screen_name || "").toLowerCase();
  const lastStatusAt = user?.status?.created_at || null;
  return {
    id: user?.id_str || String(user?.id || screenName),
    name: user?.name || screenName,
    screen_name: screenName,
    description: user?.description || "",
    followers_count: Number.isFinite(user?.followers_count) ? user.followers_count : Number(user?.followers_count || 0),
    friends_count: Number.isFinite(user?.friends_count) ? user.friends_count : Number(user?.friends_count || 0),
    profile_image_url_https: user?.profile_image_url_https || user?.profile_image_url || "",
    followed_by: Boolean(user?.followed_by),
    following: Boolean(user?.following),
    status_created_at: lastStatusAt,
    daysInactive: daysSince(lastStatusAt)
  };
}

async function getStorage(key, defaults) {
  const raw = await chrome.storage.local.get(key);
  return { ...defaults, ...(raw?.[key] || {}) };
}

async function setStorage(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function loadMyHandle() {
  const raw = await chrome.storage.local.get(MY_ACCOUNT_KEY);
  const account = raw?.[MY_ACCOUNT_KEY];
  runtimeState.myHandle = String(account?.x_handle || account?.screen_name || "").replace(/^@+/, "").toLowerCase();
  return runtimeState.myHandle;
}

async function saveMyHandle(handle) {
  const value = String(handle || "").replace(/^@+/, "").toLowerCase();
  if (!value) return;
  runtimeState.myHandle = value;
  await chrome.storage.local.set({
    [MY_ACCOUNT_KEY]: {
      x_handle: value,
      detected_at: new Date().toISOString()
    }
  });
}

function extractOwnHandleFromDom() {
  const profileLink = document.querySelector("a[data-testid='AppTabBar_Profile_Link'][href]");
  const href = String(profileLink?.getAttribute("href") || "");
  const match = href.match(/^\/([A-Za-z0-9_]{1,15})(?:$|[/?#])/);
  if (match) return match[1].toLowerCase();

  const accountLinks = Array.from(document.querySelectorAll("a[href]"));
  for (const link of accountLinks) {
    const url = String(link.getAttribute("href") || "");
    const label = `${textOf(link)} ${String(link.getAttribute("aria-label") || "")}`.toLowerCase();
    if (!label.includes("profile")) continue;
    const found = url.match(/^\/([A-Za-z0-9_]{1,15})(?:$|[/?#])/);
    if (found) return found[1].toLowerCase();
  }
  return "";
}

async function ensureMyHandle() {
  if (runtimeState.myHandle) return runtimeState.myHandle;
  const domHandle = extractOwnHandleFromDom();
  if (domHandle) {
    await saveMyHandle(domHandle);
    return domHandle;
  }
  await loadMyHandle();
  return runtimeState.myHandle;
}

async function requestAuthHeaders() {
  const response = await chrome.runtime.sendMessage({ requestingAuthHeaders: true });
  runtimeState.authToken = response?.authToken?.value || runtimeState.authToken;
  runtimeState.csrfToken = response?.csrfToken?.value || runtimeState.csrfToken;
  return Boolean(runtimeState.authToken && runtimeState.csrfToken);
}

function apiHost() {
  return window.location.host.includes("twitter.com") ? "https://api.twitter.com" : "https://api.x.com";
}

async function apiGet(path, params = {}) {
  await requestAuthHeaders();
  if (!runtimeState.authToken || !runtimeState.csrfToken) {
    throw new Error("Missing captured auth headers. Scroll X first so the extension can observe requests.");
  }
  const url = new URL(path, apiHost());
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url.toString(), {
    credentials: "include",
    headers: {
      authorization: runtimeState.authToken,
      "x-csrf-token": runtimeState.csrfToken,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session"
    }
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.errors?.[0]?.message || `Request failed: ${response.status}`;
    const error = new Error(message);
    error.payload = json;
    throw error;
  }
  return json;
}

async function apiPost(path, params = {}) {
  await requestAuthHeaders();
  if (!runtimeState.authToken || !runtimeState.csrfToken) {
    throw new Error("Missing captured auth headers. Scroll X first so the extension can observe requests.");
  }
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      body.set(key, String(value));
    }
  });
  const response = await fetch(new URL(path, apiHost()).toString(), {
    method: "POST",
    credentials: "include",
    headers: {
      authorization: runtimeState.authToken,
      "x-csrf-token": runtimeState.csrfToken,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session"
    },
    body: body.toString()
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.errors?.[0]?.message || `Request failed: ${response.status}`;
    const error = new Error(message);
    error.payload = json;
    throw error;
  }
  return json;
}

async function loadRelationshipPage(screenName, cursor = -1) {
  const result = await apiGet("/1.1/friends/list.json", {
    screen_name: screenName,
    count: 200,
    cursor,
    skip_status: false,
    include_user_entities: false
  });
  return {
    users: Array.isArray(result?.users) ? result.users.map(normalizeUser) : [],
    nextCursor: Number(result?.next_cursor ?? 0)
  };
}

async function loadFollowingPages(screenName, options = {}) {
  const maxPages = Math.max(1, Number(options.maxPages || 10));
  const dedupe = new Map();
  let cursor = -1;
  let pagesLoaded = 0;

  while (pagesLoaded < maxPages) {
    const page = await loadRelationshipPage(screenName, cursor);
    pagesLoaded += 1;

    for (const user of page.users) {
      if (user?.screen_name) {
        dedupe.set(user.screen_name, user);
      }
    }

    runtimeState.message = `Loading page ${pagesLoaded} · ${dedupe.size} users loaded`;
    await renderPanel();

    if (!page.nextCursor || page.nextCursor === 0 || page.nextCursor === cursor) {
      cursor = 0;
      break;
    }
    cursor = page.nextCursor;
  }

  return {
    users: [...dedupe.values()],
    nextCursor: cursor,
    pagesLoaded
  };
}

async function unfollowUser(screenName) {
  await apiPost("/1.1/friendships/destroy.json", { screen_name: screenName });
}

async function followUser(screenName) {
  await apiPost("/1.1/friendships/create.json", { screen_name: screenName });
}

function isOwnProfilePage() {
  const viewedHandle = extractHandleFromPath();
  runtimeState.currentHandle = viewedHandle;
  if (!viewedHandle) return false;
  return runtimeState.myHandle && runtimeState.myHandle === viewedHandle;
}

function getDelay(speed) {
  const bucket = SPEED_DELAYS[speed] || SPEED_DELAYS.slow;
  return rand(bucket[0], bucket[1]);
}

function filterUnfollowUsers(users, settings) {
  const protectedAccounts = parseProtectedAccounts(settings.protectedAccounts);
  const followerLimit = Number(settings.followerLimit ?? 0);
  const inactiveDays = Number(settings.inactiveDays || 0);
  return users.filter((user) => {
    if (!user.screen_name) return false;
    if (protectedAccounts.has(user.screen_name)) return false;
    if (settings.protectFollowBack && user.followed_by) return false;
    if (followerLimit > 0 && user.followers_count >= followerLimit) return false;
    if (inactiveDays > 0 && user.daysInactive != null && user.daysInactive <= inactiveDays) return false;
    return true;
  });
}

// ─── Styles ──────────────────────────────────────────

function ensureStyles() {
  if (document.getElementById("xcleaner-style")) return;
  const style = document.createElement("style");
  style.id = "xcleaner-style";
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    #xcleaner-anchor{margin-top:10px;display:flex;gap:8px}

    .xur-btn{border:none;border-radius:9px;padding:7px 14px;font-weight:600;font-size:12px;line-height:1.15;cursor:pointer;white-space:nowrap;transition:all .2s ease;font-family:'Inter',system-ui,sans-serif}
    .xur-btn:hover{filter:brightness(1.1);transform:translateY(-1px)}
    .xur-btn:active{transform:translateY(0);filter:brightness(0.95)}
    .xur-btn-main{color:#eef2ff;background:linear-gradient(135deg,#4a3aff,#6246ff);box-shadow:0 4px 14px rgba(74,58,255,.35)}
    .xur-btn-soft{color:#a8b0d4;background:rgba(70,75,120,.35);border:1px solid rgba(120,128,190,.18)}
    .xur-btn-soft:hover{color:#cfd6ff;background:rgba(70,75,120,.5)}
    .xur-btn-danger{color:#fff;background:linear-gradient(135deg,#e84393,#fd79a8);box-shadow:0 4px 14px rgba(232,67,147,.3);font-weight:700;font-size:13px;padding:10px 20px;border-radius:10px}
    .xur-btn-danger:hover{box-shadow:0 6px 20px rgba(232,67,147,.45)}
    .xur-btn-stop{color:#fff;background:linear-gradient(135deg,#f39c12,#e67e22);box-shadow:0 4px 14px rgba(243,156,18,.3);font-weight:700;font-size:13px;padding:10px 20px;border-radius:10px}
    .xur-btn-stop:hover{box-shadow:0 6px 20px rgba(243,156,18,.45)}
    .xur-btn-follow{color:#fff;background:linear-gradient(135deg,#00b894,#00cec9);border:none;border-radius:6px;cursor:pointer;font-weight:600;font-family:'Inter',system-ui,sans-serif;transition:all .2s}
    .xur-btn-follow:hover{box-shadow:0 2px 10px rgba(0,184,148,.4)}
    .xur-user-unfollowed{opacity:.55}
    .xur-btn-close{color:#a8b0d4;background:rgba(80,85,130,.3);border:1px solid rgba(120,128,190,.2);border-radius:8px;padding:5px 12px;font-size:11px;font-weight:600}
    .xur-btn-close:hover{color:#fff;background:rgba(80,85,130,.5)}

    #xcleaner-root{
      position:fixed;top:60px;right:20px;z-index:2147483647;
      width:420px;
      max-height:85vh;overflow-y:auto;overflow-x:hidden;
      border-radius:16px;
      background:linear-gradient(180deg,#1a1830 0%,#151326 50%,#120f21 100%);
      color:#e0e4f5;
      box-shadow:0 20px 60px rgba(0,0,0,.55),0 0 0 1px rgba(100,108,170,.12);
      font-family:'Inter',system-ui,-apple-system,sans-serif;
      border:1px solid rgba(90,96,150,.15);
      scrollbar-width:thin;
      scrollbar-color:rgba(100,108,170,.2) transparent
    }
    #xcleaner-root::-webkit-scrollbar{width:4px}
    #xcleaner-root::-webkit-scrollbar-track{background:transparent}
    #xcleaner-root::-webkit-scrollbar-thumb{background:rgba(100,108,170,.25);border-radius:4px}

    .xur-head{padding:16px 16px 14px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .xur-title{font-size:17px;font-weight:800;line-height:1.2;letter-spacing:-.01em;color:#f0f2ff}
    .xur-sub{font-size:12px;color:#6b7199;margin-top:3px;font-weight:500}

    .xur-stats{display:flex;gap:0;align-items:center;padding:10px 16px;font-size:12px;color:#a0a7cc;font-weight:500;border-top:1px solid rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.04)}
    .xur-stat-item{display:flex;align-items:center;gap:6px}
    .xur-stat-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .xur-stat-dot-blue{background:#6366f1}
    .xur-stat-dot-orange{background:#f59e0b}
    .xur-stat-sep{margin:0 10px;color:rgba(255,255,255,.15);font-size:11px}

    .xur-body{display:grid;gap:0;padding:0}

    .xur-load-shell{padding:16px;display:grid;gap:12px}
    .xur-load-main{width:100%;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:700}
    .xur-skeleton{border-radius:12px;padding:16px;background:rgba(22,20,40,.6);border:1px solid rgba(80,86,140,.1);display:grid;gap:10px}
    .xur-skeleton-line{height:8px;border-radius:999px;background:linear-gradient(90deg,rgba(90,96,150,.08),rgba(110,118,180,.2),rgba(90,96,150,.08));background-size:200% 100%;animation:xur-shimmer 1.8s ease-in-out infinite}
    @keyframes xur-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

    .xur-btn-loading{opacity:.7;cursor:not-allowed;display:flex;align-items:center;justify-content:center;gap:8px}
    .xur-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:xur-spin .7s linear infinite}
    @keyframes xur-spin{to{transform:rotate(360deg)}}
    .xur-load-progress{font-size:12px;color:#a78bfa;font-weight:600;text-align:center;padding:4px 0;animation:xur-pulse 1.5s ease-in-out infinite}
    @keyframes xur-pulse{0%,100%{opacity:1}50%{opacity:.6}}

    .xur-card{border-top:1px solid rgba(255,255,255,.04)}
    .xur-card-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 8px;font-size:13px;font-weight:700;color:#e0e4f5;cursor:pointer}
    .xur-card-head-left{display:flex;align-items:center;gap:8px}
    .xur-card-head-icon{font-size:14px;opacity:.85}
    .xur-card-chevron{color:#4a4e6e;font-size:14px;transition:transform .2s}
    .xur-card-body{padding:4px 16px 12px}

    .xur-choice-row{display:flex;gap:0;background:rgba(30,28,52,.7);padding:3px;border-radius:10px;border:1px solid rgba(80,86,140,.12)}
    .xur-choice{border:none;background:transparent;color:#7a7fa6;padding:7px 10px;border-radius:8px;font-size:11px;font-weight:500;cursor:pointer;flex:1;text-align:center;transition:all .18s ease;font-family:'Inter',system-ui,sans-serif}
    .xur-choice:hover{color:#b5bbe5}
    .xur-choice-active{background:linear-gradient(135deg,#4338ca,#5b4bff);color:#f4f7ff;font-weight:600;box-shadow:0 2px 8px rgba(67,56,202,.35)}

    .xur-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;font-size:13px;font-weight:700;color:#e0e4f5}
    .xur-toggle-left{display:flex;align-items:center;gap:8px}
    .xur-toggle-icon{font-size:14px}
    .xur-switch{position:relative;width:40px;height:22px;border-radius:999px;background:rgba(60,65,100,.5);border:none;cursor:pointer;transition:background .2s ease;flex-shrink:0}
    .xur-switch::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#e0e4f5;transition:left .2s ease;box-shadow:0 1px 3px rgba(0,0,0,.3)}
    .xur-switch-on{background:linear-gradient(135deg,#4338ca,#5b4bff)}
    .xur-switch-on::after{left:21px}



    .xur-field{display:grid;gap:4px;font-size:11px;color:#8892b8;font-weight:500}
    .xur-field input,.xur-field select,.xur-field textarea{border:1px solid rgba(80,86,140,.18);border-radius:8px;padding:7px 10px;font-size:11px;background:rgba(25,23,45,.7);color:#e0e4f5;font-family:'Inter',system-ui,sans-serif;transition:border-color .2s}
    .xur-field input:focus,.xur-field select:focus,.xur-field textarea:focus{outline:none;border-color:rgba(100,108,170,.4)}
    .xur-field textarea{min-height:60px;resize:vertical}

    .xur-status{font-size:11px;color:#6b7199;line-height:1.4;padding:0 16px}

    .xur-footer{padding:12px 16px 14px;border-top:1px solid rgba(255,255,255,.05);display:grid;gap:10px}
    .xur-footer-count{font-size:12px;font-weight:600;color:#8892b8}
    .xur-footer-count span{color:#a78bfa}
    .xur-footer-actions{display:flex;gap:8px;align-items:center}
    .xur-btn-preview{color:#8e93bb;background:rgba(50,48,80,.5);border:1px solid rgba(80,86,140,.18);border-radius:9px;padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;transition:all .2s;font-family:'Inter',system-ui,sans-serif;flex:1;justify-content:center}
    .xur-btn-preview:hover{color:#cfd6ff;background:rgba(50,48,80,.7)}
    .xur-btn-preview-icon{font-size:11px;opacity:.6}
    .xur-btn-unfollow-all{flex:1}

    .xur-list{display:grid;gap:6px;margin-top:6px}
    .xur-user{display:grid;grid-template-columns:32px 1fr auto;gap:8px;align-items:center;border:1px solid rgba(80,86,140,.1);border-radius:10px;padding:8px;background:rgba(20,18,35,.5)}
    .xur-avatar{width:32px;height:32px;border-radius:50%;background:#2a2850;object-fit:cover}
    .xur-name{font-size:11px;font-weight:700;line-height:1.2;color:#f0f2ff}
    .xur-handle,.xur-meta{font-size:10px;color:#6b7199;line-height:1.3}
    .xur-chip{display:inline-block;padding:1px 5px;border-radius:999px;background:rgba(60,58,100,.3);font-size:9px;color:#9da4d8;margin:2px 3px 0 0}

    .xur-list-wrap{padding:12px 16px}
    .xur-list-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12px;font-weight:600;color:#a0a7cc}
    .xur-list-meta{font-size:11px;color:#6b7199}
    .xur-results-empty{padding:14px 0;color:#6b7199;font-size:12px;text-align:center}

    .xur-inline-input{margin-top:8px}
    .xur-preview-wrap{border-top:1px solid rgba(255,255,255,.04);max-height:300px;overflow-y:auto}
  `;
  document.head.appendChild(style);
}

// ─── UI ──────────────────────────────────────────────

function closePanel() {
  ui.root?.remove();
  ui.root = null;
}

function renderUserRows(users) {
  return users.map((user) => {
    const isUnfollowed = runtimeState.unfollowedSet.has(user.screen_name);
    const actionBtn = isUnfollowed
      ? `<button class="xur-btn xur-btn-follow" data-refollow="${escapeHtml(user.screen_name)}" style="font-size:10px;padding:4px 8px">Follow</button>`
      : `<button class="xur-btn xur-btn-soft" data-single="${escapeHtml(user.screen_name)}" style="font-size:10px;padding:4px 8px">Unfollow</button>`;
    return `
    <div class="xur-user${isUnfollowed ? " xur-user-unfollowed" : ""}">
      <img class="xur-avatar" src="${escapeHtml(user.profile_image_url_https)}" />
      <div>
        <div class="xur-name">${escapeHtml(user.name)}</div>
        <div class="xur-handle">@${escapeHtml(user.screen_name)}</div>
        <div class="xur-meta">
          <span class="xur-chip">${formatCount(user.followers_count)} followers</span>
          <span class="xur-chip">${formatCount(user.friends_count)} following</span>
          ${user.followed_by ? '<span class="xur-chip">Follows you</span>' : ""}
          <span class="xur-chip">${escapeHtml(formatDays(user.daysInactive))}</span>
        </div>
      </div>
      ${actionBtn}
    </div>`;
  }).join("");
}

async function renderPanel() {
  ensureStyles();

  if (!ui.root) {
    ui.root = document.createElement("div");
    ui.root.id = "xcleaner-root";
    document.body.appendChild(ui.root);
  }

  const prevScroll = ui.root?.querySelector(".xur-preview-wrap")?.scrollTop ?? 0;

  const settings = await getStorage(UNFOLLOW_KEY, UNFOLLOW_DEFAULTS);
  const followerLimit = Number(settings.followerLimit ?? 5000);
  const viewedHandle = extractHandleFromPath();
  const users = runtimeState.filteredUsers;
  const hasLoaded = runtimeState.unfollowUsers.length > 0;
  const inactivePreset = getInactivePreset(Number(settings.inactiveDays || 0));
  const followerPreset = getFollowerPreset(Number(followerLimit || 0));
  const speedPreset = String(settings.unfollowAllSpeed || "slow");

  let bodyContent = "";

  if (!hasLoaded) {
    const isLoading = runtimeState.loadingUsers;
    bodyContent = `
      <div class="xur-load-shell">
        <button class="xur-btn xur-btn-main xur-load-main ${isLoading ? "xur-btn-loading" : ""}" data-load="following" ${isLoading ? "disabled" : ""}>
          ${isLoading ? '<span class="xur-spinner"></span>Loading...' : "Load Following"}
        </button>
        ${isLoading ? `<div class="xur-load-progress">${escapeHtml(runtimeState.message)}</div>` : ""}
        <div class="xur-skeleton">
          <div class="xur-skeleton-line" style="width:30%"></div>
          <div class="xur-skeleton-line" style="width:82%"></div>
          <div class="xur-skeleton-line" style="width:68%"></div>
          <div class="xur-skeleton-line" style="width:50%"></div>
        </div>
      </div>
    `;
  } else {
    bodyContent = `
      <div class="xur-stats">
        <span class="xur-stat-item"><span class="xur-stat-dot xur-stat-dot-blue"></span>Following: ${formatCount(runtimeState.unfollowUsers.length)}</span>
        <span class="xur-stat-sep">|</span>
        <span class="xur-stat-item"><span class="xur-stat-dot xur-stat-dot-orange"></span>Selected: ${formatCount(users.length)}</span>
      </div>

      <div class="xur-card">
        <div class="xur-card-head">
          <div class="xur-card-head-left"><span class="xur-card-head-icon">🌙</span>Inactive days &gt; (0 = no limit)</div>
          <span class="xur-card-chevron">›</span>
        </div>
        <div class="xur-card-body">
          <div class="xur-choice-row">
            ${renderChoiceButton("inactive", "off", "0", inactivePreset)}
            ${renderChoiceButton("inactive", "7d", "7d", inactivePreset)}
            ${renderChoiceButton("inactive", "30d", "30d", inactivePreset)}
            ${renderChoiceButton("inactive", "90d", "90d", inactivePreset)}
            ${renderChoiceButton("inactive", "custom", "Custom", inactivePreset)}
          </div>
          ${inactivePreset === "custom" ? `<label class="xur-field xur-inline-input">
            <input id="xur-days" type="number" value="${Number(settings.inactiveDays || 0)}" placeholder="Custom days" />
          </label>` : ""}
        </div>
      </div>

      <div class="xur-card">
        <div class="xur-card-head">
          <div class="xur-card-head-left"><span class="xur-card-head-icon">👥</span>Followers &lt; (0 = no limit)</div>
          <span class="xur-card-chevron">›</span>
        </div>
        <div class="xur-card-body">
          <div class="xur-choice-row">
            ${renderChoiceButton("followers", "off", "0", followerPreset)}
            ${renderChoiceButton("followers", "lt1k", "1k", followerPreset)}
            ${renderChoiceButton("followers", "lt5k", "5k", followerPreset)}
            ${renderChoiceButton("followers", "custom", "Custom", followerPreset)}
          </div>
          ${followerPreset === "custom" ? `<label class="xur-field xur-inline-input">
            <input id="xur-follower-limit" type="number" value="${Number(followerLimit || 0)}" placeholder="Custom limit" />
          </label>` : ""}
        </div>
      </div>

      <div class="xur-card">
        <div class="xur-card-head">
          <div class="xur-card-head-left"><span class="xur-card-head-icon">⚡</span>Speed</div>
          <span class="xur-card-chevron">›</span>
        </div>
        <div class="xur-card-body">
          <div class="xur-choice-row">
            ${renderChoiceButton("speed", "slow", "🐢 Slow", speedPreset)}
            ${renderChoiceButton("speed", "normal", "🚶 Normal", speedPreset)}
            ${renderChoiceButton("speed", "fast", "⚡ Fast", speedPreset)}
          </div>
        </div>
      </div>

      <div class="xur-card">
        <div class="xur-toggle-row">
          <div class="xur-toggle-left"><span class="xur-toggle-icon">🤝</span>Protect Follow-back</div>
          <button class="xur-switch ${settings.protectFollowBack ? "xur-switch-on" : ""}" id="xur-protect-switch" aria-pressed="${settings.protectFollowBack ? "true" : "false"}"></button>
        </div>
      </div>

      <div class="xur-card">
        <div class="xur-card-head">
          <div class="xur-card-head-left"><span class="xur-card-head-icon">🛡️</span>Protected accounts</div>
          <span class="xur-card-chevron">›</span>
        </div>
        <div class="xur-card-body">
          <label class="xur-field">
            <textarea id="xur-protected" rows="2" placeholder="e.g. @user1, @user2">${escapeHtml(settings.protectedAccounts)}</textarea>
          </label>
        </div>
      </div>

      <div class="xur-footer">
        <div class="xur-footer-count"><span>${formatCount(users.length)}</span> users selected</div>
        <div class="xur-footer-actions">
          <button class="xur-btn-preview ${runtimeState.previewLoading ? "xur-btn-loading" : ""}" data-preview="1" ${runtimeState.previewLoading ? "disabled" : ""}>
            ${runtimeState.previewLoading ? '<span class="xur-spinner"></span>Loading...' : '<span class="xur-btn-preview-icon">💻</span>Preview'}
          </button>
          ${runtimeState.running
            ? '<button class="xur-btn xur-btn-stop xur-btn-unfollow-all" data-stop="1">Stop</button>'
            : '<button class="xur-btn xur-btn-danger xur-btn-unfollow-all" data-batch="1">Unfollow All</button>'}
        </div>
      </div>

      ${runtimeState.previewOpen ? `
        <div class="xur-preview-wrap">
          <div class="xur-list-wrap">
            <div class="xur-list-head">
              <span>Preview</span>
              <span class="xur-list-meta">${runtimeState.message}</span>
            </div>
            <div class="xur-list">${users.length ? renderUserRows(users.slice(0, 100)) : '<div class="xur-results-empty">No users match the current filters.</div>'}</div>
          </div>
        </div>` : ""}
    `;
  }

  ui.root.innerHTML = `
    <div class="xur-head">
      <div>
        <div class="xur-title">XSweep<a href="https://x.com/token_garden" target="_blank" style="font-size:11px;color:#a78bfa;margin-left:8px;font-weight:600;text-decoration:none;opacity:0.8;transition:opacity 0.2s;display:inline-flex;align-items:center;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">by <svg viewBox="0 0 24 24" aria-hidden="true" style="width:10px;height:10px;margin-left:3px;margin-right:3px;fill:currentColor;"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>token_garden</a></div>
        <div class="xur-sub">@${escapeHtml(viewedHandle || runtimeState.myHandle || "-")}</div>
      </div>
      <button class="xur-btn xur-btn-close" data-close="1">Close</button>
    </div>
    <div class="xur-body">
      ${bodyContent}
    </div>
  `;

  const previewWrap = ui.root.querySelector(".xur-preview-wrap");
  if (previewWrap && prevScroll) previewWrap.scrollTop = prevScroll;

  // Wire up event handlers
  ui.root.querySelector("[data-close='1']")?.addEventListener("click", closePanel);

  ui.root.querySelector("[data-batch='1']")?.addEventListener("click", async () => {
    await applyFiltersAndRender();
    await runBatch();
  });

  ui.root.querySelector("[data-stop='1']")?.addEventListener("click", () => {
    runtimeState.stopRequested = true;
    runtimeState.message = "Stopping…";
    renderPanel();
  });

  ui.root.querySelector("[data-preview='1']")?.addEventListener("click", async () => {
    if (runtimeState.previewLoading) return;
    runtimeState.previewLoading = true;
    await renderPanel();

    // Yield control to the browser so the UI can paint the spinning state
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Apply filters and prepare rendering in "real time"
    const current = await getStorage(UNFOLLOW_KEY, UNFOLLOW_DEFAULTS);
    const customDaysInput = ui.root.querySelector("#xur-days");
    const inactiveDaysVal = customDaysInput ? (customDaysInput.value === "" ? 30 : Number(customDaysInput.value)) : (current.inactiveDays ?? 30);
    const settings = {
      ...current,
      followerLimit: Number(ui.root.querySelector("#xur-follower-limit")?.value ?? current.followerLimit ?? 0),
      inactiveDays: inactiveDaysVal,
      protectedAccounts: String(ui.root.querySelector("#xur-protected")?.value ?? current.protectedAccounts ?? "")
    };
    runtimeState.filteredUsers = filterUnfollowUsers(runtimeState.unfollowUsers, settings);
    runtimeState.target = runtimeState.filteredUsers.length;
    runtimeState.message = `Filtered ${runtimeState.filteredUsers.length} accounts.`;

    runtimeState.previewLoading = false;
    runtimeState.previewOpen = !runtimeState.previewOpen;
    await renderPanel();
  });
  ui.root.querySelectorAll("[data-load]").forEach((button) => {
    button.addEventListener("click", async () => {
      await loadUsersForPanel();
    });
  });

  ui.root.querySelectorAll("[data-choice-group]").forEach((button) => {
    button.addEventListener("click", async () => {
      const group = button.getAttribute("data-choice-group");
      const value = button.getAttribute("data-choice-value");
      const next = { ...await getStorage(UNFOLLOW_KEY, UNFOLLOW_DEFAULTS) };
      if (group === "inactive") {
        if (value === "off") next.inactiveDays = 0;
        if (value === "7d") next.inactiveDays = 7;
        if (value === "30d") next.inactiveDays = 30;
        if (value === "90d") next.inactiveDays = 90;
        if (value === "custom") {
          const cur = Number(next.inactiveDays || 0);
          if ([0, 7, 30, 90].includes(cur)) next.inactiveDays = 14;
        }
      }
      if (group === "followers") {
        if (value === "off") next.followerLimit = 0;
        if (value === "lt1k") next.followerLimit = 1000;
        if (value === "lt5k") next.followerLimit = 5000;
        if (value === "custom") {
          const cur = Number(next.followerLimit || 0);
          if ([0, 1000, 5000].includes(cur)) next.followerLimit = 2000;
        }
      }
      if (group === "speed") {
        next.unfollowAllSpeed = value;
      }
      await setStorage(UNFOLLOW_KEY, next);
      runtimeState.filteredUsers = filterUnfollowUsers(runtimeState.unfollowUsers, next);
      runtimeState.target = runtimeState.filteredUsers.length;
      runtimeState.message = `Filtered ${runtimeState.filteredUsers.length} accounts.`;
      await renderPanel();
    });
  });

  ui.root.querySelector("#xur-protect-switch")?.addEventListener("click", async () => {
    const next = { ...await getStorage(UNFOLLOW_KEY, UNFOLLOW_DEFAULTS) };
    next.protectFollowBack = !next.protectFollowBack;
    await setStorage(UNFOLLOW_KEY, next);
    runtimeState.filteredUsers = filterUnfollowUsers(runtimeState.unfollowUsers, next);
    runtimeState.target = runtimeState.filteredUsers.length;
    runtimeState.message = `Filtered ${runtimeState.filteredUsers.length} accounts.`;
    await renderPanel();
  });

  ui.root.querySelectorAll("#xur-days,#xur-follower-limit,#xur-protected").forEach((input) => {
    input.addEventListener("change", () => applyFiltersAndRender());
    input.addEventListener("blur", () => applyFiltersAndRender());
  });

  ui.root.querySelectorAll("[data-single]").forEach((button) => {
    button.addEventListener("click", async () => {
      const screenName = button.getAttribute("data-single");
      if (!screenName) return;
      await runSingleAction(screenName);
    });
  });

  ui.root.querySelectorAll("[data-refollow]").forEach((button) => {
    button.addEventListener("click", async () => {
      const screenName = button.getAttribute("data-refollow");
      if (!screenName) return;
      await runSingleFollow(screenName);
    });
  });

  return { ok: true, candidates: users.length };
}

// ─── Actions ─────────────────────────────────────────

async function applyFiltersAndRender() {
  if (!ui.root) return;
  const current = await getStorage(UNFOLLOW_KEY, UNFOLLOW_DEFAULTS);
  const customDaysInput = ui.root.querySelector("#xur-days");
  const inactiveDaysVal = customDaysInput ? (customDaysInput.value === "" ? 30 : Number(customDaysInput.value)) : (current.inactiveDays ?? 30);

  const settings = {
    ...current,
    followerLimit: Number(ui.root.querySelector("#xur-follower-limit")?.value ?? current.followerLimit ?? 0),
    inactiveDays: inactiveDaysVal,
    protectedAccounts: String(ui.root.querySelector("#xur-protected")?.value ?? current.protectedAccounts ?? "")
  };
  await setStorage(UNFOLLOW_KEY, settings);
  runtimeState.filteredUsers = filterUnfollowUsers(runtimeState.unfollowUsers, settings);
  runtimeState.target = runtimeState.filteredUsers.length;
  runtimeState.message = `Filtered ${runtimeState.filteredUsers.length} accounts.`;
  await renderPanel();
}

async function loadUsersForPanel() {
  if (runtimeState.loadingUsers) return;
  runtimeState.loadingUsers = true;
  runtimeState.message = "Loading following...";
  await renderPanel();

  try {
    const result = await loadFollowingPages(runtimeState.myHandle, { maxPages: 10 });
    runtimeState.unfollowUsers = result.users;
    const settings = await getStorage(UNFOLLOW_KEY, UNFOLLOW_DEFAULTS);
    runtimeState.filteredUsers = filterUnfollowUsers(result.users, settings);
    runtimeState.nextCursor = result.nextCursor;
    runtimeState.target = runtimeState.filteredUsers.length;
    runtimeState.message = `Loaded ${result.users.length} accounts from ${result.pagesLoaded} page(s).`;
    await renderPanel();
  } finally {
    runtimeState.loadingUsers = false;
  }
}

async function runSingleAction(screenName) {
  if (!screenName) return;
  runtimeState.message = `Unfollowing @${screenName}...`;
  await renderPanel();

  try {
    await unfollowUser(screenName);
    runtimeState.count += 1;
    runtimeState.unfollowedSet.add(screenName);
    runtimeState.message = `Unfollowed @${screenName}.`;
    await applyFiltersAndRender();
  } catch (error) {
    runtimeState.message = String(error?.message || error);
    await renderPanel();
  }
}

async function runSingleFollow(screenName) {
  if (!screenName) return;
  runtimeState.message = `Following @${screenName}...`;
  await renderPanel();

  try {
    await followUser(screenName);
    runtimeState.unfollowedSet.delete(screenName);
    runtimeState.message = `Followed @${screenName}.`;
    await applyFiltersAndRender();
  } catch (error) {
    runtimeState.message = String(error?.message || error);
    await renderPanel();
  }
}

async function runBatch() {
  if (runtimeState.running) return;

  runtimeState.running = true;
  runtimeState.stopRequested = false;
  runtimeState.count = 0;
  runtimeState.target = runtimeState.filteredUsers.filter((u) => !runtimeState.unfollowedSet.has(u.screen_name)).length;

  const settings = await getStorage(UNFOLLOW_KEY, UNFOLLOW_DEFAULTS);
  const speed = settings.unfollowAllSpeed;

  for (const user of [...runtimeState.filteredUsers]) {
    if (runtimeState.stopRequested) break;
    if (runtimeState.unfollowedSet.has(user.screen_name)) continue;

    runtimeState.message = `Unfollowing @${user.screen_name} (${runtimeState.count + 1}/${runtimeState.target})`;
    await renderPanel();

    try {
      await unfollowUser(user.screen_name);
      runtimeState.unfollowedSet.add(user.screen_name);
      runtimeState.count += 1;
    } catch (error) {
      runtimeState.message = `Stopped on @${user.screen_name}: ${String(error?.message || error)}`;
      break;
    }

    await applyFiltersAndRender();
    await sleep(getDelay(speed));
  }

  runtimeState.running = false;
  runtimeState.stopRequested = false;
  runtimeState.message = `Finished ${runtimeState.count}/${runtimeState.target}.`;
  await renderPanel();
}

// ─── Bootstrap ───────────────────────────────────────

function ensureAnchor() {
  const host = document.querySelector("[data-testid='UserName']")?.parentElement;
  if (!host || !isOwnProfilePage()) {
    ui.anchor?.remove();
    ui.anchor = null;
    return;
  }

  if (!ui.anchor) {
    ui.anchor = document.createElement("div");
    ui.anchor.id = "xcleaner-anchor";
    host.appendChild(ui.anchor);
  } else if (ui.anchor.parentElement !== host) {
    host.appendChild(ui.anchor);
  }

  ui.anchor.innerHTML = `<button class="xur-btn xur-btn-main" id="xcleaner-open">XSweep</button>`;
  ui.anchor.querySelector("#xcleaner-open")?.addEventListener("click", async () => {
    runtimeState.message = "Panel opened.";
    await renderPanel();
  });
}

async function refreshContext() {
  runtimeState.currentHandle = extractHandleFromPath();
  await ensureMyHandle();
  if (!runtimeState.authToken || !runtimeState.csrfToken) {
    await requestAuthHeaders().catch(() => false);
  }
  ensureAnchor();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "STATUS") {
    sendResponse({
      ok: true,
      state: {
        running: runtimeState.running,
        count: runtimeState.count,
        target: runtimeState.target,
        message: runtimeState.message
      }
    });
    return false;
  }

  if (message?.type === "TOGGLE_PANEL" || message?.type === "OPEN_PANEL") {
    renderPanel().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === "STOP") {
    runtimeState.stopRequested = true;
    runtimeState.message = "Stop requested.";
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

loadMyHandle().catch(() => { });
requestAuthHeaders().catch(() => false);
refreshContext();
setInterval(refreshContext, 800);
