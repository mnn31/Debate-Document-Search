import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Swords, Upload, FileText, ArrowRight, Download, AlertCircle, Shield, Target } from "lucide-react";

interface OpponentArgument {
  claim: string;
  impactChain: string;
}

interface ResponseMatch {
  opponentClaim: string;
  responseDocId: number;
  responseFilename: string;
  explanation: string;
  sectionHint: string;
}

interface AnalysisResult {
  arguments: OpponentArgument[];
  responses: ResponseMatch[];
  caseText: string;
}

export default function OpponentPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

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

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Opponent Case Analyzer</h2>
        <p className="text-muted-foreground">
          Upload your opponent's case file and AI will find responses from your evidence library.
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
          <p className="text-sm text-muted-foreground mb-4">AI will analyze it and find your best responses</p>
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
          {analyzeMutation.data.arguments.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-destructive" />
                <h3 className="font-semibold text-lg">Opponent's Arguments</h3>
              </div>
              {analyzeMutation.data.arguments.map((arg, i) => (
                <Card key={i} data-testid={`card-opponent-arg-${i}`}>
                  <CardContent className="pt-4">
                    <p className="font-medium text-sm mb-2" data-testid={`text-opponent-claim-${i}`}>
                      {arg.claim}
                    </p>
                    {arg.impactChain && (
                      <div className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground">
                        {arg.impactChain.split(/\s*->\s*|→/).map((step, j, arr) => (
                          <span key={j} className="flex items-center gap-1">
                            <Badge variant="outline" className="text-xs">{step.trim()}</Badge>
                            {j < arr.length - 1 && <ArrowRight className="w-3 h-3" />}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {analyzeMutation.data.responses.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-lg">Your Responses</h3>
                <Badge variant="secondary">{analyzeMutation.data.responses.length} found</Badge>
              </div>
              {analyzeMutation.data.responses.map((response, i) => (
                <Card key={i} className="hover-elevate" data-testid={`card-response-${i}`}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                            Responds to
                          </p>
                          <p className="text-sm font-medium text-destructive/80">
                            {response.opponentClaim}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                            Your Evidence
                          </p>
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary shrink-0" />
                            <p className="text-sm font-medium truncate">{response.responseFilename}</p>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">{response.explanation}</p>
                        {response.sectionHint && (
                          <p className="text-xs text-muted-foreground">
                            Look in: <span className="font-medium text-foreground">{response.sectionHint}</span>
                          </p>
                        )}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDownload(response.responseDocId, response.responseFilename)}
                        data-testid={`button-download-response-${i}`}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {analyzeMutation.data.responses.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Shield className="w-12 h-12 text-muted-foreground/20 mb-4" />
                <p className="font-medium text-muted-foreground">No matching responses found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload more evidence files and add relevant tags to improve results
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
