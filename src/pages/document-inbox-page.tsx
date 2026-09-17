import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Camera, FileUp, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { activeCompany } from "@/lib/companies";
import {
  captureDocument,
  listDocuments,
  uploadLocalDocument,
} from "@/lib/document-client";
import {
  adoptStagedDocuments,
  discardLocalDocument,
  listLocalDocuments,
  loadLocalDocumentFile,
  localDocumentUsage,
} from "@/lib/document-local-store";
import { pb } from "@/lib/pb";

export function DocumentInboxPage() {
  const client = useQueryClient();
  const upload = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const company = activeCompany();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const server = useQuery({
    queryKey: ["documents", company?.id],
    queryFn: () => listDocuments(),
  });
  const local = useQuery({
    queryKey: ["documents", "local", company?.id],
    queryFn: async () => ({
      items: await listLocalDocuments(
        pb.authStore.record?.id ?? null,
        company?.id ?? null,
      ),
      bytes: await localDocumentUsage(
        pb.authStore.record?.id ?? null,
        company?.id ?? null,
      ),
      staged: await listLocalDocuments(null, null),
      stagedBytes: await localDocumentUsage(null, null),
    }),
  });
  const localItems = local.data?.items;
  const refetchLocal = local.refetch;
  const refetchServer = server.refetch;
  const retry = useCallback(async () => {
    if (!navigator.onLine) return;
    const pending = localItems?.filter((item) => item.localOnly) || [];
    for (const draft of pending) {
      const stored = await loadLocalDocumentFile(draft);
      if (!stored) continue;
      await uploadLocalDocument(draft, stored.blob);
    }
    await Promise.all([refetchServer(), refetchLocal()]);
  }, [localItems, refetchLocal, refetchServer]);
  // Retry when the pending-count changes or connectivity returns.
  useEffect(() => {
    const online = () =>
      void retry().catch((cause) =>
        setMessage(cause instanceof Error ? cause.message : "Upload tertunda"),
      );
    window.addEventListener("online", online);
    if (navigator.onLine && localItems?.some((item) => item.localOnly))
      online();
    return () => window.removeEventListener("online", online);
  }, [localItems, retry]);
  const take = async (file?: File, source: "CAMERA" | "UPLOAD" = "UPLOAD") => {
    if (!file) return;
    setBusy(true);
    setMessage("Dokumen disimpan di perangkat…");
    try {
      const result = await captureDocument(file, source);
      setMessage(
        result.server
          ? "Dokumen tersimpan privat di server."
          : "Dokumen aman di perangkat dan akan diunggah saat online.",
      );
      await Promise.all([server.refetch(), local.refetch()]);
      await client.invalidateQueries({ queryKey: ["actions"] });
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Dokumen gagal disimpan",
      );
    } finally {
      setBusy(false);
    }
  };
  const pending = local.data?.items.filter((item) => item.localOnly) || [];
  const staged = local.data?.staged || [];
  const adopt = async () => {
    if (!company || !pb.authStore.record?.id) return;
    setBusy(true);
    try {
      await adoptStagedDocuments(pb.authStore.record.id, company.id);
      setMessage(`${staged.length} dokumen dimasukkan ke ${company.name}.`);
      await local.refetch();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Dokumen gagal dimasukkan",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 pb-8">
      <header>
        <h1 className="text-2xl">Inbox Dokumen</h1>
        <p className="text-sm text-muted-foreground">
          Kumpulkan bukti lebih dulu; belum memengaruhi cashflow sampai
          dikonfirmasi.
        </p>
      </header>
      {message && <p className="rounded-xl bg-white p-3 text-sm">{message}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Button disabled={busy} onClick={() => camera.current?.click()}>
          <Camera />
          Ambil Foto
        </Button>
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => upload.current?.click()}
        >
          <FileUp />
          Upload
        </Button>
        <input
          ref={camera}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
          onChange={(event) => void take(event.target.files?.[0], "CAMERA")}
        />
        <input
          ref={upload}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={(event) => void take(event.target.files?.[0], "UPLOAD")}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Penyimpanan lokal:{" "}
        {(
          ((local.data?.bytes || 0) + (local.data?.stagedBytes || 0)) /
          1024 /
          1024
        ).toFixed(1)}{" "}
        MB · {pending.length} menunggu upload
      </p>
      {staged.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="font-semibold">
              {staged.length} dokumen dibagikan ke Jornal
            </p>
            <p className="text-xs text-muted-foreground">
              Dokumen belum terikat ke company. Pastikan tujuan yang dipilih
              sudah benar.
            </p>
            <Button
              className="w-full"
              disabled={busy || !company}
              onClick={() => void adopt()}
            >
              Masukkan ke {company?.name || "company ini"}
            </Button>
          </CardContent>
        </Card>
      )}
      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((draft) => (
            <Card key={draft.id}>
              <CardContent className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{draft.filename}</p>
                  <p className="text-xs text-amber-700">
                    Aman di perangkat · belum di server
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!navigator.onLine || busy}
                    onClick={() =>
                      void retry().catch((cause) => setMessage(String(cause)))
                    }
                  >
                    Kirim
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void discardLocalDocument(draft).then(() =>
                        local.refetch(),
                      )
                    }
                  >
                    Hapus
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {server.data?.items
          .filter((item) => item.status !== "ARCHIVED")
          .map((document) => (
            <Link
              key={document.id}
              to="/inbox/$documentId"
              params={{ documentId: document.id }}
              className="block"
            >
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{document.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {document.status} ·{" "}
                      {(document.byteSize / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  {document.duplicateOfId && (
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      Kemungkinan duplikat
                    </span>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
      </div>
      {!server.isLoading &&
        !server.data?.items.length &&
        !pending.length &&
        !staged.length && (
          <Card>
            <CardContent className="p-8 text-center">
              <Inbox className="mx-auto mb-2 size-7 text-muted-foreground" />
              Belum ada dokumen.
            </CardContent>
          </Card>
        )}
    </div>
  );
}
