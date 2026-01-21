import React, { useCallback, useEffect, useState } from "react";

import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { ToolButton } from "@excalidraw/excalidraw/components/ToolButton";
import { useI18n } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  clearGoogleDriveAuth,
  downloadGoogleDriveFile,
  ensureGoogleDriveToken,
  getCachedGoogleDriveToken,
  isGoogleDriveConfigured,
  listGoogleDriveFiles,
} from "../data/googleDrive";

import { GoogleDriveIcon } from "./GoogleDriveIcon";

import "./GoogleDriveDialog.scss";

import type { DriveFile } from "../data/googleDrive";

export const GoogleDriveDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}> = ({ open, onClose, excalidrawAPI }) => {
  const { t } = useI18n();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(() =>
    Boolean(getCachedGoogleDriveToken()),
  );

  const configured = isGoogleDriveConfigured();

  const refreshFiles = useCallback(
    async (interactive: boolean) => {
      if (!configured) {
        return;
      }
      if (!interactive && !getCachedGoogleDriveToken()) {
        setIsConnected(false);
        setFiles([]);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const token = await ensureGoogleDriveToken({ interactive });
        setIsConnected(true);
        const list = await listGoogleDriveFiles(token);
        setFiles(list);
      } catch (err: any) {
        if (!interactive) {
          setIsConnected(false);
        }
        setError(err?.message || t("googleDriveDialog.error"));
      } finally {
        setIsLoading(false);
      }
    },
    [configured, t],
  );

  useEffect(() => {
    if (open) {
      setIsConnected(Boolean(getCachedGoogleDriveToken()));
      refreshFiles(false);
    }
  }, [open, refreshFiles]);

  const handleDisconnect = () => {
    clearGoogleDriveAuth();
    setIsConnected(false);
    setFiles([]);
  };

  const handleImport = async (fileId: string) => {
    if (!excalidrawAPI) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const token = await ensureGoogleDriveToken({ interactive: true });
      const blob = await downloadGoogleDriveFile(token, fileId);
      const scene = await loadFromBlob(
        blob,
        excalidrawAPI.getAppState(),
        excalidrawAPI.getSceneElements(),
      );

      excalidrawAPI.updateScene({
        elements: scene.elements,
        appState: {
          ...scene.appState,
          isLoading: false,
        },
      });

      if (scene.files) {
        excalidrawAPI.addFiles(Object.values(scene.files));
      }

      excalidrawAPI.history.clear();
      excalidrawAPI.setToast({
        message: t("googleDriveDialog.importSuccess"),
        duration: 4000,
      });
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(t("alerts.couldNotLoadInvalidFile"));
    } finally {
      setIsLoading(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <Dialog onCloseRequest={onClose} title={t("googleDriveDialog.title")}>
      <div className="GoogleDriveDialog">
        {!configured && (
          <div className="GoogleDriveDialog__notice">
            {t("googleDriveDialog.notConfigured")}
          </div>
        )}

        {configured && (
          <div className="GoogleDriveDialog__header">
            <div className="GoogleDriveDialog__header__icon">
              <GoogleDriveIcon size={28} />
            </div>
            <div className="GoogleDriveDialog__actions">
              {!isConnected && (
                <ToolButton
                  type="button"
                  aria-label={t("googleDriveDialog.connect")}
                  title={t("googleDriveDialog.connect")}
                  showAriaLabel={true}
                  onClick={() => refreshFiles(true)}
                />
              )}
              {isConnected && (
                <>
                  <ToolButton
                    type="button"
                    aria-label={t("googleDriveDialog.refresh")}
                    title={t("googleDriveDialog.refresh")}
                    showAriaLabel={true}
                    onClick={() => refreshFiles(false)}
                  />
                  <ToolButton
                    type="button"
                    aria-label={t("googleDriveDialog.disconnect")}
                    title={t("googleDriveDialog.disconnect")}
                    showAriaLabel={true}
                    onClick={handleDisconnect}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {error && <div className="GoogleDriveDialog__error">{error}</div>}

        {configured && isConnected && (
          <div className="GoogleDriveDialog__content">
            {isLoading ? (
              <div className="GoogleDriveDialog__loading">
                {t("googleDriveDialog.loading")}
              </div>
            ) : files.length ? (
              <ul className="GoogleDriveDialog__list">
                {files.map((file) => (
                  <li key={file.id} className="GoogleDriveDialog__item">
                    <div className="GoogleDriveDialog__item__details">
                      <div className="GoogleDriveDialog__item__name">
                        {file.name}
                      </div>
                      {file.modifiedTime && (
                        <div className="GoogleDriveDialog__item__meta">
                          {new Date(file.modifiedTime).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <ToolButton
                      type="button"
                      aria-label={t("buttons.load")}
                      title={t("buttons.load")}
                      showAriaLabel={true}
                      disabled={!excalidrawAPI}
                      onClick={() => handleImport(file.id)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="GoogleDriveDialog__empty">
                {t("googleDriveDialog.empty")}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
};
