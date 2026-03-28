const authState = {
  authToken: "",
  csrfToken: "",
  capturedAt: 0
};

function captureHeaders(details) {
  const headers = Array.isArray(details?.requestHeaders) ? details.requestHeaders : [];
  let changed = false;

  for (const header of headers) {
    const name = String(header?.name || "").toLowerCase();
    const value = String(header?.value || "");
    if (!value) continue;

    if (name === "authorization" && value !== authState.authToken) {
      authState.authToken = value;
      changed = true;
    }

    if (name === "x-csrf-token" && value !== authState.csrfToken) {
      authState.csrfToken = value;
      changed = true;
    }
  }

  if (changed) {
    authState.capturedAt = Date.now();
  }
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  captureHeaders,
  {
    urls: [
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.x.com/*",
      "https://api.twitter.com/*"
    ]
  },
  ["requestHeaders", "extraHeaders"]
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.requestingAuthHeaders) {
    sendResponse({
      authToken: authState.authToken ? { value: authState.authToken } : null,
      csrfToken: authState.csrfToken ? { value: authState.csrfToken } : null,
      capturedAt: authState.capturedAt
    });
    return false;
  }

  if (message?.type === "GET_AUTH_STATE") {
    sendResponse({ ok: true, state: authState });
    return false;
  }

  return false;
});
