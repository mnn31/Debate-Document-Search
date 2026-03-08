import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Swords, Upload, FileText, ArrowRight, Download, AlertCircle, Shield, Target, ChevronDown, ChevronUp } from "lucide-react";

interface ContentionStructure {
  uniqueness: string;
  link: string;
  internalLinks: string[];
  impact: string;
}

interface Contention {
  name: string;
  summary: string;
  structure: ContentionStructure;
}

interface ResponseMatch {
  targetContention: string;
  responseType: string;
  responseLabel: string;
  explanation: string;
  contentionIndex: number;
  docId: number;
  docFilename: string;
  sectionHint: string;
}

interface AnalysisResult {
  contentions: Contention[];
  responses: ResponseMatch[];
  caseText: string;
}

const RESPONSE_TYPE_COLORS: Record<string, string> = {
  "NUQ": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "NL": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "L/T": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "N!": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "!/T": "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  "General": "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

const RESPONSE_TYPE_LABELS: Record<string, string> = {
  "NUQ": "Nonunique",
  "NL": "No Link",
  "L/T": "Link Turn",
  "N!": "No Impact",
  "!/T": "Impact Turn",
  "General": "General Response",
};

export default function OpponentPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedContentions, setExpandedContentions] = useState<Set<number>>(new Set());

  const analyzeMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/analyze-opponent-case", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Analysis failed");
      }

      return (await res.json()) as AnalysisResult;
    },
    onSuccess: () => {
      setExpandedContentions(new Set([0]));
    },
  });

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
    const file = Array.from(e.dataTransfer.files).find((f) => f.name.endsWith(".docx"));
    if (file) analyzeMutation.mutate(file);
    else toast({ title: "Please upload a .docx file", variant: "destructive" });
  }, [analyzeMutation, toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) analyzeMutation.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDownload = (id: number, filename: string) => {
    const link = document.createElement("a");
    link.href = `/api/documents/${id}/download`;
    link.download = filename;
    link.click();
  };

  const toggleContention = (index: number) => {
    setExpandedContentions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const getResponsesForContention = (contentionIndex: number) => {
    if (!analyzeMutation.data) return [];
    return analyzeMutation.data.responses.filter(
      (r) => r.contentionIndex === contentionIndex
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Opponent Case Analyzer</h2>
        <p className="text-muted-foreground">
          Upload your opponent's case file. AI will break down their arguments (UQ → L → IL → !) and find your best responses (NUQ, NL, L/T, N!, !/T) from your evidence library.
        </p>
      </div>

      <Card
        className={`border-2 border-dashed transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/20"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Swords className="w-7 h-7 text-primary" />
          </div>
          <p className="font-medium mb-1">Upload opponent's case (.docx)</p>
          <p className="text-sm text-muted-foreground mb-4">AI will break down their arguments and find your responses</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={handleFileSelect}
            data-testid="input-opponent-file"
          />
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={analyzeMutation.isPending}
            data-testid="button-upload-opponent"
          >
            {analyzeMutation.isPending ? "Analyzing..." : "Select Case File"}
          </Button>
        </CardContent>
      </Card>

      {analyzeMutation.isPending && (
        <div className="space-y-4" data-testid="analysis-loading">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-1/2" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-1/3" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        </div>
      )}

      {analyzeMutation.isError && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <p className="text-sm text-destructive">
              Analysis failed: {analyzeMutation.error?.message || "Unknown error"}
            </p>
          </CardContent>
        </Card>
      )}

      {analyzeMutation.isSuccess && analyzeMutation.data && (
        <div className="space-y-6">
          {analyzeMutation.data.contentions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-destructive" />
                <h3 className="font-semibold text-lg">Case Breakdown</h3>
                <Badge variant="secondary">{analyzeMutation.data.contentions.length} contention{analyzeMutation.data.contentions.length !== 1 ? "s" : ""}</Badge>
              </div>

              {analyzeMutation.data.contentions.map((contention, i) => {
                const isExpanded = expandedContentions.has(i);
                const responses = getResponsesForContention(i);

                return (
                  <Card key={i} data-testid={`card-contention-${i}`}>
                    <CardHeader
                      className="cursor-pointer pb-2"
                      onClick={() => toggleContention(i)}
                    >
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Badge variant="outline" className="font-mono shrink-0">C{i + 1}</Badge>
                          <span data-testid={`text-contention-name-${i}`}>{contention.name}</span>
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          {responses.length > 0 && (
                            <Badge variant="secondary" className="text-xs gap-1">
                              <Shield className="w-3 h-3" />
                              {responses.length} response{responses.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{contention.summary}</p>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent className="space-y-4 pt-0">
                        <div className="bg-muted/50 rounded-md p-4 space-y-3">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Argument Structure</p>

                          <div className="flex items-start gap-2 flex-wrap">
                            {contention.structure.uniqueness && (
                              <div className="space-y-1">
                                <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 text-xs">UQ</Badge>
                                <p className="text-xs text-muted-foreground max-w-xs">{contention.structure.uniqueness}</p>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 flex-wrap text-xs">
                            {contention.structure.link && (
                              <>
                                <div className="space-y-1 min-w-0">
                                  <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">L</Badge>
                                  <p className="text-xs text-muted-foreground">{contention.structure.link}</p>
                                </div>
                                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mt-4" />
                              </>
                            )}

                            {contention.structure.internalLinks?.map((il, j) => (
                              <span key={j} className="flex items-center gap-1">
                                <div className="space-y-1 min-w-0">
                                  <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 text-xs">IL</Badge>
                                  <p className="text-xs text-muted-foreground">{il}</p>
                                </div>
                                {j < (contention.structure.internalLinks?.length || 0) - 1 && (
                                  <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mt-4" />
                                )}
                              </span>
                            ))}

                            {contention.structure.impact && (
                              <>
                                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mt-4" />
                                <div className="space-y-1 min-w-0">
                                  <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-xs">!</Badge>
                                  <p className="text-xs text-muted-foreground font-medium">{contention.structure.impact}</p>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {responses.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                              <Shield className="w-3 h-3" />
                              Your Responses
                            </p>
                            {responses.map((response, j) => (
                              <div
                                key={j}
                                className="border rounded-md p-3 space-y-2"
                                data-testid={`card-response-${i}-${j}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="space-y-1.5 flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Badge className={`text-xs ${RESPONSE_TYPE_COLORS[response.responseType] || RESPONSE_TYPE_COLORS["General"]}`}>
                                        {response.responseType}
                                      </Badge>
                                      <span className="text-xs text-muted-foreground">
                                        {RESPONSE_TYPE_LABELS[response.responseType] || response.responseType}
                                      </span>
                                    </div>
                                    <p className="text-sm font-medium">{response.responseLabel}</p>
                                    <p className="text-xs text-muted-foreground">{response.explanation}</p>
                                    <div className="flex items-center gap-2">
                                      <FileText className="w-3 h-3 text-primary shrink-0" />
                                      <p className="text-xs font-medium text-primary truncate">{response.docFilename}</p>
                                    </div>
                                    {response.sectionHint && (
                                      <p className="text-xs text-muted-foreground">
                                        Look in: <span className="font-medium text-foreground">{response.sectionHint}</span>
                                      </p>
                                    )}
                                  </div>
                                  {response.docId && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="shrink-0"
                                      onClick={() => handleDownload(response.docId, response.docFilename)}
                                      data-testid={`button-download-response-${i}-${j}`}
                                    >
                                      <Download className="w-4 h-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {responses.length === 0 && (
                          <p className="text-xs text-muted-foreground italic">
                            No matching responses found in your library for this contention.
                          </p>
                        )}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {analyzeMutation.data.responses.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-lg">All Responses</h3>
                <Badge variant="secondary">{analyzeMutation.data.responses.length} found</Badge>
              </div>
              <div className="grid gap-2">
                {analyzeMutation.data.responses.map((response, i) => (
                  <div
                    key={i}
                    className="border rounded-md p-3 flex items-center justify-between gap-3"
                    data-testid={`card-all-response-${i}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Badge className={`text-xs shrink-0 ${RESPONSE_TYPE_COLORS[response.responseType] || RESPONSE_TYPE_COLORS["General"]}`}>
                        {response.responseType}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{response.responseLabel}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          vs {response.targetContention} · {response.docFilename}
                          {response.sectionHint ? ` · ${response.sectionHint}` : ""}
                        </p>
                      </div>
                    </div>
                    {response.docId && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => handleDownload(response.docId, response.docFilename)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {analyzeMutation.data.contentions.length === 0 && analyzeMutation.data.responses.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Shield className="w-12 h-12 text-muted-foreground/20 mb-4" />
                <p className="font-medium text-muted-foreground">Could not analyze this case</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Make sure the file contains a debate case with clear argument structure
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
