import { useState, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { CloudUpload, FileText, X, Plus, CheckCircle2, AlertCircle } from "lucide-react";

export default function UploadPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<Array<{ file: File; tags: string[]; newTag: string }>>([]);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, tags }: { file: File; tags: string[] }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("tags", JSON.stringify(tags));

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Upload failed");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    },
  });

  const [uploadResults, setUploadResults] = useState<Array<{ name: string; success: boolean; error?: string }>>([]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith(".docx")
    );
    setFiles((prev) => [
      ...prev,
      ...droppedFiles.map((f) => ({ file: f, tags: [], newTag: "" })),
    ]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).filter(
      (f) => f.name.endsWith(".docx")
    );
    setFiles((prev) => [
      ...prev,
      ...selected.map((f) => ({ file: f, tags: [], newTag: "" })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const addTag = (index: number) => {
    setFiles((prev) =>
      prev.map((f, i) => {
        if (i === index && f.newTag.trim()) {
          return { ...f, tags: [...f.tags, f.newTag.trim()], newTag: "" };
        }
        return f;
      })
    );
  };

  const removeTag = (fileIndex: number, tag: string) => {
    setFiles((prev) =>
      prev.map((f, i) => {
        if (i === fileIndex) {
          return { ...f, tags: f.tags.filter((t) => t !== tag) };
        }
        return f;
      })
    );
  };

  const updateNewTag = (index: number, value: string) => {
    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, newTag: value } : f))
    );
  };

  const handleUploadAll = async () => {
    const results: Array<{ name: string; success: boolean; error?: string }> = [];

    for (const fileItem of files) {
      try {
        await uploadMutation.mutateAsync({
          file: fileItem.file,
          tags: fileItem.tags,
        });
        results.push({ name: fileItem.file.name, success: true });
      } catch (error: any) {
        results.push({ name: fileItem.file.name, success: false, error: error.message });
      }
    }

    setUploadResults(results);
    const successCount = results.filter((r) => r.success).length;
    setFiles([]);
    toast({
      title: `Uploaded ${successCount} of ${results.length} files`,
      variant: successCount === results.length ? "default" : "destructive",
    });
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 animate-fade-in">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">
          <CloudUpload className="w-6 h-6 text-primary shrink-0" />
          Upload Evidence
        </h2>
        <p className="text-muted-foreground">
          Upload .docx evidence files. Add tags for better searchability. All formatting is preserved for download.
        </p>
      </div>

      <Card
        className={`border-2 border-dashed transition-all duration-200 ${
          isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-muted-foreground/20"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <CloudUpload className="w-7 h-7 text-primary" />
          </div>
          <p className="font-medium mb-1">Drag and drop .docx files here</p>
          <p className="text-sm text-muted-foreground mb-4">or click to browse</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            data-testid="input-file-upload"
          />
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="gap-2"
            data-testid="button-browse-files"
          >
            <CloudUpload className="w-4 h-4" />
            Browse Files
          </Button>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{files.length} file{files.length !== 1 ? "s" : ""} ready to upload</p>
            <Button
              onClick={handleUploadAll}
              disabled={uploadMutation.isPending}
              data-testid="button-upload-all"
            >
              {uploadMutation.isPending ? "Uploading..." : `Upload All (${files.length})`}
            </Button>
          </div>

          {files.map((fileItem, index) => (
            <Card key={index} data-testid={`card-file-${index}`}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate">{fileItem.file.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(fileItem.file.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeFile(index)}
                    data-testid={`button-remove-file-${index}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {fileItem.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                        {tag}
                        <button onClick={() => removeTag(index, tag)}>
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add search tags (e.g., dedev, econ decline, nuke war)..."
                      value={fileItem.newTag}
                      onChange={(e) => updateNewTag(index, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag(index);
                        }
                      }}
                      className="h-8 text-sm"
                      data-testid={`input-tag-${index}`}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8"
                      onClick={() => addTag(index)}
                      disabled={!fileItem.newTag.trim()}
                      data-testid={`button-add-tag-${index}`}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Tag
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {uploadResults.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Upload Results</p>
          {uploadResults.map((result, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-sm p-2 rounded-md ${
                result.success ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-destructive/10 text-destructive"
              }`}
              data-testid={`upload-result-${i}`}
            >
              {result.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate">{result.name}</span>
              {result.error && <span className="text-xs">- {result.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
