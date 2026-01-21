declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

const GOOGLE_IDENTITY_SCRIPT_ID = "google-identity-services";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API_BASE_URL = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE_URL = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_APP_PROPERTY_KEY = "excalidraw";
const DRIVE_APP_PROPERTY_VALUE = "true";
const DRIVE_TOKEN_STORAGE_KEY = "excalidraw_drive_token_v1";
const DRIVE_TOKEN_EXPIRY_STORAGE_KEY = "excalidraw_drive_token_expiry_v1";
const TOKEN_EXPIRY_SAFETY_WINDOW_MS = 60 * 1000;

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  iconLink?: string;
  webViewLink?: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: "" | "consent" }) => void;
};

let cachedToken: string | null = null;
let cachedTokenExpiry = 0;
let gisLoadPromise: Promise<void> | null = null;

const getClientId = () => import.meta.env.VITE_APP_GOOGLE_DRIVE_CLIENT_ID;

export const isGoogleDriveConfigured = () => Boolean(getClientId());

const loadCachedToken = () => {
  if (
    cachedToken &&
    Date.now() < cachedTokenExpiry - TOKEN_EXPIRY_SAFETY_WINDOW_MS
  ) {
    return cachedToken;
  }

  let storedToken: string | null = null;
  let storedExpiry: string | null = null;
  try {
    storedToken = sessionStorage.getItem(DRIVE_TOKEN_STORAGE_KEY);
    storedExpiry = sessionStorage.getItem(DRIVE_TOKEN_EXPIRY_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!storedToken || !storedExpiry) {
    return null;
  }

  const expiry = Number(storedExpiry);
  if (!Number.isFinite(expiry)) {
    return null;
  }

  if (Date.now() >= expiry - TOKEN_EXPIRY_SAFETY_WINDOW_MS) {
    return null;
  }

  cachedToken = storedToken;
  cachedTokenExpiry = expiry;
  return storedToken;
};

export const getCachedGoogleDriveToken = () => loadCachedToken();

const cacheToken = (token: string, expiresInSeconds?: number) => {
  const expiry = Date.now() + (expiresInSeconds ?? 3600) * 1000;
  cachedToken = token;
  cachedTokenExpiry = expiry;
  try {
    sessionStorage.setItem(DRIVE_TOKEN_STORAGE_KEY, token);
    sessionStorage.setItem(DRIVE_TOKEN_EXPIRY_STORAGE_KEY, String(expiry));
  } catch {
    // ignore storage errors
  }
};

export const clearGoogleDriveAuth = () => {
  cachedToken = null;
  cachedTokenExpiry = 0;
  try {
    sessionStorage.removeItem(DRIVE_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(DRIVE_TOKEN_EXPIRY_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
};

const loadGoogleIdentityServices = () => {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (gisLoadPromise) {
    return gisLoadPromise;
  }

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Google Identity Services")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_IDENTITY_SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });

  return gisLoadPromise;
};

const initTokenClient = async (
  prompt: "" | "consent",
): Promise<GoogleTokenResponse> => {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error("Google Drive client ID is not configured.");
  }

  await loadGoogleIdentityServices();

  return new Promise<GoogleTokenResponse>((resolve, reject) => {
    const tokenClient = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response: GoogleTokenResponse) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        resolve(response);
      },
    }) as TokenClient | undefined;

    if (!tokenClient) {
      reject(new Error("Google Drive auth is unavailable."));
      return;
    }

    tokenClient.requestAccessToken({ prompt });
  });
};

export const ensureGoogleDriveToken = async (
  opts: { interactive: boolean } = { interactive: false },
) => {
  const cached = loadCachedToken();
  if (cached) {
    return cached;
  }

  const tryToken = async (prompt: "" | "consent") => {
    const response = await initTokenClient(prompt);
    if (!response.access_token) {
      throw new Error("Google Drive auth failed.");
    }
    cacheToken(response.access_token, response.expires_in);
    return response.access_token;
  };

  try {
    return await tryToken("");
  } catch (error) {
    if (!opts.interactive) {
      throw error;
    }
  }

  return tryToken("consent");
};

const fetchDrive = async (url: string, token: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    let message = `Google Drive request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error?.message) {
        message = data.error.message;
      }
    } catch {
      // ignore JSON parsing errors
    }
    throw new Error(message);
  }

  return response;
};

export const listGoogleDriveFiles = async (
  token: string,
): Promise<DriveFile[]> => {
  const query = [
    "trashed = false",
    `appProperties has { key='${DRIVE_APP_PROPERTY_KEY}' and value='${DRIVE_APP_PROPERTY_VALUE}' }`,
  ].join(" and ");
  const params = new URLSearchParams({
    q: query,
    fields:
      "files(id,name,mimeType,modifiedTime,thumbnailLink,iconLink,webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
  });

  const response = await fetchDrive(
    `${DRIVE_API_BASE_URL}/files?${params.toString()}`,
    token,
  );
  const data = await response.json();
  return data.files || [];
};

export const uploadGoogleDriveFile = async ({
  token,
  name,
  mimeType,
  blob,
}: {
  token: string;
  name: string;
  mimeType: string;
  blob: Blob;
}): Promise<DriveFile> => {
  const boundary = `excalidraw-${Math.random().toString(16).slice(2)}`;
  const metadata = {
    name,
    mimeType,
    appProperties: {
      [DRIVE_APP_PROPERTY_KEY]: DRIVE_APP_PROPERTY_VALUE,
    },
  };

  const body = new Blob(
    [
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      "\r\n",
      `--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      blob,
      "\r\n",
      `--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );

  const response = await fetchDrive(
    `${DRIVE_UPLOAD_BASE_URL}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,modifiedTime`,
    token,
    {
      method: "POST",
      body,
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
    },
  );

  return response.json();
};

export const downloadGoogleDriveFile = async (
  token: string,
  fileId: string,
): Promise<Blob> => {
  const response = await fetchDrive(
    `${DRIVE_API_BASE_URL}/files/${fileId}?alt=media`,
    token,
  );
  return response.blob();
};
