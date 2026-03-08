import { useState, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Download, FileText, Sparkles, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

interface SearchResult {
  document: {
    id: number;
    filename: string;
    originalFilename: string;
    tags: string[];
    aiKeywords?: string[];
    uploadedAt: string;
  };
  matchingSections: Array<{
    id: number;
    heading: string;
    content: string;
    sectionIndex: number;
  }>;
  rank: number;
  aiSummary: string;
  sectionHint: string;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiSummaries, setAiSummaries] = useState<Record<number, { summary: string; sectionHint: string }>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchIdRef = useRef(0);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    const thisSearchId = ++searchIdRef.current;
    setHasSearched(true);
    setResults([]);
    setAiSummaries({});
    setExpandedSections(new Set());
    setIsSearching(true);
    setIsEnhancing(false);
    setSearchError(false);

    try {
      const res = await apiRequest("POST", "/api/search", { query: trimmed });
      const data = (await res.json()) as { results: SearchResult[]; query: string };

      if (thisSearchId !== searchIdRef.current) return;

      setResults(data.results);
      setIsSearching(false);

      if (data.results.length > 0) {
        setIsEnhancing(true);

        const semanticPromise = apiRequest("POST", "/api/search/semantic", { query: trimmed })
          .then(r => r.json())
          .then((semData: { results: SearchResult[] }) => {
            if (thisSearchId !== searchIdRef.current) return;
            if (semData.results?.length > 0) {
              setResults(prev => {
                const existingMap = new Map(prev.map(r => [r.document.id, r]));
                const updated = [...prev];
                for (const semResult of semData.results) {
                  const existing = existingMap.get(semResult.document.id);
                  if (existing) {
                    if (semResult.aiSummary && !existing.aiSummary) existing.aiSummary = semResult.aiSummary;
                    if (semResult.sectionHint && !existing.sectionHint) existing.sectionHint = semResult.sectionHint;
                  } else {
                    updated.push({ ...semResult, rank: -1 });
                  }
                }
                return updated;
              });
            }
          })
          .catch(() => {});

        const enhanceIds = data.results.map(r => r.document.id);
        const enhancePromise = apiRequest("POST", "/api/search/ai-enhance", { query: trimmed, documentIds: enhanceIds })
          .then(r => r.json())
          .then((enhData: { summaries: Record<number, { summary: string; sectionHint: string }> }) => {
            if (thisSearchId !== searchIdRef.current) return;
            if (enhData.summaries) {
              setAiSummaries(enhData.summaries);
            }
          })
          .catch(() => {});

        await Promise.allSettled([semanticPromise, enhancePromise]);
        if (thisSearchId === searchIdRef.current) {
          setIsEnhancing(false);
        }
      } else {
        setIsSearching(false);
      }
    } catch {
      if (thisSearchId === searchIdRef.current) {
        setSearchError(true);
        setIsSearching(false);
      }
    }
  };

  const handleDownload = (id: number, filename: string) => {
    const link = document.createElement("a");
    link.href = `/api/documents/${id}/download`;
    link.download = filename;
    link.click();
  };

  const toggleSections = (docId: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const getSummary = (result: SearchResult) => {
    const fromAi = aiSummaries[result.document.id];
    if (fromAi?.summary) return fromAi.summary;
    if (result.aiSummary) return result.aiSummary;
    return null;
  };

  const getHint = (result: SearchResult) => {
    const fromAi = aiSummaries[result.document.id];
    if (fromAi?.sectionHint) return fromAi.sectionHint;
    if (result.sectionHint) return result.sectionHint;
    return null;
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Search Evidence</h2>
        <p className="text-muted-foreground">
          Search your evidence library using concepts, arguments, or impact chains. AI matches semantically — try "cap good", "dedev", or "warming impact turn".
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2" data-testid="form-search">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search arguments, concepts, or impact chains..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Button type="submit" disabled={isSearching || !query.trim()} data-testid="button-search">
          {isSearching ? "Searching..." : "Search"}
        </Button>
      </form>

      {isSearching && results.length === 0 && (
        <div className="space-y-4" data-testid="search-loading">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {searchError && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <p className="text-sm text-destructive">Search failed. Please try again.</p>
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground" data-testid="text-result-count">
              {results.length} result{results.length !== 1 ? "s" : ""} found
            </p>
            <div className="flex items-center gap-2">
              {isEnhancing && (
                <Badge variant="secondary" className="gap-1 animate-pulse">
                  <Sparkles className="w-3 h-3" />
                  Loading AI summaries...
                </Badge>
              )}
              {!isEnhancing && Object.keys(aiSummaries).length > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="w-3 h-3" />
                  AI-Enhanced
                </Badge>
              )}
            </div>
          </div>

          {results.map((result, index) => {
            const summary = getSummary(result);
            const hint = getHint(result);
            const isExpanded = expandedSections.has(result.document.id);

            return (
              <Card key={result.document.id} className="hover-elevate" data-testid={`card-result-${result.document.id}`}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-mono shrink-0">
                        #{index + 1}
                      </Badge>
                      <CardTitle className="text-base truncate" data-testid={`text-filename-${result.document.id}`}>
                        <FileText className="w-4 h-4 inline mr-2 text-primary" />
                        {result.document.originalFilename}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {result.document.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDownload(result.document.id, result.document.originalFilename)}
                    data-testid={`button-download-${result.document.id}`}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {summary ? (
                    <div className="bg-primary/5 rounded-md p-3 border border-primary/10">
                      <div className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <p className="text-sm" data-testid={`text-summary-${result.document.id}`}>
                          {summary}
                        </p>
                      </div>
                    </div>
                  ) : isEnhancing ? (
                    <div className="bg-muted/50 rounded-md p-3">
                      <Skeleton className="h-4 w-full" />
                    </div>
                  ) : null}

                  {hint && (
                    <p className="text-xs text-muted-foreground">
                      Look in section: <span className="font-medium text-foreground">{hint}</span>
                    </p>
                  )}

                  {result.matchingSections.length > 0 && (
                    <div className="space-y-2">
                      <button
                        onClick={() => toggleSections(result.document.id)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                        data-testid={`button-toggle-sections-${result.document.id}`}
                      >
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {result.matchingSections.length} Matching Section{result.matchingSections.length !== 1 ? "s" : ""}
                      </button>
                      {isExpanded && result.matchingSections.slice(0, 5).map((section) => (
                        <div
                          key={section.id}
                          className="text-sm rounded-md bg-muted/50 p-3 space-y-1"
                          data-testid={`section-${section.id}`}
                        >
                          {section.heading && (
                            <p className="font-medium text-xs text-primary">{section.heading}</p>
                          )}
                          <p className="text-muted-foreground line-clamp-3">
                            {section.content.slice(0, 300)}
                            {section.content.length > 300 ? "..." : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {hasSearched && !isSearching && results.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="font-medium text-muted-foreground">No matching evidence found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try different keywords or upload more evidence files
            </p>
          </CardContent>
        </Card>
      )}

      {!hasSearched && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-primary/50" />
          </div>
          <h3 className="font-medium text-lg mb-1">Ready to search</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Type an argument, concept, or impact chain to find relevant evidence.
            AI matches semantically — "capitalism good" finds "Cap Good", "dedev" finds degrowth evidence.
          </p>
        </div>
      )}
    </div>
  );
}
