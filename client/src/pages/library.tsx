import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Download, Trash2, FileText, Tag, Plus, X, FolderOpen, Brain, RefreshCw, Eye } from "lucide-react";
import { Link } from "wouter";
interface DocumentListItem {
  id: number;
  filename: string;
  originalFilename: string;
  tags: string[];
  aiKeywords?: string[];
  uploadedAt: string;
  textPreview: string;
  indexed?: boolean;
}

export default function LibraryPage() {
  const { toast } = useToast();
  const [editingTagsId, setEditingTagsId] = useState<number | null>(null);
  const [newTag, setNewTag] = useState("");

  const { data: documents, isLoading } = useQuery<DocumentListItem[]>({
    queryKey: ["/api/documents"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Document deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete document", variant: "destructive" });
    },
  });

  const tagMutation = useMutation({
    mutationFn: async ({ id, tags }: { id: number; tags: string[] }) => {
      await apiRequest("PATCH", `/api/documents/${id}/tags`, { tags });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    },
  });

  const reindexMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/documents/${id}/reindex`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Re-indexed successfully" });
    },
    onError: () => {
      toast({ title: "Re-index failed", variant: "destructive" });
    },
  });

  const handleAddTag = (doc: DocumentListItem) => {
    if (!newTag.trim()) return;
    const updated = [...doc.tags, newTag.trim()];
    tagMutation.mutate({ id: doc.id, tags: updated });
    setNewTag("");
  };

  const handleRemoveTag = (doc: DocumentListItem, tagToRemove: string) => {
    const updated = doc.tags.filter((t) => t !== tagToRemove);
    tagMutation.mutate({ id: doc.id, tags: updated });
  };

  const handleDownload = (id: number, filename: string) => {
    const link = document.createElement("a");
    link.href = `/api/documents/${id}/download`;
    link.download = filename;
    link.click();
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Evidence Library</h2>
        <p className="text-muted-foreground">
          Manage your uploaded evidence files and their tags.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && documents && documents.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="w-16 h-16 text-muted-foreground/20 mb-4" />
            <h3 className="font-medium text-lg mb-1">No evidence files yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload .docx files to start building your evidence library.
            </p>
            <Button variant="secondary" onClick={() => window.location.href = "/upload"} data-testid="button-go-upload">
              Upload Files
            </Button>
          </CardContent>
        </Card>
      )}

      {documents && documents.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground" data-testid="text-doc-count">
            {documents.length} file{documents.length !== 1 ? "s" : ""} in library
          </p>
          {documents.map((doc) => (
            <Card key={doc.id} data-testid={`card-document-${doc.id}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <div className="space-y-1 min-w-0 flex-1">
                  <CardTitle className="text-base flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                    <span className="truncate" data-testid={`text-filename-${doc.id}`}>{doc.originalFilename}</span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                    </p>
                    {doc.indexed ? (
                      <Badge variant="secondary" className="text-[10px] gap-0.5 h-4 px-1.5">
                        <Brain className="w-2.5 h-2.5" />
                        Indexed
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] gap-0.5 h-4 px-1.5 text-yellow-600">
                        Pending
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Link href={`/documents/${doc.id}`}>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="View cards"
                      data-testid={`button-view-cards-${doc.id}`}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => reindexMutation.mutate(doc.id)}
                    disabled={reindexMutation.isPending}
                    title="Re-index with AI"
                    data-testid={`button-reindex-${doc.id}`}
                  >
                    <RefreshCw className={`w-4 h-4 ${reindexMutation.isPending ? "animate-spin" : ""}`} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDownload(doc.id, doc.originalFilename)}
                    data-testid={`button-download-${doc.id}`}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" data-testid={`button-delete-${doc.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete evidence file?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently remove "{doc.originalFilename}" and all its indexed sections from your library.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(doc.id)}
                          data-testid="button-confirm-delete"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    <Tag className="w-3 h-3 text-muted-foreground" />
                    {doc.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                        {tag}
                        {editingTagsId === doc.id && (
                          <button
                            onClick={() => handleRemoveTag(doc, tag)}
                            className="ml-0.5"
                            data-testid={`button-remove-tag-${tag}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </Badge>
                    ))}
                    {doc.tags.length === 0 && editingTagsId !== doc.id && (
                      <span className="text-xs text-muted-foreground">No tags</span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => setEditingTagsId(editingTagsId === doc.id ? null : doc.id)}
                      data-testid={`button-edit-tags-${doc.id}`}
                    >
                      {editingTagsId === doc.id ? "Done" : "Edit Tags"}
                    </Button>
                  </div>

                  {editingTagsId === doc.id && (
                    <div className="flex gap-2">
                      <Input
                        placeholder="Add a tag..."
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddTag(doc);
                          }
                        }}
                        className="h-8 text-sm"
                        data-testid={`input-new-tag-${doc.id}`}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8"
                        onClick={() => handleAddTag(doc)}
                        disabled={!newTag.trim()}
                        data-testid={`button-add-tag-${doc.id}`}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                    </div>
                  )}

                  {doc.textPreview && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-2">
                      {doc.textPreview}...
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
