import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_EXPORT_PADDING,
  DEFAULT_FILENAME,
  MIME_TYPES,
  getFrame,
} from "@excalidraw/common";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { Card } from "@excalidraw/excalidraw/components/Card";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import { ToolButton } from "@excalidraw/excalidraw/components/ToolButton";
import { prepareElementsForExport } from "@excalidraw/excalidraw/data";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { exportToBlob } from "@excalidraw/utils/export";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFiles, UIAppState } from "@excalidraw/excalidraw/types";
import type { DriveFile } from "../data/googleDrive";

import {
  ensureGoogleDriveToken,
  ensureGoogleDriveFolder,
  getCachedGoogleDriveToken,
  listGoogleDriveFolders,
  ensureGoogleDriveRootFolder,
  GOOGLE_DRIVE_ROOT_FOLDER_NAME,
  uploadGoogleDriveFile,
  deleteGoogleDriveFile,
} from "../data/googleDrive";

import { GoogleDriveIcon } from "./GoogleDriveIcon";

import "./ExportToGoogleDrive.scss";

const normalizeFileName = (name: string) => {
  const trimmed = name.trim() || DEFAULT_FILENAME;
  return trimmed.replace(/[\\/:*?"<>|]+/g, "-");
};

const normalizeFolderName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/[\\/:*?"<>|]+/g, "-");
};

const getExportFileName = (name: string, embedScene: boolean) => {
  const base = normalizeFileName(name);
  const extension = embedScene ? "excalidraw.png" : "png";
  const normalizedBase = base.replace(/\.(excalidraw\.png|png)$/i, "");
  return `${normalizedBase}.${extension}`;
};

export const ExportToGoogleDrive: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: UIAppState;
  files: BinaryFiles;
  name: string;
  onError: (error: Error) => void;
  onSuccess: () => void;
}> = ({ elements, appState, files, name, onError, onSuccess }) => {
  const { t } = useI18n();
  const [fileName, setFileName] = useState(name);
  const [folderPath, setFolderPath] = useState<DriveFile[]>([]);
  const [folderItems, setFolderItems] = useState<DriveFile[]>([]);
  const [isFolderLoading, setIsFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isConnected, setIsConnected] = useState(() =>
    Boolean(getCachedGoogleDriveToken()),
  );
  const hasInitialFolderLoad = useRef(false);

  useEffect(() => {
    setFileName(name);
  }, [name]);

  const loadFolders = useCallback(
    async (token: string, parentId: string) => {
      const list = await listGoogleDriveFolders(token, { parentId });
      setFolderItems(list);
    },
    [],
  );

  const refreshFolders = useCallback(
    async (interactive: boolean) => {
      if (!interactive && !getCachedGoogleDriveToken()) {
        setIsConnected(false);
        setFolderPath([]);
        setFolderItems([]);
        return;
      }

      setIsFolderLoading(true);
      setFolderError(null);
      try {
        const token = await ensureGoogleDriveToken({ interactive });
        setIsConnected(true);
        const rootFolder = await ensureGoogleDriveRootFolder(token);
        const activePath = folderPath.length ? folderPath : [rootFolder];
        if (!folderPath.length) {
          setFolderPath(activePath);
        }
        const currentFolder = activePath[activePath.length - 1];
        await loadFolders(token, currentFolder.id);
      } catch (error: any) {
        if (!interactive) {
          setIsConnected(false);
        }
        setFolderError(error?.message || t("googleDriveDialog.error"));
      } finally {
        setIsFolderLoading(false);
      }
    },
    [folderPath, loadFolders, t],
  );

  useEffect(() => {
    if (hasInitialFolderLoad.current) {
      return;
    }
    if (getCachedGoogleDriveToken()) {
      hasInitialFolderLoad.current = true;
      refreshFolders(false);
    }
  }, [refreshFolders]);

  const handleOpenFolder = useCallback(
    async (folder: DriveFile) => {
      setIsFolderLoading(true);
      setFolderError(null);
      try {
        const token = await ensureGoogleDriveToken({ interactive: false });
        const nextPath = [...folderPath, folder];
        setFolderPath(nextPath);
        await loadFolders(token, folder.id);
      } catch (error: any) {
        setFolderError(error?.message || t("googleDriveDialog.error"));
      } finally {
        setIsFolderLoading(false);
      }
    },
    [folderPath, loadFolders, t],
  );

  const handleGoUpFolder = useCallback(async () => {
    if (folderPath.length <= 1) {
      return;
    }
    setIsFolderLoading(true);
    setFolderError(null);
    try {
      const token = await ensureGoogleDriveToken({ interactive: false });
      const nextPath = folderPath.slice(0, -1);
      setFolderPath(nextPath);
      const currentFolder = nextPath[nextPath.length - 1];
      await loadFolders(token, currentFolder.id);
    } catch (error: any) {
      setFolderError(error?.message || t("googleDriveDialog.error"));
    } finally {
      setIsFolderLoading(false);
    }
  }, [folderPath, loadFolders, t]);

  const handleCreateFolder = useCallback(async () => {
    const normalizedFolderName = normalizeFolderName(newFolderName);
    if (!normalizedFolderName) {
      setFolderError(t("exportDialog.googleDrive_invalidFolderName"));
      return;
    }
    setIsCreatingFolder(true);
    setFolderError(null);
    try {
      const token = await ensureGoogleDriveToken({ interactive: true });
      setIsConnected(true);
      const rootFolder = await ensureGoogleDriveRootFolder(token);
      const parentFolder =
        folderPath.length > 0 ? folderPath[folderPath.length - 1] : rootFolder;
      await ensureGoogleDriveFolder({
        token,
        name: normalizedFolderName,
        parentId: parentFolder.id,
      });
      setNewFolderName("");
      if (!folderPath.length) {
        setFolderPath([rootFolder]);
      }
      await loadFolders(token, parentFolder.id);
    } catch (error: any) {
      setFolderError(error?.message || t("googleDriveDialog.error"));
    } finally {
      setIsCreatingFolder(false);
    }
  }, [folderPath, loadFolders, newFolderName, t]);

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      setIsFolderLoading(true);
      setFolderError(null);
      try {
        const token = await ensureGoogleDriveToken({ interactive: true });
        const currentFolder = folderPath[folderPath.length - 1];
        await deleteGoogleDriveFile(token, folderId);
        if (currentFolder) {
          await loadFolders(token, currentFolder.id);
        } else {
          const rootFolder = await ensureGoogleDriveRootFolder(token);
          setFolderPath([rootFolder]);
          await loadFolders(token, rootFolder.id);
        }
      } catch (error: any) {
        setFolderError(error?.message || t("googleDriveDialog.error"));
      } finally {
        setIsFolderLoading(false);
      }
    },
    [folderPath, loadFolders, t],
  );

  const handleExport = async () => {
    if (!elements.length) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }

    trackEvent("export", "gdrive", `ui (${getFrame()})`);

    const { exportedElements, exportingFrame } = prepareElementsForExport(
      elements,
      appState,
      false,
    );

    const exportAppState = {
      ...appState,
      exportEmbedScene: true,
    };

    const blob = await exportToBlob({
      elements: exportedElements,
      appState: exportAppState,
      files,
      exportPadding: DEFAULT_EXPORT_PADDING,
      mimeType: MIME_TYPES.png,
      exportingFrame,
    });

    const token = await ensureGoogleDriveToken({ interactive: true });
    const rootFolder = await ensureGoogleDriveRootFolder(token);
    const targetFolderId = folderPath.length
      ? folderPath[folderPath.length - 1].id
      : rootFolder.id;
    await uploadGoogleDriveFile({
      token,
      name: getExportFileName(fileName, exportAppState.exportEmbedScene),
      mimeType: MIME_TYPES.png,
      blob,
      parentId: targetFolderId,
    });

    onSuccess();
  };

  return (
    <Card color="lime">
      <div className="Card-icon">
        <GoogleDriveIcon size={36} />
      </div>
      <h2>{t("exportDialog.googleDrive_title")}</h2>
      <div className="Card-details">
        {t("exportDialog.googleDrive_details")}
        <div className="ExportToGoogleDrive__field">
          <TextField
            label={t("exportDialog.googleDrive_fileNameLabel")}
            placeholder={t("exportDialog.googleDrive_fileNamePlaceholder", {
              defaultName: DEFAULT_FILENAME,
            })}
            value={fileName}
            onChange={setFileName}
            fullWidth
          />
        </div>
        <div className="ExportToGoogleDrive__folderBrowser">
          <div className="ExportToGoogleDrive__folderBrowser__header">
            <span>{t("exportDialog.googleDrive_folderPickerLabel")}</span>
            {!isConnected && (
              <ToolButton
                type="button"
                aria-label={t("googleDriveDialog.connect")}
                title={t("googleDriveDialog.connect")}
                showAriaLabel={true}
                onClick={() => refreshFolders(true)}
              />
            )}
            {isConnected && (
              <ToolButton
                type="button"
                aria-label={t("googleDriveDialog.refresh")}
                title={t("googleDriveDialog.refresh")}
                showAriaLabel={true}
                onClick={() => refreshFolders(false)}
              />
            )}
          </div>
          <div className="ExportToGoogleDrive__folderBrowser__create">
            <TextField
              label={t("exportDialog.googleDrive_newFolderLabel")}
              placeholder={t("exportDialog.googleDrive_newFolderPlaceholder", {
                root: GOOGLE_DRIVE_ROOT_FOLDER_NAME,
              })}
              value={newFolderName}
              onChange={setNewFolderName}
              fullWidth
            />
            <ToolButton
              type="button"
              aria-label={t("exportDialog.googleDrive_createFolderButton")}
              title={t("exportDialog.googleDrive_createFolderButton")}
              showAriaLabel={true}
              onClick={handleCreateFolder}
              disabled={isCreatingFolder || !newFolderName.trim()}
            />
          </div>
          {folderPath.length > 0 && (
            <div className="ExportToGoogleDrive__folderBrowser__path">
              <ToolButton
                type="button"
                aria-label={t("googleDriveDialog.back")}
                title={t("googleDriveDialog.back")}
                showAriaLabel={true}
                onClick={handleGoUpFolder}
                disabled={folderPath.length <= 1 || isFolderLoading}
              />
              <span>
                {t("googleDriveDialog.currentFolder", {
                  name:
                    folderPath.length > 0
                      ? folderPath.map((entry) => entry.name).join(" / ")
                      : GOOGLE_DRIVE_ROOT_FOLDER_NAME,
                })}
              </span>
            </div>
          )}
          {folderError && (
            <div className="ExportToGoogleDrive__folderBrowser__error">
              {folderError}
            </div>
          )}
          {isConnected ? (
            isFolderLoading ? (
              <div className="ExportToGoogleDrive__folderBrowser__loading">
                {t("googleDriveDialog.loading")}
              </div>
            ) : folderItems.length ? (
              <ul className="ExportToGoogleDrive__folderBrowser__list">
                {folderItems.map((folder) => (
                  <li
                    key={folder.id}
                    className="ExportToGoogleDrive__folderBrowser__item"
                  >
                    <div className="ExportToGoogleDrive__folderBrowser__name">
                      {folder.name}
                    </div>
                    <div className="ExportToGoogleDrive__folderBrowser__actions">
                      <ToolButton
                        type="button"
                        aria-label={t("googleDriveDialog.openFolder")}
                        title={t("googleDriveDialog.openFolder")}
                        showAriaLabel={true}
                        onClick={() => handleOpenFolder(folder)}
                      />
                      <ToolButton
                        type="button"
                        aria-label={t("labels.delete")}
                        title={t("labels.delete")}
                        showAriaLabel={true}
                        onClick={() => handleDeleteFolder(folder.id)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="ExportToGoogleDrive__folderBrowser__empty">
                {t("googleDriveDialog.emptyFolder")}
              </div>
            )
          ) : (
            <div className="ExportToGoogleDrive__folderBrowser__empty">
              {t("exportDialog.googleDrive_connectToBrowse")}
            </div>
          )}
        </div>
      </div>
      <ToolButton
        className="Card-button"
        type="button"
        title={t("exportDialog.googleDrive_button")}
        aria-label={t("exportDialog.googleDrive_button")}
        showAriaLabel={true}
        onClick={async () => {
          try {
            await handleExport();
          } catch (error: any) {
            console.error(error);
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        }}
      />
    </Card>
  );
};
