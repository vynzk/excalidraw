import React from "react";

import {
  DEFAULT_EXPORT_PADDING,
  DEFAULT_FILENAME,
  MIME_TYPES,
  getFrame,
} from "@excalidraw/common";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { Card } from "@excalidraw/excalidraw/components/Card";
import { ToolButton } from "@excalidraw/excalidraw/components/ToolButton";
import { prepareElementsForExport } from "@excalidraw/excalidraw/data";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { exportToBlob } from "@excalidraw/utils/export";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFiles, UIAppState } from "@excalidraw/excalidraw/types";

import {
  ensureGoogleDriveToken,
  uploadGoogleDriveFile,
} from "../data/googleDrive";

import { GoogleDriveIcon } from "./GoogleDriveIcon";

const normalizeFileName = (name: string) => {
  const trimmed = name.trim() || DEFAULT_FILENAME;
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
    await uploadGoogleDriveFile({
      token,
      name: getExportFileName(name, exportAppState.exportEmbedScene),
      mimeType: MIME_TYPES.png,
      blob,
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
