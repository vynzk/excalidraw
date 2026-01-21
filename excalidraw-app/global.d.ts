import "@excalidraw/excalidraw/global";
import "@excalidraw/excalidraw/css";

declare global {
  interface Window {
    __EXCALIDRAW_SHA__: string | undefined;
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: {
              access_token?: string;
              expires_in?: number;
              error?: string;
              error_description?: string;
            }) => void;
          }) => {
            requestAccessToken: (opts?: { prompt?: "" | "consent" }) => void;
          };
        };
      };
    };
  }
}

export {};
