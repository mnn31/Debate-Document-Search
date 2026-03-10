import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Swords, Upload, FileText, ArrowRight, Download, AlertCircle, Shield, Target, ChevronDown, ChevronUp, Route, MessageSquareQuote } from "lucide-react";

interface ContentionStructure {
  uniqueness: string;
  links?: string[];
  link?: string;
  internalLinks: string[];
  impact: string;
}

interface Contention {
  name: string;
  summary: string;
  structure: ContentionStructure;
}

interface CardMatch {
  cardId: number;
  documentId: number;
  tag: string;
  cite: string;
  body: string;
  sectionHeading: string | null;
  docFilename: string;
  rank: number;
}

interface ResponseMatch {
  contentionIndex: number;
  targetPart: string;
  targetPartIndex: number;
  responseType: string;
  responseLabel: string;
  explanation: string;
  searchQuery: string;
  docId: number;
  docFilename: string;
  sectionHint: string;
  cards: CardMatch[];
}

interface ResponsePath {
  name: string;
  description: string;
  responseIndices: number[];
}

interface AnalysisResult {
  contentions: Contention[];
  responses: ResponseMatch[];
  responsePaths: ResponsePath[];
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

const TARGET_PART_LABELS: Record<string, string> = {
  "uniqueness": "UQ",
  "link": "L",
  "internalLink": "IL",
  "impact": "!",
  "general": "General",
};

export default function OpponentPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedContentions, setExpandedContentions] = useState<Set<number>>(new Set());
  const [selectedPath, setSelectedPath] = useState<number | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

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
    onSuccess: (data) => {
      const indices = new Set(data.contentions.map((_: any, i: number) => i));
      setExpandedContentions(indices);
      setSelectedPath(null);
      setExpandedCards(new Set());
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

  const handleDownloadDoc = (id: number, filename: string) => {
    const link = document.createElement("a");
    link.href = `/api/documents/${id}/download`;
    link.download = filename;
    link.click();
  };

  const handleDownloadResponses = async (responses: ResponseMatch[], contentions: Contention[], pathName?: string) => {
    try {
      const res = await fetch("/api/download-responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses, contentions, pathName }),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Case_Responses_${(pathName || "all").replace(/[^a-zA-Z0-9 ]/g, "")}.docx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Download failed", variant: "destructive" });
    }
  };

  const toggleContention = (index: number) => {
    setExpandedContentions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleCard = (key: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getResponsesForContention = (contentionIndex: number) => {
    if (!analyzeMutation.data) return [];
    let responses = analyzeMutation.data.responses.filter(
      (r) => r.contentionIndex === contentionIndex
    );
    if (selectedPath !== null && analyzeMutation.data.responsePaths[selectedPath]) {
      const allowedIndices = new Set(analyzeMutation.data.responsePaths[selectedPath].responseIndices);
      responses = responses.filter((_, i) => {
        const globalIdx = analyzeMutation.data!.responses.indexOf(responses[i]);
        return allowedIndices.has(globalIdx);
      });
    }
    return responses;
  };

  const getFilteredResponses = () => {
    if (!analyzeMutation.data) return [];
    if (selectedPath === null) return analyzeMutation.data.responses;
    const path = analyzeMutation.data.responsePaths[selectedPath];
    if (!path) return analyzeMutation.data.responses;
    return path.responseIndices.map((i) => analyzeMutation.data!.responses[i]).filter(Boolean);
  };

  const data = analyzeMutation.data;
  const links = (c: Contention) => c.structure.links || (c.structure.link ? [c.structure.link] : []);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Opponent Case Analyzer</h2>
        <p className="text-muted-foreground">
          Upload your opponent's case file. AI will break down their arguments (UQ → L → IL → !) and find your best responses with actual evidence cards from your library.
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
          <p className="text-sm text-muted-foreground mb-4">AI will break down their arguments and find evidence cards to respond</p>
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
            <CardHeader><Skeleton className="h-5 w-1/2" /></CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><Skeleton className="h-5 w-1/3" /></CardHeader>
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

      {analyzeMutation.isSuccess && data && (
        <div className="space-y-6">

          {data.responsePaths.length > 0 && (
            <Card data-testid="card-response-paths">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Route className="w-4 h-4 text-primary" />
                  Response Paths
                </CardTitle>
                <p className="text-xs text-muted-foreground">Choose a strategy. Each path avoids double-turning.</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  size="sm"
                  variant={selectedPath === null ? "default" : "outline"}
                  onClick={() => setSelectedPath(null)}
                  className="mr-2"
                  data-testid="button-path-all"
                >
                  Show All
                </Button>
                {data.responsePaths.map((path, i) => (
                  <Button
                    key={i}
                    size="sm"
                    variant={selectedPath === i ? "default" : "outline"}
                    onClick={() => setSelectedPath(i)}
                    className="mr-2"
                    data-testid={`button-path-${i}`}
                  >
                    {path.name}
                  </Button>
                ))}
                {selectedPath !== null && data.responsePaths[selectedPath] && (
                  <p className="text-xs text-muted-foreground mt-2">{data.responsePaths[selectedPath].description}</p>
                )}
                <div className="pt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleDownloadResponses(
                      getFilteredResponses(),
                      data.contentions,
                      selectedPath !== null ? data.responsePaths[selectedPath]?.name : "All Responses"
                    )}
                    data-testid="button-download-all-responses"
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Download {selectedPath !== null ? data.responsePaths[selectedPath]?.name : "All"} Responses (.docx)
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {data.responsePaths.length === 0 && data.responses.length > 0 && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleDownloadResponses(data.responses, data.contentions, "All Responses")}
                data-testid="button-download-all-responses"
              >
                <Download className="w-4 h-4 mr-1" />
                Download All Responses (.docx)
              </Button>
            </div>
          )}

          {data.contentions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-destructive" />
                <h3 className="font-semibold text-lg">Case Breakdown</h3>
                <Badge variant="secondary">{data.contentions.length} contention{data.contentions.length !== 1 ? "s" : ""}</Badge>
              </div>

              {data.contentions.map((contention, i) => {
                const isExpanded = expandedContentions.has(i);
                const responses = getResponsesForContention(i);
                const contentionLinks = links(contention);

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
                            {contentionLinks.map((l, j) => (
                              <span key={`l-${j}`} className="flex items-center gap-1">
                                <div className="space-y-1 min-w-0">
                                  <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">L{contentionLinks.length > 1 ? j + 1 : ""}</Badge>
                                  <p className="text-xs text-muted-foreground">{l}</p>
                                </div>
                                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 mt-4" />
                              </span>
                            ))}

                            {contention.structure.internalLinks?.map((il, j) => (
                              <span key={`il-${j}`} className="flex items-center gap-1">
                                <div className="space-y-1 min-w-0">
                                  <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 text-xs">IL{contention.structure.internalLinks.length > 1 ? j + 1 : ""}</Badge>
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
                            {responses.map((response, j) => {
                              const globalIdx = data.responses.indexOf(response);
                              const cardKey = `${i}-${j}`;
                              const isCardExpanded = expandedCards.has(cardKey);
                              const targetLabel = TARGET_PART_LABELS[response.targetPart] || response.targetPart;

                              return (
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
                                        <Badge variant="outline" className="text-xs">
                                          → {targetLabel}
                                        </Badge>
                                      </div>
                                      <p className="text-sm font-medium">{response.responseLabel}</p>
                                      <p className="text-xs text-muted-foreground">{response.explanation}</p>
                                    </div>
                                  </div>

                                  {response.cards && response.cards.length > 0 && (
                                    <div className="space-y-1.5">
                                      <button
                                        className="text-xs font-medium text-primary flex items-center gap-1 hover:underline"
                                        onClick={() => toggleCard(cardKey)}
                                        data-testid={`button-toggle-cards-${i}-${j}`}
                                      >
                                        <MessageSquareQuote className="w-3 h-3" />
                                        {response.cards.length} evidence card{response.cards.length !== 1 ? "s" : ""} found
                                        {isCardExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                      </button>

                                      {isCardExpanded && (
                                        <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                                          {response.cards.map((card, k) => (
                                            <div key={k} className="bg-muted/30 rounded-md p-2.5 space-y-1" data-testid={`card-match-${i}-${j}-${k}`}>
                                              <div className="flex items-start justify-between gap-2">
                                                <p className="text-xs font-semibold leading-snug">{card.tag}</p>
                                                <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  className="shrink-0 h-6 w-6"
                                                  onClick={() => handleDownloadDoc(card.documentId, card.docFilename)}
                                                  data-testid={`button-download-card-${i}-${j}-${k}`}
                                                >
                                                  <Download className="w-3 h-3" />
                                                </Button>
                                              </div>
                                              {card.cite && (
                                                <p className="text-xs text-muted-foreground">{card.cite.slice(0, 120)}</p>
                                              )}
                                              {card.body && (
                                                <p className="text-xs text-muted-foreground/80 leading-relaxed">
                                                  {card.body.slice(0, 200)}{card.body.length > 200 ? "..." : ""}
                                                </p>
                                              )}
                                              <div className="flex items-center gap-2">
                                                <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                                                <span className="text-xs text-muted-foreground truncate">{card.docFilename}</span>
                                                {card.sectionHeading && (
                                                  <Badge variant="outline" className="text-xs shrink-0">{card.sectionHeading}</Badge>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {(!response.cards || response.cards.length === 0) && response.docId > 0 && (
                                    <div className="flex items-center gap-2">
                                      <FileText className="w-3 h-3 text-primary shrink-0" />
                                      <p className="text-xs font-medium text-primary truncate">{response.docFilename}</p>
                                      {response.sectionHint && (
                                        <span className="text-xs text-muted-foreground">· {response.sectionHint}</span>
                                      )}
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="shrink-0 h-6 w-6"
                                        onClick={() => handleDownloadDoc(response.docId, response.docFilename)}
                                      >
                                        <Download className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
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

          {data.contentions.length === 0 && data.responses.length === 0 && (
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
