
"use client";

import { useState } from "react";
import { FileUp, Download, CheckCircle2 } from "lucide-react";

import { api } from "@/lib/api";
import { Button, Modal } from "./ui";

type ImportRow = {
  line: number;
  name: string;
  sku: string;
  barcode: string;
  errors: string[];
};

type Preview = {
  rows: ImportRow[];
  total: number;
  valid: number;
  invalid: number;
  preview_token: string;
};

export function MedicineImport({
  open,
  onClose,
  branch,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  branch: string;
  onImported: () => void;
}) {
  const [csvText, setCsvText] = useState("");
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  function reset() {
    setCsvText("");
    setFilename("");
    setPreview(null);
    setError("");
    setResult("");
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function selectFile(file?: File) {
    reset();

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file.");
      return;
    }

    if (file.size > 1024 * 1024) {
      setError("Maximum file size is 1 MB.");
      return;
    }

    setFilename(file.name);
    setCsvText(await file.text());
  }

  async function review() {
    if (!csvText) return;

    setBusy(true);
    setError("");
    setPreview(null);

    try {
      const data = await api<Preview>(
        "catalog/import/preview/",
        {
          method: "POST",
          body: JSON.stringify({ csv_text: csvText }),
        },
        branch,
      );

      setPreview(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!preview || preview.invalid > 0) return;

    setBusy(true);
    setError("");

    try {
      const data = await api<{ imported: number }>(
        "catalog/import/commit/",
        {
          method: "POST",
          body: JSON.stringify({
            csv_text: csvText,
            preview_token: preview.preview_token,
          }),
        },
        branch,
      );

      setResult(`${data.imported} medicines imported successfully.`);
      setPreview(null);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const csv = [
      "name,generic,strength,form,manufacturer,sku,barcode,price,reorder_level,prescription_required",
      "Sample Medicine,Sample Generic,500 mg,Tablets,Sample Manufacturer,MED-001,890000000001,2.50,30,false",
    ].join("\r\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "medicine-import-template.csv";
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
      title="Import medicines"
      description="Upload a CSV file and review its contents before saving."
      wide
    >
      <div className="medicine-import">
        {!result && (
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={downloadTemplate}
            >
              <Download size={16} />
              Download CSV template
            </Button>

            <label className="medicine-import-upload">
              <FileUp size={24} />
              <strong>
                {filename || "Choose a CSV file"}
              </strong>
              <span>CSV only • Maximum 1 MB • 500 rows</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) => {
                  void selectFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>

            {csvText && !preview && (
              <Button onClick={() => void review()} disabled={busy}>
                {busy ? "Validating..." : "Preview medicines"}
              </Button>
            )}
          </>
        )}

        {preview && (
          <>
            <div className="medicine-import-summary">
              <span>Total: {preview.total}</span>
              <span>Valid: {preview.valid}</span>
              <span>Errors: {preview.invalid}</span>
            </div>

            <div className="medicine-import-table">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Medicine</th>
                    <th>SKU</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.line}>
                      <td>{row.line}</td>
                      <td>{row.name}</td>
                      <td>{row.sku}</td>
                      <td>
                        {row.errors.length
                          ? row.errors.join(" ")
                          : "Valid"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.invalid > 0 && (
              <p className="form-error">
                Correct the invalid rows in your CSV file,
                then upload it again.
              </p>
            )}
          </>
        )}

        {result && (
          <p className="medicine-import-success" role="status">
            <CheckCircle2 size={18} />
            {result}
          </p>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={busy}
          >
            Close
          </Button>

          {preview && preview.invalid === 0 && (
            <Button
              type="button"
              onClick={() => void confirmImport()}
              disabled={busy}
            >
              {busy
                ? "Importing..."
                : `Import ${preview.valid} medicines`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
